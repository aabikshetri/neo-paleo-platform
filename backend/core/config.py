import os


def positive_int(name: str, default: int) -> int:
    return max(1, int(os.getenv(name, str(default))))


def cors_origins() -> list[str]:
    return [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
        if origin.strip()
    ]


def request_timeout_seconds() -> int:
    return positive_int("REQUEST_TIMEOUT_SECONDS", 120)
