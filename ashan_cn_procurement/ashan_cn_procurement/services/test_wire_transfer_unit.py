# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import sys
import frappe
from frappe.utils import nowdate
from ashan_cn_procurement.services.wire_transfer_service import (
    create_self_service_wire_transfer_bundle,
    get_wire_transfer_picker_rows,
    get_wire_transfer_doc_summary_rows,
    issue_all_wire_transfer_stock,
    get_wire_transfer_overview_kpis,
)

def run_all_tests():
    company = "天津吉众科技有限公司"
    # Find a valid stock item
    items = frappe.get_all("Item", filters={"is_stock_item": 1}, fields=["name", "item_name", "stock_uom"], limit=1)
    if not items:
        print("NO STOCK ITEM FOUND")
        sys.exit(1)

    item_code = items[0].name
    supplier = frappe.get_all("Supplier", limit=1)[0].name
    bill_no = f"TEST-WT-{frappe.generate_hash(length=6)}"

    print(f"Creating wire transfer bundle with Item: {item_code}, Supplier: {supplier}, Bill: {bill_no}...")

    res = create_self_service_wire_transfer_bundle(
        company=company,
        supplier=supplier,
        bill_no=bill_no,
        bill_date=nowdate(),
        invoice_type="专用发票",
        auto_receive_stock=1,
        auto_issue_stock=1,
        create_reimbursement_request=1,
        items=[{
            "item_code": item_code,
            "qty": 2,
            "rate": 100,
            "tax_rate": 13,
            "amount": 200,
            "tax_amount": 26,
            "total_amount": 226,
            "remarks": "自动化测试自办电汇即入即出",
        }]
    )

    print("BUNDLE RESULT:", res)
    assert res["success"] is True, "Bundle creation failed"
    assert res["pr_name"] is not None, "PR name should exist"
    assert res["pi_name"] is not None, "PI name should exist"
    assert res["se_name"] is not None, "SE name should exist"
    assert res["rr_name"] is not None, "RR name should exist"
    assert "po_name" not in res, "PO should NOT be created!"

    # Verify in DB: check Purchase Invoice has no purchase_order
    pi_doc = frappe.get_doc("Purchase Invoice", res["pi_name"])
    for item in pi_doc.items:
        assert not item.purchase_order, f"PO field should be empty on PI item, got {item.purchase_order}"

    # Verify Stock Entry
    se_doc = frappe.get_doc("Stock Entry", res["se_name"])
    assert se_doc.purpose == "Material Issue", f"Stock Entry purpose should be Material Issue, got {se_doc.purpose}"
    assert se_doc.docstatus == 1, "Stock Entry should be submitted"

    # Test Query Rows (Detail View)
    detail_res = get_wire_transfer_picker_rows(company=company, filters={"bill_no": bill_no})
    print("DETAIL ROWS COUNT:", len(detail_res["rows"]))
    assert len(detail_res["rows"]) >= 1, "Should find at least 1 detail row"
    row = detail_res["rows"][0]
    print("ROW LINKED COLUMNS:", {
        "linked_pr_names": row["linked_pr_names"],
        "linked_se_names": row["linked_se_names"],
        "linked_rr_names": row["linked_rr_names"],
    })
    assert res["pr_name"] in row["linked_pr_names"], "PR name should be in linked_pr_names"
    assert res["se_name"] in row["linked_se_names"], "SE name should be in linked_se_names"
    assert res["rr_name"] in row["linked_rr_names"], "RR name should be in linked_rr_names"

    # Test Doc Summary Rows (Doc View)
    doc_res = get_wire_transfer_doc_summary_rows(company=company, filters={"bill_no": bill_no})
    print("DOC ROWS COUNT:", len(doc_res["rows"]))
    assert len(doc_res["rows"]) >= 1, "Should find at least 1 doc row"
    doc_row = doc_res["rows"][0]
    print("DOC ROW LINKED COLUMNS:", {
        "linked_pr_names": doc_row["linked_pr_names"],
        "linked_se_names": doc_row["linked_se_names"],
        "linked_rr_names": doc_row["linked_rr_names"],
    })
    assert res["pr_name"] in doc_row["linked_pr_names"], "PR name should be in linked_pr_names"
    assert res["se_name"] in doc_row["linked_se_names"], "SE name should be in linked_se_names"
    assert res["rr_name"] in doc_row["linked_rr_names"], "RR name should be in linked_rr_names"

    # Test Scenario 2: Create bundle with auto_issue_stock=0, then trigger issue_all_wire_transfer_stock
    bill_no_2 = f"TEST-WT2-{frappe.generate_hash(length=6)}"
    print(f"Creating wire transfer bundle 2 without auto-issue: Bill: {bill_no_2}...")
    res2 = create_self_service_wire_transfer_bundle(
        company=company,
        supplier=supplier,
        bill_no=bill_no_2,
        bill_date=nowdate(),
        invoice_type="普通发票",
        auto_receive_stock=1,
        auto_issue_stock=0,
        create_reimbursement_request=0,
        items=[{
            "item_code": item_code,
            "qty": 3,
            "rate": 50,
            "tax_rate": 13,
            "amount": 150,
            "tax_amount": 19.5,
            "total_amount": 169.5,
            "remarks": "测试暂不出库，后续一键全部出库",
        }]
    )
    assert res2["se_name"] is None, "SE should not be created when auto_issue_stock=0"
    assert res2["rr_name"] is None, "RR should not be created when create_reimbursement_request=0"

    print(f"Triggering issue_all_wire_transfer_stock for {res2['pi_name']}...")
    batch_res = issue_all_wire_transfer_stock([res2["pi_name"]])
    print("BATCH ISSUE RESULT:", batch_res)
    assert batch_res["success"] is True, "Batch issue failed"
    assert batch_res["issued_count"] == 1, "Should have created 1 Stock Entry"
    assert len(batch_res["created_rrs"]) == 1, "Should have created 1 Reimbursement Request"

    # Query row again to check that SE and RR are now linked
    detail_res2 = get_wire_transfer_picker_rows(company=company, filters={"bill_no": bill_no_2})
    row2 = detail_res2["rows"][0]
    print("ROW2 LINKED COLUMNS AFTER BATCH ISSUE:", {
        "linked_pr_names": row2["linked_pr_names"],
        "linked_se_names": row2["linked_se_names"],
        "linked_rr_names": row2["linked_rr_names"],
    })
    assert row2["linked_se_names"] != "-", "SE should now be linked"
    assert row2["linked_rr_names"] != "-", "RR should now be linked"

    print("=== ALL BACKEND UNIT CHECKS & BATCH ISSUE PASSED 100%! ===")
    return True
