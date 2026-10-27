import sys
sys.stdout.reconfigure(encoding="utf-8")
import os
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "ashanzzz1213@gmail.com")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

os.makedirs("artifacts", exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})
    
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=35000)
    page.wait_for_timeout(1000)
    
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", timeout=35000)
    page.wait_for_timeout(2000)

    # Click Tab 5 (tax)
    tab5_btn = page.query_selector("button.qifu-tab-btn[data-tab='tax']")
    if tab5_btn:
        tab5_btn.click()
        page.wait_for_timeout(2500)

    # Capture Tab 5 summary cards
    cards = page.query_selector("#qifu-tab-tax .qifu-master-summary-grid")
    if cards:
        cards.screenshot(path="artifacts/qifu_tab5_summary_cards.png")
        print("Tab 5 summary cards screenshot saved to artifacts/qifu_tab5_summary_cards.png")

    page.screenshot(path="artifacts/qifu_tab5_full_page.png")
    print("Tab 5 full page screenshot saved to artifacts/qifu_tab5_full_page.png")
    browser.close()
