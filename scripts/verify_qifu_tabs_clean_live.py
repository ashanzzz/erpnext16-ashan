import os, sys
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})
    
    errors = []
    def on_console(msg):
        if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text:
            errors.append(msg.text)
            print("[CONSOLE ERROR]", msg.text)
    page.on("console", on_console)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    
    print("2. Navigating to /desk/qifu-hr-salary-workbench directly (Fresh Page Load)...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3500)
    
    # 2.1 Verify initial visibility without clicking any tab
    vis = page.evaluate("""() => {
        const tabs = Array.from(document.querySelectorAll('.qifu-tab-content'));
        return tabs.map(t => ({
            id: t.id,
            display: window.getComputedStyle(t).display,
            visible: window.getComputedStyle(t).display !== 'none'
        }));
    }""")
    print("Initial Tab visibility:", vis)
    visible_tabs = [t['id'] for t in vis if t['visible']]
    assert visible_tabs == ['qifu-tab-employees'], f"Expected ONLY [qifu-tab-employees], but got: {visible_tabs}"
    print("PASS: Fresh load shows ONLY 员工薪酬档案 (qifu-tab-employees). Zero tab leakage!")
    
    page.screenshot(path="temp_screenshots/verify_fresh_single_tab.png")
    
    # 2.2 Test Tab 2 switch
    print("3. Switching to Tab 2 (外部实发主表)...")
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(1500)
    
    vis_tab2 = page.evaluate("""() => {
        const tabs = Array.from(document.querySelectorAll('.qifu-tab-content'));
        return tabs.map(t => ({
            id: t.id,
            display: window.getComputedStyle(t).display,
            visible: window.getComputedStyle(t).display !== 'none'
        }));
    }""")
    visible_tabs2 = [t['id'] for t in vis_tab2 if t['visible']]
    assert visible_tabs2 == ['qifu-tab-salary_main'], f"Expected ONLY [qifu-tab-salary_main], got: {visible_tabs2}"
    print("PASS: Tab 2 active, Tab 1 hidden cleanly!")
    
    # 2.3 Switch back to Tab 1
    print("4. Switching back to Tab 1 (员工薪酬档案)...")
    page.click(".qifu-tab-btn[data-tab='employees']")
    page.wait_for_timeout(1500)
    
    # 2.4 Test [新建员工档案] button
    print("5. Testing [新建员工档案] button...")
    page.click("#btn-qifu-new-emp")
    page.wait_for_timeout(1500)
    
    modal_info = page.evaluate("""() => {
        const modal = document.querySelector('.modal.show, .modal[style*="display: block"]');
        if (!modal) return { open: false };
        return {
            open: true,
            title: modal.querySelector('.modal-title')?.innerText || '',
            formVisible: modal.querySelector('.modal-body')?.offsetParent !== null
        };
    }""")
    print("New Emp Modal:", modal_info)
    assert modal_info['open'] and '员工档案' in modal_info['title'], "Modal failed to open!"
    print("PASS: [新建员工档案] opened without errors!")
    
    page.screenshot(path="temp_screenshots/verify_new_emp_modal_clean.png")
    
    # Close modal
    page.keyboard.press("Escape")
    page.wait_for_timeout(800)
    
    browser.close()
    assert len(errors) == 0, f"Console errors detected: {errors}"
    print("\nALL VERIFICATIONS PASSED with 0 CONSOLE ERRORS!")
