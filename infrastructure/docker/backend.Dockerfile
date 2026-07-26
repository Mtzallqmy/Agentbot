FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONPATH=/srv/app/apps/api/src:/srv/app/apps/bot/src:/srv/app/apps/worker/src

RUN apt-get update \
    && apt-get install --no-install-recommends -y curl ffmpeg git ca-certificates tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --create-home app

WORKDIR /srv/app
COPY --chown=app:app . .
RUN if [ -f apps/api/pyproject.toml ]; then \
      pip install "./apps/api[bot,worker]" ./apps/bot ./apps/worker; \
    elif [ -f requirements.txt ]; then pip install --requirement requirements.txt; \
    elif [ -f pyproject.toml ]; then pip install .; \
    else echo "No Python dependency manifest found" >&2; exit 1; fi

USER app
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "platform_api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
