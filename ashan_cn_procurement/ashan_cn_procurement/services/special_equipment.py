# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, nowdate, cstr, cint
from frappe import _


def calculate_days_remaining(due_date):
	"""
	计算目标到期日与当前日期的天数差 (支持 Date 或 YYYY-MM-DD 字符串)
	"""
	if not due_date:
		return None
	try:
		target_d = getdate(due_date)
		today_d = getdate(nowdate())
		return (target_d - today_d).days
	except Exception:
		return None


def calculate_expiry_status(days_remaining):
	"""
	统一到期状态计算逻辑：
	> 60天   -> 正常
	31~60天 -> 注意
	1~30天  -> 即将到期
	0天     -> 今日到期
	< 0天   -> 已逾期
	"""
	if days_remaining is None:
		return "待录入"
	days = cint(days_remaining)
	if days > 60:
		return "正常"
	elif 31 <= days <= 60:
		return "注意"
	elif 1 <= days <= 30:
		return "即将到期"
	elif days == 0:
		return "今日到期"
	else:
		return "已逾期"


def sync_inspection_snapshot(equipment_name):
	"""
	重新查询指定特种设备的所有法定检验记录，提取最新一条并同步到主档快照。
	若无记录，重置为待录入。
	"""
	if not equipment_name or not frappe.db.exists("Special Equipment", equipment_name):
		return

	inspections = frappe.get_all(
		"Special Equipment Inspection",
		filters={"special_equipment": equipment_name},
		fields=[
			"name", "inspection_type", "inspection_date", "inspection_result",
			"inspection_report_no", "due_date_precision", "valid_until",
			"valid_until_month", "reminder_due_date", "inspection_report_attachment"
		],
		order_by="inspection_date desc, creation desc",
		limit=1
	)

	if inspections:
		latest = inspections[0]
		target_date = latest.valid_until if latest.due_date_precision == "精确日期" else latest.reminder_due_date
		days = calculate_days_remaining(target_date)
		status = calculate_expiry_status(days) if target_date else "待录入"

		frappe.db.set_value(
			"Special Equipment",
			equipment_name,
			{
				"latest_inspection_type": latest.inspection_type or "",
				"latest_inspection_date": latest.inspection_date,
				"inspection_due_date_precision": latest.due_date_precision or "精确日期",
				"inspection_valid_until": latest.valid_until,
				"inspection_valid_until_month": latest.valid_until_month or "",
				"inspection_reminder_due_date": latest.reminder_due_date,
				"inspection_days_remaining": days,
				"inspection_status": status,
				"latest_inspection_report_no": latest.inspection_report_no or "",
				"latest_inspection_attachment": latest.inspection_report_attachment or "",
			},
			update_modified=True
		)
	else:
		# 无历史检验记录，清空快照
		frappe.db.set_value(
			"Special Equipment",
			equipment_name,
			{
				"latest_inspection_type": "",
				"latest_inspection_date": None,
				"inspection_due_date_precision": "精确日期",
				"inspection_valid_until": None,
				"inspection_valid_until_month": "",
				"inspection_reminder_due_date": None,
				"inspection_days_remaining": 0,
				"inspection_status": "待录入",
				"latest_inspection_report_no": "",
				"latest_inspection_attachment": "",
			},
			update_modified=True
		)


def sync_annual_check_snapshot(equipment_name):
	"""
	重新查询指定特种设备的所有年度检查记录，提取最新一条并同步到主档快照。
	若无记录，重置为待检查。
	"""
	if not equipment_name or not frappe.db.exists("Special Equipment", equipment_name):
		return

	annual_checks = frappe.get_all(
		"Special Equipment Annual Inspection",
		filters={"special_equipment": equipment_name},
		fields=[
			"name", "inspection_year", "check_date", "check_result",
			"next_check_date", "annual_check_attachment"
		],
		order_by="check_date desc, creation desc",
		limit=1
	)

	if annual_checks:
		latest = annual_checks[0]
		days = calculate_days_remaining(latest.next_check_date)
		status = calculate_expiry_status(days) if latest.next_check_date else "待检查"

		frappe.db.set_value(
			"Special Equipment",
			equipment_name,
			{
				"latest_annual_check_date": latest.check_date,
				"annual_check_due_date": latest.next_check_date,
				"annual_days_remaining": cint(days),
				"annual_check_status": status,
				"latest_annual_check_attachment": latest.annual_check_attachment or "",
			},
			update_modified=True
		)
	else:
		# 无历史检查记录，清空快照
		frappe.db.set_value(
			"Special Equipment",
			equipment_name,
			{
				"latest_annual_check_date": None,
				"annual_check_due_date": None,
				"annual_days_remaining": 0,
				"annual_check_status": "待检查",
				"latest_annual_check_attachment": "",
			},
			update_modified=True
		)



def refresh_all_special_equipment_status():
	"""
	每日定时任务 (Daily Scheduler)：
	1. 遍历所有在用状态的特种设备；
	2. 刷新最新法定检验与年度检查剩余天数及状态；
	3. 针对临期/逾期设备触发防重复 ToDo 待办提醒。
	"""
	equipments = frappe.get_all(
		"Special Equipment",
		filters={"equipment_status": "在用"},
		fields=["name", "company", "equipment_name", "plate_number", "internal_number", "responsible_person"]
	)

	for eq in equipments:
		sync_inspection_snapshot(eq.name)
		sync_annual_check_snapshot(eq.name)
		create_expiry_reminders(eq.name)


def create_expiry_reminders(equipment_name):
	"""
	针对临期/逾期特种设备生成 ToDo 待办提醒（具有严格的唯一性防重复机制）
	档位：60天、30天、7天、1天、已逾期
	"""
	doc = frappe.get_doc("Special Equipment", equipment_name)
	if doc.equipment_status != "在用":
		return

	identifier = doc.plate_number or doc.internal_number or doc.equipment_name or doc.name
	assigned_user = None
	if doc.responsible_person:
		assigned_user = frappe.db.get_value("Employee", doc.responsible_person, "user_id")
	if not assigned_user:
		# 兜底指派给系统管理员或创建人
		assigned_user = doc.owner or "Administrator"

	# 1. 检查法定检验提醒
	if doc.inspection_status in ["注意", "即将到期", "今日到期", "已逾期"] and (doc.inspection_valid_until or doc.inspection_reminder_due_date):
		due = str(doc.inspection_valid_until or doc.inspection_reminder_due_date)
		days = doc.inspection_days_remaining
		tier = get_reminder_tier(days)
		if tier:
			todo_desc = f"【特种设备法定检验提醒】设备【{identifier}】法定检验将在 {days} 天后到期（截止：{due}，档位：{tier}），请及时安排报检！"
			if days < 0:
				todo_desc = f"【特种设备法定检验逾期警报】设备【{identifier}】法定检验已逾期 {abs(days)} 天（截止：{due}），请立即停止使用并处理！"

			_create_unique_todo(doc.name, "法定检验", due, tier, todo_desc, assigned_user)

	# 2. 检查年度检查提醒
	if doc.annual_check_status in ["注意", "即将到期", "今日到期", "已逾期"] and doc.annual_check_due_date:
		due = str(doc.annual_check_due_date)
		days = doc.annual_days_remaining
		tier = get_reminder_tier(days)
		if tier:
			todo_desc = f"【特种设备年度检查提醒】设备【{identifier}】年度自查将在 {days} 天后到期（截止：{due}，档位：{tier}），请组织自查！"
			if days < 0:
				todo_desc = f"【特种设备年度检查逾期警报】设备【{identifier}】年度自查已逾期 {abs(days)} 天（截止：{due}），请立即补检！"

			_create_unique_todo(doc.name, "年度检查", due, tier, todo_desc, assigned_user)


def get_reminder_tier(days):
	if days is None:
		return None
	d = cint(days)
	if d <= 0:
		return "已逾期/今日到期"
	elif 1 <= d <= 7:
		return "7天内紧急"
	elif 8 <= d <= 30:
		return "30天内临期"
	elif 31 <= d <= 60:
		return "60天内预警"
	return None


def _create_unique_todo(equipment_name, check_type, due_date, tier, description, allocated_to):
	"""
	防重复创建 ToDo：根据 (reference_type, reference_name, check_type, due_date, tier) 确保同一周期同档位只生成一条
	"""
	flag_tag = f"[{check_type}|{due_date}|{tier}]"

	existing = frappe.db.exists(
		"ToDo",
		{
			"reference_type": "Special Equipment",
			"reference_name": equipment_name,
			"description": ["like", f"%{flag_tag}%"],
			"status": ["in", ["Open", "Pending"]]
		}
	)

	if not existing:
		todo = frappe.new_doc("ToDo")
		todo.reference_type = "Special Equipment"
		todo.reference_name = equipment_name
		todo.allocated_to = allocated_to
		todo.description = f"{description} <!-- {flag_tag} -->"
		todo.priority = "High" if tier in ["已逾期/今日到期", "7天内紧急"] else "Medium"
		todo.insert(ignore_permissions=True)
