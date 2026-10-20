"""Minimal ``requests`` compatibility used by migrated read-only report code."""

from __future__ import annotations

import json
from typing import Any

from . import local_rest


class HTTPError(RuntimeError):
    def __init__(self, response: "Response"):
        super().__init__(f"HTTP {response.status_code}: {response.text}")
        self.response = response


class _Exceptions:
    HTTPError = HTTPError


exceptions = _Exceptions()


class Response:
    def __init__(self, payload: dict[str, Any] | None = None, status_code: int = 200, text: str = ""):
        self._payload = payload or {}
        self.status_code = int(status_code)
        self.text = text or json.dumps(self._payload, ensure_ascii=False, default=str)
        self.content = self.text.encode("utf-8")

    def json(self) -> dict[str, Any]:
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise HTTPError(self)


class Session:
    def __init__(self):
        self.headers: dict[str, str] = {}

    def get(self, url: str, params: dict[str, Any] | None = None, timeout: int | float | None = None, **_kwargs) -> Response:
        return get(url, params=params, headers=self.headers, timeout=timeout)


def get(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: int | float | None = None, **_kwargs) -> Response:
    del headers, timeout
    try:
        payload = local_rest.get(url, params=params)
        return Response(payload=payload, status_code=200)
    except local_rest.LocalRestError as exc:
        return Response(payload={"exc": exc.message}, status_code=exc.status_code, text=exc.message)
