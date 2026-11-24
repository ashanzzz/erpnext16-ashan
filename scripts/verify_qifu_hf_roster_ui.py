import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "ashanzzz1213@gmail.com")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "Woo@@@204317")

out_dir = Path("temp_screenshots/verify_qifu_hf_roster_preview")
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})

    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    time.sleep(1)

    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    time.sleep(2)

    page.click(".qifu-tab-btn[data-tab='housing_fund']")
    time.sleep(2)

    # Select period 2026-10
    print("Selecting Period 2026-10...")
    page.fill("#qifu-month-select", "2026-10")
    page.eval_on_selector("#qifu-month-select", "el => el.dispatchEvent(new Event('change'))")
    time.sleep(3)

    summary_text_10 = page.locator("#qifu-hf-roster-change-summary").inner_text()
    seal_btn_title_10 = page.locator("#btn-tab4-export-hf-seal").get_attribute("title")
    inc_btn_title_10 = page.locator("#btn-tab4-export-hf-increase").get_attribute("title")
    print(f"2026-10 Summary: {summary_text_10}")
    print(f"2026-10 Seal Button Title: {seal_btn_title_10}")
    print(f"2026-10 Inc Button Title: {inc_btn_title_10}")

    table_rows_count = page.locator("#tbody-tab4-hf-sheet tr").count()
    print(f"2026-10 Table displayed rows count: {table_rows_count}")
    first_row_text = page.locator("#tbody-tab4-hf-sheet tr").first.inner_text() if table_rows_count > 0 else "EMPTY"
    print(f"2026-10 First Row text: {first_row_text}")

    shot_10 = out_dir / "04_qifu_hf_tab4_2026_10.png"
    page.screenshot(path=str(shot_10))
    print(f"Saved Screenshot: {shot_10}")

    browser.close()

print("\n[PLAYWRIGHT 2026-10 ACCEPTANCE COMPLETED!]")
