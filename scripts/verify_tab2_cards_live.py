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
    page.wait_for_url("**/desk**", timeout=25000)
    
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", timeout=25000)
    page.wait_for_timeout(2000)

    # Click Tab 2 (import / salary_main)
    tab2_btn = page.query_selector("button.qifu-tab-btn[data-tab='salary_main']")
    if tab2_btn:
        tab2_btn.click()
        page.wait_for_timeout(2000)

    # Check the period month
    period_sel = page.query_selector("#qifu-month-select")
    current_val = period_sel.input_value() if period_sel else ""
    print(f"Current period in UI: {current_val}")
    if current_val != "2026-09":
        period_sel.select_option("2026-09")
        page.wait_for_timeout(2000)
        # re-click tab2 if needed
        tab2_btn = page.query_selector("button.qifu-tab-btn[data-tab='salary_main']")
        if tab2_btn: tab2_btn.click()
        page.wait_for_timeout(2000)

    c1 = page.locator("#sm-card-net").inner_text()
    c2 = page.locator("#sm-card-gross").inner_text()
    c3 = page.locator("#sm-card-allowance").inner_text()
    print(f"Card 1 (发放总金额): {c1}")
    print(f"Card 2 (考勤部分总金额): {c2}")
    print(f"Card 3 (补贴总金额): {c3}")

    grid = page.query_selector("#salary-main-summary-cards")
    if grid:
        grid.screenshot(path="artifacts/qifu_tab2_three_cards.png")
        print("Summary cards screenshot saved to artifacts/qifu_tab2_three_cards.png")

    page.screenshot(path="artifacts/qifu_tab2_full_page.png")
    print("Full page screenshot saved to artifacts/qifu_tab2_full_page.png")
    browser.close()
