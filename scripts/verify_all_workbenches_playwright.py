import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "Administrator")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "admin")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

console_errors = []

pages_to_test = [
    ("material-request-workbench", "verify_mr_live.png"),
    ("stock-issue-workbench", "verify_si_live.png"),
    ("reimbursement-picker", "verify_reim_live.png"),
    ("monthly-settlement-picker", "verify_monthly_live.png"),
    ("wire-transfer-picker", "verify_wire_live.png"),
]

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    def handle_console(msg):
        text = msg.text
        if msg.type == "error":
            if "socket.io" in text or "favicon" in text:
                return
            console_errors.append(text)
            print(f"[CONSOLE ERROR] {text}")

    page.on("console", handle_console)

    print("Logging in...")
    page.goto(f"{SITE_URL}/login")
    page.wait_for_selector("#login_email", timeout=15000)
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    print("Logged in successfully.")

    for route, shot_name in pages_to_test:
        print(f"Testing route /desk/{route}...")
        page.goto(f"{SITE_URL}/desk/{route}")
        page.wait_for_selector(".ashan-table-card, .picker-table-wrapper, .si-table-card", timeout=15000)
        time.sleep(1.5)

        # Check top scrollbar visibility
        top_scroll = page.locator(".picker-top-scrollbar-wrap")
        if top_scroll.count() > 0:
            is_vis = top_scroll.first.is_visible()
            assert not is_vis, f"Route /desk/{route} has visible top scrollbar!"
            print(f"  -> Top scrollbar exists but is hidden (display: none). OK!")
        else:
            print(f"  -> Top scrollbar DOM is completely removed. OK!")

        shot_path = out_dir / shot_name
        page.screenshot(path=str(shot_path), full_page=False)
        print(f"  -> Saved {shot_path.name}")

    browser.close()

if console_errors:
    print(f"FAILED: Found {len(console_errors)} console errors: {console_errors}")
    sys.exit(1)

print("\nSUCCESS: ALL 5 WORKBENCHES TESTED AND VERIFIED 100% CLEAN WITH 0 ERRORS!")
