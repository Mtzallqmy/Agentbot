from __future__ import annotations

import asyncio
import secrets
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import func, select

from ..config import get_settings
from ..deps import AdminUser, CurrentUser, SessionDep
from ..models import AgentProject, BackgroundJob, Conversation, JobStatus, Message, User
from ..schemas import (
    AgentProjectCreate,
    AgentRunCreate,
    JobRead,
    MediaAnalyze,
    MediaJobCreate,
)
from ..security import validate_outbound_url

router = APIRouter(tags=["jobs"])


def _resolve_output(root_value: str, output_key: str) -> tuple[Path, Path, bool]:
    root = Path(root_value).resolve()
    output = (root / output_key).resolve()
    return root, output, output.is_file()


def _job(item: BackgroundJob) -> JobRead:
    return JobRead(
        id=item.id,
        kind=item.kind,
        status=item.status.value,
        progress=item.progress,
        current_stage=item.current_stage,
        result=item.result,
        error_code=item.error_code,
        retry_count=item.retry_count,
        cancellation_requested=item.cancellation_requested,
    )


async def _enqueue(
    session: SessionDep,
    user: CurrentUser,
    *,
    kind: str,
    payload: dict[str, object],
    idempotency_key: str,
) -> BackgroundJob:
    existing = await session.scalar(
        select(BackgroundJob).where(
            BackgroundJob.owner_user_id == user.id,
            BackgroundJob.idempotency_key == idempotency_key,
        )
    )
    if existing:
        return existing
    item = BackgroundJob(
        owner_user_id=user.id,
        kind=kind,
        payload=payload,
        idempotency_key=idempotency_key,
        status=JobStatus.queued,
    )
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return item


@router.post("/media/analyze", response_model=JobRead, status_code=202)
async def analyze_media(payload: MediaAnalyze, session: SessionDep, user: CurrentUser) -> JobRead:
    try:
        await validate_outbound_url(str(payload.url))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    item = await _enqueue(
        session,
        user,
        kind="media.analyze",
        payload={"url": str(payload.url)},
        idempotency_key=f"analyze:{secrets.token_urlsafe(16)}",
    )
    return _job(item)


@router.post("/media/jobs", response_model=JobRead, status_code=202)
async def create_media_job(
    payload: MediaJobCreate, session: SessionDep, user: CurrentUser
) -> JobRead:
    try:
        await validate_outbound_url(str(payload.url))
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    if payload.end_seconds is not None and payload.start_seconds is not None:
        if payload.end_seconds <= payload.start_seconds:
            raise HTTPException(422, "end_seconds must be greater than start_seconds")
    item = await _enqueue(
        session,
        user,
        kind="media.process",
        payload=payload.model_dump(mode="json", exclude={"idempotency_key"}),
        idempotency_key=payload.idempotency_key,
    )
    return _job(item)


@router.get("/agent/projects")
async def list_projects(session: SessionDep, user: CurrentUser) -> list[dict[str, object]]:
    projects = (
        await session.scalars(
            select(AgentProject)
            .where(AgentProject.owner_user_id == user.id)
            .order_by(AgentProject.created_at.desc())
        )
    ).all()
    return [
        {
            "id": str(p.id),
            "name": p.name,
            "allowed_tools": p.allowed_tools,
            "created_at": p.created_at,
        }
        for p in projects
    ]


@router.post("/agent/projects", status_code=201)
async def create_project(
    payload: AgentProjectCreate, session: SessionDep, user: CurrentUser
) -> dict[str, object]:
    allowed_registry = {
        "read_file",
        "list_files",
        "write_file",
        "patch_file",
        "run_tests",
        "git_status",
        "git_diff",
    }
    if not set(payload.allowed_tools).issubset(allowed_registry):
        raise HTTPException(422, "One or more tools are not available in the safe MVP registry")
    item = AgentProject(
        owner_user_id=user.id,
        name=payload.name,
        workspace_key=f"{user.id}/{uuid.uuid4()}",
        allowed_tools=payload.allowed_tools,
    )
    session.add(item)
    await session.commit()
    return {"id": str(item.id), "name": item.name, "allowed_tools": item.allowed_tools}


@router.post("/agent/projects/{project_id}/runs", response_model=JobRead, status_code=202)
async def create_agent_run(
    project_id: uuid.UUID,
    payload: AgentRunCreate,
    session: SessionDep,
    user: CurrentUser,
) -> JobRead:
    project = await session.scalar(
        select(AgentProject).where(
            AgentProject.id == project_id, AgentProject.owner_user_id == user.id
        )
    )
    if not project:
        raise HTTPException(404, "Project not found")
    item = await _enqueue(
        session,
        user,
        kind="agent.run",
        payload={"project_id": str(project.id), "prompt": payload.prompt},
        idempotency_key=payload.idempotency_key or f"agent:{secrets.token_urlsafe(16)}",
    )
    return _job(item)


@router.get("/jobs/{job_id}", response_model=JobRead)
async def get_job(job_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> JobRead:
    item = await session.scalar(
        select(BackgroundJob).where(
            BackgroundJob.id == job_id, BackgroundJob.owner_user_id == user.id
        )
    )
    if not item:
        raise HTTPException(404, "Job not found")
    return _job(item)


@router.post("/jobs/{job_id}/cancel", response_model=JobRead)
async def cancel_job(job_id: uuid.UUID, session: SessionDep, user: CurrentUser) -> JobRead:
    item = await session.scalar(
        select(BackgroundJob).where(
            BackgroundJob.id == job_id, BackgroundJob.owner_user_id == user.id
        )
    )
    if not item:
        raise HTTPException(404, "Job not found")
    if item.status in {JobStatus.completed, JobStatus.failed, JobStatus.cancelled}:
        return _job(item)
    item.cancellation_requested = True
    if item.status == JobStatus.queued:
        item.status = JobStatus.cancelled
        item.current_stage = "cancelled"
    await session.commit()
    await session.refresh(item)
    return _job(item)


@router.get("/jobs/{job_id}/download")
async def download_job_output(
    job_id: uuid.UUID, session: SessionDep, user: CurrentUser
) -> FileResponse:
    item = await session.scalar(
        select(BackgroundJob).where(
            BackgroundJob.id == job_id, BackgroundJob.owner_user_id == user.id
        )
    )
    if not item or item.status != JobStatus.completed or not item.result:
        raise HTTPException(404, "Completed output not found")
    output_key = item.result.get("output_key")
    if not isinstance(output_key, str):
        raise HTTPException(404, "This job has no downloadable output")
    root, output, is_file = await asyncio.to_thread(
        _resolve_output, get_settings().media_output_root, output_key
    )
    if root not in output.parents or not is_file:
        raise HTTPException(404, "Output file is unavailable")
    return FileResponse(
        output,
        filename=str(item.result.get("filename") or output.name),
        media_type="application/octet-stream",
    )


@router.get("/admin/metrics")
async def admin_metrics(session: SessionDep, _: AdminUser) -> dict[str, int]:
    async def count(model: type[object]) -> int:
        return int((await session.scalar(select(func.count()).select_from(model))) or 0)

    failed_jobs = int(
        (
            await session.scalar(
                select(func.count())
                .select_from(BackgroundJob)
                .where(BackgroundJob.status == JobStatus.failed)
            )
        )
        or 0
    )
    return {
        "users": await count(User),
        "conversations": await count(Conversation),
        "messages": await count(Message),
        "jobs": await count(BackgroundJob),
        "failed_jobs": failed_jobs,
    }
