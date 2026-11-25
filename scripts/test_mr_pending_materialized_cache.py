# -*- coding: utf-8 -*-
"""
End-to-End Test Suite for Material Request Pending Status Materialized Cache & Procurement APIs
Scenarios covered:
- Scenario A: Basic Lifecycle & Conversion Factor Materialization
- Scenario B: Partial Ordering & Full Ordering (Cache Decrement & Zeroing)
- Scenario C: Pending View Filtering & Anti-Spillover Verification
- Scenario D: Purchase Order Cancellation & Automatic Cache Rollback
- Scenario E: Boundaries & Defensive Guards (conversion_factor None/0, 0.0001 float tolerance, multi-company isolation)
- Scenario F: KPI Consistency (Overview KPIs vs Sidebar Notification KPIs vs Doc View)
- Teardown: Complete database cleanup without leaving artifacts.
"""

import os
import sys
import time
import json
from pathlib import Path

# Add project root
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))
import scripts.sync_and_migrate as s

REMOTE_SUITE_CODE = r'''
import sys
import time
import json
import traceback
import frappe
from frappe.utils import flt, cint, nowdate

frappe.init('site1.local')
frappe.connect()

# Set current user to Administrator
frappe.set_user("Administrator")

results = {
    "total": 0,
    "passed": 0,
    "failed": 0,
    "details": [],
    "start_time": time.time(),
    "end_time": None,
    "duration_s": 0.0
}

def record_test(name, passed, message="", data=None):
    results["total"] += 1
    if passed:
        results["passed"] += 1
        status = "PASS"
    else:
        results["failed"] += 1
        status = "FAIL"
    entry = {"name": name, "status": status, "message": message, "data": data or {}}
    results["details"].append(entry)
    print(f"[{status}] {name}: {message}")

created_docs = []

def safe_cleanup():
    print("\n--- Starting Teardown & Database Cleanup ---")
    # Clean up in reverse creation order: POs first, then MRs
    for dt, dn in reversed(created_docs):
        try:
            if frappe.db.exists(dt, dn):
                docstatus = frappe.db.get_value(dt, dn, "docstatus")
                if docstatus == 1:
                    doc = frappe.get_doc(dt, dn)
                    doc.cancel()
                frappe.delete_doc(dt, dn, force=True)
                print(f"Cleaned up {dt} {dn}")
        except Exception as e:
            print(f"Warning: Failed to clean up {dt} {dn}: {e}")
    # AI-GOVERNANCE-EXCEPTION: E2E test suite teardown requires commit to persist cleanup
    frappe.db.commit()

try:
    from ashan_cn_procurement.services.procurement_picker_service import (
        compute_mr_pending_cache,
        get_pending_material_request_docs,
        get_pending_material_request_items,
        make_purchase_orders_from_mr_items,
        get_procurement_picker_overview_kpis,
        get_sidebar_notification_kpis,
    )

    company_qifu = "天津祺富机械加工有限公司"
    company_jizhong = "天津吉众科技有限公司"
    wh_qifu = "仓库 - 祺富"
    wh_jizhong = "仓库 - 吉众"
    supplier = "圣凯（天津）工业有限公司"

    # Find two standard items
    item1 = "WL-00006" # 内六角扳手
    item2 = "WL-00001" # 扁锉
    item_uom1 = frappe.db.get_value("Item", item1, "stock_uom") or "支"
    item_uom2 = frappe.db.get_value("Item", item2, "stock_uom") or "个"

    # =========================================================================
    # SCENARIO A: 基础生命周期与转换率物化核验
    # =========================================================================
    print("\n=== Running Scenario A: Basic Lifecycle & Conversion Factor ===")
    
    # Create Material Request with 2 items:
    # Item 1: conversion_factor = 0.01 (100支 = 1包), stock_qty = 1 (1包), qty = 100 (100支)
    # Item 2: conversion_factor = 1.0 (50个), stock_qty = 50, qty = 50
    mr = frappe.new_doc("Material Request")
    mr.material_request_type = "Purchase"
    mr.company = company_qifu
    mr.transaction_date = nowdate()
    mr.schedule_date = nowdate()

    mr.append("items", {
        "item_code": item1,
        "item_name": "内六角扳手",
        "qty": 100,
        "uom": item_uom1,
        "conversion_factor": 0.01,
        "stock_uom": "包",
        "warehouse": wh_qifu,
        "schedule_date": nowdate(),
        "rate": 2.50
    })
    mr.append("items", {
        "item_code": item2,
        "item_name": "扁锉",
        "qty": 50,
        "uom": item_uom2,
        "conversion_factor": 1.0,
        "stock_uom": item_uom2,
        "warehouse": wh_qifu,
        "schedule_date": nowdate(),
        "rate": 10.00
    })
    mr.insert()
    created_docs.append(("Material Request", mr.name))
    mr.submit()

    # Reload from DB and verify materialized cache fields
    mr.reload()
    c_count = mr.custom_pending_item_count
    c_qty = flt(mr.custom_pending_qty_total, 2)
    
    # Expected: 2 pending items, total pending qty in business uom = 100 + 50 = 150.00
    record_test(
        "A1_MR_Submission_Pending_Count",
        c_count == 2,
        f"custom_pending_item_count={c_count}, expected=2",
        {"actual": c_count, "expected": 2}
    )
    record_test(
        "A2_MR_Submission_Pending_Qty",
        c_qty == 150.00,
        f"custom_pending_qty_total={c_qty}, expected=150.00",
        {"actual": c_qty, "expected": 150.00}
    )
    record_test(
        "A3_MR_Doc_Details_Generated",
        bool(mr.custom_doc_details and "内六角扳手" in mr.custom_doc_details and "扁锉" in mr.custom_doc_details),
        f"custom_doc_details='{mr.custom_doc_details}'"
    )
    record_test(
        "A4_MR_Pending_Doc_Details_Initial",
        bool(mr.custom_pending_doc_details and "内六角扳手 (100支)" in mr.custom_pending_doc_details and "扁锉 (50个)" in mr.custom_pending_doc_details),
        f"custom_pending_doc_details='{mr.custom_pending_doc_details}'"
    )

    # =========================================================================
    # SCENARIO B: 部分订货与足额订货（物化缓存递减与归零）
    # =========================================================================
    print("\n=== Running Scenario B: Partial Ordering & Full Ordering ===")
    
    # Retrieve mri names
    mri1 = mr.items[0].name
    mri2 = mr.items[1].name

    # Step B1: Partial order:
    # Order 40支 of item1 (leaving 60支 pending)
    # Order 50个 of item2 (fully ordered, leaving 0 pending)
    order_items_step1 = [
        {"mri_name": mri1, "this_qty": 40.0, "rate": 2.50, "supplier": supplier},
        {"mri_name": mri2, "this_qty": 50.0, "rate": 10.00, "supplier": supplier}
    ]
    res_b1 = make_purchase_orders_from_mr_items(
        company=company_qifu,
        selected_items=order_items_step1,
        supplier_override=supplier,
        submit_doc=1
    )
    po1_name = res_b1["orders"][0]["name"]
    created_docs.append(("Purchase Order", po1_name))

    mr.reload()
    b1_count = mr.custom_pending_item_count
    b1_qty = flt(mr.custom_pending_qty_total, 2)

    # After step 1: item2 is completely ordered (rem=0). Item1 has 60支 remaining.
    record_test(
        "B1_Partial_Order_Pending_Count",
        b1_count == 1,
        f"custom_pending_item_count={b1_count}, expected=1",
        {"actual": b1_count, "expected": 1}
    )
    record_test(
        "B2_Partial_Order_Pending_Qty",
        b1_qty == 60.00,
        f"custom_pending_qty_total={b1_qty}, expected=60.00",
        {"actual": b1_qty, "expected": 60.00}
    )
    record_test(
        "B2_2_Partial_Order_Pending_Doc_Details",
        bool(mr.custom_pending_doc_details and "内六角扳手 (60支)" in mr.custom_pending_doc_details and "扁锉" not in mr.custom_pending_doc_details),
        f"custom_pending_doc_details='{mr.custom_pending_doc_details}'"
    )

    # Step B2: Full order of remaining qty:
    # Order remaining 60支 of item1
    order_items_step2 = [
        {"mri_name": mri1, "this_qty": 60.0, "rate": 2.50, "supplier": supplier}
    ]
    res_b2 = make_purchase_orders_from_mr_items(
        company=company_qifu,
        selected_items=order_items_step2,
        supplier_override=supplier,
        submit_doc=1
    )
    po2_name = res_b2["orders"][0]["name"]
    created_docs.append(("Purchase Order", po2_name))

    mr.reload()
    b2_count = mr.custom_pending_item_count
    b2_qty = flt(mr.custom_pending_qty_total, 2)

    # After step 2: all items ordered. Pending count must be 0, qty must be 0.00.
    record_test(
        "B3_Full_Order_Pending_Count_Zero",
        b2_count == 0,
        f"custom_pending_item_count={b2_count}, expected=0",
        {"actual": b2_count, "expected": 0}
    )
    record_test(
        "B4_Full_Order_Pending_Qty_Zero",
        b2_qty == 0.00,
        f"custom_pending_qty_total={b2_qty}, expected=0.00",
        {"actual": b2_qty, "expected": 0.00}
    )
    record_test(
        "B5_Full_Order_Pending_Doc_Details_Empty",
        mr.custom_pending_doc_details == "",
        f"custom_pending_doc_details='{mr.custom_pending_doc_details}', expected empty string"
    )

    # =========================================================================
    # SCENARIO C: 待采视图过滤与防倒灌 (Anti-Spillover & O(1) Index Exclusion)
    # =========================================================================
    print("\n=== Running Scenario C: View Filtering & Anti-Spillover ===")

    # When match_status='pending', mr.name must NOT appear in pending list because custom_pending_item_count == 0!
    pending_docs_resp = get_pending_material_request_docs(
        company=company_qifu,
        filters={"match_status": "pending", "mr_names": [mr.name]}
    )
    pending_mr_names = [d["mr_name"] for d in pending_docs_resp.get("rows", [])]

    record_test(
        "C1_Fully_Ordered_Excluded_From_Pending_View",
        mr.name not in pending_mr_names,
        f"MR {mr.name} excluded from pending view. Found: {mr.name in pending_mr_names}"
    )

    # When match_status='linked', mr.name SHOULD appear with linked POs
    linked_docs_resp = get_pending_material_request_docs(
        company=company_qifu,
        filters={"match_status": "linked", "mr_names": [mr.name]}
    )
    linked_mr_names = [d["mr_name"] for d in linked_docs_resp.get("rows", [])]
    record_test(
        "C2_Fully_Ordered_Appears_In_Linked_View",
        mr.name in linked_mr_names,
        f"MR {mr.name} correctly indexed in linked view. Found: {mr.name in linked_mr_names}"
    )

    if mr.name in linked_mr_names:
        matched_row = next(r for r in linked_docs_resp["rows"] if r["mr_name"] == mr.name)
        linked_pos = matched_row.get("linked_po_names", "")
        has_both_pos = (po1_name in linked_pos) and (po2_name in linked_pos)
        record_test(
            "C3_Linked_View_Contains_Both_POs",
            has_both_pos,
            f"linked_po_names contains {po1_name} and {po2_name}: '{linked_pos}'"
        )

    # =========================================================================
    # SCENARIO D: 采购订单作废回滚 (PO Cancellation & Automatic Rollback)
    # =========================================================================
    print("\n=== Running Scenario D: PO Cancellation & Automatic Rollback ===")

    # Step D1: Cancel PO2 (which had 60支 of item1)
    po2_doc = frappe.get_doc("Purchase Order", po2_name)
    po2_doc.cancel()

    mr.reload()
    d1_count = mr.custom_pending_item_count
    d1_qty = flt(mr.custom_pending_qty_total, 2)

    record_test(
        "D1_PO2_Cancel_Rolls_Back_Count",
        d1_count == 1,
        f"After PO2 cancel: custom_pending_item_count={d1_count}, expected=1",
        {"actual": d1_count, "expected": 1}
    )
    record_test(
        "D2_PO2_Cancel_Rolls_Back_Qty",
        d1_qty == 60.00,
        f"After PO2 cancel: custom_pending_qty_total={d1_qty}, expected=60.00",
        {"actual": d1_qty, "expected": 60.00}
    )
    record_test(
        "D2_2_PO2_Cancel_Pending_Doc_Details",
        bool(mr.custom_pending_doc_details and "内六角扳手 (60支)" in mr.custom_pending_doc_details and "扁锉" not in mr.custom_pending_doc_details),
        f"After PO2 cancel: custom_pending_doc_details='{mr.custom_pending_doc_details}'"
    )

    # Step D2: Cancel PO1 (which had 40支 of item1 and 50个 of item2)
    po1_doc = frappe.get_doc("Purchase Order", po1_name)
    po1_doc.cancel()

    mr.reload()
    d2_count = mr.custom_pending_item_count
    d2_qty = flt(mr.custom_pending_qty_total, 2)

    record_test(
        "D3_PO1_Cancel_Rolls_Back_All_Counts",
        d2_count == 2,
        f"After PO1 cancel: custom_pending_item_count={d2_count}, expected=2",
        {"actual": d2_count, "expected": 2}
    )
    record_test(
        "D4_PO1_Cancel_Rolls_Back_All_Qty",
        d2_qty == 150.00,
        f"After PO1 cancel: custom_pending_qty_total={d2_qty}, expected=150.00",
        {"actual": d2_qty, "expected": 150.00}
    )
    record_test(
        "D5_PO1_Cancel_Pending_Doc_Details_Restored",
        bool(mr.custom_pending_doc_details and "内六角扳手 (100支)" in mr.custom_pending_doc_details and "扁锉 (50个)" in mr.custom_pending_doc_details),
        f"After PO1 cancel: custom_pending_doc_details='{mr.custom_pending_doc_details}'"
    )

    # Verify that MR is immediately visible in pending view again!
    pending_again_resp = get_pending_material_request_docs(
        company=company_qifu,
        filters={"match_status": "pending", "mr_names": [mr.name]}
    )
    reappeared_names = [d["mr_name"] for d in pending_again_resp.get("rows", [])]
    record_test(
        "D6_MR_Reappears_In_Pending_View",
        mr.name in reappeared_names,
        f"MR {mr.name} reappeared in pending view after rollback"
    )

    # =========================================================================
    # SCENARIO E: 边界与防御 (Defensive Guards & Edge Cases)
    # =========================================================================
    print("\n=== Running Scenario E: Defensive Guards & Edge Cases ===")

    # E1: Conversion factor = 0 and None
    mr_edge = frappe.new_doc("Material Request")
    mr_edge.material_request_type = "Purchase"
    mr_edge.company = company_qifu
    mr_edge.transaction_date = nowdate()
    mr_edge.schedule_date = nowdate()
    mr_edge.append("items", {
        "item_code": item1,
        "qty": 10,
        "uom": item_uom1,
        "conversion_factor": 1.0,
        "warehouse": wh_qifu,
        "rate": 2.50
    })
    mr_edge.insert()
    created_docs.append(("Material Request", mr_edge.name))

    # Force conversion_factor to 0 directly in DB to simulate corrupt data
    frappe.db.sql("UPDATE `tabMaterial Request Item` SET conversion_factor = 0 WHERE parent = %s", (mr_edge.name,))
    cache_e1 = compute_mr_pending_cache(mr_edge.name)
    record_test(
        "E1_Conversion_Factor_Zero_Safe",
        cache_e1.get("pending_item_count") == 1 and flt(cache_e1.get("pending_qty_total")) == 10.00,
        f"Zero conversion_factor handled safely: {cache_e1}"
    )

    # Test Python update_doc_details when conversion_factor is None
    from ashan_cn_procurement.overrides.document_details import update_doc_details
    mr_test_cf = frappe.new_doc("Material Request")
    mr_test_cf.doctype = "Material Request"
    mr_test_cf.append("items", {
        "item_code": item1,
        "qty": 25,
        "stock_qty": 25,
        "ordered_qty": 0,
        "conversion_factor": None
    })
    update_doc_details(mr_test_cf)
    record_test(
        "E2_Conversion_Factor_None_Safe",
        mr_test_cf.custom_pending_item_count == 1 and flt(mr_test_cf.custom_pending_qty_total) == 25.00,
        f"None conversion_factor handled safely in update_doc_details: count={mr_test_cf.custom_pending_item_count}, qty={mr_test_cf.custom_pending_qty_total}"
    )

    # E3: Micro floating point tolerance test: diff <= 0.0001 must be counted as 0 pending
    frappe.db.sql("""
        UPDATE `tabMaterial Request Item`
        SET stock_qty = 10.00005, ordered_qty = 10.0, conversion_factor = 1.0
        WHERE parent = %s
    """, (mr_edge.name,))
    cache_e3 = compute_mr_pending_cache(mr_edge.name)
    record_test(
        "E3_Micro_Float_Tolerance_Zeroed",
        cache_e3.get("pending_item_count") == 0 and flt(cache_e3.get("pending_qty_total")) == 0.0,
        f"0.00005 float diff zeroed out: {cache_e3}",
        cache_e3
    )

    # E4: Multi-company isolation
    mr_jz = frappe.new_doc("Material Request")
    mr_jz.material_request_type = "Purchase"
    mr_jz.company = company_jizhong
    mr_jz.transaction_date = nowdate()
    mr_jz.schedule_date = nowdate()
    mr_jz.append("items", {
        "item_code": item1,
        "qty": 20,
        "uom": item_uom1,
        "conversion_factor": 1.0,
        "warehouse": wh_jizhong,
        "rate": 2.50
    })
    mr_jz.insert()
    created_docs.append(("Material Request", mr_jz.name))
    mr_jz.submit()

    # Query for company_qifu should NEVER return mr_jz!
    qifu_res = get_pending_material_request_docs(
        company=company_qifu,
        filters={"match_status": "pending"}
    )
    qifu_returned = [d["mr_name"] for d in qifu_res.get("rows", [])]
    record_test(
        "E4_Multi_Company_Isolation_Qifu",
        mr_jz.name not in qifu_returned,
        f"Jizhong MR {mr_jz.name} isolated from Qifu query. Present: {mr_jz.name in qifu_returned}"
    )

    # Query for company_jizhong SHOULD return mr_jz!
    jz_res = get_pending_material_request_docs(
        company=company_jizhong,
        filters={"match_status": "pending", "mr_names": [mr_jz.name]}
    )
    jz_returned = [d["mr_name"] for d in jz_res.get("rows", [])]
    record_test(
        "E5_Multi_Company_Isolation_Jizhong",
        mr_jz.name in jz_returned,
        f"Jizhong MR {mr_jz.name} found in Jizhong query. Present: {mr_jz.name in jz_returned}"
    )

    # =========================================================================
    # SCENARIO F: KPI 统计一致性 (KPI Count vs Doc View Count)
    # =========================================================================
    print("\n=== Running Scenario F: KPI Consistency ===")

    # Get overview KPI for mr_to_po
    overview_kpis_qifu = get_procurement_picker_overview_kpis(company=company_qifu, workbench="execution")
    overview_mr_count = overview_kpis_qifu.get("kpis", {}).get("mr_to_po", {}).get("count", 0)

    # Get sidebar KPI for procurement-execution-workbench
    sidebar_kpis_qifu = get_sidebar_notification_kpis(company=company_qifu)
    sidebar_mr_count = sidebar_kpis_qifu.get("procurement-execution-workbench", 0)

    # Get total count of pending MRs from get_pending_material_request_docs
    all_pending_docs = get_pending_material_request_docs(company=company_qifu, filters={"match_status": "pending"})
    doc_view_count = all_pending_docs.get("count", len(all_pending_docs.get("rows", [])))

    record_test(
        "F1_Overview_KPI_Matches_Sidebar_KPI",
        overview_mr_count == sidebar_mr_count,
        f"Overview KPI ({overview_mr_count}) == Sidebar KPI ({sidebar_mr_count})"
    )
    record_test(
        "F2_KPI_Matches_Doc_View_Count",
        overview_mr_count == doc_view_count,
        f"Overview KPI ({overview_mr_count}) == Doc View Row Count ({doc_view_count})"
    )

except Exception as ex:
    print(f"\nFATAL EXCEPTION DURING TEST EXECUTION: {ex}")
    traceback.print_exc()
    results["failed"] += 1
    results["details"].append({"name": "Fatal_Exception", "status": "FAIL", "message": str(ex)})

finally:
    safe_cleanup()
    results["end_time"] = time.time()
    results["duration_s"] = round(results["end_time"] - results["start_time"], 2)
    print("\n=== Test Suite Complete ===")
    print(f"Total: {results['total']}, Passed: {results['passed']}, Failed: {results['failed']}, Duration: {results['duration_s']}s")
    print("__JSON_START__" + json.dumps(results) + "__JSON_END__")
'''

def main():
    print("[RUNNER] Connecting to Unraid host via SSH...")
    c = s.connect_ssh()
    print("[RUNNER] Launching Remote End-to-End Test Suite...")
    cmd = "docker exec -i -u frappe -w /home/frappe/frappe-bench/sites erpnext16 /home/frappe/frappe-bench/env/bin/python"
    stdin, stdout, stderr = c.exec_command(cmd)
    stdin.write(REMOTE_SUITE_CODE)
    stdin.channel.shutdown_write()

    out = stdout.read().decode('utf-8', errors='replace')
    err = stderr.read().decode('utf-8', errors='replace')
    code = stdout.channel.recv_exit_status()

    print("\n" + "=" * 60)
    print("REMOTE TEST OUTPUT:")
    print("=" * 60)
    print(out)
    if err.strip():
        print("REMOTE ERRORS / WARNINGS:")
        print(err)
    print(f"EXIT CODE: {code}")

    if "__JSON_START__" in out and "__JSON_END__" in out:
        json_str = out.split("__JSON_START__")[1].split("__JSON_END__")[0]
        parsed = json.loads(json_str)
        print("\n" + "=" * 60)
        print("STRUCTURED SUMMARY:")
        print(f"Total Tests : {parsed['total']}")
        print(f"Passed      : {parsed['passed']}")
        print(f"Failed      : {parsed['failed']}")
        print(f"Duration    : {parsed['duration_s']}s")
        print("=" * 60)
        if parsed['failed'] > 0:
            sys.exit(1)
    else:
        if code != 0:
            sys.exit(code)

if __name__ == "__main__":
    main()
