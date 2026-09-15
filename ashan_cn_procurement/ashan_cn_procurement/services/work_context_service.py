"""User-level company and business working-date context for Desk entry."""

from __future__ import annotations

from typing import Any

import frappe
from frappe.utils import getdate, nowdate

from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
)


WORK_CONTEXT_COMPANY_KEY = "ashan_work_company"
WORK_CONTEXT_DATE_KEY = "ashan_work_date"
WORK_CONTEXT_DATE_MODE_KEY = "ashan_work_date_mode"
WORK_CONTEXT_RESTRICTED_SCOPE_KEY = "ashan_work_restricted_scope"
DATE_MODE_SYSTEM = "system"
DATE_MODE_FIXED = "fixed"
RESTRICTED_SCOPE_ALL = "all"
RESTRICTED_SCOPE_PUBLIC = "public_only"
RESTRICTED_SCOPE_RESTRICTED = "restricted_only"
ALL_COMPANY_MARKERS = {"", "All", "全部公司"}


def has_restricted_doc_access(user: str | None = None) -> bool:
    """Check if the user is privileged to view restricted documents."""
    user = str(user or frappe.session.user or "").strip()
    if not user or user == "Guest":
        return False
    if user in ("Administrator",):
        return True
    roles = set(frappe.get_roles(user))
    return bool(roles & {"System Manager", "Restricted Document Super Viewer"})


def _require_authenticated_user(user: str | None = None) -> str:
    """Return an authenticated user name or stop unauthenticated context access."""
    user = str(user or frappe.session.user or "").strip()
    if not user or user == "Guest":
        frappe.throw("请先登录后再设置当前工作环境。", frappe.PermissionError)
    return user


def _accessible_companies(user: str) -> list[str]:
    """Return the user's allowed companies in a stable display order."""
    allowed = get_allowed_companies(user)
    all_companies = frappe.get_all("Company", fields=["name"], order_by="name ASC")
    if allowed is None:
        return [str(row.name) for row in all_companies]
    return [str(row.name) for row in all_companies if row.name in allowed]


def _normalize_work_date(value: str | None) -> str:
    """Validate and normalize a business working date to ISO format."""
    raw_value = str(value or "").strip()
    if not raw_value:
        return nowdate()
    try:
        return str(getdate(raw_value))
    except Exception as exc:
        frappe.throw("业务工作日期格式无效，请选择有效日期。")
        raise exc  # pragma: no cover - frappe.throw always raises


def _normalize_date_mode(value: str | None) -> str:
    """Validate the user's business-date mode."""
    normalized = str(value or "").strip().lower()
    if normalized in {"", DATE_MODE_SYSTEM}:
        return DATE_MODE_SYSTEM
    if normalized == DATE_MODE_FIXED:
        return DATE_MODE_FIXED
    frappe.throw("业务日期模式无效，请选择系统默认或固定日期。")
    return DATE_MODE_SYSTEM  # pragma: no cover - frappe.throw always raises


def get_work_context(user: str | None = None) -> dict[str, Any]:
    """Return the persisted, permission-filtered working context for one user."""
    user = _require_authenticated_user(user)
    companies = _accessible_companies(user)
    selected_company = str(
        frappe.defaults.get_user_default(WORK_CONTEXT_COMPANY_KEY, user=user) or ""
    ).strip()
    if selected_company not in companies:
        selected_company = ""

    date_mode = _normalize_date_mode(
        frappe.defaults.get_user_default(WORK_CONTEXT_DATE_MODE_KEY, user=user)
    )
    raw_work_date = str(
        frappe.defaults.get_user_default(WORK_CONTEXT_DATE_KEY, user=user) or ""
    ).strip()
    if date_mode == DATE_MODE_FIXED and raw_work_date:
        fixed_work_date = _normalize_work_date(raw_work_date)
        work_date = fixed_work_date
    else:
        # Missing mode is deliberately treated as ERPNext's original system-date
        # behavior, including data saved before date modes were introduced.
        date_mode = DATE_MODE_SYSTEM
        fixed_work_date = ""
        work_date = nowdate()

    can_restrict = has_restricted_doc_access(user)
    if can_restrict:
        saved_scope = str(
            frappe.defaults.get_user_default(WORK_CONTEXT_RESTRICTED_SCOPE_KEY, user=user) or ""
        ).strip()
        restricted_scope = (
            saved_scope
            if saved_scope in {RESTRICTED_SCOPE_ALL, RESTRICTED_SCOPE_PUBLIC, RESTRICTED_SCOPE_RESTRICTED}
            else RESTRICTED_SCOPE_ALL
        )
    else:
        restricted_scope = RESTRICTED_SCOPE_PUBLIC

    return {
        "company": selected_company,
        "date_mode": date_mode,
        "work_date": work_date,
        "fixed_work_date": fixed_work_date,
        "companies": companies,
        "restricted_doc_scope": restricted_scope,
        "has_restricted_access": can_restrict,
    }


def get_effective_work_date(value: str | None = None, user: str | None = None) -> str:
    """Use an explicit date, a fixed user date, or ERPNext's system date."""
    if value:
        return _normalize_work_date(value)
    work_context = get_work_context(user)
    if work_context.get("date_mode") == DATE_MODE_FIXED:
        return str(work_context.get("fixed_work_date") or nowdate())
    return nowdate()


@frappe.whitelist(methods=["POST"])
def save_work_context(
    company: str | None = None,
    date_mode: str | None = None,
    work_date: str | None = None,
    restricted_doc_scope: str | None = None,
) -> dict[str, Any]:
    """Persist company scope and optional fixed-date preference for one user."""
    user = _require_authenticated_user()
    selected_company = str(company or "").strip()
    if selected_company in ALL_COMPANY_MARKERS:
        selected_company = ""

    if selected_company:
        assert_company_access(selected_company, user=user)
        frappe.defaults.set_user_default(
            WORK_CONTEXT_COMPANY_KEY,
            selected_company,
            user=user,
        )
        # Keep Frappe's native Company default aligned for standard Link fields.
        frappe.defaults.set_user_default("Company", selected_company, user=user)
    else:
        frappe.defaults.clear_user_default(WORK_CONTEXT_COMPANY_KEY, user=user)
        frappe.defaults.clear_user_default("Company", user=user)

    # Backward compatibility for a cached pre-mode client: an explicitly sent
    # date still means fixed, while an omitted date restores the system default.
    selected_date_mode = (
        _normalize_date_mode(date_mode)
        if date_mode is not None
        else (DATE_MODE_FIXED if str(work_date or "").strip() else DATE_MODE_SYSTEM)
    )
    if selected_date_mode == DATE_MODE_FIXED:
        fixed_work_date = str(work_date or "").strip()
        if not fixed_work_date:
            frappe.throw("选择固定日期后，请填写固定业务日期。")
        frappe.defaults.set_user_default(
            WORK_CONTEXT_DATE_MODE_KEY,
            DATE_MODE_FIXED,
            user=user,
        )
        frappe.defaults.set_user_default(
            WORK_CONTEXT_DATE_KEY,
            _normalize_work_date(fixed_work_date),
            user=user,
        )
    else:
        frappe.defaults.clear_user_default(WORK_CONTEXT_DATE_MODE_KEY, user=user)
        frappe.defaults.clear_user_default(WORK_CONTEXT_DATE_KEY, user=user)

    if has_restricted_doc_access(user) and restricted_doc_scope:
        scope = str(restricted_doc_scope).strip().lower()
        if scope in {RESTRICTED_SCOPE_ALL, RESTRICTED_SCOPE_PUBLIC, RESTRICTED_SCOPE_RESTRICTED}:
            frappe.defaults.set_user_default(
                WORK_CONTEXT_RESTRICTED_SCOPE_KEY,
                scope,
                user=user,
            )

    return get_work_context(user)
