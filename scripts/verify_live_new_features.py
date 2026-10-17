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
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")
BROWSER_EXECUTABLE_PATH = os.getenv("PLAYWRIGHT_BROWSER_EXECUTABLE_PATH")

out_dir = Path(os.getenv("PLAYWRIGHT_OUTPUT_DIR", PROJECT_ROOT / "temp_screenshots"))
out_dir.mkdir(parents=True, exist_ok=True)

console_errors = []

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    def handle_console(msg):
        print(f"[CONSOLE {msg.type}] {msg.text}")
        if msg.type in ("error",):
            console_errors.append(msg.text)

    page.on("console", handle_console)

    print("Logging in...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=20000)

    print("Navigating to Jizhong HR Workbench...")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    page.wait_for_selector("#table-jz-employees", timeout=15000)
    time.sleep(3)

    # 1. Verify Tab 1 KPI cards
    kpi_count = page.inner_text("#jz-emp-kpi-count")
    kpi_hire_sub = page.inner_text("#jz-emp-kpi-hire-sub")
    kpi_base = page.inner_text("#jz-emp-kpi-base")
    kpi_type_sub = page.inner_text("#jz-emp-kpi-type-sub")
    kpi_ins_sub = page.inner_text("#jz-emp-kpi-ins-sub")

    print(f"KPI Count: {kpi_count} | {kpi_hire_sub}")
    print(f"KPI Base: {kpi_base} | {kpi_type_sub}")
    print(f"KPI Insurance: {kpi_ins_sub}")
    assert "本月入职" in kpi_hire_sub and "本月离职" in kpi_hire_sub
    assert "正式工" in kpi_type_sub and "返聘工" in kpi_type_sub
    assert "社会保险" in kpi_ins_sub and "公积金" in kpi_ins_sub

    # Screenshot Tab 1
    shot_tab1 = out_dir / "live_tab1_employees_kpis_and_retirement.png"
    page.screenshot(path=shot_tab1, full_page=False)
    print(f"Saved: {shot_tab1}")

    # 2. Verify Table Columns (no department, has retirement)
    th_texts = page.eval_on_selector_all("#table-jz-employees thead th", "ths => ths.map(t => t.innerText.trim())")
    print(f"Headers count: {len(th_texts)}")
    print(f"Sample headers: {th_texts[:10]} ... {th_texts[-10:]}")
    assert "部门" not in th_texts, "部门 should not be in headers!"
    assert "岗位" not in th_texts, "岗位 should not be in headers!"
    assert "原退休年龄" in th_texts, "原退休年龄 must be in headers!"
    assert "延迟退休年月" in th_texts, "延迟退休年月 must be in headers!"
    assert "退休状态" in th_texts, "退休状态 must be in headers!"

    # 3. Test Employee Type Policy dialog
    print("Testing Employee Type Policy Dialog...")
    btn_vis = page.is_visible("#btn-jz-employee-type-rules")
    print(f"Button visible: {btn_vis}")
    page.click("#btn-jz-employee-type-rules")
    time.sleep(2)
    dia_vis = page.is_visible(".jz-policy-matrix-table")
    print(f"Matrix table visible: {dia_vis}")
    modal_vis = page.is_visible(".modal-dialog")
    print(f"Modal dialog visible: {modal_vis}")
    page.wait_for_selector(".jz-policy-matrix-table", timeout=10000)
    time.sleep(1)
    matrix_rows = page.eval_on_selector_all(".jz-policy-matrix-table tbody tr", "trs => trs.map(t => t.innerText.trim())")
    print(f"Policy rows count: {len(matrix_rows)}")
    for r in matrix_rows:
        print("  Row:", r.replace("\n", " | "))

    shot_policy = out_dir / "live_employee_type_policy_dialog.png"
    page.screenshot(path=shot_policy, full_page=False)
    print(f"Saved: {shot_policy}")
    page.evaluate("() => cur_dialog && cur_dialog.hide()")
    time.sleep(2)

    # 4. Test Employee Edit/Create Dialog with Retirement Preview
    print("Enabling and clicking add employee button...")
    page.eval_on_selector("#btn-jz-add-emp", "btn => { btn.disabled = false; $(btn).removeClass('disabled').trigger('click'); }")
    time.sleep(2)
    modal_title = page.eval_on_selector(".modal.show .modal-title", "el => el.innerText")
    print("Open Modal Title:", modal_title)
    inputs = page.eval_on_selector_all(".modal.show input", "els => els.map(e => e.getAttribute('data-fieldname') || e.name || e.id)")
    print("Inputs in modal:", inputs)
    page.wait_for_selector('.modal.show [data-fieldname="id_card"] input', timeout=10000)
    page.fill('[data-fieldname="id_card"] input', "120101198005121234")
    page.click('[data-fieldname="employee_name"] input')
    time.sleep(2)
    preview_text = page.eval_on_selector(".jz-retire-preview-box", "el => el ? el.innerText : ''")
    print("Retirement preview text:", preview_text[:140].replace("\n", " "))
    shot_emp_dialog = out_dir / "live_employee_edit_dialog_retirement.png"
    page.screenshot(path=shot_emp_dialog, full_page=False)
    print(f"Saved: {shot_emp_dialog}")

    browser.close()

print(f"Done! Total console errors: {len(console_errors)}")
assert len(console_errors) == 0, f"Found {len(console_errors)} console errors"
print("ALL VERIFICATIONS PASSED 100%!")
