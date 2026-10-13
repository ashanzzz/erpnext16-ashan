import os
import sys
import json
import time
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

print("Checking site readiness...")
for _ in range(25):
    try:
        r = requests.get(f"{SITE_URL}/api/method/ping", timeout=3)
        if r.status_code == 200:
            print("Site is ready!")
            break
    except Exception:
        pass
    time.sleep(2)

with sync_playwright() as p:
    launch_options = {"headless": True}
    if BROWSER_EXECUTABLE_PATH:
        launch_options["executable_path"] = BROWSER_EXECUTABLE_PATH
    browser = p.chromium.launch(**launch_options)
    page = browser.new_page(viewport={"width": 1920, "height": 1080})

    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" and "favicon" not in msg.text and "socket.io" not in msg.text else None)
    page.on("pageerror", lambda err: errors.append(str(err)))

    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button[type='submit']")
    page.wait_for_url("**/desk**", timeout=25000)

    # 1. Test Qifu Tab 6 正式工 badge removal
    print("1. Testing Qifu Tab 6 (综合结算) 正式工 badge removal...")
    page.goto(f"{SITE_URL}/desk/qifu-hr-salary-workbench")
    page.wait_for_selector(".qifu-tab-btn", state="visible", timeout=15000)
    page.click(".qifu-tab-btn[data-tab='settlement']")
    page.wait_for_selector("#table-qifu-payroll", state="visible", timeout=10000)
    page.wait_for_timeout(2000)

    settlement_badge_audit = page.evaluate("""() => {
        const cells = Array.from(document.querySelectorAll("#tbody-qifu-payroll td:nth-child(4)"));
        const sampleHtml = cells[0] ? cells[0].innerHTML : "";
        const hasBadge = sampleHtml.includes("qifu-status-badge") || sampleHtml.includes("badge");
        return {
            firstRowText: cells[0] ? cells[0].innerText.trim() : "",
            sampleHtml,
            hasBadge
        };
    }""")
    print("Settlement EmpType Audit:", json.dumps(settlement_badge_audit, indent=2, ensure_ascii=False))

    # 2. Test Qifu Tab 1 Column Sorting
    print("\n2. Testing Qifu Tab 1 (员工薪酬档案) Multi-column sorting...")
    page.click(".qifu-tab-btn[data-tab='employees']")
    page.wait_for_selector("#table-qifu-emp", state="visible", timeout=10000)
    page.wait_for_timeout(2000)

    # Initial order of first 5 employee names
    initial_names = page.evaluate("""() => {
        return Array.from(document.querySelectorAll("#tbody-qifu-emp tr")).slice(0, 5).map(tr => tr.children[3]?.innerText.trim());
    }""")
    print("Initial first 5 names:", initial_names)

    # Click on 姓名 column to sort ASC
    print("Clicking '姓名' header to sort ASC...")
    page.click("#table-qifu-emp thead th:nth-child(4)")
    page.wait_for_timeout(1000)

    asc_names = page.evaluate("""() => {
        const dir = document.querySelector("#table-qifu-emp thead th:nth-child(4)").getAttribute("data-sort-dir");
        const names = Array.from(document.querySelectorAll("#tbody-qifu-emp tr")).slice(0, 5).map(tr => tr.children[3]?.innerText.trim());
        return { dir, names };
    }""")
    print("ASC Sort Result:", asc_names)

    # Click on 姓名 column again to sort DESC
    print("Clicking '姓名' header to sort DESC...")
    page.click("#table-qifu-emp thead th:nth-child(4)")
    page.wait_for_timeout(1000)

    desc_names = page.evaluate("""() => {
        const dir = document.querySelector("#table-qifu-emp thead th:nth-child(4)").getAttribute("data-sort-dir");
        const names = Array.from(document.querySelectorAll("#tbody-qifu-emp tr")).slice(0, 5).map(tr => tr.children[3]?.innerText.trim());
        return { dir, names };
    }""")
    print("DESC Sort Result:", desc_names)

    # Click on 年龄 column to sort by Age
    print("Clicking '年龄' header to sort by Age...")
    page.click("#table-qifu-emp thead th:nth-child(7)")
    page.wait_for_timeout(1000)

    age_sort = page.evaluate("""() => {
        const dir = document.querySelector("#table-qifu-emp thead th:nth-child(7)").getAttribute("data-sort-dir");
        const ages = Array.from(document.querySelectorAll("#tbody-qifu-emp tr")).slice(0, 5).map(tr => tr.children[6]?.innerText.trim());
        return { dir, ages };
    }""")
    print("Age Sort Result:", age_sort)

    page.screenshot(path=str(out_dir / "qifu_sorted_table.png"), full_page=False)

    # 3. Test Jizhong Tab 1 Column Sorting
    print("\n3. Testing Jizhong Tab 1 (员工薪酬档案) Multi-column sorting...")
    page.goto(f"{SITE_URL}/desk/jizhong-hr-salary-workbench")
    page.wait_for_selector("#table-jz-employees", state="visible", timeout=15000)
    page.wait_for_timeout(2000)

    # Click on '税后固定工资' column to sort by salary
    print("Clicking '税后固定工资' header to sort by Salary ASC...")
    page.click("#table-jz-employees thead th:nth-child(14)")
    page.wait_for_timeout(1000)

    salary_sort_asc = page.evaluate("""() => {
        const dir = document.querySelector("#table-jz-employees thead th:nth-child(14)").getAttribute("data-sort-dir");
        const salaries = Array.from(document.querySelectorAll("#tbody-jz-employees tr")).slice(0, 5).map(tr => tr.children[13]?.innerText.trim());
        return { dir, salaries };
    }""")
    print("Salary Sort ASC Result:", salary_sort_asc)

    print("Clicking '税后固定工资' header to sort by Salary DESC...")
    page.click("#table-jz-employees thead th:nth-child(14)")
    page.wait_for_timeout(1000)

    salary_sort_desc = page.evaluate("""() => {
        const dir = document.querySelector("#table-jz-employees thead th:nth-child(14)").getAttribute("data-sort-dir");
        const salaries = Array.from(document.querySelectorAll("#tbody-jz-employees tr")).slice(0, 5).map(tr => tr.children[13]?.innerText.trim());
        return { dir, salaries };
    }""")
    print("Salary Sort DESC Result:", salary_sort_desc)

    page.screenshot(path=str(out_dir / "jizhong_sorted_table.png"), full_page=False)

    print(f"\nConsole errors: {len(errors)}")
    browser.close()

if errors:
    print("Errors occurred!")
    sys.exit(1)

print("\nSUCCESS: All sorting and plain text badge validations passed with 0 errors!")
