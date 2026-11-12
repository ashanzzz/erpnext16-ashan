# -*- coding: utf-8 -*-
import frappe

def execute():
    """Solidify concise Chinese naming series across procurement, accounting, and inventory."""
    series_rules = {
        'Purchase Order': 'CG-.#####',
        'Purchase Invoice': 'FP-.#####',
        'Purchase Receipt': 'RK-.#####',
        'Material Request': 'SQ-.#####',
        'Payment Entry': 'FK-.#####',
        'Stock Entry': 'CK-.#####',
        'Journal Entry': 'PZ-.#####',
        'Sales Invoice': 'XS-.#####',
        'Delivery Note': 'FH-.#####',
    }

    for dt, prefix in series_rules.items():
        if not frappe.db.exists('DocType', dt):
            continue
        ps_name = frappe.db.get_value('Property Setter', {'doc_type': dt, 'field_name': 'naming_series', 'property': 'options'})
        if ps_name:
            frappe.db.set_value('Property Setter', ps_name, 'value', prefix)
        else:
            ps = frappe.get_doc({
                'doctype': 'Property Setter',
                'doc_type': dt,
                'doctype_or_field': 'DocField',
                'field_name': 'naming_series',
                'property': 'options',
                'value': prefix,
                'property_type': 'Text'
            })
            ps.insert(ignore_permissions=True)

        ps_def = frappe.db.get_value('Property Setter', {'doc_type': dt, 'field_name': 'naming_series', 'property': 'default'})
        if ps_def:
            frappe.db.set_value('Property Setter', ps_def, 'value', prefix)
        else:
            ps = frappe.get_doc({
                'doctype': 'Property Setter',
                'doc_type': dt,
                'doctype_or_field': 'DocField',
                'field_name': 'naming_series',
                'property': 'default',
                'value': prefix,
                'property_type': 'Text'
            })
            ps.insert(ignore_permissions=True)

    if frappe.db.exists('DocType', 'Reimbursement Request'):
        frappe.db.set_value('DocType', 'Reimbursement Request', 'autoname', 'BX-.#####')

    # Initialize counters in tabSeries if not existing
    for prefix in ['CG-', 'FP-', 'BX-', 'RK-', 'SQ-', 'FK-', 'CK-', 'PZ-', 'WL-', 'XS-', 'FH-']:
        if not frappe.db.sql('SELECT name FROM tabSeries WHERE name = %s', (prefix,)):
            frappe.db.sql('INSERT INTO tabSeries (name, current) VALUES (%s, 0)', (prefix,))
