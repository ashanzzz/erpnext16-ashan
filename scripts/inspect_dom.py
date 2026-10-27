import os, sys, json
sys.stdout.reconfigure(encoding='utf-8')
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path(".env"))
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_timeout(2000)
    page.goto(f"{SITE_URL}/desk/reimbursement-picker")
    page.wait_for_selector("#reim-data-table", timeout=20000)
    page.wait_for_timeout(1000)
    
    # Detail view
    page.click("button.picker-view-btn[data-mode='detail']")
    page.wait_for_timeout(1000)
    
    info = page.evaluate("""() => {
        const row = document.querySelector('#reim-table-body tr');
        if (!row) return 'No row';
        const cells = Array.from(row.querySelectorAll('td')).map((td, i) => {
            const rect = td.getBoundingClientRect();
            return {
                idx: i,
                text: td.innerText.trim(),
                className: td.className,
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                position: window.getComputedStyle(td).position
            };
        });
        const ths = Array.from(document.querySelectorAll('#reim-table-head th')).map((th, i) => {
            const rect = th.getBoundingClientRect();
            return {
                idx: i,
                text: th.innerText.trim(),
                className: th.className,
                left: Math.round(rect.left),
                width: Math.round(rect.width),
                position: window.getComputedStyle(th).position
            };
        });
        return { ths, cells };
    }""")
    print(json.dumps(info, ensure_ascii=False, indent=2))
