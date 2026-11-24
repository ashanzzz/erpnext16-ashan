import os
import sys
import time
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

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1600, "height": 900})

    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "favicon" not in m.text and "socket.io" not in m.text else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)

    print("2. Navigating to qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3500)

    # Check Tab 1 elements
    t1_btn = page.locator("#btn-tab1-confirm-profile")
    t1_text = t1_btn.inner_text() if t1_btn.count() > 0 else "NOT_FOUND"
    print(f"Tab 1 Confirm Button: {t1_text}")

    # Check Tab 2
    page.click("button[data-tab='import']")
    page.wait_for_timeout(500)
    t2_btn = page.locator("#btn-tab2-confirm-dist")
    t2_text = t2_btn.inner_text() if t2_btn.count() > 0 else "NOT_FOUND"
    print(f"Tab 2 Confirm Button: {t2_text}")

    # Check Tab 3
    page.click("button[data-tab='social_insurance']")
    page.wait_for_timeout(500)
    t3_btn = page.locator("#btn-tab3-confirm-ss")
    t3_text = t3_btn.inner_text() if t3_btn.count() > 0 else "NOT_FOUND"
    print(f"Tab 3 Confirm Button: {t3_text}")

    # Check Tab 4
    page.click("button[data-tab='housing_fund']")
    page.wait_for_timeout(500)
    t4_btn = page.locator("#btn-tab4-confirm-hf")
    t4_text = t4_btn.inner_text() if t4_btn.count() > 0 else "NOT_FOUND"
    print(f"Tab 4 Confirm Button: {t4_text}")

    # Top Lock button
    header_lock = page.locator("#btn-qifu-header-lock")
    header_lock_text = header_lock.inner_text() if header_lock.count() > 0 else "NOT_FOUND"
    print(f"Header Lock Button: {header_lock_text}")

    screenshot_path = PROJECT_ROOT / "temp_screenshots" / "qifu_unified_subreport_buttons.png"
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(screenshot_path))
    print(f"Screenshot saved to: {screenshot_path}")

    browser.close()

    if errors:
        print(f"Console errors detected: {errors}")
        sys.exit(1)
    else:
        print("Playwright live verification PASSED with 0 errors!")
