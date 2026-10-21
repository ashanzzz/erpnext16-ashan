import os
import sys
import time
from pathlib import Path
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "docs" / "designs"
out_dir.mkdir(parents=True, exist_ok=True)

print("Checking site readiness...")
for _ in range(15):
    try:
        res = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if res.status_code == 200:
            print("Site is ready!")
            break
    except Exception:
        pass
    time.sleep(2)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1600, "height": 960})

    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    print("Logging into Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    page.wait_for_timeout(2500)

    print("Navigating to procurement execution workbench...")
    page.goto(f"{SITE_URL}/desk/procurement-execution-workbench")
    page.wait_for_timeout(3000)

    # 1. Capture Desk overview with the new sidebar
    shot_desk = out_dir / "live_erpnext16_desk_sidebar_overview.png"
    page.screenshot(path=shot_desk, full_page=False)
    print(f"Captured Desk overview: {shot_desk}")

    # 2. Inspect sidebar elements
    sidebar = page.locator(".body-sidebar")
    assert sidebar.is_visible(), "Sidebar is visible"

    # Capture sidebar close-up
    shot_sidebar = out_dir / "live_erpnext16_sidebar_closeup.png"
    sidebar.screenshot(path=shot_sidebar)
    print(f"Captured Sidebar close-up: {shot_sidebar}")

    # 3. Test clicking another section to verify single-open-section behavior
    sections = page.locator(".body-sidebar .section-item")
    sec_count = sections.count()
    print(f"Found {sec_count} sections in sidebar.")

    # Find and click second section
    if sec_count > 1:
        sec_2_trigger = sections.nth(1).locator("> .standard-sidebar-item .item-anchor")
        sec_2_name = sec_2_trigger.inner_text().strip()
        print(f"Clicking second section: {sec_2_name}")
        sec_2_trigger.click()
        page.wait_for_timeout(1000)

        shot_switched = out_dir / "live_erpnext16_sidebar_switched.png"
        sidebar.screenshot(path=shot_switched)
        print(f"Captured switched state: {shot_switched}")

    browser.close()

print("\n--- Live Verification Summary ---")
print(f"Console errors: {len(errors)}")
for err in errors:
    print("  [Error]", err)
if len(errors) == 0:
    print("[PASS] 0 console errors on live Desk!")
