# ASHAN-COMPLETE: special-equipment quick actions respect native DocPerm
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import cstr, cint, flt, getdate, nowdate
from frappe import _
from ashan_cn_procurement.services.special_equipment import (
	sync_inspection_snapshot,
	sync_annual_check_snapshot,
	calculate_days_remaining,
	calculate_expiry_status
)
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission
from ashan_cn_procurement.services.authorization_service import (
	assert_company_access,
	assert_module_access,
	get_allowed_companies,
)


@frappe.whitelist()
def get_dashboard_data(company=None, category=None, equipment_status=None, inspection_status=None, annual_status=None, search_text=None):
	"""
	获取特种设备管理工作台全量聚合数据与过滤列表
	"""
	assert_doctype_permission("Special Equipment", "read")
	assert_module_access("compliance", "read")
	allowed_companies = get_allowed_companies()
	if company:
		assert_company_access(company)
	company_filters = {"name": ["in", sorted(allowed_companies)]} if allowed_companies is not None else {}
	companies = frappe.get_all("Company", filters=company_filters, fields=["name", "company_name"], order_by="name asc")
	categories = [
		"场（厂）内专用机动车辆",
		"起重机械",
		"压力容器",
		"锅炉",
		"压力管道",
		"电梯",
		"其他"
	]

	# 2. 统计 KPI（按当前所选公司统计在用设备）
	kpi_filters = {}
	if company:
		kpi_filters["company"] = company
	elif allowed_companies is not None:
		kpi_filters["company"] = ["in", sorted(allowed_companies)]

	all_equipments = frappe.get_list(
		"Special Equipment",
		filters=kpi_filters,
		fields=[
			"name", "equipment_status", "inspection_status", "annual_check_status",
			"inspection_days_remaining", "annual_days_remaining"
		]
	)

	total_count = len(all_equipments)
	active_count = sum(1 for e in all_equipments if e.equipment_status == "在用")
	
	insp_expiring_60 = sum(
		1 for e in all_equipments
		if e.equipment_status == "在用" and e.inspection_status in ["注意", "即将到期", "今日到期"]
	)
	annual_expiring_60 = sum(
		1 for e in all_equipments
		if e.equipment_status == "在用" and e.annual_check_status in ["注意", "即将到期", "今日到期"]
	)
	insp_overdue = sum(
		1 for e in all_equipments
		if e.equipment_status == "在用" and e.inspection_status == "已逾期"
	)
	annual_overdue = sum(
		1 for e in all_equipments
		if e.equipment_status == "在用" and e.annual_check_status == "已逾期"
	)

	# 3. 构造设备列表过滤条件
	list_filters = {}
	if company:
		list_filters["company"] = company
	elif allowed_companies is not None:
		list_filters["company"] = ["in", sorted(allowed_companies)]
	if category:
		list_filters["equipment_category"] = category
	if equipment_status and equipment_status != "全部":
		list_filters["equipment_status"] = equipment_status
	if inspection_status and inspection_status != "全部":
		list_filters["inspection_status"] = inspection_status
	if annual_status and annual_status != "全部":
		list_filters["annual_check_status"] = annual_status

	fields = [
		"name", "company", "equipment_name", "equipment_category", "equipment_variety",
		"product_name", "product_model", "equipment_status", "responsible_person", "use_location",
		"registration_code", "equipment_code", "plate_number", "internal_number",
		"use_registration_certificate_no", "product_serial_number", "frame_number",
		"latest_inspection_date", "inspection_due_date_precision", "inspection_valid_until",
		"inspection_valid_until_month", "inspection_reminder_due_date", "inspection_days_remaining",
		"inspection_status", "latest_inspection_report_no", "latest_inspection_attachment",
		"latest_annual_check_date", "annual_check_due_date", "annual_days_remaining",
		"annual_check_status", "latest_annual_check_attachment", "registration_certificate_attachment"
	]

	equipments = frappe.get_list(
		"Special Equipment",
		filters=list_filters,
		fields=fields,
		order_by="creation desc"
	)

	# 4. 内存级关键词全文搜索（支持车牌、内部编号、设备名称、注册代码、设备代码、登记证号）
	if search_text:
		st = search_text.strip().lower()
		filtered = []
		for e in equipments:
			targets = [
				cstr(e.plate_number).lower(),
				cstr(e.internal_number).lower(),
				cstr(e.equipment_name).lower(),
				cstr(e.registration_code).lower(),
				cstr(e.equipment_code).lower(),
				cstr(e.use_registration_certificate_no).lower(),
				cstr(e.responsible_person).lower(),
			]
			if any(st in t for t in targets):
				filtered.append(e)
		equipments = filtered

	# 格式化展示文本
	for e in equipments:
		# 法定检验展示文案
		if e.inspection_due_date_precision == "仅到月份" and e.inspection_valid_until_month:
			e["inspection_display_due"] = f"{e.inspection_valid_until_month} (基准: {e.inspection_reminder_due_date or ''})"
		else:
			e["inspection_display_due"] = str(e.inspection_valid_until) if e.inspection_valid_until else "未录入"

		e["annual_display_due"] = str(e.annual_check_due_date) if e.annual_check_due_date else "未录入"

	return {
		"kpis": {
			"total_count": total_count,
			"active_count": active_count,
			"insp_expiring_60": insp_expiring_60,
			"annual_expiring_60": annual_expiring_60,
			"insp_overdue": insp_overdue,
			"annual_overdue": annual_overdue,
		},
		"equipments": equipments,
		"companies": companies,
		"categories": categories,
	}


@frappe.whitelist(methods=["POST"])
def quick_create_equipment(
	company, equipment_name, equipment_category="场（厂）内专用机动车辆",
	equipment_variety=None, plate_number=None, internal_number=None,
	registration_code=None, equipment_code=None, use_registration_certificate_no=None,
	use_location=None
):
	"""
	单页极速新建特种设备档案 (取消责任人，保留地点)
	"""
	assert_doctype_permission("Special Equipment", "create")
	if not equipment_name:
		frappe.throw(_("设备名称为必填项！"))
	if not company:
		frappe.throw(_("所属公司为必填项！"))
	assert_module_access("compliance", "write", company)

	doc = frappe.new_doc("Special Equipment")
	doc.company = company
	doc.equipment_name = equipment_name.strip()
	doc.equipment_category = equipment_category or "场（厂）内专用机动车辆"
	doc.equipment_variety = equipment_variety.strip() if equipment_variety else ""
	doc.plate_number = plate_number.strip() if plate_number else ""
	doc.internal_number = internal_number.strip() if internal_number else ""
	doc.registration_code = registration_code.strip() if registration_code else ""
	doc.equipment_code = equipment_code.strip() if equipment_code else ""
	doc.use_registration_certificate_no = use_registration_certificate_no.strip() if use_registration_certificate_no else ""
	doc.use_location = use_location.strip() if use_location else ""
	doc.equipment_status = "在用"
	doc.inspection_status = "待录入"
	doc.annual_check_status = "待检查"
	doc.insert()

	return {
		"status": "ok",
		"message": f"特种设备【{doc.plate_number or doc.internal_number or doc.equipment_name}】已成功创建！",
		"name": doc.name
	}


@frappe.whitelist(methods=["POST"])
def quick_add_inspection(special_equipment, inspection_date, valid_until=None, inspection_type="定期检验", inspection_report_no=None, inspection_report_attachment=None, inspection_agency=None):
	"""
	弹窗极速录入法定检验记录（默认有效2年）
	"""
	assert_doctype_permission("Special Equipment Inspection", "create")
	if not special_equipment or not frappe.db.exists("Special Equipment", special_equipment):
		frappe.throw(_("未找到对应的特种设备！"))
	if not inspection_date:
		frappe.throw(_("检验日期为必填项！"))

	from frappe.utils import add_to_date, getdate
	# 若未填截止日，默认 2 年 (24个月)
	if not valid_until:
		valid_until = add_to_date(getdate(inspection_date), years=2)

	company = frappe.db.get_value("Special Equipment", special_equipment, "company")
	assert_module_access("compliance", "write", company)

	doc = frappe.new_doc("Special Equipment Inspection")
	doc.special_equipment = special_equipment
	doc.company = company
	doc.inspection_type = inspection_type or "定期检验"
	doc.inspection_date = inspection_date
	doc.inspection_result = "合格"
	doc.due_date_precision = "精确日期"
	doc.valid_until = valid_until
	doc.inspection_report_no = inspection_report_no.strip() if inspection_report_no else ""
	doc.inspection_agency = inspection_agency.strip() if inspection_agency else ""
	doc.inspection_report_attachment = inspection_report_attachment or None
	doc.insert()

	sync_inspection_snapshot(special_equipment)

	return {
		"status": "ok",
		"message": f"法定检验记录【{doc.inspection_report_no or doc.name}】已成功录入并同步至主档！",
		"name": doc.name
	}


@frappe.whitelist(methods=["POST"])
def quick_add_annual_inspection(special_equipment, check_date, next_check_date=None, check_result="合格", annual_check_attachment=None, remarks=None):
	"""
	弹窗极速录入年度检查记录（默认有效1年）
	"""
	assert_doctype_permission("Special Equipment Annual Inspection", "create")
	if not special_equipment or not frappe.db.exists("Special Equipment", special_equipment):
		frappe.throw(_("未找到对应的特种设备！"))
	if not check_date:
		frappe.throw(_("年度检查日期为必填项！"))

	from frappe.utils import add_to_date, getdate
	# 若未填下次检查日，默认 1 年 (12个月)
	if not next_check_date:
		next_check_date = add_to_date(getdate(check_date), years=1)

	company = frappe.db.get_value("Special Equipment", special_equipment, "company")
	assert_module_access("compliance", "write", company)
	c_year = getdate(check_date).year

	doc = frappe.new_doc("Special Equipment Annual Inspection")
	doc.special_equipment = special_equipment
	doc.company = company
	doc.inspection_year = c_year
	doc.check_date = check_date
	doc.check_result = check_result or "合格"
	doc.next_check_date = next_check_date
	doc.annual_check_attachment = annual_check_attachment or None
	doc.remarks = remarks.strip() if remarks else ""
	doc.insert()

	sync_annual_check_snapshot(special_equipment)

	return {
		"status": "ok",
		"message": f"年度自查记录【{doc.name}】已成功录入并同步至主档！",
		"name": doc.name
	}
