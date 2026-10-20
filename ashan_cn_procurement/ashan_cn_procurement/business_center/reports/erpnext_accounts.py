from __future__ import annotations

import json
import urllib.parse
from .. import local_urllib
from datetime import datetime, timezone
from typing import Any

from .. import legacy_wmill as wmill

BASE_URL_VARIABLE_PATH = "f/erpnext/base_url"
API_TOKEN_VARIABLE_PATH = "f/erpnext/api_token"
BACKEND_VERSION = "2.0.0-frappe16"
TIMEOUT_SECONDS = 15


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

def _connection() -> tuple[str, str]:
    base_url, token, _source = _read_connection_values()
    return base_url, token


def _list(base_url: str, token: str, doctype: str, fields: list[str], filters: list[list[Any]]) -> list[dict[str, Any]]:
    params = {
        "fields": json.dumps(fields, ensure_ascii=False, separators=(",", ":")),
        "filters": json.dumps(filters, ensure_ascii=False, separators=(",", ":")),
        "order_by": "account_number asc,name asc",
        "limit_page_length": "5000",
    }
    url = f"{base_url}/api/resource/{urllib.parse.quote(doctype, safe='')}?{urllib.parse.urlencode(params)}"
    req = local_urllib.Request(url, headers={"Authorization": f"Token {token}", "Accept": "application/json"})
    with local_urllib.urlopen(req, timeout=TIMEOUT_SECONDS) as response:
        payload = json.loads(response.read().decode("utf-8"))
    data = payload.get("data", [])
    return data if isinstance(data, list) else []


def main(company: str) -> dict[str, Any]:
    company = str(company or "").strip()
    if not company:
        return {"ok": True, "company": "", "accounts": [], "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    base_url, token = _connection()
    rows = _list(
        base_url,
        token,
        "Account",
        ["name", "account_name", "account_number", "account_type", "root_type", "is_group", "company"],
        [["company", "=", company], ["is_group", "=", 0], ["disabled", "=", 0]],
    )
    accounts: list[dict[str, Any]] = []
    for row in rows:
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        account_type = str(row.get("account_type") or "").strip()
        root_type = str(row.get("root_type") or "").strip()
        account_name = str(row.get("account_name") or name).strip()
        number = str(row.get("account_number") or "").strip()
        kind = "其他"
        joined = f"{name} {account_name} {account_type}".lower()
        if account_type == "Cash" or "现金" in joined:
            kind = "现金"
        elif account_type == "Bank" or "银行" in joined or "电汇" in joined:
            kind = "银行"
        elif root_type == "Expense":
            kind = "费用"
        elif root_type == "Income":
            kind = "收入"
        accounts.append({
            "name": name,
            "label": account_name,
            "number": number,
            "account_type": account_type,
            "root_type": root_type,
            "kind": kind,
        })
    return {
        "ok": True,
        "company": company,
        "accounts": accounts,
        "count": len(accounts),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "backend_version": BACKEND_VERSION,
    }
