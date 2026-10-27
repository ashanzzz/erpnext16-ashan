import os
import sys
import time
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "Administrator")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "admin")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

console_errors = []

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    def handle_console(msg):
        text = msg.text
        if msg.type == "error":
            if "socket.io" in text or "favicon" in text:
                return
            console_errors.append(text)
            print(f"[CONSOLE ERROR] {text}")

    page.on("console", handle_console)

    print("Logging in...")
    page.goto(f"{SITE_URL}/login")
    page.wait_for_selector("#login_email", timeout=15000)
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_url("**/desk**", timeout=20000)
    print("Login successful.")

    # 1. Test material-request-workbench
    print("Testing material-request-workbench...")
    page.goto(f"{SITE_URL}/desk/material-request-workbench")
    page.wait_for_selector("#picker-main-table-scroll", timeout=15000)
    page.wait_for_timeout(2000)

    mr_metrics = page.evaluate('''() => {
        const box = document.querySelector("#picker-main-table-scroll");
        const rect = box.getBoundingClientRect();
        const winH = window.innerHeight;
        const outerScrollable = document.documentElement.scrollHeight > winH + 10;
        const fitAttr = box.dataset.pickerViewportFit;
        const heightVar = box.style.getPropertyValue("--picker-active-table-height");
        const bottomGap = winH - rect.bottom;
        const table = box.querySelector('table');
        const spacer = document.querySelector('.picker-viewport-spacer-row');
        return {
            tableHeight: table ? table.getBoundingClientRect().height : null,
            boxClientHeight: box.clientHeight,
            hasSpacer: !!spacer,
            spacerStyle: spacer ? spacer.getAttribute('style') : null,
            spacerTdHeight: spacer && spacer.querySelector('td') ? getComputedStyle(spacer.querySelector('td')).height : null,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            winH,
            bottomGap,
            fitAttr,
            heightVar,
            outerScrollable
        };
    }''')
    print("MR Metrics:", mr_metrics)

    page.screenshot(path=str(out_dir / "verify_mr_viewport_fit.png"))
    print("Saved MR screenshot to verify_mr_viewport_fit.png")

    # 2. Test procurement-execution-workbench
    print("Testing material-receipt-workbench...")
    page.goto(f"{SITE_URL}/desk/material-receipt-workbench")
    page.wait_for_selector("#picker-main-table-scroll", timeout=15000)
    page.wait_for_timeout(2000)

    po_metrics = page.evaluate('''() => {
        const box = document.querySelector("#picker-main-table-scroll");
        const rect = box.getBoundingClientRect();
        const winH = window.innerHeight;
        const outerScrollable = document.documentElement.scrollHeight > winH + 10;
        const fitAttr = box.dataset.pickerViewportFit;
        const heightVar = box.style.getPropertyValue("--picker-active-table-height");
        const bottomGap = winH - rect.bottom;
        return {
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            winH,
            bottomGap,
            fitAttr,
            heightVar,
            outerScrollable
        };
    }''')
    print("PO Metrics:", po_metrics)

    page.screenshot(path=str(out_dir / "verify_pr_viewport_fit.png"))
    print("Saved PO screenshot to verify_po_viewport_fit.png")

    browser.close()

if console_errors:
    print(f"FAILED: {len(console_errors)} console errors found!")
    sys.exit(1)
else:
    print("SUCCESS: 0 console errors, table viewport fitting verified!")
