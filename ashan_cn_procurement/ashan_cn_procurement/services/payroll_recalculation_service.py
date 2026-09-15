# Copyright (c) 2026, Ashan CN Procurement
"""Asynchronous, auditable payroll recalculation orchestration.

The calculator remains in ``payroll_settlement_service``.  This module owns only
change detection, task coalescing, background execution and UI status reporting.
"""

from __future__ import annotations

import hashlib
import json
from datetime import datetime

import frappe
from frappe.utils import cint, flt, now_datetime

TASK_DOCTYPE = "Ashan Payroll Recalculation Task"
SETTLEMENT_DOCTYPE = "Ashan Monthly Payroll Settlement"
ITEM_DOCTYPE = "Ashan Monthly Payroll Item"
ENGINE_VERSION = "vba-tax-async-2026.08.21"
ACTIVE_STATUSES = ["待计算", "已入队", "计算中"]
PENDING_ITEM_STATUSES = {"待计算", "排队中", "计算中"}


def _check_permission(perm_type="write", company=None):
    from ashan_cn_procurement.services.payroll_settlement_service import check_payroll_workbench_permission

    return check_payroll_workbench_permission(perm_type, company)


def _normalize_period(period_month: str) -> str:
    value = str(period_month or "").strip()
    try:
        dt = datetime.strptime(value, "%Y-%m")
    except ValueError:
        frappe.throw("账期格式必须为 YYYY-MM，例如 2026-07。")
    return dt.strftime("%Y-%m")


def _month_index(period_month: str) -> int:
    y, m = [int(x) for x in _normalize_period(period_month).split("-")]
    return y * 12 + m - 1


def _period_from_index(value: int) -> str:
    y, zero_m = divmod(value, 12)
    return f"{y:04d}-{zero_m + 1:02d}"


def _iter_months(start_period: str, end_period: str):
    start_i = _month_index(start_period)
    end_i = _month_index(end_period)
    if start_i > end_i:
        frappe.throw("重算起始月份不能晚于截止月份。")
    for idx in range(start_i, end_i + 1):
        yield _period_from_index(idx)


def _is_locked(company: str, period_month: str) -> bool:
    name = f"{company}-{period_month}"
    if not frappe.db.exists(SETTLEMENT_DOCTYPE, name):
        return False
    row = frappe.db.get_value(SETTLEMENT_DOCTYPE, name, ["locked", "status"], as_dict=True) or {}
    return bool(cint(row.get("locked"))) or row.get("status") in {"已核定锁定", "已归档发放", "Locked", "Submitted"}


def _get_employee_name(company: str, employee_no: str) -> str:
    if not employee_no:
        return "整月批量"
    return frappe.db.get_value(
        "Ashan Employee Salary Profile",
        {"company": company, "employee_no": employee_no},
        "employee_name",
    ) or employee_no


def _build_employee_input_hash(company: str, period_month: str, employee_no: str) -> str:
    """Hash all authoritative inputs that can change one employee's calculation."""
    profile_fields = [
        "employee_no", "employee_type", "salary_mode", "is_insured", "fixed_salary", "base_salary",
        "post_allowance", "performance_base", "meal_allowance", "traffic_allowance",
        "communication_allowance", "other_allowance", "social_security_base", "social_security_base_mode", "custom_social_security_base",
        "housing_fund_base", "housing_fund_policy",
        "deduction_child_education", "deduction_continuing_education", "deduction_serious_illness",
        "deduction_housing_loan", "deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care",
        "employment_status", "relieving_date",
    ]
    profile = frappe.db.get_value(
        "Ashan Employee Salary Profile",
        {"company": company, "employee_no": employee_no},
        profile_fields,
        as_dict=True,
    ) or {}

    parent = f"{company}-{period_month}"
    current = {}
    if frappe.db.exists(SETTLEMENT_DOCTYPE, parent):
        rows = frappe.get_all(
            ITEM_DOCTYPE,
            filters={"parent": parent, "employee_no": employee_no},
            fields=[
                "employee_no", "employee_type", "salary_mode", "fixed_salary", "target_salary", "gross_salary", "net_salary",
                "attendance_days", "work_hours", "day_salary", "hour_salary", "full_attendance",
                "overtime_hours", "overtime_salary", "national_days", "national_salary", "target_rate", "deduction",
                "ss_base", "hf_base",
                "deduction_child_education", "deduction_continuing_education", "deduction_serious_illness",
                "deduction_housing_loan", "deduction_housing_rent", "deduction_elderly_care", "deduction_infant_care",
            ],
            limit=1,
        )
        row = rows[0] if rows else {}
        if row:
            # Only one of gross/net is the authoritative salary input.  Do not hash calculated outputs,
            # otherwise every successful recalculation would invalidate its own hash and cause a second run.
            salary_mode = str(row.get("salary_mode") or profile.get("salary_mode") or "").strip()
            is_after_tax = salary_mode in {"税后", "税后倒推", "税后管理工资"}
            current = {
                key: value for key, value in row.items()
                if key not in {"gross_salary", "net_salary"}
            }
            current["salary_input"] = row.get("net_salary") if is_after_tax else row.get("gross_salary")
        else:
            current = {}

    # Prior payroll snapshots are part of the cumulative-prepayment input.
    prior = frappe.get_all(
        ITEM_DOCTYPE,
        filters={"employee_no": employee_no, "parent": ["like", f"{company}-%"]},
        fields=[
            "parent", "gross_salary", "tax_threshold", "ss_person_total", "hf_person_total",
            "special_deductions_total", "deduction_child_education", "deduction_continuing_education",
            "deduction_serious_illness", "deduction_housing_loan", "deduction_housing_rent",
            "deduction_elderly_care", "deduction_infant_care", "tax_amount",
        ],
        order_by="parent asc",
    )
    prior = [r for r in prior if str(r.get("parent") or "") < parent]

    year = cint(period_month[:4])
    insurance = frappe.db.get_value(
        "Ashan Insurance Setting",
        f"{company}-{year}",
        [
            "ss_company_pension", "ss_company_unemployment", "ss_company_medical",
            "ss_company_other_medical", "ss_company_injury",
            "ss_person_pension", "ss_person_medical", "ss_person_unemployment",
            "big_medical_amount_default", "big_medical_amount_special", "big_medical_special_months", "ss_min_base",
            "hf_company_rate", "hf_person_rate", "hf_auto_rule_enabled", "hf_contribution_months", "hf_off_month_action",
            "tax_threshold", "tax_cycle_start_month", "modified",
        ],
        as_dict=True,
    ) or {}
    housing_fund_override = {}
    if frappe.db.exists("DocType", "Ashan Housing Fund Monthly Override"):
        housing_fund_override = frappe.db.get_value(
            "Ashan Housing Fund Monthly Override",
            {"company": company, "period_month": period_month, "employee_no": employee_no},
            ["override_mode", "reason", "modified"],
            as_dict=True,
        ) or {}

    payload = {
        "engine": ENGINE_VERSION,
        "company": company,
        "period_month": period_month,
        "employee_no": employee_no,
        "profile": profile,
        "current": current,
        "prior": prior,
        "settings": insurance,
        "housing_fund_override": housing_fund_override,
    }
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _item_meta_supports_audit() -> bool:
    try:
        return bool(frappe.get_meta(ITEM_DOCTYPE).has_field("calculation_status"))
    except Exception:
        return False


def _mark_items(company: str, period_month: str, employee_no: str | None, values: dict):
    if not _item_meta_supports_audit():
        return
    parent = f"{company}-{period_month}"
    filters = {"parent": parent}
    if employee_no:
        filters["employee_no"] = employee_no
    rows = frappe.get_all(ITEM_DOCTYPE, filters=filters, fields=["name"])
    for row in rows:
        frappe.db.set_value(ITEM_DOCTYPE, row.name, values, update_modified=False)


def _publish(company: str, period_month: str, task_name: str, status: str, employee_no: str = "", message: str = ""):
    frappe.publish_realtime(
        "ashan_payroll_recalc_update",
        {
            "company": company,
            "period_month": period_month,
            "task_name": task_name,
            "employee_no": employee_no or "",
            "status": status,
            "message": message or "",
        },
    )


def _mark_task_range_items(task, status="排队中", error_message=""):
    """Project one task's state onto every unlocked month it can affect.

    History corrections can span several months.  Marking only the end month made the
    history view look stale while the worker was actually processing earlier months.
    Frozen months are intentionally left untouched.
    """
    values = {
        "calculation_status": status,
        "calculation_requested_at": task.requested_at,
        "calculation_trigger_source": task.trigger_source,
        "calculation_task_id": task.name,
        "calculation_error": error_message or "",
    }
    for month in _iter_months(task.start_period, task.end_period):
        if _is_locked(task.company, month):
            continue
        if not frappe.db.exists(SETTLEMENT_DOCTYPE, f"{task.company}-{month}"):
            continue
        _mark_items(task.company, month, task.employee_no or None, values)


def _enqueue_task_doc(task):
    job_id = f"payroll-recalc-{task.name}"
    task.db_set("job_id", job_id, update_modified=False)
    task.db_set("status", "已入队", update_modified=False)
    _mark_task_range_items(task, "排队中")
    frappe.enqueue(
        "ashan_cn_procurement.services.payroll_recalculation_service.process_payroll_recalculation_task",
        queue="long",
        timeout=1800,
        enqueue_after_commit=True,
        job_id=job_id,
        task_name=task.name,
    )


def queue_recalculation_after_change(
    company: str,
    period_month: str,
    employee_no: str | None = None,
    trigger_source: str = "系统任务",
    start_period: str | None = None,
    trigger_detail: str = "",
    force_recompute: bool = False,
):
    """Internal save-hook helper. It never commits the caller's transaction."""
    return _create_or_merge_task(
        company=company,
        period_month=period_month,
        employee_no=employee_no,
        trigger_source=trigger_source,
        start_period=start_period,
        trigger_detail=trigger_detail,
        force_recompute=force_recompute,
    )


def _create_or_merge_task(
    company: str,
    period_month: str,
    employee_no: str | None,
    trigger_source: str,
    start_period: str | None,
    trigger_detail: str,
    force_recompute: bool,
):
    end_period = _normalize_period(period_month)
    start_period = _normalize_period(start_period or end_period)
    employee_no = str(employee_no or "").strip()

    # A pending whole-month task already subsumes employee-specific changes.
    whole_tasks = frappe.get_all(
        TASK_DOCTYPE,
        filters={"company": company, "employee_no": "", "status": ["in", ["待计算", "已入队"]]},
        fields=["name", "start_period", "end_period"],
        order_by="creation desc",
        limit=10,
    )
    for row in whole_tasks:
        # Coalesce any overlapping queued whole-month range.  Checking only whether
        # the new *end* month was inside the old task allowed partially overlapping
        # ranges to create duplicate jobs for the same company/months.
        overlaps = (
            _month_index(row.start_period) <= _month_index(end_period)
            and _month_index(start_period) <= _month_index(row.end_period)
        )
        if overlaps:
            task = frappe.get_doc(TASK_DOCTYPE, row.name)
            merged_start = _period_from_index(min(_month_index(task.start_period), _month_index(start_period)))
            merged_end = _period_from_index(max(_month_index(task.end_period), _month_index(end_period)))
            changed = merged_start != task.start_period or merged_end != task.end_period
            if changed or trigger_detail or force_recompute:
                task.start_period = merged_start
                task.end_period = merged_end
                task.trigger_source = trigger_source or task.trigger_source
                if trigger_detail:
                    task.trigger_detail = trigger_detail
                if force_recompute:
                    task.force_recompute = 1
                task.requested_at = now_datetime()
                task.requested_by = frappe.session.user
                task.save(ignore_permissions=True)
                if task.status == "已入队":
                    _mark_task_range_items(task, "排队中")
            return task

    filters = {"company": company, "employee_no": employee_no, "status": ["in", ["待计算", "已入队"]]}
    existing = frappe.get_all(
        TASK_DOCTYPE,
        filters=filters,
        fields=["name", "start_period", "end_period", "status"],
        order_by="creation desc",
        limit=1,
    )
    if existing:
        task = frappe.get_doc(TASK_DOCTYPE, existing[0].name)
        new_start = _period_from_index(min(_month_index(task.start_period), _month_index(start_period)))
        new_end = _period_from_index(max(_month_index(task.end_period), _month_index(end_period)))
        task.start_period = new_start
        task.end_period = new_end
        task.trigger_source = trigger_source or task.trigger_source
        if trigger_detail:
            task.trigger_detail = trigger_detail
        task.force_recompute = 1 if force_recompute else task.force_recompute
        task.requested_at = now_datetime()
        task.requested_by = frappe.session.user
        task.save(ignore_permissions=True)
        if task.status == "待计算":
            _enqueue_task_doc(task)
        elif task.status == "已入队":
            _mark_task_range_items(task, "排队中")
        return task

    if not employee_no:
        # The whole-month task supersedes queued employee tasks for the same current month.
        individual = frappe.get_all(
            TASK_DOCTYPE,
            filters={"company": company, "status": ["in", ["待计算", "已入队"]]},
            fields=["name", "start_period", "end_period"],
        )
        for row in individual:
            overlaps = (
                _month_index(row.start_period) <= _month_index(end_period)
                and _month_index(start_period) <= _month_index(row.end_period)
            )
            if overlaps:
                frappe.db.set_value(TASK_DOCTYPE, row.name, "status", "已取消", update_modified=False)

    task = frappe.new_doc(TASK_DOCTYPE)
    task.company = company
    task.employee_no = employee_no
    task.employee_name = _get_employee_name(company, employee_no)
    task.start_period = start_period
    task.end_period = end_period
    task.trigger_source = trigger_source or "系统任务"
    task.trigger_detail = trigger_detail or ""
    task.status = "待计算"
    task.force_recompute = 1 if force_recompute else 0
    task.requested_by = frappe.session.user
    task.requested_at = now_datetime()
    if employee_no:
        task.input_hash = _build_employee_input_hash(company, end_period, employee_no)
    task.insert(ignore_permissions=True)
    _enqueue_task_doc(task)
    return task


@frappe.whitelist(methods=["POST"])
def request_payroll_recalculation(
    company,
    period_month,
    employee_no=None,
    scope="dirty",
    start_period=None,
    force_recompute=0,
):
    """Manual entry point used by the calculation center."""
    _check_permission("write", company)
    period_month = _normalize_period(period_month)
    scope = str(scope or "dirty").strip()
    force = bool(cint(force_recompute))

    if scope == "dirty":
        pending = frappe.get_all(
            TASK_DOCTYPE,
            filters={"company": company, "status": ["in", ACTIVE_STATUSES]},
            fields=["name", "start_period", "end_period", "employee_no", "status"],
            order_by="creation asc",
        )
        applicable = [r for r in pending if _month_index(r.start_period) <= _month_index(period_month) <= _month_index(r.end_period)]
        if applicable:
            return {"success": True, "message": f"已有 {len(applicable)} 个待处理/执行中的计算任务，无需重复提交。", "tasks": applicable}
        return {"success": True, "message": "当前没有待处理的变更。"}

    if scope == "employee":
        if not employee_no:
            frappe.throw("请选择需要重新计算的员工。")
        task = _create_or_merge_task(company, period_month, employee_no, "人工重算", start_period, "人工指定员工重算", force)
    elif scope in {"month", "force_month"}:
        task = _create_or_merge_task(company, period_month, "", "人工重算", start_period or period_month, "人工整月重算", force or scope == "force_month")
    else:
        frappe.throw("不支持的重新计算范围。")
    return {"success": True, "message": f"任务 {task.name} 已进入服务器后台队列。", "task_name": task.name}


def get_payroll_calculation_readiness(company: str, period_month: str) -> dict:
    """Authoritative lock-readiness for asynchronous payroll calculation.

    A month is ready only when every payroll row has a terminal successful state and
    no queued/running task still overlaps the month.  This is intentionally server-side
    so the final financial lock cannot be bypassed by stale browser state.
    """
    period_month = _normalize_period(period_month)
    parent = f"{company}-{period_month}"
    summary = {
        "total": 0,
        "synced": 0,
        "pending": 0,
        "queued": 0,
        "running": 0,
        "failed": 0,
        "uncomputed": 0,
        "active_tasks": 0,
        "last_completed_at": None,
    }

    if frappe.db.exists(SETTLEMENT_DOCTYPE, parent) and _item_meta_supports_audit():
        items = frappe.get_all(
            ITEM_DOCTYPE,
            filters={"parent": parent},
            fields=["calculation_status", "calculation_completed_at"],
        )
        summary["total"] = len(items)
        for item in items:
            st = str(item.get("calculation_status") or "未计算").strip()
            if st in {"已计算", "已跳过"}:
                summary["synced"] += 1
            elif st == "待计算":
                summary["pending"] += 1
            elif st == "排队中":
                summary["queued"] += 1
            elif st == "计算中":
                summary["running"] += 1
            elif st == "计算失败":
                summary["failed"] += 1
            else:
                summary["uncomputed"] += 1
            dt = item.get("calculation_completed_at")
            if dt and (summary["last_completed_at"] is None or dt > summary["last_completed_at"]):
                summary["last_completed_at"] = dt
    elif frappe.db.exists(SETTLEMENT_DOCTYPE, parent):
        # After installing this version, migrate adds the audit fields.  Until then,
        # do not allow a financial lock based on unverifiable legacy row state.
        summary["uncomputed"] = 1

    active = frappe.get_all(
        TASK_DOCTYPE,
        filters={"company": company, "status": ["in", ACTIVE_STATUSES]},
        fields=["name", "start_period", "end_period", "status"],
        order_by="creation asc",
    )
    overlapping = [
        row for row in active
        if _month_index(row.start_period) <= _month_index(period_month) <= _month_index(row.end_period)
    ]
    summary["active_tasks"] = len(overlapping)

    blocking_rows = summary["pending"] + summary["queued"] + summary["running"] + summary["failed"] + summary["uncomputed"]
    ready = bool(summary["total"] > 0 and blocking_rows == 0 and summary["active_tasks"] == 0)
    summary["ready"] = ready
    return summary


@frappe.whitelist()
def get_payroll_recalculation_status(company, period_month):
    """Compact status payload for the workbench calculation center."""
    _check_permission("read", company)
    period_month = _normalize_period(period_month)
    summary = get_payroll_calculation_readiness(company, period_month)

    tasks = frappe.get_all(
        TASK_DOCTYPE,
        filters={"company": company},
        fields=[
            "name", "employee_no", "employee_name", "start_period", "end_period", "trigger_source", "status",
            "requested_at", "started_at", "completed_at", "error_message",
        ],
        order_by="creation desc",
        limit=40,
    )
    tasks = [t for t in tasks if _month_index(t.start_period) <= _month_index(period_month) <= _month_index(t.end_period)][:8]
    return {
        "company": company,
        "period_month": period_month,
        "locked": _is_locked(company, period_month),
        "summary": summary,
        "tasks": tasks,
        "engine_version": ENGINE_VERSION,
    }


@frappe.whitelist(methods=["POST"])
def retry_payroll_recalculation_task(task_name):
    task = frappe.get_doc(TASK_DOCTYPE, task_name)
    _check_permission("write", task.company)
    if task.status not in {"失败", "部分完成", "已跳过", "已取消"}:
        return {"success": True, "message": "该任务当前不需要重试。"}
    task.status = "待计算"
    task.error_message = ""
    task.started_at = None
    task.completed_at = None
    task.requested_at = now_datetime()
    task.requested_by = frappe.session.user
    task.save(ignore_permissions=True)
    _enqueue_task_doc(task)
    return {"success": True, "message": f"任务 {task.name} 已重新入队。"}


def process_payroll_recalculation_task(task_name):
    """RQ worker target. Serialize payroll writes per company to avoid parent-document races."""
    task = frappe.get_doc(TASK_DOCTYPE, task_name)
    lock_key = f"ashan-payroll-recalc:{task.company}"
    # Frappe's Redis lock keeps different workers from writing the same company's monthly parent concurrently.
    with frappe.cache.lock(lock_key, timeout=1900, blocking_timeout=1800):
        return _process_payroll_recalculation_task_locked(task_name)


def _process_payroll_recalculation_task_locked(task_name):
    task = frappe.get_doc(TASK_DOCTYPE, task_name)
    if task.status == "已取消":
        return
    task.status = "计算中"
    task.started_at = now_datetime()
    task.error_message = ""
    task.save(ignore_permissions=True)
    frappe.db.commit()
    _publish(task.company, task.end_period, task.name, "计算中", task.employee_no, "后台服务器开始计算")

    processed, skipped, failures = [], [], []
    from ashan_cn_procurement.services.payroll_settlement_service import (
        recalculate_and_save_monthly_tax,
        recalculate_employee_payroll,
    )

    months = list(_iter_months(task.start_period, task.end_period))
    for month_index, month in enumerate(months):
        parent = f"{task.company}-{month}"
        if not frappe.db.exists(SETTLEMENT_DOCTYPE, parent):
            skipped.append(f"{month}:未建账")
            continue
        if _is_locked(task.company, month):
            skipped.append(f"{month}:已冻结")
            continue
        try:
            if task.employee_no:
                current_hash = _build_employee_input_hash(task.company, month, task.employee_no)
                existing_hash = None
                if _item_meta_supports_audit():
                    existing_hash = frappe.db.get_value(
                        ITEM_DOCTYPE,
                        {"parent": parent, "employee_no": task.employee_no},
                        "calculation_input_hash",
                    )
                if existing_hash and existing_hash == current_hash and not cint(task.force_recompute):
                    _mark_items(task.company, month, task.employee_no, {
                        "calculation_status": "已跳过",
                        "calculation_completed_at": now_datetime(),
                        "calculation_trigger_source": task.trigger_source,
                        "calculation_engine_version": ENGINE_VERSION,
                        "calculation_task_id": task.name,
                        "calculation_error": "",
                    })
                    skipped.append(f"{month}:输入未变化")
                    continue
                # History correction must preserve the edited month's saved snapshot.
                # Intermediate historical months also retain their own period snapshots; only the
                # final current-period month refreshes from today's master data when the cascade
                # actually spans more than one month.  This also makes a one-month history
                # correction deterministic instead of immediately overwriting the user's input.
                history_snapshot_mode = (
                    task.trigger_source == "历史数据更正"
                    and (month != task.end_period or task.start_period == task.end_period)
                )
                recalculate_employee_payroll(
                    task.company,
                    month,
                    task.employee_no,
                    trigger_source=task.trigger_source,
                    task_name=task.name,
                    input_hash=current_hash,
                    refresh_from_profile=0 if history_snapshot_mode else 1,
                )
            else:
                recalculate_and_save_monthly_tax(
                    task.company,
                    month,
                    trigger_source=task.trigger_source,
                    task_name=task.name,
                    force_recompute=cint(task.force_recompute),
                )
            processed.append(month)
            frappe.db.commit()
            _publish(task.company, month, task.name, "计算中", task.employee_no, f"{month} 计算完成")
        except Exception:
            frappe.db.rollback()
            trace = frappe.get_traceback()[-1800:]
            failures.append(f"{month}: {trace}")
            # 回滚计算数据后单独写入可见失败状态，避免页面永久停留在“排队中/计算中”。
            failure_message = trace[-900:]
            _mark_items(task.company, month, task.employee_no or None, {
                "calculation_status": "计算失败",
                "calculation_completed_at": now_datetime(),
                "calculation_trigger_source": task.trigger_source,
                "calculation_engine_version": ENGINE_VERSION,
                "calculation_task_id": task.name,
                "calculation_error": failure_message,
            })
            # Cumulative IIT is sequential.  Never continue into later months after an
            # earlier month fails, otherwise later tax can be calculated from stale history.
            for remaining_month in months[month_index + 1:]:
                if _is_locked(task.company, remaining_month):
                    continue
                if not frappe.db.exists(SETTLEMENT_DOCTYPE, f"{task.company}-{remaining_month}"):
                    continue
                _mark_items(task.company, remaining_month, task.employee_no or None, {
                    "calculation_status": "计算失败",
                    "calculation_completed_at": now_datetime(),
                    "calculation_trigger_source": task.trigger_source,
                    "calculation_engine_version": ENGINE_VERSION,
                    "calculation_task_id": task.name,
                    "calculation_error": f"前置账期 {month} 计算失败，累计个税链路已停止，请修复后重试任务。",
                })
            frappe.db.commit()
            break

    task = frappe.get_doc(TASK_DOCTYPE, task_name)
    task.processed_months = "\n".join(processed)
    task.skipped_months = "\n".join(skipped)
    task.completed_at = now_datetime()
    if failures:
        task.status = "部分完成" if processed else "失败"
        task.error_message = "\n\n".join(failures)[-12000:]
    elif processed:
        task.status = "成功"
    else:
        task.status = "已跳过"
    task.save(ignore_permissions=True)
    frappe.db.commit()
    _publish(task.company, task.end_period, task.name, task.status, task.employee_no, "后台计算任务已结束")
