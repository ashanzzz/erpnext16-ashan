"""Mark open Qifu payroll periods stale after correcting the payment-month rule."""

import frappe
from frappe.utils import cint


QIFU_COMPANY = "天津祺富机械加工有限公司"
LOCKED_STATUSES = {"已核定锁定", "已归档发放", "Locked", "Submitted"}


def execute():
	"""Queue every open Qifu settlement; sealed snapshots remain immutable."""
	if not frappe.db.exists("DocType", "Ashan Monthly Payroll Settlement"):
		return

	from ashan_cn_procurement.services.employee_salary_service import (
		_queue_salary_recalculation,
	)

	rows = frappe.get_all(
		"Ashan Monthly Payroll Settlement",
		filters={"company": QIFU_COMPANY},
		fields=["period_month", "locked", "status"],
		order_by="period_month asc",
	)
	for row in rows:
		if cint(row.get("locked")) or row.get("status") in LOCKED_STATUSES:
			continue
		_queue_salary_recalculation(
			QIFU_COMPANY,
			row.get("period_month"),
			None,
			"住房公积金台账与配置",
			trigger_detail="公积金季度规则已改为按实际缴费月判断，需重算未封账期。",
		)
	frappe.db.commit()
