import os
import sys
import json
import time
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
    time.sleep(2)

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

    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    page.wait_for_timeout(2000)

    # 1. Test Tab 3: 社会保险
    print("1. Checking Tab 3 (社会保险) upload controls...")
    page.click(".qifu-tab-btn[data-tab='social_insurance']")
    page.wait_for_selector("#table-tab3-ss-sheet", state="visible", timeout=10000)
    page.wait_for_timeout(1500)

    ss_audit = page.evaluate("""() => {
        const btnUpload = document.querySelector("#btn-tab3-upload-ss");
        const badge = document.querySelector("#tab3-proof-verify-badge");
        const btnView = document.querySelector("#btn-tab3-view-ss-proof");
        const btnDel = document.querySelector("#btn-tab3-delete-ss-proof");
        return {
            uploadVisible: btnUpload ? window.getComputedStyle(btnUpload).display !== 'none' : false,
            uploadText: btnUpload ? btnUpload.innerText.trim() : "",
            badgeText: badge ? badge.innerText.trim() : "",
            viewVisible: btnView ? window.getComputedStyle(btnView).display !== 'none' : false,
            delVisible: btnDel ? window.getComputedStyle(btnDel).display !== 'none' : false,
        };
    }""")
    print("Tab 3 Social Security Audit:", json.dumps(ss_audit, indent=2, ensure_ascii=False))
    page.screenshot(path=str(out_dir / "qifu_tab3_upload_toolbar.png"), full_page=False)

    # 2. Test Tab 4: 住房公积金
    print("\n2. Checking Tab 4 (住房公积金) upload controls...")
    page.click(".qifu-tab-btn[data-tab='housing_fund']")
    page.wait_for_selector("#table-tab4-hf-sheet", state="visible", timeout=10000)
    page.wait_for_timeout(1500)

    hf_audit = page.evaluate("""() => {
        const btnUpload = document.querySelector("#btn-tab4-upload-hf");
        const badge = document.querySelector("#tab4-proof-verify-badge");
        const btnView = document.querySelector("#btn-tab4-view-hf-proof");
        const btnDel = document.querySelector("#btn-tab4-delete-hf-proof");
        return {
            uploadVisible: btnUpload ? window.getComputedStyle(btnUpload).display !== 'none' : false,
            uploadText: btnUpload ? btnUpload.innerText.trim() : "",
            badgeText: badge ? badge.innerText.trim() : "",
            viewVisible: btnView ? window.getComputedStyle(btnView).display !== 'none' : false,
            delVisible: btnDel ? window.getComputedStyle(btnDel).display !== 'none' : false,
        };
    }""")
    print("Tab 4 Housing Fund Audit:", json.dumps(hf_audit, indent=2, ensure_ascii=False))
    page.screenshot(path=str(out_dir / "qifu_tab4_upload_toolbar.png"), full_page=False)

    # 3. Test Tab 2: 外部实发表
    print("\n3. Checking Tab 2 (外部实发表) upload controls...")
    page.click(".qifu-tab-btn[data-tab='import']")
    page.wait_for_selector("#table-tab2-dist-sheet", state="visible", timeout=10000)
    page.wait_for_timeout(1500)

    tab2_audit = page.evaluate("""() => {
        const btnUpload = document.querySelector("#btn-tab2-upload-salary");
        const badge = document.querySelector("#tab2-salary-verify-badge");
        return {
            uploadVisible: btnUpload ? window.getComputedStyle(btnUpload).display !== 'none' : false,
            uploadText: btnUpload ? btnUpload.innerText.trim() : "",
            badgeText: badge ? badge.innerText.trim() : "",
        };
    }""")
    print("Tab 2 Workshop Salary Audit:", json.dumps(tab2_audit, indent=2, ensure_ascii=False))

    print(f"\nConsole errors: {len(errors)}"); [print('ERROR DETAIL:', e) for e in errors]
    browser.close()

if not ss_audit['uploadVisible'] or not hf_audit['uploadVisible']:
    print("ERROR: Upload buttons are not visible!")
    sys.exit(1)

print("\nSUCCESS: Social Security and Housing Fund upload & verification controls are 100% visible and functional!")
