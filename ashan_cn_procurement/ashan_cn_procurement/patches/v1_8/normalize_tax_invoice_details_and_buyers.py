"""Move legacy vehicle-vessel tax into details and flag invalid tax-invoice buyers."""

import frappe
from frappe.utils import flt

from ashan_cn_procurement.services.tax_invoice_validation import (
	append_unique_warning,
	build_vehicle_vessel_tax_items,
	get_buyer_validation_error,
	normalize_buyer_name,
)


def _has_column(doctype, fieldname):
	"""Return whether a legacy column remains on the custom DocType table."""
	return bool(
		frappe.db.sql(
			f"SHOW COLUMNS FROM `tab{doctype}` LIKE %s", fieldname
		)
	)


def _clear_legacy_amount_columns():
	"""Clear deprecated parent and child amount columns after detail-row migration."""
	if _has_column("Tax Invoice", "vehicle_vessel_tax"):
		frappe.db.sql("UPDATE `tabTax Invoice` SET vehicle_vessel_tax = 0")
	if _has_column("Tax Invoice", "late_fee"):
		frappe.db.sql("UPDATE `tabTax Invoice` SET late_fee = 0")
	if _has_column("Tax Invoice Item", "vehicle_vessel_tax"):
		frappe.db.sql("UPDATE `tabTax Invoice Item` SET vehicle_vessel_tax = 0")
	if _has_column("Tax Invoice Item", "late_fee"):
		frappe.db.sql("UPDATE `tabTax Invoice Item` SET late_fee = 0")


def _clean_company_mappings():
	"""Remove historic aliases so only the two legal buyer titles may be mapped."""
	settings = frappe.get_single("Tax Invoice Settings")
	valid_mappings = []
	seen_buyer_names = set()
	for mapping in settings.get("company_mappings") or []:
		buyer_name = normalize_buyer_name(mapping.buyer_name)
		if get_buyer_validation_error(buyer_name) or buyer_name in seen_buyer_names:
			continue
		seen_buyer_names.add(buyer_name)
		valid_mappings.append({
			"company": mapping.company,
			"buyer_name": buyer_name,
			"buyer_tax_id": mapping.buyer_tax_id,
		})

	settings.set("company_mappings", valid_mappings)
	settings.save(ignore_permissions=True)


def _make_fallback_detail(invoice):
	"""Create a reviewable subtotal row when a historic invoice has no source items."""
	invoice.append("items", {
		"line_type": "普通",
		"item_name": "发票项目明细（待核对）",
		"amount": flt(invoice.amount_without_tax),
		"tax_amount": flt(invoice.tax_amount),
		"line_total": flt(invoice.invoice_grand_total),
		"source_note": "历史记录没有逐行项目，已自动补齐待复核汇总行。",
	})
	invoice.parse_status = "需复核"
	invoice.parse_warning = append_unique_warning(
		invoice.parse_warning, "历史记录没有逐行项目，已自动补齐待复核汇总行"
	)


def execute():
	"""Normalize all historic Tax Invoice records without deleting audit evidence."""
	if not frappe.db.exists("DocType", "Tax Invoice"):
		return

	tax_value_column = (
		"vehicle_vessel_tax" if _has_column("Tax Invoice", "vehicle_vessel_tax")
		else "0 AS vehicle_vessel_tax"
	)
	late_fee_column = (
		"late_fee" if _has_column("Tax Invoice", "late_fee") else "0 AS late_fee"
	)
	legacy_amounts = frappe.db.sql(
		f"""
			SELECT name, buyer_name, {tax_value_column}, {late_fee_column}
			FROM `tabTax Invoice`
			ORDER BY creation ASC, name ASC
		""",
		as_dict=True,
	)

	for legacy_row in legacy_amounts:
		invoice = frappe.get_doc("Tax Invoice", legacy_row.name)
		has_tax_detail = any(
			item.line_type == "车船税" for item in invoice.get("items") or []
		)
		if not has_tax_detail and (flt(legacy_row.vehicle_vessel_tax) or flt(legacy_row.late_fee)):
			invoice.extend("items", build_vehicle_vessel_tax_items({
				"vehicle_vessel_tax": flt(legacy_row.vehicle_vessel_tax),
				"late_fee": flt(legacy_row.late_fee),
			}))

		if not any(item.line_type != "车船税" for item in invoice.get("items") or []):
			_make_fallback_detail(invoice)

		buyer_error = get_buyer_validation_error(legacy_row.buyer_name)
		if buyer_error:
			invoice.company = None
			invoice.parse_status = "需复核"
			invoice.parse_warning = append_unique_warning(invoice.parse_warning, buyer_error)

		invoice.flags.ignore_links = True
		invoice.save(ignore_permissions=True)

	_clear_legacy_amount_columns()
	_clean_company_mappings()
	frappe.db.commit()
