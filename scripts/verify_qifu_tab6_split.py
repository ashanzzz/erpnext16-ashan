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
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)

    print("Navigating to Qifu Tab 6 (综合结算)...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector("#table-qifu-emp", state="visible", timeout=15000)

    # Click Tab 6 (综合结算)
    page.click(".qifu-tab-btn[data-tab='settlement']")
    page.wait_for_selector("#table-qifu-payroll", state="visible", timeout=10000)
    page.wait_for_timeout(2500)

    settlement_audit = page.evaluate("""() => {
        const ths = Array.from(document.querySelectorAll("#table-qifu-payroll thead th")).map(th => th.innerText.trim());
        const hasCombined = ths.some(t => t.includes("出勤天/工时"));
        const hasDays = ths.some(t => t.includes("出勤天数"));
        const hasHours = ths.some(t => t.includes("出勤工时"));

        const sampleRow = Array.from(document.querySelectorAll("#tbody-qifu-payroll tr:first-child td")).map(td => td.innerText.trim());

        return {
            headers: ths,
            hasCombined,
            hasDays,
            hasHours,
            sampleRow
        };
    }""")

    print("Qifu Tab 6 Headers:", settlement_audit["headers"])
    print(f"Has Combined '出勤天/工时': {settlement_audit['hasCombined']}")
    print(f"Has '出勤天数': {settlement_audit['hasDays']}")
    print(f"Has '出勤工时': {settlement_audit['hasHours']}")
    print("Sample Row:", settlement_audit["sampleRow"])

    page.screenshot(path=str(out_dir / "qifu_tab6_split_attendance.png"), full_page=False)

    print(f"Console errors: {len(errors)}")
    browser.close()

if settlement_audit['hasCombined'] or not settlement_audit['hasDays'] or not settlement_audit['hasHours']:
    print("ERROR: Column split failed!")
    sys.exit(1)

print("SUCCESS: Qifu 出勤天数 and 出勤工时 are confirmed successfully split into two independent columns!")
