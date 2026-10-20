"""Read-only adapter from the legacy ERPNext REST calls to the current Frappe site.

It intentionally implements only the GET subset used by the migrated reports.
Frappe's normal DocType permissions and user permissions remain in force.
"""

from __future__ import annotations

import json
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import frappe


class LocalRestError(RuntimeError):
    def __init__(self, status_code: int, message: str):
        super().__init__(message)
        self.status_code = int(status_code)
        self.message = str(message)


def _json_safe(value: Any) -> Any:
    # Frappe's serializer handles dates, decimals and other framework values.
    return json.loads(frappe.as_json(value))


def _decode_json(value: Any, default: Any) -> Any:
    if value is None or value == "":
        return default
    if isinstance(value, (list, dict)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError) as exc:
        raise LocalRestError(400, f"Invalid JSON query parameter: {value}") from exc


def _first(values: dict[str, Any], key: str, default: Any = None) -> Any:
    value = values.get(key, default)
    if isinstance(value, list) and value:
        return value[0]
    return value


def _query(url: str, params: dict[str, Any] | None = None) -> tuple[str, str | None, dict[str, Any]]:
    parsed = urlparse(url)
    path = unquote(parsed.path)
    marker = "/api/resource/"
    if marker not in path:
        raise LocalRestError(404, f"Only {marker}<DocType> GET routes are supported")
    tail = path.split(marker, 1)[1].strip("/")
    parts = tail.split("/", 1)
    doctype = unquote(parts[0]).strip()
    name = unquote(parts[1]).strip() if len(parts) > 1 else None
    if not doctype:
        raise LocalRestError(400, "DocType is required")
    query: dict[str, Any] = {k: v for k, v in parse_qs(parsed.query, keep_blank_values=True).items()}
    if params:
        query.update(params)
    return doctype, name, query


def get(url: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    doctype, name, query = _query(url, params)
    try:
        if name:
            doc = frappe.get_doc(doctype, name)
            doc.check_permission("read")
            return {"data": _json_safe(doc.as_dict())}

        fields = _decode_json(_first(query, "fields"), ["name"])
        filters = _decode_json(_first(query, "filters"), [])
        order_by = str(_first(query, "order_by", "") or "").strip() or None
        try:
            start = max(0, int(_first(query, "limit_start", 0) or 0))
            page_length = int(_first(query, "limit_page_length", 20) or 20)
        except (TypeError, ValueError) as exc:
            raise LocalRestError(400, "Invalid pagination parameter") from exc
        page_length = max(1, min(page_length, 5000))
        rows = frappe.get_list(
            doctype,
            fields=fields,
            filters=filters,
            order_by=order_by,
            start=start,
            page_length=page_length,
        )
        return {"data": _json_safe(rows)}
    except LocalRestError:
        raise
    except frappe.PermissionError as exc:
        raise LocalRestError(403, str(exc) or "Permission denied") from exc
    except frappe.DoesNotExistError as exc:
        raise LocalRestError(404, str(exc) or "Resource not found") from exc
    except Exception as exc:
        # Preserve validation/data errors while giving the compatibility callers
        # an HTTP-like status code.
        raise LocalRestError(400, str(exc)) from exc
