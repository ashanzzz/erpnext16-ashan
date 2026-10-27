# -*- coding: utf-8 -*-
import os, sys, json, time
from pathlib import Path
import requests
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

print("Checking site readiness...")
for _ in range(25):
    try:
        r = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if r.status_code == 200:
            print("Site is ready!")
            break
    except Exception:
        pass
    time.sleep(1)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.wait_for_selector("#login_email", timeout=15000)
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    print("Logged in successfully!")

    print("2. Navigating to /desk/qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    page.wait_for_timeout(2500)

    # Set period to 2026-07
    page.evaluate("$('#qifu-month-select').val('2026-07').trigger('change');")
    page.wait_for_timeout(2000)

    # Click Tab 2: 外部实发主表
    print("3. Switching to Tab: 外部实发主表 (salary_main)...")
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_selector("#tbody-salary-main tr.qifu-salary-row", timeout=15000)
    page.wait_for_timeout(1000)

    # 4. Verify Toolbar state when file is uploaded
    print("4. Verifying Toolbar Button state...")
    tb_info = page.evaluate("""() => {
        const actionBtn = document.querySelector("#btn-salary-integrated-action");
        const sourceBadge = document.querySelector("#salary-main-source-badge");
        const viewProofBtn = document.querySelector("#btn-salary-view-proof");
        const reuploadBtn = document.querySelector("#btn-salary-reupload");
        const scopeFilter = document.querySelector("#salary-main-scope-filter");
        return {
            actionBtnText: actionBtn ? actionBtn.innerText.trim() : "",
            actionBtnClass: actionBtn ? actionBtn.className : "",
            actionBtnVisible: actionBtn ? window.getComputedStyle(actionBtn).display !== "none" : false,
            sourceBadgeHidden: sourceBadge ? (sourceBadge.classList.contains("hide") || window.getComputedStyle(sourceBadge).display === "none") : true,
            viewProofHidden: viewProofBtn ? (viewProofBtn.classList.contains("hide") || window.getComputedStyle(viewProofBtn).display === "none") : true,
            reuploadHidden: reuploadBtn ? (reuploadBtn.classList.contains("hide") || window.getComputedStyle(reuploadBtn).display === "none") : true,
            scopeFilterVisible: scopeFilter ? window.getComputedStyle(scopeFilter).display !== "none" : false,
        };
    }""")
    print("Toolbar Audit:", json.dumps(tb_info, indent=2, ensure_ascii=False))
    assert tb_info["actionBtnText"] == "附件信息", f"Expected button text '附件信息', got '{tb_info['actionBtnText']}'"
    assert "jz-btn-blue" not in tb_info["actionBtnClass"], "Expected jz-btn-blue to be removed for standard button"
    assert tb_info["sourceBadgeHidden"], "Expected source badge with long filename to be hidden!"
    assert tb_info["viewProofHidden"], "Expected viewProof button in toolbar to be hidden!"
    assert tb_info["reuploadHidden"], "Expected reupload button in toolbar to be hidden!"

    page.screenshot(path=str(out_dir / "qifu_toolbar_attachment_btn.png"), full_page=False)

    # 5. Click "附件信息" and inspect Modal
    print("5. Clicking [附件信息] button...")
    page.click("#btn-salary-integrated-action")
    page.wait_for_selector(".modal-dialog .qifu-proof-modal-card", state="visible", timeout=10000)
    page.wait_for_timeout(1000)

    modal_info = page.evaluate("""() => {
        const modal = document.querySelector(".modal-dialog");
        const card = document.querySelector(".modal-dialog .qifu-proof-modal-card");
        const title = modal.querySelector(".modal-title") ? modal.querySelector(".modal-title").innerText.trim() : "";
        const badge = card.querySelector(".qifu-status-badge") ? card.querySelector(".qifu-status-badge").innerText.trim() : "";
        const sub = card.querySelector(".qifu-compare-modal-sub") ? card.querySelector(".qifu-compare-modal-sub").innerText.trim() : "";
        
        const items = Array.from(card.querySelectorAll(".qifu-detail-item")).map(it => {
            const lbl = it.querySelector(".qifu-detail-item-label") ? it.querySelector(".qifu-detail-item-label").innerText.trim() : "";
            const val = it.querySelector(".qifu-detail-item-val") ? it.querySelector(".qifu-detail-item-val").innerText.trim() : "";
            return { label: lbl, value: val };
        });

        const actions = Array.from(card.querySelectorAll(".qifu-attachment-dialog-actions button")).map(b => b.innerText.trim());

        return { title, badge, sub, items, actions };
    }""")
    print("Attachment Modal Audit:", json.dumps(modal_info, indent=2, ensure_ascii=False))

    assert "附件信息" in modal_info["title"], f"Modal title mismatch: {modal_info['title']}"
    assert "2026-07" in modal_info["sub"], f"Period mismatch: {modal_info['sub']}"
    assert any(it["label"] == "解析账期年月" and it["value"] == "2026-07" for it in modal_info["items"])
    assert any(it["label"] == "实发合计金额 (税后)" and "118,441.00" in it["value"] for it in modal_info["items"])
    assert any(it["label"] == "补贴合计总额" and "10,350.00" in it["value"] for it in modal_info["items"])
    assert "查看原件" in modal_info["actions"]
    assert "重新上传" in modal_info["actions"]
    assert "删除附件" in modal_info["actions"]

    page.screenshot(path=str(out_dir / "qifu_attachment_dialog.png"), full_page=False)
    print("Screenshot saved to qifu_attachment_dialog.png")

    # Close modal via cur_dialog.hide()
    page.evaluate("cur_dialog && cur_dialog.hide();")
    page.wait_for_timeout(1000)

    # 6. Test a month with no uploaded excel, e.g. 2026-01
    print("6. Testing a month with no uploaded workshop salary (2026-01)...")
    page.evaluate("$('#qifu-month-select').val('2026-01').trigger('change');")
    page.wait_for_timeout(2000)
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(1000)

    empty_tb_info = page.evaluate("""() => {
        const actionBtn = document.querySelector("#btn-salary-integrated-action");
        return {
            text: actionBtn ? actionBtn.innerText.trim() : "",
            isPrimary: actionBtn ? actionBtn.classList.contains("btn-primary") : false,
        };
    }""")
    print("Empty Month Toolbar Button Audit:", json.dumps(empty_tb_info, indent=2, ensure_ascii=False))
    assert empty_tb_info["text"] == "上传原件", f"Expected '上传原件' when empty, got '{empty_tb_info['text']}'"
    assert empty_tb_info["isPrimary"], "Expected primary button styling for 上传原件"
    page.screenshot(path=str(out_dir / "qifu_toolbar_upload_btn_empty.png"), full_page=False)

    print("\nALL VERIFICATIONS PASSED SUCCESSFULLY!")
    if errors:
        print(f"Console errors: {errors}")
    else:
        print("0 Console errors detected!")
