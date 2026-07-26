from __future__ import annotations

import asyncio
import json
import os
import tempfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, ClassVar

from arq import cron
from arq.connections import RedisSettings
from platform_api.models import BackgroundJob as Job
from platform_api.models import JobStatus, WebhookUpdate
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    raise RuntimeError("DATABASE_URL is required")
engine = create_async_engine(database_url, pool_pre_ping=True)
sessions = async_sessionmaker(engine, expire_on_commit=False)


async def _command(*args: str, timeout: int = 300) -> tuple[str, str]:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env={"PATH": os.environ.get("PATH", ""), "HOME": "/tmp"},
    )
    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=timeout)
    if process.returncode:
        raise RuntimeError(stderr.decode(errors="replace")[-2000:])
    return stdout.decode(), stderr.decode()


async def analyze_media(job: Job) -> dict[str, Any]:
    stdout, _ = await _command(
        "yt-dlp",
        "--dump-single-json",
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        str(job.payload["url"]),
        timeout=60,
    )
    data = json.loads(stdout)
    formats = [
        {
            "id": str(item["format_id"]),
            "label": f"{item.get('format_note') or item.get('resolution') or item['format_id']} · "
            f"{item.get('ext', 'unknown')}",
        }
        for item in data.get("formats", [])
        if item.get("format_id")
    ]
    return {
        "title": data.get("title"),
        "duration": data.get("duration"),
        "thumbnail": data.get("thumbnail"),
        "formats": formats,
    }


async def process_media(job: Job) -> dict[str, Any]:
    root = Path(os.environ.get("MEDIA_OUTPUT_ROOT", "/data/media")).resolve()
    relative_dir = Path(str(job.owner_user_id)) / str(job.id)
    output_dir = (root / relative_dir).resolve()
    if root not in output_dir.parents:
        raise RuntimeError("invalid_output_path")
    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_stdout, _ = await _command(
        "yt-dlp",
        "--dump-single-json",
        "--no-playlist",
        "--skip-download",
        "--no-warnings",
        str(job.payload["url"]),
        timeout=60,
    )
    metadata = json.loads(metadata_stdout)
    duration = float(metadata.get("duration") or 0)
    if duration and duration > float(os.environ.get("MEDIA_MAX_DURATION", "7200")):
        raise RuntimeError("media_duration_limit_exceeded")
    source_template = output_dir / "source.%(ext)s"
    quality = str(job.payload.get("quality") or "bestvideo+bestaudio/best")
    await _command(
        "yt-dlp",
        "--no-playlist",
        "--no-progress",
        "-f",
        quality,
        "--merge-output-format",
        "mp4",
        "-o",
        str(source_template),
        str(job.payload["url"]),
        timeout=int(os.environ.get("MEDIA_DOWNLOAD_TIMEOUT", "900")),
    )
    sources = [path for path in output_dir.glob("source.*") if path.is_file()]
    if len(sources) != 1:
        raise RuntimeError("download_output_missing")
    source = sources[0]
    extension = str(job.payload.get("format") or ("mp3" if job.payload["mode"] == "audio" else "mp4"))
    output = output_dir / f"output.{extension}"
    command = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    start = job.payload.get("start_seconds")
    end = job.payload.get("end_seconds")
    if start is not None:
        command.extend(["-ss", str(float(start))])
    command.extend(["-i", str(source)])
    if end is not None:
        duration = float(end) - float(start or 0)
        command.extend(["-t", str(duration)])
    if job.payload["mode"] == "audio":
        codecs = {
            "mp3": ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"],
            "m4a": ["-vn", "-c:a", "aac", "-b:a", "192k"],
            "wav": ["-vn", "-c:a", "pcm_s16le"],
            "ogg": ["-vn", "-c:a", "libvorbis", "-q:a", "5"],
        }
        command.extend(codecs.get(extension, codecs["mp3"]))
    elif extension == "webm":
        command.extend(["-c:v", "libvpx-vp9", "-c:a", "libopus", "-deadline", "realtime"])
    else:
        command.extend(["-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-movflags", "+faststart"])
    command.append(str(output))
    await _command(*command, timeout=int(os.environ.get("MEDIA_PROCESS_TIMEOUT", "1200")))
    source.unlink(missing_ok=True)
    if not output.is_file():
        raise RuntimeError("processed_output_missing")
    size = output.stat().st_size
    if size > int(os.environ.get("MEDIA_MAX_FILE_SIZE", str(2 * 1024**3))):
        output.unlink(missing_ok=True)
        raise RuntimeError("media_file_size_limit_exceeded")
    return {
        "output_key": str(relative_dir / output.name),
        "filename": output.name,
        "size_bytes": size,
        "format": extension,
    }


async def agent_run(job: Job) -> dict[str, Any]:
    # The MVP run creates an isolated non-shared workspace and a verifiable plan file.
    # Command/network tools are deliberately unavailable until an approval-aware
    # container sandbox is attached.
    base = Path(os.environ.get("AGENT_WORKSPACE_ROOT", "/tmp/agent-workspaces")).resolve()
    base.mkdir(parents=True, exist_ok=True)
    workspace = Path(tempfile.mkdtemp(prefix="run-", dir=base))
    plan = workspace / "PLAN.md"
    plan.write_text(
        "# Agent plan\n\n" + str(job.payload["prompt"]) + "\n",
        encoding="utf-8",
    )
    return {"workspace": workspace.name, "files": ["PLAN.md"], "requires_approval": False}


async def execute_job(job: Job) -> None:
    try:
        if job.cancellation_requested:
            job.status = JobStatus.cancelled
            job.current_stage = "cancelled"
            job.finished_at = datetime.now(UTC)
            return
        if job.kind == "media.analyze":
            job.result = await analyze_media(job)
        elif job.kind == "media.process":
            job.result = await process_media(job)
        elif job.kind == "agent.run":
            job.result = await agent_run(job)
        else:
            raise RuntimeError("unsupported_job_kind")
        job.progress = 100
        job.current_stage = "completed"
        job.status = JobStatus.completed
        job.error_code = None
    except Exception as exc:  # noqa: BLE001 - durable job boundary records sanitized failure
        job.status = JobStatus.failed
        job.current_stage = "failed"
        job.error_code = type(exc).__name__[:120]
    job.finished_at = datetime.now(UTC)


async def poll_jobs(ctx: dict[str, Any]) -> None:
    async with sessions() as session:
        job = await session.scalar(
            select(Job)
            .where(Job.status == JobStatus.queued)
            .order_by(Job.created_at)
            .with_for_update(skip_locked=True)
        )
        if not job:
            return
        job.status = JobStatus.running
        job.current_stage = "processing"
        job.progress = 5
        job.started_at = datetime.now(UTC)
        await session.commit()
        await execute_job(job)
        await session.commit()


async def poll_telegram_updates(ctx: dict[str, Any]) -> None:
    async with sessions() as session:
        update = await session.scalar(
            select(WebhookUpdate)
            .where(WebhookUpdate.processed_at.is_(None))
            .order_by(WebhookUpdate.received_at)
            .with_for_update(skip_locked=True)
        )
        if not update:
            return
        try:
            from platform_bot.handlers import process_update

            await process_update(update.payload)
            update.processed_at = datetime.now(UTC)
            update.last_error = None
        except Exception as exc:  # noqa: BLE001 - webhook retry boundary
            update.processing_attempts += 1
            update.last_error = type(exc).__name__[:120]
        await session.commit()


async def process_telegram_update(ctx: dict[str, Any], payload: dict[str, Any]) -> None:
    from platform_bot.handlers import process_update

    await process_update(payload)


class WorkerSettings:
    redis_settings = RedisSettings.from_dsn(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    cron_jobs: ClassVar[list[Any]] = [
        cron(poll_jobs, second={0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55}),
        cron(poll_telegram_updates, second={1, 6, 11, 16, 21, 26, 31, 36, 41, 46, 51, 56}),
    ]
    max_jobs = int(os.environ.get("WORKER_CONCURRENCY", "4"))
    job_timeout = int(os.environ.get("WORKER_JOB_TIMEOUT", "1800"))
    functions: ClassVar[list[Any]] = [process_telegram_update]
