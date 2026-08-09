"""Redis-backed jobs for CPU-intensive scientific analyses."""

from __future__ import annotations

import hashlib
import json
import os
import time
import uuid

from fastapi.encoders import jsonable_encoder

from backend.cache import redis_client
from backend.handlers.explorer import calibration_nmds, modern_analogues
from backend.schemas.requests import AnalogueRequest, NmdsRequest

QUEUE_NAMES = {
    "nmds": "amoebascope:jobs:nmds",
    "modern_analogue": "amoebascope:jobs:modern-analogue",
}
JOB_TTL_SECONDS = 86400


def _job_key(job_id: str) -> str:
    return f"amoebascope:job:{job_id}"


def _request_fingerprint(analysis: str, request) -> str:
    encoded = jsonable_encoder(request)
    canonical = json.dumps(
        {"analysis": analysis, "request": encoded},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def _dedupe_key(fingerprint: str) -> str:
    return f"amoebascope:job-fingerprint:{fingerprint}"


def _submit(analysis: str, request, synchronous_handler):
    client = redis_client()
    if client is None:
        return {"status": "complete", "result": synchronous_handler(request)}

    fingerprint = _request_fingerprint(analysis, request)
    dedupe_key = _dedupe_key(fingerprint)
    # The Lua transaction prevents two API processes from enqueueing the same
    # request during the small gap between claiming a fingerprint and writing
    # its job record.
    enqueue_once = """
        local existing_id = redis.call('GET', KEYS[1])
        if existing_id then
            local existing_record = redis.call('GET', ARGV[1] .. existing_id)
            if existing_record then
                return {0, existing_record}
            end
            redis.call('DEL', KEYS[1])
        end
        redis.call('SETEX', KEYS[1], ARGV[2], ARGV[3])
        redis.call('SETEX', ARGV[1] .. ARGV[3], ARGV[2], ARGV[4])
        redis.call('RPUSH', KEYS[2], ARGV[5])
        return {1, ARGV[4]}
    """
    for _ in range(2):
        job_id = uuid.uuid4().hex
        record = {"status": "queued", "job_id": job_id}
        payload = {
            "job_id": job_id,
            "analysis": analysis,
            "fingerprint": fingerprint,
            "request": jsonable_encoder(request),
        }
        _, raw_record = client.eval(
            enqueue_once,
            2,
            dedupe_key,
            QUEUE_NAMES[analysis],
            "amoebascope:job:",
            JOB_TTL_SECONDS,
            job_id,
            json.dumps(record),
            json.dumps(payload),
        )
        existing = json.loads(raw_record)
        if existing.get("status") in {"queued", "running", "complete"}:
            return existing
        # Failed and cancelled jobs should not prevent a deliberate retry.
        client.delete(dedupe_key)
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


def cancel_job(job_id: str):
    client = redis_client()
    if client is None:
        return {"status": "unavailable", "detail": "Redis job storage is not configured"}
    value = client.get(_job_key(job_id))
    if value is None:
        return {"status": "not_found", "job_id": job_id}
    record = json.loads(value)
    if record.get("status") == "complete":
        return record
    cancelled = {"status": "cancelled", "job_id": job_id}
    client.setex(_job_key(job_id), JOB_TTL_SECONDS, json.dumps(cancelled))
    return cancelled


def _configured_analyses() -> list[str]:
    configured = os.getenv("SCIENTIFIC_JOB_TYPES", "nmds,modern_analogue")
    analyses = [item.strip() for item in configured.split(",") if item.strip()]
    unknown = set(analyses).difference(QUEUE_NAMES)
    if unknown:
        raise RuntimeError(f"Unknown scientific job types: {', '.join(sorted(unknown))}")
    return analyses


def run_worker():
    client = redis_client(blocking=True)
    if client is None:
        raise RuntimeError("REDIS_URL is required for the background worker")
    analyses = _configured_analyses()
    queues = [QUEUE_NAMES[analysis] for analysis in analyses]
    print(f"Scientific worker listening on: {', '.join(queues)}", flush=True)
    while True:
        try:
            item = client.blpop(queues, timeout=5)
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
        current = client.get(key)
        if current is not None and json.loads(current).get("status") == "cancelled":
            continue
        client.setex(key, JOB_TTL_SECONDS, json.dumps({"status": "running", "job_id": job_id}))
        try:
            if payload["analysis"] == "nmds":
                result = calibration_nmds(NmdsRequest(**payload["request"]))
            elif payload["analysis"] == "modern_analogue":
                result = modern_analogues(AnalogueRequest(**payload["request"]))
            else:
                raise ValueError("Unknown scientific analysis job")
            # Cancellation cannot interrupt numerical code safely, but it does
            # prevent an obsolete result from replacing current browser state.
            current = client.get(key)
            if current is not None and json.loads(current).get("status") == "cancelled":
                continue
            record = {"status": "complete", "job_id": job_id, "result": result}
        except Exception as error:
            record = {"status": "failed", "job_id": job_id, "detail": str(error)}
            fingerprint = payload.get("fingerprint")
            if fingerprint:
                client.delete(_dedupe_key(fingerprint))
        client.setex(key, JOB_TTL_SECONDS, json.dumps(jsonable_encoder(record)))
