# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.utils import flt, cint, now_datetime, getdate, nowdate

def is_invoice_month_locked(company, period):
    """
    检查指定公司在指定月份（YYYY-MM）是否已完成发票月度核定关账锁定
    """
    if not company or not period:
        return False
    
    period = str(period).strip()[:7]
    if not frappe.db.exists("DocType", "Monthly Invoice Closing"):
        return False

    return bool(frappe.db.exists("Monthly Invoice Closing", {
        "company": company,
        "period": period,
        "is_locked": 1
    }))

@frappe.whitelist()
def get_invoice_closing_data(company, period):
    """
    获取指定公司与月份的发票核定数据统计
    """
    if not company or not period:
        frappe.throw(_("请指定公司和核定账期"))

    period = str(period).strip()[:7]
    doc_name = f"INV-CLOSE-{company}-{period}"

    # 统计当月发票数据 (Purchase Invoice)
    # 以 bill_date 或 posting_date 属于当期为准
    sql = """
        SELECT 
            COUNT(name) as count,
            COALESCE(SUM(base_net_total), 0) as net_amount,
            COALESCE(SUM(total_taxes_and_charges), 0) as tax_amount,
            COALESCE(SUM(base_grand_total), 0) as grand_total
        FROM `tabPurchase Invoice`
        WHERE company = %s
          AND (
            (bill_date >= %s AND bill_date <= %s)
            OR (posting_date >= %s AND posting_date <= %s)
          )
          AND docstatus = 1
    """
    start_date = f"{period}-01"
    end_date = f"{period}-31"

    # 1. 采购订单 (Purchase Order)
    po_stats = frappe.db.sql("""
        SELECT COUNT(name) as count, COALESCE(SUM(base_grand_total), 0) as amount
        FROM `tabPurchase Order`
        WHERE company = %s AND transaction_date BETWEEN %s AND %s AND docstatus = 1
    """, (company, start_date, end_date), as_dict=True)
    po_count = cint(po_stats[0].count) if po_stats else 0
    po_amt = flt(po_stats[0].amount) if po_stats else 0.0

    # 2. 采购入库单 (Purchase Receipt)
    pr_stats = frappe.db.sql("""
        SELECT COUNT(name) as count, COALESCE(SUM(base_grand_total), 0) as amount
        FROM `tabPurchase Receipt`
        WHERE company = %s AND posting_date BETWEEN %s AND %s AND docstatus = 1
    """, (company, start_date, end_date), as_dict=True)
    pr_count = cint(pr_stats[0].count) if pr_stats else 0
    pr_amt = flt(pr_stats[0].amount) if pr_stats else 0.0

    # 3. 统计当月发票数据 (Purchase Invoice)
    # 以 bill_date 或 posting_date 属于当期为准
    sql = """
        SELECT 
            COUNT(name) as count,
            COALESCE(SUM(base_net_total), 0) as net_amount,
            COALESCE(SUM(total_taxes_and_charges), 0) as tax_amount,
            COALESCE(SUM(base_grand_total), 0) as grand_total
        FROM `tabPurchase Invoice`
        WHERE company = %s
          AND (
            (bill_date >= %s AND bill_date <= %s)
            OR (posting_date >= %s AND posting_date <= %s)
          )
          AND docstatus = 1
    """
    stats = frappe.db.sql(sql, (company, start_date, end_date, start_date, end_date), as_dict=True)
    inv_count = cint(stats[0].count) if stats else 0
    net_amt = flt(stats[0].net_amount) if stats else 0.0
    tax_amt = flt(stats[0].tax_amount) if stats else 0.0
    grand_tot = flt(stats[0].grand_total) if stats else 0.0

    # 4. 报销申请 (Reimbursement Request)
    reim_count = 0
    reim_amt = 0.0
    if frappe.db.exists("DocType", "Reimbursement Request"):
        reim_stats = frappe.db.sql("""
            SELECT COUNT(name) as count, COALESCE(SUM(total_amount), 0) as amount
            FROM `tabReimbursement Request`
            WHERE company = %s AND posting_date BETWEEN %s AND %s AND docstatus = 1
        """, (company, start_date, end_date), as_dict=True)
        reim_count = cint(reim_stats[0].count) if reim_stats else 0
        reim_amt = flt(reim_stats[0].amount) if reim_stats else 0.0

    closing_doc = None
    if frappe.db.exists("Monthly Invoice Closing", doc_name):
        closing_doc = frappe.get_doc("Monthly Invoice Closing", doc_name).as_dict()

    is_locked = bool(closing_doc and closing_doc.get("is_locked") == 1)

    return {
        "company": company,
        "period": period,
        "doc_name": doc_name,
        "is_locked": is_locked,
        "status": closing_doc.get("status") if closing_doc else ("已核定" if is_locked else "草稿"),
        "po_count": po_count,
        "po_amount": po_amt,
        "pr_count": pr_count,
        "pr_amount": pr_amt,
        "reim_count": reim_count,
        "reim_amount": reim_amt,
        "invoice_count": inv_count,
        "total_net_amount": net_amt,
        "total_tax_amount": tax_amt,
        "total_grand_total": grand_tot,
        "locked_by": closing_doc.get("locked_by") if closing_doc else None,
        "locked_at": str(closing_doc.get("locked_at")) if closing_doc and closing_doc.get("locked_at") else None,
        "unlock_reason": closing_doc.get("unlock_reason") if closing_doc else None,
        "notes": closing_doc.get("notes") if closing_doc else ""
    }

@frappe.whitelist(methods=["POST"])
def lock_monthly_invoice_closing(company, period, notes=None):
    """
    核定并锁定指定公司当月采购与发票台账
    """
    if not company or not period:
        frappe.throw(_("请指定公司和核定账期"))

    roles = frappe.get_roles(frappe.session.user)
    if not (frappe.session.user == "Administrator" or any(r in roles for r in ["System Manager", "Accounts Manager", "Purchase Manager", "财务经理", "采购经理"])):
        frappe.throw(_("只有财务/采购主管或管理员有权执行采购全链条月度核定封账！"), frappe.PermissionError)

    period = str(period).strip()[:7]
    doc_name = f"INV-CLOSE-{company}-{period}"

    data = get_invoice_closing_data(company, period)

    if frappe.db.exists("Monthly Invoice Closing", doc_name):
        doc = frappe.get_doc("Monthly Invoice Closing", doc_name)
    else:
        doc = frappe.new_doc("Monthly Invoice Closing")
        doc.company = company
        doc.period = period

    doc.is_locked = 1
    doc.status = "已核定"
    doc.invoice_count = data["invoice_count"]
    doc.total_net_amount = data["total_net_amount"]
    doc.total_tax_amount = data["total_tax_amount"]
    doc.total_grand_total = data["total_grand_total"]
    doc.locked_by = frappe.session.user
    doc.locked_at = now_datetime()
    if notes:
        doc.notes = notes

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "success": True,
        "message": f"{company} {period} 采购与供应链全链条台账已正式核定并锁定！该月份采购单据与发票进入严格只读封账保护。",
        "doc": doc.as_dict()
    }

@frappe.whitelist(methods=["POST"])
def unlock_monthly_invoice_closing(company, period, unlock_reason=None):
    """
    反审核解锁指定公司当月采购与发票台账
    """
    if not company or not period:
        frappe.throw(_("请指定公司和核定账期"))

    roles = frappe.get_roles(frappe.session.user)
    if not (frappe.session.user == "Administrator" or any(r in roles for r in ["System Manager", "Accounts Manager", "Purchase Manager", "财务经理", "采购经理"])):
        frappe.throw(_("只有财务/采购主管或管理员有权执行采购月度关账解锁！"), frappe.PermissionError)

    if not unlock_reason or len(str(unlock_reason).strip()) < 2:
        frappe.throw(_("请详细填写反审核解锁原因，以便审计追踪！"))

    period = str(period).strip()[:7]
    doc_name = f"INV-CLOSE-{company}-{period}"

    if not frappe.db.exists("Monthly Invoice Closing", doc_name):
        frappe.throw(_("未找到该月关账记录"))

    doc = frappe.get_doc("Monthly Invoice Closing", doc_name)
    doc.is_locked = 0
    doc.status = "已解锁"
    doc.unlocked_by = frappe.session.user
    doc.unlocked_at = now_datetime()
    doc.unlock_reason = unlock_reason

    doc.save(ignore_permissions=True)
    frappe.db.commit()

    return {
        "success": True,
        "message": f"{company} {period} 采购与发票关账已反审核解锁，允许补充录入或修改历史单据。",
        "doc": doc.as_dict()
    }
