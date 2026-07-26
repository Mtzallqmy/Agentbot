from __future__ import annotations

import time
import uuid
from collections.abc import Awaitable, Callable

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from sqlalchemy import text

from .config import get_settings
from .db import engine
from .providers import ProviderError
from .routers import auth, conversations, jobs, providers, telegram

REQUESTS = Counter("platform_http_requests_total", "HTTP requests", ["method", "path", "status"])
LATENCY = Histogram("platform_http_request_duration_seconds", "HTTP request latency", ["path"])


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "X-Request-ID", "X-User-ID"],
    )

    @app.exception_handler(ProviderError)
    async def provider_error_handler(_: Request, exc: ProviderError) -> JSONResponse:
        return JSONResponse(
            {"detail": {"code": exc.code, "message": str(exc)}}, status_code=exc.status_code
        )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        request_id = request.headers.get("x-request-id", str(uuid.uuid4()))[:128]
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            REQUESTS.labels(request.method, request.url.path, 500).inc()
            raise
        response.headers["X-Request-ID"] = request_id
        REQUESTS.labels(request.method, request.url.path, response.status_code).inc()
        LATENCY.labels(request.url.path).observe(time.perf_counter() - started)
        return response

    @app.get("/health", tags=["system"])
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/readiness", tags=["system"])
    async def readiness() -> Response:
        try:
            async with engine.connect() as connection:
                await connection.execute(text("SELECT 1"))
            return JSONResponse({"status": "ready", "checks": {"database": "ok"}})
        except Exception:
            return JSONResponse(
                {"status": "not_ready", "checks": {"database": "failed"}}, status_code=503
            )

    @app.get("/metrics", tags=["system"])
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    app.include_router(auth.router, prefix="/api/v1")
    app.include_router(providers.router, prefix="/api/v1")
    app.include_router(conversations.router, prefix="/api/v1")
    app.include_router(jobs.router, prefix="/api/v1")
    app.include_router(telegram.router, prefix="/api/v1")
    return app


app = create_app()
