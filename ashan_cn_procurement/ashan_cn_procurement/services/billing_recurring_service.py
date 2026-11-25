# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import calendar
import frappe
from frappe import _
from frappe.utils import flt, cint, getdate, today
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission

DEFAULT_RECURRING_CONFIGS = [
    {
        "company": "天津吉众科技有限公司",
        "expense_name": "会计工资",
        "account_category": "现金-无票",
        "category": "员工-会计工资",
        "default_amount": 2400.0,
        "day_of_month": 15,
        "payee": "会计",
        "auto_generate": 1,
        "is_active": 1,
        "remarks": "吉众每月固定无发票会计工资 (15日发放)"
    },
    {
        "company": "天津祺富机械加工有限公司",
        "expense_name": "耐迪保密招待费",
        "account_category": "孟祥山大账",
        "category": "其他招待",
        "default_amount": 3200.0,
        "day_of_month": 20,
        "payee": "孟祥山",
        "auto_generate": 1,
        "is_active": 1,
        "remarks": "固定保密招待费支出，仅大账簿核算"
    },
    {
        "company": "天津祺富机械加工有限公司",
        "expense_name": "货车高速费月结",
        "account_category": "四大固定支出",
        "category": "货车耗材",
        "default_amount": 0.0,
        "day_of_month": 28,
        "payee": "孟祥山",
        "auto_generate": 0,
        "is_active": 1,
        "remarks": "货车高速费台账月结汇总"
    },
    {
        "company": "天津祺富机械加工有限公司",
        "expense_name": "中石化油卡充值",
        "account_category": "四大固定支出",
        "category": "油卡充值",
        "default_amount": 0.0,
        "day_of_month": 25,
        "payee": "孟祥山",
        "auto_generate": 0,
        "is_active": 1,
        "remarks": "车间卡+个人卡现金实际垫付出资"
    },
    {
        "company": "天津祺富机械加工有限公司",
        "expense_name": "轿车ETC通行费",
        "account_category": "四大固定支出",
        "category": "高速费",
        "default_amount": 0.0,
        "day_of_month": 28,
        "payee": "孟祥山",
        "auto_generate": 0,
        "is_active": 1,
        "remarks": "票根网数电发票月末合并总金额"
    }
]


def ensure_default_recurring_configs(company=None):
    """确保常态固定支出默认底册就绪"""
    if not frappe.db.table_exists("Ashan Recurring Expense Config"):
        return

    for item in DEFAULT_RECURRING_CONFIGS:
        if company and item["company"] != company:
            continue
        doc_name = f"{item['company']}-{item['expense_name']}"
        if not frappe.db.exists("Ashan Recurring Expense Config", doc_name):
            try:
                doc = frappe.new_doc("Ashan Recurring Expense Config")
                doc.company = item["company"]
                doc.expense_name = item["expense_name"]
                doc.account_category = item["account_category"]
                doc.category = item["category"]
                doc.default_amount = item["default_amount"]
                doc.day_of_month = item["day_of_month"]
                doc.payee = item["payee"]
                doc.auto_generate = item["auto_generate"]
                doc.is_active = item["is_active"]
                doc.remarks = item["remarks"]
                doc.insert()
            except Exception as e:
                frappe.log_error(f"Error seeding recurring config {doc_name}: {e}")


@frappe.whitelist(methods=["POST"])
def get_recurring_configs(company=None):
    """获取指定公司的常态固定支出配置清单"""
    assert_doctype_permission("Purchase Invoice", "read")
    ensure_default_recurring_configs(company)

    if not frappe.db.table_exists("Ashan Recurring Expense Config"):
        if company:
            return [x for x in DEFAULT_RECURRING_CONFIGS if x["company"] == company]
        return DEFAULT_RECURRING_CONFIGS

    filters = {}
    if company:
        filters["company"] = company

    rows = frappe.get_all(
        "Ashan Recurring Expense Config",
        filters=filters,
        fields=[
            "name", "company", "expense_name", "account_category",
            "category", "default_amount", "day_of_month", "payee",
            "supplier", "auto_generate", "is_active", "remarks"
        ],
        order_by="company asc, day_of_month asc, expense_name asc"
    )
    return rows


@frappe.whitelist(methods=["POST"])
def save_recurring_config(data):
    """保存或更新常态固定支出配置"""
    assert_doctype_permission("Purchase Invoice", "write")
    if isinstance(data, str):
        data = frappe.parse_json(data)

    company = str(data.get("company") or "").strip()
    expense_name = str(data.get("expense_name") or "").strip()
    if not company or not expense_name:
        frappe.throw(_("公司主体与支出项目名称为必填项！"))

    doc_name = f"{company}-{expense_name}"
    if frappe.db.exists("Ashan Recurring Expense Config", doc_name):
        doc = frappe.get_doc("Ashan Recurring Expense Config", doc_name)
    else:
        doc = frappe.new_doc("Ashan Recurring Expense Config")
        doc.company = company
        doc.expense_name = expense_name

    doc.account_category = data.get("account_category") or "现金-无票"
    doc.category = data.get("category") or "日常费用支出"
    doc.default_amount = flt(data.get("default_amount") or 0.0)
    doc.day_of_month = cint(data.get("day_of_month") or 15)
    doc.payee = data.get("payee") or "孟祥山"
    doc.supplier = data.get("supplier") or ""
    doc.auto_generate = 1 if cint(data.get("auto_generate")) else 0
    doc.is_active = 1 if cint(data.get("is_active")) else 0
    doc.remarks = data.get("remarks") or ""
    doc.save()
    return {"status": "ok", "name": doc.name}


@frappe.whitelist(methods=["POST"])
def auto_generate_monthly_recurring_expenses(period_month, company=None):
    """
    针对指定账期月份与公司，全自动录入常态固定支出报销单 (Reimbursement Request)。
    如果当月已有同名固定支出报销单，则安全跳过不重复创建。
    """
    assert_doctype_permission("Purchase Invoice", "write")
    period = str(period_month or "").strip()
    if len(period) == 6 and period.isdigit():
        period = f"{period[:4]}-{period[4:]}"
    elif len(period) != 7 or "-" not in period:
        period = today()[:7]

    y, m = period.split("-")[:2]
    last_day = calendar.monthrange(int(y), int(m))[1]
    start_date = f"{period}-01"
    end_date = f"{period}-{last_day:02d}"

    configs = get_recurring_configs(company=company)
    results = []

    for cfg in configs:
        if not cint(cfg.get("is_active")):
            continue
        if not cint(cfg.get("auto_generate")):
            continue
        amt = flt(cfg.get("default_amount"))
        if amt <= 0:
            continue

        c_name = cfg.get("company")
        exp_name = cfg.get("expense_name")

        # 检查当期是否已有该固定支出的报销单
        existing = frappe.get_all(
            "Reimbursement Request",
            filters={
                "company": c_name,
                "docstatus": ["!=", 2],
                "posting_date": ["between", [start_date, end_date]],
                "title": ["like", f"%{exp_name}%"]
            },
            fields=["name", "docstatus", "total_amount", "posting_date"]
        )

        if existing:
            results.append({
                "expense_name": exp_name,
                "status": "already_exists",
                "doc_name": existing[0].name,
                "amount": existing[0].total_amount,
                "message": f"{period} 已存在【{exp_name}】单据 ({existing[0].name})"
            })
            continue

        # 创建并提交报销单
        target_day = min(last_day, max(1, cint(cfg.get("day_of_month") or 15)))
        p_date = f"{period}-{target_day:02d}"

        try:
            rr = frappe.new_doc("Reimbursement Request")
            rr.company = c_name
            rr.posting_date = p_date
            rr.title = f"【固定支出】{period} {exp_name}"
            rr.total_amount = amt
            rr.paid_amount = amt
            rr.outstanding_amount = 0.0
            rr.payment_status = "已付款"
            
            # 添加行项
            inv_no = "无票" if ("无票" in str(cfg.get("account_category") or "")) else "0"
            rr.append("invoice_items", {
                "item_name": cfg.get("category") or exp_name,
                "description": cfg.get("remarks") or f"{period} 常态固定支出 ({exp_name})",
                "qty": 1,
                "rate": amt,
                "amount": amt,
                "invoice_no": inv_no,
                "custom_line_remark": f"{exp_name} - {cfg.get('account_category') or ''}",
                "supplier": cfg.get("supplier") or ""
            })
            rr.insert()
            rr.submit()

            results.append({
                "expense_name": exp_name,
                "status": "created",
                "doc_name": rr.name,
                "amount": amt,
                "message": f"成功自动录入并过账【{exp_name}】¥{amt:,.2f} ({rr.name})"
            })
        except Exception as e:
            frappe.log_error(f"Error auto generating recurring expense {exp_name}: {e}")
            results.append({
                "expense_name": exp_name,
                "status": "error",
                "error": str(e),
                "message": f"自动生成【{exp_name}】失败: {e}"
            })

    return {
        "period_month": period,
        "company": company,
        "results": results
    }
