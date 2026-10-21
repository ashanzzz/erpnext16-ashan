import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    def record_console_error(msg):
        if msg.type == "error":
            txt = msg.text
            if "favicon" not in txt and "socket.io" not in txt:
                errors.append(txt)
                print(f"[CONSOLE ERROR] {txt}")

    page.on("console", record_console_error)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    print("Logged in successfully!")
    errors.clear()

    # =========================================================================
    # Test 1: Monthly Settlement Picker (/desk/monthly-settlement-picker)
    # =========================================================================
    print("\n--- Testing 1: Monthly Settlement Picker ---")
    page.goto(f"{SITE_URL}/desk/monthly-settlement-picker")
    page.wait_for_selector("#monthly-data-table", timeout=15000)
    page.wait_for_timeout(2000)

    # Verify no emoji in title
    title_text = page.locator(".picker-title-group h2").text_content()
    print(f"Monthly Title: {title_text}")
    assert "\U0001F4C5" not in title_text, "Emoji must be removed from Monthly Title"

    # Verify no dual-line badges in table header
    th_badges = page.locator("#monthly-table-thead .picker-th-badge").count()
    assert th_badges == 0, f"Found {th_badges} dual-line header badges in monthly settlement table!"

    # Verify doc view headers (default view)
    doc_headers = [h.strip() for h in page.locator("#monthly-table-thead th").all_text_contents() if h.strip()]
    print(f"Monthly Doc Headers (default): {doc_headers}")
    assert "入库总额" in doc_headers and "待开票金额" in doc_headers, "Missing standard headers in monthly doc view"

    shot_m_doc = out_dir / "monthly_settlement_doc_view.png"
    page.screenshot(path=str(shot_m_doc), full_page=True)

    # Switch to detail view
    page.locator(".picker-view-btn[data-mode='detail']").click()
    page.wait_for_timeout(1500)
    detail_headers = [h.strip() for h in page.locator("#monthly-table-thead th").all_text_contents() if h.strip()]
    print(f"Monthly Detail Headers: {detail_headers}")
    assert "入库单号" in detail_headers and "开票状态" in detail_headers and "物料代码" in detail_headers, "Missing standard headers in monthly detail view"

    shot_m_detail = out_dir / "monthly_settlement_detail_view.png"
    page.screenshot(path=str(shot_m_detail), full_page=True)
    print("[PASS] Monthly Settlement Picker verified!")

    # =========================================================================
    # Test 2: Wire Transfer Picker (/desk/wire-transfer-picker)
    # =========================================================================
    print("\n--- Testing 2: Wire Transfer Picker ---")
    page.goto(f"{SITE_URL}/desk/wire-transfer-picker")
    page.wait_for_selector("#wire-data-table", timeout=15000)
    page.wait_for_timeout(2000)

    wire_doc_headers = [h.strip() for h in page.locator("#wire-table-thead th").all_text_contents() if h.strip()]
    print(f"Wire Doc Headers: {wire_doc_headers}")
    assert "单据编号" in wire_doc_headers and "单据状态" in wire_doc_headers and "单据总额" in wire_doc_headers, "Missing standard headers in wire doc view"

    # Check that ths have picker-col classes
    th_classes = page.locator("#wire-table-thead th").evaluate_all("els => els.map(e => e.className)")
    has_picker_col = any("picker-col" in c for c in th_classes)
    assert has_picker_col, "Wire transfer th elements must have picker-col classes"

    # Check action buttons have no emoji
    action_btn_texts = page.locator(".wire-table-actions button").all_text_contents()
    print(f"Wire Action Buttons: {action_btn_texts[:5]}")
    for txt in action_btn_texts:
        assert "📦" not in txt and "🧾" not in txt and "👁" not in txt, f"Found emoji in wire action button: {txt}"

    shot_w_doc = out_dir / "wire_transfer_doc_view.png"
    page.screenshot(path=str(shot_w_doc), full_page=True)

    # Switch to detail view
    page.locator(".picker-view-btn[data-mode='detail']").click()
    page.wait_for_timeout(1500)
    wire_detail_headers = [h.strip() for h in page.locator("#wire-table-thead th").all_text_contents() if h.strip()]
    print(f"Wire Detail Headers: {wire_detail_headers}")
    assert "物料代码" in wire_detail_headers and "单价" in wire_detail_headers, "Missing standard headers in wire detail view"

    shot_w_detail = out_dir / "wire_transfer_detail_view.png"
    page.screenshot(path=str(shot_w_detail), full_page=True)
    print("[PASS] Wire Transfer Picker verified!")

    # =========================================================================
    # Test 3: Reimbursement Picker (/desk/reimbursement-picker)
    # =========================================================================
    print("\n--- Testing 3: Reimbursement Picker ---")
    page.goto(f"{SITE_URL}/desk/reimbursement-picker")
    page.wait_for_selector("#reim-data-table", timeout=15000)
    page.wait_for_timeout(2000)

    reim_doc_headers = [h.strip() for h in page.locator("#reim-table-head th").all_text_contents() if h.strip()]
    print(f"Reimbursement Doc Headers: {reim_doc_headers}")
    assert "报销单号" in reim_doc_headers and "报销总额" in reim_doc_headers and "待付金额" in reim_doc_headers, "Missing standard headers in reim doc view"

    # Verify NO 'CNY ' string in table or summary!
    body_text = page.locator(".picker-page-container").inner_text()
    assert "CNY " not in body_text, "Found CNY currency string! All currency must use ¥ symbol"

    shot_r_doc = out_dir / "reimbursement_doc_view.png"
    page.screenshot(path=str(shot_r_doc), full_page=True)

    # Switch to detail view
    page.locator(".picker-view-btn[data-mode='detail']").click()
    page.wait_for_timeout(1500)
    reim_detail_headers = [h.strip() for h in page.locator("#reim-table-head th").all_text_contents() if h.strip()]
    print(f"Reimbursement Detail Headers: {reim_detail_headers}")
    assert "物料名称" in reim_detail_headers and ("总价" in reim_detail_headers or "报销金额" in reim_detail_headers), "Missing standard headers in reim detail view"

    shot_r_detail = out_dir / "reimbursement_detail_view.png"
    page.screenshot(path=str(shot_r_detail), full_page=True)
    print("[PASS] Reimbursement Picker verified!")

    # Check console errors
    print(f"\nTotal Console Errors: {len(errors)}")
    assert len(errors) == 0, f"Found console errors: {errors}"
    print("[ALL PASS] All 3 pickers verified live with 0 errors!")
    browser.close()
