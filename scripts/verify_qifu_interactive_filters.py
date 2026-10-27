import os, sys
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

os.makedirs("temp_screenshots/interactive_check", exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    
    console_errors = []
    def on_console(msg):
        if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text:
            console_errors.append(msg.text)
            print("[CONSOLE ERROR]", msg.text)
    page.on("console", on_console)
    page.on("pageerror", lambda err: console_errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    
    print("2. Navigating to Qifu HR Salary Workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3500)
    
    # Test Tab 1 Interactive Search
    print("3. Testing Tab 1 Search (孟祥山)...")
    page.fill("#qifu-emp-search", "孟祥山")
    page.wait_for_timeout(500)
    tab1_rows = page.locator("#tbody-qifu-emp tr.qifu-emp-row").count()
    meta1 = page.locator("#tab1-sheet-meta").inner_text()
    print(f"Tab 1 search result rows: {tab1_rows}, meta: {meta1}")
    assert tab1_rows == 1, f"Expected 1 row, got {tab1_rows}"
    assert "当前筛选：1人" in meta1
    
    # Test Tab 1 Segmented Filter
    print("4. Testing Tab 1 Filter (返聘工)...")
    page.fill("#qifu-emp-search", "")
    page.click("#qifu-emp-type-filter button[data-type='返聘工']")
    page.wait_for_timeout(500)
    tab1_rehire_rows = page.locator("#tbody-qifu-emp tr.qifu-emp-row").count()
    meta1_rehire = page.locator("#tab1-sheet-meta").inner_text()
    print(f"Tab 1 rehire rows: {tab1_rehire_rows}, meta: {meta1_rehire}")
    assert tab1_rehire_rows == 5, f"Expected 5 rehire rows, got {tab1_rehire_rows}"
    page.click("#qifu-emp-type-filter button[data-type='all']")
    page.wait_for_timeout(500)

    # Test Tab 3 Social Insurance
    print("5. Testing Tab 3 (社会保险) Search & Filter...")
    page.click(".qifu-tab-btn[data-tab='social_insurance']")
    page.wait_for_timeout(1000)
    page.fill("#tab3-search", "QF0006")
    page.wait_for_timeout(500)
    tab3_rows = page.locator("#tbody-tab3-ss-sheet tr:not(.qifu-viewport-spacer-row)").count()
    meta3 = page.locator("#tab3-sheet-meta").inner_text()
    print(f"Tab 3 search QF0006 rows: {tab3_rows}, meta: {meta3}")
    assert tab3_rows == 1, f"Expected 1 row, got {tab3_rows}"
    page.fill("#tab3-search", "")
    page.wait_for_timeout(500)

    # Test Tab 4 Housing Fund
    print("6. Testing Tab 4 (住房公积金) and Single-line Cell...")
    page.click(".qifu-tab-btn[data-tab='housing_fund']")
    page.wait_for_timeout(1000)
    cell_html = page.locator("#tbody-tab4-hf-sheet tr td:nth-child(7)").first.inner_html()
    print("Tab 4 column 7 cell HTML:", cell_html)
    assert "qifu-policy-source-sub" not in cell_html, "Found multi-line policy-source-sub in cell!"
    assert "固定缴纳" in cell_html
    
    # Test Tab 6 Settlement
    print("7. Testing Tab 6 (综合结算) Filter & Footer...")
    page.click(".qifu-tab-btn[data-tab='settlement']")
    page.wait_for_timeout(1000)
    page.click("#tab6-emp-filter button[data-type='正式工']")
    page.wait_for_timeout(500)
    tab6_rows = page.locator("#tbody-qifu-payroll tr:not(.qifu-viewport-spacer-row)").count()
    meta6 = page.locator("#tab6-sheet-meta").inner_text()
    tfoot6 = page.locator("#tfoot-qifu-payroll tr td").first.inner_text()
    print(f"Tab 6 正式工 rows: {tab6_rows}, meta: {meta6}, tfoot: {tfoot6}")
    assert "合计" in tfoot6

    page.screenshot(path="temp_screenshots/interactive_check/all_checks_passed.png")
    browser.close()
    
    print("\nTotal Console Errors:", len(console_errors))
    assert len(console_errors) == 0, f"Errors found: {console_errors}"
    print("ALL INTERACTIVE FILTERS & STYLES VERIFIED WITH ZERO ERRORS!")
