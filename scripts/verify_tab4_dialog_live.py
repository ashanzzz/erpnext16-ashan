import os, sys
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

sys.stdout.reconfigure(encoding="utf-8")
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

    # Click Tab 4 (housing_fund)
    tab4_btn = page.query_selector("button.qifu-tab-btn[data-tab='housing_fund']")
    if tab4_btn:
        tab4_btn.click()
        page.wait_for_timeout(2000)

    # Click 基数设置 button in Tab 4
    hf_setting_btn = page.query_selector("#btn-qifu-edit-hf-setting")
    if hf_setting_btn:
        hf_setting_btn.click()
        page.wait_for_timeout(1000)

    # Capture dialog screenshot
    dlg = page.query_selector(".modal.show .modal-content, .modal-dialog .modal-content")
    if dlg:
        dlg.screenshot(path="artifacts/qifu_tab4_hf_dialog.png")
        print("Housing fund dialog screenshot saved to artifacts/qifu_tab4_hf_dialog.png")

    page.screenshot(path="artifacts/qifu_tab4_full_page.png")
    print("Tab 4 full page screenshot saved to artifacts/qifu_tab4_full_page.png")
    browser.close()
