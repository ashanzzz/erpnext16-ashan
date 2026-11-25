import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME")
USER_PWD = os.getenv("ERPNEXT_PASSWORD")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1920, "height": 1080})
    page = context.new_page()

    # 登录 ERPNext
    print(f"Logging into {SITE_URL} as {USERNAME}...")
    page.goto(f"{SITE_URL}/login", wait_until="networkidle")
    if page.locator("#login_email").is_visible():
        page.fill("#login_email", USERNAME)
        page.fill("#login_password", USER_PWD)
        page.click("button[type='submit']")
        page.wait_for_load_state("networkidle")
        time.sleep(2)

    # 1. 验证祺富账单工作台
    print("Navigating to Qifu Billing Workbench...")
    page.goto(f"{SITE_URL}/app/qifu-billing-workbench", wait_until="networkidle")
    time.sleep(3)
    page.wait_for_selector(".ashan-billing-container", timeout=15000)
    page.screenshot(path=str(out_dir / "verify_qifu_billing_live.png"), full_page=True)
    print("Saved Qifu billing screenshot.")

    # 2. 验证吉众账单工作台
    print("Navigating to Jizhong Billing Workbench...")
    page.goto(f"{SITE_URL}/app/jizhong-billing-workbench", wait_until="networkidle")
    time.sleep(3)
    page.wait_for_selector(".ashan-billing-container", timeout=15000)
    page.screenshot(path=str(out_dir / "verify_jizhong_billing_live.png"), full_page=True)
    print("Saved Jizhong billing screenshot.")

    browser.close()
    print("ALL PLAYWRIGHT SCREENSHOTS CAPTURED SUCCESSFULLY!")
