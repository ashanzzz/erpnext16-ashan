# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import json
import frappe
from frappe.utils import flt, cint

from ashan_cn_procurement.services.property_settlement import (
	get_month_settlement_data,
	get_annual_lease_settlement_data,
	update_lease_invoice_link,
	save_draft_settlement,
	finalize_monthly_settlement,
	revert_settlement_to_draft,
	assert_property_settlement_access,
	calculate_settlement_matrix,
	export_lease_settlement_excel
)
from ashan_cn_procurement.services.authorization_service import assert_company_access, assert_module_access


@frappe.whitelist()
def get_annual_settlement(year=None):
	"""获取指定年度的房租与物业费年度结算及发票对账数据"""
	return get_annual_lease_settlement_data(year)


@frappe.whitelist(methods=["POST"])
def update_invoice_link(lease_name, rent_invoice_no=None, rent_invoice_date=None, rent_invoice_amount=None, rent_invoice_tax=None, property_fee_invoice_no=None, property_fee_invoice_date=None, property_fee_invoice_amount=None, property_fee_invoice_tax=None, annual_discount_amount=None):
	"""更新租约关联发票与开票对账"""
	return update_lease_invoice_link(
		lease_name=lease_name,
		rent_invoice_no=rent_invoice_no,
		rent_invoice_date=rent_invoice_date,
		rent_invoice_amount=rent_invoice_amount,
		rent_invoice_tax=rent_invoice_tax,
		property_fee_invoice_no=property_fee_invoice_no,
		property_fee_invoice_date=property_fee_invoice_date,
		property_fee_invoice_amount=property_fee_invoice_amount,
		property_fee_invoice_tax=property_fee_invoice_tax,
		annual_discount_amount=annual_discount_amount
	)


@frappe.whitelist()
def get_settlement(year, month):
	"""获取指定年月的房租与物业费月结数据"""
	return get_month_settlement_data(year, month)


@frappe.whitelist(methods=["POST"])
def save_settlement(data):
	"""保存房租与物业费草稿月结"""
	if isinstance(data, str):
		data = json.loads(data)
	return save_draft_settlement(data)


@frappe.whitelist(methods=["POST"])
def finalize_settlement(data):
	"""完成并锁定本月房租与物业费结算"""
	if isinstance(data, str):
		data = json.loads(data)
	return finalize_monthly_settlement(data)


@frappe.whitelist(methods=["POST"])
def revert_settlement(name, reason=None):
	"""取消结算并退回草稿"""
	return revert_settlement_to_draft(name, reason=reason)


@frappe.whitelist()
def get_company_bill_data(settlement_name, company):
	"""
	获取指定月结单中特定公司的房租与物业费结算单明细数据（用于弹窗预览与打印）
	"""
	doc = frappe.get_doc("Property Monthly Settlement", settlement_name)
	doc_dict = doc.as_dict()
	assert_module_access("property", "read")
	assert_company_access(company)
	assert_property_settlement_access(doc_dict, "read")
	calculate_settlement_matrix(doc_dict)

	company_leases = [
		l for l in doc_dict.get("lease_charges", [])
		if (l.get("company") if isinstance(l, dict) else l.company) == company
	]

	company_summary = next(
		(s for s in doc_dict.get("company_summaries", [])
		 if (s.get("company") if isinstance(s, dict) else s.company) == company),
		{}
	)

	return {
		"settlement_name": doc.name,
		"settlement_month": doc.settlement_month,
		"property_management_company": doc.property_management_company or "",
		"status": doc.status,
		"company": company,
		"is_total": False,
		"leases": company_leases,
		"summary": company_summary
	}


@frappe.whitelist()
def get_total_bill_data(settlement_name):
	"""
	获取全公司合计房租与物业费结算单数据
	"""
	doc = frappe.get_doc("Property Monthly Settlement", settlement_name)
	doc_dict = doc.as_dict()
	assert_property_settlement_access(doc_dict, "read")
	calculate_settlement_matrix(doc_dict)

	return {
		"settlement_name": doc.name,
		"settlement_month": doc.settlement_month,
		"property_management_company": doc.property_management_company or "",
		"status": doc.status,
		"company": "全公司合计",
		"is_total": True,
		"leases": doc_dict.get("lease_charges", []),
		"summary": {
			"rent_amount": doc.total_rent_amount,
			"property_fee_amount": doc.total_property_fee_amount,
			"total_amount": flt(doc.total_rent_amount) + flt(doc.total_property_fee_amount)
		}
	}
