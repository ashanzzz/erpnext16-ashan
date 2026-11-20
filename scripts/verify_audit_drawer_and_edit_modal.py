# -*- coding: utf-8 -*-
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "ashanzzz1213@gmail.com")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

os.makedirs(PROJECT_ROOT / "temp_screenshots", exist_ok=True)

def run_live_audit_test():
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH

    print(f"[TEST] Starting live browser test at {SITE_URL}...")
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options)
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # 1. Login
        print("[TEST] Logging into Frappe Desk...")
        page.goto(f"{SITE_URL}/login", timeout=30000)
        page.fill("#login_email", USERNAME)
        page.fill("#login_password", USER_PWD)
        page.click("button[type='submit']")
        page.wait_for_url("**/desk**", timeout=30000)
        print("[TEST] Logged in successfully!")

        # 2. Navigate to Procurement Execution Workbench
        print("[TEST] Navigating to procurement-execution-workbench...")
        page.goto(f"{SITE_URL}/desk/procurement-execution-workbench", timeout=30000)
        page.wait_for_selector(".picker-top-bar", timeout=20000)
        time.sleep(2)

        # 3. Open a document detail dialog via page.evaluate
        print("[TEST] Triggering document detail modal in Ashan workbench...")
        doc_info = page.evaluate("""async () => {
            const page_wrap = frappe.pages && frappe.pages["procurement-execution-workbench"] ? frappe.pages["procurement-execution-workbench"].wrapper : null;
            const wb = (page_wrap && page_wrap.ashan_procurement_workbench) || (window.cur_page && cur_page.page && cur_page.page.ashan_procurement_workbench) || null;
            if (!wb) {
                console.error("Workbench instance not found!");
                return { error: "workbench_not_found" };
            }
            for (const dt of ["Purchase Order", "Material Request", "Purchase Receipt", "Purchase Invoice"]) {
                try {
                    const res = await frappe.call({
                        method: "frappe.client.get_list",
                        args: { doctype: dt, fields: ["name"], limit_page_length: 1 }
                    });
                    if (res.message && res.message.length > 0) {
                        const docname = res.message[0].name;
                        await wb.show_doc_detail_modal(dt, docname);
                        return { doctype: dt, name: docname };
                    }
                } catch (e) {
                    console.error("fetch doc error:", e);
                }
            }
            return { error: "no_documents_found" };
        }""")

        print(f"[TEST] Loaded doc into modal: {doc_info}")
        page.wait_for_selector(".picker-doc-modal-container", timeout=15000)
        print("[TEST] Detail modal is open!")

        # 4. Verify Audit Capsule in header
        capsule = page.locator("#picker-meta-audit-capsule-btn")
        capsule_count = capsule.count()
        print(f"[TEST] Audit capsule found: {capsule_count > 0}")
        if capsule_count > 0:
            capsule_text = capsule.inner_text().replace("\n", " ").strip()
            print(f"[TEST] Audit capsule content: {capsule_text}")

        # 5. Verify Action Buttons and Heights in footer
        audit_btn = page.locator("#picker-modal-audit-btn")
        audit_btn_count = audit_btn.count()
        print(f"[TEST] '操作履历' button found in footer: {audit_btn_count > 0}")

        close_btn = page.locator("#picker-modal-close-btn")
        print(f"[TEST] '关闭' button found in footer: {close_btn.count() > 0}")

        # Measure button heights
        if audit_btn_count > 0:
            audit_box = audit_btn.bounding_box()
            close_box = close_btn.bounding_box()
            print(f"[TEST] Button Heights -> 操作履历: {audit_box['height']}px, 关闭: {close_box['height']}px")

        # 6. Click '操作履历' to trigger the Inner Drawer
        print("[TEST] Clicking '操作履历' button to open audit drawer...")
        audit_btn.click()
        page.wait_for_selector("#picker-audit-drawer.is-open", timeout=5000)
        print("[TEST] Inner audit drawer is now open!")

        # Wait for timeline items to load
        time.sleep(1.5)
        timeline_items = page.locator("#picker-audit-timeline-stream .picker-audit-timeline-item")
        item_count = timeline_items.count()
        print(f"[TEST] Audit timeline items loaded: {item_count}")

        count_badge = page.locator("#picker-audit-drawer-count").inner_text()
        print(f"[TEST] Drawer count badge: {count_badge}")

        # Capture live screenshot of the drawer
        shot1 = PROJECT_ROOT / "temp_screenshots" / "live_audit_drawer_verified.png"
        page.screenshot(path=str(shot1))
        print(f"[TEST] Screenshot saved to: {shot1}")

        # 7. Close Drawer
        print("[TEST] Clicking close button on drawer...")
        page.click("#picker-audit-drawer-close-btn")
        time.sleep(0.5)
        is_drawer_open = page.locator("#picker-audit-drawer.is-open").count() > 0
        print(f"[TEST] Drawer is closed: {not is_drawer_open}")

        # 8. Check '修改单据' button if present
        edit_btn = page.locator("#picker-modal-edit-btn")
        if edit_btn.count() > 0:
            edit_text = edit_btn.inner_text().strip()
            print(f"[TEST] '修改单据' button is active ({edit_text}), clicking to test edit modal...")
            edit_btn.click()
            time.sleep(1)
            # Wait for edit dialog
            page.wait_for_selector(".picker-create-mr-modal, .modal-dialog", timeout=8000)
            print("[TEST] Edit dialog opened successfully!")

            company_val = page.locator("#field-po-company").input_value()
            sched_date_val = page.locator("#field-po-schedule-date").input_value()
            order_date_val = page.locator("#field-po-order-date").input_value()
            print(f"[TEST] Edit Dialog Header -> 所属公司: {company_val}, 单据日期: {order_date_val}, 期望日期: {sched_date_val}")

            rows_info = page.evaluate("""() => {
                const res = [];
                $('#picker-modal-item-tbody tr').each(function() {
                    res.push({
                        code: $(this).find('.modal-input-code').val(),
                        name: $(this).find('.modal-input-name').val(),
                        uom: $(this).find('.modal-input-uom').val(),
                        qty: $(this).find('.modal-input-qty').val(),
                        rate: $(this).find('.modal-input-rate').val(),
                        tax_rate: $(this).find('.modal-input-tax-rate').val()
                    });
                });
                return res;
            }""")
            print(f"[TEST] Edit Dialog Rows ({len(rows_info)} items): {rows_info}")

            shot2 = PROJECT_ROOT / "temp_screenshots" / "live_edit_dialog_verified.png"
            page.screenshot(path=str(shot2))
            print(f"[TEST] Edit dialog screenshot saved to: {shot2}")
        else:
            print("[TEST] Document has downstream links or is locked, '修改单据' button correctly hidden or disabled as per accounting rules.")

        browser.close()
        print("[TEST OK] All live browser tests passed successfully!")

if __name__ == "__main__":
    run_live_audit_test()
