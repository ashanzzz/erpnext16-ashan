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

def run_test():
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

        # 3. Test Direct Open (Step 0: nav_stack empty)
        print("[TEST] Step 1: Open document directly from workbench (nav_stack = [])...")
        doc_info = page.evaluate("""async () => {
            const page_wrap = frappe.pages && frappe.pages["procurement-execution-workbench"] ? frappe.pages["procurement-execution-workbench"].wrapper : null;
            const wb = (page_wrap && page_wrap.ashan_procurement_workbench) || (window.cur_page && cur_page.page && cur_page.page.ashan_procurement_workbench) || null;
            if (!wb) return { error: "workbench_not_found" };

            const res = await frappe.call({
                method: "frappe.client.get_list",
                args: { doctype: "Purchase Order", fields: ["name"], limit_page_length: 1 }
            });
            if (res.message && res.message.length > 0) {
                const po_name = res.message[0].name;
                await wb.show_doc_detail_modal("Purchase Order", po_name);
                return { doctype: "Purchase Order", name: po_name };
            }
            return { error: "no_po_found" };
        }""")
        print(f"[TEST] Loaded initial doc: {doc_info}")
        page.wait_for_selector(".picker-doc-modal-container", timeout=15000)

        # 4. Multi-cycle drill-down and back-navigation (Testing user scenario)
        print("\n[TEST] Step 2: Testing repeated back-and-forth drill-down & in-place update...")
        for cycle in range(1, 4):
            print(f"[TEST] --- Cycle {cycle}: Drill-down to MR ---")
            page.evaluate("""() => {
                const link = document.querySelector(".picker-doc-modal-link");
                if (link) link.click();
            }""")
            # Wait for unfreeze and dom update
            page.wait_for_selector(".ashan-doc-nav-banner", timeout=10000)
            page.wait_for_function("() => !document.querySelector('.freeze')")
            time.sleep(0.3)

            crumb_text = page.locator(".ashan-nav-breadcrumb").inner_text()
            print(f"[TEST] Cycle {cycle} drilled down, breadcrumb: {crumb_text}")
            assert "当前:" in crumb_text

            # Zero Bootstrap .modal-backdrop during workspace drawer lifecycle
            drawer_open = page.evaluate("() => document.querySelectorAll('#ashan-ws-drawer.is-open').length")
            backdrop_count = page.evaluate("() => document.querySelectorAll('.modal-backdrop:not(.freeze)').length")
            print(f"[TEST] Cycle {cycle} drawer={drawer_open}, modal-backdrop={backdrop_count} (Expected: drawer=1, backdrop=0)")
            assert drawer_open == 1 and backdrop_count == 0, f"Expected single workspace drawer with zero modal-backdrop, got drawer={drawer_open}, backdrop={backdrop_count}"

            print(f"[TEST] --- Cycle {cycle}: Returning to PO via Back Button ---")
            page.locator("#picker-nav-back-btn").click()
            page.wait_for_function("() => !document.querySelector('.freeze')")
            time.sleep(0.3)

            post_back_count = page.locator(".ashan-doc-nav-banner").count()
            print(f"[TEST] Cycle {cycle} returned, nav banner count: {post_back_count} (Expected: 0)")
            assert post_back_count == 0

            drawer_after_back = page.evaluate("() => document.querySelectorAll('#ashan-ws-drawer.is-open').length")
            backdrop_count_after_back = page.evaluate("() => document.querySelectorAll('.modal-backdrop:not(.freeze)').length")
            print(f"[TEST] Cycle {cycle} after return: drawer={drawer_after_back}, backdrop={backdrop_count_after_back}")
            assert drawer_after_back == 1 and backdrop_count_after_back == 0

        # 5. Close Drawer and Verify Zero Gray Screen / Zero Backdrop
        print("\n[TEST] Step 3: Closing workspace drawer and verifying ZERO gray backdrop...")
        close_btn = page.locator("#picker-modal-close-btn")
        close_btn.click()
        page.wait_for_function("() => !document.querySelector('#ashan-ws-drawer.is-open')")
        time.sleep(0.5)

        final_backdrops = page.evaluate("() => document.querySelectorAll('.modal-backdrop').length")
        is_modal_open = page.evaluate("() => document.body.classList.contains('modal-open')")
        print(f"[TEST] After closing modal: modal-backdrop count = {final_backdrops} (Expected: 0)")
        print(f"[TEST] After closing modal: body.modal-open = {is_modal_open} (Expected: False)")

        assert final_backdrops == 0, f"Critical Bug Detected! {final_backdrops} orphaned modal-backdrop(s) left in body!"
        assert not is_modal_open, "Critical Bug Detected! body.modal-open still stuck on body!"

        # 6. Verify main page is active and not grayed out
        page.screenshot(path=str(PROJECT_ROOT / "temp_screenshots" / "05_clean_main_page_no_gray.png"))
        print(f"[TEST] Screenshot of clean main page saved to 05_clean_main_page_no_gray.png")

        print("\n[SUCCESS] Repeated drill-down, in-place transition, and modal closure verified with ZERO gray screen!")
        browser.close()

if __name__ == "__main__":
    run_test()
