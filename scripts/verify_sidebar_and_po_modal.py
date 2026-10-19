# -*- coding: utf-8 -*-
import os
import sys
import time
from pathlib import Path
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "ashanzzz1213@gmail.com")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "Woo@@@204317")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "docs" / "designs"
out_dir.mkdir(parents=True, exist_ok=True)

print("Checking site readiness...")
for _ in range(15):
    try:
        res = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if res.status_code == 200:
            print("Site is ready!")
            break
    except Exception:
        pass
    time.sleep(2)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH

    browser = p.chromium.launch(**launch_options)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    print("Navigating to login...")
    page.goto(f"{SITE_URL}/login", wait_until="networkidle")
    if page.locator("#login_email").is_visible():
        page.fill("#login_email", USERNAME)
        page.fill("#login_password", USER_PWD)
        page.click("button.btn-login")
        page.wait_for_load_state("networkidle")
        time.sleep(3)

    print("Navigating to procurement-execution-workbench...")
    page.goto(f"{SITE_URL}/desk/procurement-execution-workbench#stage=mr_to_po", wait_until="networkidle")
    time.sleep(4)

    # 1. Screenshot the sidebar
    sidebar_el = page.locator(".body-sidebar")
    if sidebar_el.is_visible():
        sidebar_el.screenshot(path=str(out_dir / "live_sidebar_separated_ctrls.png"))
        print("[OK] Saved sidebar screenshot to docs/designs/live_sidebar_separated_ctrls.png")

    # 2. Check sidebar controls
    comp_select = page.locator("#ashan-sidebar-company-select")
    date_input = page.locator("#ashan-sidebar-date-input")
    typo_btn = page.locator("#ashan-sidebar-open-typo-btn")

    print(f"Company select visible: {comp_select.is_visible()}")
    print(f"Date input visible: {date_input.is_visible()}")
    print(f"Typo button visible: {typo_btn.is_visible()}")

    # 3. Test typography dialog
    if typo_btn.is_visible():
        typo_btn.click()
        time.sleep(1)
        typo_dialog = page.locator(".modal.show:has-text('全局排版设置')")
        if typo_dialog.is_visible():
            typo_dialog.screenshot(path=str(out_dir / "live_typo_dialog_verified.png"))
            print("[OK] Saved typography dialog screenshot to docs/designs/live_typo_dialog_verified.png")
            page.locator(".modal.show .btn-modal-close, .modal.show button:has-text('取消')").first.click()
            time.sleep(1)

    # 4. Test PO Modal
    # In mr_to_po stage, click the primary submit button if items are selected or check a row
    row_checkbox = page.locator(".picker-row-checkbox").first
    if row_checkbox.is_visible():
        row_checkbox.check()
        time.sleep(1)
        submit_btn = page.locator("#picker-submit-btn")
        if submit_btn.is_visible() and not submit_btn.is_disabled():
            submit_btn.click()
            time.sleep(2)
            po_modal = page.locator(".modal.show:has-text('采购订单明细')")
            if po_modal.is_visible():
                po_modal.screenshot(path=str(out_dir / "live_po_creation_modal_verified.png"))
                print("[OK] Saved PO creation modal screenshot to docs/designs/live_po_creation_modal_verified.png")
            else:
                page.screenshot(path=str(out_dir / "live_workbench_after_click.png"))
                print("[WARN] PO modal not visible, screenshot saved to live_workbench_after_click.png")
        else:
            print("Submit button not clickable")
    else:
        print("No row checkbox found on workbench")
        page.screenshot(path=str(out_dir / "live_workbench_no_rows.png"))

    browser.close()
    print("Verification script finished!")
