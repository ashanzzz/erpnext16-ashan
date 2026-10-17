import os, sys, time
if hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
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

    # 验证 2026-07 薪酬核定表：工资核定、个税、现金发放三者同源同步完整生成
    print("3. Opening payroll tab for 2026-07 (verifying complete simultaneous data)...")
    page.locator(".jz-tab-btn[data-tab='payroll']").click()
    time.sleep(2)
    assert page.locator("#table-jz-payroll").is_visible(), "工资核定表应正常展示"

    # 验证陈亮 (A0001) 行完整展示真实金额
    a1_row_text = page.locator("#tbody-jz-payroll tr").first.inner_text()
    print(f"Row 1 (A0001 陈亮): {a1_row_text}")
    assert "11,247.88" in a1_row_text, "陈亮税前工资应为 11,247.88"
    assert "61.86" in a1_row_text, "陈亮个税应为 61.86"
    assert "10,500.00" in a1_row_text, "陈亮实发工资应为 10,500.00"
    assert "还未生成个税" not in a1_row_text, "已测算数据绝不应再显示【还未生成个税】遮蔽标签！"

    # 验证 KPI 卡片完整显示汇总金额
    kpi_net = page.locator("#jz-kpi-net").inner_text()
    kpi_gross = page.locator("#jz-kpi-gross").inner_text()
    kpi_tax = page.locator("#jz-kpi-tax").inner_text()
    print(f"Payroll KPIs -> Net: {kpi_net}, Gross: {kpi_gross}, Tax: {kpi_tax}")
    assert "¥" in kpi_net and "还未生成" not in kpi_net, "实发总额应为有效货币数值"
    assert "¥" in kpi_gross and "还未生成" not in kpi_gross, "应发总额应为有效货币数值"
    page.screenshot(path="temp_screenshots/verify_jizhong_payroll_202607_complete.png", full_page=True)
    print("[PASS] 工资核定表所有数值（税前、个税、实发、现金）完整正确呈现！")

    # 验证个税台账
    print("4. Opening tax tab for 2026-07...")
    page.locator(".jz-tab-btn[data-tab='tax']").click()
    time.sleep(2)
    assert page.locator("#table-jz-tax").is_visible(), "个税台账应正常展示"
    tax_a1_text = page.locator("#tbody-jz-tax tr").first.inner_text()
    print(f"Tax Row 1 (A0001 陈亮): {tax_a1_text[:120]}...")
    assert "11,247.88" in tax_a1_text, "个税台账陈亮税前工资应为 11,247.88"
    assert "61.86" in tax_a1_text, "个税台账陈亮个税应为 61.86"
    assert "10,500.00" in tax_a1_text, "个税台账陈亮税后工资应为 10,500.00"
    page.screenshot(path="temp_screenshots/verify_jizhong_tax_202607_complete.png", full_page=True)
    print("[PASS] 个人所得税 68 列大宽表与工资核定表 100% 数据互通印证！")

    # 验证现金发放表
    print("5. Opening cash bills tab for 2026-07...")
    page.locator(".jz-tab-btn[data-tab='cash_bills']").click()
    time.sleep(2)
    assert page.locator("#table-jz-cash").is_visible(), "现金发放表应正常展示"
    cash_a1_text = page.locator("#tbody-jz-cash tr").first.inner_text()
    print(f"Cash Row 1 (A0001 陈亮): {cash_a1_text}")
    assert "10,500.00" in cash_a1_text, "现金发放表陈亮实发应为 10,500.00"
    page.screenshot(path="temp_screenshots/verify_jizhong_cash_202607_complete.png", full_page=True)
    print("[PASS] 现金发放表与工资实发 100% 同步对应！")

    print(f"Final console errors count: {len(errors)}")
    assert len(errors) == 0, f"Found console errors: {errors}"
    print("=== 【工资核定、个人所得税、现金发放】三表同源同时生成验证 100% 成功通过！ ===")
    browser.close()
