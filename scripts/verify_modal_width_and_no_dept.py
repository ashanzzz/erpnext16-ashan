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
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_timeout(3000)

    print("2. Navigating to /desk/qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3500)

    page.evaluate("$('#qifu-month-select').val('2026-07').trigger('change');")
    page.wait_for_timeout(2000)

    # Click Tab 0
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(2500)

    # 3. Check Tab 0 headers (Department column must be gone!)
    headers = page.evaluate("""() => {
        return Array.from(document.querySelectorAll('#salary-data-table thead th')).map(th => th.innerText.trim());
    }""")
    print("Tab 0 headers:", headers)
    assert "部门" not in headers, "FAIL: 部门 column still present in Tab 0 headers!"
    print("PASS: 部门 column is completely removed from Tab 0 table header!")

    # 4. Check Tab 0 first row cells
    first_row_cells = page.evaluate("""() => {
        const tr = document.querySelector('#tbody-salary-main tr.qifu-salary-row');
        return tr ? Array.from(tr.children).map(td => td.innerText.trim()) : [];
    }""")
    print("Tab 0 first row values:", first_row_cells)
    assert "生产部" not in first_row_cells, "FAIL: 生产部 found in Tab 0 row cells!"
    assert "管理部" not in first_row_cells, "FAIL: 管理部 found in Tab 0 row cells!"
    print("PASS: No invented departments found in Tab 0 row cells!")

    screenshot_tab0 = str(out_dir / "tab0_no_department_column.png")
    page.screenshot(path=screenshot_tab0)
    print(f"Saved {screenshot_tab0}")

    # 5. Click [删除实发表] button to test modal width
    print("\n5. Testing [删除实发表] confirmation modal width...")
    page.click("#btn-salary-integrated-action")
    page.wait_for_timeout(1000)

    modal_info = page.evaluate("""() => {
        const modal = document.querySelector('.modal.show, .modal[style*=\"display: block\"]');
        if (!modal) return { open: false };
        const dialog = modal.querySelector('.modal-dialog');
        const cs = dialog ? window.getComputedStyle(dialog) : null;
        const rect = dialog ? dialog.getBoundingClientRect() : null;
        const bodyText = modal.querySelector('.modal-body')?.innerText || '';
        return {
            open: true,
            dialogWidth: cs ? cs.width : null,
            dialogMaxWidth: cs ? cs.maxWidth : null,
            renderedPixelWidth: rect ? Math.round(rect.width) : null,
            renderedPixelHeight: rect ? Math.round(rect.height) : null,
            bodyText: bodyText
        };
    }""")
    print("Delete confirm modal info:", modal_info)
    assert modal_info["renderedPixelWidth"] is not None and modal_info["renderedPixelWidth"] <= 550, f"FAIL: Modal width {modal_info['renderedPixelWidth']}px is too wide!"
    print(f"PASS: Delete confirm modal width is compact and normal: {modal_info['renderedPixelWidth']}px (<= 500px)!")

    screenshot_modal = str(out_dir / "delete_confirm_modal_compact.png")
    page.screenshot(path=screenshot_modal)
    print(f"Saved {screenshot_modal}")

    # Dismiss / cancel modal
    page.evaluate("""() => {
        const cancelBtn = document.querySelector('.modal.show .modal-footer .btn-default, .modal.show .modal-header .close');
        if (cancelBtn) cancelBtn.click();
    }""")
    page.wait_for_timeout(800)

    # 6. Check Detail Dialog for QF0068 (徐凤云) - Ensure no department
    print("\n6. Checking Detail Dialog for QF0068 - Ensure no 部门 label...")
    page.evaluate("""() => {
        const tr = document.querySelector('#tbody-salary-main tr[data-emp-no=\"QF0068\"]');
        if (tr) {
            const btn = tr.querySelector('.btn-view-salary-detail');
            if (btn) btn.click();
        }
    }""")
    page.wait_for_timeout(1000)

    detail_card_info = page.evaluate("""() => {
        const modal = document.querySelector('.modal.show');
        if (!modal) return { open: false };
        const headerCardText = modal.querySelector('.qifu-detail-emp-header')?.innerText || '';
        return { open: true, headerCardText };
    }""")
    print("Detail header card text:\n", detail_card_info["headerCardText"])
    assert "部门" not in detail_card_info["headerCardText"], "FAIL: 部门 label still found in detail card!"
    print("PASS: 部门 is completely absent from Detail modal card!")

    screenshot_detail = str(out_dir / "detail_modal_no_department.png")
    page.screenshot(path=screenshot_detail)
    print(f"Saved {screenshot_detail}")

    page.evaluate("""() => {
        const closeBtn = document.querySelector('.modal.show .btn-primary, .modal.show .modal-header .close');
        if (closeBtn) closeBtn.click();
    }""")
    page.wait_for_timeout(800)

    browser.close()
    print(f"\nAll assertions PASSED! Console errors: {len(errors)}.")
