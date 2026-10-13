import os, sys, time, json
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"): sys.stdout.reconfigure(encoding="utf-8")
load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "ashanzzz1213@gmail.com")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "Woo@@@204317")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = Path("temp_screenshots/final_verification")
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH: launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    errors = []
    def on_console(msg):
        if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text:
            errors.append(msg.text)
            print(f"[CONSOLE ERROR] {msg.text}")
    page.on("console", on_console)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    print("Logged in!")

    # --- PART A: Qifu Workbench Verification ---
    print("\n--- PART A: Qifu Workbench Verification ---")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    time.sleep(2)
    page.fill("#qifu-month-select", "2026-07")
    page.eval_on_selector("#qifu-month-select", "el => el.dispatchEvent(new Event('change'))")
    time.sleep(2)

    print("Testing Qifu Tab 3: Social Insurance...")
    page.click(".qifu-tab-btn[data-tab='social_insurance']")
    page.wait_for_selector("#table-tab3-ss-sheet", state="visible", timeout=10000)
    time.sleep(2)
    title_text = page.inner_text("#qifu-ss-report-title")
    print(f"Tab 3 Merged Title: '{title_text}'")
    assert "社会保险缴费明细单" in title_text, f"Expected title, got: {title_text}"

    page.click("#btn-tab3-more")
    time.sleep(1)
    is_menu_open = page.evaluate("() => document.getElementById('qifu-tab3-more-menu').classList.contains('is-open')")
    print(f"More menu open state: {is_menu_open}")
    assert is_menu_open, "Expected more menu to open"
    page.click("#btn-tab3-more")
    time.sleep(1)

    release_btn_visible = page.is_visible("#btn-tab3-confirm-ss")
    release_btn_disabled = page.is_disabled("#btn-tab3-confirm-ss")
    release_btn_text = page.inner_text("#btn-tab3-confirm-ss")
    print(f"Release Button: visible={release_btn_visible}, disabled={release_btn_disabled}, text='{release_btn_text}'")
    page.screenshot(path=str(out_dir / "01_qifu_tab3_social_insurance.png"))

    print("Testing Qifu Tab 1: Employees...")
    page.click(".qifu-tab-btn[data-tab='employees']")
    page.wait_for_selector("#table-qifu-emp", state="visible", timeout=10000)
    time.sleep(2)
    page.screenshot(path=str(out_dir / "02_qifu_tab1_employees.png"))

    # --- PART B: Jizhong Workbench Verification ---
    print("\n--- PART B: Jizhong Workbench Verification ---")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    page.wait_for_selector(".jz-tab-btn", state="visible", timeout=15000)
    time.sleep(2)
    page.fill("#jz-month-select", "2026-07")
    page.click("#btn-jz-refresh-all")
    time.sleep(2)

    print("Testing Jizhong Tab 1: Employees...")
    page.click(".jz-tab-btn[data-tab='employees']")
    page.wait_for_selector("#table-jz-employees", state="visible", timeout=10000)
    time.sleep(2)
    rows_count = page.locator("#tbody-jz-employees tr").count()
    print(f"Jizhong employees count: {rows_count}")
    assert rows_count == 23, f"Expected 23 employees, got {rows_count}"

    emp_btn_text = page.inner_text("#btn-jz-confirm-employees")
    print(f"Employee confirmation button: '{emp_btn_text}'")
    if "取消" not in emp_btn_text:
        page.click("#btn-jz-confirm-employees")
        time.sleep(1)
        if page.is_visible(".modal-dialog .btn-primary"):
            page.click(".modal-dialog .btn-primary")
            page.wait_for_selector(".modal.show, .modal-backdrop", state="hidden", timeout=5000)
            time.sleep(1)
    page.screenshot(path=str(out_dir / "03_jizhong_tab1_employees.png"))

    print("Testing Jizhong Tab 2: Attendance...")
    page.evaluate("() => document.querySelector('.jz-tab-btn[data-tab=\"attendance\"]').click()")
    time.sleep(2)
    cls_att = page.evaluate("() => document.getElementById('jz-tab-attendance')?.className")
    print(f"jz-tab-attendance class: {cls_att}")
    box_info = page.evaluate("""() => {
        const tbl = document.getElementById("table-jz-attendance");
        if (!tbl) return { exists: false };
        const cs = window.getComputedStyle(tbl);
        const rect = tbl.getBoundingClientRect();
        const p = tbl.parentElement;
        const pcs = p ? window.getComputedStyle(p) : {};
        const prect = p ? p.getBoundingClientRect() : {};
        return {
            exists: true,
            display: cs.display,
            visibility: cs.visibility,
            width: cs.width,
            height: cs.height,
            rect: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
            parentDisplay: pcs.display,
            parentHeight: pcs.height,
            parentRect: { x: prect.x, y: prect.y, w: prect.width, h: prect.height }
        };
    }""")
    print("Table box info:", json.dumps(box_info, indent=2))
    time.sleep(2)
    page.screenshot(path=str(out_dir / "04_jizhong_tab2_attendance.png"))

    print("Testing Jizhong Tab 3: Social Insurance...")
    page.click(".jz-tab-btn[data-tab='social_insurance']")
    page.wait_for_selector("#table-jz-social-insurance", state="visible", timeout=10000)
    time.sleep(2)
    ss_title = page.inner_text("#jz-ins-sheet-title")
    ss_meta = page.inner_text("#jz-social-sheet-meta")
    ss_badge = page.inner_text("#jz-ss-proof-badge")
    print(f"Social Insurance Title: '{ss_title}'")
    print(f"Social Insurance Meta: '{ss_meta}'")
    print(f"Social Insurance Proof Badge: '{ss_badge}'")
    ss_btn_text = page.inner_text("#btn-jz-confirm-social-insurance")
    print(f"Social Insurance Button: '{ss_btn_text}', disabled={page.is_disabled('#btn-jz-confirm-social-insurance')}")
    if "取消" not in ss_btn_text and not page.is_disabled("#btn-jz-confirm-social-insurance"):
        page.click("#btn-jz-confirm-social-insurance")
        time.sleep(1)
        if page.is_visible(".modal-dialog .btn-primary"):
            page.click(".modal-dialog .btn-primary")
            time.sleep(2)
    page.screenshot(path=str(out_dir / "05_jizhong_tab3_social_insurance.png"))

    print("Testing Jizhong Tab 4: Housing Fund...")
    page.click(".jz-tab-btn[data-tab='housing_fund']")
    page.wait_for_selector("#table-jz-housing-fund", state="visible", timeout=10000)
    time.sleep(2)
    hf_title = page.inner_text("#jz-ins-sheet-title")
    hf_meta = page.inner_text("#jz-housing-sheet-meta")
    hf_badge = page.inner_text("#jz-hf-proof-badge")
    print(f"Housing Fund Title: '{hf_title}'")
    print(f"Housing Fund Meta: '{hf_meta}'")
    print(f"Housing Fund Proof Badge: '{hf_badge}'")
    hf_btn_text = page.inner_text("#btn-jz-confirm-housing-fund")
    print(f"Housing Fund Button: '{hf_btn_text}', disabled={page.is_disabled('#btn-jz-confirm-housing-fund')}")
    if "取消" not in hf_btn_text and not page.is_disabled("#btn-jz-confirm-housing-fund"):
        page.click("#btn-jz-confirm-housing-fund")
        time.sleep(1)
        if page.is_visible(".modal-dialog .btn-primary"):
            page.click(".modal-dialog .btn-primary")
            time.sleep(2)
    page.screenshot(path=str(out_dir / "06_jizhong_tab4_housing_fund.png"))

    step_badges = page.evaluate("() => Array.from(document.querySelectorAll('.jz-step-item')).map(el => ({ title: el.querySelector('.jz-step-title')?.innerText.trim(), badge: el.querySelector('.jz-step-badge')?.innerText.trim() }))")
    print("Step badges after confirmation:")
    for b in step_badges: print(f"  {b['title']}: {b['badge']}")

    print("Testing Jizhong Tab 5: Tax...")
    page.click(".jz-tab-btn[data-tab='tax']")
    page.wait_for_selector("#table-jz-tax", state="visible", timeout=10000)
    time.sleep(2)
    tax_title = page.inner_text("#jz-tax-sheet-title")
    tax_meta = page.inner_text("#jz-tax-sheet-meta")
    print(f"Tax Title: '{tax_title}' | Meta: '{tax_meta}'")
    page.screenshot(path=str(out_dir / "07_jizhong_tab5_tax.png"))

    print("Testing Jizhong Tab 6: Payroll...")
    page.click(".jz-tab-btn[data-tab='payroll']")
    page.wait_for_selector("#table-jz-payroll", state="visible", timeout=10000)
    time.sleep(2)
    pay_title = page.inner_text("#jz-payroll-sheet-title")
    pay_meta = page.inner_text("#jz-payroll-sheet-meta")
    print(f"Payroll Title: '{pay_title}' | Meta: '{pay_meta}'")
    page.screenshot(path=str(out_dir / "08_jizhong_tab6_payroll.png"))

    print("Testing Jizhong Tab 7: Cash Bills...")
    page.click(".jz-tab-btn[data-tab='cash_bills']")
    page.wait_for_selector("#table-jz-cash", state="visible", timeout=10000)
    time.sleep(2)
    cash_title = page.inner_text("#jz-cash-sheet-title")
    cash_meta = page.inner_text("#jz-cash-sheet-meta")
    print(f"Cash Title: '{cash_title}' | Meta: '{cash_meta}'")
    page.screenshot(path=str(out_dir / "09_jizhong_tab7_cash_bills.png"))

    print(f"\nConsole errors during run: {len(errors)}")
    browser.close()

assert len(errors) == 0, f"Console errors: {errors}"
print("\n100% SUCCESS: All verifications and browser assertions passed!")
