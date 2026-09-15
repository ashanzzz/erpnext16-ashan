"""Replace historic PDF line-item average splits with source-faithful details."""

import frappe
from frappe.utils import flt

from ashan_cn_procurement.parser.pdf_parser import parse_tax_invoice_pdf
from ashan_cn_procurement.services.tax_invoice_validation import append_unique_warning


def _is_legacy_equal_split(invoice):
	"""Return whether a PDF invoice used the retired equal-split fallback."""
	items = invoice.get("items") or []
	if len(items) < 2:
		return False

	amounts = {round(flt(item.amount), 2) for item in items}
	taxes = {round(flt(item.tax_amount), 2) for item in items}
	totals = {round(flt(item.line_total), 2) for item in items}
	return len(amounts) == 1 and len(taxes) == 1 and len(totals) == 1


def _read_source_pdf(invoice):
	"""Read the retained private PDF source for a historic invoice."""
	if not invoice.invoice_pdf or invoice.pdf_removed:
		return None

	file_name = frappe.db.get_value("File", {"file_url": invoice.invoice_pdf}, "name")
	if not file_name:
		return None
	return frappe.get_doc("File", file_name).get_content()


def _replace_items_from_pdf(invoice, parsed):
	"""Replace only the historic synthetic rows, keeping invoice audit fields intact."""
	invoice.set("items", [])
	invoice.extend("items", parsed.get("items") or [])
	invoice.parser_version = parsed.get("parser_version") or invoice.parser_version
	invoice.parse_status = parsed.get("parse_status") or invoice.parse_status
	parsed_warning = parsed.get("parse_warning")
	if parsed_warning:
		invoice.parse_warning = append_unique_warning(invoice.parse_warning, parsed_warning)
	elif invoice.parse_warning and "禁止平均分摊" in invoice.parse_warning:
		invoice.parse_warning = None


def execute():
	"""Reparse old PDF invoices instead of retaining equal-split financial details."""
	if not frappe.db.exists("DocType", "Tax Invoice"):
		return

	invoice_names = frappe.get_all(
		"Tax Invoice",
		filters={"parser_source": "PDF"},
		pluck="name",
		order_by="creation ASC, name ASC",
	)
	for invoice_name in invoice_names:
		invoice = frappe.get_doc("Tax Invoice", invoice_name)
		if not _is_legacy_equal_split(invoice):
			continue

		pdf_bytes = _read_source_pdf(invoice)
		if not pdf_bytes:
			continue
		parsed = parse_tax_invoice_pdf(pdf_bytes, invoice.original_filename or invoice.name)
		if not parsed.get("ok") or not parsed.get("items"):
			continue
		if parsed.get("invoice_no") != invoice.invoice_no:
			frappe.log_error(
				f"PDF reparse invoice number mismatch: {invoice.name}",
				"Tax Invoice PDF Detail Reparse",
			)
			continue

		_replace_items_from_pdf(invoice, parsed)
		invoice.flags.ignore_links = True
		invoice.save(ignore_permissions=True)

	frappe.db.commit()
