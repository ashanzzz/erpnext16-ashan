from __future__ import annotations

import json
import urllib.error
import urllib.parse
from .. import local_urllib
from datetime import datetime, timezone
from typing import Any

from .. import legacy_wmill as wmill

BASE_URL_VARIABLE_PATH = "f/erpnext/base_url"
API_TOKEN_VARIABLE_PATH = "f/erpnext/api_token"
BACKEND_VERSION = "2.0.0-frappe16"
TIMEOUT_SECONDS = 15
FALLBACK_COMPANIES = [
    "天津祺富机械加工有限公司",
    "天津吉众科技有限公司",
]
FALLBACK_PARENT_GROUPS = ["原材料"]
FALLBACK_SUPPLIERS = [
    {
        "name": "金普金",
        "supplier_name": "天津聚鑫优品五金商贸有限公司",
        "label": "天津聚鑫优品五金商贸有限公司（金普金）",
        "supplier_group": "",
        "favorite": True,
    }
]
FAVORITE_SUPPLIER_NAMES = ["金普金"]


def _read_connection_values() -> tuple[str, str, str]:
    """Read the ERPNext connection from the App-managed ERPNext 当前站点适配器.

    The URL is stored at f/erpnext/base_url and the credential at
    f/erpnext/api_token. The token value is never returned to the frontend or
    written to logs.
    """
    variable_errors: list[str] = []

    try:
        base_url = str(wmill.get_variable(BASE_URL_VARIABLE_PATH) or "").strip().rstrip("/")
    except Exception as exc:
        base_url = ""
        variable_errors.append(f"{BASE_URL_VARIABLE_PATH}: {exc}")

    try:
        token = str(wmill.get_variable(API_TOKEN_VARIABLE_PATH) or "").strip()
    except Exception as exc:
        token = ""
        variable_errors.append(f"{API_TOKEN_VARIABLE_PATH}: {exc}")

    missing: list[str] = []
    if not base_url:
        missing.append(BASE_URL_VARIABLE_PATH)
    if not token:
        missing.append(API_TOKEN_VARIABLE_PATH)
    if missing:
        detail = f"；读取错误：{' | '.join(variable_errors)}" if variable_errors else ""
        raise RuntimeError(
            "ERPNext连接配置不可用。请在ERPNext业务中心的“连接设置”页面完成配置："
            + "、".join(missing)
            + detail
        )

    return base_url, token, "frappe_local"

def _read_connection() -> tuple[str, str]:
    base_url, token, _source = _read_connection_values()
    return base_url, token


def _get_list(base_url: str, token: str, doctype: str, fields: list[str], filters: list | None = None, limit: int = 5000) -> list[dict[str, Any]]:
    endpoint = f"{base_url}/api/resource/{urllib.parse.quote(doctype)}"
    out: list[dict[str, Any]] = []
    offset = 0
    while True:
        params: dict[str, str] = {
            "fields": json.dumps(fields, ensure_ascii=False, separators=(",", ":")),
            "limit_start": str(offset),
            "limit_page_length": str(min(500, limit - len(out))),
            "order_by": "name asc",
        }
        if filters:
            params["filters"] = json.dumps(filters, ensure_ascii=False, separators=(",", ":"))
        request = local_urllib.Request(
            f"{endpoint}?{urllib.parse.urlencode(params)}",
            headers={"Authorization": f"token {token}"},
        )
        with local_urllib.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode("utf-8"))
        rows = payload.get("data") or []
        if not isinstance(rows, list):
            break
        out.extend(row for row in rows if isinstance(row, dict))
        if len(rows) < int(params["limit_page_length"]) or len(out) >= limit:
            break
        offset += len(rows)
    return out[:limit]


def _unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        text = str(value or "").strip()
        if text and text not in seen:
            seen.add(text)
            result.append(text)
    return result


def _supplier_option(row: dict[str, Any]) -> dict[str, Any] | None:
    name = str(row.get("name") or "").strip()
    supplier_name = str(row.get("supplier_name") or "").strip()
    if not name:
        return None
    label = supplier_name if supplier_name and supplier_name == name else (
        f"{supplier_name}（{name}）" if supplier_name else name
    )
    return {
        "name": name,
        "supplier_name": supplier_name,
        "label": label,
        "supplier_group": str(row.get("supplier_group") or "").strip(),
        "favorite": name in FAVORITE_SUPPLIER_NAMES,
    }


def _merge_suppliers(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {item["name"]: dict(item) for item in FALLBACK_SUPPLIERS}
    for row in rows:
        option = _supplier_option(row)
        if option:
            if option["name"] in merged:
                option["favorite"] = True
            merged[option["name"]] = option
    return sorted(
        merged.values(),
        key=lambda item: (0 if item.get("favorite") else 1, str(item.get("label") or item.get("name") or "").lower()),
    )


def _fallback_payload(base_url: str, checked_at: str, warning: str, error_code: str) -> dict[str, Any]:
    return {
        "ok": False,
        "backend_version": BACKEND_VERSION,
        "connection_mode": "frappe_local",
        "base_url_variable": BASE_URL_VARIABLE_PATH,
        "api_token_variable": API_TOKEN_VARIABLE_PATH,
        "base_url": base_url,
        "api_url": f"{base_url}/api" if base_url else "",
        "checked_at": checked_at,
        "companies": list(FALLBACK_COMPANIES),
        "parent_groups": list(FALLBACK_PARENT_GROUPS),
        "suppliers": [item["name"] for item in FALLBACK_SUPPLIERS],
        "supplier_options": list(FALLBACK_SUPPLIERS),
        "favorite_suppliers": list(FAVORITE_SUPPLIER_NAMES),
        "warnings": [warning],
        "error_code": error_code,
    }


def main() -> dict[str, Any]:
    checked_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
    base_url = ""
    warnings: list[str] = []
    try:
        base_url, token = _read_connection()
        companies: list[str] = []
        parent_groups: list[str] = []
        supplier_options: list[dict[str, Any]] = []

        try:
            rows = _get_list(base_url, token, "Company", ["name"])
            companies = _unique([str(row.get("name") or "") for row in rows])
        except Exception as exc:
            warnings.append(f"公司列表读取失败：{exc}")

        try:
            rows = _get_list(
                base_url,
                token,
                "Item Group",
                ["name", "is_group", "parent_item_group"],
                [["Item Group", "is_group", "=", 1]],
            )
            parent_groups = _unique([str(row.get("name") or "") for row in rows])
        except Exception as exc:
            warnings.append(f"父物料组读取失败：{exc}")

        try:
            rows = _get_list(
                base_url,
                token,
                "Supplier",
                ["name", "supplier_name", "supplier_group", "disabled"],
                [["Supplier", "disabled", "=", 0]],
            )
            supplier_options = _merge_suppliers(rows)
        except Exception as exc:
            warnings.append(f"供应商列表读取失败：{exc}")
            supplier_options = list(FALLBACK_SUPPLIERS)

        if not companies:
            companies = list(FALLBACK_COMPANIES)
            warnings.append("未取得公司主数据，已使用内置备用公司列表。")
        if not parent_groups:
            parent_groups = list(FALLBACK_PARENT_GROUPS)
            warnings.append("未取得物料组主数据，已使用内置备用物料组列表。")
        if not supplier_options:
            supplier_options = list(FALLBACK_SUPPLIERS)
            warnings.append("未取得供应商主数据，已保留常用供应商金普金。")

        return {
            "ok": True,
            "backend_version": BACKEND_VERSION,
            "connection_mode": "frappe_local",
        "base_url_variable": BASE_URL_VARIABLE_PATH,
        "api_token_variable": API_TOKEN_VARIABLE_PATH,
            "base_url": base_url,
            "api_url": f"{base_url}/api",
            "checked_at": checked_at,
            "companies": companies,
            "parent_groups": parent_groups,
            "suppliers": [str(item.get("name") or "") for item in supplier_options],
            "supplier_options": supplier_options,
            "favorite_suppliers": list(FAVORITE_SUPPLIER_NAMES),
            "warnings": warnings,
        }
    except urllib.error.HTTPError as exc:
        return _fallback_payload(base_url, checked_at, f"ERPNext 返回 HTTP {exc.code}，已使用内置备用选项。", "ERP_OPTIONS_HTTP_ERROR")
    except Exception as exc:
        return _fallback_payload(base_url, checked_at, f"无法读取 ERPNext 选项：{exc}；已使用内置备用选项。", "ERP_OPTIONS_UNAVAILABLE")
