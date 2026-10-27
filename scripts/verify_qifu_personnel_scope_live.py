import os, sys
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    
    errors = []
    def on_console(msg):
        if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text:
            errors.append(msg.text)
            print("[CONSOLE ERROR]", msg.text)
    page.on("console", on_console)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    
    print("2. Navigating to /desk/qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector("#table-qifu-emp", timeout=25000)
    page.wait_for_timeout(2000)

    # 3. Check segmented control buttons
    buttons = page.query_selector_all("#qifu-emp-type-filter .jz-segment-btn")
    btn_info = [(b.text_content().strip(), b.get_attribute("data-type")) for b in buttons]
    print(f"Segmented buttons: {btn_info}")
    labels = [b[0] for b in btn_info]
    for expected in ["全部人员", "正式工", "返聘工", "其他类型", "临时工", "本月离职"]:
        assert expected in labels, f"Missing button: {expected}"

    # 4. Count rows in all modes
    def get_row_count():
        rows = page.query_selector_all("#tbody-qifu-emp tr:not(:has(td.qifu-empty-cell))")
        return len(rows)

    all_count = get_row_count()
    print(f"Total employees (全部人员): {all_count}")

    # Test clicking each filter
    results = {}
    for label, dt in btn_info:
        page.click(f"#qifu-emp-type-filter .jz-segment-btn[data-type='{dt}']")
        page.wait_for_timeout(400)
        active_val = page.evaluate("() => window.AshanUI ? window.AshanUI.getSegmentedValue('#qifu-emp-type-filter') : $('#qifu-emp-type-filter .jz-segment-btn.active').attr('data-type')")
        count = get_row_count()
        results[dt] = count
        print(f"Filter [{label}] (data-type={dt}): active_val={active_val}, visible_rows={count}")
        assert active_val == dt, f"Active value mismatch: expected {dt}, got {active_val}"

    # Verify sum: regular + rehire + other + temp = active employees, plus resigned = total
    print(f"Summary of filtered rows: {results}")
    active_sum = results.get("正式工", 0) + results.get("返聘工", 0) + results.get("其他", 0) + results.get("临时工", 0)
    total_sum = active_sum + results.get("resigned", 0)
    print(f"Active sum: {active_sum}, Total sum: {total_sum}, All count: {all_count}")
    assert total_sum == all_count, f"Conservation law violation! {total_sum} != {all_count}"

    # Reset to all
    page.click("#qifu-emp-type-filter .jz-segment-btn[data-type='all']")
    page.wait_for_timeout(400)
    assert get_row_count() == all_count

    os.makedirs("temp_screenshots", exist_ok=True)
    page.screenshot(path="temp_screenshots/verify_qifu_personnel_scope_passed.png")
    print("Screenshot saved to temp_screenshots/verify_qifu_personnel_scope_passed.png")

    browser.close()
    assert len(errors) == 0, f"Console errors detected: {errors}"
    print("ALL LIVE PERSONNEL SCOPE FILTER CHECKS PASSED WITH 0 CONSOLE ERRORS!")
