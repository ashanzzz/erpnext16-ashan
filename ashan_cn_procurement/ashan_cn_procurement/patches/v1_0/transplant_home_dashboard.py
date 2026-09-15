# -*- coding: utf-8 -*-
import frappe

def execute():
    """
    Transplant master dashboard into Workspace 'Home' and Workspace Sidebar 'Home'.
    """
    if frappe.db.exists("Workspace", "Home"):
        home_doc = frappe.get_doc("Workspace", "Home")
        home_doc.title = "我的业务 (总控主页)"
        home_doc.icon = "home"
        home_doc.indicator_color = "green"
        home_doc.public = 1
        home_doc.is_hidden = 0

        # 如果存在 My Business，复制其内容与配置
        if frappe.db.exists("Workspace", "My Business"):
            my_biz = frappe.get_doc("Workspace", "My Business")
            home_doc.content = my_biz.content
            home_doc.shortcuts = []
            for sc in my_biz.shortcuts:
                home_doc.append("shortcuts", {
                    "type": sc.type,
                    "link_to": sc.link_to,
                    "doc_view": sc.doc_view,
                    "label": sc.label,
                    "color": getattr(sc, "color", "Grey"),
                    "format": getattr(sc, "format", "")
                })
            home_doc.links = []
            for lk in my_biz.links:
                home_doc.append("links", {
                    "type": lk.type,
                    "label": lk.label,
                    "hidden": lk.hidden,
                    "link_type": lk.link_type,
                    "link_to": lk.link_to,
                    "onboard": lk.onboard,
                    "is_query_report": lk.is_query_report,
                    "link_count": lk.link_count,
                    "dependencies": getattr(lk, "dependencies", "")
                })
            # 隐藏冗余的 My Business
            frappe.db.set_value("Workspace", "My Business", "is_hidden", 1)

        home_doc.save(ignore_permissions=True)

    # 同步 Workspace Sidebar 'Home'
    if frappe.db.table_exists("Workspace Sidebar"):
        if frappe.db.exists("Workspace Sidebar", "Home"):
            sb = frappe.get_doc("Workspace Sidebar", "Home")
            sb.module = "Ashan CN Procurement"
            sb.app = "ashan_cn_procurement"
            sb.title = "Home"
            sb.header_icon = "home"
            sb.save(ignore_permissions=True)

        if frappe.db.table_exists("Workspace Sidebar Item") and frappe.db.exists("Workspace Sidebar", "My Business"):
            frappe.db.sql("DELETE FROM `tabWorkspace Sidebar Item` WHERE parent = 'Home'")
            my_biz_items = frappe.db.sql("SELECT * FROM `tabWorkspace Sidebar Item` WHERE parent = 'My Business' ORDER BY idx", as_dict=True)
            for item in my_biz_items:
                new_item = frappe.get_doc({
                    "doctype": "Workspace Sidebar Item",
                    "parent": "Home",
                    "parenttype": "Workspace Sidebar",
                    "parentfield": "items",
                    "idx": item.idx,
                    "type": item.type,
                    "label": item.label,
                    "icon": item.icon,
                    "link_type": item.link_type,
                    "link_to": "Home" if item.link_to in ["My Business", "my-business"] else item.link_to,
                    "child": item.child,
                    "is_hidden": item.is_hidden,
                    "keep_closed": item.keep_closed
                })
                new_item.insert(ignore_permissions=True)

    frappe.db.commit()
