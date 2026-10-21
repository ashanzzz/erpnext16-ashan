"""Minimal urllib.request compatibility for migrated read-only report code."""

from __future__ import annotations

import io
import json
from urllib.error import HTTPError

from . import local_rest


class Request:
    def __init__(self, url: str, headers: dict[str, str] | None = None, method: str | None = None, **_kwargs):
        self.full_url = str(url)
        self.headers = dict(headers or {})
        self.method = method or "GET"


class _LocalResponse:
    def __init__(self, payload: dict):
        self.status = 200
        self.code = 200
        self._data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")

    def read(self) -> bytes:
        return self._data

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False


def urlopen(request: Request | str, timeout: int | float | None = None, **_kwargs):
    del timeout
    url = request.full_url if isinstance(request, Request) else str(request)
    method = request.method if isinstance(request, Request) else "GET"
    if str(method).upper() != "GET":
        raise HTTPError(url, 405, "Only GET is supported by the local adapter", {}, io.BytesIO())
    try:
        return _LocalResponse(local_rest.get(url))
    except local_rest.LocalRestError as exc:
        body = json.dumps({"exc": exc.message}, ensure_ascii=False).encode("utf-8")
        raise HTTPError(url, exc.status_code, exc.message, {}, io.BytesIO(body)) from exc
