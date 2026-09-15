"""Keep Purchase Invoice Item layout in one maintainable server-side definition."""

import frappe


DESCRIPTION_DOCTYPES = (
    "Item",
    "Purchase Invoice Item",
    "Purchase Receipt Item",
    "Purchase Order Item",
    "Material Request Item",
)

# These are the fields ERPNext 16 itself marks hidden.  The previous custom
# script hid every other standard field, which made the row editor incomplete.
ERPNext_NATIVE_HIDDEN_FIELDS = {
    "image",
    "brand",
    "pricing_rules",
    "item_tax_rate",
    "item_tax_amount",
    "is_fixed_asset",
    "po_detail",
    "pr_detail",
    "valuation_rate",
    "rm_supp_cost",
}

# Only these fields are compact grid columns.  Other native fields remain
# available in the standard row editor instead of being hidden by client JS.
GRID_COLUMNS = (
    "item_code",
    "description",
    "qty",
    "custom_gross_rate",
    "custom_tax_rate",
    "rate",
    "amount",
    "custom_tax_amount",
    "custom_gross_amount",
)

FIELD_LABELS = {
    "item_code": "物料编码",
    "description": "规格",
    "uom": "单位",
    "qty": "数量",
    "rate": "不含税单价",
    "amount": "总金额（未税）",
    "custom_tax_rate": "税率（%）",
    "custom_gross_rate": "含税单价",
    "custom_tax_amount": "税额",
    "custom_gross_amount": "价税合计",
    "custom_line_remark": "备注",
}


def execute():
    _set_description_labels()
    _restore_native_row_editor()
    _configure_grid_columns()
    _configure_custom_fields()
    frappe.clear_cache(doctype="Purchase Invoice Item")


def _set_description_labels():
    for doctype in DESCRIPTION_DOCTYPES:
        frappe.make_property_setter(
            {
                "doctype": doctype,
                "fieldname": "description",
                "property": "label",
                "value": "规格",
                "property_type": "Data",
            },
            validate_fields_for_doctype=False,
        )

    reimbursement = frappe.get_doc("DocType", "Reimbursement Invoice Item")
    field = next((field for field in reimbursement.fields if field.fieldname == "description"), None)
    if field and field.label != "规格":
        field.label = "规格"
        reimbursement.save()


def _restore_native_row_editor():
    doctype_doc = frappe.get_doc("DocType", "Purchase Invoice Item")
    for field in doctype_doc.fields:
        if not field.fieldname:
            continue
        field.hidden = int(field.fieldname in ERPNext_NATIVE_HIDDEN_FIELDS)
    doctype_doc.save()


def _configure_grid_columns():
    doctype_doc = frappe.get_doc("DocType", "Purchase Invoice Item")
    for field in doctype_doc.fields:
        if field.fieldname:
            field.in_list_view = int(field.fieldname in GRID_COLUMNS)
            if field.fieldname in FIELD_LABELS:
                field.label = FIELD_LABELS[field.fieldname]
    doctype_doc.save()


def _configure_custom_fields():
    custom_fields = frappe.get_all(
        "Custom Field",
        filters={"dt": "Purchase Invoice Item"},
        pluck="name",
    )
    for name in custom_fields:
        field = frappe.get_doc("Custom Field", name)
        field.in_list_view = int(field.fieldname in GRID_COLUMNS)
        if field.fieldname in FIELD_LABELS:
            field.label = FIELD_LABELS[field.fieldname]
        if field.fieldname == "custom_tax_basis":
            field.hidden = 1
        field.save()
