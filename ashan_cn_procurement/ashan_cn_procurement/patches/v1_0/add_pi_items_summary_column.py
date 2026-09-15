# -*- coding: utf-8 -*-
import frappe
from frappe.utils import flt

def execute():
    """
    1. 为 Purchase Invoice 创建 custom_items_summary 字段
    2. 优化列表展示列 (in_list_view): 显示 ID, naming_series, supplier, posting_date, bill_no, custom_items_summary
    3. 批量回填历史单据的物料摘要
    4. Purchase Invoice Item 的集中布局由后续迁移维护
    """
    cf_name = "Purchase Invoice-custom_items_summary"
    if not frappe.db.exists("Custom Field", cf_name):
        cf = frappe.get_doc({
            "doctype": "Custom Field",
            "dt": "Purchase Invoice",
            "fieldname": "custom_items_summary",
            "label": "开票物料明细",
            "fieldtype": "Small Text",
            "insert_after": "bill_no",
            "in_list_view": 1,
            "in_standard_filter": 1,
            "in_global_search": 1,
            "read_only": 1,
            "columns": 3,
            "module": "Ashan CN Procurement"
        })
        cf.insert(ignore_permissions=True)
    else:
        cf = frappe.get_doc("Custom Field", cf_name)
        cf.label = "开票物料明细"
        cf.in_list_view = 1
        cf.in_standard_filter = 1
        cf.in_global_search = 1
        cf.read_only = 1
        cf.columns = 3
        cf.save(ignore_permissions=True)

    # 列表列优化：清空 title_field 让第一列始终展示单据编号 (ID)，并开启 naming_series, supplier, grand_total, bill_no
    frappe.db.set_value("DocType", "Purchase Invoice", "title_field", "")
    frappe.db.set_value("DocField", {"parent": "Purchase Invoice", "fieldname": "naming_series"}, "in_list_view", 1)
    frappe.db.set_value("DocField", {"parent": "Purchase Invoice", "fieldname": "supplier"}, "in_list_view", 1)
    frappe.db.set_value("DocField", {"parent": "Purchase Invoice", "fieldname": "grand_total"}, "in_list_view", 1)
    frappe.db.set_value("DocField", {"parent": "Purchase Invoice", "fieldname": "bill_no"}, "in_list_view", 1)
    frappe.db.set_value("DocField", {"parent": "Purchase Invoice", "fieldname": "due_date"}, "in_list_view", 0)

    # 原生 description 统一为 Data（单行说明）。
    for doctype in (
        "Item",
        "Purchase Invoice Item",
        "Purchase Receipt Item",
        "Purchase Order Item",
        "Material Request Item",
    ):
        frappe.make_property_setter({
            "doctype": doctype,
            "fieldname": "description",
            "property": "fieldtype",
            "value": "Data",
            "property_type": "Select"
        }, validate_fields_for_doctype=False)

    # 历史单据回填
    invoices = frappe.get_all("Purchase Invoice", fields=["name"])
    for inv in invoices:
        doc = frappe.get_doc("Purchase Invoice", inv.name)
        if doc.items:
            item_strs = []
            for it in doc.items:
                name = (it.item_name or it.item_code or "").strip()
                if name:
                    qty = flt(it.qty)
                    item_strs.append(f"{name} (x{qty:g})")
            if item_strs:
                summary = "、".join(item_strs[:3]) + (f" 等共{len(item_strs)}项" if len(item_strs) > 3 else "")
                frappe.db.set_value("Purchase Invoice", inv.name, "custom_items_summary", summary, update_modified=False)

    frappe.db.commit()
