import os
import sys
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
    page = browser.new_page(viewport={"width": 1600, "height": 1000})

    errors = []
    def record_console_error(msg):
        if msg.type == "error":
            txt = msg.text
            if "favicon" not in txt and "socket.io" not in txt and "map" not in txt:
                errors.append(txt)
                print(f"[CONSOLE ERROR] {txt}")

    page.on("console", record_console_error)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_timeout(3000)

    print("Navigating to /desk/reimbursement-picker...")
    page.goto(f"{SITE_URL}/desk/reimbursement-picker")
    page.wait_for_selector("#reim-data-table", timeout=20000)
    page.wait_for_timeout(2000)

    print("Clicking '新建报销' button...")
    page.click("#reim-open-create-modal-btn")
    page.wait_for_selector(".modal.ashan-dialog-abgs", timeout=10000)
    page.wait_for_timeout(1000)

    # 1. 验证弹窗外壳
    modal = page.locator(".modal.ashan-dialog-abgs")
    assert modal.is_visible(), "Modal with .ashan-dialog-abgs should be visible"
    print("[PASS] Modal with .ashan-dialog-abgs is visible")

    # 2. 验证顶栏标题与关闭按钮
    title_text = page.locator(".modal.ashan-dialog-abgs .modal-title").text_content()
    assert "报销申请明细" in title_text, f"Modal title should contain '报销申请明细', got: {title_text}"
    print(f"[PASS] Modal title: {title_text}")

    close_btn = page.locator(".modal.ashan-dialog-abgs .ashan-po-close-btn")
    assert close_btn.is_visible(), "Top close button .ashan-po-close-btn should be visible"
    print("[PASS] Top close button .ashan-po-close-btn is visible")

    # 3. 验证单据抬头 6 大法定要素对称卡片
    context_card = page.locator(".ashan-po-context-card")
    assert context_card.is_visible(), ".ashan-po-context-card should be visible"
    
    rr_name = page.locator("#field-reim-name").input_value()
    status_text = page.locator("#field-reim-docstatus").text_content().strip()
    date_val = page.locator("#modal-reim-date").input_value()
    applicant_val = page.locator("#modal-reim-applicant").input_value()
    
    creator_label = page.locator(".ashan-po-context-card label").nth(5).text_content().strip()
    assert "制单人" in creator_label, f"Expected 制单人 in label, got {creator_label}"
    print(f"[PASS] 6 Core Elements: RR Name={rr_name}, Status={status_text}, Date={date_val}, Creator={applicant_val}")
    assert "RR-" in rr_name, f"Expected RR- in name, got {rr_name}"
    assert "新建单据" in status_text, f"Expected '新建单据', got {status_text}"

    # 4. 验证发票列表与添加发票按钮
    inv_section = page.locator(".reim-invoice-section")
    assert inv_section.is_visible(), ".reim-invoice-section should be visible"
    add_inv_btn = page.locator("#modal-reim-add-inv-btn")
    assert add_inv_btn.is_visible(), "Add invoice button should be visible"
    assert "\u2795" not in add_inv_btn.text_content(), "Add invoice button should not have emoji"
    print("[PASS] Invoice section and add button verified (zero emoji)")

    # 5. 验证费用明细表格
    table = page.locator(".reim-inv-table.ashan-po-item-table")
    assert table.is_visible(), ".reim-inv-table.ashan-po-item-table should be visible"
    
    thead_text = table.locator("thead").text_content()
    assert "物料/费用项目" in thead_text, "Thead should have '物料/费用项目'"
    assert "数量" in thead_text and "单价" in thead_text, "Thead should have 数量 and 单价"
    print("[PASS] Single-line clean thead verified with required markers")

    # 6. 验证底部三阶操作按钮
    btn_cancel = page.locator("#btn-reim-dialog-cancel")
    btn_draft = page.locator("#btn-reim-dialog-draft")
    btn_submit = page.locator("#btn-reim-dialog-submit")
    assert btn_cancel.is_visible() and btn_cancel.text_content().strip() == "取消", "Cancel button missing"
    assert btn_draft.is_visible() and btn_draft.text_content().strip() == "保存为草稿", "Draft button missing"
    assert btn_submit.is_visible() and btn_submit.text_content().strip() == "保存为正式单据", "Submit button missing"
    print("[PASS] 3-Tier Footer buttons verified: [取消] | [保存为草稿] | [保存为正式单据]")

    # 截取弹窗实机全景图
    screenshot_path = out_dir / "reimbursement_modal_abgs.png"
    page.screenshot(path=str(screenshot_path))
    print(f"[PASS] Screenshot saved to {screenshot_path}")

    browser.close()

    if errors:
        print(f"FAILED: {len(errors)} console errors found: {errors}")
        sys.exit(1)
    else:
        print("\nALL REIMBURSEMENT MODAL VERIFICATIONS PASSED! 0 console errors.")
