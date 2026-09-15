# Copyright (c) 2026, Ashan CN Procurement
# 国务院关于修改《全国年节及纪念日放假办法》最新法定标准与日历服务 (2025年起法定节假日增至13天)

import json
import calendar
import datetime
import frappe
from frappe.utils import flt, cint, getdate, add_days, date_diff

# 内置国家国务院法定节假日与调休补班官方标准模板 (2025, 2026, 2027)
# 严格按照国务院2024年11月修改《全国年节及纪念日放假办法》：
# 法定节假日共 13 天 (元旦1天、春节4天除夕至初三、清明1天、五一2天5.1~5.2、端午1天、中秋1天、国庆3天10.1~10.3)
# 🔴 法定 3 倍工资日：法律强制支付 300% 加班工资，绝对不可倒休/补休替代！
# 🔵 普通公休日/调休放假：支付 200% 加班工资，企业可优先安排倒休/补休。

NATIONAL_HOLIDAY_TEMPLATES = {
	2026: [
		{
			"holiday_name": "元旦",
			"start_date": "2026-01-01",
			"end_date": "2026-01-03",
			"days_count": 3,
			"legal_holiday_dates": "2026-01-01",
			"legal_days_count": 1,
			"shift_work_dates": "2026-01-04",
			"remarks": ""
		},
		{
			"holiday_name": "春节",
			"start_date": "2026-02-15",
			"end_date": "2026-02-23",
			"days_count": 9,
			"legal_holiday_dates": "2026-02-15, 2026-02-16, 2026-02-17, 2026-02-18",
			"legal_days_count": 4,
			"shift_work_dates": "2026-02-08, 2026-02-28",
			"remarks": ""
		},
		{
			"holiday_name": "清明节",
			"start_date": "2026-04-04",
			"end_date": "2026-04-06",
			"days_count": 3,
			"legal_holiday_dates": "2026-04-05",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": ""
		},
		{
			"holiday_name": "劳动节",
			"start_date": "2026-05-01",
			"end_date": "2026-05-05",
			"days_count": 5,
			"legal_holiday_dates": "2026-05-01, 2026-05-02",
			"legal_days_count": 2,
			"shift_work_dates": "2026-04-26, 2026-05-09",
			"remarks": ""
		},
		{
			"holiday_name": "端午节",
			"start_date": "2026-06-19",
			"end_date": "2026-06-21",
			"days_count": 3,
			"legal_holiday_dates": "2026-06-19",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": ""
		},
		{
			"holiday_name": "中秋节",
			"start_date": "2026-09-25",
			"end_date": "2026-09-27",
			"days_count": 3,
			"legal_holiday_dates": "2026-09-25",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": ""
		},
		{
			"holiday_name": "国庆节",
			"start_date": "2026-10-01",
			"end_date": "2026-10-07",
			"days_count": 7,
			"legal_holiday_dates": "2026-10-01, 2026-10-02, 2026-10-03",
			"legal_days_count": 3,
			"shift_work_dates": "2026-09-20, 2026-10-10",
			"remarks": ""
		}
	],
	2025: [
		{
			"holiday_name": "元旦",
			"start_date": "2025-01-01",
			"end_date": "2025-01-01",
			"days_count": 1,
			"legal_holiday_dates": "2025-01-01",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": "1月1日(周三)放假1天，法定3倍工资日。"
		},
		{
			"holiday_name": "春节",
			"start_date": "2025-01-28",
			"end_date": "2025-02-04",
			"days_count": 8,
			"legal_holiday_dates": "2025-01-28, 2025-01-29, 2025-01-30, 2025-01-31",
			"legal_days_count": 4,
			"shift_work_dates": "2025-01-26, 2025-02-08",
			"remarks": "1月28日(除夕)至2月4日(初七)放假共8天。1月28~31日为法定3倍工资日。1月26日、2月8日上班。"
		},
		{
			"holiday_name": "清明节",
			"start_date": "2025-04-04",
			"end_date": "2025-04-06",
			"days_count": 3,
			"legal_holiday_dates": "2025-04-04",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": "4月4日(周五)至4月6日(周日)放假，4月4日为法定3倍工资日。"
		},
		{
			"holiday_name": "劳动节",
			"start_date": "2025-05-01",
			"end_date": "2025-05-05",
			"days_count": 5,
			"legal_holiday_dates": "2025-05-01, 2025-05-02",
			"legal_days_count": 2,
			"shift_work_dates": "2025-04-27, 2025-05-10",
			"remarks": "5月1日(周四)至5月5日(周一)放假共5天。5月1日、2日为法定3倍工资日。4月27日、5月10日上班。"
		},
		{
			"holiday_name": "端午节",
			"start_date": "2025-05-31",
			"end_date": "2025-06-02",
			"days_count": 3,
			"legal_holiday_dates": "2025-05-31",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": "5月31日(周六)至6月2日(周一)放假，5月31日为法定3倍工资日。"
		},
		{
			"holiday_name": "中秋节与国庆节",
			"start_date": "2025-10-01",
			"end_date": "2025-10-08",
			"days_count": 8,
			"legal_holiday_dates": "2025-10-01, 2025-10-02, 2025-10-03, 2025-10-06",
			"legal_days_count": 4,
			"shift_work_dates": "2025-09-28, 2025-10-11",
			"remarks": "10月1日(周三)至10月8日(周三)放假共8天。10月1~3日(国庆)及6日(中秋)为法定3倍工资日。9月28日、10月11日上班。"
		}
	],
	2027: [
		{
			"holiday_name": "元旦",
			"start_date": "2027-01-01",
			"end_date": "2027-01-03",
			"days_count": 3,
			"legal_holiday_dates": "2027-01-01",
			"legal_days_count": 1,
			"shift_work_dates": "",
			"remarks": "1月1日(周五)至1月3日(周日)放假，1月1日为法定3倍工资日。"
		},
		{
			"holiday_name": "春节",
			"start_date": "2027-02-05",
			"end_date": "2027-02-13",
			"days_count": 9,
			"legal_holiday_dates": "2027-02-05, 2027-02-06, 2027-02-07, 2027-02-08",
			"legal_days_count": 4,
			"shift_work_dates": "2027-01-31, 2027-02-20",
			"remarks": "2月5日(除夕)至2月13日(初七)放假共9天。2月5~8日为法定3倍工资日。1月31日、2月20日上班。"
		},
		{
			"holiday_name": "劳动节",
			"start_date": "2027-05-01",
			"end_date": "2027-05-05",
			"days_count": 5,
			"legal_holiday_dates": "2027-05-01, 2027-05-02",
			"legal_days_count": 2,
			"shift_work_dates": "2027-04-25, 2027-05-08",
			"remarks": "5月1日(周六)至5月5日(周三)放假共5天。5月1日、2日为法定3倍工资日。4月25日、5月8日上班。"
		},
		{
			"holiday_name": "国庆节",
			"start_date": "2027-10-01",
			"end_date": "2027-10-07",
			"days_count": 7,
			"legal_holiday_dates": "2027-10-01, 2027-10-02, 2027-10-03",
			"legal_days_count": 3,
			"shift_work_dates": "2027-09-26, 2027-10-09",
			"remarks": "10月1日(周五)至10月7日(周四)放假共7天。10月1~3日为法定3倍工资日。9月26日、10月9日上班。"
		}
	]
}

@frappe.whitelist()
def get_national_holiday_template(year):
	"""
	获取指定年份的法定节假日与调休官方模板
	"""
	y = cint(year) or 2026
	if y in NATIONAL_HOLIDAY_TEMPLATES:
		return NATIONAL_HOLIDAY_TEMPLATES[y]
	return [
		{"holiday_name": "元旦", "start_date": f"{y}-01-01", "end_date": f"{y}-01-03", "days_count": 3, "legal_holiday_dates": f"{y}-01-01", "legal_days_count": 1, "shift_work_dates": "", "remarks": "元旦法定假期"},
		{"holiday_name": "春节", "start_date": f"{y}-02-15", "end_date": f"{y}-02-23", "days_count": 9, "legal_holiday_dates": f"{y}-02-15, {y}-02-16, {y}-02-17, {y}-02-18", "legal_days_count": 4, "shift_work_dates": "", "remarks": "春节黄金周假期"},
		{"holiday_name": "劳动节", "start_date": f"{y}-05-01", "end_date": f"{y}-05-05", "days_count": 5, "legal_holiday_dates": f"{y}-05-01, {y}-05-02", "legal_days_count": 2, "shift_work_dates": "", "remarks": "五一劳动节假期"},
		{"holiday_name": "国庆节", "start_date": f"{y}-10-01", "end_date": f"{y}-10-07", "days_count": 7, "legal_holiday_dates": f"{y}-10-01, {y}-10-02, {y}-10-03", "legal_days_count": 3, "shift_work_dates": "", "remarks": "十一国庆节假期"}
	]

@frappe.whitelist()
def get_holiday_configs(year):
	"""
	获取指定年份已保存的节假日配置；若尚未配置则自动加载官方模板
	"""
	y = cint(year) or 2026
	configs = frappe.get_all(
		"Ashan Holiday Schedule Config",
		filters={"year": y},
		fields=["name", "year", "holiday_name", "start_date", "end_date", "days_count", "legal_holiday_dates", "legal_days_count", "shift_work_dates", "remarks"],
		order_by="start_date asc"
	)
	if not configs:
		configs = get_national_holiday_template(y)
	return configs

@frappe.whitelist(methods=["POST"])
def save_holiday_configs_and_rebuild_calendar(year, configs_json):
	"""
	保存节假日与调休补班配置，并全自动生成/重建全年 365/366 天日历底册数据
	严格区分：
	- 🔴 法定节假日 (3倍工资日 · 不可倒休)
	- 🔵 调休放假与普通公休日 (2倍工资日 · 可倒休补休)
	- 🟠 调休补班工作日 (100% 正常出勤计薪)
	- ⚪ 正常工作日 (100%)
	"""
	y = cint(year) or 2026
	if isinstance(configs_json, str):
		configs = json.loads(configs_json)
	else:
		configs = configs_json or []

	# 1. 保存/覆盖该年份的 Holiday Schedule Config
	existing_configs = frappe.get_all("Ashan Holiday Schedule Config", filters={"year": y}, pluck="name")
	for cname in existing_configs:
		frappe.delete_doc("Ashan Holiday Schedule Config", cname, ignore_permissions=True)

	parsed_configs = []
	for item in configs:
		hname = (item.get("holiday_name") or "").strip()
		s_date = str(item.get("start_date") or "").strip()
		e_date = str(item.get("end_date") or "").strip()
		legal_dates = str(item.get("legal_holiday_dates") or "").strip()
		shift_dates = str(item.get("shift_work_dates") or "").strip()
		remarks = str(item.get("remarks") or "").strip()

		if not hname or not s_date or not e_date:
			continue

		d_count = date_diff(e_date, s_date) + 1
		legal_date_list = [d.strip() for d in legal_dates.split(",") if d.strip()]
		legal_count = len(legal_date_list) if legal_date_list else 0

		doc = frappe.new_doc("Ashan Holiday Schedule Config")
		doc.year = y
		doc.holiday_name = hname
		doc.start_date = s_date
		doc.end_date = e_date
		doc.days_count = d_count
		doc.legal_holiday_dates = legal_dates
		doc.legal_days_count = legal_count
		doc.shift_work_dates = shift_dates
		doc.remarks = remarks
		doc.insert(ignore_permissions=True)

		parsed_configs.append({
			"holiday_name": hname,
			"start_date": getdate(s_date),
			"end_date": getdate(e_date),
			"legal_dates": legal_date_list,
			"shift_work_dates": [d.strip() for d in shift_dates.split(",") if d.strip()],
			"remarks": remarks
		})

	# 2. 循环遍历该年份全部 365/366 天并构建状态
	start_of_year = datetime.date(y, 1, 1)
	is_leap = calendar.isleap(y)
	total_days = 366 if is_leap else 365

	# 准备快速查找字典
	holiday_range_map = {} # date_str -> holiday_name
	legal_3x_map = {}      # date_str -> holiday_name (法定3倍)
	shift_work_map = {}    # date_str -> holiday_name (调休上班)

	for cfg in parsed_configs:
		curr = cfg["start_date"]
		end = cfg["end_date"]
		while curr <= end:
			holiday_range_map[str(curr)] = cfg["holiday_name"]
			curr = curr + datetime.timedelta(days=1)
		
		for l_date_str in cfg["legal_dates"]:
			legal_3x_map[l_date_str] = cfg["holiday_name"]

		for s_date_str in cfg["shift_work_dates"]:
			shift_work_map[s_date_str] = f"{cfg['holiday_name']}补班"

	# 批量生成/Upsert
	for day_offset in range(total_days):
		d = start_of_year + datetime.timedelta(days=day_offset)
		d_str = str(d)
		month_int = d.month
		weekday = d.weekday() # 0=Mon, 5=Sat, 6=Sun
		is_weekend = (weekday in [5, 6])

		day_type = "正常工作日"
		is_workday = 1
		is_legal_holiday = 0
		is_shift_off = 0
		is_shift_work = 0
		overtime_rate = "100% (正常出勤计薪)"
		can_compensate_leave = "正常出勤工作"
		holiday_name = ""

		if d_str in shift_work_map:
			# 调休上班 (周末变工作日)
			day_type = "调班工作日"
			is_workday = 1
			is_shift_work = 1
			overtime_rate = "100% (正常出勤计薪)"
			can_compensate_leave = "正常出勤工作"
			holiday_name = shift_work_map[d_str]
		elif d_str in legal_3x_map:
			# 🔴 法定节假日 (3倍工资日 · 强制不可倒休)
			day_type = "法定节假日(3倍工资)"
			is_workday = 0
			is_legal_holiday = 1
			overtime_rate = "300% (3倍法定加班工资)"
			can_compensate_leave = "不可倒休(法律强制3倍工资)"
			holiday_name = f"{legal_3x_map[d_str]} (法定3倍)"
		elif d_str in holiday_range_map:
			# 🔵 调休放假日 (2倍工资日 · 可安排倒休补休)
			day_type = "调休放假(2倍工资)"
			is_workday = 0
			is_shift_off = 1
			overtime_rate = "200% (2倍休息日加班工资)"
			can_compensate_leave = "可安排倒休补休"
			holiday_name = f"{holiday_range_map[d_str]}调休放假"
		elif is_weekend:
			# 🔵 普通周末双休 (2倍工资日 · 可安排倒休补休)
			day_type = "周末公休(2倍工资)"
			is_workday = 0
			overtime_rate = "200% (2倍休息日加班工资)"
			can_compensate_leave = "可安排倒休补休"
			holiday_name = ""
		else:
			# ⚪ 普通周一到周五工作日 (100%)
			day_type = "正常工作日"
			is_workday = 1
			overtime_rate = "100% (正常出勤计薪)"
			can_compensate_leave = "正常出勤工作"
			holiday_name = ""

		# Upsert 到 Ashan Holiday Calendar
		if frappe.db.exists("Ashan Holiday Calendar", d_str):
			cal_doc = frappe.get_doc("Ashan Holiday Calendar", d_str)
		else:
			cal_doc = frappe.new_doc("Ashan Holiday Calendar")
			cal_doc.calendar_date = d_str

		cal_doc.year = y
		cal_doc.month = month_int
		cal_doc.day_type = day_type
		cal_doc.is_workday = is_workday
		cal_doc.is_legal_holiday = is_legal_holiday
		cal_doc.is_shift_off = is_shift_off
		cal_doc.is_shift_work = is_shift_work
		cal_doc.overtime_rate = overtime_rate
		cal_doc.can_compensate_leave = can_compensate_leave
		cal_doc.holiday_name = holiday_name
		cal_doc.save(ignore_permissions=True)

	frappe.db.commit()
	return {
		"success": True,
		"message": f"成功保存【{y}年度】法定节假日与调休安排，并已全自动构建 365 天日历底册与加班倍率表！",
		"year": y,
		"total_days": total_days
	}

@frappe.whitelist()
def get_year_calendar_matrix(year):
	"""
	获取指定年份 12 个月份的日历矩阵（用于年视图、月视图和列表版渲染）与全维度 KPI 统计
	"""
	y = cint(year) or 2026

	# 若尚未配置过该年份节假日，自动加载国家官方模板并生成 365 天日历
	cfg_count = frappe.db.count("Ashan Holiday Schedule Config", {"year": y})
	if cfg_count == 0:
		tmpl = get_national_holiday_template(y)
		save_holiday_configs_and_rebuild_calendar(y, tmpl)

	# 读取该年所有 365/366 天数据
	records = frappe.get_all(
		"Ashan Holiday Calendar",
		filters={"year": y},
		fields=["calendar_date", "year", "month", "day_type", "is_workday", "is_legal_holiday", "is_shift_off", "is_shift_work", "overtime_rate", "can_compensate_leave", "holiday_name", "remark"],
		limit=0,
		order_by="calendar_date asc"
	)

	records_by_date = {str(r["calendar_date"]): r for r in records}

	months_data = []
	calendar_list = [] # 供列表视图使用
	total_workdays = 0
	total_legal_3x_holidays = 0
	total_shift_off_days = 0
	total_weekend_days = 0
	total_shift_workdays = 0

	weekdays_cn = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]

	for m in range(1, 13):
		cal_obj = calendar.monthcalendar(y, m)
		month_days_list = []
		m_workdays = 0
		m_legal_3x = 0
		m_shift_off = 0
		m_weekends = 0
		m_shift_works = 0

		for week in cal_obj:
			week_row = []
			for day_num in week:
				if day_num == 0:
					week_row.append({"day": 0, "is_current_month": False})
				else:
					d_str = f"{y}-{str(m).zfill(2)}-{str(day_num).zfill(2)}"
					d_info = records_by_date.get(d_str, {})
					is_w = d_info.get("is_workday", 1)
					is_l = d_info.get("is_legal_holiday", 0)
					is_so = d_info.get("is_shift_off", 0)
					is_sw = d_info.get("is_shift_work", 0)
					dtype = d_info.get("day_type", "正常工作日")
					ot_rate = d_info.get("overtime_rate", "100% (正常出勤计薪)")
					can_comp = d_info.get("can_compensate_leave", "正常出勤工作")
					hname = d_info.get("holiday_name", "")

					cur_date_obj = datetime.date(y, m, day_num)
					w_cn = weekdays_cn[cur_date_obj.weekday()]

					if is_w:
						m_workdays += 1
						total_workdays += 1
					if is_l:
						m_legal_3x += 1
						total_legal_3x_holidays += 1
					if is_so:
						m_shift_off += 1
						total_shift_off_days += 1
					if is_sw:
						m_shift_works += 1
						total_shift_workdays += 1
					if dtype == "周末公休(2倍工资)":
						m_weekends += 1
						total_weekend_days += 1

					day_item = {
						"day": day_num,
						"date": d_str,
						"weekday_cn": w_cn,
						"is_current_month": True,
						"day_type": dtype,
						"is_workday": bool(is_w),
						"is_legal_holiday": bool(is_l),
						"is_shift_off": bool(is_so),
						"is_shift_work": bool(is_sw),
						"overtime_rate": ot_rate,
						"can_compensate_leave": can_comp,
						"holiday_name": hname
					}
					week_row.append(day_item)
					calendar_list.append(day_item)

			month_days_list.append(week_row)

		num_days_in_month = calendar.monthrange(y, m)[1]
		months_data.append({
			"month": m,
			"month_name": f"{m}月",
			"total_days": num_days_in_month,
			"workdays_count": m_workdays,
			"legal_3x_count": m_legal_3x,
			"shift_off_count": m_shift_off,
			"weekends_count": m_weekends,
			"shift_works_count": m_shift_works,
			"total_rest_count": m_legal_3x + m_shift_off + m_weekends,
			"weeks": month_days_list
		})

	is_leap = calendar.isleap(y)
	total_days = 366 if is_leap else 365
	total_rest_days = total_days - total_workdays

	return {
		"year": y,
		"kpis": {
			"total_days": total_days,
			"total_workdays": total_workdays,
			"total_rest_days": total_rest_days,
			"total_legal_3x_holidays": total_legal_3x_holidays,
			"total_shift_off_days": total_shift_off_days,
			"total_shift_workdays": total_shift_workdays,
			"total_weekend_days": total_weekend_days,
			"total_compensable_rest_days": total_shift_off_days + total_weekend_days
		},
		"months": months_data,
		"calendar_list": calendar_list
	}

# ==============================================================================
# 🌟 全系统公共 API 服务 (供考勤、薪酬加班/缺勤扣款、餐费补贴、物业账期随时调用)
# ==============================================================================

@frappe.whitelist()
def is_workday(date_val):
	"""
	判断指定日期是否为出勤工作日 (含调休补班日，扣除周末与节假日)
	"""
	d_str = str(getdate(date_val))
	y = cint(d_str.split("-")[0])
	val = frappe.db.get_value("Ashan Holiday Calendar", d_str, "is_workday")
	if val is None:
		get_year_calendar_matrix(y)
		val = frappe.db.get_value("Ashan Holiday Calendar", d_str, "is_workday")
	return bool(val)

@frappe.whitelist()
def is_holiday(date_val):
	"""
	判断指定日期是否为放假日 (法定节假日或正常周末双休)
	"""
	return not is_workday(date_val)

@frappe.whitelist()
def get_date_overtime_info(date_val):
	"""
	获取指定日期的加班薪资倍率与倒休规则
	返回:
	{
		"date": "2026-02-15",
		"day_type": "法定节假日(3倍工资)",
		"overtime_rate": "300% (3倍法定加班工资)",
		"can_compensate_leave": "不可倒休(法律强制3倍工资)",
		"rate_multiplier": 3.0,
		"can_compensate": False
	}
	"""
	d_str = str(getdate(date_val))
	y = cint(d_str.split("-")[0])
	rec = frappe.db.get_value(
		"Ashan Holiday Calendar",
		d_str,
		["day_type", "is_workday", "is_legal_holiday", "is_shift_off", "overtime_rate", "can_compensate_leave", "holiday_name"],
		as_dict=True
	)
	if not rec:
		get_year_calendar_matrix(y)
		rec = frappe.db.get_value(
			"Ashan Holiday Calendar",
			d_str,
			["day_type", "is_workday", "is_legal_holiday", "is_shift_off", "overtime_rate", "can_compensate_leave", "holiday_name"],
			as_dict=True
		)

	if not rec:
		return {"date": d_str, "rate_multiplier": 1.0, "can_compensate": True}

	is_3x = bool(rec.get("is_legal_holiday"))
	is_2x = bool(rec.get("is_shift_off")) or (rec.get("day_type") == "周末公休(2倍工资)")

	rate_mult = 3.0 if is_3x else (2.0 if is_2x else 1.0)
	can_comp = not is_3x

	return {
		"date": d_str,
		"day_type": rec.get("day_type"),
		"overtime_rate": rec.get("overtime_rate"),
		"can_compensate_leave": rec.get("can_compensate_leave"),
		"rate_multiplier": rate_mult,
		"can_compensate": can_comp,
		"holiday_name": rec.get("holiday_name")
	}

@frappe.whitelist()
def get_month_workdays(year, month):
	"""
	获取指定年份指定月份的标准工作日总天数
	"""
	y = cint(year)
	m = cint(month)
	cnt = frappe.db.count("Ashan Holiday Calendar", {"year": y, "month": m, "is_workday": 1})
	if cnt == 0:
		get_year_calendar_matrix(y)
		cnt = frappe.db.count("Ashan Holiday Calendar", {"year": y, "month": m, "is_workday": 1})
	return cnt

@frappe.whitelist()
def get_workdays_between(start_date, end_date):
	"""
	计算两个日期区间之间的标准出勤工作日天数 (闭区间包含两端)
	"""
	s_date = getdate(start_date)
	e_date = getdate(end_date)
	if s_date > e_date:
		return 0
	
	cnt = frappe.db.count(
		"Ashan Holiday Calendar",
		filters={
			"calendar_date": ["between", [str(s_date), str(e_date)]],
			"is_workday": 1
		}
	)
	return cnt
