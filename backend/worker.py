"""Start the AmoebaScope scientific background worker."""

from backend.jobs import run_worker


if __name__ == "__main__":
    run_worker()
