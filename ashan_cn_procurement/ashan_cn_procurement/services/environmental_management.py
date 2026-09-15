# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_months, getdate, nowdate, date_diff, cint


def calculate_env_days_remaining(due_date):
	"""计算到期剩余天数 (正数为剩余，0为今天，负数为逾期)"""
	if not due_date:
		return 0
	return date_diff(getdate(due_date), getdate(nowdate()))


def calculate_env_status(days_remaining):
	"""
	根据剩余天数划定状态阶梯:
	> 60天: 正常
	31 ~ 60天: 注意
	1 ~ 30天: 即将到期
	0天: 今日到期
	< 0天: 已逾期
	"""
	if days_remaining > 60:
		return "正常"
	elif 31 <= days_remaining <= 60:
		return "注意"
	elif 1 <= days_remaining <= 30:
		return "即将到期"
	elif days_remaining == 0:
		return "今日到期"
	else:
		return "已逾期"


def calc_next_due_date(last_done_date, cycle_months):
	"""
	精准使用原生 add_months 递推下次检测/处理日期
	例如:
	2026-01-31 + 1m = 2026-02-28
	2026-08-31 + 6m = 2027-02-28
	2024-02-29 + 12m = 2025-02-28
	"""
	if not last_done_date or not cycle_months or cint(cycle_months) <= 0:
		return None
	return add_months(getdate(last_done_date), cint(cycle_months))


def refresh_all_environmental_status():
	"""
	每日后台定时任务：扫描所有启用的环保事项，刷新剩余天数与预警状态
	"""
	items = frappe.get_all(
		"Environmental Compliance Item",
		filters={"is_active": 1},
		fields=["name", "last_done_date", "cycle_months", "next_due_date", "days_remaining", "status"]
	)

	for it in items:
		doc = frappe.get_doc("Environmental Compliance Item", it.name)
		doc.calculate_due_and_status()
		if doc.has_value_changed("days_remaining") or doc.has_value_changed("status"):
			doc.flags.ignore_validate = True
			doc.save(ignore_permissions=True)

	frappe.db.commit()
