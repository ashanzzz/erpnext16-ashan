import frappe
from frappe import _
from frappe.utils import flt

def get_company_vat_account(company):
    tax_acc = frappe.db.get_value("Account", {"account_type": "Tax", "company": company})
    if not tax_acc:
        tax_acc = frappe.db.get_value("Account", {"account_name": ["like", "%税%"], "company": company, "is_group": 0})
    if not tax_acc:
        tax_acc = frappe.db.get_value("Account", {"account_name": ["like", "%VAT%"], "company": company, "is_group": 0})
    return tax_acc

def validate_invoice_type_and_bill_no(doc):
    """
    管控发票类型与发票号的业务规则：
    1. 无发票：禁止输入发票号，自动清空发票号。
    2. 专用发票 / 普通发票：强制必填发票号，且全公司/系统内防重校验。
    """
    inv_type = (doc.custom_invoice_type or "").strip()
    bill_no = (doc.bill_no or "").strip()

    if inv_type == "无发票":
        if bill_no:
            doc.bill_no = ""
    elif inv_type in ["专用发票", "普通发票"]:
        if not bill_no:
            frappe.throw(_("发票类型为【{0}】时，必须填写【发票号】！").format(inv_type))
        
        # 全单据查重（排除当前单据和已作废 docstatus=2 的单据）
        duplicate = frappe.db.sql("""
            SELECT name, supplier, bill_date, posting_date
            FROM `tabPurchase Invoice`
            WHERE bill_no = %s AND name != %s AND docstatus < 2
            LIMIT 1
        """, (bill_no, doc.name or ""), as_dict=True)

        if duplicate:
            dup_doc = duplicate[0]
            frappe.throw(_(
                "发票号【{0}】已在采购发票【{1}】（供应商：{2}，记账日期：{3}）中录入，禁止重复使用！"
            ).format(bill_no, dup_doc.name, dup_doc.supplier or "", dup_doc.posting_date or ""))

@frappe.whitelist()
def check_bill_no_duplicate(bill_no, docname=None):
    """
    前端失焦时即时异步查重 API
    """
    if not bill_no or not bill_no.strip():
        return {"is_duplicate": False}

    bill_no = bill_no.strip()
    duplicate = frappe.db.sql("""
        SELECT name, supplier, bill_date, posting_date
        FROM `tabPurchase Invoice`
        WHERE bill_no = %s AND name != %s AND docstatus < 2
        LIMIT 1
    """, (bill_no, docname or ""), as_dict=True)

    if duplicate:
        dup = duplicate[0]
        return {
            "is_duplicate": True,
            "message": _("发票号【{0}】已在采购发票【{1}】（供应商：{2}，记账日期：{3}）中录入，禁止重复使用！").format(
                bill_no, dup.name, dup.supplier or "", dup.posting_date or ""
            ),
            "duplicate_name": dup.name,
            "supplier": dup.supplier,
            "posting_date": str(dup.posting_date)
        }
    return {"is_duplicate": False}

def update_items_summary(doc):
    """
    自动汇总发票明细物料至 custom_items_summary 字段，便于在列表页快速查看与搜索
    """
    if not getattr(doc, "items", None):
        doc.custom_items_summary = ""
        return

    item_strs = []
    for it in doc.items:
        name = (it.item_name or it.item_code or "").strip()
        if not name:
            continue
        qty = flt(it.qty)
        qty_str = f"{qty:g}"
        item_strs.append(f"{name} (x{qty_str})")

    if not item_strs:
        doc.custom_items_summary = ""
    elif len(item_strs) > 3:
        doc.custom_items_summary = "、".join(item_strs[:3]) + f" 等共{len(item_strs)}项"
    else:
        doc.custom_items_summary = "、".join(item_strs)

def calculate_china_line_taxes(doc, method=None):
    if not doc.items:
        update_items_summary(doc)
        return

    net_total = 0.0
    total_tax = 0.0
    grand_total = 0.0

    for item in doc.items:
        qty = flt(item.qty) or 1.0
        tax_rate = flt(item.custom_tax_rate) if (item.custom_tax_rate is not None and item.custom_tax_rate != "") else 13.0
        item.custom_tax_rate = tax_rate

        # 1. 录入了价税合计 (custom_gross_amount)
        if flt(item.custom_gross_amount) > 0 and (not flt(item.custom_gross_rate) or flt(item.custom_gross_amount) != flt(qty * flt(item.custom_gross_rate), 2)):
            gross_amount = flt(item.custom_gross_amount, 2)
            gross_rate = flt(gross_amount / qty, 4)
            net_amount = flt(gross_amount / (1.0 + tax_rate / 100.0), 2) if tax_rate >= 0 else gross_amount
            net_rate = flt(net_amount / qty, 4)
            tax_amount = flt(gross_amount - net_amount, 2)
            
            item.custom_gross_rate = gross_rate
            item.rate = net_rate
            item.base_rate = net_rate
            item.amount = net_amount
            item.base_amount = net_amount
            item.net_rate = net_rate
            item.net_amount = net_amount
            item.base_net_rate = net_rate
            item.base_net_amount = net_amount
            item.custom_tax_amount = tax_amount

        # 2. 录入了含税单价 (custom_gross_rate)
        elif flt(item.custom_gross_rate) > 0:
            gross_rate = flt(item.custom_gross_rate)
            gross_amount = flt(qty * gross_rate, 2)
            net_amount = flt(gross_amount / (1.0 + tax_rate / 100.0), 2) if tax_rate >= 0 else gross_amount
            net_rate = flt(net_amount / qty, 4)
            tax_amount = flt(gross_amount - net_amount, 2)

            item.rate = net_rate
            item.base_rate = net_rate
            item.amount = net_amount
            item.base_amount = net_amount
            item.net_rate = net_rate
            item.net_amount = net_amount
            item.base_net_rate = net_rate
            item.base_net_amount = net_amount
            item.custom_gross_amount = gross_amount
            item.custom_tax_amount = tax_amount
        
        # 3. 录入了不含税单价 (rate)
        elif flt(item.rate) > 0:
            net_rate = flt(item.rate)
            net_amount = flt(qty * net_rate, 2)
            tax_amount = flt(net_amount * (tax_rate / 100.0), 2)
            gross_amount = flt(net_amount + tax_amount, 2)
            gross_rate = flt(gross_amount / qty, 4)

            item.base_rate = net_rate
            item.amount = net_amount
            item.base_amount = net_amount
            item.net_rate = net_rate
            item.net_amount = net_amount
            item.base_net_rate = net_rate
            item.base_net_amount = net_amount
            item.custom_gross_rate = gross_rate
            item.custom_gross_amount = gross_amount
            item.custom_tax_amount = tax_amount

        net_total += flt(item.amount, 2)
        total_tax += flt(item.custom_tax_amount, 2)
        grand_total += flt(item.custom_gross_amount, 2)

    total_tax = flt(total_tax, 2)
    net_total = flt(net_total, 2)
    grand_total = flt(grand_total, 2)

    doc.net_total = net_total
    doc.base_net_total = net_total
    doc.total = net_total
    doc.base_total = net_total

    # 同步原生 taxes 子表
    vat_acc = get_company_vat_account(doc.company)
    if total_tax > 0 and vat_acc:
        has_vat = False
        for t in (doc.taxes or []):
            if t.account_head == vat_acc or "进项" in (t.description or "") or "VAT" in (t.description or ""):
                t.charge_type = "Actual"
                t.account_head = vat_acc
                t.tax_amount = total_tax
                t.tax_amount_after_discount_on_invoice = total_tax
                t.base_tax_amount = total_tax
                t.base_tax_amount_after_discount_on_invoice = total_tax
                t.total = grand_total
                t.base_total = grand_total
                t.description = "进项税额 (增值税)"
                has_vat = True
                break
        
        if not has_vat:
            doc.append("taxes", {
                "charge_type": "Actual",
                "account_head": vat_acc,
                "tax_amount": total_tax,
                "tax_amount_after_discount_on_invoice": total_tax,
                "base_tax_amount": total_tax,
                "base_tax_amount_after_discount_on_invoice": total_tax,
                "total": grand_total,
                "base_total": grand_total,
                "description": "进项税额 (增值税)",
                "category": "Total",
                "add_deduct_tax": "Add"
            })
    
    doc.total_taxes_and_charges = total_tax
    doc.base_total_taxes_and_charges = total_tax
    doc.grand_total = grand_total
    doc.base_grand_total = grand_total
    doc.rounded_total = grand_total
    doc.base_rounded_total = grand_total
    doc.outstanding_amount = grand_total

    # 4. 自动生成开票物料明细摘要
    update_items_summary(doc)

def validate_invoice_month_not_locked(doc):
    """
    检查发票所属月份（票据日期/记账日期）是否已执行发票月度核定关账锁定
    """
    if not doc.company:
        return

    from ashan_cn_procurement.services.invoice_closing_service import is_invoice_month_locked

    periods_to_check = set()
    if doc.bill_date:
        periods_to_check.add(str(doc.bill_date)[:7])
    if doc.posting_date:
        periods_to_check.add(str(doc.posting_date)[:7])

    for p in periods_to_check:
        if is_invoice_month_locked(doc.company, p):
            frappe.throw(
                _("【🔒 发票月度核定锁定】主体【{0}】在账期【{1}】的发票台账已完成月度核定并锁定，禁止新建、修改或提交该月份的发票！<br><br>如需补录发票，请联系财务主管在总控中枢【月度任务】中反审核解锁。").format(
                    doc.company, p
                )
            )

def validate_purchase_invoice_taxes(doc, method=None):
    # 0. 校验发票所属月份是否已核定锁定
    validate_invoice_month_not_locked(doc)
    # 1. 校验发票类型与发票号
    validate_invoice_type_and_bill_no(doc)
    # 2. 计算多税率与进项税额
    calculate_china_line_taxes(doc, method)
    # 3. 自动更新物料明细摘要
    update_items_summary(doc)
