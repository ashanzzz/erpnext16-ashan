import sys
import time
from playwright.sync_api import sync_playwright

def run():
    print("Starting Playwright verification...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 1600, "height": 950})
        page = context.new_page()

        # 1. Login
        print("Navigating to login...")
        page.goto("http://192.168.8.11:6888/login", timeout=30000)
        page.wait_for_selector("#login_email", timeout=15000)
        page.fill("#login_email", "ashanzzz1213@gmail.com")
        page.fill("#login_password", "Woo@@@204317")
        page.click("button.btn-login")

        page.wait_for_url("**/desk**", timeout=25000)
        print("Logged into Desk.")
        time.sleep(3)

        # 2. Check sidebar and typography dialog
        print("Checking sidebar typography button...")
        page.wait_for_selector(".ashan-sidebar-typo-btn", timeout=15000)
        page.click(".ashan-sidebar-typo-btn")
        time.sleep(1)

        page.wait_for_selector(".modal-dialog:has-text('全局排版与尺度调度中心')", timeout=10000)
        print("Opened Typography Settings Dialog.")
        page.screenshot(path="docs/designs/verify_live_typography_dialog.png")

        # Check new button settings fields
        btn_fs_input = page.locator("input[data-fieldname='button_font_size']")
        btn_h_input = page.locator("input[data-fieldname='button_height']")
        print("Button font size input exists:", btn_fs_input.count() > 0)
        print("Button height input exists:", btn_h_input.count() > 0)

        # Save settings (15px table, 40px row, 14px button, 34px btn height, 14px modal, 38px modal row)
        page.fill("input[data-fieldname='font_size']", "15")
        page.fill("input[data-fieldname='row_height']", "40")
        page.fill("input[data-fieldname='button_font_size']", "14")
        page.fill("input[data-fieldname='button_height']", "34")
        page.fill("input[data-fieldname='modal_font_size']", "14")
        page.fill("input[data-fieldname='modal_row_height']", "38")
        page.click("button:has-text('保存并全系统生效')")
        time.sleep(2)
        print("Typography settings saved.")

        # 3. Check property settlement workbench buttons (Export Excel, Bill preview, Add adjustment, Save draft, Finalize)
        print("Navigating to property settlement workbench...")
        page.goto("http://192.168.8.11:6888/desk/property-settlement-workbench", timeout=30000)
        time.sleep(3)
        page.wait_for_selector(".prop-btn-compact", timeout=15000)

        # Measure button computed styles
        btn_styles = page.evaluate("""() => {
            const btn = document.querySelector('#btn-preview-bills') || document.querySelector('.prop-btn-compact');
            if (!btn) return null;
            const cs = window.getComputedStyle(btn);
            return {
                fontSize: cs.fontSize,
                height: cs.height,
                lineHeight: cs.lineHeight
            };
        }""")
        print("Property workbench button computed styles:", btn_styles)
        page.screenshot(path="docs/designs/verify_live_prop_workbench.png")

        # 4. Check procurement execution workbench (mr_to_po) and PO creation modal
        print("Navigating to procurement execution workbench...")
        page.goto("http://192.168.8.11:6888/desk/procurement-execution-workbench#stage=mr_to_po", timeout=30000)
        time.sleep(3)

        # Check docname font size
        docname_styles = page.evaluate("""() => {
            const el = document.querySelector('.picker-source-docname') || document.querySelector('.col-w-docname');
            if (!el) return null;
            const cs = window.getComputedStyle(el);
            return {
                fontSize: cs.fontSize,
                fontFamily: cs.fontFamily
            };
        }""")
        print("Procurement workbench docname computed styles:", docname_styles)

        # Open PO modal
        print("Clicking row to open PO Creation Modal...")
        first_row = page.locator(".picker-data-table tbody tr.picker-data-row").first
        if first_row.count() > 0:
            first_row.click()
            time.sleep(2)
            page.wait_for_selector(".ashan-po-modal", timeout=10000)
            print("PO Creation Modal opened.")

            modal_styles = page.evaluate("""() => {
                const modal = document.querySelector('.ashan-po-modal');
                const addBtn = document.querySelector('.ashan-btn-add-row');
                const primaryBtn = document.querySelector('.ashan-btn-primary');
                return {
                    modalFs: window.getComputedStyle(modal).fontSize,
                    addBtnBg: addBtn ? window.getComputedStyle(addBtn).backgroundColor : null,
                    addBtnFs: addBtn ? window.getComputedStyle(addBtn).fontSize : null,
                    addBtnHeight: addBtn ? window.getComputedStyle(addBtn).height : null,
                    primaryBtnFs: primaryBtn ? window.getComputedStyle(primaryBtn).fontSize : null
                };
            }""")
            print("PO Modal styles:", modal_styles)
            page.screenshot(path="docs/designs/verify_live_po_modal.png")
        else:
            print("No rows found in mr_to_po, switching to all match_status...")
            page.click("button[data-status='all']")
            time.sleep(2)
            first_row = page.locator(".picker-data-table tbody tr.picker-data-row").first
            if first_row.count() > 0:
                first_row.click()
                time.sleep(2)
                page.screenshot(path="docs/designs/verify_live_po_modal.png")

        # 5. Check material request workbench
        print("Navigating to material request workbench...")
        page.goto("http://192.168.8.11:6888/desk/material-request-workbench", timeout=30000)
        time.sleep(3)
        mr_styles = page.evaluate("""() => {
            const el = document.querySelector('.picker-source-docname');
            if (!el) return null;
            return { fontSize: window.getComputedStyle(el).fontSize };
        }""")
        print("Material request docname styles:", mr_styles)
        page.screenshot(path="docs/designs/verify_live_material_request.png")

        browser.close()
        print("Playwright live verification complete!")

if __name__ == "__main__":
    run()
