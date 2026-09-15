"""Single source of truth for business Desk landing routes.

This module is intentionally Frappe-independent so hooks.py and boot.py can
share the same routing policy without importing UI or session state.
"""

from __future__ import annotations


ROLE_HOME_PAGE = {
    "System Manager": "desk/Workspaces/Home",
    "Administrator": "desk/Workspaces/Home",
    "Purchase User": "desk/Workspaces/Procurement Management",
    "Purchase Manager": "desk/Workspaces/Procurement Management",
    "Stock User": "desk/Workspaces/Stock and Inventory",
    "Stock Manager": "desk/Workspaces/Stock and Inventory",
    "Accounts User": "desk/Workspaces/Accounting and Finance",
    "Accounts Manager": "desk/Workspaces/Accounting and Finance",
    "Oil Card Operator": "desk/oil-card-ledger",
    "Oil Card Manager": "desk/oil-card-ledger",
    "油卡操作员": "desk/oil-card-ledger",
    "油卡管理员": "desk/oil-card-ledger",
    "All": "desk/Workspaces/Home",
}


def resolve_login_home_route(roles, user: str | None = None) -> str:
    """Return the canonical absolute Desk route for a user's role set."""
    role_set = set(roles or [])

    if user == "Administrator" or "System Manager" in role_set or "Administrator" in role_set:
        return "/desk/Workspaces/Home"
    if role_set.intersection({"Purchase User", "Purchase Manager"}):
        return "/desk/Workspaces/Procurement Management"
    if role_set.intersection({"Stock User", "Stock Manager"}):
        return "/desk/Workspaces/Stock and Inventory"
    if role_set.intersection({"Accounts User", "Accounts Manager"}):
        return "/desk/Workspaces/Accounting and Finance"
    if role_set.intersection({"Oil Card Operator", "Oil Card Manager", "油卡操作员", "油卡管理员"}):
        return "/desk/oil-card-ledger"
    return "/desk/Workspaces/Home"
