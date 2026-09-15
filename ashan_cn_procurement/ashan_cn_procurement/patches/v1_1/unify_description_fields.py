"""Unify item explanations on the native ``description`` field.

The custom reimbursement child table previously used ``custom_spec_model``.
After its DocType metadata is synced, preserve existing values by copying them
to the new ``description`` column only when the new value is empty.
"""

import frappe
from frappe.database.schema import add_column


DESCRIPTION_DOCTYPES = (
    "Item",
    "Purchase Invoice Item",
    "Purchase Receipt Item",
    "Purchase Order Item",
    "Material Request Item",
)


def execute():
    for doctype in DESCRIPTION_DOCTYPES:
        frappe.make_property_setter(
            {
                "doctype": doctype,
                "fieldname": "description",
                "property": "fieldtype",
                "value": "Data",
                "property_type": "Select",
            },
            validate_fields_for_doctype=False,
        )

    child_table = frappe.qb.DocType("Reimbursement Invoice Item")
    if frappe.db.has_column("Reimbursement Invoice Item", "custom_spec_model"):
        if not frappe.db.has_column("Reimbursement Invoice Item", "description"):
            add_column("Reimbursement Invoice Item", "description", "Data")

        (
            frappe.qb.update(child_table)
            .set(child_table.description, child_table.custom_spec_model)
            .where((child_table.description.isnull()) | (child_table.description == ""))
            .where(child_table.custom_spec_model.isnotnull())
        ).run()
