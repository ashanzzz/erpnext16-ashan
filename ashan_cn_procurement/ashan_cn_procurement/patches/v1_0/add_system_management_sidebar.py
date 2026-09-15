"""Add the administrator navigation group to every business workspace sidebar."""

import frappe


SIDEBAR_NAMES = (
    "My Business",
    "Accounting and Finance",
    "Ashan CN Procurement",
    "Company Compliance Center",
    "Procurement Management",
    "Stock and Inventory",
    "Vehicle Fuel Hub",
)

SYSTEM_MANAGEMENT_ITEMS = (
    {
        "label": "系统管理",
        "link_type": "URL",
        "icon": "settings",
        "type": "Section Break",
        "child": 0,
        "collapsible": 1,
        "indent": 1,
        "keep_closed": 1,
        "show_arrow": 0,
    },
    {
        "label": "客户端脚本",
        "link_type": "URL",
        "url": "/desk/client-script",
        "type": "Link",
        "child": 1,
        "collapsible": 0,
        "indent": 0,
        "keep_closed": 0,
        "show_arrow": 0,
    },
    {
        "label": "自定义表单",
        "link_type": "URL",
        "url": "/desk/customize-form/Customize%20Form",
        "type": "Link",
        "child": 1,
        "collapsible": 0,
        "indent": 0,
        "keep_closed": 0,
        "show_arrow": 0,
    },
    {
        "label": "服务器脚本",
        "link_type": "URL",
        "url": "/desk/server-script",
        "type": "Link",
        "child": 1,
        "collapsible": 0,
        "indent": 0,
        "keep_closed": 0,
        "show_arrow": 0,
    },
    {
        "label": "系统设置",
        "link_type": "URL",
        "url": "/desk/system-settings",
        "type": "Link",
        "child": 1,
        "collapsible": 0,
        "indent": 0,
        "keep_closed": 0,
        "show_arrow": 0,
    },
)


def execute():
    """Create or update the app-owned system management items idempotently."""
    for sidebar_name in SIDEBAR_NAMES:
        if not frappe.db.exists("Workspace Sidebar", sidebar_name):
            continue

        sidebar = frappe.get_doc("Workspace Sidebar", sidebar_name)
        existing_items = {item.label: item for item in sidebar.items}
        changed = False

        for item_data in SYSTEM_MANAGEMENT_ITEMS:
            item = existing_items.get(item_data["label"])
            if item is None:
                sidebar.append("items", item_data)
                changed = True
                continue

            for fieldname, value in item_data.items():
                if item.get(fieldname) != value:
                    item.set(fieldname, value)
                    changed = True

        if changed:
            sidebar.save()
