import os
import sys
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

os.makedirs("temp_screenshots/qifu_tax_aligned", exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    
    console_errors = []
    page.on("console", lambda msg: console_errors.append(msg.text) if msg.type == "error" else None)
    
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3000)
    
    tabs = [
        ("housing_fund", "tab4_housing_fund.png"),
        ("tax", "tab5_tax.png"),
        ("settlement", "tab6_settlement.png"),
    ]
    
    for tab_id, filename in tabs:
        print(f"Clicking tab {tab_id}...")
        page.click(f".qifu-tab-btn[data-tab='{tab_id}']")
        page.wait_for_timeout(2000)
        page.screenshot(path=f"temp_screenshots/qifu_tax_aligned/{filename}")
        print(f"Saved temp_screenshots/qifu_tax_aligned/{filename}")
        
    print(f"Console errors: {len(console_errors)}")
    if console_errors:
        print("First 3 errors:", console_errors[:3])
    browser.close()
