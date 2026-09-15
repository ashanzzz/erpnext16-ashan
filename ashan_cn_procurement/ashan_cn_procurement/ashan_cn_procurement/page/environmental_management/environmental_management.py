# ASHAN-COMPLETE: compliance capability and native DocType permission alignment
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import add_months, getdate, nowdate, date_diff, cint
from ashan_cn_procurement.services.authorization_service import (
	assert_company_access,
	assert_module_access,
	can_module_access,
	get_allowed_companies,
)


def _assert_env_permission(permission, doc=None, company=None):
	"""Apply both the compliance module policy and native DocType permission."""
	ptype = str(permission or "read").strip().lower()
	if ptype not in {"read", "create", "write", "delete"}:
		frappe.throw(f"未知环保权限动作：{ptype}", frappe.PermissionError)
	target_company = getattr(doc, "company", None) if doc else company
	assert_module_access("compliance", "read" if ptype == "read" else "write", target_company)
	if doc:
		doc.check_permission(ptype)
	elif not frappe.has_permission("Environmental Compliance Item", ptype):
		frappe.throw(f"当前账号没有环保事项的 {ptype} 权限。", frappe.PermissionError)


@frappe.whitelist()
def get_environmental_dashboard_data(tab_type="inspection", company=None, status=None, search_text=None):
	"""
	获取环保管理工作台看板数据（按 Tab 隔离，包含 KPI 统计与紧急度排序明细）
	tab_type: 'waste' (危废管理) | 'inspection' (环保定期检测)
	"""
	assert_module_access("compliance", "read")
	tab_type = tab_type or "inspection"
	if company and company != "全部":
		assert_company_access(company)
	allowed_companies = get_allowed_companies()

	# 1. 构造基础过滤条件
	base_filters = {"is_active": 1}
	if company and company != "全部":
		base_filters["company"] = company
	elif allowed_companies is not None:
		base_filters["company"] = ["in", sorted(allowed_companies)]
	if tab_type == "waste":
		base_filters["env_type"] = "危废"
	else:
		base_filters["env_type"] = ["!=", "危废"]

	# 读取当前 Tab 下所有有效记录（用于计算 KPI 统计）
	all_tab_items = frappe.get_list(
		"Environmental Compliance Item",
		filters=base_filters,
		fields=[
			"name", "title", "company", "env_type", "last_done_date",
			"cycle_months", "next_due_date", "days_remaining", "status",
			"latest_report", "responsible_person", "use_location", "remarks", "is_active"
		]
	)

	# 确保内存中数据刷新为最新状态
	today = getdate(nowdate())
	can_write = frappe.has_permission("Environmental Compliance Item", "write")
	for item in all_tab_items:
		item.can_write = can_write
		if item.last_done_date and item.cycle_months and cint(item.cycle_months) > 0:
			item.next_due_date = add_months(getdate(item.last_done_date), cint(item.cycle_months))

		if item.next_due_date:
			item.days_remaining = date_diff(getdate(item.next_due_date), today)
			if item.days_remaining > 60:
				item.status = "正常"
			elif 31 <= item.days_remaining <= 60:
				item.status = "注意"
			elif 1 <= item.days_remaining <= 30:
				item.status = "即将到期"
			elif item.days_remaining == 0:
				item.status = "今日到期"
			else:
				item.status = "已逾期"
		else:
			item.days_remaining = 0
			item.status = "正常"

	# 2. KPI 统计计算
	overdue_count = sum(1 for it in all_tab_items if it.status == "已逾期")
	upcoming_count = sum(1 for it in all_tab_items if it.status in ["即将到期", "今日到期"])
	normal_count = sum(1 for it in all_tab_items if it.status in ["正常", "注意"])
	total_count = len(all_tab_items)

	# 顶部醒目提示条
	if overdue_count > 0:
		banner_type = "danger"
		unit_name = "危废转移事项" if tab_type == "waste" else "环保检测事项"
		banner_msg = f"当前有 {overdue_count} 项{unit_name}已经逾期，请立即安排处理。"
	elif upcoming_count > 0:
		banner_type = "warning"
		unit_name = "危废转移" if tab_type == "waste" else "环保检测"
		banner_msg = f"近期 30 天内有 {upcoming_count} 项{unit_name}即将到期，请提前做好准备。"
	else:
		banner_type = "success"
		banner_msg = "当前所有事项均在正常周期内，暂无临期风险。"

	# 3. 应用前端交互筛选 (公司 / 状态 / 搜索词)
	filtered_items = all_tab_items
	if company and company != "全部":
		filtered_items = [it for it in filtered_items if it.company == company]

	if status and status != "全部":
		if status == "即将到期":
			filtered_items = [it for it in filtered_items if it.status in ["即将到期", "今日到期"]]
		elif status == "正常":
			filtered_items = [it for it in filtered_items if it.status in ["正常", "注意"]]
		else:
			filtered_items = [it for it in filtered_items if it.status == status]

	if search_text:
		st = search_text.strip().lower()
		filtered_items = [
			it for it in filtered_items
			if st in (it.title or "").lower()
			or st in (it.responsible_person or "").lower()
			or st in (it.use_location or "").lower()
			or st in (it.company or "").lower()
		]

	# 4. 紧急度自上而下排序
	# 状态优先级权重：已逾期(0) -> 今日到期(1) -> 即将到期(2) -> 注意(3) -> 正常(4)
	status_weight = {
		"已逾期": 0,
		"今日到期": 1,
		"即将到期": 2,
		"注意": 3,
		"正常": 4
	}

	def sort_key(item):
		sw = status_weight.get(item.status, 99)
		due_str = str(item.next_due_date or "9999-12-31")
		return (sw, due_str)

	filtered_items.sort(key=sort_key)

	# 5. 获取所有可用公司列表
	company_filters = {"name": ["in", sorted(allowed_companies)]} if allowed_companies is not None else {}
	companies = frappe.get_all("Company", filters=company_filters, fields=["name"], order_by="name ASC")
	company_list = [c.name for c in companies]

	return {
		"tab_type": tab_type,
		"kpi": {
			"total": total_count,
			"overdue": overdue_count,
			"upcoming": upcoming_count,
			"normal": normal_count
		},
		"banner": {
			"type": banner_type,
			"message": banner_msg
		},
		"items": filtered_items,
		"companies": company_list,
		"can_create": bool(can_module_access("compliance", "write") and frappe.has_permission("Environmental Compliance Item", "create"))
	}


@frappe.whitelist(methods=["POST"])
def quick_create_env_item(
	title,
	company,
	env_type,
	last_done_date,
	cycle_months,
	reminder_days=30,
	responsible_person=None,
	use_location=None,
	remarks=None,
	latest_report=None
):
	"""
	弹窗快捷新增环保/危废事项
	"""
	if not title:
		frappe.throw("事项名称不能为空")
	if not company:
		frappe.throw("请选择所属公司")
	if not env_type:
		frappe.throw("请选择类型")
	if not last_done_date:
		frappe.throw("请填写上次检测/处理日期")
	if not cycle_months or cint(cycle_months) <= 0:
		frappe.throw("周期必须为大于 0 的月数")
	_assert_env_permission("create", company=company)
	assert_company_access(company)

	doc = frappe.new_doc("Environmental Compliance Item")
	doc.title = title
	doc.company = company
	doc.env_type = env_type
	doc.last_done_date = last_done_date
	doc.cycle_months = cint(cycle_months)
	doc.reminder_days = cint(reminder_days) or 30
	doc.responsible_person = responsible_person
	doc.use_location = use_location
	doc.remarks = remarks
	doc.latest_report = latest_report
	doc.is_active = 1

	doc.insert()
	return {
		"success": True,
		"name": doc.name,
		"message": f"环保事项「{doc.title}」已成功创建！"
	}


@frappe.whitelist(methods=["POST"])
def quick_update_env_item(
	name,
	title,
	company,
	env_type,
	last_done_date,
	cycle_months,
	reminder_days=30,
	responsible_person=None,
	use_location=None,
	remarks=None,
	is_active=1
):
	"""
	弹窗快捷编辑环保/危废事项
	"""
	doc = frappe.get_doc("Environmental Compliance Item", name)
	_assert_env_permission("write", doc)
	assert_company_access(doc.company)
	if company != doc.company:
		assert_company_access(company)
	doc.title = title
	doc.company = company
	doc.env_type = env_type
	doc.last_done_date = last_done_date
	doc.cycle_months = cint(cycle_months)
	doc.reminder_days = cint(reminder_days) or 30
	doc.responsible_person = responsible_person
	doc.use_location = use_location
	doc.remarks = remarks
	doc.is_active = cint(is_active)

	doc.save()
	return {
		"success": True,
		"name": doc.name,
		"message": f"环保事项「{doc.title}」已更新！"
	}


@frappe.whitelist(methods=["POST"])
def record_env_action(name, action_date, cycle_months=None, latest_report=None, remarks=None):
	"""
	弹窗登记本次检测 / 本次危废处理
	更新 last_done_date，重算 next_due_date 并刷新状态
	"""
	if not action_date:
		frappe.throw("请填写本次检测/处理日期")

	doc = frappe.get_doc("Environmental Compliance Item", name)
	_assert_env_permission("write", doc)
	assert_company_access(doc.company)
	doc.last_done_date = action_date

	if cycle_months and cint(cycle_months) > 0:
		doc.cycle_months = cint(cycle_months)

	if latest_report:
		doc.latest_report = latest_report

	if remarks:
		if doc.remarks:
			doc.remarks = f"{doc.remarks}\n[{action_date}] {remarks}"
		else:
			doc.remarks = f"[{action_date}] {remarks}"

	doc.save()
	return {
		"success": True,
		"name": doc.name,
		"next_due_date": str(doc.next_due_date),
		"message": f"已成功登记本次处理，下次到期日为：{doc.next_due_date}"
	}


@frappe.whitelist(methods=["POST"])
def upload_env_report(name, latest_report):
	"""
	弹窗快速上传/补录检测报告或转移凭证
	"""
	if not latest_report:
		frappe.throw("请选择要上传的文件")

	doc = frappe.get_doc("Environmental Compliance Item", name)
	_assert_env_permission("write", doc)
	assert_company_access(doc.company)
	doc.latest_report = latest_report
	doc.save()

	return {
		"success": True,
		"name": doc.name,
		"message": "报告附件上传成功！"
	}
