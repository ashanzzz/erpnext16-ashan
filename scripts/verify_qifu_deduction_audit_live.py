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

    # Click Tab 0 (当期薪资明细)
    page.click(".qifu-tab-btn[data-tab='salary_main']")
    page.wait_for_timeout(1500)

    # 3. Check KPI Cards
    print("3. Checking KPI cards...")
    card1_val = page.locator("#sm-card-net").text_content()
    card1_sub = page.locator("#sm-card-net-sub").text_content()
    print("Card 1 (Net):", card1_val, "|", card1_sub)
    assert "动态税后" in card1_sub and "固定税后" in card1_sub, f"Card 1 missing dynamic/fixed net: {card1_sub}"

    card2_val = page.locator("#sm-card-gross").text_content()
    card2_sub = page.locator("#sm-card-gross-sub").text_content()
    print("Card 2 (Gross):", card2_val, "|", card2_sub)
    assert "动态税前" in card2_sub and "固定税前" in card2_sub, f"Card 2 missing dynamic/fixed gross: {card2_sub}"

    card3_val = page.locator("#sm-card-allowance").text_content()
    card3_sub = page.locator("#sm-card-allowance-sub").text_content()
    print("Card 3 (Allowance):", card3_val, "|", card3_sub)
    assert "职位补贴" in card3_sub and "房车补" in card3_sub, f"Card 3 missing allowance split: {card3_sub}"

    card4_val = page.locator("#sm-card-deduction").text_content()
    card4_sub = page.locator("#sm-card-deduction-sub").text_content()
    print("Card 4 (Deduction):", card4_val, "|", card4_sub)
    assert card4_val.strip() == "¥ 0.00", f"Card 4 value expected ¥ 0.00, got {card4_val}"
    assert "扣除: 0人" in card4_sub and "个税" not in card4_sub, f"Card 4 should only calculate deduction without tax: {card4_sub}" 

    card5_val = page.locator("#sm-card-attendance").text_content()
    card5_sub = page.locator("#sm-card-attendance-sub").text_content()
    print("Card 5 (Attendance):", card5_val, "|", card5_sub)
    assert "全勤" in card5_sub and "正式工" in card5_sub and "返聘" in card5_sub, f"Card 5 missing attendance/structure: {card5_sub}"

    # 4. Check Table Header
    print("4. Checking table header for 核实扣除 column...")
    th_audit = page.locator("#salary-data-table thead th:has-text('核实扣除')")
    print("Found 核实扣除 header:", th_audit.count())
    assert th_audit.count() == 1, "Table missing 核实扣除 header column!"

    # 5. Check Audit Badges in rows
    print("5. Checking audit badges in rows...")
    badges = page.locator("#tbody-salary-main .qifu-audit-badge")
    print(f"Total audit badges in table: {badges.count()}")
    assert badges.count() >= 24, f"Expected at least 24 audit badges, got {badges.count()}"

    first_badge = badges.first
    print("First badge text:", first_badge.text_content().strip())
    print("First badge title:", first_badge.get_attribute("title"))
    assert "通过" in first_badge.text_content(), "First badge expected to be 通过"
    assert "全勤基准" in first_badge.get_attribute("title"), "Tooltip missing benchmark attendance info"

    # 6. Check tfoot
    tfoot_audit = page.locator("#tfoot-salary-main .qifu-audit-badge")
    print("Tfoot audit summary:", tfoot_audit.text_content().strip())
    assert "全部通过" in tfoot_audit.text_content(), f"Tfoot audit summary expected 全部通过, got {tfoot_audit.text_content()}"

    # 7. Check Detail Modal (open row 1 detail)
    print("7. Opening detail modal for row 1...")
    page.locator("#tbody-salary-main tr").first.locator(".btn-view-salary-detail").click()
    page.wait_for_timeout(1000)

    modal = page.locator(".modal.fade.show")
    print("Detail modal visible:", modal.is_visible())
    modal_text = modal.text_content()
    assert "考勤扣除与请假政策核验" in modal_text, "Detail modal missing 考勤扣除与请假政策核验 section!"
    assert "全勤基准工作日" in modal_text, "Detail modal missing 全勤基准工作日!"
    assert "《关于请假期间保险与租房费用通告》" in modal_text, "Detail modal missing 通告 reference!"
    print("Detail modal has policy audit section verified!")

    modal.locator(".modal-footer .btn-primary").click()
    page.wait_for_timeout(500)

    # 8. Take screenshot
    screenshot_path = out_dir / "qifu_deduction_audit_and_cards_verified.png"
    page.screenshot(path=str(screenshot_path))
    print(f"8. Screenshot saved to {screenshot_path}")

    print("Console errors recorded:", len(errors), errors)
    assert len(errors) == 0, f"Expected 0 console errors, got: {errors}"

    print("ALL 8 VERIFICATION STEPS PASSED SUCCESSFULLY!")
    browser.close()
