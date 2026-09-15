"""Central, server-side authorization policies for sensitive business flows.

Navigation is intentionally not treated as a security boundary.  Every
whitelisted operation that touches payroll or the oil-card ledger must use the
checks in this module before it reads or mutates business data.
"""

from __future__ import annotations

from typing import Iterable

import frappe


SYSTEM_ROLES = {"System Manager"}

# Every custom business module has exactly one operating role pair.  System
# Manager remains the platform-wide break-glass administrator and is not a
# third module role.  Older generic ERP roles are deliberately not listed:
# they retain their native ERPNext responsibilities but cannot open or call a
# custom workbench merely because they are in Finance, Purchase or Stock.
MODULE_ACCESS_MODEL = {
    "payroll": {
        "label": "人事薪酬",
        "manager_role": "Payroll Manager",
        "operator_role": "Payroll Operator",
    },
    "oil_card": {
        "label": "油卡与车辆",
        "manager_role": "Oil Card Manager",
        "operator_role": "Oil Card Operator",
    },
    "compliance": {
        "label": "合规与特种设备",
        "manager_role": "Compliance Manager",
        "operator_role": "Compliance Operator",
    },
    "property": {
        "label": "物业与租赁",
        "manager_role": "Property Manager",
        "operator_role": "Property Operator",
    },
    "tax_invoice": {
        "label": "税局发票",
        "manager_role": "Tax Invoice Manager",
        "operator_role": "Tax Invoice Operator",
    },
}

PAYROLL_ACCESS_MATRIX = {
    "read": {"System Manager", "Payroll Manager", "Payroll Operator"},
    "write": {"System Manager", "Payroll Manager", "Payroll Operator"},
    "export": {"System Manager", "Payroll Manager", "Payroll Operator"},
    "lock": {"System Manager", "Payroll Manager"},
    "unlock_request": {"System Manager", "Payroll Manager", "Payroll Operator"},
    "unlock": {"System Manager", "Payroll Manager"},
}

# One server-side state policy shared by payroll services, task aggregation and
# future UI components.  ``permission`` maps to PAYROLL_ACCESS_MATRIX and
# ``audit_fields`` identifies the immutable transition trail on the settlement.
PAYROLL_WORKFLOW_POLICY = {
    "草稿": {
        "next_stage": "已计算",
        "action": "计算薪酬",
        "permission": "write",
        "reason_required": False,
        "audit_fields": ("calculated_by", "calculated_at"),
    },
    "已计算": {
        "next_stage": "凭证核验通过",
        "action": "核验社保、公积金凭证",
        "permission": "write",
        "reason_required": False,
        "audit_fields": ("proof_verified_by", "proof_verified_at", "proof_verification_note"),
    },
    "凭证核验通过": {
        "next_stage": "已封账",
        "action": "最终核定封账",
        "permission": "lock",
        "reason_required": False,
        "audit_fields": ("confirmed_by", "confirmed_date"),
    },
    "已封账": {
        "next_stage": "解锁申请中",
        "action": "申请解锁",
        "permission": "unlock_request",
        "reason_required": True,
        "audit_fields": ("unlock_requested_by", "unlock_requested_at", "unlock_request_reason"),
    },
    "解锁申请中": {
        "next_stage": "已解锁",
        "action": "审批解锁",
        "permission": "unlock",
        "reason_required": True,
        "audit_fields": ("unlocked_by", "unlocked_at", "unlock_reason"),
    },
    "已解锁": {
        "next_stage": "已计算",
        "action": "重新计算薪酬",
        "permission": "write",
        "reason_required": False,
        "audit_fields": ("calculated_by", "calculated_at"),
    },
}

OIL_LEDGER_ACCESS_MATRIX = {
    "read": {
        "System Manager", "Oil Card Manager", "Oil Card Operator",
    },
    "write": {
        "System Manager", "Oil Card Manager", "Oil Card Operator",
    },
    "lock": {
        "System Manager", "Oil Card Manager",
    },
    "unlock_request": {
        "System Manager", "Oil Card Manager", "Oil Card Operator",
    },
    "unlock_approve": {
        "System Manager", "Oil Card Manager",
    },
}


def _current_user(user: str | None = None) -> str:
    """Return an explicit user or the active session user."""
    return str(user or frappe.session.user or "Guest")


def _has_system_access(user: str) -> bool:
    """Return whether a user has the deliberate, global administrator scope."""
    if user == "Administrator":
        return True
    return bool(SYSTEM_ROLES & set(frappe.get_roles(user)))


def _company_values_from_user_permissions(user: str) -> set[str]:
    """Read only the explicit Company scopes assigned to a user."""
    values = frappe.get_all(
        "User Permission",
        filters={"user": user, "allow": "Company"},
        pluck="for_value",
    )
    return {str(value).strip() for value in values if str(value).strip()}


def _company_from_user_field(user: str) -> str:
    """Return a legacy User.company value only when the database stores it."""
    if not frappe.db.has_column("User", "company"):
        return ""
    return str(frappe.db.get_value("User", user, "company") or "").strip()


def get_allowed_companies(user: str | None = None) -> set[str] | None:
    """Return a user's company scope; ``None`` means deliberate global scope.

    Explicit User Permission entries take precedence.  For an operational user
    who has not been assigned one yet, the employee company and user default
    provide a safe single-company fallback.  An empty set is intentionally not
    treated as all companies.
    """
    user = _current_user(user)
    if _has_system_access(user):
        return None

    companies = _company_values_from_user_permissions(user)
    if companies:
        return companies

    if frappe.db.exists("DocType", "Employee"):
        employee_company = frappe.db.get_value("Employee", {"user_id": user}, "company")
        if employee_company:
            companies.add(str(employee_company).strip())

    default_company = (
        _company_from_user_field(user)
        or frappe.defaults.get_user_default("Company", user=user)
        or frappe.defaults.get_user_default("company", user=user)
    )
    if default_company:
        companies.add(str(default_company).strip())
    return companies


@frappe.whitelist()
def get_module_company_options(module: str) -> list[str]:
    """Return the current user's selectable companies for one custom module."""
    assert_module_access(module, "read")
    allowed_companies = get_allowed_companies()
    filters = {}
    if allowed_companies is not None:
        filters["name"] = ["in", sorted(allowed_companies)]
    return frappe.get_all("Company", filters=filters, pluck="name", order_by="name asc")


def assert_company_access(company: str, user: str | None = None) -> None:
    """Raise when a user attempts to cross a company data boundary."""
    user = _current_user(user)
    company = str(company or "").strip()
    if not company:
        frappe.throw("缺少公司参数，无法确认数据权限范围。", frappe.PermissionError)
    allowed_companies = get_allowed_companies(user)
    if allowed_companies is None:
        return
    if company not in allowed_companies:
        frappe.throw(
            f"权限不足：账号 {user} 未被授予【{company}】的数据操作范围。"
            "请由系统管理员在用户权限中配置 Company 后重试。",
            frappe.PermissionError,
        )


def _assert_role_for_action(action: str, matrix: dict[str, set[str]], label: str, user: str) -> None:
    """Enforce an action-specific role matrix without DocType permission fallbacks."""
    action = str(action or "read").strip().lower()
    if action not in matrix:
        frappe.throw(f"未知的{label}授权动作：{action}", frappe.PermissionError)
    if _has_system_access(user):
        return
    roles = set(frappe.get_roles(user))
    if roles & matrix[action]:
        return
    frappe.throw(f"权限不足：当前账号不具备{label}的【{action}】权限。", frappe.PermissionError)


def get_module_role_pair(module: str) -> dict[str, str]:
    """Return the canonical manager/operator role pair for a custom module."""
    module = str(module or "").strip().lower()
    role_pair = MODULE_ACCESS_MODEL.get(module)
    if not role_pair:
        frappe.throw(f"未知的业务模块授权标识：{module}", frappe.PermissionError)
    return role_pair


def assert_module_access(
    module: str,
    action: str = "read",
    company: str | None = None,
    user: str | None = None,
) -> bool:
    """Authorize a custom module through its two-role model and company scope.

    Operators may conduct normal daily work, exports and unlock requests.
    Only the module manager may delete records, change master configuration,
    lock a period or approve an unlock.  New module endpoints should call this
    helper instead of re-creating ad-hoc role checks.
    """
    user = _current_user(user)
    role_pair = get_module_role_pair(module)
    normalized_action = {
        "create": "write",
        "operate": "write",
        "import": "write",
        "calculate": "write",
        "unlock_approve": "unlock",
    }.get(str(action or "read").strip().lower(), str(action or "read").strip().lower())
    operator_actions = {"read", "write", "export", "unlock_request"}
    manager_actions = operator_actions | {"delete", "configure", "lock", "unlock"}
    if normalized_action not in manager_actions:
        frappe.throw(f"未知的{role_pair['label']}授权动作：{normalized_action}", frappe.PermissionError)
    allowed_roles = {"System Manager", role_pair["manager_role"]}
    if normalized_action in operator_actions:
        allowed_roles.add(role_pair["operator_role"])
    _assert_role_for_action(normalized_action, {normalized_action: allowed_roles}, role_pair["label"], user)
    requested_company = _request_company(company)
    if requested_company:
        assert_company_access(requested_company, user)
    return True


def can_module_access(module: str, action: str = "read", user: str | None = None) -> bool:
    """Return whether a user has the requested module role without raising."""
    user = _current_user(user)
    try:
        role_pair = get_module_role_pair(module)
    except frappe.PermissionError:
        return False
    normalized_action = {"create": "write", "operate": "write", "import": "write"}.get(
        str(action or "read").strip().lower(), str(action or "read").strip().lower()
    )
    operator_actions = {"read", "write", "export", "unlock_request"}
    manager_actions = operator_actions | {"delete", "configure", "lock", "unlock"}
    if normalized_action not in manager_actions:
        return False
    roles = set(frappe.get_roles(user))
    if _has_system_access(user) or role_pair["manager_role"] in roles:
        return True
    return normalized_action in operator_actions and role_pair["operator_role"] in roles


def can_payroll_access(action: str = "read", user: str | None = None) -> bool:
    """Return whether a user holds the role required for a payroll action."""
    user = _current_user(user)
    normalized_action = {"create": "write", "operate": "write", "calculate": "write", "import": "write"}.get(
        str(action or "read").strip().lower(), str(action or "read").strip().lower()
    )
    return bool(
        normalized_action in PAYROLL_ACCESS_MATRIX
        and (_has_system_access(user) or set(frappe.get_roles(user)) & PAYROLL_ACCESS_MATRIX[normalized_action])
    )


def _request_company(company: str | None = None) -> str:
    """Resolve a company passed by Python callers or a Frappe RPC request."""
    return str(company or frappe.form_dict.get("company") or "").strip()


def assert_payroll_access(action: str = "read", company: str | None = None, user: str | None = None) -> bool:
    """Authorize a payroll action and, when available, its company scope."""
    user = _current_user(user)
    normalized_action = {"create": "write", "operate": "write", "calculate": "write", "import": "write"}.get(
        str(action or "read").strip().lower(), str(action or "read").strip().lower()
    )
    _assert_role_for_action(normalized_action, PAYROLL_ACCESS_MATRIX, "人事薪酬", user)
    requested_company = _request_company(company)
    if requested_company:
        assert_company_access(requested_company, user)
    return True


def _company_from_oil_card(oil_card: str | None) -> str:
    """Resolve the owning company for an oil-card operation."""
    card_name = str(oil_card or "").strip()
    if not card_name:
        frappe.throw("缺少油卡参数，无法确认数据权限范围。", frappe.PermissionError)
    company = frappe.db.get_value("Oil Card", card_name, "company")
    if not company:
        frappe.throw("油卡不存在或未设置所属公司。", frappe.PermissionError)
    return str(company)


def assert_oil_ledger_access(action: str = "read", oil_card: str | None = None, user: str | None = None) -> bool:
    """Authorize an oil-card ledger action and bind it to the card's company."""
    user = _current_user(user)
    normalized_action = {"create": "write", "operate": "write"}.get(
        str(action or "read").strip().lower(), str(action or "read").strip().lower()
    )
    _assert_role_for_action(normalized_action, OIL_LEDGER_ACCESS_MATRIX, "油卡台账", user)
    if oil_card:
        assert_company_access(_company_from_oil_card(oil_card), user)
    return True


def filter_rows_by_company(rows: Iterable[dict], company_field: str = "company", user: str | None = None) -> list[dict]:
    """Return only rows in the caller's company scope for shared dashboard APIs."""
    allowed_companies = get_allowed_companies(user)
    if allowed_companies is None:
        return list(rows)
    return [row for row in rows if str(row.get(company_field) or "").strip() in allowed_companies]
