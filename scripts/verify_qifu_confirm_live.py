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
    page.fill("#qifu-month-select", "2026-07")
    page.dispatch_event("#qifu-month-select", "change")
    page.wait_for_timeout(2000)

    # 3. Check Tab 1 (员工薪酬档案) toolbar and button presence
    print("3. Switching to Tab 1 (员工薪酬档案)...")
    page.click("button.qifu-tab-btn[data-tab='employees']")
    page.wait_for_timeout(2500)

    btn_info_before = page.evaluate("""() => {
        const btn = document.querySelector('#btn-qifu-confirm-employees');
        return {
            exists: Boolean(btn),
            text: btn ? btn.innerText.trim() : '',
            className: btn ? btn.className : '',
            parentHtml: btn ? btn.parentElement.innerHTML : ''
        };
    }""")
    print("Confirm button before click:", btn_info_before)

    screenshot_tab1_before = str(out_dir / "qifu_tab1_before_confirm.png")
    page.screenshot(path=screenshot_tab1_before)
    print(f"Saved {screenshot_tab1_before}")

    # 4. Click #btn-qifu-confirm-employees
    print("4. Clicking #btn-qifu-confirm-employees to confirm employee roster...")
    # Setup dialog handler to accept frappe.confirm
    page.on("dialog", lambda dialog: dialog.accept())

    page.click("#btn-qifu-confirm-employees")
    page.wait_for_timeout(1000)

    # If Frappe standard modal confirm appears
    page.evaluate("""() => {
        const primaryBtn = document.querySelector('.modal.show .modal-footer .btn-primary');
        if (primaryBtn) primaryBtn.click();
    }""")
    page.wait_for_timeout(3000)

    # 5. Check button state after confirmation
    btn_info_after = page.evaluate("""() => {
        const btn = document.querySelector('#btn-qifu-confirm-employees');
        const tabBtn = document.querySelector('.qifu-tab-btn[data-tab=\"employees\"] .tab-status-dot');
        const step1Badge = document.querySelector('#wf-step1-main')?.innerHTML || '';
        return {
            text: btn ? btn.innerText.trim() : '',
            className: btn ? btn.className : '',
            tabDotClass: tabBtn ? tabBtn.className : '',
            step1Badge: step1Badge
        };
    }""")
    print("Confirm button after click:", btn_info_after)

    screenshot_tab1_after = str(out_dir / "qifu_tab1_after_confirm.png")
    page.screenshot(path=screenshot_tab1_after)
    print(f"Saved {screenshot_tab1_after}")

    # 6. Test Cancel confirmation
    print("6. Testing cancel confirmation...")
    page.click("#btn-qifu-confirm-employees")
    page.wait_for_timeout(1000)

    page.evaluate("""() => {
        const primaryBtn = document.querySelector('.modal.show .modal-footer .btn-primary');
        if (primaryBtn) primaryBtn.click();
    }""")
    page.wait_for_timeout(3000)

    btn_info_cancel = page.evaluate("""() => {
        const btn = document.querySelector('#btn-qifu-confirm-employees');
        return {
            text: btn ? btn.innerText.trim() : '',
            className: btn ? btn.className : ''
        };
    }""")
    print("Confirm button after cancel:", btn_info_cancel)

    # Re-confirm for final state
    print("7. Re-confirming for final verified state...")
    page.click("#btn-qifu-confirm-employees")
    page.wait_for_timeout(1000)
    page.evaluate("""() => {
        const primaryBtn = document.querySelector('.modal.show .modal-footer .btn-primary');
        if (primaryBtn) primaryBtn.click();
    }""")
    page.wait_for_timeout(3000)

    btn_info_final = page.evaluate("""() => {
        const btn = document.querySelector('#btn-qifu-confirm-employees');
        return {
            text: btn ? btn.innerText.trim() : '',
            className: btn ? btn.className : ''
        };
    }""")
    print("Confirm button final state:", btn_info_final)

    screenshot_final = str(out_dir / "qifu_tab1_confirmed_final.png")
    page.screenshot(path=screenshot_final)
    print(f"Saved {screenshot_final}")

    browser.close()
    print(f"\nVerification finished with {len(errors)} console errors.")
