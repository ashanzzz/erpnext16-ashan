import os, sys, json
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path(".env"))
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_timeout(2000)

    # First go to desk home
    page.goto(f"{SITE_URL}/app")
    page.wait_for_timeout(2000)

    # Monitor requests and console
    requests = []
    page.on("request", lambda r: requests.append(r.url) if "reimbursement" in r.url or "procurement_workbench" in r.url else None)

    # Navigate to reimbursement-picker and take screenshots at intervals (0ms, 100ms, 300ms, 800ms)
    print("Navigating to reimbursement-picker...")
    page.goto(f"{SITE_URL}/desk/reimbursement-picker", wait_until="commit")
    
    # Snapshot at 50ms
    page.wait_for_timeout(100)
    page.screenshot(path="temp_screenshots/flicker_100ms.png")
    
    page.wait_for_timeout(300)
    page.screenshot(path="temp_screenshots/flicker_400ms.png")

    page.wait_for_timeout(600)
    page.screenshot(path="temp_screenshots/flicker_1000ms.png")

    print("Requests:", json.dumps(requests, indent=2))
