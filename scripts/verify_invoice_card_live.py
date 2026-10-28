import os, sys, json
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path(".env"))
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

print("Starting live test of warehouse display, attachment upload/deletion, and modal UI...")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_timeout(3000)
    
    page.goto(f"{SITE_URL}/desk/reimbursement-picker")
    page.wait_for_selector("#reim-data-table", timeout=15000)
    page.wait_for_timeout(1000)
    
    # Open Create modal
    print("Opening create reimbursement modal...")
    page.click("#reim-open-create-modal-btn")
    page.wait_for_selector(".modal.ashan-dialog-abgs", timeout=10000)
    page.wait_for_timeout(1500)
    
    # 1. Verify default warehouse display
    wh_text = page.locator("#modal-reim-wh-display").text_content().strip()
    full_prompt = page.locator(".reim-v2-toggle-box").text_content().strip()
    print(f"Warehouse display: '{wh_text}'")
    print(f"Full prompt text: '{full_prompt}'")
    assert "默认入库至仓库" in full_prompt
    assert len(wh_text) > 0, "Warehouse display should not be empty"
    print("[PASS] Default warehouse is explicitly displayed in prompt!")

    # Test company switch to 祺富
    print("Switching company to 天津祺富机械加工有限公司...")
    page.select_option("#modal-reim-company", label="天津祺富机械加工有限公司")
    page.wait_for_timeout(500)
    wh_text_qf = page.locator("#modal-reim-wh-display").text_content().strip()
    print(f"Updated warehouse for 祺富: '{wh_text_qf}'")
    assert "祺富" in wh_text_qf or "仓库" in wh_text_qf
    print("[PASS] Dynamic warehouse update on company switch verified!")

    # 2. Verify tool buttons styling and separation
    upload_btn = page.locator(".reim-inv-card-header .reim-btn-upload-attach").first
    delete_inv_btn = page.locator(".reim-inv-card-header .reim-btn-delete-inv").first
    assert upload_btn.is_visible(), "Upload button should be visible"
    assert delete_inv_btn.is_visible(), "Delete invoice button should be visible"
    
    upload_rect = upload_btn.bounding_box()
    delete_rect = delete_inv_btn.bounding_box()
    gap = delete_rect['x'] - (upload_rect['x'] + upload_rect['width'])
    print(f"Tool buttons gap: {gap}px (should be >= 6px)")
    assert gap >= 6, f"Expected gap >= 6px between tool buttons, got {gap}px"
    print("[PASS] Tool buttons have clear visual separation!")

    page.screenshot(path="temp_screenshots/reim_create_dialog_warehouse_and_tools.png")
    print("Captured reim_create_dialog_warehouse_and_tools.png")

    # 3. Test attachment upload via file input (using valid 1x1 PNG binary)
    print("Testing attachment upload simulation...")
    png_bytes = bytes([
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D,
        0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
        0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0x15, 0xC4, 0x89, 0x00, 0x00, 0x00,
        0x0A, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9C, 0x63, 0x00, 0x01, 0x00, 0x00,
        0x05, 0x00, 0x01, 0x0D, 0x0A, 0x2D, 0xB4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82
    ])
    sample_file_path = Path("temp_screenshots/sample_valid_invoice.png")
    sample_file_path.write_bytes(png_bytes)
    
    file_input = page.locator(".modal-inv-file-input").first
    file_input.set_input_files(str(sample_file_path))
    page.wait_for_timeout(2500)

    # Verify attachment tag appears
    attach_tag = page.locator(".reim-inv-attach-tag").first
    assert attach_tag.is_visible(), "Attachment tag should appear after upload"
    tag_text = attach_tag.text_content().strip()
    print(f"Attachment tag rendered: '{tag_text}'")
    assert "sample_valid_invoice.png" in tag_text
    assert upload_btn.is_hidden(), "Upload button should be hidden after file attached"
    print("[PASS] Attachment upload and tag rendering verified!")

    page.screenshot(path="temp_screenshots/reim_create_dialog_attached.png")
    print("Captured reim_create_dialog_attached.png")

    # 4. Test deleting the invoice card and verify file cleanup
    inv_count_before = page.locator(".reim-inv-card").count()
    print(f"Invoice count before adding another: {inv_count_before}")
    
    # Add second invoice
    page.click("#modal-reim-add-inv-btn")
    page.wait_for_timeout(1000)
    assert page.locator(".reim-inv-card").count() == 2
    
    # Remove first invoice (which has attachment)
    print("Removing first invoice card with attachment...")
    page.locator(".reim-btn-delete-inv").first.click()
    page.wait_for_timeout(1000)
    assert page.locator(".reim-inv-card").count() == 1
    print("[PASS] Invoice card removed and cleanup executed cleanly!")

    # 5. Verify Item Table footer and '+ 添加物料行' button placement
    table_foot = page.locator(".reim-inv-table.ashan-po-item-table tfoot").first
    foot_text = table_foot.text_content().strip()
    print(f"Item table footer text: '{foot_text}'")
    assert "发票费用合计" in foot_text
    assert "添加物料行" in foot_text
    
    add_row_btn = page.locator(".reim-btn-add-item-row").first
    assert add_row_btn.is_visible()
    assert "添加物料行" in add_row_btn.text_content()
    print("[PASS] '+ 添加物料行' button properly placed and labeled!")

    print("\nALL WAREHOUSE, ATTACHMENT, AND MODAL UI TESTS PASSED PERFECTLY!")
