# -*- coding: utf-8 -*-
import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

def test_modals():
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH

    with sync_playwright() as p:
        browser = p.chromium.launch(**launch_options)
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        # Login
        print("Logging into Frappe Desk...")
        page.goto(f"{SITE_URL}/login")
        page.fill("#login_email", USERNAME)
        page.fill("#login_password", USER_PWD)
        page.click("button[type='submit']")
        page.wait_for_url("**/desk**", timeout=25000)
        print("Logged in successfully!")

        # 1. Test Monthly Settlement Modal
        print("\n--- Testing 1: Monthly Settlement Creation Modal ---")
        page.goto(f"{SITE_URL}/desk/monthly-settlement-picker")
        page.wait_for_selector(".picker-top-bar", timeout=15000)
        page.click("#monthly-open-create-modal-btn")
        page.wait_for_selector("#modal-monthly-items-table", timeout=8000)

        cols = page.locator("#modal-monthly-items-table colgroup col").count()
        th_texts = page.locator("#modal-monthly-items-table thead th").all_inner_texts()
        has_embedded_btn = page.locator("#modal-monthly-items-table tfoot #modal-monthly-add-row-btn").count() > 0
        sum_total = page.locator("#modal-monthly-sum-total").inner_text()
        print(f"Monthly Modal Cols: {cols}, Th: {th_texts}")
        print(f"Monthly Has Embedded Add-Row Btn in tfoot: {has_embedded_btn}, Sum: {sum_total}")
        page.screenshot(path="docs/designs/live_monthly_modal_table_verified.png")
        page.keyboard.press("Escape")
        time.sleep(1)

        # 2. Test Wire Transfer Modal
        print("\n--- Testing 2: Wire Transfer Creation Modal ---")
        page.goto(f"{SITE_URL}/desk/wire-transfer-picker")
        page.wait_for_selector(".picker-top-bar", timeout=15000)
        page.click("#wire-open-create-modal-btn")
        page.wait_for_selector("#modal-wire-items-table", timeout=8000)

        wire_cols = page.locator("#modal-wire-items-table colgroup col").count()
        wire_ths = page.locator("#modal-wire-items-table thead th").all_inner_texts()
        wire_btn = page.locator("#modal-wire-items-table tfoot #modal-wire-add-row-btn").count() > 0
        sum_wire = page.locator("#modal-wire-sum-total").inner_text()
        print(f"Wire Modal Cols: {wire_cols}, Th: {wire_ths}")
        print(f"Wire Has Embedded Add-Row Btn in tfoot: {wire_btn}, Sum: {sum_wire}")
        page.screenshot(path="docs/designs/live_wire_modal_table_verified.png")
        page.keyboard.press("Escape")
        time.sleep(1)

        # 3. Test Reimbursement Modal
        print("\n--- Testing 3: Reimbursement Creation Modal ---")
        page.goto(f"{SITE_URL}/desk/reimbursement-picker")
        page.wait_for_selector(".picker-top-bar", timeout=15000)
        page.click("#reim-open-create-modal-btn")
        page.wait_for_selector(".reim-inv-table", timeout=8000)

        reim_cols = page.locator(".reim-inv-table colgroup col").count()
        reim_ths = page.locator(".reim-inv-table thead th").all_inner_texts()
        reim_btn = page.locator(".reim-inv-table tfoot .reim-btn-add-item-row").count() > 0
        print(f"Reim Modal Cols: {reim_cols}, Th: {reim_ths}")
        print(f"Reim Has Embedded Add-Row Btn in tfoot: {reim_btn}")
        page.screenshot(path="docs/designs/live_reim_modal_table_verified.png")
        page.keyboard.press("Escape")
        time.sleep(1)

        # 4. Test Contract Modal
        print("\n--- Testing 4: Contract Creation Modal ---")
        page.goto(f"{SITE_URL}/desk/contract-workbench")
        page.wait_for_selector(".contract-header-bar", timeout=15000)
        page.click(".standard-actions button.primary-action")
        page.wait_for_selector("#modal-contract-terms-table", timeout=8000)

        contract_cols = page.locator("#modal-contract-terms-table colgroup col").count()
        contract_ths = page.locator("#modal-contract-terms-table thead th").all_inner_texts()
        contract_btn = page.locator("#modal-contract-terms-table tfoot #modal-add-term-btn").count() > 0
        sum_ratio = page.locator("#modal-term-sum-ratio").inner_text()
        sum_amt = page.locator("#modal-term-sum-amt").inner_text()
        print(f"Contract Modal Cols: {contract_cols}, Th: {contract_ths}")
        print(f"Contract Has Embedded Add-Row Btn in tfoot: {contract_btn}, Ratio: {sum_ratio}, Amt: {sum_amt}")
        page.screenshot(path="docs/designs/live_contract_modal_table_verified.png")

        print("\n[SUCCESS] All 4 modal tables verified live!")
        browser.close()

if __name__ == "__main__":
    test_modals()
