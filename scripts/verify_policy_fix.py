# -*- coding: utf-8 -*-
import os, sys
sys.stdout.reconfigure(encoding="utf-8")
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(".env")
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 900})
    
    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)
    print("Login successful.")

    # ==========================================
    # TEST 1: Qifu Policy List View
    # ==========================================
    print("\n2. Navigating to desk/qifu-employee-type-policy...")
    page.goto(f"{SITE_URL}/desk/qifu-employee-type-policy?company=%E5%A4%A9%E6%B4%A5%E7%A5%BA%E5%AF%8C%E6%9C%BA%E6%A2%B0%E5%8A%A0%E5%B7%A5%E6%9C%89%E9%99%90%E5%85%AC%E5%8F%B8")
    page.wait_for_timeout(3000)

    # Check primary action button
    primary_btn = page.query_selector(".primary-action")
    primary_text = primary_btn.inner_text().strip() if primary_btn else "NOT FOUND"
    print("List primary action button:", primary_text)
    assert "新建用工性质" in primary_text, f"Expected '+ 新建用工性质' in primary button, got {primary_text}"

    # Check inner buttons
    inner_add_btn = page.query_selector("button.btn-add-policy-action")
    print("Inner add button found:", bool(inner_add_btn), inner_add_btn.inner_text() if inner_add_btn else "")
    assert inner_add_btn is not None

    # Click inner add button to test quick modal
    print("Clicking '+ 新建用工性质'...")
    inner_add_btn.click()
    page.wait_for_timeout(1000)
    
    modal = page.query_selector(".modal.show")
    assert modal is not None, "Quick modal did not show!"
    modal_title = modal.query_selector(".modal-title").inner_text().strip()
    print("Modal title:", modal_title)
    assert "新建用工性质" in modal_title

    # Check that employee_type input is an editable text input
    emp_type_input = modal.query_selector("input[data-fieldname='employee_type']")
    assert emp_type_input is not None, "employee_type input not found!"
    is_readonly = emp_type_input.get_attribute("readonly")
    print("employee_type input is_readonly:", is_readonly)
    assert not is_readonly, "employee_type input should be editable!"

    # Close modal
    close_btn = modal.query_selector(".btn-modal-close, button.close")
    if close_btn:
        close_btn.click()
    page.wait_for_timeout(1000)

    # ==========================================
    # TEST 2: Qifu Workbench Policy Dialog
    # ==========================================
    print("\n3. Navigating to desk/qifu-hr-salary-workbench...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_timeout(3000)

    rule_btn = page.query_selector("#btn-qifu-employee-type-rules")
    assert rule_btn is not None, "rule_btn not found on workbench!"
    print("Clicking '#btn-qifu-employee-type-rules' on workbench...")
    rule_btn.click()
    page.wait_for_timeout(1500)

    # Verify visible dialogs count is exactly 1 (not 2!)
    visible_modals = page.query_selector_all(".modal.show")
    print("Visible modals count:", len(visible_modals))
    assert len(visible_modals) == 1, f"Expected exactly 1 modal, but found {len(visible_modals)}! (Double modal bug still exists)"

    # Check button inside dialog
    dialog = visible_modals[0]
    add_policy_btn = dialog.query_selector(".btn-dialog-add-policy")
    assert add_policy_btn is not None, "btn-dialog-add-policy not found inside dialog!"
    print("Dialog add button text:", add_policy_btn.inner_text().strip())
    assert "新建用工性质" in add_policy_btn.inner_text().strip()

    # Click '+ 新建用工性质' inside dialog
    print("Clicking '+ 新建用工性质' inside workbench dialog...")
    add_policy_btn.click()
    page.wait_for_timeout(1000)

    # Check quick create dialog opened
    sub_modal = page.query_selector(".modal.show")
    assert sub_modal is not None
    sub_title = sub_modal.query_selector(".modal-title").inner_text().strip()
    print("Sub modal title:", sub_title)
    assert "新建用工性质" in sub_title

    # Check employee_type input
    sub_input = sub_modal.query_selector("input[data-fieldname='employee_type']")
    assert sub_input is not None
    assert not sub_input.get_attribute("readonly")

    # Close quick dialog
    sub_close = sub_modal.query_selector(".btn-modal-close, button.close")
    if sub_close:
        sub_close.click()
    page.wait_for_timeout(1000)

    # Check that parent dialog is restored
    restored_modal = page.query_selector(".modal.show")
    assert restored_modal is not None
    restored_title = restored_modal.query_selector(".modal-title").inner_text().strip()
    print("Restored modal title:", restored_title)
    assert "用工性质参与规则设置" in restored_title

    page.screenshot(path="temp_screenshots/verify_policy_fix_success.png")
    print("Screenshot saved to temp_screenshots/verify_policy_fix_success.png")

    browser.close()
    print("\n>>> ALL TESTS PASSED SUCCESSFULLY! 0 ERRORS! <<<")
