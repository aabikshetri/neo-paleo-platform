"""Stateless, validated filter selections shared across API requests."""

from __future__ import annotations

import base64
import json
from typing import Any


FILTER_FIELDS = (
    "ph_min", "ph_max", "water_min", "water_max", "lat_min", "lat_max",
    "lon_min", "lon_max", "site_contains", "publication_contains",
)
NUMERIC_FIELDS = set(FILTER_FIELDS[:8])
TOKEN_VERSION = 1


def clean_filters(values: dict[str, Any]) -> dict[str, Any]:
    cleaned = {}
    for field in FILTER_FIELDS:
        value = values.get(field)
        if value in (None, ""):
            continue
        if field in NUMERIC_FIELDS:
            cleaned[field] = float(value)
        else:
            cleaned[field] = str(value).strip()[:500]
    return cleaned


def encode_selection(values: dict[str, Any]) -> str:
    payload = json.dumps(
        {"v": TOKEN_VERSION, "filters": clean_filters(values)},
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return base64.urlsafe_b64encode(payload).decode("ascii").rstrip("=")


def decode_selection(token: str) -> dict[str, Any]:
    if not token or len(token) > 4096:
        raise ValueError("Invalid selection token")
    try:
        padding = "=" * (-len(token) % 4)
        payload = json.loads(base64.urlsafe_b64decode(token + padding))
    except (ValueError, TypeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid selection token") from error
    if payload.get("v") != TOKEN_VERSION or not isinstance(payload.get("filters"), dict):
        raise ValueError("Unsupported selection token")
    return clean_filters(payload["filters"])
