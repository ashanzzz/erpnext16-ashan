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
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", timeout=25000)
    page.wait_for_timeout(2000)

    # Click Tab 6
    tab6_btn = page.query_selector("button.qifu-tab-btn[data-tab='settlement']")
    if tab6_btn:
        tab6_btn.click()
        page.wait_for_timeout(2000)

    # Screenshot the KPI grid and the full page
    kpi_grid = page.query_selector("#qifu-tab-settlement .qifu-master-summary-grid")
    if kpi_grid:
        kpi_grid.screenshot(path="artifacts/tab6_kpi_current.png")
        print("KPI grid screenshot saved to artifacts/tab6_kpi_current.png")

    page.screenshot(path="artifacts/tab6_full_current.png")
    print("Full page screenshot saved to artifacts/tab6_full_current.png")
    browser.close()
