import uvicorn

uvicorn.run("platform_api.main:app", host="0.0.0.0", port=8000, reload=False)  # noqa: S104
