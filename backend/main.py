"""FastAPI application factory for AmoebaScope."""

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from backend.core.config import cors_origins, request_timeout_seconds
from backend.routers import calibration, exports, health, jobs, ordination, search, taxa


class RequestTimeoutMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        try:
            return await asyncio.wait_for(
                call_next(request), timeout=request_timeout_seconds()
            )
        except asyncio.TimeoutError:
            return JSONResponse(
                {"detail": "Request exceeded the configured server timeout"},
                status_code=504,
            )


class CacheHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        if request.method == "GET" and response.status_code == 200:
            if request.url.path == "/publication-options":
                response.headers["Cache-Control"] = "public, max-age=120, s-maxage=600, stale-while-revalidate=3600"
            elif request.url.path == "/search-page":
                response.headers["Cache-Control"] = "public, max-age=30, s-maxage=120, stale-while-revalidate=300"
            elif request.url.path == "/health":
                response.headers["Cache-Control"] = "no-store"
        return response


def create_app() -> FastAPI:
    app = FastAPI(title="Neo API", version="1.0.0")
    app.add_middleware(RequestTimeoutMiddleware)
    app.add_middleware(CacheHeadersMiddleware)
    app.add_middleware(GZipMiddleware, minimum_size=1000, compresslevel=5)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins(),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health.router)
    app.include_router(search.router)
    app.include_router(taxa.router)
    app.include_router(calibration.router)
    app.include_router(ordination.router)
    app.include_router(jobs.router)
    app.include_router(exports.router)
    return app


app = create_app()
