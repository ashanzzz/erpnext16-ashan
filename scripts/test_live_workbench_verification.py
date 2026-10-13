import sys
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
import os, sys, time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "ashanzzz1213@gmail.com")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    def on_console(msg):
        if msg.type == "error":
            if "ERR_ABORTED" not in msg.text:
                errors.append(msg.text)
                print(f"[CONSOLE ERROR] {msg.text}")
    page.on("console", on_console)

    print("1. Logging into Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    time.sleep(2)

    print("2. Navigating to jizhong-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    page.wait_for_selector(".jz-wb-wrapper", timeout=15000)
    time.sleep(3)

    # 验证 Tab 顺序
    tabs = page.locator(".jz-tab-btn").all_inner_texts()
    tabs_clean = [t.strip() for t in tabs]
    print(f"Tabs present: {tabs_clean}")
    expected_order = ['员工档案', '社会保险', '住房公积金', '考勤与工时', '工资核定', '个人所得税', '现金发放', '历史数据']
    for idx, exp in enumerate(expected_order):
        assert exp in tabs_clean[idx], f"Tab {idx} expected {exp}, got {tabs_clean[idx]}"
    print("[PASS] Tab 顺序正确：工资核定位于个人所得税前面，前置步骤在前！")

    # 验证前置拦截 (在 2026-08 前置未确认时)
    print("3. Testing prerequisite gate on 2026-08 (unconfirmed period)...")
    page.fill("#jz-month-select", "2026-08")
    page.dispatch_event("#jz-month-select", "change")
    time.sleep(3)
    page.locator(".jz-tab-btn[data-tab='payroll']").click()
    time.sleep(1)
    is_payroll_hidden_08 = page.locator("#jz-tab-payroll").evaluate("el => el.classList.contains('jz-hidden')")
    assert is_payroll_hidden_08, "2026-08 未完成前置时，工资核定 Tab 必须被拦截阻止进入！"
    print("[PASS] 2026-08 前置准入拦截成功生效！")

    # 关闭提示框
    if page.locator(".modal-dialog .btn-modal-close, .modal-dialog button[data-dismiss='modal']").count() > 0:
        page.locator(".modal-dialog .btn-modal-close, .modal-dialog button[data-dismiss='modal']").first.click()
        time.sleep(0.5)

    # 切换回 2026-07 (前置已全部确认，个税待核定状态)
    print("4. Switching to 2026-07 (prerequisites confirmed, tax pending)...")
    page.fill("#jz-month-select", "2026-07")
    page.dispatch_event("#jz-month-select", "change")
    time.sleep(3)

    # 验证进入工资核定 Tab，且黄色标注“还未生成个税”
    print("5. Opening payroll tab for 2026-07...")
    page.locator(".jz-tab-btn[data-tab='payroll']").click()
    time.sleep(2)
    assert page.locator("#table-jz-payroll").is_visible(), "工资核定表应正常展示"
    payroll_html = page.locator("#tbody-jz-payroll").inner_html()
    assert "还未生成个税" in payroll_html, "个税未核定时，工资核定表必须用黄色标注【还未生成个税】！"
    page.screenshot(path="temp_screenshots/verify_jizhong_payroll_202607_pending.png", full_page=True)
    print("[PASS] 2026-07 工资核定表成功加载，黄色标注【还未生成个税】生效！")

    # 进入个人所得税 Tab
    print("6. Opening tax tab for 2026-07...")
    page.locator(".jz-tab-btn[data-tab='tax']").click()
    time.sleep(2)
    assert page.locator("#table-jz-tax").is_visible(), "个人所得税 68 列大宽表应正常展示"
    assert page.locator("#jz-tax-threshold-setting-box").is_visible(), "个税免征额与计薪周期设置面板应正常展示"
    # 检查目标工资列单元格是否包含税后/税前标签
    first_target_cell = page.locator("#tbody-jz-tax tr td:nth-child(8)").first.inner_html()
    print(f"First target salary cell html: {first_target_cell}")
    assert "税后" in first_target_cell or "税前" in first_target_cell, "目标工资单元格应包含明确的【税后】或【税前】标签！"
    page.screenshot(path="temp_screenshots/verify_jizhong_tax_202607.png", full_page=True)
    print("[PASS] 个人所得税 68 列大宽表与设置面板成功加载，税后/税前标签正常！")

    # 进入历史数据 Tab
    print("7. Opening history tab...")
    page.locator(".jz-tab-btn[data-tab='history']").click()
    time.sleep(2)
    # 点击全要素综合工资台账
    page.locator(".jz-segment-btn[data-view='comprehensive']").click()
    time.sleep(2)
    assert page.locator("#table-jz-hist-comp").is_visible(), "全要素综合历史大宽表应正常展示"
    hist_headers = page.locator("#table-jz-hist-comp thead").inner_text()
    assert "五险一金" in hist_headers and "专项附加" in hist_headers and "现金配钞" in hist_headers
    page.screenshot(path="temp_screenshots/verify_jizhong_history_comp.png", full_page=True)
    print("[PASS] 全要素综合历史大宽表（五险一金、专项附加、配钞）成功展示！")

    print(f"Final console errors count: {len(errors)}")
    assert len(errors) == 0, f"Found console errors: {errors}"
    print("=== 全部实机 Playwright 交互与渲染验证 100% 成功通过！ ===")
    browser.close()
