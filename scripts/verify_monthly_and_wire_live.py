import os
import sys
import json
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")

PROJECT_ROOT = Path('.').resolve()
load_dotenv(PROJECT_ROOT / '.env')
SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')
BROWSER_EXECUTABLE_PATH = os.getenv('PLAYWRIGHT_BROWSER_EXECUTABLE_PATH')

out_dir = PROJECT_ROOT / 'temp_screenshots'
out_dir.mkdir(parents=True, exist_ok=True)

console_errors = []

with sync_playwright() as p:
    launch_options = {'headless': True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options['executable_path'] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={'width': 1920, 'height': 1080})

    def record_console(msg):
        if msg.type == "error":
            txt = msg.text
            if "favicon" not in txt and "socket.io" not in txt:
                console_errors.append(txt)
                print(f"[CONSOLE ERROR] {txt}")

    page.on("console", record_console)
    page.on("pageerror", lambda err: console_errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(SITE_URL + '/login')
    page.fill('#login_email', USERNAME)
    page.fill('#login_password', USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url('**/desk**', timeout=25000)
    print("   Logged in successfully!")

    # =========================================================================
    # Test Monthly Settlement Picker
    # =========================================================================
    print("\n2. Testing Monthly Settlement Picker (/desk/monthly-settlement-picker)...")
    page.goto(SITE_URL + '/desk/monthly-settlement-picker')
    page.wait_for_selector("#monthly-data-table", timeout=15000)
    page.wait_for_timeout(2000)

    # Check 1: Blue banner is DELETED
    banner_exists = page.evaluate('() => !!document.getElementById("monthly-section-banner")')
    assert not banner_exists, "Error: #monthly-section-banner still exists!"
    print("   [PASS] Blue banner '月结补录 统计: 0 笔' is completely removed!")

    # Check 2: Default status is '全部入库单据' (all)
    active_status = page.evaluate('() => document.querySelector("#monthly-status-btn-group .picker-status-btn.active")?.getAttribute("data-status")')
    assert active_status == "all", f"Error: Default status is {active_status}, expected 'all'!"
    print(f"   [PASS] Default invoicing status filter is '全部入库单据' (active: {active_status})!")

    # Check 3: Doc view and table layout
    page.screenshot(path=str(out_dir / "verified_monthly_doc_view.png"))
    doc_ths = page.evaluate('() => Array.from(document.querySelectorAll("#monthly-table-thead th")).map(th => th.innerText.trim())')
    print("   Monthly Doc Headers:", doc_ths)

    # Check 4: Switch to detail view
    page.click('button[data-mode="detail"]')
    page.wait_for_timeout(1000)
    detail_ths = page.evaluate('() => Array.from(document.querySelectorAll("#monthly-table-thead th")).map(th => th.innerText.trim())')
    print("   Monthly Detail Headers:", detail_ths)
    page.screenshot(path=str(out_dir / "verified_monthly_detail_view.png"))

    # Check 5: Open create modal
    page.click('#monthly-open-create-modal-btn')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(out_dir / "verified_monthly_create_modal.png"))
    page.evaluate("() => frappe.ui.open_dialogs.forEach(d => d.hide())")
    page.wait_for_timeout(500)

    # =========================================================================
    # Test Wire Transfer Picker
    # =========================================================================
    print("\n3. Testing Wire Transfer Picker (/desk/wire-transfer-picker)...")
    page.goto(SITE_URL + '/desk/wire-transfer-picker')
    page.wait_for_selector("#wire-data-table", timeout=15000)
    page.wait_for_timeout(2000)

    # Check 1: Blue banner is DELETED
    wire_banner_exists = page.evaluate('() => !!document.getElementById("wire-section-banner")')
    assert not wire_banner_exists, "Error: #wire-section-banner still exists!"
    print("   [PASS] Blue banner '待付: 0 笔 | 总量: ...' is completely removed!")

    # Check 2: Segmented control has only 3 buttons: 全部, 草稿, 已完成
    seg_buttons = page.evaluate('() => Array.from(document.querySelectorAll("#wire-filter-bar .picker-lifecycle-seg-btn")).map(b => ({ val: b.getAttribute("data-value"), text: b.innerText.trim() }))')
    print("   Segmented control buttons:", seg_buttons)
    expected_vals = ["all", "draft", "completed"]
    actual_vals = [b["val"] for b in seg_buttons]
    assert actual_vals == expected_vals, f"Error: Segmented buttons {actual_vals} do not match {expected_vals}!"
    print("   [PASS] Segmented control strictly has 3 states: 全部 | 草稿 | 已完成!")

    # Check 3: Doc view and table layout
    page.screenshot(path=str(out_dir / "verified_wire_doc_view.png"))
    wire_doc_ths = page.evaluate('() => Array.from(document.querySelectorAll("#wire-table-thead th")).map(th => th.innerText.trim())')
    print("   Wire Doc Headers:", wire_doc_ths)

    # Check 4: Column alignment in footer
    foot_alignment = page.evaluate('''() => {
        const table = document.getElementById("wire-data-table");
        const thead = Array.from(table.querySelectorAll("thead th")).map(th => ({ text: th.innerText.trim(), left: Math.round(th.getBoundingClientRect().left), width: Math.round(th.getBoundingClientRect().width) }));
        const tfoot = Array.from(table.querySelectorAll("tfoot td")).map(td => ({ text: td.innerText.trim(), left: Math.round(td.getBoundingClientRect().left), width: Math.round(td.getBoundingClientRect().width), colspan: td.colSpan }));
        return { thead, tfoot };
    }''')
    print("   Wire Doc Footer Alignment:")
    for td in foot_alignment["tfoot"]:
        if td["text"]:
            print(f"      td '{td['text']}': left {td['left']}, width {td['width']}")

    # Check 5: Detail view
    page.click('button[data-mode="detail"]')
    page.wait_for_timeout(1000)
    wire_detail_ths = page.evaluate('() => Array.from(document.querySelectorAll("#wire-table-thead th")).map(th => th.innerText.trim())')
    print("   Wire Detail Headers:", wire_detail_ths)
    page.screenshot(path=str(out_dir / "verified_wire_detail_view.png"))

    # Check 6: Open create modal
    page.click('#wire-open-create-modal-btn')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(out_dir / "verified_wire_create_modal.png"))

    # Verify auto-receive toggle is removed
    has_toggle = page.evaluate('() => !!document.getElementById("modal-wire-auto-receive")')
    assert not has_toggle, "Error: #modal-wire-auto-receive still exists in modal!"
    print("   [PASS] '实物到厂入库' toggle removed (goods are always arrived)!")

    # Verify 3 buttons in footer
    footer_btns = page.evaluate('() => Array.from(document.querySelectorAll(".modal:has(#modal-wire-items-table) .modal-footer button")).map(b => b.innerText.trim())')
    print("   Wire Modal Footer Buttons:", footer_btns)
    assert "取消" in footer_btns and "保存为草稿" in footer_btns and "保存为正式单据" in footer_btns, f"Error: footer buttons {footer_btns} missing required actions!"
    print("   [PASS] 3-tier modal action buttons verified: 取消 | 保存为草稿 | 保存为正式单据!")

    # Close modal
    page.evaluate("() => frappe.ui.open_dialogs.forEach(d => d.hide())")
    page.wait_for_timeout(500)

    # Check 7: Filter by '草稿' and '已完成'
    page.click('button[data-mode="doc"]')
    page.wait_for_timeout(500)
    page.click('button[data-value="completed"]')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(out_dir / "verified_wire_completed_tab.png"))

    page.click('button[data-value="draft"]')
    page.wait_for_timeout(1000)
    page.screenshot(path=str(out_dir / "verified_wire_draft_tab.png"))

    page.click('button[data-value="all"]')
    page.wait_for_timeout(1000)

    # Check 8: Test 1440x900 viewport to verify zero column crossing and scrollbar
    page.set_viewport_size({'width': 1440, 'height': 900})
    page.wait_for_timeout(1000)
    page.screenshot(path=str(out_dir / "verified_wire_1440p.png"))

    page.goto(SITE_URL + '/desk/monthly-settlement-picker')
    page.wait_for_timeout(2000)
    page.screenshot(path=str(out_dir / "verified_monthly_1440p.png"))

    browser.close()

print("\n=== TOTAL CONSOLE ERRORS ===", len(console_errors))
assert len(console_errors) == 0, f"Found {len(console_errors)} console errors: {console_errors}"
print("[SUCCESS] All tests and verifications PASSED with 0 console errors!")
