# Copyright (c) 2026, Ashan CN Procurement
import json
import frappe
from frappe.utils import flt, cint, getdate, today
import math
from datetime import datetime, date


def _check_payroll_permission(perm_type="read", company=None):
	"""Use the payroll workbench permission policy without creating a top-level circular import."""
	from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission
	return check_payroll_workbench_permission(perm_type, company)


def _require_company(company):
	"""Require an explicit company for payroll RPCs and batch mutations."""
	company = str(company or "").strip()
	if not company:
		frappe.throw("必须明确选择所属公司，不能使用历史默认公司。")
	return company


def _require_period_month(period_month):
	"""Require a YYYY-MM payroll period before changing payroll master data."""
	period_month = str(period_month or "").strip()
	if not period_month or len(period_month) != 7 or period_month[4:5] != "-":
		frappe.throw("必须明确选择工资核算月份（YYYY-MM）。")
	return period_month


def _default_insurance_setting_values(company, year):
	"""Return read-only defaults; reading configuration must never create database rows."""
	company_text = str(company or "")
	return {
		"name": f"{company}-{cint(year)}",
		"company": company,
		"effective_year": cint(year),
		"ss_company_pension": 16.0,
		"ss_company_unemployment": 0.5,
		"ss_company_medical": 10.0,
		"ss_company_other_medical": 0.5,
		"ss_company_injury": 0.55 if "祺富" in company_text else 0.35,
		"ss_person_pension": 8.0,
		"ss_person_unemployment": 0.5,
		"ss_person_medical": 2.0,
		"big_medical_amount_default": 22.0,
		"big_medical_amount_special": 21.0,
		"big_medical_special_months": "3,12",
		"hf_company_rate": 5.0,
		"hf_person_rate": 5.0,
		"hf_auto_rule_enabled": 1,
		"hf_contribution_months": "1,4,7,10",
		"hf_off_month_action": "停缴",
		"ss_min_base": 5013.0 if "祺富" in company_text else 5124.0,
		"hf_min_base": 2320.0,
		"tax_threshold": 5000.0,
		"tax_cycle_start_month": 12,
	}


def _new_insurance_setting(company, year):
	"""Create an unsaved settings document populated with the same defaults shown by the read API."""
	doc = frappe.new_doc("Ashan Insurance Setting")
	for fieldname, value in _default_insurance_setting_values(company, year).items():
		if fieldname != "name" and hasattr(doc, fieldname):
			setattr(doc, fieldname, value)
	return doc


SOCIAL_SECURITY_BASE_MODE_MINIMUM = "最低缴费基数"
SOCIAL_SECURITY_BASE_MODE_CUSTOM = "自定义"
SOCIAL_SECURITY_BASE_MODES = {
	SOCIAL_SECURITY_BASE_MODE_MINIMUM,
	SOCIAL_SECURITY_BASE_MODE_CUSTOM,
}


def normalize_social_security_base_mode(value):
	"""Return the canonical employee social-insurance base mode.

	A blank mode is intentionally treated as the minimum-base mode so every legacy
	profile is automatically linked to the company setting after the schema upgrade.
	"""
	mode = str(value or "").strip()
	if not mode:
		return SOCIAL_SECURITY_BASE_MODE_MINIMUM
	if mode not in SOCIAL_SECURITY_BASE_MODES:
		frappe.throw("社保缴费基数方式只能选择“最低缴费基数”或“自定义”。")
	return mode


def resolve_social_security_base(profile, insurance_setting=None):
	"""Resolve the effective social-insurance base without persisting a copy.

	Profiles bound to the minimum base read ``ss_min_base`` every time. Therefore a
	new annual minimum is reflected consistently in the employee master, ledgers and
	all unlocked payroll recalculations. Custom profiles keep only their own value.
	"""
	profile = profile or {}
	getter = profile.get if hasattr(profile, "get") else lambda key, default=None: getattr(profile, key, default)
	emp_type = str(getter("employee_type") or "").strip()
	if emp_type in {"返聘工", "退休返聘", "其他-返聘工"}:
		return 0.0
	mode = normalize_social_security_base_mode(getter("social_security_base_mode"))
	if mode == SOCIAL_SECURITY_BASE_MODE_CUSTOM:
		return round(max(flt(getter("custom_social_security_base")), 0.0), 2)
	setting = insurance_setting or {}
	setting_getter = setting.get if hasattr(setting, "get") else lambda key, default=None: getattr(setting, key, default)
	return round(max(flt(setting_getter("ss_min_base")), 0.0), 2)


def _normalize_social_security_base_payload(data, existing=None):
	"""Normalize API input while keeping legacy ``social_security_base`` callers safe."""
	payload = dict(data or {})
	existing = existing or {}
	has_mode = "social_security_base_mode" in payload
	has_legacy_base = "social_security_base" in payload
	mode = payload.get("social_security_base_mode") if has_mode else existing.get("social_security_base_mode")
	# Legacy integrations that explicitly send the old base field are understood as
	# a deliberate individual override. The current workbench sends the new mode.
	if has_legacy_base and not has_mode:
		mode = SOCIAL_SECURITY_BASE_MODE_CUSTOM
	mode = normalize_social_security_base_mode(mode)
	payload["social_security_base_mode"] = mode
	if mode == SOCIAL_SECURITY_BASE_MODE_CUSTOM:
		amount = payload.get("custom_social_security_base")
		if amount is None and has_legacy_base:
			amount = payload.get("social_security_base")
		if amount is None:
			amount = existing.get("custom_social_security_base", 0)
		amount = round(flt(amount), 2)
		if amount < 0:
			frappe.throw("自定义社保缴费基数不能为负数。")
		payload["custom_social_security_base"] = amount
		# Preserve the legacy cache for integrations that have not yet migrated.
		payload["social_security_base"] = amount
	return payload


def _queue_salary_recalculation(company, period_month, employee_no=None, trigger_source="员工薪酬档案", start_period=None, trigger_detail=""):
	"""Create an auditable recalculation task in the same transaction as the input change.

	For payroll inputs, silently accepting a save while task creation fails can leave a
	previously ``已计算`` row looking current and could undermine the final-lock guard.
	Therefore task creation is part of the financial write contract: if it fails, the
	request is rejected so Frappe rolls the input write back as well.
	"""
	if not company:
		frappe.throw("缺少公司，无法创建薪酬后台重算任务。")
	if not period_month:
		# Legacy/profile-only entry points do not always send the workbench month.
		# In that case use the latest existing *unlocked* payroll month.  If the company
		# has no open monthly settlement yet, there is no calculated snapshot to become
		# stale, so the master-data save can safely stand without a task.
		rows = frappe.get_all(
			"Ashan Monthly Payroll Settlement",
			filters={"company": company},
			fields=["period_month", "locked", "status"],
			order_by="period_month desc",
			limit=24,
		)
		for row in rows:
			if not cint(row.get("locked")) and row.get("status") not in {"已核定锁定", "已归档发放", "Locked", "Submitted"}:
				period_month = row.get("period_month")
				break
		if not period_month:
			return None
	try:
		from ashan_cn_procurement.services.payroll_recalculation_service import queue_recalculation_after_change
		return queue_recalculation_after_change(
			company=company,
			period_month=period_month,
			employee_no=employee_no,
			trigger_source=trigger_source,
			start_period=start_period,
			trigger_detail=trigger_detail,
		)
	except Exception:
		frappe.log_error(frappe.get_traceback(), "Payroll recalculation enqueue failed")
		frappe.throw("数据未提交：服务器无法创建薪酬重算任务。请稍后重试，或联系系统管理员检查后台队列。")

def _normalize_alias_rows(value=None, legacy_text=None, primary_name=None):
	"""Normalize structured/legacy employee aliases for API and AI writes."""
	import re
	rows = value
	if isinstance(rows, str):
		text = rows.strip()
		if text.startswith("["):
			try:
				rows = json.loads(text)
			except Exception:
				rows = []
		else:
			legacy_text = text
			rows = []
	if not isinstance(rows, (list, tuple)):
		rows = []

	items = []
	if rows:
		for row in rows:
			if isinstance(row, str):
				items.append({"alias_name": row.strip(), "alias_note": ""})
			elif isinstance(row, dict):
				items.append({
					"alias_name": str(row.get("alias_name") or row.get("name") or "").strip(),
					"alias_note": str(row.get("alias_note") or row.get("note") or "").strip(),
				})
	else:
		for part in re.split(r"[,，;；/、\n\r]+", str(legacy_text or "")):
			name = part.strip()
			if name:
				items.append({"alias_name": name, "alias_note": ""})

	primary_key = re.sub(r"\s+", "", str(primary_name or "")).lower()
	cleaned = []
	seen = set()
	for row in items:
		name = row["alias_name"]
		key = re.sub(r"\s+", "", name).lower()
		if not key or key == primary_key or key in seen:
			continue
		seen.add(key)
		cleaned.append(row)
	return cleaned


def _apply_alias_payload(doc, payload, existing=None):
	"""Apply the structured aliases and synchronize the legacy compatibility mirror."""
	if "name_aliases" not in payload and "external_name_aliases" not in payload:
		return
	rows = _normalize_alias_rows(
		payload.get("name_aliases"),
		payload.get("external_name_aliases"),
		payload.get("employee_name") or getattr(doc, "employee_name", None) or ((existing or {}).get("employee_name")),
	)
	doc.set("name_aliases", rows)
	doc.external_name_aliases = "\n".join(row["alias_name"] for row in rows)


def calculate_age_and_retirement_details(
	id_card="",
	birth_date_str=None,
	gender=None,
	job_title="操作工",
	original_retirement_age=None,
	ref_period_month=None,
	certificate_type=None,
	retirement_category=None,
	delayed_retirement_age=None,
):
	"""统一调用独立退休政策引擎，避免 UI/API 各自维护一套规则。"""
	from ashan_cn_procurement.services.retirement_policy_service import calculate_retirement_details
	return calculate_retirement_details(
		certificate_type=certificate_type or "中国居民身份证",
		certificate_number=id_card,
		birth_date=birth_date_str,
		gender=gender,
		retirement_category=retirement_category,
		original_retirement_age=original_retirement_age,
		delayed_retirement_age=delayed_retirement_age,
		job_title=job_title,
		ref_period_month=ref_period_month,
	)


def _normalize_employee_identity_retirement_payload(data, period_month=None, existing=None):
	"""Normalize identity fields before create/update.

	For a valid PRC resident ID the birth date and gender are authoritative and are
	automatically derived.  Passport/other documents keep manually entered values.
	"""
	from ashan_cn_procurement.services.retirement_policy_service import validate_chinese_id_number

	payload = dict(data or {})
	cert_type = str(payload.get("certificate_type") or (existing.get("certificate_type") if existing else "") or "中国居民身份证").strip()
	cert_no = str(payload.get("id_card") or (existing.get("id_card") if existing else "") or "").strip().upper()
	payload["certificate_type"] = cert_type
	if cert_no:
		payload["id_card"] = cert_no

	if cert_type == "中国居民身份证" and cert_no:
		id_result = validate_chinese_id_number(cert_no)
		if not id_result.get("is_valid"):
			frappe.throw(f"身份证号码校验失败：{id_result.get('message') or '格式或校验码错误'}")
		payload["birth_date"] = id_result.get("birth_date")
		payload["gender"] = id_result.get("gender")

	calc = calculate_age_and_retirement_details(
		id_card=payload.get("id_card") or (existing.get("id_card") if existing else ""),
		birth_date_str=payload.get("birth_date") or (existing.get("birth_date") if existing else None),
		gender=payload.get("gender") or (existing.get("gender") if existing else None),
		job_title=payload.get("job_title") or (existing.get("job_title") if existing else "操作工"),
		original_retirement_age=payload.get("original_retirement_age") or (existing.get("original_retirement_age") if existing else None),
		delayed_retirement_age=payload.get("delayed_retirement_age") or (existing.get("delayed_retirement_age") if existing else None),
		certificate_type=cert_type,
		retirement_category=payload.get("retirement_category") or (existing.get("retirement_category") if existing else None),
		ref_period_month=period_month,
	)
	if calc.get("birth_date"):
		payload["birth_date"] = calc["birth_date"]
	if calc.get("gender"):
		payload["gender"] = calc["gender"]
	payload["current_age"] = calc.get("current_age") or 0
	# 女职工 50/55 岁类别属于人事政策属性。旧岗位名称只能用于界面提示，
	# 不能把猜测结果写回权威母表，否则下一次会被误当成人工已确认。
	if calc.get("needs_retirement_category_confirmation"):
		payload["retirement_category"] = payload.get("retirement_category") or (existing.get("retirement_category") if existing else "") or ""
		if not (payload.get("original_retirement_age") or (existing.get("original_retirement_age") if existing else None)):
			payload.pop("original_retirement_age", None)
			payload.pop("delayed_retirement_age", None)
			payload.pop("original_retirement_period", None)
			payload.pop("delayed_retirement_period", None)
	else:
		payload["retirement_category"] = payload.get("retirement_category") or calc.get("retirement_category")
		payload["original_retirement_age"] = payload.get("original_retirement_age") or calc.get("original_retirement_age") or 0
		payload["delayed_retirement_age"] = payload.get("delayed_retirement_age") or calc.get("delayed_retirement_age") or 0
		payload["original_retirement_period"] = payload.get("original_retirement_period") or calc.get("original_retire_period") or ""
		payload["delayed_retirement_period"] = payload.get("delayed_retirement_period") or calc.get("delayed_retire_period") or ""
	payload["retirement_policy_version"] = calc.get("policy_version") or ""
	return payload, calc


@frappe.whitelist()
def calculate_employee_age_and_retirement(
	id_card=None,
	birth_date=None,
	gender=None,
	job_title=None,
	original_retirement_age=None,
	delayed_retirement_age=None,
	certificate_type=None,
	retirement_category=None,
	period_month=None,
	company=None,
):
	"""按选定账期返回年龄、原退休、延迟法定退休和弹性退休年龄窗口。"""
	company = _require_company(company)
	_check_payroll_permission("read", company)
	return calculate_age_and_retirement_details(
		id_card=id_card,
		birth_date_str=birth_date,
		gender=gender,
		job_title=job_title,
		original_retirement_age=original_retirement_age,
		delayed_retirement_age=delayed_retirement_age,
		certificate_type=certificate_type,
		retirement_category=retirement_category,
		ref_period_month=period_month,
	)


@frappe.whitelist()
def get_retirement_policy_metadata(company=None):
	"""Expose policy version and parameters to the workbench for transparent UI hints."""
	company = _require_company(company)
	_check_payroll_permission("read", company)
	from ashan_cn_procurement.services.retirement_policy_service import (
		POLICY_VERSION, POLICY_EFFECTIVE_FROM, POLICY_SOURCE_URLS, RETIREMENT_CATEGORIES,
		FLEXIBLE_EARLY_MAX_MONTHS, FLEXIBLE_DELAY_MAX_MONTHS,
		EARLY_RETIREMENT_NOTICE_MONTHS, LATE_RETIREMENT_AGREEMENT_NOTICE_MONTHS, WARNING_MONTHS,
	)
	return {
		"policy_version": POLICY_VERSION,
		"effective_from": POLICY_EFFECTIVE_FROM,
		"source_urls": POLICY_SOURCE_URLS,
		"retirement_categories": list(RETIREMENT_CATEGORIES),
		"flexible_early_max_months": FLEXIBLE_EARLY_MAX_MONTHS,
		"flexible_delay_max_months": FLEXIBLE_DELAY_MAX_MONTHS,
		"early_notice_months": EARLY_RETIREMENT_NOTICE_MONTHS,
		"late_agreement_notice_months": LATE_RETIREMENT_AGREEMENT_NOTICE_MONTHS,
		"warning_months": WARNING_MONTHS,
		"minimum_contribution_policy": {
			"before_2030_months": 180,
			"from_2030_increment_months_per_year": 6,
			"maximum_months": 240,
		},
	}


@frappe.whitelist()
def get_employee_profiles(company=None, search_text=None, employee_type=None, period_month=None):
	"""
	获取指定公司的人员薪酬档案列表与统计指标
	"""
	company = _require_company(company)
	_check_payroll_permission("read", company)
	filters = {"company": company}
	if employee_type and employee_type != "全部":
		filters["employee_type"] = employee_type

	records = frappe.get_all(
		"Ashan Employee Salary Profile",
		filters=filters,
		fields=[
			"name", "employee_no", "employee_name", "company", "certificate_type", "id_card", "mobile",
			"gender", "birth_date", "current_age", "retirement_category",
			"original_retirement_age", "delayed_retirement_age",
			"original_retirement_period", "delayed_retirement_period", "retirement_policy_version",
			"external_name_aliases", "retirement_age", "retirement_date",
			"employee_type", "employment_status", "date_of_joining", "relieving_date", "resignation_reason",
			"salary_mode", "department", "job_title", "base_salary", "post_allowance", "house_rent_allowance", "performance_base",
			"meal_allowance", "traffic_allowance", "communication_allowance", "other_allowance",
			"fixed_salary", "commercial_insurance", "is_insured",
			"social_security_base", "social_security_base_mode", "custom_social_security_base",
			"housing_fund_base", "housing_fund_policy",
			"deduction_child_education", "deduction_continuing_education",
			"deduction_serious_illness", "deduction_housing_loan",
			"deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care",
			"bank_name", "bank_account", "notes", "modified"
		],
		order_by="employee_no asc"
	)

	# V6: 一次性加载结构化姓名别名。旧版本只存文本时继续兼容。
	alias_map = {}
	parent_names = [r.get("name") for r in records if r.get("name")]
	if parent_names:
		try:
			alias_rows = frappe.get_all(
				"Ashan Employee Name Alias",
				filters={"parent": ["in", parent_names], "parenttype": "Ashan Employee Salary Profile"},
				fields=["parent", "alias_name", "alias_note", "idx"],
				order_by="parent asc, idx asc",
			)
			for row in alias_rows:
				alias_map.setdefault(row.parent, []).append({
					"alias_name": row.alias_name,
					"alias_note": row.alias_note or "",
				})
		except Exception:
			alias_map = {}
	for r in records:
		structured = alias_map.get(r.get("name")) or _normalize_alias_rows(legacy_text=r.get("external_name_aliases"), primary_name=r.get("employee_name"))
		r["name_aliases"] = structured
		r["external_name_aliases"] = "\n".join(row.get("alias_name") or "" for row in structured if row.get("alias_name"))

	# 内存级快速搜索过滤
	if search_text:
		st = search_text.strip().lower()
		records = [
			r for r in records
			if st in (r.get("employee_no") or "").lower()
			or st in (r.get("employee_name") or "").lower()
			or st in (r.get("mobile") or "").lower()
			or st in (r.get("id_card") or "").lower()
			or st in (r.get("department") or "").lower()
			or st in (r.get("job_title") or "").lower()
			or st in (r.get("external_name_aliases") or "").lower()
		]

	# 计算每位员工的专项附加扣除合计、津贴合计与年龄/退休参数 (以本月1日为基准)
	target_pm = period_month or today()[:7]
	insurance_setting = get_insurance_setting(company, cint(str(target_pm)[:4]) or datetime.now().year)
	for r in records:
		r["social_security_base_mode"] = normalize_social_security_base_mode(r.get("social_security_base_mode"))
		r["social_security_base"] = resolve_social_security_base(r, insurance_setting)
		if r.get("employee_type") in ["返聘工", "退休返聘", "其他-返聘工"]:
			r["social_security_base"] = 0.0
			r["housing_fund_base"] = 0.0
		calc_ret = calculate_age_and_retirement_details(
			id_card=r.get("id_card"),
			birth_date_str=r.get("birth_date"),
			gender=r.get("gender"),
			job_title=r.get("job_title"),
			original_retirement_age=r.get("original_retirement_age") or r.get("retirement_age"),
			delayed_retirement_age=r.get("delayed_retirement_age"),
			certificate_type=r.get("certificate_type"),
			retirement_category=r.get("retirement_category"),
			ref_period_month=target_pm
		)
		for key in [
			"current_age", "current_age_months", "current_age_detail",
			"retirement_category", "needs_retirement_category_confirmation",
			"original_retirement_age", "original_retirement_age_str", "orig_retire_period",
			"original_retire_period", "original_retirement_period",
			"months_left_orig", "original_retirement_warning",
			"delayed_retirement_age", "delayed_retirement_age_str", "delay_months",
			"delayed_retire_period", "delayed_retirement_period", "months_left_delayed", "delayed_retirement_warning",
			"primary_retirement_warning",
			"earliest_flexible_retire_period", "earliest_flexible_notice_period",
			"latest_flexible_retire_period", "policy_version", "is_valid_id",
		]:
			r[key] = calc_ret.get(key)
		if not r.get("gender") and calc_ret.get("gender"):
			r["gender"] = calc_ret.get("gender")
		if not r.get("birth_date") and calc_ret.get("birth_date"):
			r["birth_date"] = calc_ret.get("birth_date")

		# 离职状态与本月离职判定
		rel_d = str(r.get("relieving_date") or "")
		is_resigned_this_month = False
		if r.get("employment_status") in ["离职", "本月离职"] or (rel_d and rel_d.startswith(target_pm)):
			is_resigned_this_month = True
		r["is_resigned_this_month"] = is_resigned_this_month

		total_deduction = (
			flt(r.get("deduction_child_education")) +
			flt(r.get("deduction_continuing_education")) +
			flt(r.get("deduction_serious_illness")) +
			flt(r.get("deduction_housing_loan")) +
			flt(r.get("deduction_housing_rent")) +
			flt(r.get("deduction_elderly_care")) +
			flt(r.get("deduction_infant_care"))
		)
		total_allowance = (
			flt(r.get("post_allowance")) +
			flt(r.get("house_rent_allowance")) +
			flt(r.get("meal_allowance")) +
			flt(r.get("traffic_allowance")) +
			flt(r.get("communication_allowance")) +
			flt(r.get("other_allowance"))
		)
		r["total_deduction"] = total_deduction
		r["total_allowance"] = total_allowance

	# 关联当月实发/应发薪资 (若已生成当月结算表或有导入数据)
	doc_name = f"{company}-{target_pm}"
	settle_sal_map = {}
	if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		settle_doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
		for it in settle_doc.items:
			sal_val = max(flt(it.get("net_salary")), flt(it.get("gross_salary")), flt(it.get("fixed_salary")), flt(it.get("target_salary")))
			settle_sal_map[it.employee_no] = sal_val

	for r in records:
		eno = r.get("employee_no")
		cur_sal = settle_sal_map.get(eno, flt(r.get("fixed_salary")) or flt(r.get("base_salary")))
		r["current_month_salary"] = cur_sal
		r["has_salary_this_month"] = bool(cur_sal > 0.001)

	# KPI 统计卡片指标 (正式工, 返聘工, 临时工, 其他员工[外籍/管理等], 本月离职)
	total_count = len(records)
	resigned_count = len([r for r in records if r.get("is_resigned_this_month")])
	regular_count = len([r for r in records if (r.get("employee_type") == "正式工" and not r.get("is_resigned_this_month"))])
	rehire_count = len([r for r in records if (r.get("employee_type") in ["返聘工", "退休返聘"] and not r.get("is_resigned_this_month"))])
	temp_count = len([r for r in records if (r.get("employee_type") in ["临时工", "零工"] and not r.get("is_resigned_this_month"))])
	other_type_count = len([r for r in records if (r.get("employee_type") not in ["正式工", "返聘工", "退休返聘", "临时工", "零工"] and not r.get("is_resigned_this_month"))])
	original_retirement_warning_count = len([r for r in records if r.get("original_retirement_warning")])
	delayed_retirement_warning_count = len([r for r in records if r.get("delayed_retirement_warning")])
	retirement_category_unconfirmed_count = len([r for r in records if r.get("needs_retirement_category_confirmation")])

	# 基础薪资总盘（祺富算固定工资，吉众算基本工资+津贴）
	if "祺富" in company:
		total_base_payroll = sum(flt(r.get("fixed_salary")) for r in records)
	else:
		total_base_payroll = sum(flt(r.get("base_salary")) + flt(r.get("total_allowance")) for r in records)

	return {
		"company": company,
		"records": records,
		"kpi": {
			"total_count": total_count,
			"regular_count": regular_count,
			"insured_count": regular_count,
			"rehire_count": rehire_count,
			"temp_count": temp_count,
			"other_type_count": other_type_count,
			"resigned_count": resigned_count,
			"original_retirement_warning_count": original_retirement_warning_count,
			"delayed_retirement_warning_count": delayed_retirement_warning_count,
			"retirement_category_unconfirmed_count": retirement_category_unconfirmed_count,
			"total_base_payroll": total_base_payroll
		}
	}


@frappe.whitelist()
def get_qifu_employees(company=None, period_month=None):
	"""获取在职及当月离职员工档案母表列表 (支持动态按月份基准计算年龄与退休)"""
	company = _require_company(company)
	_check_payroll_permission("read", company)
	res = get_employee_profiles(company=company, period_month=period_month)
	return res.get("records", [])


@frappe.whitelist(methods=["POST"])
def set_employee_resignation(employee_no, relieving_date=None, resignation_reason=None, company=None, period_month=None):
	"""
	办理单名员工离职：
	1. 离职日期默认为当前核算月份最后一天 (如 2026-07-31)
	2. employment_status 设为 离职，employee_type 可显示本月离职
	3. 自动触发次月社保公积金减员
	"""
	company = _require_company(company)
	period_month = _require_period_month(period_month)
	_check_payroll_permission("write", company)
	doc_name = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": employee_no}, "name")
	if not doc_name:
		frappe.throw(f"未找到工号为 {employee_no} 的员工档案")

	if not relieving_date:
		import calendar
		y, m = map(int, period_month.split("-"))
		last_day = calendar.monthrange(y, m)[1]
		relieving_date = f"{y:04d}-{m:02d}-{last_day:02d}"

	doc = frappe.get_doc("Ashan Employee Salary Profile", doc_name)
	doc.employment_status = "离职"
	doc.relieving_date = relieving_date
	doc.resignation_reason = resignation_reason or "正常离职"
	doc.save(ignore_permissions=True)
	_queue_salary_recalculation(company, period_month, employee_no, "员工薪酬档案", trigger_detail="办理员工离职")
	frappe.db.commit()

	return {
		"success": True,
		"employee_no": employee_no,
		"employee_name": doc.employee_name,
		"relieving_date": relieving_date,
		"message": f"✅ 已成功为【{doc.employee_name} ({employee_no})】办理离职（离职日期：{relieving_date}）！次月社保与公积金已自动减员。"
	}


@frappe.whitelist(methods=["POST"])
def batch_set_employee_resignation(employee_nos, relieving_date=None, resignation_reason=None, company=None, period_month=None):
	"""
	批量办理员工离职：
	可多选人员，填入离职日期（默认当月最后一天），一键全部办理离职并实现次月社保公积金自动减员
	"""
	company = _require_company(company)
	period_month = _require_period_month(period_month)
	_check_payroll_permission("write", company)
	if isinstance(employee_nos, str):
		try:
			employee_nos = json.loads(employee_nos)
		except Exception:
			employee_nos = [x.strip() for x in employee_nos.split(",") if x.strip()]

	if not employee_nos:
		frappe.throw("请至少选择一位员工办理离职")

	if not relieving_date:
		import calendar
		y, m = map(int, period_month.split("-"))
		last_day = calendar.monthrange(y, m)[1]
		relieving_date = f"{y:04d}-{m:02d}-{last_day:02d}"

	updated_list = []
	updated_emp_nos = []
	for emp_no in employee_nos:
		doc_name = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": emp_no}, "name")
		if doc_name:
			doc = frappe.get_doc("Ashan Employee Salary Profile", doc_name)
			doc.employment_status = "离职"
			doc.relieving_date = relieving_date
			doc.resignation_reason = resignation_reason or "正常离职"
			doc.save(ignore_permissions=True)
			updated_list.append(f"{doc.employee_name} ({emp_no})")
			updated_emp_nos.append(emp_no)

	for emp_no in updated_emp_nos:
		_queue_salary_recalculation(company, period_month, emp_no, "员工薪酬档案", trigger_detail="批量办理员工离职")
	frappe.db.commit()
	return {
		"success": True,
		"count": len(updated_list),
		"relieving_date": relieving_date,
		"updated_employees": updated_list,
		"message": f"✅ 成功为 {len(updated_list)} 位员工办理离职（离职日期：{relieving_date}）！次月社保与公积金已自动减员。"
	}


@frappe.whitelist(methods=["POST"])
def cancel_employee_resignation(employee_no, company=None, period_month=None):
	"""
	撤销员工离职，恢复在职
	"""
	company = _require_company(company)
	period_month = _require_period_month(period_month)
	_check_payroll_permission("write", company)
	doc_name = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": employee_no}, "name")
	if not doc_name:
		frappe.throw(f"未找到工号为 {employee_no} 的员工档案")

	doc = frappe.get_doc("Ashan Employee Salary Profile", doc_name)
	doc.employment_status = "在职"
	doc.relieving_date = None
	doc.resignation_reason = None
	doc.save(ignore_permissions=True)
	_queue_salary_recalculation(company, period_month, employee_no, "员工薪酬档案", trigger_detail="撤销员工离职")
	frappe.db.commit()

	return {
		"success": True,
		"employee_no": employee_no,
		"employee_name": doc.employee_name,
		"message": f"✅ 已成功恢复员工【{doc.employee_name} ({employee_no})】为正常在职状态，并已自动进入后台重算队列！"
	}


@frappe.whitelist(methods=["POST"])
def create_employee_salary_profile(**kwargs):
	"""新建员工薪酬档案"""
	target_company = _require_company(kwargs.get("company"))
	_check_payroll_permission("write", target_company)
	period_month = kwargs.pop("period_month", None)
	payload, _calc = _normalize_employee_identity_retirement_payload(kwargs, period_month=period_month)
	payload = _normalize_social_security_base_payload(payload)
	doc = frappe.new_doc("Ashan Employee Salary Profile")
	for k, v in payload.items():
		if k in {"name_aliases", "external_name_aliases"}:
			continue
		if hasattr(doc, k):
			setattr(doc, k, v)
	_apply_alias_payload(doc, payload)
	if not doc.company:
		doc.company = target_company
	if not doc.employment_status:
		doc.employment_status = "在职"
	doc.insert()
	_queue_salary_recalculation(doc.company, period_month, doc.employee_no, "员工薪酬档案", trigger_detail="新增员工薪酬档案")
	return {
		"success": True,
		"message": f"✅ 成功创建员工【{doc.employee_name}】薪酬母表档案！保存后已自动进入后台计算队列。",
		"doc": doc
	}


@frappe.whitelist(methods=["POST"])
def update_employee_salary_profile(name, **kwargs):
	"""更新员工薪酬档案"""
	company = frappe.db.get_value("Ashan Employee Salary Profile", name, "company")
	_check_payroll_permission("write", company)
	period_month = kwargs.pop("period_month", None)
	doc = frappe.get_doc("Ashan Employee Salary Profile", name)
	existing = doc.as_dict()
	payload, _calc = _normalize_employee_identity_retirement_payload(kwargs, period_month=period_month, existing=existing)
	payload = _normalize_social_security_base_payload(payload, existing=existing)
	for k, v in payload.items():
		if k in {"name_aliases", "external_name_aliases"}:
			continue
		if hasattr(doc, k) and k not in ["name", "doctype", "owner", "creation"]:
			setattr(doc, k, v)
	_apply_alias_payload(doc, payload, existing=existing)
	doc.save()
	_queue_salary_recalculation(doc.company, period_month, doc.employee_no, "员工薪酬档案", trigger_detail="修改员工薪酬档案")
	return {
		"success": True,
		"message": f"✅ 员工【{doc.employee_name}】档案已更新，并已自动标记后台重新计算。",
		"doc": doc
	}


@frappe.whitelist(methods=["POST"])
def update_single_employee(employee_name, data, period_month=None):
	"""更新单名员工的薪酬与人事参数；保存后按当前账期自动进入后台重算。"""
	if isinstance(data, str):
		data = json.loads(data)

	if not frappe.db.exists("Ashan Employee Salary Profile", employee_name):
		frappe.throw(f"未找到员工档案: {employee_name}")

	doc = frappe.get_doc("Ashan Employee Salary Profile", employee_name)
	_check_payroll_permission("write", doc.company)
	data, _calc = _normalize_employee_identity_retirement_payload(
		data, period_month=period_month, existing=doc.as_dict()
	)
	data = _normalize_social_security_base_payload(data, existing=doc.as_dict())

	allowed_fields = [
		"certificate_type", "id_card", "gender", "birth_date", "current_age", "retirement_age", "retirement_date",
		"retirement_category", "original_retirement_age", "delayed_retirement_age",
		"original_retirement_period", "delayed_retirement_period", "retirement_policy_version", "external_name_aliases", "name_aliases",
		"employee_type", "employment_status", "date_of_joining", "relieving_date", "resignation_reason",
		"salary_mode", "department", "job_title", "base_salary", "post_allowance", "house_rent_allowance", "performance_base",
		"meal_allowance", "traffic_allowance", "communication_allowance", "other_allowance",
		"fixed_salary", "commercial_insurance", "is_insured",
		"social_security_base", "social_security_base_mode", "custom_social_security_base",
		"housing_fund_base", "housing_fund_policy",
		"deduction_child_education", "deduction_continuing_education",
		"deduction_serious_illness", "deduction_housing_loan",
		"deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care",
		"bank_name", "bank_account", "notes"
	]

	for field in allowed_fields:
		if field in data:
			if field in {"name_aliases", "external_name_aliases"}:
				continue
			val = data[field]
			if field in ["fixed_salary", "base_salary", "post_allowance", "house_rent_allowance", "performance_base",
			             "meal_allowance", "traffic_allowance", "communication_allowance",
			             "other_allowance", "commercial_insurance", "social_security_base", "custom_social_security_base",
			             "housing_fund_base", "deduction_child_education", "deduction_continuing_education",
			             "deduction_serious_illness", "deduction_housing_loan", "deduction_housing_rent",
			             "deduction_elderly_care", "deduction_infant_care"]:
				val = flt(val)
			elif field in ["current_age", "is_insured"]:
				val = cint(val)
			doc.set(field, val)

	_apply_alias_payload(doc, data, existing=doc.as_dict())
	doc.save(ignore_permissions=True)
	_queue_salary_recalculation(doc.company, period_month, doc.employee_no, "员工薪酬档案", trigger_detail="单人参数更新")
	frappe.db.commit()

	return {"success": True, "message": f"员工 {doc.employee_name} 档案参数更新成功，并已进入后台重算队列！"}


@frappe.whitelist(methods=["POST"])
def batch_update_employees(employee_names, fieldname, value, period_month=None):
	"""
	批量更新多名员工的指定字段
	"""
	if isinstance(employee_names, str):
		employee_names = json.loads(employee_names)

	if not employee_names:
		frappe.throw("请至少选择一位员工！")

	docs = []
	for name in employee_names:
		if frappe.db.exists("Ashan Employee Salary Profile", name):
			doc = frappe.get_doc("Ashan Employee Salary Profile", name)
			_check_payroll_permission("write", doc.company)
			docs.append(doc)

	allowed_fields = [
		"employee_type", "employment_status", "salary_mode", "is_insured",
		"department", "job_title", "retirement_category", "base_salary", "post_allowance", "house_rent_allowance", "performance_base",
		"meal_allowance", "traffic_allowance", "communication_allowance", "other_allowance",
		"fixed_salary", "commercial_insurance",
		"social_security_base", "social_security_base_mode", "custom_social_security_base",
		"housing_fund_base", "housing_fund_policy",
		"deduction_child_education", "deduction_continuing_education",
		"deduction_serious_illness", "deduction_housing_loan",
		"deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care"
	]

	if fieldname not in allowed_fields:
		frappe.throw(f"字段 {fieldname} 不支持批量修改！")

	# 类型转换
	if fieldname in ["fixed_salary", "base_salary", "post_allowance", "house_rent_allowance", "performance_base",
	                 "meal_allowance", "traffic_allowance", "communication_allowance",
	                 "other_allowance", "commercial_insurance", "social_security_base", "custom_social_security_base",
	                 "housing_fund_base", "deduction_child_education", "deduction_continuing_education",
	                 "deduction_serious_illness", "deduction_housing_loan", "deduction_housing_rent",
	                 "deduction_elderly_care", "deduction_infant_care"]:
		val = flt(value)
	elif fieldname in ["is_insured"]:
		val = cint(value)
	else:
		val = str(value).strip()

	updated_count = 0
	affected_companies = set()
	for doc in docs:
		doc.set(fieldname, val)
		doc.save(ignore_permissions=True)
		updated_count += 1
		if doc.company:
			affected_companies.add(doc.company)

	# 批量修改统一合并为公司级任务，避免逐人制造大量重复 RQ Job。
	for company in affected_companies:
		_queue_salary_recalculation(company, period_month, None, "员工薪酬档案", trigger_detail=f"批量修改字段 {fieldname}")
	frappe.db.commit()

	return {
		"success": True,
		"updated_count": updated_count,
		"message": f"成功批量修改 {updated_count} 位员工的【{fieldname}】为 {value}，已合并提交后台重算！"
	}


@frappe.whitelist(methods=["POST"])
def update_employee_contribution_base(company, period_month, employee_no, base_type, amount=0, base_mode=None):
	"""Update an individual contribution base and queue the affected payroll row.

	For social insurance the employee first chooses the base mode. Selecting the
	minimum mode stores no copied minimum, so future setting changes remain linked.
	"""
	_check_payroll_permission("write", company)
	period_month = str(period_month or "").strip()
	parent_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", parent_name):
		state = frappe.db.get_value("Ashan Monthly Payroll Settlement", parent_name, ["locked", "status"], as_dict=True) or {}
		if cint(state.get("locked")) or state.get("status") in ["已核定锁定", "已归档发放"]:
			frappe.throw("当前选择账期已经冻结。请在历史数据中按审计流程反审核后再更正，或切换到未冻结月份。")
	name = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": employee_no}, "name")
	if not name:
		frappe.throw(f"未找到员工 {employee_no} 的薪酬档案。")
	doc = frappe.get_doc("Ashan Employee Salary Profile", name)
	if base_type == "social_security":
		mode = normalize_social_security_base_mode(base_mode or SOCIAL_SECURITY_BASE_MODE_CUSTOM)
		if mode == SOCIAL_SECURITY_BASE_MODE_CUSTOM:
			amount = round(flt(amount), 2)
			if amount < 0:
				frappe.throw("自定义社保缴费基数不能为负数。")
			doc.custom_social_security_base = amount
			doc.social_security_base = amount
		else:
			doc.social_security_base_mode = mode
			amount = resolve_social_security_base(
				doc, get_insurance_setting(company, cint(period_month[:4]) or datetime.now().year)
			)
		doc.social_security_base_mode = mode
		doc.is_insured = 1 if amount > 0 else 0
		source = "社会保险台账与配置"
		label = "社保缴费基数"
	elif base_type == "housing_fund":
		amount = round(flt(amount), 2)
		if amount < 0:
			frappe.throw("缴费基数不能为负数。")
		doc.housing_fund_base = amount
		source = "住房公积金台账与配置"
		label = "公积金缴费基数"
	else:
		frappe.throw("不支持的基数类型。")
	doc.save(ignore_permissions=True)
	_queue_salary_recalculation(company, period_month, employee_no, source, trigger_detail=f"单人调整{label}")
	return {
		"success": True, "employee_no": employee_no, "employee_name": doc.employee_name, "amount": amount,
		"base_mode": doc.get("social_security_base_mode") if base_type == "social_security" else None,
		"message": f"{doc.employee_name} ({employee_no}) 的{label}已更新为 {amount:,.2f} 元，并已自动进入服务器重算队列。",
	}


@frappe.whitelist(methods=["POST"])
def set_qifu_social_security_batch(mode="min", period_month=None, company=None):
	"""
	祺富全员社保一键批量设置：全部档案改为绑定公司年度最低缴费基数。

	这不是复制一次最低数值；今后调整年度最低基数时，所有绑定员工都会
	自动联动。社保业务边界（临时工、返聘等不参保人员）仍由结算规则控制。
	"""
	company = _require_company(company)
	period_month = _require_period_month(period_month)
	_check_payroll_permission("write", company)
	year = cint(str(period_month or "")[:4]) or datetime.now().year
	doc_setting = get_insurance_setting(company, year)
	target_base = flt(doc_setting.get("ss_min_base"))
	if mode != "min":
		frappe.throw("批量社保操作仅支持绑定年度最低缴费基数。特殊人员请使用单人“自定义”设置。")

	employees = frappe.get_all(
		"Ashan Employee Salary Profile",
		filters={"company": company, "employment_status": "在职"},
		fields=["name", "employee_no", "employee_name", "social_security_base_mode"]
	)

	updated_count = 0
	for emp in employees:
		if normalize_social_security_base_mode(emp.get("social_security_base_mode")) == SOCIAL_SECURITY_BASE_MODE_MINIMUM:
			continue
		doc = frappe.get_doc("Ashan Employee Salary Profile", emp["name"])
		doc.social_security_base_mode = SOCIAL_SECURITY_BASE_MODE_MINIMUM
		doc.save(ignore_permissions=True)
		updated_count += 1

	_queue_salary_recalculation(company, period_month, None, "社会保险台账与配置", trigger_detail="批量调整社保基数")
	frappe.db.commit()
	return {
		"success": True,
		"updated_count": updated_count,
		"message": f"✅ 已将 {updated_count} 位员工切换为“最低缴费基数”绑定（当前 {target_base:,.2f} 元）。以后调整年度最低基数会自动联动，无需再次逐人设置。"
	}


@frappe.whitelist(methods=["POST"])
def set_qifu_housing_fund_batch(mode="min", period_month=None, company=None):
	"""Deprecated compatibility endpoint.

	V5 no longer turns the employee master housing-fund base on/off by writing 0.
	Callers must use company automatic months, employee long-term policy, or a
	period-only override so the authoritative long-term base remains intact.
	"""
	company = _require_company(company)
	period_month = _require_period_month(period_month)
	_check_payroll_permission("write", company)
	frappe.throw(
		"旧版‘一键设置/清零公积金基数’已停用。请在住房公积金台账与配置中使用“自动缴纳规则”、"
		"“员工长期策略”或“本月例外”。员工母表长期基数不会因停缴月份被清零。"
	)

@frappe.whitelist()
def get_insurance_setting(company=None, year=None):
	"""读取指定公司与年份的社保、公积金和个税基础参数；GET 永不写数据库。"""
	company = _require_company(company)
	_check_payroll_permission("read", company)
	year = cint(year) or datetime.now().year
	setting_name = f"{company}-{year}"
	if frappe.db.exists("Ashan Insurance Setting", setting_name):
		doc = frappe.get_doc("Ashan Insurance Setting", setting_name)
		res = doc.as_dict()
		res["is_persisted"] = True
	else:
		res = _default_insurance_setting_values(company, year)
		res["is_persisted"] = False

	comp_ss_total = round(
		flt(res.get("ss_company_pension")) + flt(res.get("ss_company_unemployment"))
		+ flt(res.get("ss_company_medical")) + flt(res.get("ss_company_other_medical"))
		+ flt(res.get("ss_company_injury")), 4
	)
	pers_ss_total = round(
		flt(res.get("ss_person_pension")) + flt(res.get("ss_person_unemployment"))
		+ flt(res.get("ss_person_medical")), 4
	)
	hf_total = round(flt(res.get("hf_company_rate")) + flt(res.get("hf_person_rate")), 4)
	res.update({
		"total_ss_company_rate": comp_ss_total,
		"total_ss_person_rate": pers_ss_total,
		"total_hf_rate": hf_total,
		"total_overall_rate": round(comp_ss_total + pers_ss_total + hf_total, 4),
	})
	return res

@frappe.whitelist(methods=["POST"])
def save_insurance_setting(company, year, data, period_month=None):
	"""
	保存/更新指定公司与年份的社保公积金费率与基数配置
	"""
	_check_payroll_permission("write", company)
	if isinstance(data, str):
		data = json.loads(data)

	setting_name = f"{company}-{year}"
	if frappe.db.exists("Ashan Insurance Setting", setting_name):
		doc = frappe.get_doc("Ashan Insurance Setting", setting_name)
	else:
		doc = _new_insurance_setting(company, year)

	for k, v in data.items():
		if hasattr(doc, k):
			if k in ["effective_year", "hf_auto_rule_enabled"]:
				setattr(doc, k, cint(v))
			elif k in ["company", "big_medical_special_months", "hf_contribution_months", "hf_off_month_action"]:
				setattr(doc, k, str(v or "").strip())
			else:
				setattr(doc, k, flt(v))
	if flt(doc.ss_min_base) < 0:
		frappe.throw("社保最低缴费基数不能为负数。")

	doc.save(ignore_permissions=True)
	_queue_salary_recalculation(company, period_month, None, "社会保险台账与配置", trigger_detail="调整社保/公积金年度配置")
	frappe.db.commit()

	return {
		"success": True,
		"message": f"🎉【{company}】{year} 年度社保公积金配置保存成功；所有绑定“最低缴费基数”的员工已自动联动，并已标记未冻结账期重算！",
		"doc": get_insurance_setting(company, year)
	}




@frappe.whitelist()
def get_tax_setting(company=None, year=None, period_month=None):
    """读取个税参数。7级累计预扣税率为法定参数，仅展示、不允许从前端随意修改。"""
    company = _require_company(company)
    _check_payroll_permission("read", company)
    year = cint(year) or datetime.now().year
    setting = get_insurance_setting(company, year)
    threshold = flt(setting.get("tax_threshold")) or 5000.0
    cycle_start_month = cint(setting.get("tax_cycle_start_month")) or 12
    if cycle_start_month < 1 or cycle_start_month > 12:
        cycle_start_month = 12

    brackets = [
        {"level": 1, "lower": 0, "upper": 36000, "rate": 3, "quick_deduction": 0},
        {"level": 2, "lower": 36000, "upper": 144000, "rate": 10, "quick_deduction": 2520},
        {"level": 3, "lower": 144000, "upper": 300000, "rate": 20, "quick_deduction": 16920},
        {"level": 4, "lower": 300000, "upper": 420000, "rate": 25, "quick_deduction": 31920},
        {"level": 5, "lower": 420000, "upper": 660000, "rate": 30, "quick_deduction": 52920},
        {"level": 6, "lower": 660000, "upper": 960000, "rate": 35, "quick_deduction": 85920},
        {"level": 7, "lower": 960000, "upper": None, "rate": 45, "quick_deduction": 181920},
    ]
    return {
        "company": company,
        "effective_year": year,
        "tax_threshold": threshold,
        "tax_cycle_start_month": cycle_start_month,
        "tax_brackets": brackets,
        "period_month": period_month or f"{year}-01",
    }


@frappe.whitelist(methods=["POST"])
def save_tax_setting(company, year, tax_threshold, tax_cycle_start_month, period_month=None):
    """仅保存个税参数，不触碰社保、公积金费率。"""
    _check_payroll_permission("write", company)
    year = cint(year) or datetime.now().year
    tax_threshold = flt(tax_threshold)
    tax_cycle_start_month = cint(tax_cycle_start_month)
    if tax_threshold <= 0:
        frappe.throw("个税基本减除费用必须大于 0 元/月。")
    if tax_cycle_start_month < 1 or tax_cycle_start_month > 12:
        frappe.throw("个税申报周期起始月份必须为 1-12。")

    setting_name = f"{company}-{year}"
    if frappe.db.exists("Ashan Insurance Setting", setting_name):
        doc = frappe.get_doc("Ashan Insurance Setting", setting_name)
    else:
        # 写接口中显式创建默认记录；读取接口永不产生数据库副作用。
        doc = _new_insurance_setting(company, year)

    doc.tax_threshold = tax_threshold
    doc.tax_cycle_start_month = tax_cycle_start_month
    doc.save(ignore_permissions=True)
    _queue_salary_recalculation(company, period_month, None, "个税参数设置", trigger_detail="调整个税起征点或申报周期")
    frappe.db.commit()
    return {
        "success": True,
        "message": f"【{company}】{year} 年个税参数已保存，未冻结账期已自动进入后台重算队列。",
        "setting": get_tax_setting(company, year),
    }
