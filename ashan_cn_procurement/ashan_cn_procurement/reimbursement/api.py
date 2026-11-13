"""Whitelisted reimbursement endpoints."""

from collections.abc import Iterable
import frappe

from ashan_cn_procurement.reimbursement.service import (
    get_purchase_invoice_item_candidates,
    get_unpaid_purchase_invoice_picker_rows as get_unpaid_purchase_invoice_picker_row_data,
    import_purchase_invoice_items,
    normalize_names,
    search_unpaid_purchase_invoices as search_unpaid_purchase_invoice_rows,
)


@frappe.whitelist()
def preview_unpaid_purchase_invoice_items(
    company: str,
    purchase_invoice_names: str | Iterable[str] | None = None,
    purchase_invoice_item_names: str | Iterable[str] | None = None,
    excluded_purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Read-only preview used before a new reimbursement request is saved."""
    candidates = get_purchase_invoice_item_candidates(
        company,
        purchase_invoice_names,
        purchase_invoice_item_names,
        existing_sources=set(normalize_names(excluded_purchase_invoice_item_names)),
    )
    return {
        "items": [candidate["row"] for candidate in candidates],
        "imported_count": len(candidates),
        "imported_amount": sum(frappe.utils.flt(candidate["row"]["amount"]) for candidate in candidates),
        "imported_source_items": [candidate["source_pi_item"] for candidate in candidates],
    }


@frappe.whitelist(methods=["POST"])
def import_unpaid_purchase_invoices(
    reimbursement_request_name: str,
    purchase_invoice_names: str | Iterable[str] | None = None,
    purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Server-authoritative import for the Reimbursement Request form."""
    return import_purchase_invoice_items(
        reimbursement_request_name,
        purchase_invoice_names,
        purchase_invoice_item_names,
    )


@frappe.whitelist()
def get_unpaid_purchase_invoice_filter_options(company: str) -> dict:
    """Return the invoice-type options applicable to the current company."""
    if not company:
        frappe.throw(frappe._("请先填写公司。"))

    rows = frappe.get_list(
        "Purchase Invoice",
        filters={"company": company, "docstatus": 1, "outstanding_amount": [">", 0]},
        fields=["custom_invoice_type"],
        order_by="custom_invoice_type asc",
        page_length=500,
    )
    return {
        "invoice_types": sorted(
            {row.custom_invoice_type for row in rows if row.custom_invoice_type}
        )
    }


@frappe.whitelist()
def get_unpaid_purchase_invoice_picker_rows(
    company: str,
    filters: dict | str | None = None,
    mode: str = "invoice",
    reimbursement_request_name: str | None = None,
    excluded_purchase_invoice_item_names: str | Iterable[str] | None = None,
) -> dict:
    """Load the rows displayed below the filters in the single picker dialog."""
    if not company:
        frappe.throw(frappe._("请先填写公司。"))
    return {
        "rows": get_unpaid_purchase_invoice_picker_row_data(
            company=company,
            filters=filters,
            mode=mode,
            reimbursement_request_name=reimbursement_request_name,
            excluded_purchase_invoice_item_names=excluded_purchase_invoice_item_names,
        ),
    }


@frappe.whitelist()
def search_unpaid_purchase_invoices(
    doctype: str,
    txt: str,
    searchfield: str,
    start: int,
    page_len: int,
    filters: dict | str | None = None,
) -> list[tuple]:
    """Permission-aware custom search used by the invoice selection dialog."""
    if doctype != "Purchase Invoice":
        return []
    return search_unpaid_purchase_invoice_rows(
        txt=txt,
        start=start,
        page_len=page_len,
        filters=filters,
    )


@frappe.whitelist()
def get_quick_pay_accounts(company: str) -> dict:
    """Return available paying accounts for Reimbursement Request quick pay."""
    if not company:
        frappe.throw(frappe._("请先指定所属公司。"))

    accounts = frappe.get_all(
        "Account",
        filters={"company": company, "account_type": ["in", ["Cash", "Bank"]], "is_group": 0},
        fields=["name", "account_name", "account_type"],
        order_by="account_type desc, name asc",
    )

    rows = []
    for a in accounts:
        label = a.account_name
        if "孟祥山" in a.name:
            label = f"{a.account_name} (孟祥山出资)"
        elif "无票" in a.name:
            label = f"{a.account_name} (无票支出)"
        elif "其他" in a.name:
            label = f"{a.account_name} (其他员工垫付)"
        elif "农行" in a.name or a.account_type == "Bank":
            label = f"{a.account_name} (对公银行账户)"
        rows.append({
            "paid_from_account": a.name,
            "label": label,
            "account_type": a.account_type,
        })

    def sort_key(x):
        n = x["paid_from_account"]
        if "孟祥山" in n:
            return 1
        if "其他" in n:
            return 2
        if "无票" in n:
            return 3
        if "农行" in n or x["account_type"] == "Bank":
            return 4
        return 5

    rows.sort(key=sort_key)
    return {"accounts": rows}


@frappe.whitelist(methods=["POST"])
def quick_pay_submit(doc_name: str, paid_from_account: str) -> dict:
    """Create and submit Payment Entry for all Purchase Invoices referenced in Reimbursement Request."""
    if not doc_name:
        frappe.throw(frappe._("缺少参数：doc_name"))
    if not paid_from_account:
        frappe.throw(frappe._("缺少参数：paid_from_account"))

    rr_doc = frappe.get_doc("Reimbursement Request", doc_name)
    if int(rr_doc.docstatus or 0) != 1:
        frappe.throw(frappe._("仅支持已提交(docstatus=1)的报销单"))

    company = rr_doc.company
    posting_date = rr_doc.posting_date or frappe.utils.nowdate()

    payable_account = frappe.db.get_value("Company", company, "default_payable_account")
    if not payable_account:
        payable_account = frappe.db.get_value("Account", {"company": company, "account_type": "Payable", "is_group": 0}, "name")

    mode_of_payment = frappe.db.get_value(
        "Mode of Payment Account",
        {"company": company, "default_account": paid_from_account},
        "parent",
    )
    if not mode_of_payment:
        acc_type = frappe.db.get_value("Account", paid_from_account, "account_type")
        mode_of_payment = "银行-农行" if acc_type == "Bank" else "现金-孟祥山"

    pi_amount_map: dict[str, float] = {}
    for it in rr_doc.invoice_items:
        pi = (it.source_pi or "").strip()
        amt = frappe.utils.flt(it.amount or 0)
        if pi and amt > 0:
            pi_amount_map[pi] = pi_amount_map.get(pi, 0.0) + amt

    if not pi_amount_map:
        frappe.throw(frappe._("报销单明细中无可付款发票数据（来源采购发票为空或金额<=0）"))

    created_pes = []
    errors = []

    for pi_name, req_amt in pi_amount_map.items():
        if not frappe.db.exists("Purchase Invoice", pi_name):
            errors.append(f"发票不存在：{pi_name}")
            continue
        pi = frappe.get_doc("Purchase Invoice", pi_name)
        if pi.docstatus != 1:
            errors.append(f"发票未生效提交：{pi_name}")
            continue
        outstanding = frappe.utils.flt(pi.outstanding_amount)
        if outstanding <= 0.0001:
            continue

        pay_amt = min(req_amt, outstanding)
        credit_to = pi.credit_to or payable_account

        try:
            pe = frappe.new_doc("Payment Entry")
            pe.payment_type = "Pay"
            pe.party_type = "Supplier"
            pe.party = pi.supplier
            pe.company = company
            pe.posting_date = posting_date
            pe.mode_of_payment = mode_of_payment
            pe.paid_from = paid_from_account
            pe.paid_to = credit_to
            pe.paid_amount = pay_amt
            pe.received_amount = pay_amt
            pe.reference_no = doc_name
            pe.reference_date = posting_date
            pe.remarks = f"报销整算单快捷付款：{doc_name} (发票: {pi_name})"
            pe.append("references", {
                "reference_doctype": "Purchase Invoice",
                "reference_name": pi_name,
                "total_amount": pi.grand_total,
                "outstanding_amount": outstanding,
                "allocated_amount": pay_amt,
            })
            pe.insert(ignore_permissions=True)
            pe.submit()
            created_pes.append(pe.name)
        except Exception as e:
            errors.append(f"发票 {pi_name} 付款失败: {str(e)}")

    # Update Reimbursement Request payment status
    total_paid = 0.0
    for it in rr_doc.invoice_items:
        if it.source_pi:
            pi_out = frappe.db.get_value("Purchase Invoice", it.source_pi, "outstanding_amount") or 0.0
            if pi_out <= 0.0001:
                total_paid += frappe.utils.flt(it.amount)

    rem_outstanding = max(0.0, frappe.utils.flt(rr_doc.total_amount) - total_paid)
    new_status = "Paid" if rem_outstanding <= 0.01 else ("Partial" if total_paid > 0 else "Unpaid")

    frappe.db.set_value("Reimbursement Request", doc_name, {
        "paid_amount": total_paid,
        "outstanding_amount": rem_outstanding,
        "payment_status": new_status,
    }, update_modified=False)
    frappe.db.commit()

    return {
        "status": "success" if created_pes and not errors else ("partial" if created_pes else "failed"),
        "payment_entries": created_pes,
        "errors": errors,
    }

