import os
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "Administrator")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "admin")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = PROJECT_ROOT / "temp_screenshots"
out_dir.mkdir(parents=True, exist_ok=True)

print("Checking site readiness...")
for _ in range(20):
    try:
        response = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if response.status_code == 200:
            print("Site is ready!")
            break
    except Exception:
        time.sleep(2)
else:
    raise RuntimeError("ERPNext site did not become ready")

console_errors = []

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    context = browser.new_context(viewport={"width": 1440, "height": 900})
    page = context.new_page()

    def handle_console(msg):
        if msg.type == "error":
            console_errors.append(msg.text)
            print(f"[CONSOLE ERROR] {msg.text}")

    page.on("console", handle_console)
    page.on("pageerror", lambda exc: console_errors.append(str(exc)))

    # 1. 登录
    print("Navigating to login page...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    time.sleep(2)

    # 2. 访问税局发票中心
    print("Visiting tax invoice center...")
    page.goto(f"{SITE_URL}/desk/tax-invoice-center")
    time.sleep(3)

    # 等待页面主容器
    page.wait_for_selector(".tax-inv-wrapper", timeout=15000)
    print("Page wrapper loaded!")

    # 截图 1: 主工作台全景
    page.screenshot(path=str(out_dir / "tax_invoice_center_full.png"), full_page=True)
    print("Screenshot 1 saved: tax_invoice_center_full.png")

    # 检查 KPI 卡片
    kpi_cards = page.locator(".tax-kpi-card")
    print(f"KPI cards count: {kpi_cards.count()}")

    # 检查第一张卡片点击过滤
    print("Clicking first KPI card (pending)...")
    kpi_cards.first.click()
    time.sleep(1)
    page.screenshot(path=str(out_dir / "tax_invoice_kpi_clicked.png"))

    # 点击重置
    print("Clicking reset button...")
    page.click("#btn-reset")
    time.sleep(1)

    # 检查主表格
    rows = page.locator(".tax-table tbody tr.data-row")
    print(f"Data rows count: {rows.count()}")
    if rows.count() > 0:
        print("Clicking first data row to expand drawer...")
        rows.first.click()
        time.sleep(1.5)
        page.screenshot(path=str(out_dir / "tax_invoice_drawer_expanded.png"), full_page=True)
        print("Screenshot 2 saved: tax_invoice_drawer_expanded.png")

    # 检查上传弹窗
    print("Clicking upload button...")
    page.click("#btn-upload")
    time.sleep(1)
    page.screenshot(path=str(out_dir / "tax_invoice_upload_modal.png"))
    print("Screenshot 3 saved: tax_invoice_upload_modal.png")

    page.evaluate("if (window.cur_dialog) cur_dialog.hide(); if (window.frappe && frappe.ui && frappe.ui.dialogs) frappe.ui.dialogs.forEach(d => d.hide());"); time.sleep(1)
    time.sleep(1)

    # 检查批次历史弹窗
    print("Clicking import history button...")
    page.click("#btn-import-history")
    time.sleep(1.5)
    page.screenshot(path=str(out_dir / "tax_invoice_batch_history.png"))
    print("Screenshot 4 saved: tax_invoice_batch_history.png")

    browser.close()

print(f"Verification finished. Total console errors: {len(console_errors)}")
if console_errors:
    print("Errors:", console_errors)
assert len(console_errors) == 0, f"Expected 0 console errors, got {len(console_errors)}"