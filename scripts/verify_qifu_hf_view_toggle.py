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

out_dir = Path("temp_screenshots/verify_qifu_hf_view_toggle")
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 950})

    print("Logging into ERPNext...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    time.sleep(1)

    print("Navigating to Qifu HR Workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    time.sleep(2)

    # Click Tab 4
    page.click(".qifu-tab-btn[data-tab='housing_fund']")
    time.sleep(2)

    # Select period 2026-07
    print("Selecting Period 2026-07...")
    page.fill("#qifu-month-select", "2026-07")
    page.eval_on_selector("#qifu-month-select", "el => el.dispatchEvent(new Event('change'))")
    time.sleep(3)

    # Check segmented control labels
    contrib_btn_text = "".join(page.locator("#btn-hf-view-contributors").inner_text().split())
    all_btn_text = "".join(page.locator("#btn-hf-view-all").inner_text().split())
    print(f"Segment Contrib text: {contrib_btn_text}")
    print(f"Segment All text: {all_btn_text}")
    assert "1人" in contrib_btn_text, f"Expected 1人 in contrib btn, got {contrib_btn_text}"
    assert "25人" in all_btn_text or "26人" in all_btn_text, f"Expected 25人/26人 in all btn, got {all_btn_text}"

    # Default mode: 仅看参缴人员
    contrib_rows_count = page.locator("#tbody-tab4-hf-sheet tr").count()
    print(f"Mode [仅看参缴人员] rows count: {contrib_rows_count}")
    assert contrib_rows_count == 1, f"Expected 1 row, got {contrib_rows_count}"

    shot_contrib = out_dir / "01_qifu_hf_tab4_contrib_only.png"
    page.screenshot(path=str(shot_contrib))
    print(f"Saved Screenshot: {shot_contrib}")

    # Switch mode: 显示全员底册
    print("Clicking [显示全员底册]...")
    page.click("#btn-hf-view-all")
    time.sleep(2)

    all_rows_count = page.locator("#tbody-tab4-hf-sheet tr").count()
    print(f"Mode [显示全员底册] rows count: {all_rows_count}")
    assert all_rows_count >= 24, f"Expected >= 24 rows, got {all_rows_count}"

    shot_all = out_dir / "02_qifu_hf_tab4_all_employees.png"
    page.screenshot(path=str(shot_all))
    print(f"Saved Screenshot: {shot_all}")

    # Switch back: 仅看参缴人员
    print("Clicking [仅看参缴人员] to switch back...")
    page.click("#btn-hf-view-contributors")
    time.sleep(2)

    re_contrib_count = page.locator("#tbody-tab4-hf-sheet tr").count()
    print(f"Mode [仅看参缴人员] rows count after toggle: {re_contrib_count}")
    assert re_contrib_count == 1, f"Expected 1 row, got {re_contrib_count}"

    # Test file download of 封存清册 and check filename
    print("Testing Export 封存清册 download filename...")
    with page.expect_download() as download_info:
        page.click("#btn-tab4-export-hf-seal")
    download = download_info.value
    download_fname = download.suggested_filename
    print(f"Downloaded Filename: {download_fname}")
    assert "2026-07" in download_fname and "天津祺富机械加工有限公司" in download_fname and "封存清册" in download_fname, (
        f"Filename does not match standard! Got: {download_fname}"
    )

    browser.close()

print("\n[ALL PLAYWRIGHT TESTS PASSED SUCCESSFULLY!]")
