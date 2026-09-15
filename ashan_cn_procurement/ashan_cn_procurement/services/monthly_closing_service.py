# ASHAN-COMPLETE: monthly-closing routes aligned with real workbench pages
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

from __future__ import annotations

import frappe
from frappe import _
from frappe.utils import getdate, nowdate, cint, flt, format_datetime

from ashan_cn_procurement.services.authorization_service import (
    get_allowed_companies,
    MODULE_ACCESS_MODEL,
)
from ashan_cn_procurement.services.periodic_tasks import (
    get_compliance_expiry_status,
)


TASK_DEFINITIONS = [
    {
        "key": "payroll_jz",
        "title": "吉众薪酬与个税核定",
        "category": "人力薪酬",
        "company": "天津吉众科技有限公司",
        "company_short": "吉众",
        "lock_strength": "严格锁死 (全局只读)",
        "lock_desc": "核定封账后全局进入只读保护，禁止任何员工薪资修改或重新计算；如需调整必须由管理员发起反审核解锁并留痕。",
        "edit_rule": "核定后禁止直接修改，需管理员反审核解锁",
        "required_roles": "Payroll Manager, Payroll Operator, System Manager",
        "route": "/desk/jizhong-hr-salary-workbench",
        "doctype": "Ashan Payroll Entry",
        "action_type": "link",
    },
    {
        "key": "payroll_qf",
        "title": "祺富薪酬与个税核定",
        "category": "人力薪酬",
        "company": "天津祺富机械加工有限公司",
        "company_short": "祺富",
        "lock_strength": "严格锁死 (全局只读)",
        "lock_desc": "核定封账后全员工资条、7级预扣个税反推、五险一金基数完全固化；反审核必须经审批并记录原因。",
        "edit_rule": "核定后禁止直接修改，需管理员反审核解锁",
        "required_roles": "Payroll Manager, Payroll Operator, System Manager",
        "route": "/desk/qifu-hr-salary-workbench",
        "doctype": "Ashan Monthly Payroll Settlement",
        "action_type": "link",
    },
    {
        "key": "invoice_jz",
        "title": "吉众采购与供应链月度综合封账",
        "category": "采购供应链",
        "company": "天津吉众科技有限公司",
        "company_short": "吉众",
        "lock_strength": "全链路强拦截 (禁止增改删)",
        "lock_desc": "核定关账后，系统在底层钩子强拦截当月采购申请、订单、入库单、发票与报销单，严密禁止增改删。",
        "edit_rule": "核定后禁止增改删当月采购全链条单据，需反审核解锁",
        "required_roles": "Purchase Manager, Accounts Manager, Tax Invoice Manager, System Manager",
        "route": "/desk/tax-invoice-center",
        "doctype": "Monthly Invoice Closing",
        "action_type": "invoice_dialog",
    },
    {
        "key": "invoice_qf",
        "title": "祺富采购与供应链月度综合封账",
        "category": "采购供应链",
        "company": "天津祺富机械加工有限公司",
        "company_short": "祺富",
        "lock_strength": "全链路强拦截 (禁止增改删)",
        "lock_desc": "核定关账后锁定当月采购全链条单据与进项税金底册，防止报税和结算后数据被篡改。",
        "edit_rule": "核定后禁止增改删当月采购全链条单据，需反审核解锁",
        "required_roles": "Purchase Manager, Accounts Manager, Tax Invoice Manager, System Manager",
        "route": "/desk/tax-invoice-center",
        "doctype": "Monthly Invoice Closing",
        "action_type": "invoice_dialog",
    },
    {
        "key": "oil_card_jz",
        "title": "车辆油卡月度流水核定",
        "category": "车辆油卡",
        "company": "天津吉众科技有限公司",
        "company_short": "吉众",
        "lock_strength": "四柱结存锁死",
        "lock_desc": "核定锁定后，主卡/副卡充值、加油明细与期末核定余额固化为不可变凭证，禁止补录或修改当月加油日志。",
        "edit_rule": "核定后台账锁死，取消核定需填报原因",
        "required_roles": "Oil Card Manager, Oil Card Operator, System Manager",
        "route": "/desk/oil-card-ledger",
        "doctype": "Oil Card Monthly Closing",
        "action_type": "link",
    },
    {
        "key": "toll_jz",
        "title": "车辆高速费月度账单核定",
        "category": "车辆油卡",
        "company": "天津吉众科技有限公司",
        "company_short": "吉众",
        "lock_strength": "账单冻结",
        "lock_desc": "月度账单生成并提交后，通行费记录与押金核销完全锁定，不可重复生成或修改。",
        "edit_rule": "提交核定后只读",
        "required_roles": "Oil Card Manager, Oil Card Operator, System Manager",
        "route": "/desk/vehicle-toll-monthly-sheet",
        "doctype": "Vehicle Toll Monthly Sheet",
        "action_type": "link",
    },
    {
        "key": "meal_jz",
        "title": "吉众车间日常餐费月度核定",
        "category": "人力薪酬",
        "company": "天津吉众科技有限公司",
        "company_short": "吉众",
        "lock_strength": "餐费基数锁死",
        "lock_desc": "核定后当月每日就餐人次与餐费总额锁死，直接作为薪酬核算的餐费扣款依据，禁止再变动。",
        "edit_rule": "核定后禁止修改明细",
        "required_roles": "HR Manager, Payroll Operator, System Manager",
        "route": "/desk/meal-settlement-workbench",
        "doctype": "Ashan Monthly Meal Settlement",
        "action_type": "link",
    },
    {
        "key": "meal_qf",
        "title": "祺富车间日常餐费月度核定",
        "category": "人力薪酬",
        "company": "天津祺富机械加工有限公司",
        "company_short": "祺富",
        "lock_strength": "餐费基数锁死",
        "lock_desc": "核定后当月每日就餐人次与餐费总额锁死，作为薪酬核算的餐费扣款依据。",
        "edit_rule": "核定后禁止修改明细",
        "required_roles": "HR Manager, Payroll Operator, System Manager",
        "route": "/desk/meal-settlement-workbench",
        "doctype": "Ashan Monthly Meal Settlement",
        "action_type": "link",
    },
    {
        "key": "property_qf",
        "title": "祺富水电能耗与租赁月结",
        "category": "合规物业",
        "company": "天津祺富机械加工有限公司",
        "company_short": "祺富",
        "lock_strength": "过账锁死与表底结转",
        "lock_desc": "月结单提交过账后生成正式财务凭证，抄表读数自动结转为下期表底，历史期末读数禁止修改。",
        "edit_rule": "提交过账后只读，取消需作废整单",
        "required_roles": "Property Manager, Property Operator, System Manager",
        "route": "/desk/property-settlement-workbench",
        "doctype": "Property Monthly Settlement",
        "action_type": "link",
    },
]


def _check_task_status_for_period(task_def: dict, period: str) -> dict:
    """Return status, verification audit info, and details for one task in one period."""
    key = task_def["key"]
    company = task_def["company"]
    
    is_settled = False
    status_label = "未核定"
    verifier = None
    verified_at = None
    unlock_reason = None
    detail_text = ""

    if key == "payroll_jz":
        if frappe.db.exists("DocType", "Ashan Payroll Entry"):
            entries = frappe.get_all(
                "Ashan Payroll Entry",
                filters={"payroll_month": period, "company": company},
                fields=["name", "status", "modified_by", "modified"],
                limit=1,
            )
            if entries and entries[0].status == "已封账":
                is_settled = True
                status_label = "已封账"
                verifier = entries[0].modified_by
                verified_at = str(entries[0].modified)
            else:
                cnt = frappe.db.count("Ashan Employee Salary Profile", {"company": company, "employment_status": "在职"})
                detail_text = f"在册 {cnt} 人待核定" if cnt > 0 else "待生成当月核算"
        elif frappe.db.exists("DocType", "Payroll Month Close"):
            is_settled = bool(frappe.db.exists("Payroll Month Close", {"payroll_period": period, "company": company, "is_locked": 1}))
            status_label = "已封账" if is_settled else "未封账"

    elif key == "payroll_qf":
        if frappe.db.exists("DocType", "Ashan Monthly Payroll Settlement"):
            doc_name = f"PAY-SETTLE-{company}-{period}"
            if frappe.db.exists("Ashan Monthly Payroll Settlement", doc_name):
                doc = frappe.get_doc("Ashan Monthly Payroll Settlement", doc_name)
                if doc.status in ("已核定锁定", "已归档发放"):
                    is_settled = True
                    status_label = "已核定锁定"
                    verifier = doc.confirmed_by or doc.modified_by
                    verified_at = str(doc.confirmed_date or doc.modified)
                elif doc.status == "草稿":
                    status_label = "草稿待核定"
                    detail_text = f"包含 {len(doc.get('payroll_items') or [])} 条工资核算"
            else:
                cnt = frappe.db.count("Ashan Employee Salary Profile", {"company": company, "employment_status": "在职"})
                detail_text = f"在册 {cnt} 人待核定" if cnt > 0 else "待生成当月核算"

    elif key in ("invoice_jz", "invoice_qf"):
        doc_name = f"INV-CLOSE-{company}-{period}"
        if frappe.db.exists("Monthly Invoice Closing", doc_name):
            doc = frappe.get_doc("Monthly Invoice Closing", doc_name)
            if doc.is_locked:
                is_settled = True
                status_label = "已封账锁定"
                verifier = doc.locked_by
                verified_at = str(doc.locked_at) if doc.locked_at else None
                detail_text = f"已核定 {doc.invoice_count or 0} 笔发票, 价税合计 ¥{flt(doc.total_grand_total):,.2f}"
            else:
                status_label = "已解锁/草稿"
                unlock_reason = doc.unlock_reason
        if not is_settled and not detail_text:
            start_date = f"{period}-01"
            end_date = f"{period}-31"
            po_count = frappe.db.count("Purchase Order", {
                "company": company,
                "transaction_date": ["between", [start_date, end_date]],
                "docstatus": 1
            })
            inv_count = frappe.db.count("Purchase Invoice", {
                "company": company,
                "posting_date": ["between", [start_date, end_date]],
                "docstatus": 1
            })
            if po_count > 0 or inv_count > 0:
                detail_text = f"当月已录 {po_count} 笔订单, {inv_count} 笔发票"
            else:
                detail_text = "当月暂无过账订单与发票"

    elif key == "oil_card_jz":
        y_i, m_i = [int(x) for x in period.split("-")]
        if frappe.db.exists("DocType", "Oil Card Monthly Closing"):
            closings = frappe.get_all(
                "Oil Card Monthly Closing",
                filters={"fiscal_year": y_i, "fiscal_month": m_i, "closing_locked": 1},
                fields=["name", "locked_by", "locked_at", "closing_balance"],
                limit=1,
            )
            if closings:
                is_settled = True
                status_label = "已核定锁定"
                verifier = closings[0].locked_by
                verified_at = str(closings[0].locked_at) if closings[0].locked_at else None
                detail_text = f"期末核定余额 ¥{flt(closings[0].closing_balance):,.2f}"
        if not is_settled and frappe.db.exists("DocType", "Oil Card Invoice Batch"):
            is_settled = bool(frappe.db.exists("Oil Card Invoice Batch", {"batch_period": period, "docstatus": 1}))
            if is_settled:
                status_label = "已批次核定"
        if not is_settled:
            refuels = frappe.db.count("Oil Card Refuel Log", {
                "posting_date": ["between", [f"{period}-01", f"{period}-31"]]
            })
            detail_text = f"有 {refuels} 笔加油明细待核定" if refuels > 0 else "尚未录入加油明细"

    elif key == "toll_jz":
        y_i, m_i = [int(x) for x in period.split("-")]
        if frappe.db.exists("DocType", "Vehicle Toll Monthly Sheet"):
            sheets = frappe.get_all(
                "Vehicle Toll Monthly Sheet",
                filters={"fiscal_year": y_i, "fiscal_month": m_i, "is_locked": 1},
                fields=["name", "locked_by", "locked_at", "total_expense"],
                limit=1,
            )
            if sheets:
                is_settled = True
                status_label = "已核定锁定"
                verifier = sheets[0].locked_by
                verified_at = str(sheets[0].locked_at) if sheets[0].locked_at else None
                detail_text = f"核定通行费 ¥{flt(sheets[0].total_expense):,.2f}"
            else:
                count_sheets = frappe.db.count("Vehicle Toll Monthly Sheet", {"fiscal_year": y_i, "fiscal_month": m_i})
                detail_text = f"有 {count_sheets} 份车辆账单待核定" if count_sheets > 0 else "待生成月度账单"
        else:
            detail_text = "待生成月度账单"

    elif key in ("meal_jz", "meal_qf"):
        meal_doc = f"MEAL-{period}"
        if frappe.db.exists("Ashan Monthly Meal Settlement", meal_doc):
            doc = frappe.get_doc("Ashan Monthly Meal Settlement", meal_doc)
            if doc.status == "已核定":
                is_settled = True
                status_label = "已核定锁定"
                verifier = doc.modified_by
                verified_at = str(doc.modified)
                detail_text = f"就餐共 {len(doc.get('items') or [])} 人次"
            else:
                status_label = "草稿待核定"
                detail_text = f"已汇总 {len(doc.get('items') or [])} 条就餐明细"
        else:
            detail_text = "待汇总车间就餐台账"

    elif key == "property_qf":
        if frappe.db.exists("DocType", "Property Monthly Settlement"):
            start_date = f"{period}-01"
            end_date = f"{period}-31"
            props = frappe.get_all(
                "Property Monthly Settlement",
                filters={
                    "settlement_month": ["between", [start_date, end_date]],
                    "status": "已结算"
                },
                fields=["name", "settled_by", "settled_at", "total_amount"],
                limit=1,
            )
            if props:
                is_settled = True
                status_label = "已结算锁定"
                verifier = props[0].settled_by
                verified_at = str(props[0].settled_at) if props[0].settled_at else None
                detail_text = f"月结总额 ¥{flt(props[0].total_amount):,.2f}"
            else:
                detail_text = "水电抄表与分摊待月结"
        else:
            detail_text = "水电抄表与分摊待月结"

    return {
        "is_settled": is_settled,
        "status_label": status_label,
        "verifier": verifier,
        "verified_at": verified_at,
        "unlock_reason": unlock_reason,
        "detail_text": detail_text,
    }


def _detect_earliest_unsettled_period(task_def: dict, candidate_months: list[str]) -> tuple[str, dict]:
    """Detect earliest unsettled month for one task across candidate months."""
    for p in candidate_months:
        info = _check_task_status_for_period(task_def, p)
        if not info["is_settled"]:
            return p, info
    # If all settled, return the latest month
    latest = candidate_months[-1]
    return latest, _check_task_status_for_period(task_def, latest)


@frappe.whitelist()
def get_monthly_closing_dashboard(year=None, month=None):
    """
    获取月度核定任务全景管理汇总大表数据
    """
    user = frappe.session.user
    company_scope = get_allowed_companies(user)
    is_admin = company_scope is None
    scoped_companies = company_scope or set()

    now_d = getdate(nowdate())
    cur_y = int(year) if year else now_d.year
    cur_m = int(month) if month else now_d.month
    period_str = f"{cur_y}-{cur_m:02d}"
    period_label = f"{cur_y}年{cur_m:02d}月"

    # Candidate months for earliest unsettled detection: from 2026-06 up to cur_y-cur_m
    candidate_months = []
    start_tot = 2026 * 12 + 6
    cur_tot = cur_y * 12 + cur_m
    for tot_m in range(start_tot, cur_tot + 1):
        y = (tot_m - 1) // 12
        m = (tot_m - 1) % 12 + 1
        candidate_months.append(f"{y:04d}-{m:02d}")

    tasks = []
    total_count = 0
    settled_count = 0
    pending_count = 0

    for item in TASK_DEFINITIONS:
        # Check company scope
        comp = item["company"]
        if not is_admin:
            if not any(sc in comp or comp in sc for sc in scoped_companies):
                continue

        target_p, status_info = _detect_earliest_unsettled_period(item, candidate_months)
        is_settled = status_info["is_settled"]
        total_count += 1
        if is_settled:
            settled_count += 1
        else:
            pending_count += 1

        y_p, m_p = [int(x) for x in target_p.split("-")]
        p_lbl = f"{y_p}年{m_p:02d}月"

        tasks.append({
            "key": item["key"],
            "title": item["title"],
            "category": item["category"],
            "company": item["company"],
            "company_short": item["company_short"],
            "target_period": target_p,
            "target_period_label": p_lbl,
            "is_settled": is_settled,
            "status_label": status_info["status_label"],
            "severity": "success" if is_settled else "warning",
            "lock_strength": item["lock_strength"],
            "lock_desc": item["lock_desc"],
            "edit_rule": item["edit_rule"],
            "required_roles": item["required_roles"],
            "verifier": status_info["verifier"],
            "verified_at": status_info["verified_at"],
            "unlock_reason": status_info["unlock_reason"],
            "detail_text": status_info["detail_text"],
            "route": item["route"],
            "action_type": item["action_type"],
            "action_label": "查看台账" if is_settled else "去核定",
        })

    # Sort tasks: pending first, then by company and title
    tasks.sort(key=lambda x: (0 if not x["is_settled"] else 1, x["company_short"], x["title"]))

    return {
        "period": period_str,
        "period_label": period_label,
        "current_user": user,
        "is_admin": is_admin,
        "summary": {
            "total_tasks": total_count,
            "settled_tasks": settled_count,
            "pending_tasks": pending_count,
            "all_done": total_count > 0 and (total_count == settled_count),
        },
        "tasks": tasks,
    }


@frappe.whitelist()
def get_annual_timeline_matrix(year=None):
    """
    获取指定年份 1~12 月全任务时序核定矩阵
    """
    user = frappe.session.user
    company_scope = get_allowed_companies(user)
    is_admin = company_scope is None
    scoped_companies = company_scope or set()

    now_d = getdate(nowdate())
    target_year = int(year) if year else now_d.year
    cur_month_key = f"{now_d.year}-{now_d.month:02d}"

    matrix_rows = []

    for item in TASK_DEFINITIONS:
        comp = item["company"]
        if not is_admin:
            if not any(sc in comp or comp in sc for sc in scoped_companies):
                continue

        month_statuses = []
        for m in range(1, 13):
            p = f"{target_year:04d}-{m:02d}"
            # Determine if future month
            if p > cur_month_key:
                st = {
                    "period": p,
                    "month": m,
                    "state": "future",
                    "label": "未到期",
                    "is_settled": False,
                }
            elif p < "2026-06":
                # Historical prior to ERP start
                st = {
                    "period": p,
                    "month": m,
                    "state": "archived",
                    "label": "历史归档",
                    "is_settled": True,
                }
            else:
                info = _check_task_status_for_period(item, p)
                st = {
                    "period": p,
                    "month": m,
                    "state": "settled" if info["is_settled"] else "pending",
                    "label": info["status_label"],
                    "is_settled": info["is_settled"],
                    "verifier": info["verifier"],
                    "detail_text": info["detail_text"],
                }
            month_statuses.append(st)

        matrix_rows.append({
            "key": item["key"],
            "title": item["title"],
            "category": item["category"],
            "company": item["company"],
            "company_short": item["company_short"],
            "lock_strength": item["lock_strength"],
            "months": month_statuses,
            "route": item["route"],
            "action_type": item["action_type"],
        })

    return {
        "year": target_year,
        "rows": matrix_rows,
    }
