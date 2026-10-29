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

    def assert_table_geometry(table_selector, page_name):
        geom = page.evaluate("""(sel) => {
            const tbl = document.querySelector(sel);
            if (!tbl) return null;
            const thead = tbl.querySelector('thead');
            const th1 = thead ? thead.querySelector('th:nth-child(1)') : null;
            const th2 = thead ? thead.querySelector('th:nth-child(2)') : null;
            const tr = tbl.querySelector('tbody tr');
            return {
                theadHeight: thead ? Math.round(thead.getBoundingClientRect().height) : null,
                rowHeight: tr ? Math.round(tr.getBoundingClientRect().height) : null,
                gapTh: (th1 && th2) ? Math.round(Math.abs(th2.getBoundingClientRect().left - th1.getBoundingClientRect().right) * 10) / 10 : 0
            };
        }""", table_selector)
        if not geom:
            return
        print(f"[{page_name}] Scale: Thead={geom['theadHeight']}px, Row={geom['rowHeight']}px, Gap={geom['gapTh']}px")
        assert geom['theadHeight'] == 40, f"[{page_name}] Thead height violated! Expected 40px, got {geom['theadHeight']}px"
        if geom['rowHeight']:
            assert 37 <= geom['rowHeight'] <= 41, f"[{page_name}] Row height violated! Expected 38px~40px, got {geom['rowHeight']}px"
        assert geom['gapTh'] <= 0.5, f"[{page_name}] Micro-gap between Col 1 and Col 2 detected! Gap={geom['gapTh']}px"""

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
    assert_table_geometry("#monthly-data-table", "Monthly Settlement")
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
    assert_table_geometry("#wire-data-table", "Wire Transfer")
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
    assert_table_geometry("#reim-data-table", "Reimbursement Picker")
    print("[PASS] Reimbursement Picker verified!")

    # =========================================================================
    # Test 4: Contract Workbench (/desk/contract-workbench)
    # =========================================================================
    print("\n--- Testing 4: Contract Workbench ---")
    page.goto(f"{SITE_URL}/desk/contract-workbench")
    page.wait_for_selector("#contract-data-table", timeout=15000)
    page.wait_for_timeout(2000)

    contract_headers = [h.strip() for h in page.locator("#contract-data-table thead th").all_text_contents() if h.strip()]
    print(f"Contract Headers: {contract_headers}")
    assert "所属公司" in contract_headers, "Missing 所属公司 in contract headers"
    assert "合同编号" in contract_headers, "Missing 合同编号 in contract headers"
    assert "单据状态" in contract_headers, "Missing 单据状态 in contract headers"
    assert "单据日期" in contract_headers, "Missing 单据日期 in contract headers"
    assert "合同标题" in contract_headers, "Missing 合同标题 in contract headers"
    assert "供应商" in contract_headers, "Missing 供应商 in contract headers"
    print("[PASS] Contract Workbench verified!")

    # =========================================================================
    # Test 5: Material Request Workbench (/desk/material-request-workbench)
    # =========================================================================
    print("\n--- Testing 5: Material Request Workbench ---")
    page.goto(f"{SITE_URL}/desk/material-request-workbench")
    page.wait_for_selector("#picker-table-thead", timeout=15000)
    page.wait_for_timeout(2000)

    mr_headers = [h.strip() for h in page.locator("#picker-table-thead th").all_text_contents() if h.strip()]
    print(f"Material Request Headers: {mr_headers}")
    assert "制单人" in mr_headers, "Missing 制单人 in material request headers"
    assert_table_geometry("#picker-data-table", "Material Request")
    print("[PASS] Material Request Workbench verified!")

    # =========================================================================
    # Test 6: Material Receipt Workbench (/desk/material-receipt-workbench)
    # =========================================================================
    print("\n--- Testing 6: Material Receipt Workbench ---")
    page.goto(f"{SITE_URL}/desk/material-receipt-workbench")
    page.wait_for_selector("#picker-table-thead", timeout=15000)
    page.wait_for_timeout(2000)

    receipt_headers = [h.strip() for h in page.locator("#picker-table-thead th").all_text_contents() if h.strip()]
    print(f"Material Receipt Headers: {receipt_headers}")
    assert "过账日期" not in receipt_headers, "Found '过账日期' in receipt headers! Should be '单据日期'"
    assert "单据日期" in receipt_headers, "Missing '单据日期' in receipt headers"
    assert_table_geometry("#picker-data-table", "Material Receipt")
    print("[PASS] Material Receipt Workbench verified without '过账日期'!")

    # =========================================================================
    # Test 7: Procurement Execution Workbench (/desk/procurement-execution-workbench)
    # =========================================================================
    print("\n--- Testing 7: Procurement Execution Workbench ---")
    page.goto(f"{SITE_URL}/desk/procurement-execution-workbench")
    page.wait_for_selector("#picker-table-thead", timeout=15000)
    page.wait_for_timeout(2000)

    exec_headers = [h.strip() for h in page.locator("#picker-table-thead th").all_text_contents() if h.strip()]
    print(f"Procurement Execution Headers: {exec_headers}")
    print("[PASS] Procurement Execution Workbench verified!")

    # Check console errors
    print(f"\nTotal Console Errors: {len(errors)}")
    assert len(errors) == 0, f"Found console errors: {errors}"
    print("[ALL PASS] All 7 workbenches verified live with 0 errors!")
    browser.close()
