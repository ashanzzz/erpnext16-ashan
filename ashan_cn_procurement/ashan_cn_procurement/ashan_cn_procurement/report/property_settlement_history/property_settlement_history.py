# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe import _


def execute(filters=None):
	filters = filters or {}
	columns = get_columns()
	data = get_data(filters)
	return columns, data


def get_columns():
	return [
		{"label": _("结算月份"), "fieldname": "settlement_month", "fieldtype": "Date", "width": 110},
		{"label": _("状态"), "fieldname": "status", "fieldtype": "Data", "width": 90},
		{"label": _("结算公司"), "fieldname": "company", "fieldtype": "Link", "options": "Company", "width": 160},
		{"label": _("房租金额"), "fieldname": "rent_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("物业费金额"), "fieldname": "property_fee_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("核定电量(kWh)"), "fieldname": "electricity_usage", "fieldtype": "Float", "width": 120},
		{"label": _("电费金额"), "fieldname": "electricity_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("核定水量(m³)"), "fieldname": "water_usage", "fieldtype": "Float", "width": 110},
		{"label": _("水费金额"), "fieldname": "water_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("调整金额"), "fieldname": "adjustment_amount", "fieldtype": "Currency", "width": 110},
		{"label": _("本月应付总额"), "fieldname": "total_amount", "fieldtype": "Currency", "width": 130},
		{"label": _("月结单号"), "fieldname": "settlement_name", "fieldtype": "Link", "options": "Property Monthly Settlement", "width": 160},
	]


def get_data(filters):
	conditions = ["s.docstatus < 2"]
	values = {}

	if filters.get("from_month"):
		conditions.append("s.settlement_month >= %(from_month)s")
		values["from_month"] = filters.get("from_month")

	if filters.get("to_month"):
		conditions.append("s.settlement_month <= %(to_month)s")
		values["to_month"] = filters.get("to_month")

	if filters.get("status"):
		conditions.append("s.status = %(status)s")
		values["status"] = filters.get("status")

	if filters.get("company"):
		conditions.append("c.company = %(company)s")
		values["company"] = filters.get("company")

	where_clause = " AND ".join(conditions)

	sql = f"""
		SELECT
			s.settlement_month,
			s.status,
			c.company,
			c.rent_amount,
			c.property_fee_amount,
			c.electricity_usage,
			c.electricity_amount,
			c.water_usage,
			c.water_amount,
			c.adjustment_amount,
			c.total_amount,
			s.name as settlement_name
		FROM `tabProperty Company Settlement Summary` c
		JOIN `tabProperty Monthly Settlement` s ON c.parent = s.name
		WHERE {where_clause}
		ORDER BY s.settlement_month DESC, c.company ASC
	"""

	return frappe.db.sql(sql, values, as_dict=True)
