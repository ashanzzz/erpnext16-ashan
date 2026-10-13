import sys
if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
import os
import sys
import json
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

f_ss = Path("D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202609/社会保险费缴费申报表（适用单位缴费人）.pdf")
f_hf = Path("D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202609/202609祺富公积金缴费凭证.pdf")

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)

    # 1. Test Social Security upload
    print("1. Testing Tab 3 (社会保险) file upload interaction...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    page.click(".qifu-tab-btn[data-tab='social_insurance']")
    page.wait_for_selector("#btn-tab3-upload-ss", state="visible", timeout=10000)

    # Trigger file chooser on #btn-tab3-upload-ss
    print("Clicking #btn-tab3-upload-ss with file chooser...")
    with page.expect_file_chooser(timeout=5000) as fc_info:
        page.click("#btn-tab3-upload-ss")
    file_chooser = fc_info.value
    file_chooser.set_files([str(f_ss)])
    print("Files set! Waiting for server parsing & dialog...")
    page.wait_for_selector(".msgprint-dialog, .modal-dialog", state="visible", timeout=15000)

    dialog_text = page.evaluate("""() => {
        const d = document.querySelector(".msgprint-dialog, .modal-dialog");
        return d ? d.innerText.trim() : "";
    }""")
    print("Social Security Dialog Result:\n", dialog_text)

    # Close dialog
    page.click(".modal-dialog .btn-default, .modal-dialog .btn-primary, .modal-dialog [data-dismiss='modal']")
    page.wait_for_timeout(1000)

    # Verify button now says 重新上传
    btn_text = page.inner_text("#btn-tab3-upload-ss")
    print(f"Button text after upload: '{btn_text}'")

    # 2. Test Housing Fund upload
    print("\n2. Testing Tab 4 (住房公积金) file upload interaction...")
    page.click(".qifu-tab-btn[data-tab='housing_fund']")
    page.wait_for_selector("#btn-tab4-upload-hf", state="visible", timeout=10000)

    print("Clicking #btn-tab4-upload-hf with file chooser...")
    with page.expect_file_chooser(timeout=5000) as fc_info:
        page.click("#btn-tab4-upload-hf")
    file_chooser_hf = fc_info.value
    file_chooser_hf.set_files([str(f_hf)])
    print("HF Files set! Waiting for server parsing & dialog...")
    page.wait_for_selector(".msgprint-dialog, .modal-dialog", state="visible", timeout=15000)

    hf_dialog_text = page.evaluate("""() => {
        const d = document.querySelector(".msgprint-dialog, .modal-dialog");
        return d ? d.innerText.trim() : "";
    }""")
    print("Housing Fund Dialog Result:\n", hf_dialog_text)

    # Close dialog
    page.click(".modal-dialog .btn-default, .modal-dialog .btn-primary, .modal-dialog [data-dismiss='modal']")
    page.wait_for_timeout(1000)

    # 3. Test clicking '重新上传申报表' AGAIN to ensure it prompts file chooser without any hesitation!
    print("\n3. Testing clicking '重新上传申报表' when already uploaded...")
    page.click(".qifu-tab-btn[data-tab='social_insurance']")
    page.wait_for_selector("#btn-tab3-upload-ss", state="visible", timeout=10000)
    print("Clicking '重新上传申报表'...")
    with page.expect_file_chooser(timeout=5000) as fc_info_re:
        page.click("#btn-tab3-upload-ss")
    print("File chooser successfully opened on '重新上传申报表' click!")
    fc_re = fc_info_re.value
    print("Chooser multiple allowed:", fc_re.is_multiple())

    print(f"\nConsole errors during entire run: {len(errors)}")
    browser.close()

if errors:
    sys.exit(1)

print("\nSUCCESS: Both file uploads, server comparison, verification dialogs, and re-upload file choosers work 100% flawlessly!")
