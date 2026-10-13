import os
import sys
import time
from pathlib import Path
import json
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
for _ in range(15):
    try:
        response = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if response.status_code == 200:
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
    def record_console_error(message):
        if message.type != "error":
            return
        txt = message.text
        if "favicon" not in txt and "socket.io" not in txt:
            errors.append(txt)
            print(f"[CONSOLE error] {txt}")

    page.on("console", record_console_error)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    print("Logged in successfully!")

    print("2. Navigating to /desk/qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(4000)

    audit = page.evaluate("""() => {
        const titleBadge = document.querySelector('.qifu-title-badge');
        const titleText = document.querySelector('.qifu-title span#qifu-company-title')?.innerText || '';
        const hubVisible = Boolean(document.querySelector('.qifu-workflow-hub'));

        const labels = Array.from(document.querySelectorAll('.qifu-header-controls label')).map(l => {
            const cs = window.getComputedStyle(l);
            return { text: l.innerText, color: cs.color, fontWeight: cs.fontWeight };
        });

        const companySelect = document.querySelector('#qifu-company-select');
        const companySelectCs = companySelect ? window.getComputedStyle(companySelect) : null;

        const tabs = Array.from(document.querySelectorAll('.qifu-tab-btn')).map(t => {
            const dot = t.querySelector('.tab-status-dot');
            let dotStatus = 'none';
            if (dot) {
                if (dot.classList.contains('status-ok')) dotStatus = 'green(ok)';
                else if (dot.classList.contains('status-warn')) dotStatus = 'yellow(warn)';
                else if (dot.classList.contains('status-err')) dotStatus = 'red(err)';
                else dotStatus = 'present';
            }
            return {
                text: t.innerText.trim(),
                hasDot: Boolean(dot),
                dotStatus: dotStatus,
                hasRoleSpan: Boolean(t.querySelector('.qifu-tab-role'))
            };
        });

        const lockBtn = document.querySelector('#btn-qifu-header-lock');

        return {
            titleText,
            hasTitleBadge: Boolean(titleBadge),
            hubVisible,
            labels,
            companySelect: companySelectCs ? { color: companySelectCs.color, bg: companySelectCs.backgroundColor } : null,
            tabs,
            lockBtnText: lockBtn ? lockBtn.innerText : null
        };
    }""")

    print("Audit Result:")
    print(json.dumps(audit, indent=2, ensure_ascii=False))

    screenshot_path = str(out_dir / "live_qifu_synced_benchmark.png")
    page.screenshot(path=screenshot_path)
    print(f"Saved {screenshot_path}")

    print("3. Navigating to /desk/jizhong-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    page.wait_for_timeout(4000)
    page.screenshot(path=str(out_dir / "live_jizhong_benchmark.png"))
    print("Saved live_jizhong_benchmark.png")

    browser.close()
    print(f"Finished with {len(errors)} console errors.")