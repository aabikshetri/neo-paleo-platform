"""Redis-backed jobs for CPU-intensive scientific analyses."""

from __future__ import annotations

import json
import time
import uuid

from fastapi.encoders import jsonable_encoder

from backend.cache import redis_client
from backend.handlers.explorer import calibration_nmds, modern_analogues
from backend.schemas.requests import AnalogueRequest, NmdsRequest

QUEUE_NAME = "amoebascope:jobs:scientific"
JOB_TTL_SECONDS = 86400


def _job_key(job_id: str) -> str:
    return f"amoebascope:job:{job_id}"


def _submit(analysis: str, request, synchronous_handler):
    client = redis_client()
    if client is None:
        return {"status": "complete", "result": synchronous_handler(request)}
    job_id = uuid.uuid4().hex
    record = {"status": "queued", "job_id": job_id}
    with client.pipeline() as pipe:
        pipe.setex(_job_key(job_id), JOB_TTL_SECONDS, json.dumps(record))
        pipe.rpush(QUEUE_NAME, json.dumps({
            "job_id": job_id,
            "analysis": analysis,
            "request": jsonable_encoder(request),
        }))
        pipe.execute()
    return record


def submit_nmds(request: NmdsRequest):
    return _submit("nmds", request, calibration_nmds)


def submit_analogue(request: AnalogueRequest):
    return _submit("modern_analogue", request, modern_analogues)


def job_status(job_id: str):
    client = redis_client()
    if client is None:
        return {"status": "unavailable", "detail": "Redis job storage is not configured"}
    value = client.get(_job_key(job_id))
    return json.loads(value) if value else {"status": "not_found", "job_id": job_id}


def run_worker():
    client = redis_client(blocking=True)
    if client is None:
        raise RuntimeError("REDIS_URL is required for the background worker")
    while True:
        try:
            item = client.blpop(QUEUE_NAME, timeout=5)
        except Exception as error:
            print(f"Redis queue temporarily unavailable: {error}", flush=True)
            time.sleep(2)
            client = redis_client(blocking=True)
            continue
        if item is None:
            continue
        _, raw = item
        payload = json.loads(raw)
        job_id = payload["job_id"]
        key = _job_key(job_id)
        client.setex(key, JOB_TTL_SECONDS, json.dumps({"status": "running", "job_id": job_id}))
        try:
            if payload["analysis"] == "nmds":
                result = calibration_nmds(NmdsRequest(**payload["request"]))
            elif payload["analysis"] == "modern_analogue":
                result = modern_analogues(AnalogueRequest(**payload["request"]))
            else:
                raise ValueError("Unknown scientific analysis job")
            record = {"status": "complete", "job_id": job_id, "result": result}
        except Exception as error:
            record = {"status": "failed", "job_id": job_id, "detail": str(error)}
        client.setex(key, JOB_TTL_SECONDS, json.dumps(jsonable_encoder(record)))
