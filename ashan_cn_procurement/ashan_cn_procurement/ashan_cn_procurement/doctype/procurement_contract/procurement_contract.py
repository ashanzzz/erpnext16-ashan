# Copyright (c) 2026, Ashan and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt


class ProcurementContract(Document):
    def validate(self):
        self.validate_payment_terms()
        self.update_settlement_progress()

    def validate_payment_terms(self):
        if not self.payment_terms:
            frappe.throw(_("请至少配置一个分期付款里程碑节点。"))

        total_amt = flt(self.total_contract_amount)
        if total_amt <= 0:
            frappe.throw(_("合同总金额必须大于 0。"))

        ratio_sum = 0.0
        calc_amt_sum = 0.0

        for term in self.payment_terms:
            ratio = flt(term.payment_ratio)
            if ratio <= 0:
                frappe.throw(_("分期【{0}】的付款比例必须大于 0%").format(term.stage_name or ""))
            ratio_sum += ratio

            if not term.term_amount or flt(term.term_amount) <= 0:
                term.term_amount = flt(total_amt * (ratio / 100.0), 2)
            calc_amt_sum += flt(term.term_amount)

        if abs(ratio_sum - 100.0) > 0.05:
            frappe.throw(_("各分期付款比例合计必须为 100%（当前合计为 {0:.2f}%）。").format(ratio_sum))

    def update_settlement_progress(self):
        total_amt = flt(self.total_contract_amount)
        settled_amt = 0.0
        paid_amt = 0.0

        for term in self.payment_terms:
            # If term is linked to a Reimbursement Request
            if term.linked_reimbursement and frappe.db.exists("Reimbursement Request", term.linked_reimbursement):
                rr = frappe.get_doc("Reimbursement Request", term.linked_reimbursement)
                rr_total = flt(rr.total_amount)
                rr_out = flt(rr.outstanding_amount)
                rr_paid = flt(rr.get("custom_paid_amount", 0)) or max(0.0, flt(rr_total - rr_out))

                settled_amt += rr_total
                paid_amt += rr_paid

                term.paid_amount = rr_paid
                term.outstanding_amount = max(0.0, flt(term.term_amount - rr_paid))
                if term.outstanding_amount <= 0.01:
                    term.term_status = "已付清"
                else:
                    term.term_status = "整算中"

        self.total_settled_amount = flt(settled_amt, 2)
        self.total_paid_amount = flt(paid_amt, 2)
        self.outstanding_amount = max(0.0, flt(total_amt - paid_amt, 2))
        self.completion_ratio = flt((paid_amt / total_amt * 100.0), 1) if total_amt > 0 else 0.0

        if self.docstatus == 1:
            if self.outstanding_amount <= 0.01 and self.total_paid_amount > 0:
                self.status = "已结清"
            else:
                self.status = "履约中"
        elif self.docstatus == 0:
            self.status = "草稿"

    def on_submit(self):
        self.status = "履约中"
        self.update_settlement_progress()

    def on_cancel(self):
        self.status = "已终止"
