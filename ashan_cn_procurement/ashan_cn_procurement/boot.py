"""Desk boot customizations for the Ashan business application."""

from __future__ import annotations

import frappe

from ashan_cn_procurement.navigation_config import resolve_login_home_route


BUSINESS_SIDEBAR_NAMES = {
    "home",
    "my business",
    "accounting and finance",
    "ashan cn procurement",
    "company compliance center",
    "procurement management",
    "property and lease",
    "stock and inventory",
    "vehicle fuel hub",
}
SYSTEM_MANAGEMENT_LABEL = "系统管理"
SYSTEM_MANAGEMENT_URLS = {
    "/desk/client-script",
    "/desk/customize-form/Customize%20Form",
    "/desk/server-script",
    "/desk/system-settings",
}

# Navigation visibility follows actual ERPNext read permission instead of a
# second hard-coded role matrix. Mutation capability remains server-authoritative
# in procurement_picker_service.
PROCUREMENT_PAGE_READ_DOCTYPES = {
    "material-request-workbench": ("Material Request",),
    "procurement-execution-workbench": (
        "Material Request",
        "Purchase Receipt",
        "Purchase Invoice",
    ),
    "material-receipt-workbench": ("Purchase Order",),
}


def _can_read_any(doctypes: tuple[str, ...]) -> bool:
    return any(frappe.has_permission(doctype, "read") for doctype in doctypes)


def set_login_redirect(*args, **kwargs):
    """Use the canonical server-side role policy for login redirects."""
    user = frappe.session.user
    roles = frappe.get_roles(user) if user else []
    home_route = resolve_login_home_route(roles, user=user)

    for arg in args:
        if hasattr(arg, "home_page"):
            arg.home_page = home_route
    if getattr(frappe.local, "login_manager", None):
        frappe.local.login_manager.home_page = home_route
    if hasattr(frappe.local, "response"):
        frappe.local.response["home_page"] = home_route


def get_website_user_home_page(user):
    """Return the same canonical destination for website login handling."""
    roles = frappe.get_roles(user) if user else []
    return resolve_login_home_route(roles, user=user).lstrip("/")


def boot_session(bootinfo):
    """Inject work context and permission-filtered business navigation metadata."""
    user = frappe.session.user
    roles = frappe.get_roles(user) if user else []
    is_system_manager = user == "Administrator" or "System Manager" in roles
    home_route = resolve_login_home_route(roles, user=user)

    bootinfo.ashan_is_system_manager = is_system_manager
    bootinfo.ashan_home_route = home_route

    if user and user != "Guest":
        from ashan_cn_procurement.services.work_context_service import get_work_context

        bootinfo.ashan_work_context = get_work_context(user)

    # Frappe's boot home_page must be a real Page name. Workspace destinations
    # are represented separately in ashan_home_route and consumed by the small
    # client routing adapter in ashan_cn_sidebar_v2.js.
    bootinfo.home_page = "oil-card-ledger" if home_route == "/desk/oil-card-ledger" else "desktop"

    for sidebar_name, sidebar in (bootinfo.get("workspace_sidebar_item") or {}).items():
        if not isinstance(sidebar, dict) or "items" not in sidebar:
            continue

        items = sidebar.get("items", [])
        new_items = []
        has_lease_bench = any(
            "lease-settlement-workbench" in str(item.get("link_to", ""))
            or "lease-settlement-workbench" in str(item.get("url", ""))
            for item in items
        )

        for item in items:
            link_to = str(item.get("link_to", ""))
            url = str(item.get("url", ""))

            # Property Charge Rate was merged into Property Lease.
            if (
                link_to == "Property Charge Rate"
                or "property-charge-rate" in url
                or item.get("label") == "收费标准版本"
            ):
                continue

            if not is_system_manager and sidebar_name.lower() in BUSINESS_SIDEBAR_NAMES:
                if item.get("label") == SYSTEM_MANAGEMENT_LABEL or url in SYSTEM_MANAGEMENT_URLS:
                    continue

            read_doctypes = PROCUREMENT_PAGE_READ_DOCTYPES.get(link_to)
            if read_doctypes and not is_system_manager and not _can_read_any(read_doctypes):
                continue

            if "property-settlement-workbench" in link_to or "property-settlement-workbench" in url:
                item["label"] = "水电费月结工作台"
                new_items.append(item)
                if not has_lease_bench:
                    new_items.append({
                        "label": "房租与物业费工作台",
                        "link_type": "Page",
                        "type": "Link",
                        "link_to": "lease-settlement-workbench",
                        "url": "/desk/lease-settlement-workbench",
                        "child": 1,
                        "collapsible": 0,
                        "indent": 0,
                        "keep_closed": 0,
                        "show_arrow": 0,
                        "doctype": "Workspace Sidebar Item",
                    })
            else:
                new_items.append(item)

        sidebar["items"] = new_items
