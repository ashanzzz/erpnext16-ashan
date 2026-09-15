"""Business-boundary validation helpers for tax-invoice buyers and line items."""

import re

import frappe


BUYER_VALIDATION_ERROR_MARKER = "【购买方错误】"
STALE_COMPANY_MAPPING_WARNING_PHRASES = (
	"购买方公司未能自动匹配",
	"购买方已校验，但未配置所属 ERP 公司映射",
)


def normalize_buyer_name(buyer_name):
	"""Normalize a buyer name without weakening the legal-entity comparison."""
	return re.sub(r"\s+", "", str(buyer_name or "")).strip()


def get_configured_tax_invoice_buyers():
	"""Return the exact buyer names configured in Tax Invoice Settings.

	The mapping table is the sole source of truth.  It makes supported legal
	entities configurable per deployment and avoids source-code company lists.
	"""
	settings = frappe.get_single("Tax Invoice Settings")
	return sorted({
		normalize_buyer_name(row.buyer_name)
		for row in (settings.get("company_mappings") or [])
		if normalize_buyer_name(row.buyer_name) and row.company
	})


def get_buyer_validation_error(buyer_name):
	"""Return a user-facing error when the buyer is outside configured entities."""
	normalized_name = normalize_buyer_name(buyer_name)
	if not normalized_name:
		return f"{BUYER_VALIDATION_ERROR_MARKER} 购买方名称为空，无法匹配所属公司。"
	allowed_names = get_configured_tax_invoice_buyers()
	if not allowed_names:
		return f"{BUYER_VALIDATION_ERROR_MARKER} 尚未在税局发票设置中配置购买方与公司映射。"
	if normalized_name not in allowed_names:
		return (
			f"{BUYER_VALIDATION_ERROR_MARKER} 购买方“{normalized_name}”未配置所属 ERP 公司映射。"
		)
	return ""


def is_allowed_tax_invoice_buyer(buyer_name):
	"""Return whether a buyer is one of the configured legal entities."""
	return not get_buyer_validation_error(buyer_name)


def has_buyer_validation_error(parse_warning):
	"""Return whether an invoice warning carries the deterministic buyer-error marker."""
	return BUYER_VALIDATION_ERROR_MARKER in (parse_warning or "")


def append_unique_warning(existing_warning, warning):
	"""Append a warning once while preserving earlier parser and audit messages."""
	parts = [part.strip() for part in (existing_warning or "").split(";") if part.strip()]
	if warning and warning not in parts:
		parts.append(warning)
	return "; ".join(parts)


def remove_stale_company_mapping_warnings(existing_warning, company):
	"""Remove only obsolete mapping warnings after a company has been resolved."""
	if not str(company or "").strip():
		return (existing_warning or "").strip(), False

	kept_parts = []
	removed = False
	for part in [part.strip() for part in (existing_warning or "").split(";") if part.strip()]:
		if any(phrase in part for phrase in STALE_COMPANY_MAPPING_WARNING_PHRASES):
			removed = True
			continue
		kept_parts.append(part)
	return "; ".join(kept_parts), removed


def build_vehicle_vessel_tax_items(remark_data):
	"""Build tax charges as invoice-detail rows, never as parent-level charges."""
	remark_data = remark_data or {}
	vehicle_vessel_tax = float(remark_data.get("vehicle_vessel_tax") or 0)
	late_fee = float(remark_data.get("late_fee") or 0)
	tax_period = remark_data.get("tax_period") or ""
	plate_number = remark_data.get("plate_number") or ""
	source_note = f"所属期: {tax_period or '—'}"
	items = []

	if vehicle_vessel_tax:
		items.append({
			"line_type": "车船税",
			"item_name": "代收车船税",
			"spec_model": tax_period,
			"unit": "辆",
			"quantity": 1.0,
			"unit_price": vehicle_vessel_tax,
			"amount": vehicle_vessel_tax,
			"tax_rate_text": "不征税",
			"tax_amount": 0.0,
			"line_total": vehicle_vessel_tax,
			"plate_number": plate_number,
			"vehicle_type": None,
			"passage_start": None,
			"passage_end": None,
			"source_note": source_note,
		})

	if late_fee:
		items.append({
			"line_type": "车船税",
			"item_name": "车船税滞纳金",
			"spec_model": tax_period,
			"unit": "笔",
			"quantity": 1.0,
			"unit_price": late_fee,
			"amount": late_fee,
			"tax_rate_text": "不征税",
			"tax_amount": 0.0,
			"line_total": late_fee,
			"plate_number": plate_number,
			"vehicle_type": None,
			"passage_start": None,
			"passage_end": None,
			"source_note": f"{source_note}；车船税滞纳金",
		})

	return items
