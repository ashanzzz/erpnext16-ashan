# Copyright (c) 2026, Ashan and contributors
# For license information, please see license.txt

import json
import frappe
from frappe import _
from frappe.utils import flt, getdate, nowdate
from ashan_cn_procurement.services.authorization_service import assert_company_access, get_allowed_companies
from ashan_cn_procurement.services.work_context_service import get_effective_work_date


# =========================================================================
# 1. Workbench Context & Permissions
# =========================================================================

@frappe.whitelist()
def get_contract_workbench_context() -> dict:
    """Return initial context for the Procurement Contract Workbench."""
    allowed_companies = get_allowed_companies()
    return {
        "allowed_companies": allowed_companies,
        "effective_work_date": get_effective_work_date(),
    }


# =========================================================================
# 2. Query Contract List & Aggregated KPIs
# =========================================================================

@frappe.whitelist()
def get_contract_list(company: str | None = None, status: str | None = None, search: str | None = None) -> dict:
    """Fetch procurement contracts with embedded milestones, execution progress, and KPIs."""
    allowed_companies = get_allowed_companies()
    if company:
        assert_company_access(company)
        companies = [company]
    else:
        companies = allowed_companies

    conditions = ["docstatus < 2"]
    values = {}

    if companies:
        conditions.append("company IN %(companies)s")
        values["companies"] = tuple(companies)

    if status and status != "全部" and status != "all":
        if status == "active" or status == "履约中":
            conditions.append("status = '履约中'")
        elif status == "draft" or status == "草稿":
            conditions.append("docstatus = 0")
        elif status == "completed" or status == "已结清":
            conditions.append("status = '已结清'")

    if search and search.strip():
        conditions.append("(name LIKE %(search)s OR contract_title LIKE %(search)s OR supplier LIKE %(search)s)")
        values["search"] = f"%{search.strip()}%"

    where_clause = " AND ".join(conditions)

    # 1. Fetch KPI overview
    all_where = "company IN %(companies)s AND docstatus < 2" if companies else "docstatus < 2"
    all_contracts = frappe.db.sql(f"""
        SELECT
            name, docstatus, status, total_contract_amount, total_settled_amount, total_paid_amount, outstanding_amount
        FROM `tabProcurement Contract`
        WHERE {all_where}
    """, {"companies": tuple(companies)} if companies else {}, as_dict=True)

    total_count = len(all_contracts)
    active_count = sum(1 for c in all_contracts if c.status == "履约中" or (c.docstatus == 1 and flt(c.outstanding_amount) > 0.01))
    draft_count = sum(1 for c in all_contracts if c.docstatus == 0)
    completed_count = sum(1 for c in all_contracts if c.status == "已结清" or (c.docstatus == 1 and flt(c.outstanding_amount) <= 0.01 and flt(c.total_paid_amount) > 0))

    kpi_total_amt = sum(flt(c.total_contract_amount) for c in all_contracts)
    kpi_settled_amt = sum(flt(c.total_settled_amount) for c in all_contracts)
    kpi_paid_amt = sum(flt(c.total_paid_amount) for c in all_contracts)
    kpi_out_amt = sum(flt(c.outstanding_amount) for c in all_contracts)
    kpi_paid_ratio = flt((kpi_paid_amt / kpi_total_amt * 100), 1) if kpi_total_amt > 0 else 0.0

    # 2. Fetch matched contracts
    contracts = frappe.db.sql(f"""
        SELECT
            name as contract_no,
            contract_title,
            contract_type,
            company,
            supplier,
            total_contract_amount,
            currency,
            effective_date,
            expiry_date,
            status,
            docstatus,
            total_settled_amount,
            total_paid_amount,
            outstanding_amount,
            completion_ratio,
            remarks,
            creation,
            modified
        FROM `tabProcurement Contract`
        WHERE {where_clause}
        ORDER BY
            CASE WHEN docstatus = 0 THEN 0 WHEN status = '履约中' THEN 1 ELSE 2 END,
            creation DESC
    """, values, as_dict=True)

    # 3. Attach payment terms for each contract
    for c in contracts:
        terms = frappe.get_all(
            "Contract Payment Term",
            filters={"parent": c.contract_no, "parenttype": "Procurement Contract"},
            fields=[
                "name", "idx", "stage_name", "payment_ratio", "term_amount",
                "planned_date", "linked_reimbursement", "linked_purchase_invoice",
                "paid_amount", "outstanding_amount", "term_status", "remarks"
            ],
            order_by="idx ASC"
        )
        c["payment_terms"] = terms
        c["terms_count"] = len(terms)
        c["can_delete"] = (c.docstatus == 0)

    return {
        "contracts": contracts,
        "kpis": {
            "total_count": total_count,
            "active_count": active_count,
            "draft_count": draft_count,
            "completed_count": completed_count,
            "total_contract_amount": kpi_total_amt,
            "total_settled_amount": kpi_settled_amt,
            "total_paid_amount": kpi_paid_amt,
            "outstanding_amount": kpi_out_amt,
            "paid_ratio": kpi_paid_ratio,
        }
    }


# =========================================================================
# 3. Contract Details with Full Execution Audit Trail
# =========================================================================

@frappe.whitelist()
def get_contract_detail(contract_no: str) -> dict:
    """Fetch complete contract with linked settlement requests and invoices."""
    if not contract_no or not contract_no.strip():
        frappe.throw(_("请指定合同编号。"))

    contract = frappe.get_doc("Procurement Contract", contract_no.strip())
    assert_company_access(contract.company)
    contract.update_settlement_progress()

    # Query linked Reimbursement Requests
    linked_rrs = frappe.get_all(
        "Reimbursement Request",
        filters={"custom_contract": contract.name, "docstatus": ["<", 2]},
        fields=["name", "title", "posting_date", "total_amount", "outstanding_amount", "docstatus", "custom_contract_stage"],
        order_by="posting_date DESC"
    )

    return {
        "contract": contract.as_dict(),
        "linked_reimbursements": linked_rrs,
    }


# =========================================================================
# 4. Create / Save Procurement Contract
# =========================================================================

@frappe.whitelist(methods=["POST"])
def save_procurement_contract(contract_data: str) -> dict:
    """Save or create a Procurement Contract with payment milestones."""
    if isinstance(contract_data, str):
        data = json.loads(contract_data)
    else:
        data = contract_data

    company = data.get("company")
    if not company:
        frappe.throw(_("请选择签约公司。"))
    assert_company_access(company)

    contract_name = data.get("contract_no") or data.get("name")
    is_edit = bool(contract_name and frappe.db.exists("Procurement Contract", contract_name))

    if is_edit:
        doc = frappe.get_doc("Procurement Contract", contract_name)
        if doc.docstatus == 1:
            frappe.throw(_("已生效提交的合同不可直接修改，请先变更或通过补充协议处理。"))
    else:
        doc = frappe.new_doc("Procurement Contract")
        doc.company = company

    doc.contract_title = data.get("contract_title")
    doc.contract_type = data.get("contract_type") or "专项采购合同"
    doc.supplier = data.get("supplier")
    doc.total_contract_amount = flt(data.get("total_contract_amount"))
    doc.currency = data.get("currency") or "CNY"
    doc.effective_date = data.get("effective_date") or get_effective_work_date()
    doc.expiry_date = data.get("expiry_date")
    doc.remarks = data.get("remarks")

    # Payment milestones
    terms_input = data.get("payment_terms") or []
    if not terms_input:
        frappe.throw(_("请至少配置一个分期付款里程碑。"))

    doc.set("payment_terms", [])
    total_amt = doc.total_contract_amount

    for idx, t in enumerate(terms_input, 1):
        ratio = flt(t.get("payment_ratio"))
        amt = flt(t.get("term_amount")) or flt(total_amt * ratio / 100.0, 2)
        doc.append("payment_terms", {
            "idx": idx,
            "stage_name": t.get("stage_name") or f"第{idx}期款",
            "payment_ratio": ratio,
            "term_amount": amt,
            "planned_date": t.get("planned_date"),
            "term_status": "待发起",
            "remarks": t.get("remarks")
        })

    doc.flags.ignore_permissions = True
    doc.save()

    # If direct submit requested
    if data.get("submit_direct") or data.get("auto_submit"):
        doc.submit()

    return {
        "success": True,
        "contract_no": doc.name,
        "message": _("采购合同【{0}】保存成功！").format(doc.name)
    }


# =========================================================================
# 5. One-Click Generate Reimbursement / Settlement Request from Milestone
# =========================================================================

@frappe.whitelist(methods=["POST"])
def create_settlement_from_milestone(
    contract_no: str,
    term_idx: int,
    posting_date: str | None = None,
    invoice_no: str | None = None,
    invoice_type: str = "专用发票",
    custom_amount: float | str | None = None,
    custom_ratio: float | str | None = None,
    item_name: str | None = None,
    remarks: str | None = None,
    auto_submit: bool = True
) -> dict:
    """Generate a Reimbursement Request (电汇整算单) directly from a contract payment milestone with dynamic custom ratio."""
    if not contract_no or not frappe.db.exists("Procurement Contract", contract_no):
        frappe.throw(_("采购合同不存在。"))

    contract = frappe.get_doc("Procurement Contract", contract_no)
    assert_company_access(contract.company)

    if contract.docstatus != 1:
        frappe.throw(_("采购合同尚未生效提交，请先提交生效后再发起整算。"))

    term_idx = int(term_idx)
    matching_terms = [t for t in contract.payment_terms if t.idx == term_idx]
    if not matching_terms:
        frappe.throw(_("未找到第 {0} 期付款里程碑。").format(term_idx))
    term = matching_terms[0]

    if term.linked_reimbursement:
        frappe.throw(_("第 {0} 期款（{1}）已关联整算单【{2}】，请勿重复派生。").format(term_idx, term.stage_name, term.linked_reimbursement))

    work_date = posting_date or get_effective_work_date()
    full_term_amt = flt(term.term_amount)
    contract_total = flt(contract.total_contract_amount) or 1.0

    # Determine dynamic settlement amount
    settle_amt = full_term_amt
    eff_ratio = flt(term.payment_ratio)
    if custom_amount is not None and flt(custom_amount) > 0:
        settle_amt = flt(custom_amount, 2)
        eff_ratio = flt((settle_amt / contract_total) * 100.0, 2)
    elif custom_ratio is not None and flt(custom_ratio) > 0:
        eff_ratio = flt(custom_ratio, 2)
        settle_amt = flt(contract_total * (eff_ratio / 100.0), 2)

    eff_item_name = item_name or f"{contract.contract_title} - {term.stage_name}"
    eff_inv_no = invoice_no or f"HT-INV-{contract.name.replace('HT-', '')}-{term_idx:02d}"

    # Create Reimbursement Request
    rr = frappe.new_doc("Reimbursement Request")
    rr.title = f"【合同整算】{contract.contract_title} · {term.stage_name} ({eff_ratio:.1f}%)"
    rr.company = contract.company
    rr.posting_date = work_date
    rr.custom_contract = contract.name
    rr.custom_contract_stage = term.stage_name
    rr.remarks = remarks or f"依据采购合同【{contract.name}】第 {term_idx} 期（{term.stage_name} · 比例 {eff_ratio:.1f}%）派生电汇整算"

    from ashan_cn_procurement.services.reimbursement_picker_service import _ensure_uom, _ensure_item
    uom_val = _ensure_uom("项")
    spec_val = f"合同履约款 · 比例 {eff_ratio:.1f}%"
    _ensure_item(eff_item_name, uom_val, spec_val)

    # Add Invoice Item
    # Calculate tax if 专用发票 (assume 13% default if not specified, or 0% / 13%)
    rate_net = flt(settle_amt / 1.13, 2) if invoice_type == "专用发票" else settle_amt
    tax_amt = flt(settle_amt - rate_net, 2) if invoice_type == "专用发票" else 0.0

    rr.append("invoice_items", {
        "invoice_type": invoice_type,
        "invoice_no": eff_inv_no,
        "invoice_date": work_date,
        "supplier": contract.supplier,
        "item_name": eff_item_name,
        "spec": spec_val,
        "uom": uom_val,
        "qty": 1,
        "rate": rate_net,
        "amount": rate_net,
        "tax_rate": 13.0 if invoice_type == "专用发票" else 0.0,
        "tax_amount": tax_amt,
        "line_total": settle_amt,
        "remarks": f"合同【{contract.name}】{term.stage_name}"
    })

    rr.total_amount = settle_amt
    rr.outstanding_amount = settle_amt
    rr.flags.ignore_permissions = True
    rr.insert()

    if auto_submit:
        rr.submit()

    # Link milestone back to created RR
    term.linked_reimbursement = rr.name
    term.term_status = "整算中"
    contract.flags.ignore_permissions = True
    contract.save()
    contract.update_settlement_progress()
    contract.save()

    return {
        "success": True,
        "rr_name": rr.name,
        "contract_no": contract.name,
        "stage_name": term.stage_name,
        "amount": term_amt,
        "message": _("已成功根据合同第 {0} 期（{1} · 比例 {2}%）生成电汇整算单【{3}】！").format(term_idx, term.stage_name, term.payment_ratio, rr.name)
    }


# =========================================================================
# 6. Delete Draft Contract
# =========================================================================

@frappe.whitelist(methods=["POST"])
def delete_procurement_contract(contract_no: str) -> dict:
    """Delete a draft Procurement Contract."""
    if not contract_no or not contract_no.strip():
        frappe.throw(_("请指定合同编号。"))

    contract = frappe.get_doc("Procurement Contract", contract_no.strip())
    assert_company_access(contract.company)

    if contract.docstatus != 0:
        frappe.throw(_("只有草稿状态的合同才能被删除。"))

    frappe.delete_doc("Procurement Contract", contract.name, force=True, ignore_permissions=True)
    return {"success": True, "deleted": contract_no}
