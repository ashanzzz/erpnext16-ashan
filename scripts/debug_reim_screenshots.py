import os, sys
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path('.env'))
SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1600, 'height': 1000})
    page.goto(f'{SITE_URL}/login')
    page.fill('#login_email', USERNAME)
    page.fill('#login_password', USER_PWD)
    page.click('button.btn-login')
    page.wait_for_timeout(3000)
    page.goto(f'{SITE_URL}/desk/reimbursement-picker')
    page.wait_for_selector('#reim-data-table', timeout=20000)
    page.wait_for_timeout(2000)
    
    # Doc view screenshot
    page.screenshot(path='temp_screenshots/reim_doc_view.png')
    
    # Check detail view
    page.click('button.picker-view-btn[data-view="detail"]')
    page.wait_for_timeout(2000)
    page.screenshot(path='temp_screenshots/reim_detail_view.png')
    
    # Open detail dialog if any row exists
    first_row_link = page.locator('.picker-doc-clickable-link').first
    if first_row_link.is_visible():
        first_row_link.click()
        page.wait_for_timeout(2000)
        page.screenshot(path='temp_screenshots/reim_detail_dialog.png')
    
    print('Screenshots captured successfully!')
