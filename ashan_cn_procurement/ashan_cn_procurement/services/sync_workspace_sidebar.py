# Copyright (c) 2026, Ashan CN Procurement
"""Compatibility entry point for manual sidebar repair.

The canonical navigation source is now:
ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/workspace_sidebar/home.json

Do not maintain a second hard-coded item list in this service.
"""

import frappe


def check_emp_counts():
    """Return dynamic salary-profile counts by company for diagnostics."""
    result = {}
    if not frappe.db.exists("DocType", "Ashan Employee Salary Profile"):
        return result

    for company in frappe.get_all("Company", pluck="name", order_by="name asc"):
        result[company] = frappe.db.count(
            "Ashan Employee Salary Profile",
            filters={"company": company},
        )
    return result


def fix_and_sync_sidebar():
    """Rebuild every business sidebar from the canonical Home template."""
    from ashan_cn_procurement.setup import sync_all_workspace_sidebars

    sync_all_workspace_sidebars()
    frappe.clear_cache()
    return True
