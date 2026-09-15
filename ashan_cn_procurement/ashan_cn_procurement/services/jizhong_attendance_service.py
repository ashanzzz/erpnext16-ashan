# ASHAN-UNIFIED-V2: strict payroll attendance authorization and import integrity
# Copyright (c) 2026, Ashan CN Procurement
# 天津吉众科技有限公司 - 专有考勤工时解析与业务归集服务
# 1:1 对齐《202606吉众人事综合.xlsm》考勤.bas与《员工考勤表-*.xlsx》规范

import os
import re
import json
import calendar
import datetime
import openpyxl
import frappe
from frappe import _
from frappe.utils import flt, cint, getdate

from ashan_cn_procurement.services.ashan_holiday_service import (
	get_date_overtime_info,
	get_month_workdays,
)
from ashan_cn_procurement.services.authorization_service import assert_payroll_access
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission


JIZHONG_COMPANY = "天津吉众科技有限公司"


def _assert_jizhong_company(company, action):
	"""Enforce the dedicated Jizhong attendance company boundary."""
	company = str(company or "").strip()
	if company != JIZHONG_COMPANY:
		frappe.throw(
			f"吉众考勤服务只允许处理【{JIZHONG_COMPANY}】数据。",
			frappe.PermissionError,
		)
	return assert_payroll_access(action, company=company)


def _normalize_jizhong_period(period_month):
	"""Validate and normalize a Jizhong attendance period."""
	value = str(period_month or "").strip()
	if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
		frappe.throw("考勤账期格式必须为 YYYY-MM，例如 2026-07。")
	return value


def _jizhong_profile_doctype() -> str:
	"""Return the dedicated Jizhong profile DocType only."""
	doctype = "Jizhong Employee Salary Profile"
	if not frappe.db.table_exists(doctype):
		frappe.throw("吉众员工薪资档案模块未安装，不能回退到通用薪酬档案。")
	return doctype


def _is_jizhong_attendance_required(profile):
	"""Return whether a profile belongs in the monthly five-row attendance file."""
	get_value = profile.get if hasattr(profile, "get") else lambda key: getattr(profile, key, None)
	employee_type = str(get_value("employee_type") or "").strip()
	salary_mode = str(get_value("salary_mode") or "").strip()
	return not (
		employee_type in {"其他", "其他类型员工"}
		and salary_mode == "税后管理工资"
		and flt(get_value("base_salary")) <= 0
		and flt(get_value("fixed_salary")) > 0
	)


def _build_jizhong_day_nature_map(period_month):
	"""Build the authoritative work/rest and overtime multiplier map for a month."""
	year, month = (cint(part) for part in str(period_month).split("-"))
	day_map = {}
	for day in range(1, calendar.monthrange(year, month)[1] + 1):
		date_value = f"{year:04d}-{month:02d}-{day:02d}"
		nature = get_date_overtime_info(date_value)
		multiplier = flt(nature.get("rate_multiplier", 1.0))
		day_type = nature.get("day_type", "正常工作日")
		day_map[day] = {
			"day": day,
			"date": date_value,
			"day_type": day_type,
			"nature": day_type,
			"day_status": "班" if multiplier == 1.0 else "休",
			"rate_multiplier": multiplier,
			"multiplier": multiplier,
			"overtime_rate": nature.get("overtime_rate"),
			"can_compensate": nature.get("can_compensate", multiplier != 3.0),
			"can_compensate_leave": nature.get("can_compensate_leave"),
			"holiday_name": nature.get("holiday_name"),
			"is_legal_3x": multiplier >= 3.0,
			"is_weekend_2x": multiplier == 2.0,
			"is_regular_workday": multiplier == 1.0,
		}
	return day_map


def _enrich_jizhong_daily_records(raw_records, day_nature_map):
	"""Attach current calendar labels to persisted daily attendance values."""
	if isinstance(raw_records, str):
		try:
			raw_records = json.loads(raw_records)
		except (TypeError, ValueError, json.JSONDecodeError):
			return []
	if not isinstance(raw_records, list):
		return []

	enriched = []
	for raw_record in raw_records:
		if not isinstance(raw_record, dict):
			continue
		day = cint(raw_record.get("day"))
		day_info = day_nature_map.get(day)
		if not day_info:
			continue
		record = dict(raw_record)
		record.update(day_info)
		enriched.append(record)
	return enriched


def _attendance_coverage(company, period_month):
	"""Return attendance-file coverage and the excluded fixed-salary roster."""
	assert_doctype_permission(_jizhong_profile_doctype(), "read")
	profiles = frappe.get_list(
		_jizhong_profile_doctype(),
		filters={"company": company},
		or_filters=[
			{"employment_status": "在职"},
			{"employee_type": ["in", ["本月离职", "本月离职人员"]]},
		],
		fields=[
			"employee_no", "employee_name", "employee_type", "salary_mode",
			"base_salary", "fixed_salary",
		],
		order_by="employee_no asc",
		limit_page_length=0,
	)
	expected = {}
	excluded = {}
	for row in profiles:
		employee_no = str(row.employee_no or "").strip()
		if not employee_no:
			continue
		if _is_jizhong_attendance_required(row):
			expected[employee_no] = str(row.employee_name or "").strip()
		else:
			excluded[employee_no] = str(row.employee_name or "").strip()
	records = frappe.get_list(
		"Jizhong Monthly Attendance",
		filters={"company": company, "period_month": period_month},
		fields=["employee_no", "employee_name", "attendance_file"],
		order_by="employee_no asc",
		limit_page_length=0,
	)
	records_by_no = {}
	for record in records:
		employee_no = str(record.employee_no or "").strip()
		records_by_no.setdefault(employee_no, []).append(record)

	matched = set(expected) & set(records_by_no)
	missing = sorted(set(expected) - set(records_by_no))
	extra = sorted(set(records_by_no) - set(expected))
	name_mismatches = sorted(
		employee_no
		for employee_no in matched
		if str(records_by_no[employee_no][0].employee_name or "").strip()
		!= expected[employee_no]
	)
	duplicates = sorted(
		employee_no
		for employee_no, rows in records_by_no.items()
		if len(rows) > 1
	)
	missing_file = sorted(
		employee_no
		for employee_no in matched
		if not str(records_by_no[employee_no][0].attendance_file or "").strip()
	)
	file_urls = sorted({
		str(row.attendance_file).strip()
		for row in records
		if str(row.attendance_file or "").strip()
	})

	return {
		"expected_count": len(expected),
		"matched_count": len(matched),
		"excluded_count": len(excluded),
		"excluded_employee_nos": sorted(excluded),
		"excluded_employee_names": [excluded[employee_no] for employee_no in sorted(excluded)],
		"missing_employee_nos": missing,
		"extra_employee_nos": extra,
		"name_mismatches": name_mismatches,
		"duplicate_employee_nos": duplicates,
		"missing_file_employee_nos": missing_file,
		"attendance_file": file_urls[0] if file_urls else None,
		"complete": bool(expected or excluded)
		and len(matched) == len(expected)
		and not extra
		and not name_mismatches
		and not duplicates
		and not missing_file,
	}


@frappe.whitelist(methods=["POST"])
def upload_and_parse_attendance():
	"""
	接收前端上传的员工考勤表 Excel 文件并执行自动解析入库
	入参通过 frappe.form_dict 传入:
	  - file_url: 附件或上传文件地址 (或直接上传文件)
	  - period_month: 账期月份 (如 '2026-07')
	  - company: 公司名称 (默认 '天津吉众科技有限公司')
	"""
	company = frappe.form_dict.get("company") or JIZHONG_COMPANY
	_assert_jizhong_company(company, "write")
	assert_doctype_permission("Jizhong Monthly Attendance", "create")
	assert_doctype_permission("File", "create")
	period_month = _normalize_jizhong_period(frappe.form_dict.get("period_month"))
	file_url = frappe.form_dict.get("file_url")

	if not file_url and "file" in frappe.request.files:
		file_obj = frappe.request.files["file"]
		saved_file = frappe.get_doc({
			"doctype": "File",
			"file_name": file_obj.filename,
			"content": file_obj.read(),
			"is_private": 1,
			"attached_to_doctype": "Ashan Monthly Payroll Settlement",
			"attached_to_name": f"{company}-{period_month}" if period_month else company,
		})
		saved_file.insert()
		file_url = saved_file.file_url

	if not file_url:
		frappe.throw("请先选择或上传考勤 Excel 文件！")

	# 获取实际文件绝对路径
	file_doc = frappe.get_doc("File", {"file_url": file_url})
	file_doc.check_permission("read")
	local_path = file_doc.get_full_path()
	if not str(local_path).lower().endswith(".xlsx"):
	    frappe.throw("考勤导入仅支持 .xlsx 文件。")
	if os.path.getsize(local_path) > 20 * 1024 * 1024:
	    frappe.throw("考勤文件超过 20MB，请拆分或压缩后重新上传。")
	return parse_jizhong_attendance_file(local_path, period_month, company, file_url=file_url)


def parse_jizhong_attendance_file(file_path, period_month=None, company="天津吉众科技有限公司", file_url=None):
	"""
	核心考勤解析引擎：
	读取《员工考勤表-*.xlsx》，结合日历与倒休二倍工时冲抵算法，入库 Ashan Monthly Attendance
	"""
	_assert_jizhong_company(company, "write")
	assert_doctype_permission(_jizhong_profile_doctype(), "read")
	assert_doctype_permission("Jizhong Monthly Attendance", "create")
	assert_doctype_permission("Jizhong Monthly Attendance", "write")
	if not os.path.exists(file_path):
		frappe.throw(f"考勤文件不存在: {file_path}")

	wb = openpyxl.load_workbook(file_path, data_only=True)
	ws = wb["总表"] if "总表" in wb.sheetnames else wb.worksheets[0]

	# 1. 动态推断或核实年份与月份
	inferred_year = None
	inferred_month = None

	# 尝试从第一行大标题提取 "2026 年 7 月"
	title_val = str(ws.cell(1, 1).value or "")
	match = re.search(r"(\d{4})\s*年\s*(\d{1,2})\s*月", title_val)
	if match:
		inferred_year = cint(match.group(1))
		inferred_month = cint(match.group(2))
	elif period_month and "-" in period_month:
		parts = period_month.split("-")
		inferred_year = cint(parts[0])
		inferred_month = cint(parts[1])
	else:
		# 默认取当前日期
		today = getdate()
		inferred_year = today.year
		inferred_month = today.month

	formatted_period = f"{inferred_year:04d}-{inferred_month:02d}"
	if period_month and str(period_month).strip() != formatted_period:
	    frappe.throw(
	        f"考勤文件标题识别为 {formatted_period}，与当前选择账期 {period_month} 不一致。"
	    )
	period_month = _normalize_jizhong_period(formatted_period)
	# 2. 建立当月每日法定性质字典 (工作日, 周末, 调休日, 调班日, 法定节假日)
	day_nature_map = _build_jizhong_day_nature_map(formatted_period)
	days_in_month = len(day_nature_map)

	# 4. 建立在册员工映射 (姓名 -> employee_no)
	profile_doctype = _jizhong_profile_doctype()
	profiles = frappe.get_list(
		profile_doctype,
		filters={"company": company},
		or_filters=[
			{"employment_status": "在职"},
			{"employee_type": ["in", ["本月离职", "本月离职人员"]]},
		],
		fields=["name", "employee_no", "employee_name", "employee_type", "salary_mode", "base_salary", "post_allowance", "performance_base"],
		order_by="employee_no asc",
		limit_page_length=0,
	)
	name_to_emp = {}
	duplicate_names = set()
	for profile in profiles:
		name = str(profile.employee_name or "").strip()
		if name in name_to_emp:
			duplicate_names.add(name)
		else:
			name_to_emp[name] = profile
	if duplicate_names:
		frappe.throw(
			"吉众薪资档案存在重名员工，考勤文件仅按姓名无法安全匹配："
			+ "、".join(sorted(duplicate_names))
			+ "。请先修正档案或使用唯一姓名后再导入。"
		)

	# 5. 解析《总表》中的员工打卡记录
	# 寻找天数标题行
	days_col_start = 4 # 通常从第 D 列 (col=4) 开始为 1 日
	days_list = []
	days_header_row = 2
	for c in range(4, 40):
		val = ws.cell(days_header_row, c).value
		if val is not None and str(val).strip().isdigit():
			d_num = cint(str(val).strip())
			if 1 <= d_num <= days_in_month:
				days_list.append((c, d_num))

	parsed_results = []
	unmatched_names = []
	seen_employee_nos = set()
	total_regular_hours = 0.0
	total_ot_1_5 = 0.0
	total_ot_2_0 = 0.0
	total_ot_3_0 = 0.0
	total_compensatory = 0.0
	total_meals = 0

	r = 3
	while r <= ws.max_row:
		c1 = ws.cell(r, 1).value
		c2 = ws.cell(r, 2).value
		c3 = str(ws.cell(r, 3).value or "").strip()

		if c2 is not None and c3 == "班次":
			emp_name = str(c2).strip()
			emp_profile = name_to_emp.get(emp_name)
			
			if not emp_profile:
			    unmatched_names.append(emp_name)
			    r += 5
			    continue
			emp_no = emp_profile.employee_no
			if emp_no in seen_employee_nos:
				frappe.throw(f"考勤文件中员工【{emp_name}（{emp_no}）】重复出现，请修正后重新导入。")
			seen_employee_nos.add(emp_no)
			# 连续 5 行结构
			shifts_row = r
			work_row = r + 1
			ot_row = r + 2
			meal_row = r + 3
			remark_row = r + 4

			work_hours_sum = 0.0
			comp_leave_demand = 0.0
			ot_1_5_sum = 0.0
			weekend_ot_pool = 0.0
			holiday_ot_pool = 0.0
			meals_sum = 0
			full_days = 0
			half_days = 0
			absent_days = 0

			daily_records = []

			for col_idx, day_num in days_list:
				shift_val = ws.cell(shifts_row, col_idx).value
				cur_work = round(flt(ws.cell(work_row, col_idx).value or 0), 1)
				cur_ot = round(flt(ws.cell(ot_row, col_idx).value or 0), 1)
				cur_meal = cint(flt(ws.cell(meal_row, col_idx).value or 0))
				cur_remark = str(ws.cell(remark_row, col_idx).value or "").strip()

				day_info = day_nature_map.get(day_num, {})
				is_workday = day_info.get("is_regular_workday", True)
				is_weekend = day_info.get("is_weekend_2x", False)
				is_holiday = day_info.get("is_legal_3x", False)
				regular_work = min(cur_work, 8.0) if is_workday else 0.0
				derived_regular_ot = max(0.0, cur_work - 8.0) if is_workday else 0.0

				# 倒休工时与各倍率归集
				if is_workday:
					# 平日先计 8 小时正班；超过 8 小时的部分按 1.5 倍平日加班。
					work_hours_sum += regular_work
					if cur_work < 8.0:
						comp_leave_demand += (8.0 - cur_work)
					ot_1_5_sum += cur_ot + derived_regular_ot
				elif is_weekend:
					weekend_ot_pool += (cur_work + cur_ot)
				elif is_holiday:
					holiday_ot_pool += (cur_work + cur_ot)

				meals_sum += cur_meal

				# 考勤整天/半天/缺勤判断
				if cur_work >= 8.0:
					full_days += 1
				elif cur_work > 0:
					half_days += 1
				else:
					if is_workday:
						absent_days += 1

				daily_records.append({
					"day": day_num,
					"date": day_info.get("date", ""),
					"day_status": day_info.get("day_status", "班"),
					"rate_multiplier": flt(day_info.get("rate_multiplier", day_info.get("multiplier", 1.0))),
					"nature": day_info.get("nature", "工作日"),
					"overtime_rate": day_info.get("overtime_rate"),
					"shift": shift_val,
					"work_hours": cur_work,
					"regular_work_hours": regular_work,
					"overtime": cur_ot,
					"derived_overtime_1_5": derived_regular_ot,
					"meal": cur_meal,
					"remark": cur_remark,
				})

			# 执行 VBA 倒休二倍工时对冲抵扣
			# 实际倒休 = min(周末2倍工时池, 倒休需求)
			actual_compensatory = min(weekend_ot_pool, comp_leave_demand)
			net_weekend_ot_2_0 = round(weekend_ot_pool - actual_compensatory, 1)
			final_regular_hours = round(work_hours_sum + actual_compensatory, 1)
			ot_1_5_sum = round(ot_1_5_sum, 1)
			holiday_ot_pool = round(holiday_ot_pool, 1)
			actual_compensatory = round(actual_compensatory, 1)

			# 累加全局统计
			total_regular_hours += final_regular_hours
			total_ot_1_5 += ot_1_5_sum
			total_ot_2_0 += net_weekend_ot_2_0
			total_ot_3_0 += holiday_ot_pool
			total_compensatory += actual_compensatory
			total_meals += meals_sum

			# 写入或更新 Jizhong Monthly Attendance
			doc_name = f"{company}-{period_month}-{emp_no}"
			if frappe.db.exists("Jizhong Monthly Attendance", doc_name):
				att_doc = frappe.get_doc("Jizhong Monthly Attendance", doc_name)
			else:
				att_doc = frappe.new_doc("Jizhong Monthly Attendance")
				att_doc.company = company
				att_doc.period_month = period_month
				att_doc.employee_no = emp_no

			att_doc.employee_name = emp_name
			att_doc.attendance_days = full_days
			att_doc.half_days = half_days
			att_doc.absent_days = absent_days
			att_doc.work_hours_regular = final_regular_hours
			att_doc.overtime_regular_1_5 = ot_1_5_sum
			att_doc.overtime_weekend_2_0 = net_weekend_ot_2_0
			att_doc.overtime_holiday_3_0 = holiday_ot_pool
			att_doc.leave_compensatory_hours = actual_compensatory
			att_doc.meal_count = meals_sum
			att_doc.daily_records_json = json.dumps(daily_records, ensure_ascii=False)
			if file_url:
				att_doc.attendance_file = file_url

			att_doc.save()

			parsed_results.append({
				"employee_no": emp_no,
				"employee_name": emp_name,
				"attendance_days": full_days,
				"half_days": half_days,
				"absent_days": absent_days,
				"work_hours_regular": final_regular_hours,
				"overtime_regular_1_5": ot_1_5_sum,
				"overtime_weekend_2_0": net_weekend_ot_2_0,
				"overtime_holiday_3_0": holiday_ot_pool,
				"leave_compensatory_hours": actual_compensatory,
				"meal_count": meals_sum,
			})

			r += 5
		else:
			r += 1
	if unmatched_names:
	    frappe.throw(
	        "以下考勤姓名无法匹配吉众薪酬档案，已取消本次导入："
	        + "、".join(sorted(set(unmatched_names)))
	    )

	coverage = _attendance_coverage(company, period_month)
	if not coverage["complete"]:
		frappe.throw(
			"考勤导入未覆盖全部需要考勤的人员，已取消本次导入。"
			f"应计薪 {coverage['expected_count']} 人，已匹配 {coverage['matched_count']} 人。"
			f"无需上传考勤 {coverage['excluded_count']} 人。"
			f"缺失工号：{'、'.join(coverage['missing_employee_nos']) or '无'}；"
			f"多余工号：{'、'.join(coverage['extra_employee_nos']) or '无'}；"
			f"姓名不一致：{'、'.join(coverage['name_mismatches']) or '无'}；"
			f"重复记录：{'、'.join(coverage['duplicate_employee_nos']) or '无'}；"
			f"缺少原始文件关联：{'、'.join(coverage['missing_file_employee_nos']) or '无'}。"
		)

	return {
		"success": True,
		"period_month": period_month,
		"company": company,
		"employee_count": len(parsed_results),
		"total_regular_hours": round(total_regular_hours, 1),
		"total_ot_1_5": round(total_ot_1_5, 1),
		"total_ot_2_0": round(total_ot_2_0, 1),
		"total_ot_3_0": round(total_ot_3_0, 1),
		"total_compensatory": round(total_compensatory, 1),
		"total_meals": total_meals,
		"unmatched_names": unmatched_names,
		"items": parsed_results,
		"file_url": file_url,
	}


@frappe.whitelist()
def get_jizhong_attendance_table(company="天津吉众科技有限公司", period_month=None):
	"""
	获取指定期间吉众全员考勤大宽表与汇总数据
	"""
	_assert_jizhong_company(company, "read")
	assert_doctype_permission("Jizhong Monthly Attendance", "read")
	assert_doctype_permission(_jizhong_profile_doctype(), "read")
	if not period_month:
		# 默认获取最近一个有考勤的月份，若无取当前月
		latest = frappe.db.get_value(
			"Jizhong Monthly Attendance",
			{"company": company},
			"period_month",
			order_by="period_month desc"
		)
		period_month = latest or getdate().strftime("%Y-%m")
	period_month = _normalize_jizhong_period(period_month)
	coverage = _attendance_coverage(company, period_month)
	day_nature_map = _build_jizhong_day_nature_map(period_month)

	records = frappe.get_list(
		"Jizhong Monthly Attendance",
		filters={"company": company, "period_month": period_month},
		fields=[
			"name", "period_month", "company", "employee_no", "employee_name",
			"attendance_days", "half_days", "absent_days",
			"work_hours_regular", "overtime_regular_1_5", "overtime_weekend_2_0",
			"overtime_holiday_3_0", "leave_compensatory_hours", "meal_count",
			"attendance_file", "daily_records_json"
		],
		order_by="employee_no asc",
		limit_page_length=0,
	)
	for record in records:
		record.daily_records = _enrich_jizhong_daily_records(
			record.daily_records_json,
			day_nature_map,
		)

	# 汇总 KPI
	summary = {
		"period_month": period_month,
		"company": company,
		"employee_count": len(records),
		"total_work_hours": round(sum(flt(r.work_hours_regular) for r in records), 1),
		"total_ot_1_5": round(sum(flt(r.overtime_regular_1_5) for r in records), 1),
		"total_ot_2_0": round(sum(flt(r.overtime_weekend_2_0) for r in records), 1),
		"total_ot_3_0": round(sum(flt(r.overtime_holiday_3_0) for r in records), 1),
		"total_compensatory": round(sum(flt(r.leave_compensatory_hours) for r in records), 1),
		"total_meals": sum(cint(r.meal_count) for r in records),
		"attendance_file": records[0].attendance_file if records and records[0].attendance_file else None,
		"coverage": coverage,
	}

	return {
		"summary": summary,
		"calendar_days": list(day_nature_map.values()),
		"records": records,
	}


@frappe.whitelist(methods=["POST"])
def clear_jizhong_attendance_month(company="天津吉众科技有限公司", period_month=None):
	"""
	一键清空指定月份的吉众考勤工时记录，方便重新上传考勤 Excel
	"""
	period_month = _normalize_jizhong_period(period_month)
	_assert_jizhong_company(company, "write")
	assert_doctype_permission("Jizhong Monthly Attendance", "delete")

	# 检查月度薪酬核定是否已锁定
	settlement_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", settlement_name):
		is_locked = frappe.db.get_value("Ashan Monthly Payroll Settlement", settlement_name, "locked")
		if is_locked:
			frappe.throw(_("当前账期 {0} 已核定锁定，严禁清空考勤记录！如需重新上传请先在薪酬核定表解锁账期。").format(period_month))

	# 获取当前月份吉众考勤记录列表
	records = frappe.get_list(
		"Jizhong Monthly Attendance",
		filters={"company": company, "period_month": period_month},
		pluck="name",
		limit_page_length=0,
	)
	deleted_count = len(records)

	for name in records:
		frappe.delete_doc("Jizhong Monthly Attendance", name, force=True)
	return {
		"success": True,
		"deleted_count": deleted_count,
		"period_month": period_month,
		"company": company,
	}

