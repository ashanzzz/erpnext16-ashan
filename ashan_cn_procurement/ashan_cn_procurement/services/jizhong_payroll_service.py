
JIZHONG_SALARY_MODE_DYNAMIC_GROSS = "税前动态工资"
JIZHONG_SALARY_MODE_FIXED_GROSS = "税前固定工资"
JIZHONG_SALARY_MODE_DYNAMIC_NET = "税后动态工资"
JIZHONG_SALARY_MODE_FIXED_NET = "税后固定工资"
JIZHONG_SALARY_MODE_LEGACY_MANAGEMENT = "税后管理工资"

JIZHONG_ALL_SALARY_MODES = [
	JIZHONG_SALARY_MODE_DYNAMIC_GROSS,
	JIZHONG_SALARY_MODE_FIXED_GROSS,
	JIZHONG_SALARY_MODE_DYNAMIC_NET,
	JIZHONG_SALARY_MODE_FIXED_NET,
]


def normalize_jizhong_salary_mode(value):
	"""Normalize legacy salary modes to standard 4 Jizhong modes."""
	val = str(value or "").strip()
	if val in {JIZHONG_SALARY_MODE_FIXED_NET, JIZHONG_SALARY_MODE_LEGACY_MANAGEMENT}:
		return JIZHONG_SALARY_MODE_FIXED_NET
	if val in {JIZHONG_SALARY_MODE_DYNAMIC_GROSS, JIZHONG_SALARY_MODE_FIXED_GROSS, JIZHONG_SALARY_MODE_DYNAMIC_NET}:
		return val
	return JIZHONG_SALARY_MODE_DYNAMIC_GROSS


def get_jizhong_salary_mode_label(value):
	"""Return user-facing standard salary mode label."""
	return normalize_jizhong_salary_mode(value)


def is_jizhong_fixed_net_salary_mode(value):
	"""Return whether the salary mode is fixed net salary."""
	return str(value or "").strip() in {JIZHONG_SALARY_MODE_FIXED_NET, JIZHONG_SALARY_MODE_LEGACY_MANAGEMENT}


def is_jizhong_post_tax_salary_mode(value):
	"""Return whether the salary mode is post-tax (reverse-calculated)."""
	return str(value or "").strip() in {JIZHONG_SALARY_MODE_FIXED_NET, JIZHONG_SALARY_MODE_LEGACY_MANAGEMENT, JIZHONG_SALARY_MODE_DYNAMIC_NET}


def is_jizhong_dynamic_salary_mode(value):
	"""Return whether the salary mode is linked to attendance hours/days."""
	return str(value or "").strip() in {JIZHONG_SALARY_MODE_DYNAMIC_GROSS, JIZHONG_SALARY_MODE_DYNAMIC_NET}


	"""Return whether the salary mode is fixed net salary."""
	return str(value or "").strip() in {"税后管理工资", "税后固定工资"}
# ASHAN-UNIFIED-V2: canonical payroll authorization and transaction boundaries
# Copyright (c) 2026, Ashan CN Procurement
# 天津吉众科技有限公司 - 专有薪资核算、累计个税反推与五档配钞点钞服务
# 1:1 精确对齐《202606吉众人事综合.xlsm》全套业务公式

import os
import math
import re
import json
import frappe
from frappe.utils import cint, flt, getdate, today
from frappe.utils import now_datetime

from ashan_cn_procurement.services.ashan_holiday_service import get_month_workdays
from ashan_cn_procurement.services.authorization_service import (
	assert_payroll_access,
	can_module_access,
)
from ashan_cn_procurement.services.housing_fund_policy_service import (
	POLICY_FIXED_OFF,
	POLICY_FIXED_ON,
	POLICY_FOLLOW,
	evaluate_housing_fund_policy,
	get_override_map,
)
from ashan_cn_procurement.services.jizhong_attendance_service import (
	_attendance_coverage as _get_jizhong_attendance_coverage,
	_is_jizhong_attendance_required,
)
from ashan_cn_procurement.services.payroll_settlement_service import resolve_big_medical_amount
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission

# 常量定义
FULL_DAY_HOURS = 8.0
FIXED_MONTHLY_DAYS = 21.5
FIXED_MONTHLY_HOURS = FIXED_MONTHLY_DAYS * FULL_DAY_HOURS # 172.0h
JIZHONG_COMPANY = "天津吉众科技有限公司"
JIZHONG_HOUSING_POLICY_QUARTER_START = "季度初规则"
JIZHONG_HOUSING_POLICY_MONTHLY = "每月正常缴纳"
JIZHONG_HOUSING_POLICY_NEVER = "不缴纳"
JIZHONG_HOUSING_POLICY_TO_CANONICAL = {
	JIZHONG_HOUSING_POLICY_QUARTER_START: POLICY_FOLLOW,
	JIZHONG_HOUSING_POLICY_MONTHLY: POLICY_FIXED_ON,
	JIZHONG_HOUSING_POLICY_NEVER: POLICY_FIXED_OFF,
	"季初缴纳": POLICY_FOLLOW,
	"正常缴纳": POLICY_FIXED_ON,
	"每月缴纳": POLICY_FIXED_ON,
	"不缴纳": POLICY_FIXED_OFF,
	"固定停缴": POLICY_FIXED_OFF,
	"跟随公司规则": POLICY_FOLLOW,
	"固定缴纳": POLICY_FIXED_ON,
}
JIZHONG_HOUSING_POLICY_LABELS = {
	POLICY_FOLLOW: JIZHONG_HOUSING_POLICY_QUARTER_START,
	POLICY_FIXED_ON: JIZHONG_HOUSING_POLICY_MONTHLY,
	POLICY_FIXED_OFF: JIZHONG_HOUSING_POLICY_NEVER,
}
JIZHONG_NO_INSURANCE_TYPES = {
	"返聘工", "退休返聘", "退休返聘人员", "其他-返聘工", "临时工", "零工",
	"外籍工", "实习生", "其他类型员工", "其他", "本月离职",
}
JIZHONG_INSURANCE_DEFAULTS = {
	"ss_company_injury": 0.55, "ss_company_pension": 16.0, "ss_company_medical": 10.0,
	"ss_company_unemployment": 0.5, "ss_company_other_medical": 0.5,
	"ss_person_pension": 8.0, "ss_person_medical": 2.0, "ss_person_unemployment": 0.5,
	"hf_person_rate": 5.0, "hf_company_rate": 5.0,
	"big_medical_amount_default": 22.0, "big_medical_amount_special": 21.0,
	"big_medical_special_months": "1,4,7,10", "hf_auto_rule_enabled": 1,
	"hf_contribution_months": "1,4,7,10", "hf_off_month_action": "停缴",
	"ss_min_base": 0.0, "hf_min_base": 0.0, "tax_threshold": 5000.0,
	"tax_cycle_start_month": 12,
}
INSURANCE_VALUE_FIELDS = {
	"ss_company_pension", "ss_company_unemployment", "ss_company_medical", "ss_company_other_medical",
	"ss_company_injury", "ss_person_pension", "ss_person_unemployment", "ss_person_medical",
	"big_medical_amount_default", "big_medical_amount_special", "big_medical_special_months",
	"hf_company_rate", "hf_person_rate", "hf_auto_rule_enabled", "hf_contribution_months",
	"hf_off_month_action", "ss_min_base", "hf_min_base", "tax_threshold", "tax_cycle_start_month",
}
JIZHONG_SOCIAL_INSURANCE_SETTING_FIELDS = frozenset({
	"ss_company_pension", "ss_company_unemployment", "ss_company_medical", "ss_company_other_medical",
	"ss_company_injury", "ss_person_pension", "ss_person_unemployment", "ss_person_medical",
	"big_medical_amount_default", "big_medical_amount_special", "big_medical_special_months", "ss_min_base",
})
JIZHONG_HOUSING_FUND_SETTING_FIELDS = frozenset({
	"hf_company_rate", "hf_person_rate", "hf_auto_rule_enabled", "hf_contribution_months",
	"hf_off_month_action", "hf_min_base",
})
JIZHONG_CONFIRMATION_PREFIX = "JIZHONG_WORKFLOW_CONFIRMATION:"
JIZHONG_CONFIRMATION_STEPS = (
	"employees",
	"attendance",
	"social_insurance",
	"housing_fund",
	"tax",
	"cash_bills",
)
JIZHONG_LEGACY_INSURANCE_STEP = "insurance"
JIZHONG_INSURANCE_CONFIRMATION_STEPS = ("social_insurance", "housing_fund")
JIZHONG_STEP_DEPENDENCIES = {
	"employees": (),
	"attendance": (),  # 考勤与工时和员工档案相互独立
	"social_insurance": ("employees",),  # 社保与员工档案强锁定
	"housing_fund": ("employees",),  # 公积金与员工档案强锁定
	"tax": ("employees", "attendance", "social_insurance", "housing_fund"),
	"cash_bills": ("tax",),
}
JIZHONG_STEP_LABELS = {
	"employees": "员工档案",
	"attendance": "考勤与工时",
	"social_insurance": "社会保险",
	"housing_fund": "住房公积金",
	JIZHONG_LEGACY_INSURANCE_STEP: "社保公积金",
	"tax": "个人所得税台账",
	"cash_bills": "现金发放",
}


def normalize_jizhong_housing_fund_policy(policy):
	"""Map only Jizhong's employee-facing labels to the generic policy engine."""
	value = str(policy or POLICY_FOLLOW).strip()
	return JIZHONG_HOUSING_POLICY_TO_CANONICAL.get(value, value)


def get_jizhong_housing_fund_policy_label(policy):
	"""Return Jizhong's employee-facing long-term contribution policy label."""
	canonical = normalize_jizhong_housing_fund_policy(policy)
	return JIZHONG_HOUSING_POLICY_LABELS.get(
		canonical, JIZHONG_HOUSING_POLICY_QUARTER_START
	)


def _evaluate_jizhong_housing_fund_policy(employee, period_month, setting, override_mode=None):
	"""Evaluate Jizhong policy labels without extending the Qifu/shared template."""
	normalized_employee = frappe._dict(dict(employee))
	raw_policy = normalized_employee.get("housing_fund_policy")
	normalized_employee["housing_fund_policy"] = normalize_jizhong_housing_fund_policy(
		raw_policy
	)
	decision = evaluate_housing_fund_policy(
		normalized_employee, period_month, setting, override_mode
	)
	decision["employee_policy"] = get_jizhong_housing_fund_policy_label(raw_policy)
	return decision


def _assert_jizhong_access(action, company):
	"""Authorize the dedicated Jizhong service for its only owning company."""
	company = str(company or "").strip()
	if company != JIZHONG_COMPANY:
		frappe.throw(
			f"吉众薪酬引擎只允许处理【{JIZHONG_COMPANY}】数据，不能用于其他公司。",
			frappe.PermissionError,
		)
	assert_payroll_access(action, company=company)
	return company


def _normalize_jizhong_period(period_month, required=True):
	"""Validate a payroll month and return the canonical YYYY-MM string."""
	value = str(period_month or "").strip()
	if not value and not required:
		return today()[:7]
	if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", value):
		frappe.throw("账期格式必须为 YYYY-MM，例如 2026-07。")
	return value


def _normalize_jizhong_confirmation_step(step):
	"""Validate a Jizhong monthly workflow confirmation step."""
	value = str(step or "").strip()
	if value not in JIZHONG_CONFIRMATION_STEPS and value != JIZHONG_LEGACY_INSURANCE_STEP:
		frappe.throw("确认步骤无效，请从员工档案、考勤、社会保险、住房公积金、个税或现金发放中选择。")
	return value


def get_jizhong_insurance_configuration_step(fieldnames):
	"""Return the confirmation boundary affected by a monthly rate edit."""
	fields = {str(fieldname) for fieldname in (fieldnames or [])}
	changes_social = bool(fields & JIZHONG_SOCIAL_INSURANCE_SETTING_FIELDS)
	changes_housing = bool(fields & JIZHONG_HOUSING_FUND_SETTING_FIELDS)
	changes_tax = "tax_threshold" in fields or "tax_cycle_start_month" in fields
	if changes_tax and not changes_social and not changes_housing:
		return "tax"
	if changes_social and not changes_housing:
		return "social_insurance"
	if changes_housing and not changes_social:
		return "housing_fund"
	return JIZHONG_LEGACY_INSURANCE_STEP


def _get_jizhong_settlement_doc(company, period_month, create=False):
	"""Return the period settlement document, optionally creating its audit shell."""
	doc_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		return frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	if not create:
		return None

	assert_doctype_permission("Ashan Monthly Payroll Settlement", "create")
	doc = frappe.new_doc("Ashan Monthly Payroll Settlement")
	doc.company = company
	doc.period_month = period_month
	doc.status = "草稿"
	doc.workflow_stage = "草稿"
	doc.insert()
	return doc


def _get_jizhong_confirmation_state(doc):
	"""Read the latest auditable confirmation event for every workflow step."""
	state = {
		step: {
			"confirmed": False,
			"confirmed_by": None,
			"confirmed_at": None,
		}
		for step in JIZHONG_CONFIRMATION_STEPS
	}
	if not doc:
		return state

	comments = frappe.db.get_all(
		"Comment",
		filters={
			"reference_doctype": "Ashan Monthly Payroll Settlement",
			"reference_name": doc.name,
			"comment_type": "Comment",
		},
		fields=["content", "owner", "creation"],
		order_by="creation asc, name asc",
	)
	for comment in comments:
		content = str(comment.get("content") or "")
		if not content.startswith(JIZHONG_CONFIRMATION_PREFIX):
			continue
		try:
			event = json.loads(content[len(JIZHONG_CONFIRMATION_PREFIX):])
		except (TypeError, ValueError, json.JSONDecodeError):
			continue
		if event.get("action") == "reset":
			for s in state:
				state[s] = {"confirmed": False, "confirmed_by": None, "confirmed_at": None}
			continue
		step = event.get("step")
		if step == JIZHONG_LEGACY_INSURANCE_STEP:
			target_steps = JIZHONG_INSURANCE_CONFIRMATION_STEPS
		elif step in state:
			target_steps = (step,)
		else:
			continue
		is_confirmed = event.get("action") == "confirm"
		for target_step in target_steps:
			state[target_step] = {
				"confirmed": is_confirmed,
				"confirmed_by": comment.get("owner") if is_confirmed else None,
				"confirmed_at": comment.get("creation") if is_confirmed else None,
			}
	return state


def _record_jizhong_confirmation_event(doc, step, action, reason=None):
	"""Append one immutable workflow confirmation event to the settlement timeline."""
	event = {"step": step, "action": action}
	if reason:
		event["reason"] = frappe.utils.escape_html(str(reason).strip())
	doc.add_comment(
		"Comment",
		text=f"{JIZHONG_CONFIRMATION_PREFIX}{json.dumps(event, ensure_ascii=False, sort_keys=True)}",
	)


def _clear_jizhong_calculation(doc):
	"""Invalidate derived payroll rows after an upstream source confirmation is revoked."""
	doc.items = []
	doc.status = "草稿"
	doc.workflow_stage = "草稿"
	for fieldname in (
		"total_employees",
		"total_gross_salary",
		"total_net_salary",
		"total_social_security_company",
		"total_social_security_person",
		"total_housing_fund_company",
		"total_housing_fund_person",
		"total_tax",
	):
		setattr(doc, fieldname, 0)
	doc.save()


def assert_jizhong_workflow_step_editable(company, period_month, step):
	"""Reject edits to a confirmed Jizhong monthly source step."""
	period_month = _normalize_jizhong_period(period_month)
	step = _normalize_jizhong_confirmation_step(step)
	company = _assert_jizhong_access("write", company)
	doc = _get_jizhong_settlement_doc(company, period_month)
	if not doc:
		return
	if cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】已核定封账，不能修改{JIZHONG_STEP_LABELS[step]}。")
	confirmations = _get_jizhong_confirmation_state(doc)
	steps_to_check = (
		JIZHONG_INSURANCE_CONFIRMATION_STEPS
		if step == JIZHONG_LEGACY_INSURANCE_STEP
		else (step,)
	)
	confirmed_steps = [
		JIZHONG_STEP_LABELS[item]
		for item in steps_to_check
		if confirmations[item]["confirmed"]
	]
	if confirmed_steps:
		frappe.throw(
			f"【{period_month}】{'、'.join(confirmed_steps)}已确认并处于只读保护。"
			"请先取消该步骤的确认后再修改。"
		)


def _jizhong_profile_doctype() -> str:
	"""Return the dedicated Jizhong profile DocType without cross-company fallback."""
	doctype = "Jizhong Employee Salary Profile"
	if not frappe.db.table_exists(doctype):
		frappe.throw("吉众员工薪资档案模块未安装，不能回退到祺富或通用薪酬档案。")
	return doctype


JIZHONG_BASE_MODE_MINIMUM = "最低基数"
JIZHONG_BASE_MODE_FIXED = "固定基数"
JIZHONG_BASE_MODE_CUSTOM = "自定义"
JIZHONG_BASE_MODE_DYNAMIC = "动态基数(税前工资20%)"
JIZHONG_BASE_MODE_EXEMPT = "不参保"
JIZHONG_BASE_MODES = {
	"最低基数", "最低缴费基数",
	"固定基数", "自定义",
	"动态基数(税前工资5%)", "动态基数(税前工资20%)", "动态基数",
	"不参保", "不缴纳",
}
JIZHONG_BASE_MODE_LEGACY = "历史基数，待选择"
JIZHONG_SS_COMPANY_COMPONENTS = (
	("pension", "ss_company_pension"),
	("medical", "ss_company_medical"),
	("unemployment", "ss_company_unemployment"),
	("other_medical", "ss_company_other_medical"),
	("injury", "ss_company_injury"),
)
JIZHONG_SS_PERSON_COMPONENTS = (
	("pension", "ss_person_pension"),
	("medical", "ss_person_medical"),
	("unemployment", "ss_person_unemployment"),
)


def _normalize_jizhong_base_mode(value, label):
	"""Validate an explicit Jizhong insurance-base mode."""
	mode = str(value or "").strip()
	if mode not in JIZHONG_BASE_MODES:
		frappe.throw(f"{label}方式只能选择最低基数、固定基数、动态基数或不缴纳。")
	return mode


def _resolve_jizhong_base(profile, setting, base_type):
	"""Resolve one base while preserving the persisted legacy profile fields."""
	if base_type == "social_security":
		mode_field = "social_security_base_mode"
		custom_field = "custom_social_security_base"
		legacy_field = "social_security_base"
		minimum_field = "ss_min_base"
		label = "社险申报基数"
	else:
		mode_field = "housing_fund_base_mode"
		custom_field = "custom_housing_fund_base"
		legacy_field = "housing_fund_base"
		minimum_field = "hf_min_base"
		label = "公积金申报基数"

	getter = (
		profile.get
		if hasattr(profile, "get")
		else lambda key, default=None: getattr(profile, key, default)
	)
	raw_mode = str(getter(mode_field) or "").strip()
	if not raw_mode:
		legacy_value = round(flt(getter(legacy_field)), 2)
		if legacy_value < 0:
			frappe.throw(f"{label}不能为负数。")
		return {
			"mode": "",
			"base": legacy_value,
			"source": JIZHONG_BASE_MODE_LEGACY,
			"needs_selection": legacy_value <= 0,
		}

	mode = _normalize_jizhong_base_mode(raw_mode, label)
	if mode in ("不参保", "不缴纳"):
		return {"mode": mode, "base": 0.0, "source": mode, "needs_selection": False}

	if "动态基数" in mode:
		sal_ref = (
			flt(getter("gross_salary"))
			or (
				flt(getter("base_salary"))
				+ flt(getter("post_allowance"))
				+ flt(getter("house_rent_allowance") or getter("other_allowance"))
				+ flt(getter("performance_base"))
			)
			or flt(getter("fixed_salary"))
		)
		if base_type == "housing_fund":
			hf_rate = flt(setting_getter("hf_company_rate") or 5.0)
			val = round(sal_ref * (hf_rate / 100.0), 2)
			return {
				"mode": "动态基数(税前工资5%)",
				"base": val,
				"source": f"动态基数(税前工资{hf_rate:g}%)",
				"needs_selection": False,
			}
		else:
			val = round(sal_ref * 0.20, 2)
			return {
				"mode": "动态基数(税前工资20%)",
				"base": val,
				"source": "动态基数(税前工资20%)",
				"needs_selection": False,
			}

	if mode in ("固定基数", "自定义", JIZHONG_BASE_MODE_CUSTOM):
		value = getter(custom_field)
		if value in (None, ""):
			value = getter(legacy_field)
		value = flt(value)
		if value < 0:
			frappe.throw(f"{label}不能为负数。")
		value = round(value, 2)
		return {
			"mode": "固定基数",
			"base": value,
			"source": "固定基数",
			"needs_selection": False,
		}

	setting_getter = (
		setting.get
		if hasattr(setting, "get")
		else lambda key, default=None: getattr(setting, key, default)
	)
	value = round(max(0.0, flt(setting_getter(minimum_field))), 2)
	return {
		"mode": "最低基数",
		"base": value,
		"source": "最低基数",
		"needs_selection": False,
	}


def _apply_jizhong_effective_bases(profile, setting, period_month=None):
	"""Attach period-effective bases and retirement calculations without replacing persisted profile values."""
	ss = _resolve_jizhong_base(profile, setting, "social_security")
	hf = _resolve_jizhong_base(profile, setting, "housing_fund")
	profile["effective_social_security_base"] = ss["base"]
	profile["social_security_base_source"] = ss["source"]
	profile["social_security_base_needs_selection"] = ss["needs_selection"]
	profile["effective_housing_fund_base"] = hf["base"]
	profile["housing_fund_base_source"] = hf["source"]
	profile["housing_fund_base_needs_selection"] = hf["needs_selection"]

	try:
		from ashan_cn_procurement.services.retirement_policy_service import calculate_retirement_details
		ret = calculate_retirement_details(
			certificate_type=profile.get("certificate_type") or "居民身份证",
			certificate_number=profile.get("id_card"),
			birth_date=str(profile.get("birth_date") or ""),
			gender=profile.get("gender"),
			retirement_category=profile.get("retirement_category"),
			original_retirement_age=profile.get("original_retirement_age"),
			delayed_retirement_age=profile.get("delayed_retirement_age"),
			job_title="操作工",
			ref_period_month=period_month,
		)
		profile["current_age"] = ret.get("current_age")
		profile["current_age_detail"] = ret.get("current_age_detail")
		profile["retirement_category"] = ret.get("retirement_category")
		profile["original_retirement_age"] = ret.get("original_retirement_age")
		profile["original_retirement_age_str"] = ret.get("original_retirement_age_str")
		profile["original_retirement_period"] = ret.get("original_retirement_period")
		profile["delayed_retirement_age"] = ret.get("delayed_retirement_age")
		profile["delayed_retirement_age_str"] = ret.get("delayed_retirement_age_str")
		profile["delayed_retirement_period"] = ret.get("delayed_retirement_period")
		profile["primary_retirement_warning"] = ret.get("primary_retirement_warning")
		profile["original_retirement_warning"] = ret.get("original_retirement_warning")
		profile["delayed_retirement_warning"] = ret.get("delayed_retirement_warning")
		profile["retirement_warning_status"] = ret.get("original_warning_status")
	except Exception:
		pass
	return profile


def _jizhong_profiles_missing_base_selection(profiles, period_month, insurance_setting):
	"""List unresolved social-security and housing-fund base selections separately."""
	issues = []
	for profile in profiles:
		employee_type = profile.get("employee_type")
		employee = f"{profile.get('employee_name') or ''}（{profile.get('employee_no') or ''}）"
		social_reason = _jizhong_statutory_exclusion_reason(
			employee_type, "social_security"
		)
		if (
			not social_reason
			and not str(profile.get("social_security_base_mode") or "").strip()
			and flt(profile.get("social_security_base")) <= 0
		):
			issues.append(f"{employee}未选择社险申报基数方式")

		housing_reason = _jizhong_statutory_exclusion_reason(
			employee_type, "housing_fund"
		)
		if housing_reason or flt(insurance_setting.get("hf_min_base")) <= 0:
			continue
		housing_decision = _evaluate_jizhong_housing_fund_policy(
			profile, period_month, insurance_setting
		)
		if (
			housing_decision.get("is_contributing")
			and not str(profile.get("housing_fund_base_mode") or "").strip()
			and flt(profile.get("housing_fund_base")) <= 0
		):
			issues.append(f"{employee}未选择公积金申报基数方式")
	return issues


def _jizhong_insurance_setting_errors(insurance_setting):
	"""Return configuration blockers before a dynamic minimum base is used."""
	getter = (
		insurance_setting.get
		if hasattr(insurance_setting, "get")
		else lambda key, default=None: getattr(insurance_setting, key, default)
	)
	errors = []
	if not getter("is_configured"):
		errors.append("当前账期社保公积金配置尚未保存")
	if flt(getter("ss_min_base")) <= 0:
		errors.append("社保最低缴费基数未配置")
	if flt(getter("hf_min_base")) <= 0:
		errors.append("公积金最低缴费基数未配置")
	return errors


def _calculate_jizhong_social_insurance_components(base, insurance_setting, big_medical):
	"""Round statutory components once and reuse them in the table and payroll ledger."""
	base = max(0.0, round(flt(base), 2))
	company = {
		component: round(base * flt(insurance_setting.get(fieldname)) / 100.0, 2)
		for component, fieldname in JIZHONG_SS_COMPANY_COMPONENTS
	}
	person = {
		component: round(base * flt(insurance_setting.get(fieldname)) / 100.0, 2)
		for component, fieldname in JIZHONG_SS_PERSON_COMPONENTS
	}
	person["large_medical"] = round(flt(big_medical), 2) if base > 0 else 0.0
	return {
		"company": company,
		"person": person,
		"company_total": round(sum(company.values()), 2),
		"person_total": round(sum(person.values()), 2),
	}


def _jizhong_statutory_exclusion_reason(
	employee_type,
	contribution_type,
	company="天津吉众科技有限公司",
):
	"""Return an exclusion reason for one statutory contribution only."""
	employee_type = str(employee_type or "正式工").strip()
	canonical_type = _jizhong_employee_category(employee_type)
	field_map = {
		"social_security": ("participate_social_security", "社会保险"),
		"housing_fund": ("participate_housing_fund", "住房公积金"),
	}
	if contribution_type not in field_map:
		raise ValueError(f"Unsupported contribution type: {contribution_type}")

	participation_field, contribution_label = field_map[contribution_type]
	for type_candidate in dict.fromkeys([employee_type, canonical_type]):
		policy_name = f"{company}-{type_candidate}"
		if frappe.db.exists("Jizhong Employee Type Policy", policy_name):
			policy = frappe.db.get_value(
				"Jizhong Employee Type Policy",
				policy_name,
				[participation_field, "is_active", "insurance_rule_description"],
				as_dict=True,
			)
			if policy and policy.is_active and not policy.get(participation_field):
				return f"{type_candidate}不参加{contribution_label}"
			if policy and policy.is_active:
				return ""

	if employee_type in JIZHONG_NO_INSURANCE_TYPES or canonical_type in JIZHONG_NO_INSURANCE_TYPES or employee_type == "兼职":
		return f"{employee_type}不参加{contribution_label}"
	return ""


def _jizhong_insurance_exclusion_reason(employee_type, company="天津吉众科技有限公司"):
	"""Compatibility helper: return a reason only when both contributions are excluded."""
	social_reason = _jizhong_statutory_exclusion_reason(
		employee_type, "social_security", company
	)
	housing_reason = _jizhong_statutory_exclusion_reason(
		employee_type, "housing_fund", company
	)
	if social_reason and housing_reason:
		return social_reason
	return ""


def _build_jizhong_insurance_confirmation_sheets(
	company,
	period_month,
	insurance_setting,
	employees_confirmed=False,
	social_confirmed=False,
	housing_confirmed=False,
):
	"""Build the in-memory Jizhong social-insurance and housing-fund sheets."""
	period_month = _normalize_jizhong_period(period_month)
	payment_period = _compute_next_period(period_month)
	configuration_errors = _jizhong_insurance_setting_errors(insurance_setting)
	preview_reasons = []
	if not employees_confirmed:
		preview_reasons.append("请先确认员工薪资档案")
	preview_reasons.extend(configuration_errors)
	if configuration_errors:
		return {
			"ready": False,
			"preview_ready": False,
			"print_ready": False,
			"edition": "未就绪",
			"reason": "；".join(preview_reasons),
			"company": company,
			"period_month": period_month,
			"payment_period_month": payment_period,
			"social_insurance": {"title": "社会保险确认表", "rows": [], "totals": {}},
			"housing_fund": {"title": "住房公积金确认表", "rows": [], "totals": {}},
		}
	profiles = _jizhong_active_profiles(
		company,
		fields=[
			"employee_no", "employee_name", "employee_type", "employment_status",
			"social_security_base", "social_security_base_mode", "custom_social_security_base",
			"housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base",
			"housing_fund_policy",
		],
	)
	for profile in profiles:
		_apply_jizhong_effective_bases(profile, insurance_setting)

	overrides = get_override_map(company, period_month)
	big_medical = resolve_big_medical_amount(
		insurance_setting,
		payroll_period_month=period_month,
		payment_period_month=payment_period,
	)

	social_rows = []
	housing_rows = []
	for sequence, employee in enumerate(profiles, start=1):
		employee_type = str(employee.get("employee_type") or "正式工").strip()
		social_exclusion_reason = _jizhong_statutory_exclusion_reason(
			employee_type, "social_security", company
		)
		housing_exclusion_reason = _jizhong_statutory_exclusion_reason(
			employee_type, "housing_fund", company
		)
		ss_base = (
			0.0
			if social_exclusion_reason
			else flt(employee.get("effective_social_security_base"))
		)
		base_source = employee.get("social_security_base_source") or JIZHONG_BASE_MODE_LEGACY
		social_status_reason = social_exclusion_reason
		if ss_base <= 0 and not social_status_reason:
			social_status_reason = "社险申报基数为 0，当前不生成缴费金额"

		contributions = _calculate_jizhong_social_insurance_components(
			ss_base, insurance_setting, big_medical
		)
		company_amounts = contributions["company"]
		person_amounts = contributions["person"]
		company_total = contributions["company_total"]
		person_total = contributions["person_total"]
		social_rows.append({
			"seq": sequence,
			"employee_no": employee.get("employee_no"),
			"employee_name": employee.get("employee_name"),
			"employee_type": employee_type,
			"employee_category": _jizhong_employee_category(
				employee_type, employee.get("employment_status")
			),
			"base_mode": base_source,
			"base": round(ss_base, 2),
			"person_pension": person_amounts["pension"],
			"person_medical": person_amounts["medical"],
			"person_unemployment": person_amounts["unemployment"],
			"person_large_medical": round(person_amounts["large_medical"], 2),
			"person_total": person_total,
			"company_pension": company_amounts["pension"],
			"company_medical": company_amounts["medical"],
			"company_unemployment": company_amounts["unemployment"],
			"company_other_medical": company_amounts["other_medical"],
			"company_injury": company_amounts["injury"],
			"company_total": company_total,
			"grand_total": round(company_total + person_total, 2),
			"status": "不参保" if social_status_reason else "参保",
			"status_reason": social_status_reason,
		})

		hf_override = overrides.get(str(employee.get("employee_no") or ""))
		if housing_exclusion_reason:
			hf_decision = {
				"effective_base": 0.0,
				"is_contributing": False,
				"decision_label": "不参与",
				"decision_source": "用工规则",
				"decision_code": "INELIGIBLE_TYPE",
				"employee_policy": employee.get("housing_fund_policy") or "跟随公司规则",
				"monthly_override": "",
				"reason": housing_exclusion_reason,
			}
		else:
			hf_decision = _evaluate_jizhong_housing_fund_policy(
				employee,
				period_month,
				insurance_setting,
				hf_override.override_mode if hf_override else "",
			)
		hf_base = round(flt(hf_decision.get("effective_base")), 2)
		hf_person_rate = flt(insurance_setting.get("hf_person_rate"))
		hf_company_rate = flt(insurance_setting.get("hf_company_rate"))
		hf_person_amount = round(hf_base * hf_person_rate / 100.0, 2)
		hf_company_amount = round(hf_base * hf_company_rate / 100.0, 2)
		housing_rows.append({
			"seq": sequence,
			"employee_no": employee.get("employee_no"),
			"employee_name": employee.get("employee_name"),
			"employee_type": employee_type,
			"base_mode": employee.get("housing_fund_base_source") or JIZHONG_BASE_MODE_LEGACY,
			"master_base": round(flt(employee.get("effective_housing_fund_base")), 2),
			"effective_base": hf_base,
			"person_rate": hf_person_rate,
			"person_amount": hf_person_amount,
			"company_rate": hf_company_rate,
			"company_amount": hf_company_amount,
			"total_amount": round(hf_person_amount + hf_company_amount, 2),
			"status": "缴纳" if hf_decision.get("is_contributing") else "停缴",
			"decision_label": hf_decision.get("decision_label") or "-",
			"decision_source": hf_decision.get("decision_source") or "-",
			"status_reason": hf_decision.get("reason") or "",
			"housing_fund_policy": get_jizhong_housing_fund_policy_label(
				hf_decision.get("employee_policy")
			),
			"monthly_override": hf_decision.get("monthly_override") or "",
		})

	def sum_field(rows, field):
		return round(sum(flt(row.get(field)) for row in rows), 2)

	social_totals = {
		"row_count": len(social_rows),
		"contributor_count": sum(1 for row in social_rows if row["status"] == "参保"),
		"excluded_count": sum(1 for row in social_rows if row["status"] != "参保"),
		"base": sum_field(social_rows, "base"),
		"person_pension": sum_field(social_rows, "person_pension"),
		"person_medical": sum_field(social_rows, "person_medical"),
		"person_unemployment": sum_field(social_rows, "person_unemployment"),
		"person_large_medical": sum_field(social_rows, "person_large_medical"),
		"person_total": sum_field(social_rows, "person_total"),
		"company_pension": sum_field(social_rows, "company_pension"),
		"company_medical": sum_field(social_rows, "company_medical"),
		"company_unemployment": sum_field(social_rows, "company_unemployment"),
		"company_other_medical": sum_field(social_rows, "company_other_medical"),
		"company_injury": sum_field(social_rows, "company_injury"),
		"company_total": sum_field(social_rows, "company_total"),
		"grand_total": sum_field(social_rows, "grand_total"),
	}
	housing_totals = {
		"row_count": len(housing_rows),
		"contributor_count": sum(1 for row in housing_rows if row["status"] == "缴纳"),
		"stopped_count": sum(1 for row in housing_rows if row["status"] != "缴纳"),
		"master_base": sum_field(housing_rows, "master_base"),
		"effective_base": sum_field(housing_rows, "effective_base"),
		"person_amount": sum_field(housing_rows, "person_amount"),
		"company_amount": sum_field(housing_rows, "company_amount"),
		"total_amount": sum_field(housing_rows, "total_amount"),
	}

	preview_ready = not preview_reasons
	social_print_ready = preview_ready and social_confirmed
	housing_print_ready = preview_ready and housing_confirmed
	reasons = list(preview_reasons)
	if not social_confirmed:
		reasons.append("请先确认社会保险")
	if not housing_confirmed:
		reasons.append("请先确认住房公积金")

	proof_doc = {}
	settle_doc_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", settle_doc_name):
		proof_doc = frappe.db.get_value(
			"Ashan Monthly Payroll Settlement",
			settle_doc_name,
			["ss_payment_file", "ss_parsed_amount", "ss_verify_status", "hf_payment_file", "hf_parsed_amount", "hf_verify_status"],
			as_dict=True,
		) or {}

	return {
		"ready": social_print_ready and housing_print_ready,
		"preview_ready": preview_ready,
		"print_ready": social_print_ready and housing_print_ready,
		"edition": "已确认版" if social_print_ready and housing_print_ready else "核对版（未确认）",
		"reason": "；".join(reasons),
		"company": company,
		"period_month": period_month,
		"payment_period_month": payment_period,
		"social_insurance": {
			"title": "社会保险确认表",
			"rows": social_rows,
			"totals": social_totals,
			"big_medical_amount": round(big_medical, 2),
			"print_ready": social_print_ready,
			"edition": "已确认版" if social_print_ready else "核对版（未确认）",
			"proof_file": proof_doc.get("ss_payment_file"),
			"parsed_amount": round(flt(proof_doc.get("ss_parsed_amount", 0.0)), 2),
			"verify_status": proof_doc.get("ss_verify_status") or "待上传",
		},
		"housing_fund": {
			"title": "住房公积金确认表",
			"rows": housing_rows,
			"totals": housing_totals,
			"policy_month": payment_period,
			"print_ready": housing_print_ready,
			"edition": "已确认版" if housing_print_ready else "核对版（未确认）",
			"proof_file": proof_doc.get("hf_payment_file"),
			"parsed_amount": round(flt(proof_doc.get("hf_parsed_amount", 0.0)), 2),
			"verify_status": proof_doc.get("hf_verify_status") or "待上传",
		},
	}


def _jizhong_employee_category(employee_type, employment_status=None):
	"""Map legacy Jizhong employee values to the five report categories."""
	status = str(employment_status or "").strip()
	raw_type = str(employee_type or "正式工").strip()
	if raw_type in {"本月离职", "本月离职人员"} or status == "本月离职":
		return "本月离职人员"
	if raw_type in {"返聘工", "退休返聘", "退休返聘人员", "其他-返聘工"}:
		return "退休返聘人员"
	if raw_type in {"临时工", "零工"}:
		return "临时工"
	if raw_type in {"正式工", "其他-正式工"}:
		return "正式工"
	return "其他类型员工"


def _jizhong_active_profiles(company, fields):
	"""Return only employees eligible for the selected Jizhong payroll month."""
	return frappe.get_list(
		_jizhong_profile_doctype(),
		filters={"company": company},
		or_filters=[
			{"employment_status": ["in", ["在职", "本月离职"]]},
			{"employee_type": ["in", ["本月离职", "本月离职人员"]]},
		],
		fields=fields,
		order_by="employee_no asc",
		limit_page_length=0,
	)


# 7 级综合所得年度个税税率表与累计计算 (委托统一中国居民个税核心引擎)
from ashan_cn_procurement.services.payroll_settlement_service import (
	calculate_cumulative_tax as _pss_calculate_cumulative_tax,
	derive_gross_from_net as _pss_derive_gross_from_net,
	money_round as _pss_money_round,
	resolve_tax_bracket as _pss_resolve_tax_bracket,
)

TAX_BRACKETS_ANNUAL = [
	(0.0, 36000.0, 0.03, 0.0),
	(36000.0, 144000.0, 0.10, 2520.0),
	(144000.0, 300000.0, 0.20, 16920.0),
	(300000.0, 420000.0, 0.25, 31920.0),
	(420000.0, 660000.0, 0.30, 52920.0),
	(660000.0, 960000.0, 0.35, 85920.0),
	(960000.0, 999999999.0, 0.45, 181920.0),
]


def _get_annual_tax(taxable_income):
	"""根据年累计应纳税所得额计算累计应纳税额 (委托统一个税核心引擎)。"""
	return float(_pss_calculate_cumulative_tax(taxable_income))


def derive_jizhong_gross_from_net(
	target_net,
	special_deductions_cur=0.0,
	tax_threshold=5000.0,
	prev_gross=0.0,
	prev_threshold=0.0,
	prev_special_ded=0.0,
	prev_additional_ded=0.0,
	prev_tax_paid=0.0,
	cur_additional_ded=0.0,
	actual_payroll_deduction_cur=None,
):
	"""
	委托统一中国居民个税核心引擎 (payroll_settlement_service.derive_gross_from_net)
	1:1 严格复刻《个人所得税.bas》个人所得税_辅助函数_反推计算应缴所得税，
	根据约定税后净发，闭式反推当月税前薪酬、当月代扣个税与累计税金。
	"""
	if actual_payroll_deduction_cur is None:
		actual_payroll_deduction_cur = special_deductions_cur

	res = _pss_derive_gross_from_net(
		target_net=target_net,
		actual_payroll_deduction_cur=actual_payroll_deduction_cur,
		gross_prior=prev_gross,
		threshold_cur=tax_threshold,
		threshold_prior=prev_threshold,
		spec_ded_cur=special_deductions_cur,
		spec_ded_prior=prev_special_ded,
		spec_add_cur=cur_additional_ded,
		spec_add_prior=prev_additional_ded,
		paid_tax_prior=prev_tax_paid,
	)
	return {
		"gross_salary": res["gross_salary"],
		"tax_amount": res["tax_amount_cur"],
		"net_salary": res["net_verified"],
		"taxable_income": res["taxable_income"],
		"cum_tax_amount": res["cum_tax_amount"],
		"tax_rate": res["tax_rate"],
		"quick_deduction": res["quick_deduction"],
	}


def split_cash_bills(cash_amount):
	"""五档人民币面额贪心拆分 (100, 50, 10, 5, 1)"""
	amt = int(cash_amount)
	b100 = amt // 100
	rem = amt % 100
	b50 = rem // 50
	rem = rem % 50
	b10 = rem // 10
	rem = rem % 10
	b5 = rem // 5
	rem = rem % 5
	b1 = rem
	return b100, b50, b10, b5, b1


@frappe.whitelist(methods=["POST"])
def calculate_jizhong_monthly_payroll(company="天津吉众科技有限公司", period_month=None):
	"""
	执行吉众月度薪酬核算全流程：
	1. 归集考勤工时与倒休抵扣
	2. 动态工作日 (168h/184h) vs 固定平均日 (172h) 双基准计算
	3. 税后管理工资闭式反推
	4. 历史个税累计预扣计算
	5. 现金发放 RoundUp 与五档点钞
	6. 生成或更新 Ashan Monthly Payroll Settlement
	"""
	# 参数防御：容错实参与形参顺序颠倒 (例如 (period_month, company) 或仅传 period_month)
	if company and ("-" in str(company) or (len(str(company)) == 7 and str(company)[:4].isdigit())) and ("公司" in str(period_month or "")):
		company, period_month = period_month, company
	elif not period_month and company and ("-" in str(company) or len(str(company)) == 7):
		period_month, company = company, "天津吉众科技有限公司"

	period_month = _normalize_jizhong_period(period_month)
	company = _assert_jizhong_access("write", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	assert_doctype_permission("Jizhong Employee Salary Profile", "read")
	assert_doctype_permission("Jizhong Monthly Attendance", "read")
	confirmation_doc = _get_jizhong_settlement_doc(company, period_month)
	confirmations = _get_jizhong_confirmation_state(confirmation_doc)
	missing_confirmations = [
		JIZHONG_STEP_LABELS[step]
		for step in ("employees", "attendance", *JIZHONG_INSURANCE_CONFIRMATION_STEPS)
		if not confirmations[step]["confirmed"]
	]
	if missing_confirmations:
		frappe.throw(
			f"【禁止测算】{period_month} 尚未确认前置资料：{'、'.join(missing_confirmations)}。"
		"请在对应页面核验后点击确认。"
		)
	if confirmation_doc and cint(confirmation_doc.get("locked")):
		frappe.throw(f"【禁止重新测算】{period_month} 已经核定封账。请先申请反审核解锁后再测算。")
	# 1. 动态获取当月法定工作日天数
	year = cint(period_month.split("-")[0])
	month = cint(period_month.split("-")[1])
	dynamic_workdays = cint(get_month_workdays(year, month))
	if dynamic_workdays <= 0:
		frappe.throw(f"{period_month} 没有可用的法定工作日配置，无法核算薪酬。")
	dynamic_work_hours = dynamic_workdays * FULL_DAY_HOURS # 如 21天 -> 168.0h, 23天 -> 184.0h

	# 2. 获取社保公积金配置 (按月优先，默认承袭上月，并核定保存为本月)
	ins_setting = get_jizhong_insurance_setting(company=company, period_month=period_month)
	if not ins_setting.get("is_configured"):
		frappe.throw(
			f"【{company}】{period_month} 尚未确认月度社保、公积金和个税配置。"
			"请先在“社保公积金配置”中保存本月费率，再执行薪酬核算。"
		)
	configuration_errors = _jizhong_insurance_setting_errors(ins_setting)
	if configuration_errors:
		frappe.throw(f"【禁止算薪】{'；'.join(configuration_errors)}。")
	hf_person_rate = flt(ins_setting.get("hf_person_rate") or 5.0)
	hf_company_rate = flt(ins_setting.get("hf_company_rate") or 5.0)
	tax_threshold = flt(ins_setting.get("tax_threshold") or 5000.0)
	if tax_threshold <= 0:
		frappe.throw(f"【{company}】{period_month} 个税基本减除费用配置无效，必须大于 0。")

	# 按工资核算月的次月实际缴费所属期解析大额医疗金额。
	big_med = resolve_big_medical_amount(ins_setting, payroll_period_month=period_month)

	employees = _jizhong_active_profiles(
		company,
		fields=[
			"name", "employee_no", "employee_name", "employee_type", "employment_status",
			"salary_mode", "fixed_salary", "base_salary", "house_rent_allowance", "post_allowance", "performance_base",
			"meal_allowance", "salary_adjustment", "social_security_base", "social_security_base_mode", "custom_social_security_base",
			"housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base", "id_card", "mobile", "department", "job_title",
			"housing_fund_policy",
			"deduction_child_education", "deduction_continuing_education", "deduction_housing_loan",
			"deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care", "deduction_serious_illness"
		],
	)
	for employee in employees:
		_apply_jizhong_effective_bases(employee, ins_setting)
	base_selection_issues = _jizhong_profiles_missing_base_selection(
		employees, period_month, ins_setting
	)
	if base_selection_issues:
		frappe.throw(
			f"【禁止算薪】{'；'.join(base_selection_issues)}。"
			"请在员工薪资档案中明确选择最低缴费基数或自定义。"
		)

	# 4. 获取当月考勤底册
	attendances = {}
	att_records = frappe.get_list(
		"Jizhong Monthly Attendance",
		filters={"company": company, "period_month": period_month},
		fields=["*"],
		order_by="employee_no asc",
		limit_page_length=0,
	)
	for a in att_records:
		attendances[a.employee_no] = a
	coverage = _get_jizhong_attendance_coverage(company, period_month)
	if not coverage["complete"]:
		frappe.throw(
			f"【禁止算薪】{period_month} 考勤未完整覆盖需要考勤的人员："
			f"应计薪 {coverage['expected_count']} 人，已匹配 {coverage['matched_count']} 人；"
			f"无需上传考勤 {coverage.get('excluded_count', 0)} 人；"
			f"缺失工号：{'、'.join(coverage['missing_employee_nos']) or '无'}；"
			f"多余工号：{'、'.join(coverage['extra_employee_nos']) or '无'}；"
			f"姓名不一致：{'、'.join(coverage['name_mismatches']) or '无'}；"
			f"重复记录：{'、'.join(coverage['duplicate_employee_nos']) or '无'}；"
			f"缺少原始文件关联：{'、'.join(coverage['missing_file_employee_nos']) or '无'}。"
		)

	tax_cycle_start = cint(ins_setting.get("tax_cycle_start_month")) or 12
	if tax_cycle_start < 1 or tax_cycle_start > 12:
		frappe.throw("个税累计申报周期起始月必须为 1 至 12 月。")
	tax_history = _get_jizhong_tax_history(company, period_month, tax_cycle_start)
	hf_override_map = get_override_map(company, period_month)

	# 6. 初始化或加载 Settlement 单据
	doc_name = f"{company}-{period_month}"
	if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
		if cint(doc.get("locked")):
			frappe.throw(f"【{company}】{period_month} 已封账。请按解锁流程处理后再重新计算。")
		doc.items = []
	else:
		doc = frappe.new_doc("Ashan Monthly Payroll Settlement")
		doc.company = company
		doc.period_month = period_month

	doc.status = "草稿"
	doc.locked = 0
	doc.workflow_stage = "已计算"

	total_gross = 0.0
	total_net = 0.0
	total_ss_comp = 0.0
	total_ss_pers = 0.0
	total_hf_comp = 0.0
	total_hf_pers = 0.0
	total_tax = 0.0
	total_cash = 0.0

	# 委托不分钞人员工号集合
	NO_CASH_EMPS = {"L0001"}
	policy_list = get_jizhong_employee_type_policies(company)
	policy_map = {p.get("employee_type"): p for p in policy_list}

	for emp in employees:
		emp_no = emp.employee_no
		emp_name = emp.employee_name
		salary_mode = str(emp.salary_mode or "税前动态工资").strip()
		emp_type = str(emp.employee_type or "正式工").strip()
		employee_category = _jizhong_employee_category(emp_type, emp.employment_status)
		pol = policy_map.get(emp_type) or policy_map.get(employee_category) or {}
		if pol.get("participate_payroll") == 0:
			continue

		att = attendances.get(emp_no)
		if att is None and _is_jizhong_attendance_required(emp):
			# Coverage is checked above; this guard keeps a concurrent roster change
			# from turning into an opaque KeyError during payroll calculation.
			frappe.throw(f"【禁止算薪】员工【{emp_name}（{emp_no}）】缺少当月考勤记录。")
		full_days = flt(att.attendance_days) if att else 0.0
		half_days = flt(att.half_days) if att else 0.0
		absent_days = flt(att.absent_days) if att else 0.0
		work_hrs = round(flt(att.work_hours_regular), 1) if att else 0.0
		ot_1_5 = round(flt(att.overtime_regular_1_5), 1) if att else 0.0
		ot_2_0 = round(flt(att.overtime_weekend_2_0), 1) if att else 0.0
		ot_3_0 = round(flt(att.overtime_holiday_3_0), 1) if att else 0.0
		leave_comp = round(flt(att.leave_compensatory_hours), 1) if att else 0.0
		meal_cnt = cint(att.meal_count) if att else 0

		# 薪资标准项
		base_sal = flt(emp.base_salary)
		base_sub = flt(emp.house_rent_allowance)
		post_allow = flt(emp.post_allowance)
		perf_base = flt(emp.performance_base)
		fixed_sal = flt(emp.fixed_salary)
		meal_unit_price = flt(emp.meal_allowance or 15.0)
		sal_adj = flt(emp.get("salary_adjustment", 0.0))

		# 社保与公积金基数处理 (根据规则矩阵与白名单)
		no_ss = (pol.get("participate_social_security") == 0) or (emp_type in JIZHONG_NO_INSURANCE_TYPES) or (emp_type == "兼职")
		no_hf = (pol.get("participate_housing_fund") == 0) or (emp_type in JIZHONG_NO_INSURANCE_TYPES) or (emp_type == "兼职")
		ss_base = 0.0 if no_ss else flt(emp.effective_social_security_base)
		hf_override = hf_override_map.get(emp_no)
		hf_decision = _evaluate_jizhong_housing_fund_policy(
			emp,
			period_month,
			ins_setting,
			hf_override.override_mode if hf_override else "",
		)
		hf_base = 0.0 if no_hf else flt(hf_decision.get("effective_base"))

		# 专项个人扣除
		if no_ss:
			ss_components = {"company": {}, "person": {}, "company_total": 0.0, "person_total": 0.0}
			ss_pers = 0.0
			ss_comp = 0.0
		else:
			ss_components = _calculate_jizhong_social_insurance_components(
				ss_base, ins_setting, big_med
			)
			ss_pers = ss_components["person_total"]
			ss_comp = ss_components["company_total"]

		if no_hf:
			hf_pers = 0.0
			hf_comp = 0.0
		else:
			hf_pers = round(hf_base * (hf_person_rate / 100.0), 2)
			hf_comp = round(hf_base * (hf_company_rate / 100.0), 2)

		company_cost = round(ss_comp + hf_comp, 2)
		person_special_ded = round(ss_pers + hf_pers, 2)

		# 专项附加扣除
		additional_ded = round(
			flt(emp.deduction_child_education) +
			flt(emp.deduction_continuing_education) +
			flt(emp.deduction_housing_loan) +
			flt(emp.deduction_housing_rent) +
			flt(emp.deduction_elderly_care) +
			flt(emp.deduction_infant_care) +
			flt(emp.deduction_serious_illness),
			2
		)

		# 历史个税累计
		hist = tax_history.get(emp_no, {})
		prev_gross = flt(hist.get("prev_gross", 0.0))
		prev_thresh = flt(hist.get("prev_thresh", 0.0))
		prev_special_ded = flt(hist.get("prev_special_ded", 0.0))
		prev_add_ded = flt(hist.get("prev_add_ded", 0.0))
		prev_tax_paid = flt(hist.get("prev_tax_paid", 0.0))

		# 分项测算
		sal_basic_hrs = 0.0
		sal_ot_1_5 = 0.0
		sal_ot_2_0 = 0.0
		sal_ot_3_0 = 0.0
		sal_basic_sub = 0.0
		sal_perf = 0.0
		sal_post = 0.0
		sal_meal = 0.0
		sal_adj = 0.0
		gross_sal = 0.0
		tax_amt = 0.0
		net_sal = 0.0

		if is_jizhong_fixed_net_salary_mode(salary_mode):
			# 税后固定工资：工资调整算入税后工资目标（正数增加，负数扣除）
			if fixed_sal <= 0 and sal_adj <= 0:
				frappe.throw(
					f"员工【{emp_name}（{emp_no}）】的固定工资缺少有效金额，"
					"请先在薪资档案中填写大于 0 的固定工资。"
				)
			target_net = round(fixed_sal + sal_adj, 2)
			res = derive_jizhong_gross_from_net(
				target_net=target_net,
				special_deductions_cur=person_special_ded,
				tax_threshold=tax_threshold,
				prev_gross=prev_gross,
				prev_threshold=prev_thresh,
				prev_special_ded=prev_special_ded,
				prev_additional_ded=prev_add_ded,
				prev_tax_paid=prev_tax_paid,
				cur_additional_ded=additional_ded,
			)
			gross_sal = res["gross_salary"]
			tax_amt = res["tax_amount"]
			net_sal = target_net
			sal_basic_hrs = gross_sal
		elif salary_mode in ("税前固定工资", "固定工资"):
			# 税前固定工资：工资调整算入税前应发工资
			if fixed_sal <= 0 and sal_adj <= 0:
				frappe.throw(
					f"员工【{emp_name}（{emp_no}）】的固定工资缺少有效金额，"
					"请先在薪资档案中填写大于 0 的固定工资。"
				)
			gross_sal = round(fixed_sal + sal_adj, 2)
			sal_basic_hrs = gross_sal
			cum_taxable = round(
				(prev_gross + gross_sal) - (prev_thresh + tax_threshold) - (prev_special_ded + person_special_ded) - (prev_add_ded + additional_ded),
				2
			)
			cum_tax = _get_annual_tax(cum_taxable)
			tax_amt = max(0.0, round(cum_tax - prev_tax_paid, 2))
			net_sal = round(gross_sal - person_special_ded - tax_amt, 2)
		else:
			# 税前动态工资正算
			dyn_hourly = round(base_sal / dynamic_work_hours, 6) if dynamic_work_hours > 0 else 0.0
			fix_hourly = round(base_sal / FIXED_MONTHLY_HOURS, 6) # 基本工资 / 172.0
			absence_hrs = round(max(0.0, dynamic_work_hours - work_hrs), 1)

			sal_basic_hrs = round(work_hrs * dyn_hourly, 2)
			sal_ot_1_5 = round(fix_hourly * ot_1_5 * 1.5, 2)
			sal_ot_2_0 = round(fix_hourly * ot_2_0 * 2.0, 2)
			sal_ot_3_0 = round(fix_hourly * ot_3_0 * 3.0, 2)

			sal_basic_sub = round(base_sub - (base_sub / dynamic_work_hours * absence_hrs), 2) if base_sub else 0.0
			sal_perf = round(perf_base - (perf_base / FIXED_MONTHLY_HOURS * absence_hrs), 2) if perf_base else 0.0
			sal_post = round(post_allow - (post_allow / dynamic_work_hours * absence_hrs), 2) if post_allow else 0.0
			sal_meal = round(meal_unit_price * meal_cnt, 2)

			gross_sal = round(sal_basic_hrs + sal_ot_1_5 + sal_ot_2_0 + sal_ot_3_0 + sal_basic_sub + sal_perf + sal_post + sal_meal + sal_adj, 2)

			# 累计预扣个税计算
			cum_taxable = round(
				(prev_gross + gross_sal) - (prev_thresh + tax_threshold) - (prev_special_ded + person_special_ded) - (prev_add_ded + additional_ded),
				2
			)
			cum_tax = _get_annual_tax(cum_taxable)
			tax_amt = max(0.0, round(cum_tax - prev_tax_paid, 2))
			net_sal = round(gross_sal - person_special_ded - tax_amt, 2)

		person_cost = round(person_special_ded + tax_amt, 2)

		# 现金发放与配钞
		if emp_no in NO_CASH_EMPS or emp_type in ("兼职", "委托") or pol.get("participate_cash_bills") == 0:
			cash_wage = 0.0
			b100 = b50 = b10 = b5 = b1 = 0
		else:
			cash_wage = float(math.ceil(net_sal)) if net_sal > 0 else 0.0
			b100, b50, b10, b5, b1 = split_cash_bills(cash_wage)

		# 累加全局统计
		total_gross += gross_sal
		total_net += net_sal
		total_ss_comp += ss_comp
		total_ss_pers += ss_pers
		total_hf_comp += hf_comp
		total_hf_pers += hf_pers
		total_tax += tax_amt
		total_cash += cash_wage

		# 构建 Child Item
		doc.append("items", {
			"employee_no": emp_no,
			"employee_name": emp_name,
			"department": emp.department,
			"job_title": emp.job_title,
			"employee_type": employee_category,
			"salary_mode": salary_mode,
			"id_card": emp.id_card,
			"mobile": emp.mobile,
			"attendance_days": full_days,
			"half_days": half_days,
			"absent_days": absent_days,
			"work_hours": round(work_hrs, 1),
			"basic_hours": round(work_hrs, 1),
			"overtime_regular_1_5": round(ot_1_5, 1),
			"overtime_weekend_2_0": round(ot_2_0, 1),
			"overtime_holiday_3_0": round(ot_3_0, 1),
			"leave_compensatory_hours": round(leave_comp, 1),
			"meal_count": meal_cnt,
			"meal_unit_price": meal_unit_price,
			"fixed_salary": fixed_sal,
			"target_salary": net_sal if is_jizhong_post_tax_salary_mode(salary_mode) else gross_sal,
			"base_salary": base_sal,
			"house_rent_allowance": base_sub,
			"post_allowance": post_allow,
			"performance_salary": perf_base,
			"salary_basic_hours": sal_basic_hrs,
			"salary_overtime_1_5": sal_ot_1_5,
			"salary_overtime_2_0": sal_ot_2_0,
			"salary_overtime_3_0": sal_ot_3_0,
			"salary_basic_subsidy": sal_basic_sub,
			"salary_performance": sal_perf,
			"salary_post_allowance": sal_post,
			"salary_meal_subsidy": sal_meal,
			"salary_adjustment": sal_adj,
			"gross_salary": gross_sal,
			"ss_base": ss_base,
			"ss_person_total": ss_pers,
			"ss_company_total": ss_comp,
			"pension_person": ss_components["person"].get("pension", 0.0),
			"medical_person": ss_components["person"].get("medical", 0.0),
			"unemployment_person": ss_components["person"].get("unemployment", 0.0),
			"large_medical_person": ss_components["person"].get("large_medical", 0.0),
			"hf_base": hf_base,
			"hf_person_total": hf_pers,
			"hf_company_total": hf_comp,
			"housing_fund_person": hf_pers,
			"special_deductions_total": additional_ded,
			"deduction_child_education": flt(emp.get("deduction_child_education")),
			"deduction_continuing_education": flt(emp.get("deduction_continuing_education")),
			"deduction_serious_illness": flt(emp.get("deduction_serious_illness")),
			"deduction_housing_loan": flt(emp.get("deduction_housing_loan")),
			"deduction_housing_rent": flt(emp.get("deduction_housing_rent")),
			"deduction_elderly_care": flt(emp.get("deduction_elderly_care")),
			"deduction_infant_care": flt(emp.get("deduction_infant_care")),
			"tax_threshold": tax_threshold,
			"taxable_income": max(0.0, round(gross_sal - tax_threshold - person_special_ded - additional_ded, 2)),
			"tax_amount": tax_amt,
			"net_salary": net_sal,
			"company_cost_total": company_cost,
			"person_cost_total": person_cost,
			"cash_pay": cash_wage,
			"bills_100": b100,
			"bills_50": b50,
			"bills_10": b10,
			"bills_5": b5,
			"bills_1": b1,
		})

	# 更新父表总额
	doc.total_employees = len(doc.items)
	doc.total_gross_salary = round(total_gross, 2)
	doc.total_net_salary = round(total_net, 2)
	doc.total_social_security_company = round(total_ss_comp, 2)
	doc.total_social_security_person = round(total_ss_pers, 2)
	doc.total_housing_fund_company = round(total_hf_comp, 2)
	doc.total_housing_fund_person = round(total_hf_pers, 2)
	doc.total_tax = round(total_tax, 2)
	doc.save()
	# 四大前置确认后，工资核定、个人所得税、现金发放自动确认标绿
	fresh_conf = _get_jizhong_confirmation_state(doc)
	att_req = False
	for it in (doc.get("items") or []):
		sm = str(it.get("salary_mode") or "").strip()
		if not is_jizhong_fixed_net_salary_mode(sm) and sm not in ("固定工资", "税前固定工资"):
			att_req = True
			break
	if fresh_conf["employees"]["confirmed"] and fresh_conf["social_insurance"]["confirmed"] and fresh_conf["housing_fund"]["confirmed"] and (fresh_conf["attendance"]["confirmed"] or not att_req):
		if not cint(doc.get("locked")):
			_record_jizhong_confirmation_event(doc, "tax", "confirm")
			_record_jizhong_confirmation_event(doc, "cash_bills", "confirm")

	return {
		"success": True,
		"settlement_name": doc.name,
		"period_month": period_month,
		"total_employees": doc.total_employees,
		"total_gross_salary": doc.total_gross_salary,
		"total_net_salary": doc.total_net_salary,
		"total_tax": doc.total_tax,
		"total_cash": round(total_cash, 2),
	}


def _confirm_jizhong_workflow_step(company, period_month, step):
	"""Confirm one ready monthly source step and preserve an audit event."""
	if step in ("tax", "cash_bills", "payroll"):
		frappe.throw(
			f"【{period_month}】{JIZHONG_STEP_LABELS.get(step, '本表')}由前置四项（档案、社保、公积金、考勤）核定后自动生成，无需且不支持手动确认。"
		)
	if step == JIZHONG_LEGACY_INSURANCE_STEP:
		for insurance_step in JIZHONG_INSURANCE_CONFIRMATION_STEPS:
			_confirm_jizhong_workflow_step(company, period_month, insurance_step)
		return {
			"success": True,
			"step": step,
			"message": f"【{period_month}】社会保险和住房公积金已分别确认并进入只读保护。",
		}

	workflow = get_jizhong_workflow_status(company=company, period_month=period_month)
	workflow_step = next(
		(item for item in workflow["steps"] if item.get("tab") == step),
		None,
	)
	if not workflow_step or not workflow_step.get("can_confirm"):
		frappe.throw(
			f"【{period_month}】{JIZHONG_STEP_LABELS[step]}尚不满足确认条件。"
		"请先完成当前步骤及其前置核验。"
		)

	doc = _get_jizhong_settlement_doc(company, period_month, create=True)
	if cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】已核定封账，不能再确认步骤。")
	_record_jizhong_confirmation_event(doc, step, "confirm")

	# 检查前置 4 大核定步骤（员工档案、考勤与工时、社会保险、住房公积金）是否全部已确认
	fresh_confirmations = _get_jizhong_confirmation_state(doc)
	# 检查考勤工时是否必须：若本月全部人员均为固定工资，固定工资无视工时，考勤免强制核定
	attendance_required = False
	items_list = doc.get("items") or []
	if items_list:
		for it in items_list:
			sm = str(it.get("salary_mode") or "").strip()
			if not is_jizhong_fixed_net_salary_mode(sm) and sm not in ("固定工资", "税前固定工资"):
				attendance_required = True
				break
	else:
		profiles = _jizhong_active_profiles(company, fields=["salary_mode"])
		for p in profiles:
			sm = str(p.get("salary_mode") or "").strip()
			if not is_jizhong_fixed_net_salary_mode(sm) and sm not in ("固定工资", "税前固定工资"):
				attendance_required = True
				break

	required_steps = ["employees", "social_insurance", "housing_fund"]
	if attendance_required:
		required_steps.append("attendance")

	all_four_confirmed = all(
		fresh_confirmations.get(s, {}).get("confirmed")
		for s in required_steps
	)
	calc_result = None
	if all_four_confirmed and not cint(doc.get("locked")):
		try:
			calc_result = calculate_jizhong_monthly_payroll(company, period_month)
		except Exception as exc:
			frappe.log_error(f"吉众【{period_month}】四大前置确认后自动测算薪酬异常: {exc}", "Jizhong Auto Payroll Calculation")

	msg = f"【{period_month}】{JIZHONG_STEP_LABELS[step]}已确认并进入只读保护。"
	if calc_result:
		msg += " 四大前置步骤已全部核定，系统已自动生成个人所得税、工资核定表与现金发放表！"

	return {
		"success": True,
		"step": step,
		"auto_calculated": bool(calc_result),
		"message": msg,
	}


def _resolve_jizhong_calculation_cancel_targets(step, doc, confirmations):
	"""根据实际计算血缘与数据衍生依赖动态解析取消目标：
	只要在计算上有直接或间接衍生依赖的，取消时一并联动取消；
	无计算依赖的步骤严格保持独立。
	"""
	has_payroll_calculation = bool(
		doc
		and (
			len(doc.get("items") or []) > 0
			or flt(doc.get("total_gross_salary")) > 0
			or str(doc.get("workflow_stage") or "") in ("已计算", "凭证核验通过", "已封账")
		)
	)
	has_tax_confirmed = bool(confirmations.get("tax", {}).get("confirmed"))
	has_cash_confirmed = bool(confirmations.get("cash_bills", {}).get("confirmed"))
	has_downstream_active = has_payroll_calculation or has_tax_confirmed or has_cash_confirmed

	targets = []
	independent = []
	clear_calc = False
	explanation = ""

	if step in ("tax", "cash_bills", "payroll"):
		targets = [s for s in JIZHONG_CONFIRMATION_STEPS if confirmations.get(s, {}).get("confirmed")]
		clear_calc = True
		explanation = "动态计算关联：个人所得税、工资核定与现金发放属于下游综合结算链条，取消将一并全部取消所有已确认步骤并清空测算结果。"

	elif has_downstream_active:
		clear_calc = True
		downstream_canceled = [s for s in ("tax", "cash_bills") if confirmations.get(s, {}).get("confirmed")]

		if step in ("employees", "social_insurance", "housing_fund"):
			linked_core = [
				s for s in ("employees", "social_insurance", "housing_fund")
				if confirmations.get(s, {}).get("confirmed")
			]
			targets = list(dict.fromkeys(linked_core + downstream_canceled))
			if confirmations.get("attendance", {}).get("confirmed"):
				independent.append("attendance")
			explanation = (
				"动态计算关联：检测到当前已生成月度工资测算。取消员工档案/社保/公积金将联动取消这三项强绑定步骤，"
				"并同步清空受其基数影响的个人所得税、工资核定与现金发放。"
				+ ("【考勤与工时】无基数计算耦合，将保持已确认状态。" if "attendance" in independent else "")
			)

		elif step == "attendance":
			targets = list(dict.fromkeys(["attendance"] + downstream_canceled))
			for s in ("employees", "social_insurance", "housing_fund"):
				if confirmations.get(s, {}).get("confirmed"):
					independent.append(s)
			explanation = (
				"动态计算关联：检测到当前已生成月度工资测算。取消考勤工时将仅取消工时本身，"
				"并同步清空受其工时影响的工资核定、个税与现金发放。"
				+ ("【员工档案、社会保险、住房公积金】无工时数据耦合，将保持已确认状态。" if independent else "")
			)

	else:
		if step in ("employees", "social_insurance", "housing_fund"):
			targets = [
				s for s in ("employees", "social_insurance", "housing_fund")
				if confirmations.get(s, {}).get("confirmed")
			]
			if confirmations.get("attendance", {}).get("confirmed"):
				independent.append("attendance")
			explanation = (
				"动态计算关联：员工档案与社保、公积金存在直接的缴费基数与策略计算关联，将同步联动取消。"
				+ ("【考勤与工时】与当前操作无计算耦合，保持独立确认状态不变。" if "attendance" in independent else "")
			)

		elif step == "attendance":
			targets = ["attendance"]
			for s in ("employees", "social_insurance", "housing_fund"):
				if confirmations.get(s, {}).get("confirmed"):
					independent.append(s)
			explanation = (
				"动态计算关联：当前尚未生成综合工资核定，考勤工时与员工档案、社保、公积金无任何计算交集，将仅独立取消考勤与工时。"
			)

		else:
			targets = [step]
			explanation = f"动态计算关联：取消{JIZHONG_STEP_LABELS.get(step, step)}确认。"

	if step not in targets and step in JIZHONG_CONFIRMATION_STEPS and confirmations.get(step, {}).get("confirmed"):
		targets.insert(0, step)

	return targets, independent, clear_calc, explanation

def _cancel_jizhong_workflow_confirmation(company, period_month, step, reason):
	"""按用户业务隔离与强锁定规则执行取消确认：
	1. 员工档案 (employees) 与 考勤与工时 (attendance) 相互独立，互不影响对方取消；
	2. 社保、公积金和员工档案强锁定，要取消一起取消；
	3. 个人所得税、工资核定、现金发放与所有前置步骤强行锁定，要取消都全部取消。
	"""
	if step in ("tax", "cash_bills", "payroll"):
		frappe.throw(
			f"【{period_month}】{JIZHONG_STEP_LABELS.get(step, '本表')}由前置四项（档案、社保、公积金、考勤）核定后自动生成，不允许单独取消。如需修改，请取消前置四项中的对应底册。"
		)
	if step == JIZHONG_LEGACY_INSURANCE_STEP:
		step = "social_insurance"

	reason = str(reason or "").strip()
	if len(reason) < 4:
		frappe.throw("取消确认必须填写明确原因（至少 4 个字符）。")
	doc = _get_jizhong_settlement_doc(company, period_month)
	if not doc:
		frappe.throw(f"【{period_month}】尚无确认记录，不能取消确认。")
	if cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】已核定封账，请先按反审核解锁流程处理。")

	confirmations = _get_jizhong_confirmation_state(doc)
	if step in confirmations and not confirmations[step]["confirmed"]:
		frappe.throw(f"【{period_month}】{JIZHONG_STEP_LABELS.get(step, step)}尚未确认，不能取消。")

	targets, independent, clear_calc, explanation = _resolve_jizhong_calculation_cancel_targets(
		step, doc, confirmations
	)

	if clear_calc:
		_clear_jizhong_calculation(doc)

	canceled_labels = []
	for t in targets:
		_record_jizhong_confirmation_event(doc, t, "cancel", reason=reason)
		canceled_labels.append(JIZHONG_STEP_LABELS.get(t, t))

	return {
		"success": True,
		"step": step,
		"canceled_steps": targets,
		"message": (
			f"【{period_month}】已成功取消确认：{'、'.join(canceled_labels)}，可恢复修改。"
			+ ("已同步清除依赖的薪酬测算结果。" if clear_calc else "")
		),
	}


@frappe.whitelist(methods=["POST"])
def lock_jizhong_monthly_payroll(company="天津吉众科技有限公司", period_month=None, step=None):
	"""Lock one Jizhong payroll period through the canonical payroll policy."""
	period_month = _normalize_jizhong_period(period_month)
	if step:
		step = _normalize_jizhong_confirmation_step(step)
		company = _assert_jizhong_access("write", company)
		assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
		return _confirm_jizhong_workflow_step(company, period_month, step)
	company = _assert_jizhong_access("lock", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	doc_name = f"{company}-{period_month}"
	if not frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		frappe.throw(f"未找到【{company}】{period_month} 的薪酬核算记录，无法执行封账！")
	doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	if cint(doc.get("locked")):
		return {"success": True, "message": f"【{company}】{period_month} 已处于封账状态。"}
	workflow = get_jizhong_workflow_status(company=company, period_month=period_month)
	if not workflow.get("can_lock"):
		pending = [
			f"第 {step.get('step')} 步 {step.get('title')}（待确认）"
			for step in workflow.get("steps", [])
			if step.get("tab") in JIZHONG_CONFIRMATION_STEPS
			and not step.get("is_confirmed")
			and (step.get("tab") != "attendance" or workflow.get("attendance_required", True))
		]
		payroll_step = next(
			(step for step in workflow.get("steps", []) if step.get("tab") == "payroll"),
			None,
		)
		if payroll_step and not payroll_step.get("is_ready"):
			pending.append("月度工资核定表（待测算）")
		frappe.throw(
			f"【禁止封账】{period_month} 尚未完成前置任务：{ '、'.join(pending) or '薪酬计算状态' }。"
			"请完成前置任务后重试。"
		)
	doc.locked = 1
	doc.status = "已核定锁定"
	if hasattr(doc, "workflow_stage"):
		doc.workflow_stage = "已封账"
	if hasattr(doc, "confirmed_by"):
		doc.confirmed_by = frappe.session.user
	if hasattr(doc, "confirmed_date"):
		doc.confirmed_date = now_datetime()
	doc.save()
	return {"success": True, "message": f"【{company}】{period_month} 薪酬已成功核定并锁定（只读封账）！"}



@frappe.whitelist(methods=["POST"])
def unlock_jizhong_monthly_payroll(company="天津吉众科技有限公司", period_month=None, reason="", step=None):
	"""Unlock one Jizhong payroll period with a mandatory audit reason."""
	period_month = _normalize_jizhong_period(period_month)
	if step:
		step = _normalize_jizhong_confirmation_step(step)
		company = _assert_jizhong_access("write", company)
		assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
		return _cancel_jizhong_workflow_confirmation(company, period_month, step, reason)
	company = _assert_jizhong_access("unlock", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	assert_doctype_permission("Jizhong Monthly Attendance", "delete")
	assert_doctype_permission("File", "delete")
	reason = str(reason or "").strip()
	if len(reason) < 4:
		frappe.throw("解锁必须填写明确原因（至少 4 个字符）。")
	doc_name = f"{company}-{period_month}"
	if not frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		frappe.throw(f"未找到【{company}】{period_month} 的薪酬核算记录！")
	doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	if not cint(doc.get("locked")):
		frappe.throw("当前账期尚未封账，不能执行解锁。")
	doc.locked = 0
	doc.status = "草稿"
	if hasattr(doc, "workflow_stage"):
		doc.workflow_stage = "已解锁"
	if hasattr(doc, "unlocked_by"):
		doc.unlocked_by = frappe.session.user
	if hasattr(doc, "unlock_reason"):
		doc.unlock_reason = reason
	doc.save()
	doc.add_comment("Comment", text=f"薪酬解锁：{reason}")
	return {"success": True, "message": f"【{company}】{period_month} 薪酬已成功解锁，可重新测算！"}


@frappe.whitelist()
def get_jizhong_workflow_status(company="天津吉众科技有限公司", period_month=None):
	"""
	获取吉众月度确认、测算与核定流程状态。
	1. 员工薪资信息表 (权威底册核实)
	2. 考勤工时与打卡底册 (工时、加班、倒休抵扣核实)
	3. 社保公积金配置 (年度费率生效核实)
	4. 个人所得税台账 (累计预扣与专项附加核实)
	5. 月度工资核定表 (全员薪资测算与封账锁定)
	6. 现金发放与配钞 (人工确认后方可最终核定)
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "read")
	assert_doctype_permission("Jizhong Monthly Attendance", "read")
	assert_doctype_permission("Ashan Insurance Setting", "read")
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	if not period_month:
		period_month = today()[:7]
	period_month = _normalize_jizhong_period(period_month)

	year = cint(period_month.split("-")[0])
	month = cint(period_month.split("-")[1])
	period_label = f"{year}年{month:02d}月"
	settlement_doc = _get_jizhong_settlement_doc(company, period_month)
	confirmations = _get_jizhong_confirmation_state(settlement_doc)
	settlement = settlement_doc.as_dict() if settlement_doc else None
	is_locked = bool(settlement and settlement.get("locked"))

	# 1. 员工薪资信息表
	profile_rows = _jizhong_active_profiles(
		company,
		fields=[
			"employee_no", "employee_name", "employee_type", "employment_status",
			"social_security_base", "social_security_base_mode",
			"housing_fund_base", "housing_fund_base_mode", "housing_fund_policy",
		],
	)
	ins_setting = get_jizhong_insurance_setting(company=company, period_month=period_month)
	base_selection_issues = _jizhong_profiles_missing_base_selection(
		profile_rows, period_month, ins_setting
	)
	total_emps = len(profile_rows)
	category_counts = {}
	for row in profile_rows:
		category = _jizhong_employee_category(row.employee_type, row.employment_status)
		category_counts[category] = category_counts.get(category, 0) + 1
	regular_emps = category_counts.get("正式工", 0)
	rehire_emps = category_counts.get("退休返聘人员", 0)
	temp_emps = category_counts.get("临时工", 0)
	other_emps = category_counts.get("其他类型员工", 0)
	step1_ready = total_emps > 0 and not base_selection_issues
	step1_confirmed = confirmations["employees"]["confirmed"]
	step1 = {
		"step": 1,
		"title": "员工档案",
		"tag": "权威底册",
		"status": "confirmed" if step1_confirmed else ("ready" if step1_ready else "pending"),
		"badge": "已确认" if step1_confirmed else ("待确认" if step1_ready else "待完善"),
		"main": (
			f"{total_emps} 人在册 · 档案完整"
			if step1_ready
			else ("；".join(base_selection_issues) if base_selection_issues else "暂无员工档案")
		),
		"sub": (
			f"正式工 {regular_emps}人 ｜ 退休返聘 {rehire_emps}人 ｜ "
			f"临时工 {temp_emps}人 ｜ 其他类型 {other_emps}人"
		),
		"tab": "employees",
		"is_ready": step1_ready,
		"is_confirmed": step1_confirmed,
		"confirmed_by": confirmations["employees"]["confirmed_by"],
		"confirmed_at": confirmations["employees"]["confirmed_at"],
	}

	# 2. 考勤工时与打卡底册
	att_records = frappe.db.sql("""
		SELECT COUNT(*) as cnt,
		       SUM(work_hours_regular) as reg_hrs,
		       SUM(overtime_regular_1_5 + overtime_weekend_2_0 + overtime_holiday_3_0) as ot_hrs,
		       MAX(attendance_file) as att_file
		FROM `tabJizhong Monthly Attendance`
		WHERE company = %s AND period_month = %s
	""", (company, period_month), as_dict=True)[0]
	att_cnt = cint(att_records.get("cnt") or 0)
	reg_hrs = flt(att_records.get("reg_hrs") or 0)
	ot_hrs = flt(att_records.get("ot_hrs") or 0)
	coverage = _get_jizhong_attendance_coverage(company, period_month)
	step2_ready = bool(coverage.get("complete"))
	step2_confirmed = confirmations["attendance"]["confirmed"]
	excluded_attendance_note = (
		f"另有 {coverage.get('excluded_count', 0)} 人无需上传考勤（固定税后管理工资）"
		if coverage.get("excluded_count")
		else ""
	)
	step2 = {
		"step": 2,
		"title": "考勤工时与打卡底册",
		"tag": "打卡底册",
		"status": "confirmed" if step2_confirmed else ("ready" if step2_ready else "pending"),
		"badge": "已确认" if step2_confirmed else ("待确认" if step2_ready else "待补齐"),
		"main": (
			f"已匹配 {coverage['matched_count']} / {coverage['expected_count']} 人 · "
			f"{round(reg_hrs + ot_hrs, 1)}h"
			if step2_ready else
			f"应计薪 {coverage['expected_count']} 人，已匹配 {coverage['matched_count']} 人"
		),
		"sub": (
			f"正班 {round(reg_hrs, 1)}h ｜ 加班 {round(ot_hrs, 1)}h"
			+ (f" ｜ {excluded_attendance_note}" if excluded_attendance_note else "")
			if step2_ready else
			f"缺失工号：{'、'.join(coverage['missing_employee_nos']) or '无'}；"
			f"多余/重复/异常需先修正"
			+ (f"；{excluded_attendance_note}" if excluded_attendance_note else "")
		),
		"tab": "attendance",
		"is_ready": step2_ready,
		"is_confirmed": step2_confirmed,
		"confirmed_by": confirmations["attendance"]["confirmed_by"],
		"confirmed_at": confirmations["attendance"]["confirmed_at"],
	}

	# 3-4. 社会保险与住房公积金（按月动态核验与继承提示）
	configuration_errors = _jizhong_insurance_setting_errors(ins_setting)
	social_errors = [error for error in configuration_errors if "公积金" not in error]
	housing_errors = [error for error in configuration_errors if "社保" not in error]
	social_ready = not social_errors
	housing_ready = not housing_errors
	social_confirmed = confirmations["social_insurance"]["confirmed"]
	housing_confirmed = confirmations["housing_fund"]["confirmed"]
	payment_period = _compute_next_period(period_month)
	current_big_medical = resolve_big_medical_amount(
		ins_setting,
		payment_period_month=payment_period,
	)
	ss_person_rate = (
		flt(ins_setting.get("ss_person_pension"))
		+ flt(ins_setting.get("ss_person_medical"))
		+ flt(ins_setting.get("ss_person_unemployment"))
	)
	if social_errors:
		social_main = f"{period_month} 社保配置待完善"
		social_sub = "；".join(social_errors)
	elif ins_setting.get("is_inherited"):
		social_main = f"继承自 {ins_setting.get('inherited_from')} 的社会保险费率"
		social_sub = f"实际缴费期 {payment_period} ｜ 保存本月费率后再确认"
	else:
		social_main = f"个人社保 {ss_person_rate:.2f}% + 大额医疗 {current_big_medical:.2f} 元"
		social_sub = f"实际缴费期 {payment_period} ｜ {period_month} 专属费率已保存"

	if housing_errors:
		housing_main = f"{period_month} 公积金配置待完善"
		housing_sub = "；".join(housing_errors)
	elif ins_setting.get("is_inherited"):
		housing_main = f"继承自 {ins_setting.get('inherited_from')} 的住房公积金费率"
		housing_sub = f"实际缴费期 {payment_period} ｜ 保存本月费率后再确认"
	else:
		housing_main = (
			f"个人 {flt(ins_setting.get('hf_person_rate')):.2f}% ｜ "
			f"单位 {flt(ins_setting.get('hf_company_rate')):.2f}%"
		)
		housing_sub = f"实际缴费期 {payment_period} ｜ {period_month} 专属费率已保存"

	social_step = {
		"step": 3,
		"title": "社会保险",
		"tag": "费率与基数",
		"status": "confirmed" if social_confirmed else ("ready" if social_ready else "pending"),
		"badge": "已确认" if social_confirmed else ("待确认" if social_ready else "待配置"),
		"main": social_main,
		"sub": social_sub,
		"tab": "social_insurance",
		"is_ready": social_ready,
		"is_confirmed": social_confirmed,
		"confirmed_by": confirmations["social_insurance"]["confirmed_by"],
		"confirmed_at": confirmations["social_insurance"]["confirmed_at"],
	}
	housing_step = {
		"step": 4,
		"title": "住房公积金",
		"tag": "费率与基数",
		"status": "confirmed" if housing_confirmed else ("ready" if housing_ready else "pending"),
		"badge": "已确认" if housing_confirmed else ("待确认" if housing_ready else "待配置"),
		"main": housing_main,
		"sub": housing_sub,
		"tab": "housing_fund",
		"is_ready": housing_ready,
		"is_confirmed": housing_confirmed,
		"confirmed_by": confirmations["housing_fund"]["confirmed_by"],
		"confirmed_at": confirmations["housing_fund"]["confirmed_at"],
	}
	insurance_sheets = _build_jizhong_insurance_confirmation_sheets(
		company,
		period_month,
		ins_setting,
		employees_confirmed=step1_confirmed,
		social_confirmed=social_confirmed,
		housing_confirmed=housing_confirmed,
	)

	# 判断考勤工时是否必须（全员固定工资人员免考勤工时）
	attendance_required = False
	if settlement and settlement.get("items"):
		for it in settlement.get("items"):
			sm = str(it.get("salary_mode") or "").strip()
			if not is_jizhong_fixed_net_salary_mode(sm) and sm not in ("固定工资", "税前固定工资"):
				attendance_required = True
				break
	else:
		for p in profile_rows:
			sm = str(p.get("salary_mode") or "").strip()
			if not is_jizhong_fixed_net_salary_mode(sm) and sm not in ("固定工资", "税前固定工资"):
				attendance_required = True
				break

	att_prereq_ready = step2_ready if attendance_required else True
	att_prereq_confirmed = step2_confirmed if attendance_required else True

	calculated_stages = {"已计算", "凭证核验通过", "已封账", "已解锁"}
	step4_ready = bool(
		settlement
		and settlement.get("workflow_stage") in calculated_stages
		and cint(settlement.get("total_employees")) == total_emps
	)
	# 5. 月度工资核定表 (前置于个人所得税)
	has_calc = step4_ready

	# 前置四大步骤是否已全部确认（免考勤人员豁免考勤）
	all_prereqs_confirmed = bool(
		step1_confirmed and social_confirmed and housing_confirmed
		and (step2_confirmed or not attendance_required)
	)

	# 若四大前置已确认且已完成测算，个人所得税、现金发放与工资核定自动确认标绿
	tax_is_confirmed = bool(confirmations["tax"]["confirmed"] or (has_calc and all_prereqs_confirmed))
	cash_is_confirmed = bool(confirmations["cash_bills"]["confirmed"] or (has_calc and all_prereqs_confirmed))
	payroll_is_confirmed = bool(is_locked or (has_calc and all_prereqs_confirmed))
	step4_confirmed = tax_is_confirmed
	step6_confirmed = cash_is_confirmed

	can_lock = bool(
		step1_ready and social_ready and housing_ready and att_prereq_ready
		and all_prereqs_confirmed and has_calc and not is_locked
	)

	if is_locked:
		step5_badge = "已封账"
		step5_main = f"已核定封账 · {settlement.get('total_employees')}人"
		step5_sub = f"实发 ¥{flt(settlement.get('total_net_salary')):,.2f} ｜ 只读受控"
		overall_status_text = "已核定锁定 (只读封账)"
		overall_status_class = "jz-status-locked"
	elif can_lock:
		step5_badge = "已确认"
		step5_main = "全员薪酬与个税已自动确认 · 可核定本月"
		step5_sub = f"应发 ¥{flt(settlement.get('total_gross_salary')):,.2f} ｜ 实发 ¥{flt(settlement.get('total_net_salary')):,.2f}"
		overall_status_text = "待最终核定（前置步骤与薪酬个税已全部确认）"
		overall_status_class = "jz-status-ready"
	elif has_calc:
		step5_badge = "待确认"
		step5_main = "已完成测算 · 等待前置资料确认"
		step5_sub = f"应发 ¥{flt(settlement.get('total_gross_salary')):,.2f} ｜ 实发 ¥{flt(settlement.get('total_net_salary')):,.2f}"
		overall_status_text = "草稿状态（待前置确认）"
		overall_status_class = "jz-status-draft"
	else:
		step5_badge = "待测算"
		step5_main = "尚未测算薪酬"
		step5_sub = "前置资料确认后自动核算"
		overall_status_text = "草稿状态（待确认）"
		overall_status_class = "jz-status-draft"

	step5 = {
		"step": 5,
		"title": "月度工资核定表",
		"tag": "薪酬测算",
		"status": "locked" if is_locked else ("confirmed" if payroll_is_confirmed else ("ready" if has_calc else "pending")),
		"badge": step5_badge,
		"main": step5_main,
		"sub": step5_sub,
		"tab": "payroll",
		"is_ready": has_calc,
		"is_confirmed": payroll_is_confirmed,
		"confirmed_by": settlement.get("confirmed_by") if settlement else None,
		"confirmed_at": settlement.get("confirmed_date") if settlement else None,
	}

	# 6. 个人所得税台账
	step4 = {
		"step": 6,
		"title": "个人所得税台账",
		"tag": "累计预扣",
		"status": "confirmed" if tax_is_confirmed else ("ready" if step4_ready else "pending"),
		"badge": "已确认" if tax_is_confirmed else ("待确认" if step4_ready else "待同步"),
		"main": f"本月明细 {cint(settlement.get('total_employees')) if settlement else 0} 人 · 自动核算已确认" if step4_ready else "本月个税明细尚未完成计算",
		"sub": f"7级累计预扣算法 ｜ 基本减除费用 {flt(ins_setting.get('tax_threshold')):,.2f} 元/月",
		"tab": "tax",
		"is_ready": step4_ready,
		"is_confirmed": tax_is_confirmed,
		"confirmed_by": confirmations["tax"]["confirmed_by"],
		"confirmed_at": confirmations["tax"]["confirmed_at"],
	}

	# 7. 现金发放与配钞
	step6_ready = has_calc
	step6 = {
		"step": 7,
		"title": "现金发放与配钞",
		"tag": "现金发放",
		"status": "confirmed" if cash_is_confirmed else ("ready" if step6_ready else "pending"),
		"badge": "已确认" if cash_is_confirmed else ("待确认" if step6_ready else "待生成"),
		"main": (
			f"现金发放 ¥{flt(settlement.get('total_net_salary')):,.2f} · 自动配钞已确认"
			if step6_ready else "本月现金配钞明细尚未生成"
		),
		"sub": "五档人民币配钞与工资条签收清单",
		"tab": "cash_bills",
		"is_ready": step6_ready,
		"is_confirmed": cash_is_confirmed,
		"confirmed_by": confirmations["cash_bills"]["confirmed_by"],
		"confirmed_at": confirmations["cash_bills"]["confirmed_at"],
	}

	ordered_steps = [step1, step2, social_step, housing_step, step5, step4, step6]
	confirmed_steps = {
		item["tab"]: item["is_confirmed"]
		for item in ordered_steps
		if item["tab"] in JIZHONG_CONFIRMATION_STEPS
	}
	for item in ordered_steps:
		tab = item["tab"]
		if tab not in JIZHONG_CONFIRMATION_STEPS:
			continue
		dependencies = list(JIZHONG_STEP_DEPENDENCIES[tab])
		if not attendance_required and "attendance" in dependencies:
			dependencies.remove("attendance")
		downstream = [
			candidate
			for candidate, candidate_dependencies in JIZHONG_STEP_DEPENDENCIES.items()
			if tab in candidate_dependencies
		]
		missing_deps = [
			JIZHONG_STEP_LABELS.get(dep, dep)
			for dep in dependencies
			if not confirmed_steps.get(dep)
		]
		if tab in ("tax", "cash_bills", "payroll"):
			item["can_confirm"] = False
			item["can_unconfirm"] = False
			item["cannot_confirm_reason"] = "由前置底册（档案、社保、公积金、考勤）核定后自动联动生成，不支持手动确认与取消"
		else:
			if missing_deps:
				item["cannot_confirm_reason"] = f"前置步骤【{"、".join(missing_deps)}】尚未确认，请先确认前置步骤"
			elif not item["is_ready"]:
				item["cannot_confirm_reason"] = item.get("sub") or "当前步骤数据未就绪"
			elif is_locked:
				item["cannot_confirm_reason"] = "本账期已封账只读"
			else:
				item["cannot_confirm_reason"] = ""

			item["can_confirm"] = bool(
				item["is_ready"]
				and not item["is_confirmed"]
				and not is_locked
				and not missing_deps
			)
			item["can_unconfirm"] = bool(
				item["is_confirmed"]
				and not is_locked
			)
		if item["is_confirmed"]:
			impact_targets, impact_indep, impact_clear, impact_desc = _resolve_jizhong_calculation_cancel_targets(
				tab, settlement_doc, confirmations
			)
			item["cancel_impact_steps"] = impact_targets
			item["cancel_impact_desc"] = impact_desc
			item["cancel_clear_calc"] = impact_clear

	return {
		"success": True,
		"period_month": period_month,
		"period_label": period_label,
		"overall_status_text": overall_status_text,
		"overall_status_class": overall_status_class,
		"is_locked": is_locked,
		"attendance_required": attendance_required,
		"insurance_sheets": insurance_sheets,
		"can_calculate": bool(
			step1_ready and social_ready and housing_ready and att_prereq_ready
			and step1_confirmed and social_confirmed and housing_confirmed and att_prereq_confirmed and not is_locked
		),
		"can_lock": bool(
			can_lock
		),
		"steps": ordered_steps,
	}


def _get_jizhong_tax_history(company, current_period, tax_cycle_start_month=12):
	"""
	从以往已归档/核定的结算单或历史数据中，提取该税收周期内的累计发生数
	"""
	current_period = _normalize_jizhong_period(current_period)
	curr_year = cint(current_period.split("-")[0])
	curr_month = cint(current_period.split("-")[1])
	tax_cycle_start_month = cint(tax_cycle_start_month) or 12
	if tax_cycle_start_month < 1 or tax_cycle_start_month > 12:
		frappe.throw("个税累计申报周期起始月必须为 1 至 12 月。")

	# 确定周期包含的历史月份列表
	months_in_cycle = []
	if curr_month >= tax_cycle_start_month:
		cycle_year = curr_year
		cycle_months = range(tax_cycle_start_month, curr_month)
		months_in_cycle.extend(
			f"{cycle_year:04d}-{month:02d}" for month in cycle_months
		)
	else:
		previous_year = curr_year - 1
		months_in_cycle.extend(
			f"{previous_year:04d}-{month:02d}"
			for month in range(tax_cycle_start_month, 13)
		)
		months_in_cycle.extend(
			f"{curr_year:04d}-{month:02d}" for month in range(1, curr_month)
		)

	if not months_in_cycle:
		return {}

	# 查询历史月度账单
	items = frappe.db.sql(
		"""
		SELECT
			pi.employee_no,
			SUM(pi.gross_salary) as prev_gross,
			SUM(CASE WHEN pi.tax_threshold > 0 THEN pi.tax_threshold ELSE 5000.0 END) as prev_thresh,
			SUM(pi.ss_person_total + pi.hf_person_total) as prev_special_ded,
			SUM(pi.special_deductions_total) as prev_add_ded,
			SUM(pi.tax_amount) as prev_tax_paid
		FROM `tabAshan Monthly Payroll Item` pi
		JOIN `tabAshan Monthly Payroll Settlement` ps ON pi.parent = ps.name
		WHERE ps.company = %s
		  AND ps.period_month IN %s
		  AND (
			ps.locked = 1
			OR ps.status IN ('已核定锁定', '已归档发放')
			OR ps.workflow_stage = '已封账'
		  )
		GROUP BY pi.employee_no
		ORDER BY pi.employee_no ASC
		""",
		(company, tuple(months_in_cycle)),
		as_dict=True
	)

	return {it.employee_no: it for it in items}


@frappe.whitelist()
def get_jizhong_payroll_overview(company="天津吉众科技有限公司", period_month=None):
	"""
	获取指定期间吉众薪酬大宽表、现金配钞、个税明细等完整数据
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	if not period_month:
		latest = frappe.db.get_value(
			"Ashan Monthly Payroll Settlement",
			{"company": company},
			"period_month",
			order_by="period_month desc"
		)
		period_month = latest or getdate().strftime("%Y-%m")
	period_month = _normalize_jizhong_period(period_month)

	doc_name = f"{company}-{period_month}"
	if not frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
		return {"settlement": None, "items": []}

	doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
	items = [it.as_dict() for it in doc.items]

	# 计算配钞汇总
	bill_summary = {
		"total_cash": sum(flt(it.get("cash_pay", 0)) for it in items),
		"bills_100": sum(cint(it.get("bills_100", 0)) for it in items),
		"bills_50": sum(cint(it.get("bills_50", 0)) for it in items),
		"bills_10": sum(cint(it.get("bills_10", 0)) for it in items),
		"bills_5": sum(cint(it.get("bills_5", 0)) for it in items),
		"bills_1": sum(cint(it.get("bills_1", 0)) for it in items),
	}

	return {
		"settlement": doc.as_dict(),
		"items": items,
		"bill_summary": bill_summary,
	}


@frappe.whitelist()
def get_jizhong_history_records(company="天津吉众科技有限公司", period_month=None, current_period=None):
	"""
	获取吉众历史与当期薪酬明细全要素记录（支持全部账期、指定账期过滤或本月全员穿透）。
	包含：
	- 历史已归档月度记录（2024-12 至 2026-06）；
	- 当月全员最新记录（含出勤、五险一金、个税、工资与配钞明细）；
	- 完整分项字段（公积金、社保分项、人员档案、考勤工时、税款核算）。
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")

	# 规范化当前核算月份
	if not current_period:
		workbench_init = get_jizhong_workbench_init(company)
		current_period = workbench_init.get("default_period") or today()[:7]
	current_period = _normalize_jizhong_period(current_period)

	# 处理 period_month 参数
	target_period = None
	is_all = False
	if not period_month or period_month in ("ALL", "全部", "全部历史记录"):
		is_all = True
	elif period_month in ("CURRENT", "本月", "当月", current_period):
		target_period = current_period
	else:
		target_period = _normalize_jizhong_period(period_month)

	# 1. 查询历史已封账或已核定的薪资项
	historical_items = []
	if is_all or (target_period and target_period != current_period):
		query_sql = """
			SELECT
				pi.*,
				ps.period_month,
				ps.locked as is_locked,
				ps.status as settlement_status
			FROM `tabAshan Monthly Payroll Item` pi
			JOIN `tabAshan Monthly Payroll Settlement` ps ON pi.parent = ps.name
			WHERE ps.company = %s
		"""
		params = [company]
		if target_period:
			query_sql += " AND ps.period_month = %s"
			params.append(target_period)
		else:
			query_sql += " AND ps.period_month != %s"
			params.append(current_period)

		query_sql += " ORDER BY ps.period_month DESC, pi.employee_no ASC LIMIT 3000"
		historical_items = frappe.db.sql(query_sql, tuple(params), as_dict=True)

	# 2. 查询当期 (本月所有人员数据)
	current_items = []
	if is_all or target_period == current_period:
		cur_doc_name = f"{company}-{current_period}"
		if frappe.db.exists("Ashan Monthly Payroll Settlement", cur_doc_name):
			cur_doc = frappe.get_doc("Ashan Monthly Payroll Settlement", cur_doc_name)
			for it in cur_doc.items:
				d = it.as_dict()
				d["period_month"] = current_period
				d["is_locked"] = cur_doc.locked
				d["settlement_status"] = cur_doc.status or "草稿"
				d["is_current_period"] = 1
				current_items.append(d)

		# 若本月尚未生成测算子表，从员工档案与考勤生成本月全员记录底册
		if not current_items:
			active_profiles = _jizhong_active_profiles(
				company,
				fields=[
					"name", "employee_no", "employee_name", "department", "job_title", "employee_type", "employment_status",
					"id_card", "gender", "salary_mode", "fixed_salary", "base_salary", "house_rent_allowance", "post_allowance",
					"performance_base", "meal_allowance", "social_security_base", "social_security_base_mode",
					"custom_social_security_base", "housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base",
					"housing_fund_policy", "deduction_child_education", "deduction_continuing_education", "deduction_housing_loan",
					"deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care", "deduction_serious_illness"
				]
			)
			ins_setting = get_jizhong_insurance_setting(company=company, period_month=current_period)
			for p in active_profiles:
				_apply_jizhong_effective_bases(p, ins_setting)

			# 当期考勤
			att_map = {}
			att_list = frappe.get_list(
				"Jizhong Monthly Attendance",
				filters={"company": company, "period_month": current_period},
				fields=["*"],
				limit_page_length=0
			)
			for a in att_list:
				att_map[a.employee_no] = a

			for emp in active_profiles:
				eno = emp.employee_no
				att = att_map.get(eno)
				emp_cat = _jizhong_employee_category(emp.employee_type, emp.employment_status)
				ss_base = flt(emp.effective_social_security_base)
				hf_base = flt(emp.effective_housing_fund_base)
				f_sal = flt(emp.fixed_salary)
				b_sal = flt(emp.base_salary)
				sal_mode = str(emp.salary_mode or "税前动态工资").strip()

				current_items.append({
					"employee_no": eno,
					"employee_name": emp.employee_name,
					"department": emp.department,
					"job_title": emp.job_title,
					"employee_type": emp_cat,
					"id_card": emp.id_card,
					"gender": emp.gender,
					"salary_mode": sal_mode,
					"period_month": current_period,
					"attendance_days": flt(att.attendance_days) if att else 0.0,
					"work_hours": flt(att.work_hours_regular) if att else 0.0,
					"basic_hours": flt(att.work_hours_regular) if att else 0.0,
					"overtime_regular_1_5": flt(att.overtime_regular_1_5) if att else 0.0,
					"overtime_weekend_2_0": flt(att.overtime_weekend_2_0) if att else 0.0,
					"overtime_holiday_3_0": flt(att.overtime_holiday_3_0) if att else 0.0,
					"leave_compensatory_hours": flt(att.leave_compensatory_hours) if att else 0.0,
					"meal_count": cint(att.meal_count) if att else 0,
					"meal_unit_price": flt(emp.meal_allowance or 15.0),
					"base_salary": b_sal,
					"post_allowance": flt(emp.post_allowance),
					"performance_salary": flt(emp.performance_base),
					"fixed_salary": f_sal,
					"gross_salary": f_sal if is_jizhong_fixed_net_salary_mode(sal_mode) or "固定" in sal_mode else b_sal,
					"ss_base": ss_base,
					"hf_base": hf_base,
					"tax_threshold": flt(ins_setting.get("tax_threshold") or 5000.0),
					"tax_amount": 0.0,
					"net_salary": f_sal if is_jizhong_fixed_net_salary_mode(sal_mode) else b_sal,
					"cash_pay": f_sal if is_jizhong_fixed_net_salary_mode(sal_mode) else b_sal,
					"is_locked": 0,
					"settlement_status": "本月待测算",
					"is_current_period": 1
				})

	all_raw_items = current_items + historical_items if (is_all or target_period == current_period) else historical_items

	# 4. 建立员工档案快照映射以补全空缺信息
	prof_cache = {}
	all_profs = frappe.get_list(
		"Jizhong Employee Salary Profile",
		filters={"company": company},
		fields=["employee_no", "employee_name", "department", "job_title", "id_card", "gender", "employee_type", "salary_mode", "housing_fund_policy"],
		limit_page_length=0
	)
	for p in all_profs:
		prof_cache[p.employee_no] = p

	enriched_items = []
	for it in all_raw_items:
		item = dict(it)
		eno = item.get("employee_no")
		prof = prof_cache.get(eno) or {}

		# 基础档案补全
		if not item.get("id_card") and prof.get("id_card"):
			item["id_card"] = prof.get("id_card")
		if not item.get("gender") and prof.get("gender"):
			item["gender"] = prof.get("gender")
		if not item.get("department") and prof.get("department"):
			item["department"] = prof.get("department")
		if not item.get("job_title") and prof.get("job_title"):
			item["job_title"] = prof.get("job_title")
		if not item.get("housing_fund_policy") and prof.get("housing_fund_policy"):
			item["housing_fund_policy"] = prof.get("housing_fund_policy")

		# 社保分项可审计补全
		ss_p = flt(item.get("ss_person_total"))
		ss_base = flt(item.get("ss_base"))
		pension_p = flt(item.get("pension_person"))
		medical_p = flt(item.get("medical_person"))
		large_med_p = flt(item.get("large_medical_person"))
		unemp_p = flt(item.get("unemployment_person"))

		if ss_p > 0 and (abs(pension_p) + abs(medical_p) + abs(unemp_p)) < 0.005 and ss_base > 0:
			pension_p = round(ss_base * 0.08, 2)
			medical_p = round(ss_base * 0.02, 2)
			unemp_p = round(ss_base * 0.005, 2)
			large_med_p = round(ss_p - pension_p - medical_p - unemp_p, 2)
			item["pension_person"] = pension_p
			item["medical_person"] = medical_p
			item["unemployment_person"] = unemp_p
			item["large_medical_person"] = large_med_p

		ss_c = flt(item.get("ss_company_total"))
		pension_c = flt(item.get("pension_company"))
		medical_c = flt(item.get("medical_company"))
		unemp_c = flt(item.get("unemployment_company"))
		injury_c = flt(item.get("work_injury_company"))

		if ss_base > 0 and (abs(pension_c) + abs(medical_c) + abs(unemp_c) + abs(injury_c)) < 0.005:
			pension_c = round(ss_base * 0.16, 2)
			medical_c = round(ss_base * 0.08, 2)
			unemp_c = round(ss_base * 0.005, 2)
			injury_c = round(ss_base * 0.0016, 2)
			if ss_c <= 0:
				ss_c = round(pension_c + medical_c + unemp_c + injury_c, 2)
				item["ss_company_total"] = ss_c
			item["pension_company"] = pension_c
			item["medical_company"] = medical_c
			item["unemployment_company"] = unemp_c
			item["work_injury_company"] = injury_c

		# 公积金分项
		hf_base = flt(item.get("hf_base"))
		hf_p = flt(item.get("hf_person_total"))
		hf_c = flt(item.get("hf_company_total"))
		if hf_base > 0 and hf_c <= 0:
			hf_c = round(hf_base * 0.05, 2)
			item["hf_company_total"] = hf_c
		if hf_p > 0 and not item.get("housing_fund_person"):
			item["housing_fund_person"] = hf_p

		# 综合统筹成本与个人扣款合计
		if not item.get("company_cost_total"):
			item["company_cost_total"] = round(ss_c + hf_c, 2)
		item["person_special_ded"] = round(ss_p + hf_p, 2)

		# 目标工资：税后工资写税后实发，税前工资写税前应发
		sal_mode_str = str(item.get("salary_mode") or "").strip()
		if is_jizhong_post_tax_salary_mode(sal_mode_str) or "税后" in sal_mode_str:
			item["target_salary"] = flt(item.get("net_salary")) or flt(item.get("fixed_salary")) or flt(item.get("gross_salary"))
		else:
			item["target_salary"] = flt(item.get("gross_salary")) or flt(item.get("base_salary"))

		# 加班工资合计
		item["salary_overtime_total"] = round(
			flt(item.get("salary_overtime_1_5")) +
			flt(item.get("salary_overtime_2_0")) +
			flt(item.get("salary_overtime_3_0")),
			2
		)

		# 配钞与现金
		net_sal = flt(item.get("net_salary"))
		cash_pay = flt(item.get("cash_pay"))
		if cash_pay <= 0 and net_sal > 0:
			cash_pay = float(math.ceil(net_sal))
			item["cash_pay"] = cash_pay
		if (cint(item.get("bills_100")) + cint(item.get("bills_50")) + cint(item.get("bills_10")) + cint(item.get("bills_5")) + cint(item.get("bills_1"))) == 0 and cash_pay > 0:
			b100, b50, b10, b5, b1 = split_cash_bills(cash_pay)
			item["bills_100"] = b100
			item["bills_50"] = b50
			item["bills_10"] = b10
			item["bills_5"] = b5
			item["bills_1"] = b1

		enriched_items.append(item)

	# 5. 读取历史所有账期列表
	period_rows = frappe.db.sql(
		"""
		SELECT DISTINCT ps.period_month
		FROM `tabAshan Monthly Payroll Settlement` ps
		WHERE ps.company = %s
		ORDER BY ps.period_month DESC
		""",
		(company,),
		as_dict=True
	)
	period_list = [p["period_month"] for p in period_rows if p.get("period_month")]
	if current_period not in period_list:
		period_list.insert(0, current_period)

	# 6. 计算 KPI 汇总
	kpi_summary = {
		"total_records": len(enriched_items),
		"period_count": len(set(it.get("period_month") for it in enriched_items if it.get("period_month"))),
		"total_gross": round(sum(flt(it.get("gross_salary")) for it in enriched_items), 2),
		"total_net": round(sum(flt(it.get("net_salary")) for it in enriched_items), 2),
		"total_tax": round(sum(flt(it.get("tax_amount")) for it in enriched_items), 2),
		"total_ss_person": round(sum(flt(it.get("ss_person_total")) for it in enriched_items), 2),
		"total_hf_person": round(sum(flt(it.get("hf_person_total")) for it in enriched_items), 2),
		"total_ss_company": round(sum(flt(it.get("ss_company_total")) for it in enriched_items), 2),
		"total_hf_company": round(sum(flt(it.get("hf_company_total")) for it in enriched_items), 2),
		"total_company_cost": round(sum(flt(it.get("company_cost_total")) for it in enriched_items), 2),
		"current_month_count": sum(1 for it in enriched_items if it.get("period_month") == current_period),
	}

	return {
		"items": enriched_items,
		"periods": period_list,
		"current_month": current_period,
		"kpi": kpi_summary,
	}


def _compute_prev_period(period_month):
	period_month = _normalize_jizhong_period(period_month)
	y, m = [int(x) for x in period_month.split("-")]
	if m == 1:
		return f"{y - 1:04d}-12"
	return f"{y:04d}-{m - 1:02d}"


def _compute_next_period(period_month):
	"""Return the next calendar month for the payment-period boundary."""
	period_month = _normalize_jizhong_period(period_month)
	y, m = [int(x) for x in period_month.split("-")]
	if m == 12:
		return f"{y + 1:04d}-01"
	return f"{y:04d}-{m + 1:02d}"


@frappe.whitelist()
def get_jizhong_workbench_init(company="天津吉众科技有限公司"):
	"""
	获取吉众工作台初始化上下文与默认核算账期。
	业务铁律：若最新月份已核定封账，进入默认显示即将开始的下一个月（如 6 月已封账，默认显示 7 月）。
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "read")
	latest_locked = frappe.db.sql("""
		SELECT period_month FROM `tabAshan Monthly Payroll Settlement`
		WHERE company = %s AND (locked = 1 OR status IN ('已核定锁定', '已归档发放'))
		ORDER BY period_month DESC
		LIMIT 1
	""", (company,), as_dict=True)

	if latest_locked and latest_locked[0].get("period_month"):
		last_m = _normalize_jizhong_period(latest_locked[0]["period_month"])
		default_period = _compute_next_period(last_m)
		latest_locked_month = last_m
	else:
		today_str = today()
		y, m = [int(x) for x in today_str[:7].split("-")]
		default_period = _compute_prev_period(f"{y:04d}-{m:02d}")
		latest_locked_month = None

	return {
		"company": company,
		"default_period": default_period,
		"latest_locked": latest_locked_month,
		"can_configure": bool(can_module_access("payroll", "configure")),
	}


@frappe.whitelist()
def get_jizhong_insurance_setting(company="天津吉众科技有限公司", period_month=None, year=None):
	"""
	获取吉众专属社保公积金设置。
	业务铁律：公积金、社保可能每个月比例不同。
	1. 优先获取当前月份 period_month 的配置（如 天津吉众科技有限公司-2026-07）；
	2. 若当前月份未单独配置，则默认载入上个月的配置（如 2026-06），并标记为继承自上月；
	3. 若上月亦不存在，则载入年度基准配置（如 2026）；
	4. 本月核定保存后，存为本月专属记录。
	"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Ashan Insurance Setting", "read")
	if not period_month and year:
		period_month = f"{cint(year)}-01"
	elif not period_month:
		period_month = today()[:7]
	period_month = _normalize_jizhong_period(period_month)

	exact_doc_name = f"{company}-{period_month}"

	# 1. 优先查本月精确配置
	if frappe.db.exists("Ashan Insurance Setting", exact_doc_name):
		doc = frappe.get_doc("Ashan Insurance Setting", exact_doc_name)
		d = doc.as_dict()
		d["is_inherited"] = False
		d["is_configured"] = True
		d["configuration_source"] = "monthly"
		d["inherited_from"] = None
		d["period_month"] = period_month
		return d

	# 2. 默认载入上个月的配置
	prev_month = _compute_prev_period(period_month)
	source_doc = None
	inherited_from = None

	if prev_month:
		prev_doc_name = f"{company}-{prev_month}"
		if frappe.db.exists("Ashan Insurance Setting", prev_doc_name):
			source_doc = frappe.get_doc("Ashan Insurance Setting", prev_doc_name)
			inherited_from = prev_month

	if not source_doc:
		year_doc_name = f"{company}-{period_month[:4]}"
		if frappe.db.exists("Ashan Insurance Setting", year_doc_name):
			source_doc = frappe.get_doc("Ashan Insurance Setting", year_doc_name)
			inherited_from = f"{period_month[:4]}年度基准"
		else:
			latest = frappe.get_list(
				"Ashan Insurance Setting",
				filters={"company": company},
				fields=["name", "period_month", "effective_year"],
				order_by="creation desc, name desc",
				limit_page_length=1,
			)
			if latest:
				source_doc = frappe.get_doc("Ashan Insurance Setting", latest[0]["name"])
				inherited_from = source_doc.name

	# 如果找到了源配置，克隆其费率作为本月默认待定配置
	if source_doc:
		d = source_doc.as_dict()
		d["name"] = exact_doc_name
		d["period_month"] = period_month
		d["effective_year"] = cint(period_month[:4])
		d["is_inherited"] = True
		d["is_configured"] = False
		d["configuration_source"] = "previous_period" if inherited_from == prev_month else "annual"
		d["inherited_from"] = inherited_from
		return d

	# 4. 全局兜底：GET/read 只返回默认值，不在读取过程中创建数据库记录。
	return frappe._dict({
		"name": exact_doc_name,
		"company": company,
		"period_month": period_month,
		"effective_year": cint(period_month[:4]),
		**JIZHONG_INSURANCE_DEFAULTS,
		"is_inherited": False,
		"is_configured": False,
		"configuration_source": "system_default",
		"inherited_from": None,
	})


@frappe.whitelist(methods=["POST"])
def update_jizhong_insurance_setting(company="天津吉众科技有限公司", period_month=None, values=None, year=None):
	"""
	保存吉众专属社保公积金设置。
	业务铁律：本月核定完保存为本月的配置（如 天津吉众科技有限公司-2026-07）。
	"""
	company = _assert_jizhong_access("write", company)
	if not can_module_access("payroll", "configure"):
		frappe.throw("社保、公积金和个税基础参数仅 Payroll Manager 可以修改。", frappe.PermissionError)
	assert_doctype_permission("Ashan Insurance Setting", "write")
	import json
	if isinstance(values, str):
		try:
			values = json.loads(values)
		except (TypeError, ValueError, json.JSONDecodeError):
			frappe.throw("社保、公积金配置格式无效，请重新提交。")
	if values is not None and not isinstance(values, dict):
		frappe.throw("社保、公积金配置必须是对象。")
	if not period_month and year:
		period_month = f"{cint(year)}-01"
	elif not period_month:
		period_month = today()[:7]
	period_month = _normalize_jizhong_period(period_month)
	configuration_step = get_jizhong_insurance_configuration_step((values or {}).keys())
	assert_jizhong_workflow_step_editable(company, period_month, configuration_step)

	doc_name = f"{company}-{period_month}"

	if frappe.db.exists("Ashan Insurance Setting", doc_name):
		doc = frappe.get_doc("Ashan Insurance Setting", doc_name)
	else:
		doc = frappe.new_doc("Ashan Insurance Setting")
		doc.name = doc_name
		doc.company = company
		doc.period_month = period_month
		doc.effective_year = cint(period_month[:4])
		inherited = get_jizhong_insurance_setting(company=company, period_month=period_month)
		for fieldname, default in JIZHONG_INSURANCE_DEFAULTS.items():
			if doc.meta.has_field(fieldname):
				setattr(doc, fieldname, inherited.get(fieldname, default))

	if values:
		if "employee_type_policies" in values:
			save_jizhong_employee_type_policies(company, values.pop("employee_type_policies"))
		unknown_fields = set(values) - INSURANCE_VALUE_FIELDS
		if unknown_fields:
			frappe.throw(f"配置包含不支持的字段：{'、'.join(sorted(unknown_fields))}。")
		for fieldname, value in values.items():
			if fieldname in {"big_medical_special_months", "hf_contribution_months", "hf_off_month_action"}:
				setattr(doc, fieldname, str(value or "").strip())
			else:
				setattr(doc, fieldname, flt(value))

	if flt(doc.tax_threshold) <= 0:
		frappe.throw("个税基本减除费用必须大于 0 元/月。")
	if flt(doc.ss_min_base) <= 0:
		frappe.throw("社保最低缴费基数必须大于 0 元。")
	if flt(doc.hf_min_base) <= 0:
		frappe.throw("公积金最低缴费基数必须大于 0 元。")
	if flt(doc.big_medical_amount_default) < 0 or flt(doc.big_medical_amount_special) < 0:
		frappe.throw("大额医疗金额不能为负数。")
	cycle_start_month = cint(doc.tax_cycle_start_month)
	if cycle_start_month < 1 or cycle_start_month > 12:
		frappe.throw("个税累计申报周期起始月必须为 1 至 12 月。")
	doc.company = company
	doc.period_month = period_month
	doc.effective_year = cint(period_month[:4])

	doc.save()
	# 若当期结算单存在且处于草稿状态，联动按最新个税周期与免征额重算当期税额与反推税前/税后工资
	if values and ("tax_threshold" in values or "tax_cycle_start_month" in values):
		settle_doc_name = f"{company}-{period_month}"
		if frappe.db.exists("Ashan Monthly Payroll Settlement", settle_doc_name):
			settle_doc = frappe.get_doc("Ashan Monthly Payroll Settlement", settle_doc_name)
			if not cint(settle_doc.get("locked")) and settle_doc.items:
				new_thresh = flt(doc.tax_threshold) or 5000.0
				new_cycle_start = cint(doc.tax_cycle_start_month) or 12
				tax_hist = _get_jizhong_tax_history(company, period_month, new_cycle_start)
				tot_g = 0.0
				tot_n = 0.0
				tot_t = 0.0
				for item in settle_doc.items:
					eno = item.employee_no
					s_mode = str(item.salary_mode or "税前动态工资").strip()
					p_spec_ded = round(flt(item.ss_person_total) + flt(item.hf_person_total), 2)
					add_ded = flt(item.special_deductions_total)
					h = tax_hist.get(eno, {})
					prev_g = flt(h.get("prev_gross", 0.0))
					prev_th = flt(h.get("prev_thresh", 0.0))
					prev_sp = flt(h.get("prev_special_ded", 0.0))
					prev_ad = flt(h.get("prev_add_ded", 0.0))
					prev_tp = flt(h.get("prev_tax_paid", 0.0))
					item.tax_threshold = new_thresh

					if is_jizhong_fixed_net_salary_mode(s_mode):
						t_net = flt(item.net_salary) or flt(item.fixed_salary)
						rev = derive_jizhong_gross_from_net(
							target_net=t_net,
							special_deductions_cur=p_spec_ded,
							tax_threshold=new_thresh,
							prev_gross=prev_g,
							prev_threshold=prev_th,
							prev_special_ded=prev_sp,
							prev_additional_ded=prev_ad,
							prev_tax_paid=prev_tp,
							cur_additional_ded=add_ded,
						)
						item.gross_salary = rev["gross_salary"]
						item.salary_basic_hours = rev["gross_salary"]
						item.tax_amount = rev["tax_amount"]
						item.net_salary = t_net
						item.target_salary = t_net
					else:
						g_sal = flt(item.gross_salary)
						cum_taxable = round((prev_g + g_sal) - (prev_th + new_thresh) - (prev_sp + p_spec_ded) - (prev_ad + add_ded), 2)
						cum_tax = _get_annual_tax(cum_taxable)
						tax_amt = max(0.0, round(cum_tax - prev_tp, 2))
						net_sal = round(g_sal - p_spec_ded - tax_amt, 2)
						item.tax_amount = tax_amt
						item.net_salary = net_sal
						item.target_salary = g_sal

					item.person_cost_total = round(p_spec_ded + flt(item.tax_amount), 2)
					item.taxable_income = max(0.0, round(flt(item.gross_salary) - new_thresh - p_spec_ded - add_ded, 2))
					if flt(item.cash_pay) > 0:
						c_wage = float(math.ceil(flt(item.net_salary))) if flt(item.net_salary) > 0 else 0.0
						b100, b50, b10, b5, b1 = split_cash_bills(c_wage)
						item.cash_pay = c_wage
						item.bills_100 = b100
						item.bills_50 = b50
						item.bills_10 = b10
						item.bills_5 = b5
						item.bills_1 = b1

					tot_g += flt(item.gross_salary)
					tot_n += flt(item.net_salary)
					tot_t += flt(item.tax_amount)

				settle_doc.total_gross_salary = round(tot_g, 2)
				settle_doc.total_net_salary = round(tot_n, 2)
				settle_doc.total_tax = round(tot_t, 2)
				settle_doc.save()

	setting = doc.as_dict()
	setting.update({"is_configured": True, "configuration_source": "monthly", "is_inherited": False, "employee_type_policies": get_jizhong_employee_type_policies(company)})
	return {"success": True, "message": f"【{company}】{period_month} 个税参数与社保公积金费率已成功保存并生效！", "setting": setting}


@frappe.whitelist()
def get_jizhong_employee_profiles(company="天津吉众科技有限公司", period_month=None):
	"""获取吉众员工薪酬档案，并返回当前核算月的有效社保公积金基数。"""
	company = _assert_jizhong_access("read", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "read")
	period_month = _normalize_jizhong_period(period_month, required=False)
	insurance_setting = get_jizhong_insurance_setting(company=company, period_month=period_month)
	fields = [
		"name", "employee_no", "employee_name", "company", "employee_type", "employment_status",
		"certificate_type", "salary_mode", "fixed_salary", "base_salary", "house_rent_allowance", "post_allowance", "performance_base",
		"meal_allowance", "social_security_base", "social_security_base_mode", "custom_social_security_base",
		"housing_fund_base", "housing_fund_base_mode", "custom_housing_fund_base", "housing_fund_policy", "id_card", "mobile", "gender", "birth_date",
		"department", "job_title", "date_of_joining", "relieving_date", "retirement_category", "original_retirement_age", "delayed_retirement_age", "original_retirement_period", "delayed_retirement_period", "deduction_child_education", "deduction_continuing_education",
		"deduction_serious_illness", "deduction_housing_loan", "deduction_housing_rent",
		"deduction_elderly_care", "deduction_infant_care", "special_additional_deductions_total",
		"bank_name", "bank_account", "notes"
	]
	profile_doctype = _jizhong_profile_doctype()
	rows = frappe.get_list(
		profile_doctype,
		filters={"company": company},
		fields=fields,
		order_by="employee_no asc",
		limit_page_length=0,
	)
	return [_apply_jizhong_effective_bases(row, insurance_setting, period_month=period_month) for row in rows]


@frappe.whitelist(methods=["POST"])
def save_jizhong_employee_profile(data=None):
	"""保存或更新吉众员工薪酬档案"""
	if isinstance(data, str):
		import json
		try:
			data = json.loads(data)
		except Exception:
			pass
	if isinstance(data, dict) and data.get("action") == "save_employee_type_policies":
		comp = data.get("company") or "天津吉众科技有限公司"
		comp = _assert_jizhong_access("write", comp)
		assert_doctype_permission("Jizhong Employee Type Policy", "write")
		save_jizhong_employee_type_policies(comp, data.get("policies"))
		return {"success": True, "message": "用工性质规则已成功保存", "policies": get_jizhong_employee_type_policies(comp)}
	import json
	if isinstance(data, str):
		try:
			data = json.loads(data)
		except (TypeError, ValueError, json.JSONDecodeError):
			frappe.throw("员工档案格式无效，请重新提交。")
	if not data or not isinstance(data, dict):
		frappe.throw("无效的员工档案数据")

	company = data.get("company") or "天津吉众科技有限公司"
	company = _assert_jizhong_access("write", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "write")
	period_month = data.get("period_month")
	if period_month:
		assert_jizhong_workflow_step_editable(company, period_month, "employees")

	emp_no = (data.get("employee_no") or "").strip()
	emp_name = (data.get("employee_name") or "").strip()
	if not emp_no or not emp_name:
		frappe.throw("工号和姓名不能为空")

	doc_name = data.get("name")
	is_new_profile = False
	if not doc_name:
		doc_name = f"{company}-{emp_no}-{emp_name}"

	if frappe.db.exists("Jizhong Employee Salary Profile", doc_name):
		doc = frappe.get_doc("Jizhong Employee Salary Profile", doc_name)
		if str(doc.company or "").strip() != company:
			frappe.throw("不能跨公司修改吉众员工薪资档案。", frappe.PermissionError)
	elif frappe.db.exists("Jizhong Employee Salary Profile", {"company": company, "employee_no": emp_no}):
		exist_name = frappe.db.get_value("Jizhong Employee Salary Profile", {"company": company, "employee_no": emp_no}, "name")
		doc = frappe.get_doc("Jizhong Employee Salary Profile", exist_name)
	else:
		doc = frappe.new_doc("Jizhong Employee Salary Profile")
		is_new_profile = True
		doc.company = company
		doc.employee_no = emp_no
		doc.employee_name = emp_name

	# 更新基础字段
	doc.employee_name = emp_name
	doc.certificate_type = (data.get("certificate_type") or "居民身份证").strip()
	doc.id_card = (data.get("id_card") or "").strip()
	doc.mobile = (data.get("mobile") or "").strip()
	doc.gender = data.get("gender") or ""
	doc.birth_date = data.get("birth_date") or None
	doc.department = data.get("department") or "生产车间"
	doc.job_title = data.get("job_title") or "操作工"
	doc.employee_type = data.get("employee_type") or "正式工"
	doc.employment_status = data.get("employment_status") or "在职"
	doc.salary_mode = data.get("salary_mode") or "税前动态工资"

	# 金额与基数
	doc.fixed_salary = flt(data.get("fixed_salary"))
	doc.base_salary = flt(data.get("base_salary"))
	doc.house_rent_allowance = flt(data.get("house_rent_allowance"))
	doc.performance_base = flt(data.get("performance_base"))
	doc.post_allowance = flt(data.get("post_allowance"))
	doc.meal_allowance = flt(data.get("meal_allowance") or 15.0)
	doc.salary_adjustment = flt(data.get("salary_adjustment", 0.0))
	ss_mode = data.get("social_security_base_mode")
	if ss_mode in (None, "") and "social_security_base" in data:
		ss_mode = JIZHONG_BASE_MODE_CUSTOM
	if ss_mode in (None, "") and is_new_profile:
		frappe.throw("新建员工档案必须选择社险申报基数方式。")
	if ss_mode not in (None, ""):
		doc.social_security_base_mode = _normalize_jizhong_base_mode(ss_mode, "社险申报基数")
	if doc.social_security_base_mode in ("固定基数", "自定义", JIZHONG_BASE_MODE_CUSTOM):
		ss_value = data.get("custom_social_security_base")
		if ss_value in (None, "") and "social_security_base" in data:
			ss_value = data.get("social_security_base")
		if ss_value in (None, ""):
			ss_value = getattr(doc, "custom_social_security_base", 0)
		ss_value = flt(ss_value)
		if ss_value < 0:
			frappe.throw("自定义社险缴费基数不能为负数。")
		doc.custom_social_security_base = round(ss_value, 2)
		doc.social_security_base = doc.custom_social_security_base
	elif doc.social_security_base_mode in ("最低基数", "最低缴费基数", JIZHONG_BASE_MODE_MINIMUM, "不参保"):
		doc.custom_social_security_base = 0
		if doc.social_security_base_mode == "不参保":
			doc.social_security_base = 0

	hf_mode = data.get("housing_fund_base_mode")
	if hf_mode in (None, "") and "housing_fund_base" in data:
		hf_mode = "固定基数"
	if hf_mode in (None, "") and is_new_profile:
		frappe.throw("新建员工档案必须选择公积金申报基数方式。")
	if hf_mode not in (None, ""):
		doc.housing_fund_base_mode = _normalize_jizhong_base_mode(hf_mode, "公积金申报基数")
	if doc.housing_fund_base_mode in ("固定基数", "自定义", JIZHONG_BASE_MODE_CUSTOM):
		hf_value = data.get("custom_housing_fund_base")
		if hf_value in (None, "") and "housing_fund_base" in data:
			hf_value = data.get("housing_fund_base")
		if hf_value in (None, ""):
			hf_value = getattr(doc, "custom_housing_fund_base", 0)
		hf_value = flt(hf_value)
		if hf_value < 0:
			frappe.throw("自定义公积金缴费基数不能为负数。")
		doc.custom_housing_fund_base = round(hf_value, 2)
		doc.housing_fund_base = doc.custom_housing_fund_base
	elif doc.housing_fund_base_mode in ("最低基数", "最低缴费基数", JIZHONG_BASE_MODE_MINIMUM, "不缴纳"):
		doc.custom_housing_fund_base = 0
		if doc.housing_fund_base_mode == "不缴纳":
			doc.housing_fund_base = 0
	raw_hf_policy = str(
		data.get("housing_fund_policy") or getattr(doc, "housing_fund_policy", "跟随公司规则")
	).strip()
	normalized_hf_policy = normalize_jizhong_housing_fund_policy(raw_hf_policy)
	if normalized_hf_policy not in {"跟随公司规则", "固定缴纳", "固定停缴"}:
		frappe.throw("公积金长期缴纳策略无效，请选择跟随公司规则、固定缴纳或固定停缴。")
	doc.housing_fund_policy = normalized_hf_policy

	# 7 项专项附加扣除
	doc.deduction_child_education = flt(data.get("deduction_child_education"))
	doc.deduction_continuing_education = flt(data.get("deduction_continuing_education"))
	doc.deduction_serious_illness = flt(data.get("deduction_serious_illness"))
	doc.deduction_housing_loan = flt(data.get("deduction_housing_loan"))
	doc.deduction_housing_rent = flt(data.get("deduction_housing_rent"))
	doc.deduction_elderly_care = flt(data.get("deduction_elderly_care"))
	doc.deduction_infant_care = flt(data.get("deduction_infant_care"))
	doc.special_additional_deductions_total = (
		doc.deduction_child_education + doc.deduction_continuing_education +
		doc.deduction_serious_illness + doc.deduction_housing_loan +
		doc.deduction_housing_rent + doc.deduction_elderly_care + doc.deduction_infant_care
	)

	# 银行卡与备注
	doc.bank_name = data.get("bank_name") or ""
	doc.bank_account = data.get("bank_account") or ""
	doc.notes = data.get("notes") or ""

	try:
		from ashan_cn_procurement.services.retirement_policy_service import calculate_retirement_details
		ret = calculate_retirement_details(
			certificate_type=doc.certificate_type,
			certificate_number=doc.id_card,
			birth_date=str(doc.birth_date or ""),
			gender=doc.gender,
			retirement_category=data.get("retirement_category"),
			original_retirement_age=data.get("original_retirement_age"),
			delayed_retirement_age=data.get("delayed_retirement_age"),
			job_title="操作工",
			ref_period_month=period_month,
		)
		if ret.get("birth_date") and doc.certificate_type in ("居民身份证", "中国居民身份证"):
			doc.birth_date = ret.get("birth_date")
		if ret.get("gender") and doc.certificate_type in ("居民身份证", "中国居民身份证"):
			doc.gender = ret.get("gender")
		doc.current_age = ret.get("current_age")
		doc.retirement_category = data.get("retirement_category") or ret.get("retirement_category")
		doc.original_retirement_age = ret.get("original_retirement_age")
		doc.delayed_retirement_age = ret.get("delayed_retirement_age")
		doc.original_retirement_period = ret.get("original_retirement_period")
		doc.delayed_retirement_period = ret.get("delayed_retirement_period")
		if data.get("date_of_joining"):
			doc.date_of_joining = data.get("date_of_joining")
		if data.get("relieving_date"):
			doc.relieving_date = data.get("relieving_date")
	except Exception:
		pass

	doc.save()
	return {"success": True, "message": f"员工 {emp_name} ({emp_no}) 档案已成功保存", "profile": doc.as_dict()}
@frappe.whitelist(methods=["POST"])
def mark_jizhong_employees_resigned(company="天津吉众科技有限公司", employee_nos=None, period_month=None, reason=""):
	"""Mark selected Jizhong employees as resigned this month (Payroll Manager only)."""
	company = _assert_jizhong_access("unlock", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "write")
	period_month = _normalize_jizhong_period(period_month, required=False)
	if period_month:
		assert_jizhong_workflow_step_editable(company, period_month, "employees")

	import json
	if isinstance(employee_nos, str):
		try:
			employee_nos = json.loads(employee_nos)
		except (TypeError, ValueError, json.JSONDecodeError):
			employee_nos = [x.strip() for x in employee_nos.split(",") if x.strip()]
	if not employee_nos or not isinstance(employee_nos, list):
		frappe.throw("请选择需要标记离职的员工。")

	updated = []
	for emp_no in employee_nos:
		emp_no = str(emp_no).strip()
		filters = {"company": company, "employee_no": emp_no}
		pname = frappe.db.get_value("Jizhong Employee Salary Profile", filters, "name")
		if not pname:
			continue
		doc = frappe.get_doc("Jizhong Employee Salary Profile", pname)
		doc.employment_status = "本月离职"
		doc.save()
		updated.append(emp_no)

	return {
		"success": True,
		"updated_count": len(updated),
		"employee_nos": updated,
		"message": f"已成功将 {len(updated)} 位员工标记为【本月离职】。"
	}


@frappe.whitelist(methods=["POST"])
def cancel_jizhong_employee_resignation(company="天津吉众科技有限公司", employee_nos=None, period_month=None):
	"""Cancel current-month resignation mark and restore active employment status (Payroll Manager only)."""
	company = _assert_jizhong_access("unlock", company)
	assert_doctype_permission("Jizhong Employee Salary Profile", "write")
	period_month = _normalize_jizhong_period(period_month, required=False)
	if period_month:
		assert_jizhong_workflow_step_editable(company, period_month, "employees")

	import json
	if isinstance(employee_nos, str):
		try:
			employee_nos = json.loads(employee_nos)
		except (TypeError, ValueError, json.JSONDecodeError):
			employee_nos = [x.strip() for x in employee_nos.split(",") if x.strip()]
	if not employee_nos or not isinstance(employee_nos, list):
		frappe.throw("请选择需要恢复在职的员工。")

	updated = []
	for emp_no in employee_nos:
		emp_no = str(emp_no).strip()
		filters = {"company": company, "employee_no": emp_no}
		pname = frappe.db.get_value("Jizhong Employee Salary Profile", filters, "name")
		if not pname:
			continue
		doc = frappe.get_doc("Jizhong Employee Salary Profile", pname)
		doc.employment_status = "在职"
		doc.save()
		updated.append(emp_no)

	return {
		"success": True,
		"updated_count": len(updated),
		"employee_nos": updated,
		"message": f"已成功将 {len(updated)} 位员工恢复为【在职】。"
	}


@frappe.whitelist(methods=["POST"])
def reset_jizhong_month(company="天津吉众科技有限公司", period_month=None, force_empty=False, reason=""):
	"""
	Reset this month (Payroll Manager only):
	- Delete all attendance records and uploaded attendance/settlement files
	- Clear derived draft settlement calculations
	- Reset 6-step confirmations to 0/6 unconfirmed
	- Roll over/restore employee status (restore any employee marked '本月离职' during this period to '在职')
	- If no previous month data, confirm whether to create empty table
	"""
	company = _assert_jizhong_access("unlock", company)
	assert_doctype_permission("Ashan Monthly Payroll Settlement", "write")
	assert_doctype_permission("Jizhong Monthly Attendance", "delete")
	assert_doctype_permission("File", "delete")
	period_month = _normalize_jizhong_period(period_month)

	doc = _get_jizhong_settlement_doc(company, period_month)
	if doc and cint(doc.get("locked")):
		frappe.throw(f"【{period_month}】当前账期已锁定封账，无法重置！请先申请反审核解锁后再执行重置。")

	prev_month = _compute_prev_period(period_month)
	prev_settlement = _get_jizhong_settlement_doc(company, prev_month)
	has_prev_data = bool(prev_settlement and prev_settlement.items)

	if not has_prev_data and not cint(force_empty):
		return {
			"success": False,
			"has_prev_data": False,
			"prev_month": prev_month,
			"period_month": period_month,
			"message": f"未检测到上月（{prev_month}）薪酬数据，是否生成空表？"
		}

	# 1. 彻底删除本月考勤记录
	att_records = frappe.get_list(
		"Jizhong Monthly Attendance",
		filters={"company": company, "period_month": period_month},
		fields=["name", "attendance_file"],
		limit_page_length=0,
	)
	file_urls = set()
	for r in att_records:
		if r.get("attendance_file"):
			file_urls.add(r.get("attendance_file"))
		frappe.delete_doc("Jizhong Monthly Attendance", r.name, force=True)

	# 彻底删除本月上传的考勤及核定附件文件
	file_names = set()
	if file_urls:
		file_names.update(frappe.get_list("File", filters={"file_url": ["in", list(file_urls)]}, pluck="name", limit_page_length=0))
	settlement_name = f"{company}-{period_month}"
	file_names.update(frappe.get_list("File", filters={"attached_to_doctype": "Ashan Monthly Payroll Settlement", "attached_to_name": settlement_name}, pluck="name", limit_page_length=0))
	for fname in file_names:
		try:
			frappe.delete_doc("File", fname, force=True)
		except Exception:
			pass

	# 2. 清理当前账期草稿薪资测算与重置 6 项前置确认 (0 / 6)
	curr_doc = _get_jizhong_settlement_doc(company, period_month, create=True)
	_clear_jizhong_calculation(curr_doc)
	curr_doc.status = "草稿"
	curr_doc.workflow_stage = "草稿"
	reset_reason = reason or (f"清空考勤与附件，读取上月（{prev_month}）基准重置本月" if has_prev_data else "无上月数据，生成空表账期")
	_record_jizhong_confirmation_event(curr_doc, "all", "reset", reason=reset_reason)
	curr_doc.save()

	# 3. 恢复员工档案在职状态（若本账期曾标记为“本月离职”，重置恢复为“在职”）
	resigned_profiles = frappe.get_list(
		"Jizhong Employee Salary Profile",
		filters={"company": company, "employment_status": "本月离职"},
		pluck="name",
		limit_page_length=0,
	)
	for pname in resigned_profiles:
		pdoc = frappe.get_doc("Jizhong Employee Salary Profile", pname)
		pdoc.employment_status = "在职"
		pdoc.save()

	msg = (
		f"已成功重置【{period_month}】！已彻底清空本月考勤与已上传附件，重置所有前置确认进度（0/6）。"
		if has_prev_data
		else f"已成功为【{period_month}】生成空表账期。"
	)
	return {
		"success": True,
		"has_prev_data": has_prev_data,
		"prev_month": prev_month,
		"period_month": period_month,
		"message": msg
	}


def ensure_default_jizhong_employee_type_policies(company="天津吉众科技有限公司"):
	"""Seed default Jizhong employee type calculation rules if absent."""
	defaults = [
		{
			"employee_type": "正式工",
			"category_group": "正式工",
			"participate_tax": 1,
			"participate_social_security": 1,
			"participate_housing_fund": 1,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "按综合所得累计预扣法申报个税",
			"insurance_rule_description": "全额缴纳五险一金（基数按档案或最低基数）",
		},
		{
			"employee_type": "返聘工",
			"category_group": "退休返聘人员",
			"participate_tax": 1,
			"participate_social_security": 0,
			"participate_housing_fund": 0,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "达到法定退休年龄返聘，按工资薪金计税",
			"insurance_rule_description": "免缴社保公积金",
		},
		{
			"employee_type": "其他-返聘工",
			"category_group": "退休返聘人员",
			"participate_tax": 1,
			"participate_social_security": 0,
			"participate_housing_fund": 0,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "达到法定退休年龄返聘，按工资薪金计税",
			"insurance_rule_description": "免缴社保公积金",
		},
		{
			"employee_type": "其他-正式工",
			"category_group": "正式工",
			"participate_tax": 1,
			"participate_social_security": 1,
			"participate_housing_fund": 1,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "按综合所得累计预扣法申报个税",
			"insurance_rule_description": "缴纳社保公积金",
		},
		{
			"employee_type": "临时工",
			"category_group": "临时工",
			"participate_tax": 0,
			"participate_social_security": 0,
			"participate_housing_fund": 0,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "临时工按实际工时发放，不扣社保公积金与个税",
			"insurance_rule_description": "不缴纳社保与公积金",
		},
		{
			"employee_type": "本月离职",
			"category_group": "离职人员",
			"participate_tax": 1,
			"participate_social_security": 0,
			"participate_housing_fund": 0,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "本月离职结算实发与个税，次月减员停保",
			"insurance_rule_description": "本月离职不参与下月保险和公积金",
		},
		{
			"employee_type": "退休返聘人员",
			"category_group": "退休返聘人员",
			"participate_tax": 1,
			"participate_social_security": 0,
			"participate_housing_fund": 0,
			"participate_attendance": 1,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "达到法定退休年龄返聘，按劳务报酬或工资薪金计税",
			"insurance_rule_description": "停缴基本养老与失业保险，不缴纳公积金",
		},
		{
			"employee_type": "其他类型员工",
			"category_group": "其他员工",
			"participate_tax": 1,
			"participate_social_security": 0,
			"participate_housing_fund": 0,
			"participate_attendance": 0,
			"participate_payroll": 1,
			"participate_cash_bills": 1,
			"tax_rule_description": "特殊固定薪资或外部协议人员，根据约定义务计税",
			"insurance_rule_description": "按独立协议执行",
		},
	]
	for row in defaults:
		doc_name = f"{company}-{row['employee_type']}"
		if not frappe.db.exists("Jizhong Employee Type Policy", doc_name):
			doc = frappe.new_doc("Jizhong Employee Type Policy")
			doc.company = company
			doc.update(row)
			doc.insert()
		else:
			doc = frappe.get_doc("Jizhong Employee Type Policy", doc_name)
			if doc.participate_payroll is None:
				doc.participate_payroll = row.get("participate_payroll", 1)
				doc.save()


def get_jizhong_employee_type_policies(company="天津吉众科技有限公司"):
	"""Read active Jizhong employee type policies in canonical order."""
	ensure_default_jizhong_employee_type_policies(company)
	rows = frappe.get_list(
		"Jizhong Employee Type Policy",
		filters={"company": company, "is_active": 1},
		fields=[
			"name", "employee_type", "category_group", "participate_tax",
			"participate_social_security", "participate_housing_fund",
			"participate_attendance", "participate_payroll", "participate_cash_bills"
		],
		order_by="creation asc"
	)
	order = ["正式工", "返聘工", "其他-返聘工", "其他-正式工", "临时工", "本月离职", "退休返聘人员", "其他类型员工"]
	return sorted(rows, key=lambda x: order.index(x.get("employee_type")) if x.get("employee_type") in order else 99)


def save_jizhong_employee_type_policies(company, policies):
	"""Update Jizhong employee type policies in batch."""
	if not policies or not isinstance(policies, list):
		return
	for item in policies:
		emp_type = str(item.get("employee_type") or "").strip()
		if not emp_type:
			continue
		doc_name = f"{company}-{emp_type}"
		if frappe.db.exists("Jizhong Employee Type Policy", doc_name):
			doc = frappe.get_doc("Jizhong Employee Type Policy", doc_name)
		else:
			doc = frappe.new_doc("Jizhong Employee Type Policy")
			doc.company = company
			doc.employee_type = emp_type
			doc.category_group = item.get("category_group") or _jizhong_employee_category(emp_type)
		for fld in ["participate_social_security", "participate_housing_fund", "participate_tax", "participate_payroll", "participate_cash_bills"]:
			if fld in item:
				setattr(doc, fld, 1 if cint(item.get(fld)) else 0)
		doc.is_active = 1
		doc.save()
