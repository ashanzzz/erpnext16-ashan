"""User-level company and business working-date context for Desk entry."""

from __future__ import annotations

from typing import Any

import frappe
from frappe.utils import getdate, nowdate

from ashan_cn_procurement.services.authorization_service import (
    assert_company_access,
    get_allowed_companies,
    _has_system_access,
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

    global_font_size = frappe.defaults.get_global_default("ashan_global_font_size")
    global_row_height = frappe.defaults.get_global_default("ashan_global_row_height")
    global_modal_font_size = frappe.defaults.get_global_default("ashan_global_modal_font_size")
    global_modal_row_height = frappe.defaults.get_global_default("ashan_global_modal_row_height")
    global_sidebar_header_font_size = frappe.defaults.get_global_default("ashan_global_sidebar_header_font_size")
    global_sidebar_tools_font_size = frappe.defaults.get_global_default("ashan_global_sidebar_tools_font_size")
    global_sidebar_l1_font_size = frappe.defaults.get_global_default("ashan_global_sidebar_l1_font_size")
    global_sidebar_l2_font_size = frappe.defaults.get_global_default("ashan_global_sidebar_l2_font_size")
    global_sidebar_item_height = frappe.defaults.get_global_default("ashan_global_sidebar_item_height")
    global_button_font_size = frappe.defaults.get_global_default("ashan_global_button_font_size")
    global_button_height = frappe.defaults.get_global_default("ashan_global_button_height")

    try:
        font_size = int(float(global_font_size)) if global_font_size else 13
    except (ValueError, TypeError):
        font_size = 13
    try:
        row_height = int(float(global_row_height)) if global_row_height else 38
    except (ValueError, TypeError):
        row_height = 38
    try:
        modal_font_size = int(float(global_modal_font_size)) if global_modal_font_size else font_size
    except (ValueError, TypeError):
        modal_font_size = font_size
    try:
        modal_row_height = int(float(global_modal_row_height)) if global_modal_row_height else row_height
    except (ValueError, TypeError):
        modal_row_height = row_height
    try:
        sidebar_header_font_size = int(float(global_sidebar_header_font_size)) if global_sidebar_header_font_size else 14
    except (ValueError, TypeError):
        sidebar_header_font_size = 14
    try:
        sidebar_tools_font_size = int(float(global_sidebar_tools_font_size)) if global_sidebar_tools_font_size else 13
    except (ValueError, TypeError):
        sidebar_tools_font_size = 13
    try:
        sidebar_l1_font_size = int(float(global_sidebar_l1_font_size)) if global_sidebar_l1_font_size else 13
    except (ValueError, TypeError):
        sidebar_l1_font_size = 13
    try:
        sidebar_l2_font_size = int(float(global_sidebar_l2_font_size)) if global_sidebar_l2_font_size else 13
    except (ValueError, TypeError):
        sidebar_l2_font_size = 13
    try:
        sidebar_item_height = int(float(global_sidebar_item_height)) if global_sidebar_item_height else 34
    except (ValueError, TypeError):
        sidebar_item_height = 34
    try:
        button_font_size = int(float(global_button_font_size)) if global_button_font_size else font_size
    except (ValueError, TypeError):
        button_font_size = font_size
    try:
        button_height = int(float(global_button_height)) if global_button_height else max(26, row_height - 6)
    except (ValueError, TypeError):
        button_height = max(26, row_height - 6)

    is_admin = _has_system_access(user)
    return {
        "company": selected_company,
        "date_mode": date_mode,
        "work_date": work_date,
        "fixed_work_date": fixed_work_date,
        "companies": companies,
        "restricted_doc_scope": restricted_scope,
        "has_restricted_access": can_restrict,
        "is_admin": is_admin,
        "can_set_date": is_admin,
        "can_set_typography": is_admin,
        "font_size": font_size,
        "row_height": row_height,
        "modal_font_size": modal_font_size,
        "modal_row_height": modal_row_height,
        "sidebar_header_font_size": sidebar_header_font_size,
        "sidebar_tools_font_size": sidebar_tools_font_size,
        "sidebar_l1_font_size": sidebar_l1_font_size,
        "sidebar_l2_font_size": sidebar_l2_font_size,
        "sidebar_item_height": sidebar_item_height,
        "button_font_size": button_font_size,
        "button_height": button_height,
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
    font_size: int | float | str | None = None,
    row_height: int | float | str | None = None,
    modal_font_size: int | float | str | None = None,
    modal_row_height: int | float | str | None = None,
    sidebar_header_font_size: int | float | str | None = None,
    sidebar_tools_font_size: int | float | str | None = None,
    sidebar_l1_font_size: int | float | str | None = None,
    sidebar_l2_font_size: int | float | str | None = None,
    sidebar_item_height: int | float | str | None = None,
    button_font_size: int | float | str | None = None,
    button_height: int | float | str | None = None,
) -> dict[str, Any]:
    """Persist company scope, optional fixed-date preference, and global typography for all users."""
    user = _require_authenticated_user()

    typo_keys = (font_size, row_height, button_font_size, button_height, modal_font_size, modal_row_height, sidebar_header_font_size, sidebar_tools_font_size, sidebar_l1_font_size, sidebar_l2_font_size, sidebar_item_height)
    if any(k is not None for k in typo_keys):
        if not _has_system_access(user):
            frappe.throw("只有系统管理员才有权限修改全局排版设置。", frappe.PermissionError)
        if font_size is not None and str(font_size).strip():
            fs = max(11, min(24, int(float(font_size))))
            frappe.defaults.set_global_default("ashan_global_font_size", fs)
        if row_height is not None and str(row_height).strip():
            rh = max(28, min(60, int(float(row_height))))
            frappe.defaults.set_global_default("ashan_global_row_height", rh)
        if modal_font_size is not None and str(modal_font_size).strip():
            mfs = max(11, min(24, int(float(modal_font_size))))
            frappe.defaults.set_global_default("ashan_global_modal_font_size", mfs)
        if modal_row_height is not None and str(modal_row_height).strip():
            mrh = max(28, min(60, int(float(modal_row_height))))
            frappe.defaults.set_global_default("ashan_global_modal_row_height", mrh)
        if sidebar_header_font_size is not None and str(sidebar_header_font_size).strip():
            shfs = max(11, min(26, int(float(sidebar_header_font_size))))
            frappe.defaults.set_global_default("ashan_global_sidebar_header_font_size", shfs)
        if sidebar_tools_font_size is not None and str(sidebar_tools_font_size).strip():
            stfs = max(11, min(24, int(float(sidebar_tools_font_size))))
            frappe.defaults.set_global_default("ashan_global_sidebar_tools_font_size", stfs)
        if sidebar_l1_font_size is not None and str(sidebar_l1_font_size).strip():
            sl1 = max(11, min(24, int(float(sidebar_l1_font_size))))
            frappe.defaults.set_global_default("ashan_global_sidebar_l1_font_size", sl1)
        if sidebar_l2_font_size is not None and str(sidebar_l2_font_size).strip():
            sl2 = max(11, min(24, int(float(sidebar_l2_font_size))))
            frappe.defaults.set_global_default("ashan_global_sidebar_l2_font_size", sl2)
        if sidebar_item_height is not None and str(sidebar_item_height).strip():
            sih = max(28, min(60, int(float(sidebar_item_height))))
            frappe.defaults.set_global_default("ashan_global_sidebar_item_height", sih)
        if button_font_size is not None and str(button_font_size).strip():
            bfs = max(10, min(24, int(float(button_font_size))))
            frappe.defaults.set_global_default("ashan_global_button_font_size", bfs)
        if button_height is not None and str(button_height).strip():
            bh = max(24, min(60, int(float(button_height))))
            frappe.defaults.set_global_default("ashan_global_button_height", bh)
        frappe.clear_cache()
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
        if not _has_system_access(user):
            frappe.throw("只有系统管理员才有权限指定业务写入日期。", frappe.PermissionError)
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
