"""Production Uvicorn launcher with environment-based capacity limits."""

import os

import uvicorn

from backend.core.config import positive_int


def main():
    uvicorn.run(
        "backend.api:app",
        host=os.getenv("BACKEND_HOST", "0.0.0.0"),
        port=positive_int("PORT", 8001),
        workers=positive_int("WEB_CONCURRENCY", 2),
        limit_concurrency=positive_int("UVICORN_LIMIT_CONCURRENCY", 200),
        timeout_keep_alive=positive_int("UVICORN_KEEP_ALIVE_SECONDS", 5),
        proxy_headers=True,
        forwarded_allow_ips=os.getenv("FORWARDED_ALLOW_IPS", "127.0.0.1"),
    )


if __name__ == "__main__":
    main()
