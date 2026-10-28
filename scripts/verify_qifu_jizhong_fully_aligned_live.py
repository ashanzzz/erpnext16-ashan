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

    # 1. Verify Desk native header does NOT contain scattered workbench buttons
    scattered_btns = page.locator(".page-head .standard-actions .btn:has-text('导出发放表'), .page-head .standard-actions .btn:has-text('核定本月数据'), .page-head .standard-actions .btn:has-text('删除实发表')")
    print(f"Scattered buttons in native page-head: {scattered_btns.count()}")
    assert scattered_btns.count() == 0, f"Expected 0 scattered workbench buttons in native page-head, got {scattered_btns.count()}"

    # 2. Verify Qifu header actions (.qifu-header .jz-header-actions)
    print("2. Checking Qifu header controls...")
    month_input = page.locator(".qifu-header .jz-header-actions #qifu-month-select")
    assert month_input.count() == 1, "Missing month selector in header!"
    btn_reset = page.locator(".qifu-header .jz-header-actions #btn-qifu-reset-month")
    assert btn_reset.count() == 1 and btn_reset.text_content().strip() == "重置本月", "Missing 重置本月 button in header!"
    btn_lock = page.locator(".qifu-header .jz-header-actions #btn-qifu-header-lock")
    assert btn_lock.count() == 1 and ("核定本月数据" in btn_lock.text_content() or "已核定" in btn_lock.text_content()), "Missing 核定本月数据 button in header!"
    btn_refresh = page.locator(".qifu-header .jz-header-actions #btn-qifu-refresh-all")
    assert btn_refresh.count() == 1 and btn_refresh.text_content().strip() == "刷新数据", "Missing 刷新数据 button in header!"
    print("Header actions perfectly aligned with Jizhong!")

    # 3. Check Tab 0 (外部实发主表)
    print("3. Checking Tab 0 (外部实发主表)...")
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(1000)

    btn_upload = page.locator("#btn-salary-integrated-action")
    print("Tab 0 upload/delete button:", btn_upload.text_content().strip())
    assert btn_upload.count() == 1, "Missing upload/delete integrated action in Tab 0!"

    btn_t0_confirm = page.locator("#btn-qifu-confirm-salary-main")
    print("Tab 0 confirmation button:", btn_t0_confirm.text_content().strip())
    assert btn_t0_confirm.count() == 1 and ("确认本表" in btn_t0_confirm.text_content() or "取消确认" in btn_t0_confirm.text_content()), "Tab 0 confirmation button text mismatch!"

    btn_export_dist = page.locator("#btn-salary-export-dist")
    assert btn_export_dist.count() == 1 and "导出发放表" in btn_export_dist.text_content(), "Missing 导出发放表 in Tab 0!"

    btn_print_dist = page.locator("#btn-salary-print-dist")
    assert btn_print_dist.count() == 1 and "打印" in btn_print_dist.text_content(), "Missing 打印 in Tab 0!"

    seg_t0 = page.locator("#salary-main-scope-filter .jz-segment-btn")
    assert seg_t0.count() == 3, f"Expected 3 segment buttons in Tab 0, got {seg_t0.count()}"

    search_t0 = page.locator("#salary-main-search-input")
    assert search_t0.count() == 1, "Missing search input in Tab 0!"

    # Screenshot Tab 0
    screenshot_t0 = out_dir / "qifu_aligned_tab0_live.png"
    page.screenshot(path=str(screenshot_t0))
    print(f"Saved Tab 0 screenshot to {screenshot_t0}")

    # 4. Check Tab 1 (员工薪酬档案)
    print("4. Checking Tab 1 (员工薪酬档案)...")
    page.click(".qifu-tab-btn[data-tab='employees']")
    page.wait_for_timeout(1000)

    btn_new_emp = page.locator("#btn-qifu-new-emp")
    assert btn_new_emp.count() == 1 and "新建员工档案" in btn_new_emp.text_content(), "Missing 新建员工档案 button in Tab 1!"

    btn_adjust = page.locator("#btn-qifu-batch-edit")
    assert btn_adjust.count() == 1 and "编辑档案" in btn_adjust.text_content(), "Missing 调整薪酬参数 button in Tab 1!"

    btn_rules = page.locator("#btn-qifu-employee-type-rules")
    assert btn_rules.count() == 1 and "用工性质规则" in btn_rules.text_content(), "Missing 用工性质规则设置 button in Tab 1!"

    btn_resign = page.locator("#btn-batch-resign")
    assert btn_resign.count() == 1 and "批量办理离职" in btn_resign.text_content(), "Missing 批量办理离职 button in Tab 1 (Qifu unique)!"

    btn_export_emp = page.locator("#btn-qifu-export-employees")
    assert btn_export_emp.count() == 1 and "导出档案" in btn_export_emp.text_content(), "Missing 导出薪资信息表 button in Tab 1!"

    btn_t1_confirm = page.locator("#btn-qifu-confirm-employees")
    assert btn_t1_confirm.count() == 1 and ("确认本表" in btn_t1_confirm.text_content() or "取消确认" in btn_t1_confirm.text_content()), "Tab 1 confirmation button text mismatch!"

    seg_t1 = page.locator("#qifu-emp-type-filter .jz-segment-btn")
    print(f"Tab 1 segment buttons count: {seg_t1.count()}")
    assert seg_t1.count() == 5, f"Expected 5 segment buttons in Tab 1, got {seg_t1.count()}"

    search_t1 = page.locator("#qifu-emp-search")
    assert search_t1.count() == 1, "Missing search input in Tab 1!"

    # Screenshot Tab 1
    screenshot_t1 = out_dir / "qifu_aligned_tab1_live.png"
    page.screenshot(path=str(screenshot_t1))
    print(f"Saved Tab 1 screenshot to {screenshot_t1}")

    print("Console errors recorded:", len(errors), errors)
    assert len(errors) == 0, f"Expected 0 console errors, got: {errors}"

    print("ALL QIFU-JIZHONG ALIGNMENT ASSERTIONS PASSED WITH ZERO CONSOLE ERRORS!")
    browser.close()
