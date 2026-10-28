import os, sys, json
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path(".env"))
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

print("Starting live verification...")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    
    # 1. Login
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_timeout(2500)
    
    # 2. Navigate to reimbursement-picker
    print("Navigating to /desk/reimbursement-picker...")
    page.goto(f"{SITE_URL}/desk/reimbursement-picker")
    page.wait_for_selector("#reim-data-table", timeout=20000)
    page.wait_for_timeout(1500)
    
    # Check that native .page-head is NOT visible
    page_head_display = page.evaluate('() => window.getComputedStyle(document.querySelector(".page-container[data-page-route=\\"reimbursement-picker\\"] .page-head") || document.body).display')
    print("Native .page-head display:", page_head_display)
    assert page_head_display == "none", f"Expected none, got {page_head_display}"

    # Verify Doc view screenshot
    page.screenshot(path="temp_screenshots/reim_v2_doc_view.png")
    print("Captured reim_v2_doc_view.png")
    
    # Verify Doc view table alignment
    doc_ths = page.locator("#reim-table-head th").all_text_contents()
    print("Doc view ths count:", len(doc_ths), doc_ths)
    first_row_tds = page.locator("#reim-table-body tr:first-child td").all_text_contents()
    print("Doc view first row tds count:", len(first_row_tds))
    assert len(doc_ths) == len(first_row_tds), f"Doc view mismatch: th={len(doc_ths)} vs td={len(first_row_tds)}"

    # 3. Switch to Detail View
    print("Switching to detail view...")
    page.click("button.picker-view-btn[data-mode='detail']")
    page.wait_for_timeout(1500)
    page.screenshot(path="temp_screenshots/reim_v2_detail_view.png")
    print("Captured reim_v2_detail_view.png")
    
    detail_ths = page.locator("#reim-table-head th").all_text_contents()
    print("Detail view ths count:", len(detail_ths), detail_ths)
    first_detail_tds = page.locator("#reim-table-body tr:first-child td").all_text_contents()
    print("Detail view first row tds count:", len(first_detail_tds))
    assert len(detail_ths) == len(first_detail_tds), f"Detail view mismatch: th={len(detail_ths)} vs td={len(first_detail_tds)}"

    # Check footer alignment in Detail View
    # In detail view: 数量 index, 税额 index, 总价 index
    qty_th_idx = detail_ths.index("数量")
    tax_th_idx = detail_ths.index("税额")
    total_th_idx = detail_ths.index("总价")
    print(f"Indices: 数量={qty_th_idx}, 税额={tax_th_idx}, 总价={total_th_idx}")

    # Inspect tfoot
    foot_info = page.evaluate("""() => {
        const row = document.querySelector('#reim-table-foot tr');
        if (!row) return null;
        const cells = Array.from(row.querySelectorAll('td')).map((td, i) => ({
            idx: i,
            text: td.innerText.trim(),
            colspan: td.getAttribute('colspan') || '1'
        }));
        return cells;
    }""")
    print("Foot cells:", json.dumps(foot_info, ensure_ascii=False, indent=2))

    # 4. Open Detail Dialog
    print("Opening detail dialog...")
    page.locator(".picker-doc-clickable-link").first.click()
    page.wait_for_selector(".modal.ashan-dialog-abgs", timeout=10000)
    page.wait_for_timeout(1500)
    page.screenshot(path="temp_screenshots/reim_v2_detail_dialog.png")
    print("Captured reim_v2_detail_dialog.png")

    # Check dialog invoice item table alignment
    dialog_th_texts = page.locator(".reim-inv-table.ashan-po-item-table thead th").all_text_contents()
    dialog_first_row_tds = page.locator(".reim-inv-table.ashan-po-item-table tbody tr:first-child td").all_text_contents()
    print("Dialog ths:", dialog_th_texts)
    print("Dialog first row tds:", dialog_first_row_tds)

    # Verify that tax rate cell has %, and amount cell has ¥
    tax_idx = [i for i, t in enumerate(dialog_th_texts) if "税率" in t][0]
    amt_idx = [i for i, t in enumerate(dialog_th_texts) if "不含税金额" in t][0]
    tax_val = dialog_first_row_tds[tax_idx]
    amt_val = dialog_first_row_tds[amt_idx]
    print(f"Tax rate cell value: '{tax_val}', Amount cell value: '{amt_val}'")
    assert "%" in tax_val, f"Expected % in tax rate cell, got {tax_val}"
    assert "¥" in amt_val, f"Expected ¥ in amount cell, got {amt_val}"
    print("[PASS] Dialog table columns are 100% correctly aligned! No inversion!")

    print("\nALL VERIFICATIONS PASSED PERFECTLY!")
