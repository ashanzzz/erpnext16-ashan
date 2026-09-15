# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import json
import frappe
from frappe.utils import flt, cint

from ashan_cn_procurement.services.property_settlement import (
	get_month_settlement_data,
	save_draft_settlement,
	finalize_monthly_settlement,
	revert_settlement_to_draft,
	assert_property_settlement_access,
	export_utility_settlement_excel
)
from ashan_cn_procurement.services.authorization_service import assert_company_access, assert_module_access


@frappe.whitelist()
def get_settlement(year, month):
	"""获取指定年月的水电费月结数据"""
	return get_month_settlement_data(year, month)


@frappe.whitelist(methods=["POST"])
def save_settlement(data):
	"""保存水电费草稿月结"""
	if isinstance(data, str):
		data = json.loads(data)
	return save_draft_settlement(data)


@frappe.whitelist(methods=["POST"])
def finalize_settlement(data):
	"""完成并锁定本月水电费结算"""
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
	获取指定月结单中特定公司的水电费结算单明细数据（用于弹窗预览与打印）
	"""
	doc = frappe.get_doc("Property Monthly Settlement", settlement_name)
	doc_dict = doc.as_dict()
	assert_module_access("property", "read")
	assert_company_access(company)
	assert_property_settlement_access(doc_dict, "read")

	company_meters = [
		m for m in doc_dict.get("meter_readings", [])
		if (m.get("company") if isinstance(m, dict) else m.company) == company
	]

	company_adjustments = []
	for adj in doc_dict.get("adjustments", []):
		u_type = adj.get("utility_type") if isinstance(adj, dict) else adj.utility_type
		if u_type not in ["电费", "电", "水费", "水"]:
			continue

		adj_scope = adj.get("adjustment_scope") if isinstance(adj, dict) else adj.adjustment_scope
		adj_comp = adj.get("company") if isinstance(adj, dict) else adj.company
		adj_from = adj.get("from_company") if isinstance(adj, dict) else adj.from_company
		adj_to = adj.get("to_company") if isinstance(adj, dict) else adj.to_company
		adj_type = adj.get("adjustment_type") if isinstance(adj, dict) else adj.adjustment_type
		u_adj = adj.get("usage_adjustment") if isinstance(adj, dict) else adj.usage_adjustment
		amt_adj = adj.get("amount_adjustment") if isinstance(adj, dict) else adj.amount_adjustment
		eq_u = adj.get("equivalent_usage") if isinstance(adj, dict) else adj.equivalent_usage
		reason = adj.get("reason") if isinstance(adj, dict) else adj.reason

		if adj_scope == "单公司" and adj_comp == company:
			company_adjustments.append({
				"title": f"{u_type}调整",
				"type": adj_type,
				"scope": "本公司单项调整",
				"usage": u_adj,
				"amount": amt_adj,
				"reason": reason
			})
		elif adj_scope == "公司间转移":
			if adj_from == company:
				company_adjustments.append({
					"title": f"公司间{u_type}调出 (转至 {adj_to})",
					"type": adj_type,
					"scope": "公司间转出",
					"usage": -flt(eq_u),
					"amount": -flt(amt_adj),
					"reason": reason
				})
			elif adj_to == company:
				company_adjustments.append({
					"title": f"公司间{u_type}调入 (来自 {adj_from})",
					"type": adj_type,
					"scope": "公司间转入",
					"usage": flt(eq_u),
					"amount": flt(amt_adj),
					"reason": reason
				})

	summary = next((s for s in doc_dict.get("company_summaries", []) if (s.get("company") if isinstance(s, dict) else s.company) == company), None)

	return {
		"settlement_name": doc.name,
		"settlement_month": doc.settlement_month,
		"property_management_company": doc.property_management_company or "",
		"status": doc.status,
		"company": company,
		"electricity_price": doc.electricity_price,
		"water_price": doc.water_price,
		"meters": company_meters,
		"adjustments": company_adjustments,
		"summary": summary
	}


@frappe.whitelist()
def get_total_bill_data(settlement_name):
	"""
	获取全公司合计水电费结算单数据
	"""
	doc = frappe.get_doc("Property Monthly Settlement", settlement_name)
	doc_dict = doc.as_dict()
	assert_property_settlement_access(doc_dict, "read")

	total_adjs = []
	for adj in doc_dict.get("adjustments", []):
		u_type = adj.get("utility_type") if isinstance(adj, dict) else adj.utility_type
		if u_type not in ["电费", "电", "水费", "水"]:
			continue
		adj_scope = adj.get("adjustment_scope") if isinstance(adj, dict) else adj.adjustment_scope
		if adj_scope == "单公司":
			total_adjs.append({
				"title": f"{u_type}调整",
				"type": adj.get("adjustment_type") if isinstance(adj, dict) else adj.adjustment_type,
				"usage": adj.get("usage_adjustment") if isinstance(adj, dict) else adj.usage_adjustment,
				"amount": adj.get("amount_adjustment") if isinstance(adj, dict) else adj.amount_adjustment,
				"reason": adj.get("reason") if isinstance(adj, dict) else adj.reason
			})

	return {
		"settlement_name": doc.name,
		"settlement_month": doc.settlement_month,
		"property_management_company": doc.property_management_company or "",
		"status": doc.status,
		"company": "全公司合计",
		"is_total": True,
		"electricity_price": doc.electricity_price,
		"water_price": doc.water_price,
		"meters": doc_dict.get("meter_readings", []),
		"adjustments": total_adjs,
		"summary": {
			"electricity_usage": doc.total_electricity_usage,
			"electricity_amount": doc.total_electricity_amount,
			"water_usage": doc.total_water_usage,
			"water_amount": doc.total_water_amount,
			"total_amount": flt(doc.total_electricity_amount) + flt(doc.total_water_amount)
		}
	}
