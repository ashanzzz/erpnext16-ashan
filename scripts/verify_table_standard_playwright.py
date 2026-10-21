import os
import sys
import time
from pathlib import Path
import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright
from PIL import Image

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "Administrator")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "admin")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

console_errors = []

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

    # 1. Test Material Request Workbench
    print("Navigating to material-request-workbench...")
    page.goto(f"{SITE_URL}/desk/material-request-workbench")
    page.wait_for_selector(".ashan-table-card, .picker-table-wrapper", timeout=15000)
    page.wait_for_selector(".ashan-data-table th, .picker-data-table th", timeout=15000)
    time.sleep(2)

    # Check top scrollbar existence / visibility
    has_top_scroll = page.locator("#picker-top-scrollbar").count() > 0
    top_scroll_visible = page.locator("#picker-top-scrollbar").is_visible() if has_top_scroll else False
    print(f"Material Request: #picker-top-scrollbar count={page.locator('#picker-top-scrollbar').count()}, visible={top_scroll_visible}")
    assert not top_scroll_visible, "Top scrollbar must NOT be visible!"

    mr_png = out_dir / "verify_mr_table_clean.png"
    page.screenshot(path=str(mr_png), full_page=False)
    print(f"Saved {mr_png}")

    # 2. Test Stock Issue Workbench
    print("Navigating to stock-issue-workbench...")
    page.goto(f"{SITE_URL}/desk/stock-issue-workbench")
    page.wait_for_selector(".ashan-table-card, .si-table-card", timeout=15000)
    page.wait_for_selector(".ashan-data-table th, .si-data-table th", timeout=15000)
    time.sleep(2)

    si_png = out_dir / "verify_si_table_clean.png"
    page.screenshot(path=str(si_png), full_page=False)
    print(f"Saved {si_png}")

    browser.close()

# Verify and crop table top of material-request-workbench
img = Image.open(str(mr_png))
crop_mr = img.crop((80, 160, 650, 310))
crop_mr.save(str(out_dir / "crop_mr_after_clean.png"))
print("Saved crop_mr_after_clean.png")

img_si = Image.open(str(si_png))
crop_si = img_si.crop((80, 160, 650, 310))
crop_si.save(str(out_dir / "crop_si_after_clean.png"))
print("Saved crop_si_after_clean.png")

if console_errors:
    print(f"FAILED: Found {len(console_errors)} console errors: {console_errors}")
    sys.exit(1)

print("ALL PLAYWRIGHT TESTS PASSED WITH 0 CONSOLE ERRORS!")
