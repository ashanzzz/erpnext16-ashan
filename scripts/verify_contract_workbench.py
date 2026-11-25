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

def run_contract_test():
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH

    print(f"[TEST] Starting live browser test for contract-workbench at {SITE_URL}...")
    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options)
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        print("[TEST] Logging into Frappe Desk...")
        page.goto(f"{SITE_URL}/login", timeout=30000)
        page.fill("#login_email", USERNAME)
        page.fill("#login_password", USER_PWD)
        page.click("button[type='submit']")
        page.wait_for_url("**/desk**", timeout=30000)
        print("[TEST] Logged in successfully!")

        print("[TEST] Navigating to contract-workbench...")
        page.goto(f"{SITE_URL}/desk/contract-workbench", timeout=30000)
        page.wait_for_selector(".contract-workbench-container, .contract-kpi-grid", timeout=20000)
        time.sleep(2)

        shot1 = PROJECT_ROOT / "temp_screenshots" / "live_contract_workbench_after.png"
        page.screenshot(path=str(shot1))
        print(f"[TEST] Main page screenshot saved to: {shot1}")

        # Test clicking "新建采购合同" button
        print("[TEST] Clicking '#contract-create-btn' button...")
        page.click("#contract-create-btn")
        time.sleep(1)
        page.wait_for_selector(".contract-modal-item-table", timeout=8000)
        time.sleep(1)
        shot2 = PROJECT_ROOT / "temp_screenshots" / "live_contract_modal_v3_perfect.png"
        page.screenshot(path=str(shot2))
        print(f"[TEST] Modal screenshot saved to: {shot2}")

        shot2_legacy = PROJECT_ROOT / "temp_screenshots" / "live_contract_modal_after.png"
        page.screenshot(path=str(shot2_legacy))
        print(f"[TEST] Legacy modal screenshot updated to: {shot2_legacy}")

        browser.close()
        print("[TEST OK] After-state verification completed successfully!")

if __name__ == "__main__":
    run_contract_test()
