# ASHAN-UNIFIED-V2: company-scoped unified task read model
"""One read model for the user's monthly and deadline-driven business tasks."""

from __future__ import annotations

import frappe

from ashan_cn_procurement.services.periodic_tasks import (
    get_compliance_expiry_status,
    get_monthly_settlement_status,
)
from ashan_cn_procurement.services.authorization_service import (
    PAYROLL_ACCESS_MATRIX,
    PAYROLL_WORKFLOW_POLICY,
    can_payroll_access,
    get_allowed_companies,
)


TASK_STATES = {
    "pending": {"label": "待处理", "severity": "warning"},
    "locked": {"label": "已核定", "severity": "success"},
    "due_soon": {"label": "临期", "severity": "warning"},
    "overdue": {"label": "已逾期", "severity": "danger"},
}

PAYROLL_WORKFLOW_STAGES = {
    stage: {"label": stage, "next_action": policy["action"], "next_stage": policy["next_stage"]}
    for stage, policy in PAYROLL_WORKFLOW_POLICY.items()
}


def _workflow_policy_for_current_user() -> dict:
    """Return the shared transition table with current-user action availability."""
    return {
        stage: {
            "next_stage": policy["next_stage"],
            "action": policy["action"],
            "permission": policy["permission"],
            "allowed_roles": sorted(PAYROLL_ACCESS_MATRIX[policy["permission"]]),
            "reason_required": policy["reason_required"],
            "audit_fields": list(policy["audit_fields"]),
            "allowed_for_current_user": can_payroll_access(policy["permission"]),
        }
        for stage, policy in PAYROLL_WORKFLOW_POLICY.items()
    }


def _monthly_tasks(monthly: dict) -> list[dict]:
    """Normalize per-company monthly settlement cards to the shared task schema."""
    tasks = []
    for company in (monthly.get("companies") or {}).values():
        if not company.get("visible"):
            continue
        for item in company.get("items") or []:
            state = "locked" if item.get("status") == "settled" else "pending"
            tasks.append({
                "id": f"monthly:{company.get('short_name')}:{item.get('id')}",
                "source": "monthly_settlement",
                "company": company.get("company_name"),
                "company_short_name": company.get("short_name"),
                "title": item.get("title"),
                "summary": item.get("summary_text"),
                "state": state,
                "state_label": TASK_STATES[state]["label"],
                "severity": TASK_STATES[state]["severity"],
                "route": item.get("route"),
                "action_label": item.get("action_label"),
                "period_month": monthly.get("period"),
            })
    return tasks


def _expiry_tasks(expiry: dict) -> list[dict]:
    """Normalize compliance reminders to the shared task schema."""
    tasks = []
    for item in expiry.get("items") or []:
        level = str(item.get("level") or "info")
        state = "overdue" if level == "danger" else ("due_soon" if level == "warning" else "pending")
        tasks.append({
            "id": f"expiry:{item.get('id')}",
            "source": "compliance_expiry",
            "company": item.get("company"),
            "company_short_name": item.get("company"),
            "title": item.get("title"),
            "summary": item.get("status_text"),
            "state": state,
            "state_label": TASK_STATES[state]["label"],
            "severity": TASK_STATES[state]["severity"],
            "route": item.get("route"),
            "action_label": item.get("action_label"),
            "due_date": item.get("due_date"),
            "doctype": item.get("doctype"),
            "docname": item.get("docname"),
        })
    return tasks


def _payroll_tasks(period_month: str) -> list[dict]:
    """Add only company-scoped payroll tasks through one stable schema."""
    if not can_payroll_access("read"):
        return []

    allowed_companies = get_allowed_companies()
    companies = set()
    for doctype, base_filters in (
        ("Ashan Employee Salary Profile", {}),
        ("Ashan Monthly Payroll Settlement", {"period_month": period_month}),
    ):
        if not frappe.db.exists("DocType", doctype):
            continue
        filters = dict(base_filters)
        if allowed_companies is not None:
            if not allowed_companies:
                continue
            filters["company"] = ["in", sorted(allowed_companies)]
        companies.update(
            str(row.get("company") or "").strip()
            for row in frappe.get_all(
                doctype, filters=filters, fields=["company"], order_by="company asc"
            )
            if str(row.get("company") or "").strip()
        )

    from ashan_cn_procurement.services.payroll_settlement_service import get_monthly_workflow_status

    tasks = []
    for company in sorted(companies):
        try:
            workflow = get_monthly_workflow_status(company, period_month)
        except frappe.PermissionError:
            continue
        stage = str(workflow.get("workflow_stage") or "草稿")
        state = "locked" if stage == "已封账" else "pending"
        stage_config = PAYROLL_WORKFLOW_STAGES.get(stage, PAYROLL_WORKFLOW_STAGES["草稿"])
        route = (
            "jizhong-hr-salary-workbench" if "吉众" in company
            else "qifu-hr-salary-workbench" if "祺富" in company
            else None
        )
        tasks.append({
            "id": f"payroll:{company}:{period_month}",
            "source": "payroll_workflow",
            "company": company,
            "company_short_name": company,
            "title": f"薪酬月结 · {company}",
            "summary": f"{stage_config['label']} · 下一步：{stage_config['next_action']}",
            "state": state,
            "state_label": TASK_STATES[state]["label"],
            "severity": TASK_STATES[state]["severity"],
            "workflow_stage": stage,
            "can_lock": bool(workflow.get("can_lock")),
            "unlock_pending": bool((workflow.get("unlock_request") or {}).get("pending")),
            "period_month": period_month,
            "route": route,
            "action_label": "查看薪酬流程",
        })
    return tasks


@frappe.whitelist()
def get_my_task_hub(year=None, month=None):
    """Return all visible monthly and deadline tasks through one stable schema.

    Source services perform server-side company-scope checks.  The homepage can
    consume this endpoint as a single data source while existing cards remain
    backwards compatible during the gradual UI migration.
    """
    monthly = get_monthly_settlement_status(year, month)
    expiry = get_compliance_expiry_status()
    tasks = _monthly_tasks(monthly) + _payroll_tasks(monthly.get("period")) + _expiry_tasks(expiry)
    priority = {"overdue": 0, "due_soon": 1, "pending": 2, "locked": 3}
    tasks.sort(key=lambda task: (priority.get(task["state"], 9), task.get("due_date") or "9999-12-31", task["title"] or ""))
    counts = {state: sum(1 for task in tasks if task["state"] == state) for state in TASK_STATES}
    return {
        "schema_version": "task-hub-v2",
        "user": frappe.session.user,
        "period": monthly.get("period"),
        "period_label": monthly.get("period_label"),
        "states": TASK_STATES,
        "payroll_workflow_stages": PAYROLL_WORKFLOW_STAGES,
        "payroll_workflow_policy": _workflow_policy_for_current_user(),
        "counts": counts,
        "actionable_count": sum(counts[state] for state in ("overdue", "due_soon", "pending")),
        "tasks": tasks,
    }
