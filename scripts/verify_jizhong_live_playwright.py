import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = Path(
    os.getenv("PLAYWRIGHT_OUTPUT_DIR", PROJECT_ROOT / "temp_screenshots")
)
out_dir.mkdir(parents=True, exist_ok=True)

print("Checking site readiness...")
last_readiness_error = None
for _ in range(20):
    try:
        response = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if response.status_code == 200:
            print("Site is ready!")
            break
        last_readiness_error = RuntimeError(
            f"ping returned HTTP {response.status_code}"
        )
    except requests.RequestException as exc:
        last_readiness_error = exc
    time.sleep(2)
else:
    raise RuntimeError(
        f"ERPNext site did not become ready: {last_readiness_error}"
    )

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []

    def record_console_error(message):
        if message.type != "error":
            return
        error_text = f"console: {message.text}"
        errors.append(error_text)
        print(f"[CONSOLE error] {message.text}")

    page.on("console", record_console_error)
    page.on("pageerror", lambda error: errors.append(f"pageerror: {error}"))

    print("Logging in to Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    time.sleep(2)

    print("Navigating to 吉众人事薪酬工作台 (/desk/jizhong-hr-salary-workbench)...")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    time.sleep(3)

    # Check URL: verify it remained on jizhong-hr-salary-workbench
    current_url = page.url
    print(f"Current page URL: {current_url}")
    assert "jizhong-hr-salary-workbench" in current_url, f"Expected jizhong-hr-salary-workbench in URL, got {current_url}"

    # The workbench opens on the employee tab. Select the tested payroll period and
    # switch to the payroll tab before asserting payroll-specific elements.
    page.fill("#jz-month-select", "2026-06")
    page.click("#btn-jz-refresh-all")
    page.click(".jz-tab-btn[data-tab='payroll']")

    # 1. Tab 1: 月度薪酬核定表 (2026-06)
    print("\n--- Testing Tab 1: 月度薪酬核定表 ---")
    page.wait_for_selector("#table-jz-payroll", state="visible", timeout=10000)
    time.sleep(2)
    p_status = page.evaluate("() => document.getElementById('jz-kpi-status').innerText.trim()")
    p_count = page.evaluate("() => document.getElementById('jz-kpi-count').innerText.trim()")
    p_net = page.evaluate("() => document.getElementById('jz-kpi-net').innerText.trim()")
    print(f"Tab 1 Loaded (2026-06): Status={p_status}, Employees={p_count}, Net Salary={p_net}")
    shot1 = out_dir / "live_jizhong_tab1_payroll_2026_06.png"
    page.screenshot(path=shot1, full_page=False)
    print(f"Saved screenshot: {shot1}")

    # Switch month to 2026-07
    print("\n--- Testing Tab 1: 月度薪酬核定表 (2026-07) ---")
    page.fill("#jz-month-select", "2026-07")
    page.click("#btn-jz-refresh-all")
    time.sleep(2)
    p7_count = page.evaluate("() => document.getElementById('jz-kpi-count').innerText.trim()")
    p7_net = page.evaluate("() => document.getElementById('jz-kpi-net').innerText.trim()")
    print(f"Tab 1 Loaded (2026-07): Employees={p7_count}, Net Salary={p7_net}")
    shot1_7 = out_dir / "live_jizhong_tab1_payroll_2026_07.png"
    page.screenshot(path=shot1_7, full_page=False)

    print("Testing Tab 1: 导出工资核定表 Excel...")
    with page.expect_download(timeout=15000) as download_pr_info:
        page.click("#btn-jz-export-payroll")
    download_pr = download_pr_info.value
    print(f"Downloaded Payroll Excel: {download_pr.suggested_filename}")
    assert "工资核定表" in download_pr.suggested_filename

    # 2. Tab 2: 考勤工时管理
    print("\n--- Testing Tab 2: 考勤工时管理 ---")
    page.click(".jz-tab-btn[data-tab='attendance']")
    time.sleep(2)
    att_count = page.evaluate("() => document.getElementById('jz-att-kpi-count').innerText.trim()")
    att_reg = page.evaluate("() => document.getElementById('jz-att-kpi-reg').innerText.trim()")
    att_meals = page.evaluate("() => document.getElementById('jz-att-kpi-meals').innerText.trim()")
    print(f"Tab 2 Attendance Loaded: Employees={att_count}, Regular Hours={att_reg}, Meals={att_meals}")
    
    # The attendance tab renders structured daily records directly in the wide table.
    # Assert the table body instead of relying on the removed expandable-row control.
    print("Checking structured daily attendance rows...")
    page.wait_for_selector("#tbody-jz-attendance tr", state="attached", timeout=10000)
    attendance_rows = page.locator("#tbody-jz-attendance tr").count()
    assert attendance_rows > 0, "Expected structured attendance rows"
    shot2 = out_dir / "live_jizhong_tab2_attendance.png"
    page.screenshot(path=shot2, full_page=False)
    print(f"Saved screenshot: {shot2}")

    # 3. Tab 3: 现金发放与配钞点钞
    print("\n--- Testing Tab 3: 现金发放与配钞点钞 ---")
    page.click(".jz-tab-btn[data-tab='cash_bills']")
    time.sleep(2)
    c_tot = page.evaluate("() => document.getElementById('stat-cash-total').innerText.trim()")
    c_b100 = page.evaluate("() => document.getElementById('stat-b100').innerText.trim()")
    c_b50 = page.evaluate("() => document.getElementById('stat-b50').innerText.trim()")
    c_b10 = page.evaluate("() => document.getElementById('stat-b10').innerText.trim()")
    print(f"Tab 3 Cash Bills: Total Cash={c_tot}, 100元={c_b100}, 50元={c_b50}, 10元={c_b10}")
    shot3 = out_dir / "live_jizhong_tab3_cash_bills.png"
    page.screenshot(path=shot3, full_page=False)

    print("Testing Tab 3: 导出工资发放表 (A4 + 信封) Excel...")
    with page.expect_download(timeout=15000) as download_cash_info:
        page.click("#btn-jz-export-cash")
    download_cash = download_cash_info.value
    print(f"Downloaded Cash Excel: {download_cash.suggested_filename}")
    assert "工资发放表" in download_cash.suggested_filename
    print(f"Saved screenshot: {shot3}")

    # 4. Tab 4: 个人所得税台账
    print("\n--- Testing Tab 4: 个人所得税台账 ---")
    page.click(".jz-tab-btn[data-tab='tax']")
    time.sleep(2)
    tax_rows = page.evaluate("() => document.querySelectorAll('#tbody-jz-tax tr').length")
    print(f"Tab 4 Tax rows count: {tax_rows}")
    shot4 = out_dir / "live_jizhong_tab4_tax.png"
    page.screenshot(path=shot4, full_page=False)

    # 5. Tab 5: 员工薪酬档案
    print("\n--- Testing Tab 5: 员工薪酬档案 ---")
    page.click(".jz-tab-btn[data-tab='employees']")
    time.sleep(2)
    emp_rows = page.evaluate("() => document.querySelectorAll('#tbody-jz-employees tr').length")
    print(f"Tab 5 Employees count: {emp_rows}")
    shot5 = out_dir / "live_jizhong_tab5_employees.png"
    page.screenshot(path=shot5, full_page=False)

    # 7. Tab 7: 历史薪资穿透 (421条)
    print("\n--- Testing Tab 7: 历史薪资穿透 (421条) ---")
    page.click(".jz-tab-btn[data-tab='history']")
    time.sleep(2)
    hist_options = page.evaluate("() => Array.from(document.querySelectorAll('#jz-history-month-filter option')).map(o => o.value)")
    hist_rows = page.evaluate("() => document.querySelectorAll('#tbody-jz-history tr').length")
    print(f"Tab 7 History loaded: {len(hist_options)} period options, {hist_rows} records displayed.")
    shot7 = out_dir / "live_jizhong_tab7_history_421rows.png"
    page.screenshot(path=shot7, full_page=False)

    print("\n=== Playwright Verification Summary ===")
    print(f"Console errors: {len(errors)}")
    if errors:
        for error in errors:
            print("  -", error)
    else:
        print("ALL JIZHONG WORKBENCH TABS VERIFIED WITH 0 CONSOLE ERRORS!")

    browser.close()
    if errors:
        raise AssertionError(
            f"Jizhong workbench emitted {len(errors)} browser error(s)."
        )
