"""Keep Purchase Invoice Item layout in one maintainable server-side definition."""

import frappe

# 严格按用户标准定义网格列顺序与文案:
# 1. 明细编号 (系统原生序号列)
# 2. 物料编码 (item_code)
# 3. 物料名称 (item_name)
# 4. 规格 (description)
# 5. 数量 (qty)
# 6. 不含税单价 (rate)
# 7. 税率 (custom_tax_rate)
# 8. 未税金额 (amount)
# 9. 税额 (custom_tax_amount)
# 10. 价税合计 (custom_gross_amount)
# 11. 备注 (custom_line_remark，价税合计后面是备注！)

STANDARD_FIELD_SETTINGS = {
    "item_code": {"label": "物料编码", "in_list_view": 1, "columns": 2},
    "item_name": {"label": "物料名称", "in_list_view": 1, "columns": 2},
    "description": {"label": "规格", "in_list_view": 1, "columns": 2},
    "qty": {"label": "数量", "in_list_view": 1, "columns": 1},
    "rate": {"label": "不含税单价", "in_list_view": 1, "columns": 1},
    "amount": {"label": "未税金额", "in_list_view": 1, "columns": 1},
}

CUSTOM_FIELD_SETTINGS = {
    "custom_tax_rate": {"label": "税率", "in_list_view": 1, "columns": 1, "insert_after": "rate"},
    "custom_tax_amount": {"label": "税额", "in_list_view": 1, "columns": 1, "insert_after": "amount"},
    "custom_gross_amount": {"label": "价税合计", "in_list_view": 1, "columns": 1, "insert_after": "custom_tax_amount"},
    "custom_line_remark": {"label": "备注", "in_list_view": 1, "columns": 2, "insert_after": "custom_gross_amount"},
    "custom_gross_rate": {"label": "含税单价", "in_list_view": 0, "columns": 0},
    "custom_tax_basis": {"label": "税额联动基准", "in_list_view": 0, "columns": 0, "hidden": 1},
}

def execute():
    # 1. 使用 Property Setter 规范标准字段 (避免 developer_mode 限制)
    for fieldname, cfg in STANDARD_FIELD_SETTINGS.items():
        if "label" in cfg:
            frappe.make_property_setter({
                "doctype": "Purchase Invoice Item",
                "fieldname": fieldname,
                "property": "label",
                "value": cfg["label"],
                "property_type": "Data",
            }, validate_fields_for_doctype=False)
        if "in_list_view" in cfg:
            frappe.make_property_setter({
                "doctype": "Purchase Invoice Item",
                "fieldname": fieldname,
                "property": "in_list_view",
                "value": str(cfg["in_list_view"]),
                "property_type": "Check",
            }, validate_fields_for_doctype=False)
        if "columns" in cfg and cfg["columns"] > 0:
            frappe.make_property_setter({
                "doctype": "Purchase Invoice Item",
                "fieldname": fieldname,
                "property": "columns",
                "value": str(cfg["columns"]),
                "property_type": "Int",
            }, validate_fields_for_doctype=False)

    # 2. 规范自定义字段 Custom Field
    for fieldname, cfg in CUSTOM_FIELD_SETTINGS.items():
        cf_name = frappe.db.get_value("Custom Field", {"dt": "Purchase Invoice Item", "fieldname": fieldname})
        if cf_name:
            cf = frappe.get_doc("Custom Field", cf_name)
            if "label" in cfg:
                cf.label = cfg["label"]
            if "in_list_view" in cfg:
                cf.in_list_view = cfg["in_list_view"]
            if "insert_after" in cfg:
                cf.insert_after = cfg["insert_after"]
            if "columns" in cfg:
                cf.columns = cfg["columns"]
            if "hidden" in cfg:
                cf.hidden = cfg["hidden"]
            cf.save()

    frappe.clear_cache(doctype="Purchase Invoice Item")
    frappe.clear_cache(doctype="Purchase Invoice")
