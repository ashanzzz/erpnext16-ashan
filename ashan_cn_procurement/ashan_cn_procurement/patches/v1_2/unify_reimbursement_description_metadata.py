"""Move the reimbursement child-table explanation to ``description``.

Custom DocTypes do not automatically accept a fieldname rename from their JSON
export.  Apply the same metadata change through the normal DocType document
lifecycle, then preserve historical values from the legacy physical column.
"""

import frappe
from frappe.database.schema import add_column


DOCTYPE = "Reimbursement Invoice Item"
LEGACY_FIELDNAME = "custom_spec_model"
DESCRIPTION_FIELDNAME = "description"


def execute():
    if not frappe.db.has_column(DOCTYPE, DESCRIPTION_FIELDNAME):
        add_column(DOCTYPE, DESCRIPTION_FIELDNAME, "Data")

    doctype_doc = frappe.get_doc("DocType", DOCTYPE)
    legacy_field = next(
        (field for field in doctype_doc.fields if field.fieldname == LEGACY_FIELDNAME),
        None,
    )
    if legacy_field:
        legacy_field.fieldname = DESCRIPTION_FIELDNAME
        legacy_field.label = "规格"
        legacy_field.fieldtype = "Data"
        doctype_doc.save()

    if frappe.db.has_column(DOCTYPE, LEGACY_FIELDNAME):
        child_table = frappe.qb.DocType(DOCTYPE)
        (
            frappe.qb.update(child_table)
            .set(child_table.description, child_table.custom_spec_model)
            .where((child_table.description.isnull()) | (child_table.description == ""))
            .where(child_table.custom_spec_model.isnotnull())
        ).run()

    frappe.clear_cache(doctype=DOCTYPE)
