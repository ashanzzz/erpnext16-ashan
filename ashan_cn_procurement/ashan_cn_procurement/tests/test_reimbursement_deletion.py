# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import json
import frappe
from ashan_cn_procurement.services.reimbursement_picker_service import (
    create_manual_multi_invoice_reimbursement,
    delete_reimbursement_bundle,
    batch_delete_reimbursements,
)


def run_all_tests():
    frappe.set_user("Administrator")
    print("=== Running Reimbursement Deletion Suite ===")
    company = frappe.get_all("Company", fields=["name"], order_by="name asc")[0].name
    print(f"Target company: {company}")

    # Test 1: Draft Creation and Single Deletion
    print("Test 1: Create and delete single draft...")
    res1 = create_manual_multi_invoice_reimbursement(
        company=company,
        posting_date="2026-09-09",
        title="测试报销-草稿删除",
        auto_receive_stock=0,
        is_draft=1,
        invoices=json.dumps([{
            "invoice_type": "普通发票",
            "supplier": "测试供应商Del1",
            "invoice_no": "TEST-DEL-INV-001",
            "items": [{
                "item_code": "测试物料A",
                "item_name": "测试物料A",
                "qty": 2,
                "rate": 50,
                "amount": 100,
                "tax_rate": 1,
                "tax_amount": 1,
                "line_total": 101,
                "remarks": "草稿删除测试"
            }]
        }])
    )
    rr1 = res1["rr_name"]
    assert frappe.db.exists("Reimbursement Request", rr1), f"{rr1} should exist"
    del1 = delete_reimbursement_bundle(rr1)
    assert del1.get("success") is True, "Delete draft bundle should succeed"
    assert not frappe.db.exists("Reimbursement Request", rr1), f"{rr1} should be deleted"
    print("  -> Test 1 Passed!")

    # Test 2: Batch Delete Multiple Drafts
    print("Test 2: Batch delete multiple drafts...")
    r_a = create_manual_multi_invoice_reimbursement(
        company=company,
        posting_date="2026-09-09",
        title="测试批量-A",
        auto_receive_stock=0,
        is_draft=1,
        invoices=json.dumps([{
            "invoice_type": "无发票",
            "supplier": "测试供应商BatchA",
            "invoice_no": "",
            "items": [{
                "item_code": "测试物料B",
                "item_name": "测试物料B",
                "qty": 1,
                "rate": 20,
                "amount": 20,
                "remarks": "批量A"
            }]
        }])
    )
    r_b = create_manual_multi_invoice_reimbursement(
        company=company,
        posting_date="2026-09-09",
        title="测试批量-B",
        auto_receive_stock=0,
        is_draft=1,
        invoices=json.dumps([{
            "invoice_type": "无发票",
            "supplier": "测试供应商BatchB",
            "invoice_no": "",
            "items": [{
                "item_code": "测试物料C",
                "item_name": "测试物料C",
                "qty": 1,
                "rate": 40,
                "amount": 40,
                "remarks": "批量B"
            }]
        }])
    )
    rr_a = r_a["rr_name"]
    rr_b = r_b["rr_name"]
    batch_res = batch_delete_reimbursements([rr_a, rr_b])
    assert batch_res.get("success") is True, "Batch delete should succeed"
    assert batch_res.get("count") == 2, "Batch delete count should be 2"
    assert not frappe.db.exists("Reimbursement Request", rr_a), f"{rr_a} should be deleted"
    assert not frappe.db.exists("Reimbursement Request", rr_b), f"{rr_b} should be deleted"
    print("  -> Test 2 Passed!")

    # Test 3: Submitted Unpaid Document Cancellation & Deletion
    print("Test 3: Delete submitted unpaid reimbursement document...")
    res3 = create_manual_multi_invoice_reimbursement(
        company=company,
        posting_date="2026-09-09",
        title="测试已提交报销-作废删除",
        auto_receive_stock=0,
        is_draft=0,
        invoices=json.dumps([{
            "invoice_type": "普通发票",
            "supplier": "测试供应商Del3",
            "invoice_no": "TEST-DEL-INV-003",
            "items": [{
                "item_code": "测试物料D",
                "item_name": "测试物料D",
                "qty": 1,
                "rate": 120,
                "amount": 120,
                "tax_rate": 1,
                "tax_amount": 1.2,
                "line_total": 121.2,
                "remarks": "已提交作废删除测试"
            }]
        }])
    )
    rr3 = res3["rr_name"]
    assert frappe.db.get_value("Reimbursement Request", rr3, "docstatus") == 1, "Should be submitted"
    del3 = delete_reimbursement_bundle(rr3)
    assert del3.get("success") is True, "Delete submitted bundle should succeed"
    assert not frappe.db.exists("Reimbursement Request", rr3), f"{rr3} should be deleted"
    print("  -> Test 3 Passed!")

    # Test 4: Financial Safety Check - Paid Document Cannot Be Deleted
    print("Test 4: Financial Safety - Block deletion of paid document...")
    res4 = create_manual_multi_invoice_reimbursement(
        company=company,
        posting_date="2026-09-09",
        title="测试已付款单据防误删",
        auto_receive_stock=0,
        is_draft=0,
        invoices=json.dumps([{
            "invoice_type": "普通发票",
            "supplier": "测试供应商Del4",
            "invoice_no": "TEST-DEL-INV-004",
            "items": [{
                "item_code": "测试物料E",
                "item_name": "测试物料E",
                "qty": 1,
                "rate": 200,
                "amount": 200,
                "tax_rate": 1,
                "tax_amount": 2,
                "line_total": 202,
                "remarks": "已付款防删测试"
            }]
        }])
    )
    rr4 = res4["rr_name"]
    # Mark paid_amount > 0 to simulate paid state
    frappe.db.set_value("Reimbursement Request", rr4, "paid_amount", 100.0)
    frappe.db.set_value("Reimbursement Request", rr4, "outstanding_amount", 102.0)

    blocked = False
    try:
        delete_reimbursement_bundle(rr4)
    except Exception as ex:
        blocked = True
        print(f"  -> Successfully caught expected exception: {ex}")

    assert blocked, "Deleting paid reimbursement request MUST be blocked!"

    # Restore unpaid state and delete cleanly
    frappe.db.set_value("Reimbursement Request", rr4, "paid_amount", 0.0)
    frappe.db.set_value("Reimbursement Request", rr4, "outstanding_amount", 202.0)
    del4 = delete_reimbursement_bundle(rr4)
    assert del4.get("success") is True
    print("  -> Test 4 Passed!")

    print("=== All 4 Reimbursement Deletion Tests Passed Successfully! ===")
    return "All tests passed"
