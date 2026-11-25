# -*- coding: utf-8 -*-
"""
End-to-End Test Suite for Free Items & Zero-Price Purchase Order Rate Backfill from Purchase Receipt.
Scenarios covered:
- Scenario 1: Free Item (is_free_item=1) PO creation and PR receipt without price check (rate=0 allowed)
- Scenario 2: Non-free item with rate=0 PO creation allowed (temporary pricing)
- Scenario 3: Non-free item with rate=0 PR receipt blocked if rate remains 0 (forced actual price entry)
- Scenario 4: Non-free item with actual rate > 0 PR receipt succeeds, backfills PO rate/amount/grand_total, and creates audit timeline comment
- Teardown: Complete database cleanup without leaving artifacts.
"""

import sys
import json
from pathlib import Path

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
        make_purchase_orders_from_mr_items,
        make_purchase_receipts_from_po_items,
        backfill_po_from_purchase_receipt,
    )

    company_qifu = "天津祺富机械加工有限公司"
    wh_qifu = "仓库 - 祺富"
    supplier = "圣凯（天津）工业有限公司"
    item_code = "WL-00001" # 扁锉
    item_uom = frappe.db.get_value("Item", item_code, "stock_uom") or "个"

    # =========================================================================
    # SCENARIO 1: 赠品 (is_free_item=1) 采购订单与入库免验全流程
    # =========================================================================
    print("\n=== Running Scenario 1: Free Item (is_free_item=1) Flow ===")

    # 1.1 Create MR
    mr1 = frappe.new_doc("Material Request")
    mr1.material_request_type = "Purchase"
    mr1.company = company_qifu
    mr1.transaction_date = nowdate()
    mr1.schedule_date = nowdate()
    mr1.append("items", {
        "item_code": item_code,
        "qty": 5,
        "uom": item_uom,
        "warehouse": wh_qifu,
        "schedule_date": nowdate(),
    })
    mr1.insert()
    created_docs.append(("Material Request", mr1.name))
    mr1.submit()

    mri1_name = mr1.items[0].name

    # 1.2 Create PO with is_free_item=1 and rate=0
    po1_res = make_purchase_orders_from_mr_items(
        company=company_qifu,
        selected_items=[{
            "mri_name": mri1_name,
            "this_qty": 5.0,
            "rate": 0.0,
            "is_free_item": 1,
            "supplier": supplier,
        }],
        supplier_override=supplier,
        submit_doc=1,
    )
    po1_name = po1_res["orders"][0]["name"]
    created_docs.append(("Purchase Order", po1_name))

    po1_doc = frappe.get_doc("Purchase Order", po1_name)
    po1_item = po1_doc.items[0]

    record_test(
        "S1_1_Free_Item_PO_Created",
        po1_item.is_free_item == 1 and flt(po1_item.rate) == 0.0 and flt(po1_item.amount) == 0.0,
        f"PO {po1_name} item is_free_item={po1_item.is_free_item}, rate={po1_item.rate}, amount={po1_item.amount}"
    )

    # 1.3 Create PR with rate=0 for free item (should succeed without price validation error)
    poi1_name = po1_item.name
    pr1_res = make_purchase_receipts_from_po_items(
        company=company_qifu,
        selected_items=[{
            "poi_name": poi1_name,
            "this_qty": 5.0,
            "rate": 0.0,
            "is_free_item": 1,
            "warehouse": wh_qifu,
        }],
        warehouse_override=wh_qifu,
    )
    pr1_name = pr1_res["receipts"][0]["name"]
    created_docs.append(("Purchase Receipt", pr1_name))

    pr1_doc = frappe.get_doc("Purchase Receipt", pr1_name)
    pr1_item = pr1_doc.items[0]

    record_test(
        "S1_2_Free_Item_PR_Received",
        pr1_item.is_free_item == 1 and flt(pr1_item.rate) == 0.0 and flt(pr1_item.amount) == 0.0,
        f"PR {pr1_name} item is_free_item={pr1_item.is_free_item}, rate={pr1_item.rate}"
    )

    # Free item PO should remain rate=0, no backfill
    po1_doc.reload()
    record_test(
        "S1_3_Free_Item_PO_Remains_Zero",
        flt(po1_doc.items[0].rate) == 0.0 and flt(po1_doc.grand_total) == 0.0,
        f"Free item PO rate remains 0.0, grand_total={po1_doc.grand_total}"
    )

    # =========================================================================
    # SCENARIO 2: 非赠品 0元暂定价采购订单生成放行
    # =========================================================================
    print("\n=== Running Scenario 2: Non-Free 0-Rate PO Creation ===")

    mr2 = frappe.new_doc("Material Request")
    mr2.material_request_type = "Purchase"
    mr2.company = company_qifu
    mr2.transaction_date = nowdate()
    mr2.schedule_date = nowdate()
    mr2.append("items", {
        "item_code": item_code,
        "qty": 10,
        "uom": item_uom,
        "warehouse": wh_qifu,
        "schedule_date": nowdate(),
    })
    mr2.insert()
    created_docs.append(("Material Request", mr2.name))
    mr2.submit()

    mri2_name = mr2.items[0].name

    # Create PO with is_free_item=0 and rate=0 (temporary pricing)
    po2_res = make_purchase_orders_from_mr_items(
        company=company_qifu,
        selected_items=[{
            "mri_name": mri2_name,
            "this_qty": 10.0,
            "rate": 0.0,
            "is_free_item": 0,
            "supplier": supplier,
        }],
        supplier_override=supplier,
        submit_doc=1,
    )
    po2_name = po2_res["orders"][0]["name"]
    created_docs.append(("Purchase Order", po2_name))

    po2_doc = frappe.get_doc("Purchase Order", po2_name)
    po2_item = po2_doc.items[0]

    record_test(
        "S2_1_Zero_Rate_PO_Allowed",
        po2_item.is_free_item == 0 and flt(po2_item.rate) == 0.0 and flt(po2_doc.grand_total) == 0.0,
        f"PO {po2_name} non-free item created with rate=0, grand_total=0"
    )

    # =========================================================================
    # SCENARIO 3: 非赠品 0元采购入库必须强制定价拦截
    # =========================================================================
    print("\n=== Running Scenario 3: Non-Free 0-Rate PR Forced Price Interception ===")

    poi2_name = po2_item.name
    interception_success = False
    try:
        make_purchase_receipts_from_po_items(
            company=company_qifu,
            selected_items=[{
                "poi_name": poi2_name,
                "this_qty": 10.0,
                "rate": 0.0,
                "is_free_item": 0,
                "warehouse": wh_qifu,
            }],
            warehouse_override=wh_qifu,
        )
    except Exception as exc:
        interception_success = "单价为 0" in str(exc) or "必须填写" in str(exc) or "不能为 0" in str(exc)
        print(f"Captured expected interception: {exc}")

    record_test(
        "S3_1_Zero_Rate_PR_Blocked_For_Non_Free",
        interception_success,
        f"Correctly blocked 0-rate PR for non-free item. Interception={interception_success}"
    )

    # =========================================================================
    # SCENARIO 4: 录入实际到货单价入库、反向回填PO与审计日志存证
    # =========================================================================
    print("\n=== Running Scenario 4: PR Actual Price Entry, PO Backfill & Audit Trail ===")

    actual_receiving_rate = 32.50
    pr2_res = make_purchase_receipts_from_po_items(
        company=company_qifu,
        selected_items=[{
            "poi_name": poi2_name,
            "this_qty": 10.0,
            "rate": actual_receiving_rate,
            "is_free_item": 0,
            "warehouse": wh_qifu,
        }],
        warehouse_override=wh_qifu,
    )
    pr2_name = pr2_res["receipts"][0]["name"]
    created_docs.append(("Purchase Receipt", pr2_name))

    pr2_doc = frappe.get_doc("Purchase Receipt", pr2_name)
    record_test(
        "S4_1_PR_Created_With_Actual_Rate",
        flt(pr2_doc.items[0].rate) == actual_receiving_rate and pr2_doc.docstatus == 1,
        f"PR {pr2_name} submitted with rate={pr2_doc.items[0].rate}"
    )

    # 4.2 Verify PO Item rate and amount backfilled!
    po2_doc.reload()
    backfilled_rate = flt(po2_doc.items[0].rate)
    backfilled_amount = flt(po2_doc.items[0].amount)
    expected_amount = round(10.0 * actual_receiving_rate, 2)
    po_grand_total = flt(po2_doc.grand_total)

    record_test(
        "S4_2_PO_Item_Rate_Backfilled",
        backfilled_rate == actual_receiving_rate,
        f"PO item rate backfilled to {backfilled_rate}, expected={actual_receiving_rate}"
    )
    record_test(
        "S4_3_PO_Item_Amount_Backfilled",
        backfilled_amount == expected_amount,
        f"PO item amount backfilled to {backfilled_amount}, expected={expected_amount}"
    )
    record_test(
        "S4_4_PO_Grand_Total_Updated",
        po_grand_total >= expected_amount,
        f"PO grand_total updated to {po_grand_total}"
    )

    # 4.3 Verify Audit Timeline Comment on PO
    comments = frappe.db.get_all(
        "Comment",
        filters={"reference_doctype": "Purchase Order", "reference_name": po2_name},
        fields=["content", "owner"]
    )
    audit_comment = next((c for c in comments if "入库单反填金额审计记录" in c.get("content", "")), None)

    has_audit = bool(audit_comment)
    audit_has_pr = pr2_name in (audit_comment.get("content", "") if audit_comment else "")
    audit_has_rate = f"{actual_receiving_rate:,.2f}" in (audit_comment.get("content", "") if audit_comment else "")

    record_test(
        "S4_5_PO_Audit_Comment_Logged",
        has_audit and audit_has_pr and audit_has_rate,
        f"PO timeline audit comment exists with PR name ({pr2_name}) and rate ({actual_receiving_rate}): '{audit_comment.get('content') if audit_comment else 'None'}'"
    )

except Exception as ex:
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
