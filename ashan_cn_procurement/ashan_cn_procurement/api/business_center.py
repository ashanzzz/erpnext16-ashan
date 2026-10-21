"""ERPNext-native API for the migrated business center reports.

Public RPC surface is deliberately kept to one whitelisted method. Report
modules remain internal Python code. The endpoint is read-only.
"""

from __future__ import annotations

import json
from typing import Any, Callable

import frappe

from ashan_cn_procurement.business_center.reports import (
    account_report,
    erpnext_accounts,
    erpnext_options,
    material_ledger,
    purchase_invoice_export,
    reimbursement_report,
    supplier_statement,
)
from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)

API_VERSION = "2.0.0-frappe16"


def _payload(value: Any) -> dict[str, Any]:
    if value in (None, ""):
        return {}
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str):
        parsed = json.loads(value)
        if isinstance(parsed, dict):
            return parsed
    frappe.throw("payload 必须是 JSON 对象。", frappe.ValidationError)


def _text(value: Any) -> str:
    return str(value or "").strip()


def _list(value: Any) -> list[str]:
    if value in (None, ""):
        return []
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except ValueError:
            decoded = [part.strip() for part in value.split(",")]
        value = decoded
    if not isinstance(value, (list, tuple, set)):
        frappe.throw("列表参数格式无效。", frappe.ValidationError)
    out: list[str] = []
    for item in value:
        text = _text(item)
        if text and text not in out:
            out.append(text)
    return out


def _check_company(company: str) -> str:
    company = _text(company)
    assert_company_access(company)
    if not frappe.db.exists("Company", company):
        frappe.throw(f"公司不存在：{company}", frappe.DoesNotExistError)
    return company


def _check_companies(companies: Any) -> list[str]:
    values = _list(companies)
    if not values:
        frappe.throw("至少选择一家公司。", frappe.ValidationError)
    return [_check_company(company) for company in values]


def _allowed_company_names() -> list[str]:
    allowed = get_allowed_companies()
    filters: dict[str, Any] = {}
    if allowed is not None:
        if not allowed:
            return []
        filters["name"] = ["in", sorted(allowed)]
    rows = frappe.get_list("Company", filters=filters, fields=["name"], order_by="name asc")
    return [_text(row.get("name")) for row in rows if _text(row.get("name"))]


def _health(_data: dict[str, Any]) -> dict[str, Any]:
    frappe.db.sql("select 1")
    return {
        "ok": True,
        "status": "online",
        "api_version": API_VERSION,
        "site": getattr(frappe.local, "site", ""),
        "user": frappe.session.user,
        "installed_apps": frappe.get_installed_apps(),
        "transport": "frappe-local",
    }


def _options(_data: dict[str, Any]) -> dict[str, Any]:
    result = erpnext_options.main()
    allowed = set(_allowed_company_names())
    result["companies"] = [name for name in (result.get("companies") or []) if name in allowed]
    result["ok"] = True
    result["backend_version"] = API_VERSION
    return result


def _accounts(data: dict[str, Any]) -> dict[str, Any]:
    return erpnext_accounts.main(_check_company(data.get("company")))


def _account_report(data: dict[str, Any]) -> dict[str, Any]:
    return account_report.main(
        company=_check_company(data.get("company")),
        accounts=_list(data.get("accounts")),
        start_date=_text(data.get("start_date")),
        end_date=_text(data.get("end_date")),
        granularity=_text(data.get("granularity")) or "item",
        direction=_text(data.get("direction")) or "all",
    )


def _reimbursement_report(data: dict[str, Any]) -> dict[str, Any]:
    return reimbursement_report.main(
        companies=_check_companies(data.get("companies")),
        start_date=_text(data.get("start_date")),
        end_date=_text(data.get("end_date")),
        granularity=_text(data.get("granularity")) or "item",
        direction=_text(data.get("direction")) or "all",
        payment_scope=_text(data.get("payment_scope")) or "all",
    )


def _purchase_invoice_export(data: dict[str, Any]) -> dict[str, Any]:
    return purchase_invoice_export.main(
        month=_text(data.get("month")),
        companies=_check_companies(data.get("companies")),
        suppliers=_list(data.get("suppliers")),
        payment_status=_text(data.get("payment_status")) or "all",
    )


def _material_ledger(data: dict[str, Any]) -> dict[str, Any]:
    return material_ledger.main(
        period=_text(data.get("period")),
        company=_check_company(data.get("company")),
        parent_group=_text(data.get("parent_group")) or "原材料",
    )


def _supplier_statement(data: dict[str, Any]) -> dict[str, Any]:
    return supplier_statement.main(
        mode=_text(data.get("mode")) or "range",
        companies=_check_companies(data.get("companies")),
        suppliers=_list(data.get("suppliers")),
        start_date=_text(data.get("start_date")) or None,
        end_date=_text(data.get("end_date")) or None,
        month=_text(data.get("month")) or None,
        template=_text(data.get("template")) or "supplier",
    )


ACTIONS: dict[str, Callable[[dict[str, Any]], dict[str, Any]]] = {
    "health": _health,
    "options": _options,
    "accounts": _accounts,
    "account_report": _account_report,
    "reimbursement_report": _reimbursement_report,
    "purchase_invoice_export": _purchase_invoice_export,
    "material_ledger": _material_ledger,
    "supplier_statement": _supplier_statement,
}


@frappe.whitelist()
def run(action: str, payload: Any = None) -> dict[str, Any]:
    """Run one read-only business-center action for the current authenticated user."""
    if frappe.session.user == "Guest":
        frappe.throw("请先登录 ERPNext。", frappe.PermissionError)
    action = _text(action).lower()
    handler = ACTIONS.get(action)
    if not handler:
        frappe.throw(
            "未知 action。可用值：" + ", ".join(sorted(ACTIONS)),
            frappe.ValidationError,
        )
    return handler(_payload(payload))
