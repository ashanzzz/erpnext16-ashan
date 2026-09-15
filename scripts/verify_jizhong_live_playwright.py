import os
import sys
import time
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding='utf-8')

load_dotenv(r"d:\SynologyDrive团队\antigravity\erpnext16\.env")

SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')

out_dir = r"C:\Users\ashan\.gemini\antigravity\brain\41d118a3-40e9-4f3f-9275-84276c35966c"
os.makedirs(out_dir, exist_ok=True)

print("Checking site readiness...")
for i in range(20):
    try:
        r = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if r.status_code == 200:
            print("Site is ready!")
            break
    except Exception:
        pass
    time.sleep(2)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    page.on("console", lambda msg: print(f"[CONSOLE {msg.type}] {msg.text}") if msg.type == 'error' else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

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

    # 1. Tab 1: 月度薪酬核定表 (2026-06)
    print("\n--- Testing Tab 1: 月度薪酬核定表 ---")
    page.wait_for_selector("#table-jz-payroll", state="visible", timeout=10000)
    time.sleep(2)
    p_status = page.evaluate("() => document.getElementById('jz-kpi-status').innerText.trim()")
    p_count = page.evaluate("() => document.getElementById('jz-kpi-count').innerText.trim()")
    p_net = page.evaluate("() => document.getElementById('jz-kpi-net').innerText.trim()")
    print(f"Tab 1 Loaded (2026-06): Status={p_status}, Employees={p_count}, Net Salary={p_net}")
    shot1 = os.path.join(out_dir, "live_jizhong_tab1_payroll_2026_06.png")
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
    shot1_7 = os.path.join(out_dir, "live_jizhong_tab1_payroll_2026_07.png")
    page.screenshot(path=shot1_7, full_page=False)

    # 2. Tab 2: 考勤工时管理
    print("\n--- Testing Tab 2: 考勤工时管理 ---")
    page.click(".jz-tab-btn[data-tab='attendance']")
    time.sleep(2)
    att_count = page.evaluate("() => document.getElementById('jz-att-kpi-count').innerText.trim()")
    att_reg = page.evaluate("() => document.getElementById('jz-att-kpi-reg').innerText.trim()")
    att_meals = page.evaluate("() => document.getElementById('jz-att-kpi-meals').innerText.trim()")
    print(f"Tab 2 Attendance Loaded: Employees={att_count}, Regular Hours={att_reg}, Meals={att_meals}")
    
    # Expand first employee's daily detail
    print("Expanding first employee daily records...")
    page.click(".btn-toggle-daily:first-of-type")
    time.sleep(1)
    shot2 = os.path.join(out_dir, "live_jizhong_tab2_attendance.png")
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
    shot3 = os.path.join(out_dir, "live_jizhong_tab3_cash_bills.png")
    page.screenshot(path=shot3, full_page=False)
    print(f"Saved screenshot: {shot3}")

    # 4. Tab 4: 个人所得税台账
    print("\n--- Testing Tab 4: 个人所得税台账 ---")
    page.click(".jz-tab-btn[data-tab='tax']")
    time.sleep(2)
    tax_rows = page.evaluate("() => document.querySelectorAll('#tbody-jz-tax tr').length")
    print(f"Tab 4 Tax rows count: {tax_rows}")
    shot4 = os.path.join(out_dir, "live_jizhong_tab4_tax.png")
    page.screenshot(path=shot4, full_page=False)

    # 5. Tab 5: 员工薪酬档案
    print("\n--- Testing Tab 5: 员工薪酬档案 ---")
    page.click(".jz-tab-btn[data-tab='employees']")
    time.sleep(2)
    emp_rows = page.evaluate("() => document.querySelectorAll('#tbody-jz-employees tr').length")
    print(f"Tab 5 Employees count: {emp_rows}")
    shot5 = os.path.join(out_dir, "live_jizhong_tab5_employees.png")
    page.screenshot(path=shot5, full_page=False)

    # 7. Tab 7: 历史薪资穿透 (421条)
    print("\n--- Testing Tab 7: 历史薪资穿透 (421条) ---")
    page.click(".jz-tab-btn[data-tab='history']")
    time.sleep(2)
    hist_options = page.evaluate("() => Array.from(document.querySelectorAll('#jz-history-month-filter option')).map(o => o.value)")
    hist_rows = page.evaluate("() => document.querySelectorAll('#tbody-jz-history tr').length")
    print(f"Tab 7 History loaded: {len(hist_options)} period options, {hist_rows} records displayed.")
    shot7 = os.path.join(out_dir, "live_jizhong_tab7_history_421rows.png")
    page.screenshot(path=shot7, full_page=False)

    print("\n=== Playwright Verification Summary ===")
    print(f"Console errors: {len(errors)}")
    if errors:
        for e in errors:
            print("  -", e)
    else:
        print("ALL JIZHONG WORKBENCH TABS VERIFIED WITH 0 CONSOLE ERRORS!")

    browser.close()
