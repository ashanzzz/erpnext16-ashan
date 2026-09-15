# Copyright (c) 2026, Ashan CN Procurement
"""China retirement-age policy engine used by the payroll employee master.

The engine is intentionally isolated from the UI and payroll arithmetic.  Policy
parameters live in one declarative registry so future policy changes can be
reviewed or edited without touching employee-table rendering code.

Policy basis (effective 2025-01-01):
- male employees: original 60 -> statutory 63, +1 month per 4 birth months;
- female employees whose original statutory age is 55: 55 -> 58, same pace;
- female employees whose original statutory age is 50: 50 -> 55, +1 month per
  2 birth months;
- flexible early retirement is at most 36 months before the new statutory age
  and may never be below the original statutory age;
- flexible delayed retirement is at most 36 months after statutory age and
  requires agreement with the employer.

This module returns *age/retirement windows*.  Pension eligibility still depends
on the minimum contribution period and any special rules applicable to the
employee.
"""

from __future__ import annotations

from datetime import date, datetime
import calendar
import re


POLICY_VERSION = "CN-RETIRE-2025-V1"
POLICY_EFFECTIVE_FROM = "2025-01-01"
POLICY_SOURCE_URLS = [
    "https://www.gov.cn/yaowen/liebiao/202409/content_6974294.htm",
    "https://www.mohrss.gov.cn/wap/zc/zcwj/202501/t20250101_533701.html",
]

CATEGORY_MALE_60 = "男职工（原60岁）"
CATEGORY_FEMALE_55 = "女职工（原55岁）"
CATEGORY_FEMALE_50 = "女职工（原50岁）"
CATEGORY_MANUAL = "特殊政策/人工确认"

RETIREMENT_CATEGORIES = (
    CATEGORY_MALE_60,
    CATEGORY_FEMALE_55,
    CATEGORY_FEMALE_50,
    CATEGORY_MANUAL,
)

# Birth-month based statutory-delay rules.  start_birth_month is the first
# cohort receiving one month of delay.
POLICY_RULES = {
    CATEGORY_MALE_60: {
        "gender": "男",
        "original_age_months": 60 * 12,
        "start_birth_month": "1965-01",
        "birth_months_per_delay_month": 4,
        "max_delay_months": 36,
    },
    CATEGORY_FEMALE_55: {
        "gender": "女",
        "original_age_months": 55 * 12,
        "start_birth_month": "1970-01",
        "birth_months_per_delay_month": 4,
        "max_delay_months": 36,
    },
    CATEGORY_FEMALE_50: {
        "gender": "女",
        "original_age_months": 50 * 12,
        "start_birth_month": "1975-01",
        "birth_months_per_delay_month": 2,
        "max_delay_months": 60,
    },
}

FLEXIBLE_EARLY_MAX_MONTHS = 36
FLEXIBLE_DELAY_MAX_MONTHS = 36
WARNING_MONTHS = 3
EARLY_RETIREMENT_NOTICE_MONTHS = 3
LATE_RETIREMENT_AGREEMENT_NOTICE_MONTHS = 1

_ID_WEIGHTS = (7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2)
_ID_CHECK_CODES = "10X98765432"


def _clean_text(value):
    return str(value or "").strip()


def _parse_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = _clean_text(value)[:10]
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except Exception:
            continue
    return None


def _month_index(year, month):
    return int(year) * 12 + (int(month) - 1)


def _index_to_period(idx):
    year, month0 = divmod(int(idx), 12)
    return f"{year:04d}-{month0 + 1:02d}"


def _period_to_index(period_month=None):
    text = _clean_text(period_month)
    match = re.match(r"^(\d{4})[-/.年](\d{1,2})", text)
    if match:
        year, month = int(match.group(1)), int(match.group(2))
        if 1 <= month <= 12:
            return _month_index(year, month)
    today = date.today()
    return _month_index(today.year, today.month)


def _period_last_date(period_month):
    year, month = [int(x) for x in period_month.split("-")]
    return date(year, month, calendar.monthrange(year, month)[1])


def _age_display(age_months):
    months = max(0, int(age_months or 0))
    years, rem = divmod(months, 12)
    return f"{years}岁" if rem == 0 else f"{years}岁{rem}个月"


def minimum_pension_contribution_months(period_month):
    """Return the statutory minimum contribution threshold for a retirement year.

    Before 2030 the general threshold is 15 years. From 2030 it increases by six
    months per calendar year until reaching 20 years. This is only the statutory
    threshold; the engine does not know an employee's actual contribution history.
    """
    text = _clean_text(period_month)
    match = re.match(r"^(\d{4})", text)
    if not match:
        return 180
    year = int(match.group(1))
    if year < 2030:
        return 180
    return min(240, 180 + (year - 2029) * 6)


def _contribution_display(months):
    months = max(0, int(months or 0))
    years, rem = divmod(months, 12)
    return f"{years}年" if rem == 0 else f"{years}年{rem}个月"


def validate_chinese_id_number(id_number):
    """Validate an 18-digit PRC resident ID, including birth date and checksum."""
    text = _clean_text(id_number).upper()
    result = {
        "is_valid": False,
        "is_chinese_id": False,
        "birth_date": "",
        "gender": "",
        "message": "",
    }
    if re.fullmatch(r"\d{15}", text):
        # Historical 15-digit resident IDs have no checksum. Keep compatibility for
        # legacy employee archives while recommending migration to the 18-digit ID.
        result["is_chinese_id"] = True
        try:
            birth = datetime.strptime("19" + text[6:12], "%Y%m%d").date()
        except Exception:
            result["message"] = "15位历史身份证中的出生日期无效"
            return result
        result.update({
            "is_valid": True,
            "birth_date": birth.isoformat(),
            "gender": "男" if int(text[14]) % 2 else "女",
            "message": "已识别15位历史身份证，建议后续更新为18位身份证号码",
        })
        return result

    if not re.fullmatch(r"\d{17}[0-9X]", text):
        result["message"] = "证件号码不是标准18位或历史15位居民身份证格式"
        return result

    result["is_chinese_id"] = True
    try:
        birth = datetime.strptime(text[6:14], "%Y%m%d").date()
    except Exception:
        result["message"] = "身份证中的出生日期无效"
        return result

    checksum = sum(int(text[i]) * _ID_WEIGHTS[i] for i in range(17)) % 11
    expected = _ID_CHECK_CODES[checksum]
    if text[-1] != expected:
        result["birth_date"] = birth.isoformat()
        result["gender"] = "男" if int(text[16]) % 2 else "女"
        result["message"] = "身份证校验码不正确"
        return result

    result.update({
        "is_valid": True,
        "birth_date": birth.isoformat(),
        "gender": "男" if int(text[16]) % 2 else "女",
        "message": "身份证校验通过",
    })
    return result


def infer_retirement_category(gender=None, original_retirement_age=None, job_title=None, explicit_category=None):
    """Choose a retirement category while clearly marking legacy guesses.

    Female 50/55 classification is a personnel-policy attribute; job-title text is
    not a reliable legal source.  We only use job-title guessing as a backward-
    compatibility fallback and tell the caller that manual confirmation is needed.
    """
    if explicit_category in RETIREMENT_CATEGORIES:
        return explicit_category, "explicit", False

    try:
        age = float(original_retirement_age or 0)
    except Exception:
        age = 0
    if gender == "男":
        if 59.5 <= age <= 60.5:
            return CATEGORY_MALE_60, "stored_original_age", False
        return CATEGORY_MALE_60, "gender", False
    if gender == "女":
        if 49.5 <= age <= 50.5:
            return CATEGORY_FEMALE_50, "stored_original_age", False
        if 54.5 <= age <= 55.5:
            return CATEGORY_FEMALE_55, "stored_original_age", False
        management_keywords = ("管理", "经理", "主管", "技术", "财务", "会计", "人事", "总监", "主任", "工程", "高管")
        guessed = CATEGORY_FEMALE_55 if any(k in _clean_text(job_title) for k in management_keywords) else CATEGORY_FEMALE_50
        return guessed, "standard_policy", False
    return CATEGORY_MANUAL, "unresolved", False


def calculate_retirement_details(
    certificate_type=None,
    certificate_number=None,
    birth_date=None,
    gender=None,
    retirement_category=None,
    original_retirement_age=None,
    delayed_retirement_age=None,
    job_title=None,
    ref_period_month=None,
):
    """Return identity-derived age and China retirement-window details."""
    cert_type = _clean_text(certificate_type) or "中国居民身份证"
    cert_no = _clean_text(certificate_number).upper()
    id_result = validate_chinese_id_number(cert_no) if cert_type == "中国居民身份证" and cert_no else {
        "is_valid": False, "is_chinese_id": False, "birth_date": "", "gender": "", "message": ""
    }

    derived_birth = _parse_date(id_result.get("birth_date")) if id_result.get("is_valid") else _parse_date(birth_date)
    derived_gender = id_result.get("gender") if id_result.get("is_valid") else _clean_text(gender)

    category, category_source, needs_confirm = infer_retirement_category(
        gender=derived_gender,
        original_retirement_age=original_retirement_age,
        job_title=job_title,
        explicit_category=retirement_category,
    )

    rule = POLICY_RULES.get(category)
    manual_original_months = 0
    try:
        manual_original_months = int(round(float(original_retirement_age or 0) * 12))
    except Exception:
        manual_original_months = 0

    if rule:
        original_age_months = rule["original_age_months"]
    elif manual_original_months > 0:
        original_age_months = manual_original_months
    else:
        original_age_months = 0

    ref_idx = _period_to_index(ref_period_month)
    ref_period = _index_to_period(ref_idx)
    current_age_months = 0
    current_age_years = 0
    current_age_remainder = 0
    original_month = ""
    statutory_month = ""
    earliest_flexible_month = ""
    latest_flexible_month = ""
    delay_months = 0

    if derived_birth:
        birth_idx = _month_index(derived_birth.year, derived_birth.month)
        current_age_months = max(0, ref_idx - birth_idx)
        current_age_years, current_age_remainder = divmod(current_age_months, 12)

        if original_age_months:
            original_idx = birth_idx + original_age_months
            original_month = _index_to_period(original_idx)

            if rule:
                sy, sm = [int(x) for x in rule["start_birth_month"].split("-")]
                start_birth_idx = _month_index(sy, sm)
                if birth_idx >= start_birth_idx:
                    cohort_offset = birth_idx - start_birth_idx
                    delay_months = min(
                        rule["max_delay_months"],
                        (cohort_offset // rule["birth_months_per_delay_month"]) + 1,
                    )
            else:
                try:
                    override_months = int(round(float(delayed_retirement_age or 0) * 12))
                except Exception:
                    override_months = 0
                if override_months > original_age_months:
                    delay_months = override_months - original_age_months

            statutory_idx = original_idx + delay_months
            statutory_month = _index_to_period(statutory_idx)
            earliest_idx = max(original_idx, statutory_idx - FLEXIBLE_EARLY_MAX_MONTHS)
            earliest_flexible_month = _index_to_period(earliest_idx)
            latest_flexible_month = _index_to_period(statutory_idx + FLEXIBLE_DELAY_MAX_MONTHS)

    statutory_age_months = original_age_months + delay_months

    def status_for(target_period, label):
        if not target_period:
            return {"months_left": None, "status": "待完善", "warning": False, "label": label}
        target_idx = _period_to_index(target_period)
        left = target_idx - ref_idx
        if left < 0:
            status = "已到龄"
        elif left == 0:
            status = "本月到龄"
        elif left <= WARNING_MONTHS:
            status = f"{left}个月内"
        else:
            status = "正常"
        return {"months_left": left, "status": status, "warning": 0 <= left <= WARNING_MONTHS, "label": label}

    original_status = status_for(original_month, "临退预警(原)")
    statutory_status = status_for(statutory_month, "临退预警(延)")

    if original_status["warning"]:
        primary_warning = "临退预警"
    elif statutory_status["warning"]:
        primary_warning = "延迟到龄预警"
    elif original_status["status"] == "已到龄" and statutory_status["status"] not in ("已到龄", "本月到龄"):
        primary_warning = "已达原龄"
    elif statutory_status["status"] in ("已到龄", "本月到龄"):
        primary_warning = "已到法定退休年龄"
    else:
        primary_warning = "正常"

    earliest_notice_month = ""
    if earliest_flexible_month:
        earliest_notice_month = _index_to_period(_period_to_index(earliest_flexible_month) - EARLY_RETIREMENT_NOTICE_MONTHS)

    earliest_contribution_months = minimum_pension_contribution_months(earliest_flexible_month) if earliest_flexible_month else 0
    statutory_contribution_months = minimum_pension_contribution_months(statutory_month) if statutory_month else 0

    return {
        "policy_version": POLICY_VERSION,
        "policy_effective_from": POLICY_EFFECTIVE_FROM,
        "policy_source_urls": list(POLICY_SOURCE_URLS),
        "certificate_type": cert_type,
        "is_valid_id": bool(id_result.get("is_valid")),
        "identity_validation_message": id_result.get("message") or "",
        "birth_date": derived_birth.isoformat() if derived_birth else "",
        "gender": derived_gender or "",
        "ref_period_month": ref_period,
        "current_age": current_age_years,
        "current_age_months": current_age_remainder,
        "current_age_total_months": current_age_months,
        "current_age_detail": _age_display(current_age_months),
        "retirement_category": category,
        "retirement_category_source": category_source,
        "needs_retirement_category_confirmation": needs_confirm,
        "original_retirement_age": round(original_age_months / 12.0, 4) if original_age_months else 0,
        "original_retirement_age_str": _age_display(original_age_months) if original_age_months else "待确认",
        "original_retire_period": original_month,
        "orig_retire_period": original_month,
        "original_retirement_period": original_month,
        "original_retire_date": _period_last_date(original_month).isoformat() if original_month else "",
        "months_left_orig": original_status["months_left"],
        "original_warning_status": original_status["status"],
        "original_retirement_warning": original_status["warning"],
        "delay_months": delay_months,
        "delayed_retirement_age": round(statutory_age_months / 12.0, 4) if statutory_age_months else 0,
        "delayed_retirement_age_str": _age_display(statutory_age_months) if statutory_age_months else "待确认",
        "delayed_retire_period": statutory_month,
        "delayed_retirement_period": statutory_month,
        "delayed_retire_date": _period_last_date(statutory_month).isoformat() if statutory_month else "",
        "months_left_delayed": statutory_status["months_left"],
        "delayed_warning_status": statutory_status["status"],
        "delayed_retirement_warning": statutory_status["warning"],
        "earliest_flexible_retire_period": earliest_flexible_month,
        "earliest_flexible_notice_period": earliest_notice_month,
        "latest_flexible_retire_period": latest_flexible_month,
        "primary_retirement_warning": primary_warning,
        "warning_months": WARNING_MONTHS,
        "flexible_early_max_months": FLEXIBLE_EARLY_MAX_MONTHS,
        "flexible_delay_max_months": FLEXIBLE_DELAY_MAX_MONTHS,
        "early_notice_months": EARLY_RETIREMENT_NOTICE_MONTHS,
        "late_agreement_notice_months": LATE_RETIREMENT_AGREEMENT_NOTICE_MONTHS,
        "earliest_flexible_minimum_contribution_months": earliest_contribution_months,
        "earliest_flexible_minimum_contribution_str": _contribution_display(earliest_contribution_months) if earliest_contribution_months else "",
        "statutory_minimum_contribution_months": statutory_contribution_months,
        "statutory_minimum_contribution_str": _contribution_display(statutory_contribution_months) if statutory_contribution_months else "",
        "pension_contribution_verified": False,
        "eligibility_note": "本引擎只计算退休年龄窗口和法定最低缴费年限门槛，不校验个人养老保险实际缴费年限。",
    }
