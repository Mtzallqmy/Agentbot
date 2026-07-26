from __future__ import annotations

import os
import uuid

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")

from platform_api.models import BackgroundJob, JobStatus
from platform_worker import main


@pytest.mark.asyncio
async def test_execute_job_completes_media_analysis(monkeypatch: pytest.MonkeyPatch) -> None:
    job = BackgroundJob(
        owner_user_id=uuid.uuid4(),
        kind="media.analyze",
        payload={"url": "https://example.test/video"},
        idempotency_key="test-media-job",
    )

    async def fake_analyze(_: BackgroundJob) -> dict[str, object]:
        return {"title": "Test", "duration": 10, "formats": []}

    monkeypatch.setattr(main, "analyze_media", fake_analyze)
    await main.execute_job(job)

    assert job.status == JobStatus.completed
    assert job.progress == 100
    assert job.result == {"title": "Test", "duration": 10, "formats": []}
    assert job.finished_at is not None


@pytest.mark.asyncio
async def test_execute_job_marks_unsupported_kind_failed() -> None:
    job = BackgroundJob(
        owner_user_id=uuid.uuid4(),
        kind="unknown",
        payload={},
        idempotency_key="test-unsupported-job",
    )
    await main.execute_job(job)
    assert job.status == JobStatus.failed
    assert job.error_code == "RuntimeError"


@pytest.mark.asyncio
async def test_execute_job_processes_media(monkeypatch: pytest.MonkeyPatch) -> None:
    job = BackgroundJob(
        owner_user_id=uuid.uuid4(),
        kind="media.process",
        payload={"url": "https://example.test/video", "mode": "video", "format": "mp4"},
        idempotency_key="test-media-process",
    )

    async def fake_process(_: BackgroundJob) -> dict[str, object]:
        return {"output_key": "owner/job/output.mp4", "size_bytes": 42}

    monkeypatch.setattr(main, "process_media", fake_process)
    await main.execute_job(job)
    assert job.status == JobStatus.completed
    assert job.result == {"output_key": "owner/job/output.mp4", "size_bytes": 42}


@pytest.mark.asyncio
async def test_execute_job_honours_cancellation() -> None:
    job = BackgroundJob(
        owner_user_id=uuid.uuid4(),
        kind="media.process",
        payload={},
        idempotency_key="test-media-cancel",
        cancellation_requested=True,
    )
    await main.execute_job(job)
    assert job.status == JobStatus.cancelled
