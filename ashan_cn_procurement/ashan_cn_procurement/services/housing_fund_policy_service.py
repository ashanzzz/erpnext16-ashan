# Copyright (c) 2026, Ashan CN Procurement
"""Housing-fund participation policy engine.

The employee master stores a long-term contribution base and a long-term policy.
The effective base for a payroll month is derived at calculation time, so quarterly
on/off rules never destroy the authoritative master base.
"""

from calendar import monthrange
from datetime import date

import frappe
from frappe.utils import cint, flt, getdate, today
from ashan_cn_procurement.services.payroll_proof_validation import expected_proof_period

POLICY_FOLLOW = "跟随公司规则"
POLICY_FIXED_ON = "固定缴纳"
POLICY_FIXED_OFF = "固定停缴"
VALID_POLICIES = {POLICY_FOLLOW, POLICY_FIXED_ON, POLICY_FIXED_OFF}
JIZHONG_POLICY_QUARTER_START = "季度初规则"
JIZHONG_POLICY_MONTHLY = "每月正常缴纳"
JIZHONG_POLICY_NEVER = "不缴纳"
JIZHONG_POLICY_ALIASES = {
    JIZHONG_POLICY_QUARTER_START: POLICY_FOLLOW,
    JIZHONG_POLICY_MONTHLY: POLICY_FIXED_ON,
    JIZHONG_POLICY_NEVER: POLICY_FIXED_OFF,
}
JIZHONG_POLICY_LABELS = {
    POLICY_FOLLOW: JIZHONG_POLICY_QUARTER_START,
    POLICY_FIXED_ON: JIZHONG_POLICY_MONTHLY,
    POLICY_FIXED_OFF: JIZHONG_POLICY_NEVER,
}

OVERRIDE_ON = "强制缴纳"
OVERRIDE_OFF = "强制停缴"
VALID_OVERRIDES = {OVERRIDE_ON, OVERRIDE_OFF}

BASE_MODE_MINIMUM = "最低缴费基数"
BASE_MODE_CUSTOM = "自定义"
VALID_BASE_MODES = {BASE_MODE_MINIMUM, BASE_MODE_CUSTOM}

DEFAULT_MONTHS = [1, 4, 7, 10]
EXCLUDED_EMPLOYEE_TYPES = {"返聘工", "退休返聘", "其他-返聘工", "临时工", "零工", "外籍工", "实习生"}

def normalize_period_month(period_month=None):
    text = str(period_month or "").strip()
    if len(text) == 6 and text.isdigit():
        text = f"{text[:4]}-{text[4:]}"
    if not text:
        text = today()[:7]
    try:
        year, month = [int(x) for x in text.split("-")[:2]]
        if month < 1 or month > 12:
            raise ValueError
    except Exception:
        frappe.throw("账期格式必须为 YYYY-MM，例如 2026-07。")
    return f"{year:04d}-{month:02d}", year, month


def normalize_housing_fund_policy(policy):
    """Accept the concise Jizhong labels without changing legacy policy storage."""
    value = str(policy or POLICY_FOLLOW).strip()
    return JIZHONG_POLICY_ALIASES.get(value, value)


def get_jizhong_housing_fund_policy_label(policy):
    """Return the Jizhong-facing label for a legacy or current policy value."""
    normalized = normalize_housing_fund_policy(policy)
    return JIZHONG_POLICY_LABELS.get(normalized, JIZHONG_POLICY_QUARTER_START)


def parse_contribution_months(value):
    if isinstance(value, (list, tuple, set)):
        raw = list(value)
    else:
        text = str(value or "").replace("，", ",").replace("、", ",").replace(";", ",").replace("；", ",")
        raw = [x.strip() for x in text.split(",") if x.strip()]
    months = []
    for item in raw:
        try:
            month = int(item)
        except Exception:
            continue
        if 1 <= month <= 12 and month not in months:
            months.append(month)
    return sorted(months) or list(DEFAULT_MONTHS)


def normalize_policy_setting(setting=None):
    setting = setting or {}
    enabled = cint(setting.get("hf_auto_rule_enabled", 1)) != 0
    months = parse_contribution_months(setting.get("hf_contribution_months") or "1,4,7,10")
    off_action = str(setting.get("hf_off_month_action") or "停缴").strip()
    if off_action not in {"停缴", "继续缴纳"}:
        off_action = "停缴"
    return {
        "enabled": enabled,
        "months": months,
        "months_text": ",".join(str(x) for x in months),
        "off_action": off_action,
    }


@frappe.whitelist(methods=["POST"])
def repair_housing_fund_baseline(company, period_month=None, fixed_on_employee_nos=None):
    """Repair a company's housing-fund baseline using explicit administrator input.

    The operation never embeds a company, employee, or contribution base.  It is
    deliberately manager-only and uses the annual insurance configuration as the
    source for a missing eligible employee's base.
    """
    from ashan_cn_procurement.services.employee_salary_service import (
        _queue_salary_recalculation,
        get_insurance_setting,
    )
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("lock", company)
    if isinstance(fixed_on_employee_nos, str):
        fixed_on_employee_nos = [
            employee_no.strip()
            for employee_no in fixed_on_employee_nos.split(",")
            if employee_no.strip()
        ]
    fixed_on_employee_nos = {str(employee_no).strip() for employee_no in (fixed_on_employee_nos or [])}

    # Recalculate the newest open settlement instead of coupling this one-time repair
    # to the server date.  This keeps the migration correct when the payroll book is
    # deliberately being processed for a prior month.
    selected_period = period_month
    if not selected_period:
        open_settlements = frappe.get_all(
            "Ashan Monthly Payroll Settlement",
            filters={"company": company, "locked": 0},
            fields=["period_month"],
            order_by="period_month desc",
            limit_page_length=1,
        )
        selected_period = (open_settlements[0].get("period_month") if open_settlements else None)

    target_period, year, _month = normalize_period_month(selected_period)
    setting = get_insurance_setting(company, year) or {}
    minimum_base = flt(setting.get("hf_min_base"))
    if minimum_base <= 0:
        frappe.throw(f"{company} 尚未维护 {year} 年公积金最低基数，无法执行基线修复。")
    profiles = frappe.get_all(
        "Ashan Employee Salary Profile",
        filters={"company": company},
        fields=["name", "employee_no", "employee_type", "housing_fund_base", "housing_fund_policy"],
        order_by="employee_no asc",
    )

    policy_updates = 0
    base_backfills = 0
    changed_employee_nos = []
    for profile in profiles:
        doc = frappe.get_doc("Ashan Employee Salary Profile", profile.name)
        expected_policy = (
            POLICY_FIXED_ON
            if str(doc.employee_no or "") in fixed_on_employee_nos
            else POLICY_FOLLOW
        )
        changed = False
        if (doc.housing_fund_policy or POLICY_FOLLOW) != expected_policy:
            doc.housing_fund_policy = expected_policy
            policy_updates += 1
            changed = True

        employee_type = str(doc.employee_type or "正式工").strip()
        if employee_type not in EXCLUDED_EMPLOYEE_TYPES and flt(doc.housing_fund_base) <= 0:
            doc.housing_fund_base = minimum_base
            base_backfills += 1
            changed = True

        if changed:
            doc.save(ignore_permissions=True)
            changed_employee_nos.append(str(doc.employee_no or ""))

    if changed_employee_nos:
        _queue_salary_recalculation(
            company,
            target_period,
            None,
            "住房公积金台账与配置",
            trigger_detail="按管理员指定的固定缴纳名单恢复长期策略，并补齐符合条件员工的最低公积金基数",
        )
        frappe.db.commit()

    return {
        "success": True,
        "period_month": target_period,
        "minimum_base": minimum_base,
        "policy_updates": policy_updates,
        "base_backfills": base_backfills,
        "changed_count": len(changed_employee_nos),
    }


def _value(employee, key, default=None):
    if employee is None:
        return default
    if isinstance(employee, dict):
        return employee.get(key, default)
    try:
        return employee.get(key, default)
    except Exception:
        return getattr(employee, key, default)


def resolve_housing_fund_base(employee, setting=None):
    """Resolve a profile's effective housing-fund base for the selected month.

    Profiles without the new mode field remain backward compatible and continue to
    use their stored base. A profile explicitly bound to the minimum base always
    reads the period insurance setting at calculation time.
    """
    legacy_base = max(0.0, flt(_value(employee, "housing_fund_base", 0)))
    raw_mode = _value(employee, "housing_fund_base_mode", None)
    mode = str(raw_mode or "").strip()
    if not mode:
        return round(legacy_base, 2)
    if mode not in VALID_BASE_MODES:
        frappe.throw("公积金申报基数方式只能选择最低缴费基数或自定义。")
    if mode == BASE_MODE_CUSTOM:
        custom_base = _value(employee, "custom_housing_fund_base", None)
        if custom_base in (None, ""):
            custom_base = legacy_base
        return round(max(0.0, flt(custom_base)), 2)
    setting_getter = (
        setting.get
        if hasattr(setting, "get")
        else lambda key, default=None: getattr(setting, key, default)
    )
    minimum_base = flt(setting_getter("hf_min_base", 0))
    if minimum_base <= 0:
        frappe.throw("当前核算月未配置有效的公积金最低缴费基数。")
    return round(minimum_base, 2)


def evaluate_housing_fund_policy(employee, period_month, setting=None, override_mode=None):
    """Return effective monthly base and an explainable decision.

    ``period_month`` is always the payroll calculation month.  Company quarterly
    months are statutory housing-fund *payment* months, so the automatic schedule
    is evaluated against the following calendar month.  Monthly overrides stay on
    the payroll month because their audit key is the payroll settlement.

    Precedence after basic eligibility:
      monthly override > employee long-term policy > company automatic schedule.
    """
    period_month, _year, _month = normalize_period_month(period_month)
    payment_period_month = expected_proof_period(period_month)
    _payment_year, month = [int(value) for value in payment_period_month.split("-")]
    rule = normalize_policy_setting(setting)
    base = resolve_housing_fund_base(employee, setting)
    emp_type = str(_value(employee, "employee_type", "正式工") or "正式工").strip()
    policy = normalize_housing_fund_policy(
        _value(employee, "housing_fund_policy", POLICY_FOLLOW)
    )
    if policy not in VALID_POLICIES:
        policy = POLICY_FOLLOW
    override_mode = str(override_mode or "").strip()
    if override_mode not in VALID_OVERRIDES:
        override_mode = ""

    result = {
        "period_month": period_month,
        "payment_period_month": payment_period_month,
        "month": month,
        "master_base": round(base, 2),
        "effective_base": 0.0,
        "employee_policy": policy,
        "monthly_override": override_mode,
        "auto_enabled": rule["enabled"],
        "scheduled_months": rule["months"],
        "is_scheduled_month": month in rule["months"],
        "is_contributing": False,
        "decision_code": "STOPPED",
        "decision_label": "本月停缴",
        "decision_source": "公司规则",
        "reason": "",
    }

    # Long-term master base remains authoritative. Zero base always means no contribution.
    if base <= 0:
        result.update({"decision_code": "NO_BASE", "decision_label": "未设置基数", "decision_source": "员工母表", "reason": "员工母表公积金长期基数为 0。"})
        return result

    # These employee types remain outside the current housing-fund business boundary.
    if emp_type in EXCLUDED_EMPLOYEE_TYPES:
        result.update({"decision_code": "INELIGIBLE_TYPE", "decision_label": "不参与", "decision_source": "用工规则", "reason": f"{emp_type} 当前不进入公积金统筹。"})
        return result

    if override_mode == OVERRIDE_OFF:
        result.update({"decision_code": "OVERRIDE_OFF", "decision_label": "本月强制停缴", "decision_source": "本月例外", "reason": "本月人工例外设置为强制停缴。"})
        return result
    if override_mode == OVERRIDE_ON:
        result.update({"effective_base": round(base, 2), "is_contributing": True, "decision_code": "OVERRIDE_ON", "decision_label": "本月强制缴纳", "decision_source": "本月例外", "reason": "本月人工例外设置为强制缴纳。"})
        return result

    if policy == POLICY_FIXED_OFF:
        result.update({"decision_code": "FIXED_OFF", "decision_label": "固定停缴", "decision_source": "员工母表", "reason": "员工母表长期策略为固定停缴。"})
        return result
    if policy == POLICY_FIXED_ON:
        result.update({"effective_base": round(base, 2), "is_contributing": True, "decision_code": "FIXED_ON", "decision_label": "固定缴纳", "decision_source": "员工母表", "reason": "员工母表长期策略为固定缴纳，不受季度月份限制。"})
        return result

    if not rule["enabled"]:
        result.update({"effective_base": round(base, 2), "is_contributing": True, "decision_code": "AUTO_DISABLED", "decision_label": "按母表缴纳", "decision_source": "公司规则", "reason": "季度自动规则已关闭，按员工母表长期基数缴纳。"})
        return result

    if month in rule["months"]:
        result.update({"effective_base": round(base, 2), "is_contributing": True, "decision_code": "SCHEDULED_ON", "decision_label": "季度自动缴纳", "decision_source": "公司规则", "reason": f"实际缴费 {month} 月属于自动缴纳月份。"})
        return result

    if rule["off_action"] == "继续缴纳":
        result.update({"effective_base": round(base, 2), "is_contributing": True, "decision_code": "OFF_MONTH_KEEP", "decision_label": "非计划月继续缴纳", "decision_source": "公司规则", "reason": f"实际缴费 {month} 月不是计划月，但公司配置为非计划月继续缴纳。"})
        return result

    result.update({"decision_code": "SCHEDULED_OFF", "decision_label": "季度规则停缴", "decision_source": "公司规则", "reason": f"实际缴费 {month} 月不是自动缴纳月份，按规则本月停缴。"})
    return result


def get_override_map(company, period_month):
    period_month, _year, _month = normalize_period_month(period_month)
    if not frappe.db.exists("DocType", "Ashan Housing Fund Monthly Override"):
        return {}
    rows = frappe.get_all(
        "Ashan Housing Fund Monthly Override",
        filters={"company": company, "period_month": period_month},
        fields=["employee_no", "override_mode", "reason", "name"],
    )
    return {str(r.employee_no): r for r in rows}


def effective_housing_fund_base(employee, period_month, setting=None, override_map=None):
    emp_no = str(_value(employee, "employee_no", "") or "")
    override = (override_map or {}).get(emp_no) if override_map is not None else None
    if override is None and emp_no:
        override = get_override_map(_value(employee, "company", None), period_month).get(emp_no) if _value(employee, "company", None) else None
    mode = _value(override, "override_mode", "") if override else ""
    return evaluate_housing_fund_policy(employee, period_month, setting=setting, override_mode=mode)


def _profiles_for_period(company, period_month):
    period_month, year, month = normalize_period_month(period_month)
    month_start = date(year, month, 1)
    month_end = date(year, month, monthrange(year, month)[1])
    rows = frappe.get_all(
        "Ashan Employee Salary Profile",
        filters={"company": company},
        fields=[
            "name", "employee_no", "employee_name", "employee_type", "employment_status",
            "date_of_joining", "relieving_date", "housing_fund_base", "housing_fund_policy",
        ],
        order_by="employee_no asc",
    )
    out = []
    for row in rows:
        joined = getdate(row.date_of_joining) if row.date_of_joining else None
        relieved = getdate(row.relieving_date) if row.relieving_date else None
        if joined and joined > month_end:
            continue
        if relieved and relieved < month_start:
            continue
        if str(row.employment_status or "在职") in {"离职", "已离职"} and not relieved:
            continue
        # Keep the pre-existing business rule: someone leaving during this payroll month is not contributed.
        if relieved and month_start <= relieved <= month_end:
            row["period_ineligible_reason"] = "本月离职减员"
        out.append(row)
    return out


def _assert_period_open(company, period_month):
    name = f"{company}-{period_month}"
    if not frappe.db.exists("Ashan Monthly Payroll Settlement", name):
        return
    state = frappe.db.get_value("Ashan Monthly Payroll Settlement", name, ["locked", "status"], as_dict=True) or {}
    if cint(state.get("locked")) or state.get("status") in {"已核定锁定", "已归档发放", "Locked", "Submitted"}:
        frappe.throw("当前账期已冻结。本月例外不能直接修改，请先按审计流程反审核解锁。")


@frappe.whitelist()
def get_housing_fund_policy_summary(company=None, period_month=None):
    from ashan_cn_procurement.services.employee_salary_service import get_insurance_setting
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("read", company)
    period_month, year, _month = normalize_period_month(period_month)
    payment_period_month = expected_proof_period(period_month)
    payment_month = cint(payment_period_month.split("-")[1])
    setting = get_insurance_setting(company, year) or {}
    rule = normalize_policy_setting(setting)
    overrides = get_override_map(company, period_month)
    profiles = _profiles_for_period(company, period_month)

    rows = []
    counts = {
        "total": 0, "contributing": 0, "stopped": 0, "fixed_on": 0, "fixed_off": 0,
        "override_on": 0, "override_off": 0, "follow": 0,
    }
    for emp in profiles:
        counts["total"] += 1
        if emp.get("period_ineligible_reason"):
            decision = evaluate_housing_fund_policy(emp, period_month, setting, overrides.get(str(emp.employee_no), {}).get("override_mode") if overrides.get(str(emp.employee_no)) else "")
            decision["effective_base"] = 0.0
            decision["is_contributing"] = False
            decision["decision_code"] = "PERIOD_INELIGIBLE"
            decision["decision_label"] = "本月减员"
            decision["decision_source"] = "在册边界"
            decision["reason"] = emp.get("period_ineligible_reason")
        else:
            ov = overrides.get(str(emp.employee_no))
            decision = evaluate_housing_fund_policy(emp, period_month, setting, ov.override_mode if ov else "")
        if decision["is_contributing"]:
            counts["contributing"] += 1
        else:
            counts["stopped"] += 1
        pol = decision["employee_policy"]
        if pol == POLICY_FIXED_ON:
            counts["fixed_on"] += 1
        elif pol == POLICY_FIXED_OFF:
            counts["fixed_off"] += 1
        else:
            counts["follow"] += 1
        if decision["monthly_override"] == OVERRIDE_ON:
            counts["override_on"] += 1
        elif decision["monthly_override"] == OVERRIDE_OFF:
            counts["override_off"] += 1
        rows.append({
            "name": emp.name,
            "employee_no": emp.employee_no,
            "employee_name": emp.employee_name,
            "employee_type": emp.employee_type,
            "housing_fund_base": flt(emp.housing_fund_base),
            "housing_fund_policy": emp.housing_fund_policy or POLICY_FOLLOW,
            **decision,
        })

    return {
        "company": company,
        "period_month": period_month,
        "payment_period_month": payment_period_month,
        "schedule_period_month": payment_period_month,
        "rule": rule,
        "is_scheduled_month": payment_month in rule["months"],
        "counts": counts,
        "rows": rows,
    }


@frappe.whitelist(methods=["POST"])
def save_housing_fund_policy_setting(company, year, enabled=1, contribution_months="1,4,7,10", off_month_action="停缴", period_month=None):
    from ashan_cn_procurement.services.employee_salary_service import _new_insurance_setting, _queue_salary_recalculation
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("write", company)
    year = cint(year) or date.today().year
    months = parse_contribution_months(contribution_months)
    off_month_action = str(off_month_action or "停缴").strip()
    if off_month_action not in {"停缴", "继续缴纳"}:
        frappe.throw("非计划月份处理方式不正确。")
    name = f"{company}-{year}"
    doc = frappe.get_doc("Ashan Insurance Setting", name) if frappe.db.exists("Ashan Insurance Setting", name) else _new_insurance_setting(company, year)
    doc.hf_auto_rule_enabled = 1 if cint(enabled) else 0
    doc.hf_contribution_months = ",".join(str(x) for x in months)
    doc.hf_off_month_action = off_month_action
    doc.save(ignore_permissions=True)
    _queue_salary_recalculation(company, period_month, None, "住房公积金自动规则", trigger_detail="调整季度自动缴纳规则")
    frappe.db.commit()
    return {
        "success": True,
        "message": f"公积金自动规则已保存：缴纳月份 {doc.hf_contribution_months}；其他月份 {doc.hf_off_month_action}。",
        "rule": normalize_policy_setting(doc.as_dict()),
    }


@frappe.whitelist(methods=["POST"])
def set_employee_housing_fund_policy(company, employee_nos, policy, period_month=None):
    from ashan_cn_procurement.services.employee_salary_service import _queue_salary_recalculation
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("write", company)
    if isinstance(employee_nos, str):
        try:
            import json
            employee_nos = json.loads(employee_nos)
        except Exception:
            employee_nos = [x.strip() for x in employee_nos.split(",") if x.strip()]
    employee_nos = [str(x).strip() for x in (employee_nos or []) if str(x).strip()]
    policy = str(policy or "").strip()
    if policy not in VALID_POLICIES:
        frappe.throw("公积金长期策略不正确。")
    updated = 0
    for emp_no in employee_nos:
        name = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": emp_no}, "name")
        if not name:
            continue
        doc = frappe.get_doc("Ashan Employee Salary Profile", name)
        if (doc.housing_fund_policy or POLICY_FOLLOW) == policy:
            continue
        doc.housing_fund_policy = policy
        doc.save(ignore_permissions=True)
        updated += 1
    if updated:
        _queue_salary_recalculation(company, period_month, None, "员工薪酬档案", trigger_detail=f"批量设置公积金长期策略：{policy}")
    frappe.db.commit()
    return {"success": True, "updated_count": updated, "message": f"已更新 {updated} 位员工的公积金长期策略为“{policy}”。"}


@frappe.whitelist(methods=["POST"])
def save_housing_fund_monthly_override(company, period_month, employee_no, override_mode, reason=""):
    from ashan_cn_procurement.services.employee_salary_service import _queue_salary_recalculation
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("write", company)
    period_month, _year, _month = normalize_period_month(period_month)
    _assert_period_open(company, period_month)
    override_mode = str(override_mode or "").strip()
    if override_mode not in VALID_OVERRIDES:
        frappe.throw("本月例外必须选择“强制缴纳”或“强制停缴”。")
    emp = frappe.db.get_value(
        "Ashan Employee Salary Profile", {"company": company, "employee_no": employee_no}, ["employee_name", "name"], as_dict=True
    )
    if not emp:
        frappe.throw(f"未找到员工 {employee_no}。")
    name = f"{company}-{period_month}-{employee_no}"
    doc = frappe.get_doc("Ashan Housing Fund Monthly Override", name) if frappe.db.exists("Ashan Housing Fund Monthly Override", name) else frappe.new_doc("Ashan Housing Fund Monthly Override")
    doc.company = company
    doc.period_month = period_month
    doc.employee_no = employee_no
    doc.employee_name = emp.employee_name
    doc.override_mode = override_mode
    doc.reason = str(reason or "").strip()
    doc.save(ignore_permissions=True)
    _queue_salary_recalculation(company, period_month, employee_no, "住房公积金本月例外", trigger_detail=f"{override_mode}：{doc.reason or '未填写原因'}")
    frappe.db.commit()
    return {"success": True, "message": f"{emp.employee_name} 的 {period_month} 公积金已设置为“{override_mode}”。"}


@frappe.whitelist(methods=["POST"])
def delete_housing_fund_monthly_override(company, period_month, employee_no):
    from ashan_cn_procurement.services.employee_salary_service import _queue_salary_recalculation
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("write", company)
    period_month, _year, _month = normalize_period_month(period_month)
    _assert_period_open(company, period_month)
    name = f"{company}-{period_month}-{employee_no}"
    if frappe.db.exists("Ashan Housing Fund Monthly Override", name):
        frappe.delete_doc("Ashan Housing Fund Monthly Override", name, ignore_permissions=True)
        _queue_salary_recalculation(company, period_month, employee_no, "住房公积金本月例外", trigger_detail="取消本月例外，恢复自动规则")
        frappe.db.commit()
    return {"success": True, "message": "本月例外已取消，恢复按长期策略和公司自动规则计算。"}

@frappe.whitelist(methods=["POST"])
def save_employee_housing_fund_policies(company, policies_json, period_month=None):
    """Bulk-save employee long-term housing-fund policies from the policy matrix UI."""
    import json
    from ashan_cn_procurement.services.employee_salary_service import _queue_salary_recalculation
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    check_payroll_workbench_permission("write", company)
    policies = json.loads(policies_json) if isinstance(policies_json, str) else (policies_json or {})
    if not isinstance(policies, dict):
        frappe.throw("长期策略数据格式不正确。")
    updated = 0
    changed_names = []
    for emp_no, policy in policies.items():
        emp_no = str(emp_no or "").strip()
        policy = str(policy or POLICY_FOLLOW).strip()
        if not emp_no or policy not in VALID_POLICIES:
            continue
        name = frappe.db.get_value("Ashan Employee Salary Profile", {"company": company, "employee_no": emp_no}, "name")
        if not name:
            continue
        doc = frappe.get_doc("Ashan Employee Salary Profile", name)
        old = doc.housing_fund_policy or POLICY_FOLLOW
        if old == policy:
            continue
        doc.housing_fund_policy = policy
        doc.save(ignore_permissions=True)
        updated += 1
        changed_names.append(doc.employee_name)
    if updated:
        _queue_salary_recalculation(company, period_month, None, "员工薪酬档案", trigger_detail="批量更新公积金长期策略")
    frappe.db.commit()
    return {
        "success": True,
        "updated_count": updated,
        "changed_names": changed_names,
        "message": f"已保存公积金长期策略，共更新 {updated} 位员工。",
    }
