"""Resolve only historic tax-invoice review flags that are now demonstrably stale."""

import frappe

from ashan_cn_procurement.services.tax_invoice_validation import (
	get_buyer_validation_error,
	remove_stale_company_mapping_warnings,
)


def _has_active_pdf(invoice):
	"""Return whether the historic invoice still retains its original PDF evidence."""
	return bool(invoice.invoice_pdf and not invoice.pdf_removed)


def _has_detail_rows(invoice):
	"""Return whether the historic invoice has at least one structured line item."""
	return bool(invoice.get("items") or [])


def execute():
	"""Clear stale company-mapping review flags without overriding real review causes."""
	if not frappe.db.exists("DocType", "Tax Invoice"):
		return

	invoice_names = frappe.get_all(
		"Tax Invoice",
		filters={"parse_status": "需复核"},
		pluck="name",
		order_by="creation ASC, name ASC",
	)
	for invoice_name in invoice_names:
		invoice = frappe.get_doc("Tax Invoice", invoice_name)
		if get_buyer_validation_error(invoice.buyer_name):
			continue
		if not (invoice.company and _has_active_pdf(invoice) and _has_detail_rows(invoice)):
			continue

		updated_warning, removed = remove_stale_company_mapping_warnings(
			invoice.parse_warning, invoice.company
		)
		if not removed:
			continue

		invoice.parse_warning = updated_warning or None
		if not updated_warning:
			invoice.parse_status = "已解析"
		invoice.flags.ignore_links = True
		invoice.save(ignore_permissions=True)

	frappe.db.commit()
