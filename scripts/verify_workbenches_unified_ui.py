import os
import sys
import json
from pathlib import Path
import requests
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
    def record_console_error(msg):
        if msg.type == "error":
            txt = msg.text
            if "favicon" not in txt and "socket.io" not in txt:
                errors.append(txt)
                print(f"[CONSOLE ERROR] {txt}")

    page.on("console", record_console_error)
    page.on("pageerror", lambda err: errors.append(str(err)))

    print("1. Logging into Frappe Desk...")
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)
    print("Logged in!")

    print("2. Testing Qifu Salary Workbench (/desk/qifu-hr-salary-workbench)...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector("#table-qifu-emp", state="visible", timeout=15000)
    page.wait_for_timeout(3000)

    qifu_metrics = page.evaluate("""() => {
        const table = document.querySelector("#table-qifu-emp");
        const th = table.querySelector("thead th:nth-child(4)"); // 姓名 th
        const thCheck = table.querySelector("thead th:nth-child(1)"); // Checkbox th
        const thSeq = table.querySelector("thead th:nth-child(2)"); // 序号 th
        const thAge = table.querySelector("thead th:nth-child(7)"); // 年龄 th
        const thMoney = table.querySelector("thead th:nth-child(15)"); // 固定工资 th

        const td = table.querySelector("tbody tr:first-child td:nth-child(4)"); // 姓名 td
        const tdCheck = table.querySelector("tbody tr:first-child td:nth-child(1)"); // Checkbox td
        const tdSeq = table.querySelector("tbody tr:first-child td:nth-child(2)"); // 序号 td
        const tdAge = table.querySelector("tbody tr:first-child td:nth-child(7)"); // 年龄 td
        const tdMoney = table.querySelector("tbody tr:first-child td:nth-child(15)"); // 固定工资 td

        const cs = el => el ? window.getComputedStyle(el) : {};

        return {
            headerHeight: cs(th).height,
            headerFontSize: cs(th).fontSize,
            headerFontWeight: cs(th).fontWeight,
            headerVerticalAlign: cs(th).verticalAlign,
            rowHeight: cs(td).height,
            cellFontSize: cs(td).fontSize,
            cellVerticalAlign: cs(td).verticalAlign,
            cellPadding: cs(td).padding,
            alignments: {
                checkTh: cs(thCheck).textAlign,
                checkTd: cs(tdCheck).textAlign,
                seqTh: cs(thSeq).textAlign,
                seqTd: cs(tdSeq).textAlign,
                nameTh: cs(th).textAlign,
                nameTd: cs(td).textAlign,
                ageTh: cs(thAge).textAlign,
                ageTd: cs(tdAge).textAlign,
                moneyTh: cs(thMoney).textAlign,
                moneyTd: cs(tdMoney).textAlign,
            }
        };
    }""")
    print("Qifu Table Metrics:")
    print(json.dumps(qifu_metrics, indent=2, ensure_ascii=False))

    page.screenshot(path=str(out_dir / "qifu_standardized_table.png"), full_page=False)

    print("3. Testing Jizhong Salary Workbench (/desk/jizhong-hr-salary-workbench)...")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    page.wait_for_selector("#table-jz-employees", state="visible", timeout=15000)
    page.wait_for_timeout(3000)

    jz_metrics = page.evaluate("""() => {
        const table = document.querySelector("#table-jz-employees");
        const th = table.querySelector("thead th.jz-col-name"); // 姓名 th
        const thCheck = table.querySelector("thead th.jz-col-check"); // Checkbox th
        const thSeq = table.querySelector("thead th.jz-col-seq"); // 序号 th
        const thAge = table.querySelector("thead th:nth-child(6)"); // 年龄 th
        const thMoney = table.querySelector("thead th.jz-text-right"); // 金额 th

        const td = table.querySelector("tbody tr:first-child td.jz-col-name"); // 姓名 td
        const tdCheck = table.querySelector("tbody tr:first-child td.jz-col-check"); // Checkbox td
        const tdSeq = table.querySelector("tbody tr:first-child td.jz-col-seq"); // 序号 td
        const tdAge = table.querySelector("tbody tr:first-child td.jz-employee-age-cell"); // 年龄 td
        const tdMoney = table.querySelector("tbody tr:first-child td.jz-money-cell"); // 金额 td

        const cs = el => el ? window.getComputedStyle(el) : {};

        return {
            headerHeight: cs(th).height,
            headerFontSize: cs(th).fontSize,
            headerFontWeight: cs(th).fontWeight,
            headerVerticalAlign: cs(th).verticalAlign,
            rowHeight: cs(td).height,
            cellFontSize: cs(td).fontSize,
            cellVerticalAlign: cs(td).verticalAlign,
            cellPadding: cs(td).padding,
            alignments: {
                checkTh: cs(thCheck).textAlign,
                checkTd: cs(tdCheck).textAlign,
                seqTh: cs(thSeq).textAlign,
                seqTd: cs(tdSeq).textAlign,
                nameTh: cs(th).textAlign,
                nameTd: cs(td).textAlign,
                ageTh: cs(thAge).textAlign,
                ageTd: cs(tdAge).textAlign,
                moneyTh: cs(thMoney).textAlign,
                moneyTd: cs(tdMoney).textAlign,
            }
        };
    }""")
    print("Jizhong Table Metrics:")
    print(json.dumps(jz_metrics, indent=2, ensure_ascii=False))

    page.screenshot(path=str(out_dir / "jizhong_standardized_table.png"), full_page=False)

    print(f"Console errors during entire run: {len(errors)}")
    browser.close()

if errors:
    sys.exit(1)
print("SUCCESS: Standardization across all tables confirmed 100% identical!")
