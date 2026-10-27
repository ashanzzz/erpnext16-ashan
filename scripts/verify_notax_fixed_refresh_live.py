# -*- coding: utf-8 -*-
import os, sys, json, time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    def on_console(msg):
        if msg.type == "error":
            txt = msg.text
            if "favicon" not in txt and "socket.io" not in txt:
                errors.append(txt)
                print(f"[CONSOLE error] {txt}")

    page.on("console", on_console)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    print("Logged in successfully!")

    print("2. Navigating to /desk/qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3500)

    # Make sure month is 2026-07
    page.evaluate("$('#qifu-month-select').val('2026-07').trigger('change');")
    page.wait_for_timeout(2000)

    # Click Tab 1: 员工薪酬档案
    print("3. Switching to Tab 1 (员工薪酬档案)...")
    page.click(".qifu-tab-btn[data-tab='employees']")
    page.wait_for_timeout(1500)

    # If Tab 1 is confirmed, cancel confirmation to allow editing
    btn_confirm = page.locator("#btn-qifu-confirm-employees")
    if btn_confirm.count() > 0 and "取消核定" in btn_confirm.text_content():
        print("Tab 1 is currently confirmed, clicking 取消核定 to allow editing...")
        btn_confirm.click()
        page.wait_for_timeout(500)
        confirm_modal = page.locator(".modal.fade.show")
        if confirm_modal.count() > 0:
            confirm_modal.locator(".btn-primary").click()
            page.wait_for_timeout(2000)

    # Find QF0068 row
    row_xfy = page.locator("#tbody-qifu-emp tr[data-emp-no='QF0068']")
    print("QF0068 row count in Tab 1:", row_xfy.count())
    initial_pill = row_xfy.locator(".qifu-mode-pill").text_content()
    print("Initial salary mode pill in Tab 1:", initial_pill)

    # Click QF0068 row to open edit dialog
    print("4. Clicking QF0068 row to open edit dialog...")
    row_xfy.click()
    page.wait_for_timeout(1000)

    modal = page.locator(".modal.fade.show")
    print("Modal is visible:", modal.is_visible())
    modal_title = modal.locator(".modal-title").text_content()
    print("Modal title:", modal_title)

    # Select 不税动态工资 in dialog
    print("5. Changing salary_mode to 不税动态工资 and saving...")
    select_mode = modal.locator("select[data-fieldname='salary_mode']")
    select_mode.select_option("不税动态工资")
    page.wait_for_timeout(300)

    # Save
    modal.locator(".modal-footer .btn-primary").click()
    page.wait_for_timeout(2500)

    # Check Tab 1 refreshed pill
    pill_after_dynamic = page.locator("#tbody-qifu-emp tr[data-emp-no='QF0068'] .qifu-mode-pill").text_content()
    print("Tab 1 pill after saving 不税动态工资:", pill_after_dynamic)
    assert pill_after_dynamic.strip() == "不税动态工资", f"Expected 不税动态工资, got {pill_after_dynamic}"

    # Now open dialog again and change to 不税固定工资 with 2400
    print("6. Clicking QF0068 row again to open edit dialog...")
    page.locator("#tbody-qifu-emp tr[data-emp-no='QF0068']").click()
    page.wait_for_timeout(1000)

    modal = page.locator(".modal.fade.show")
    select_mode = modal.locator("select[data-fieldname='salary_mode']")
    print("Selecting 不税固定工资...")
    select_mode.select_option("不税固定工资")
    page.wait_for_timeout(300)

    # Fill fixed_salary = 2400
    input_fixed = modal.locator("input[data-fieldname='fixed_salary']")
    print("Filling fixed_salary = 2400...")
    input_fixed.fill("2400")
    page.wait_for_timeout(300)

    # Click Save
    print("Saving changes...")
    modal.locator(".modal-footer .btn-primary").click()
    page.wait_for_timeout(2500)

    # Check Tab 1 refreshed pill
    pill_after_fixed = page.locator("#tbody-qifu-emp tr[data-emp-no='QF0068'] .qifu-mode-pill").text_content()
    pill_class = page.locator("#tbody-qifu-emp tr[data-emp-no='QF0068'] .qifu-mode-pill").get_attribute("class")
    print("Tab 1 pill after saving 不税固定工资:", pill_after_fixed, "class:", pill_class)
    assert pill_after_fixed.strip() == "不税固定工资", f"Expected 不税固定工资, got {pill_after_fixed}"
    assert "mode-notax-fixed" in pill_class, f"Expected mode-notax-fixed class, got {pill_class}"

    # Now switch to Tab 0: 当期薪资明细
    print("7. Switching to Tab 0 (当期薪资明细)...")
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(1500)

    # Check QF0068 row in Tab 0
    row_tab0 = page.locator("#tbody-salary-main tr[data-emp-no='QF0068']")
    print("QF0068 row count in Tab 0:", row_tab0.count())
    assert row_tab0.count() == 1, "QF0068 should be visible in Tab 0!"

    tab0_pill = row_tab0.locator(".qifu-mode-pill").text_content()
    tab0_pill_class = row_tab0.locator(".qifu-mode-pill").get_attribute("class")
    print("Tab 0 pill:", tab0_pill, "class:", tab0_pill_class)
    assert tab0_pill.strip() == "不税固定工资", f"Expected 不税固定工资 in Tab 0, got {tab0_pill}"
    assert "mode-notax-fixed" in tab0_tab_class if "tab0_tab_class" in locals() else "mode-notax-fixed" in tab0_pill_class

    # Check net and gross in Tab 0
    net_cell = row_tab0.locator(".qifu-val-green").text_content()
    gross_cell = row_tab0.locator(".qifu-val-blue").text_content()
    print("Tab 0 Net:", net_cell, "Gross:", gross_cell)
    assert "2,400.00" in net_cell, f"Expected net 2,400.00, got {net_cell}"
    assert "2,400.00" in gross_cell, f"Expected gross 2,400.00, got {gross_cell}"

    # Take screenshot
    screenshot_path = out_dir / "qifu_notax_fixed_refresh_verified.png"
    page.screenshot(path=str(screenshot_path))
    print(f"8. Screenshot saved to {screenshot_path}")

    print("Console errors recorded:", len(errors), errors)
    assert len(errors) == 0, f"Expected 0 console errors, got: {errors}"

    print("ALL ASSERTIONS PASSED! Table details refreshed to 不税固定工资 smoothly with 0 console errors!")
    browser.close()
