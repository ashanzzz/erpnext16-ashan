# -*- coding: utf-8 -*-
import frappe

def execute():
    table_name = "tabReimbursement Request"
    if not frappe.db.has_column("Reimbursement Request", "amended_from"):
        frappe.db.sql("ALTER TABLE `tabReimbursement Request` ADD COLUMN amended_from VARCHAR(140) DEFAULT NULL")

    if not frappe.db.exists("DocField", {"parent": "Reimbursement Request", "fieldname": "amended_from"}):
        max_idx = frappe.db.sql("SELECT max(idx) FROM `tabDocField` WHERE parent='Reimbursement Request'")[0][0] or 24
        df = frappe.new_doc("DocField")
        df.parent = "Reimbursement Request"
        df.parentfield = "fields"
        df.parenttype = "DocType"
        df.fieldname = "amended_from"
        df.fieldtype = "Link"
        df.options = "Reimbursement Request"
        df.label = "Amended From"
        df.read_only = 1
        df.no_copy = 1
        df.print_hide = 1
        df.idx = max_idx + 1
        # AI-GOVERNANCE-EXCEPTION: patch execution needs ignore_permissions to register system schema field
        df.insert(ignore_permissions=True)

    frappe.db.sql("""
        UPDATE `tabDocPerm`
        SET `amend` = 1
        WHERE parent = 'Reimbursement Request'
          AND role IN ('System Manager', 'Procurement Manager', 'Purchase User')
    """)
    frappe.clear_cache(doctype="Reimbursement Request")
