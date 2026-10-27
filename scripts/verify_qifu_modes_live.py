# -*- coding: utf-8 -*-
import os, sys, json, time
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
    def on_console(msg):
        if msg.type == "error":
            txt = msg.text
            if "favicon" not in txt and "socket.io" not in txt:
                errors.append(txt)
                print(f"[CONSOLE error] {txt}")

    page.on("console", on_console)
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
    page.wait_for_timeout(3500)

    # Make sure month is 2026-07
    page.evaluate("$('#qifu-month-select').val('2026-07').trigger('change');")
    page.wait_for_timeout(2000)

    # Click Tab 0 to make it active and visible
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_selector("#tbody-salary-main tr.qifu-salary-row", timeout=15000)
    page.wait_for_timeout(1000)

    # 3. Check Tab 0 rows
    print("3. Checking Tab 0 (外部实发主表) salary_mode alignment...")
    tab0_rows = page.evaluate("""() => {
        const rows = document.querySelectorAll('#tbody-salary-main tr.qifu-salary-row');
        return Array.from(rows).map(tr => {
            const eno = tr.getAttribute('data-emp-no') || '';
            const name = tr.querySelector('.qifu-emp-name-text')?.innerText || '';
            const pill = tr.querySelector('.qifu-mode-pill');
            const mode = pill ? pill.innerText.trim() : '';
            const pillClass = pill ? pill.className : '';
            const net = tr.querySelector('td.qifu-val-green')?.innerText.trim() || '';
            const gross = tr.querySelector('td.qifu-val-blue')?.innerText.trim() || '';
            return { eno, name, mode, pillClass, net, gross };
        });
    }""")

    print(f"Tab 0 rows count: {len(tab0_rows)}")
    for r in tab0_rows:
        print(f"  {r['eno']:<8} {r['name']:<10} 模式: {r['mode']:<14} 样式: {r['pillClass']} 实发: {r['net']}")

    tab0_screenshot = str(out_dir / "qifu_tab0_modes.png")
    page.screenshot(path=tab0_screenshot)
    print(f"Saved {tab0_screenshot}")

    # 4. Check Tab 1 (员工薪酬档案)
    print("4. Switching to Tab 1 (员工薪酬档案)...")
    page.click("button.qifu-tab-btn[data-tab='employees']")
    page.wait_for_timeout(2500)

    tab1_rows = page.evaluate("""() => {
        const rows = document.querySelectorAll('#tbody-qifu-emp tr.qifu-emp-row');
        return Array.from(rows).map(tr => {
            const eno = tr.getAttribute('data-emp-no') || '';
            const name = tr.querySelector('.qifu-employee-name')?.innerText.trim() || '';
            const pill = tr.querySelector('.qifu-mode-pill');
            const mode = pill ? pill.innerText.trim() : '';
            const pillClass = pill ? pill.className : '';
            const fixedSalaryCell = tr.querySelectorAll('td.qifu-money-cell')[0]?.innerText.trim() || '';
            return { eno, name, mode, pillClass, fixedSalaryCell };
        });
    }""")

    print(f"Tab 1 rows count: {len(tab1_rows)}")
    for r in tab1_rows:
        print(f"  {r['eno']:<8} {r['name']:<10} 模式: {r['mode']:<14} 固定工资: {r['fixedSalaryCell']}")

    tab1_screenshot = str(out_dir / "qifu_tab1_modes.png")
    page.screenshot(path=tab1_screenshot)
    print(f"Saved {tab1_screenshot}")

    # 5. Open Detail Dialog in Tab 0 for 徐凤云
    print("5. Switching back to Tab 0 to inspect Detail Dialog for 徐凤云...")
    page.click("button.qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(1500)

    # Click detail for QF0068
    page.evaluate("""() => {
        const tr = document.querySelector('#tbody-salary-main tr[data-emp-no=\"QF0068\"]');
        if (tr) {
            const btn = tr.querySelector('.btn-view-salary-detail');
            if (btn) btn.click();
        }
    }""")
    page.wait_for_timeout(1000)

    detail_modal_check = page.evaluate("""() => {
        const modal = document.querySelector('.modal.show, .modal[style*=\"display: block\"]');
        if (!modal) return { open: false };
        const title = modal.querySelector('.modal-title')?.innerText || '';
        const modeText = modal.querySelector('.qifu-detail-emp-header .qifu-mode-pill')?.innerText || '';
        const fixedItem = modal.querySelector('.qifu-detail-section .qifu-detail-item-val')?.innerText || '';
        const netHighlight = modal.querySelector('.qifu-detail-highlight-val')?.innerText || '';
        return { open: true, title, modeText, fixedItem, netHighlight };
    }""")

    print("Detail modal check:", detail_modal_check)
    detail_screenshot = str(out_dir / "qifu_detail_modal.png")
    page.screenshot(path=detail_screenshot)
    print(f"Saved {detail_screenshot}")

    # Close modal
    page.evaluate("""() => {
        const closeBtn = document.querySelector('.modal.show .btn-primary, .modal.show .modal-header .close');
        if (closeBtn) closeBtn.click();
    }""")
    page.wait_for_timeout(800)

    # 6. Check Edit Employee Dialog for 徐凤云 in Tab 1
    print("6. Testing Edit Employee Dialog for 徐凤云 in Tab 1...")
    page.click("button.qifu-tab-btn[data-tab='employees']")
    page.wait_for_timeout(1500)

    page.evaluate("""() => {
        const tr = document.querySelector('#tbody-qifu-emp tr[data-emp-no=\"QF0068\"]');
        if (tr) {
            const btn = tr.querySelector('.btn-edit-emp');
            if (btn) btn.click();
        }
    }""")
    page.wait_for_timeout(1200)

    edit_dialog_check = page.evaluate("""() => {
        const modal = document.querySelector('.modal.show, .modal[style*=\"display: block\"]');
        if (!modal) return { open: false };
        const title = modal.querySelector('.modal-title')?.innerText || '';
        const salaryMode = modal.querySelector('select[data-fieldname=\"salary_mode\"]')?.value || '';
        const fixedSalary = modal.querySelector('input[data-fieldname=\"fixed_salary\"]')?.value || '';
        const fixedVisible = modal.querySelector('[data-fieldname=\"fixed_salary\"]')?.offsetParent !== null;
        const minimizeBtn = modal.querySelector('.btn-modal-minimize');
        const minimizeVisible = minimizeBtn ? window.getComputedStyle(minimizeBtn).display !== 'none' : false;
        return { open: true, title, salaryMode, fixedSalary, fixedVisible, minimizeVisible };
    }""")

    print("Edit dialog check:", edit_dialog_check)
    edit_screenshot = str(out_dir / "qifu_edit_dialog.png")
    page.screenshot(path=edit_screenshot)
    print(f"Saved {edit_screenshot}")

    # Close edit modal
    page.evaluate("""() => {
        const closeBtn = document.querySelector('.modal.show .modal-header .close, .modal.show .btn-modal-close');
        if (closeBtn) closeBtn.click();
    }""")
    page.wait_for_timeout(800)

    browser.close()
    print(f"\nLive Playwright test completed successfully with {len(errors)} console errors.")
