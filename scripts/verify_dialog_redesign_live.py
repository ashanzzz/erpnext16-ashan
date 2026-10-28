import os, sys, json
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path
from dotenv import load_dotenv
from playwright.sync_api import sync_playwright

load_dotenv(Path(".env"))
SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
USERNAME = os.getenv("ERPNEXT_USERNAME", "dev@example.invalid")
USER_PWD = os.getenv("ERPNEXT_PASSWORD", "")

print("Starting live verification of dialog redesign & dictionary...")
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1600, "height": 1000})
    
    # 1. Login
    page.goto(f"{SITE_URL}/login")
    page.fill("#login_email", USERNAME)
    page.fill("#login_password", USER_PWD)
    page.click("button.btn-login")
    page.wait_for_timeout(3000)
    
    # 2. Go to reimbursement-picker
    print("Navigating to /desk/reimbursement-picker...")
    page.goto(f"{SITE_URL}/desk/reimbursement-picker")
    page.wait_for_selector("#reim-data-table", timeout=15000)
    page.wait_for_timeout(1000)
    
    # Verify Dictionary & Filter Bar
    filter_label = page.locator("#reim-filter-bar .picker-filter-group label").nth(4).text_content()
    filter_ph = page.locator("#reim-filter-bar input[data-filter='owner']").get_attribute("placeholder")
    print(f"Filter bar creator label: '{filter_label}', placeholder: '{filter_ph}'")
    assert "制单人" in filter_label, f"Expected '制单人' in label, got {filter_label}"
    assert "制单人" in filter_ph, f"Expected '制单人' in placeholder, got {filter_ph}"
    print("[PASS] Filter bar uses unified '制单人'!")

    # Test AshanUI.Dictionary in browser JS
    dict_test = page.evaluate("""() => {
        return {
            label_creator: window.AshanUI.Dictionary.getLabel('creator'),
            label_danju: window.AshanUI.Dictionary.getLabel('单据人员'),
            label_owner: window.AshanUI.Dictionary.getLabel('owner'),
            label_jingshou: window.AshanUI.Dictionary.getLabel('经手人'),
            field_zhidan: window.AshanUI.Dictionary.getFieldName('制单人'),
            field_danju: window.AshanUI.Dictionary.getFieldName('单据人员'),
            field_company: window.AshanUI.Dictionary.getFieldName('所属公司')
        };
    }""")
    print("AshanUI.Dictionary test:", json.dumps(dict_test, ensure_ascii=False, indent=2))
    assert dict_test['label_danju'] == "制单人"
    assert dict_test['label_owner'] == "制单人"
    assert dict_test['field_danju'] == "owner"
    assert dict_test['field_zhidan'] == "owner"
    print("[PASS] AshanUI.Dictionary works bidirectionally and flawlessly!")

    # 3. Open Detail Dialog and inspect 3-row layout
    print("Opening detail dialog for BX-2026-00036...")
    page.locator(".picker-doc-clickable-link").first.click()
    page.wait_for_selector(".modal.ashan-dialog-abgs", timeout=10000)
    page.wait_for_timeout(1500)

    detail_card_info = page.evaluate("""() => {
        const grid = document.querySelector('.modal.ashan-dialog-abgs .ashan-po-form-grid');
        if (!grid) return null;
        const groups = Array.from(grid.querySelectorAll('.ashan-po-form-group')).map((g, i) => {
            const label = g.querySelector('.ashan-po-label')?.innerText.trim();
            const val = g.querySelector('input')?.value || g.querySelector('.ashan-status-display')?.innerText.trim();
            const rect = g.getBoundingClientRect();
            return {
                idx: i + 1,
                label,
                val,
                width: Math.round(rect.width),
                top: Math.round(rect.top),
                left: Math.round(rect.left),
                isFullWidth: g.classList.contains('col-span-full') || window.getComputedStyle(g).gridColumn.includes('1 / -1')
            };
        });
        return groups;
    }""")
    print("Detail context card fields:")
    for f in detail_card_info:
        print(f"  Field {f['idx']}: [{f['label']}] = '{f['val']}' (width={f['width']}px, top={f['top']}px, left={f['left']}px, fullWidth={f['isFullWidth']})")
    
    # Assert Row 1: 报销申请单号, 单据状态, 单据日期
    assert "单号" in detail_card_info[0]['label'], f"Field 1 should be 单号, got {detail_card_info[0]['label']}"
    assert "状态" in detail_card_info[1]['label'], f"Field 2 should be 状态, got {detail_card_info[1]['label']}"
    assert "日期" in detail_card_info[2]['label'], f"Field 3 should be 日期, got {detail_card_info[2]['label']}"
    assert abs(detail_card_info[0]['top'] - detail_card_info[1]['top']) <= 2
    assert abs(detail_card_info[1]['top'] - detail_card_info[2]['top']) <= 2
    print("[PASS] Row 1 verified: 单号 | 状态 | 日期 on the same row!")

    # Assert Row 2: 所属公司, 报销金额, 制单人
    assert "公司" in detail_card_info[3]['label'], f"Field 4 should be 公司, got {detail_card_info[3]['label']}"
    assert "金额" in detail_card_info[4]['label'], f"Field 5 should be 金额, got {detail_card_info[4]['label']}"
    assert "制单人" in detail_card_info[5]['label'], f"Field 6 should be 制单人, got {detail_card_info[5]['label']}"
    assert abs(detail_card_info[3]['top'] - detail_card_info[4]['top']) <= 2
    assert abs(detail_card_info[4]['top'] - detail_card_info[5]['top']) <= 2
    print("[PASS] Row 2 verified: 所属公司 | 报销金额 | 制单人 on the same row!")

    # Assert Row 3: 报销标题 (full width)
    assert "标题" in detail_card_info[6]['label'], f"Field 7 should be 标题, got {detail_card_info[6]['label']}"
    assert detail_card_info[6]['isFullWidth'], "Field 7 should be full width (col-span-full)!"
    assert detail_card_info[6]['width'] > detail_card_info[0]['width'] * 2, "Field 7 width should span all columns!"
    print(f"[PASS] Row 3 verified: 报销标题 spans full width ({detail_card_info[6]['width']}px)!")

    page.screenshot(path="temp_screenshots/reim_v2_redesigned_detail_dialog.png")
    print("Captured reim_v2_redesigned_detail_dialog.png")

    # Close dialog
    page.click(".modal.ashan-dialog-abgs .ashan-modal-close-btn")
    page.wait_for_timeout(1000)

    # 4. Open Create Dialog and inspect 3-row layout
    print("Opening create reimbursement modal...")
    page.click("#reim-open-create-modal-btn")
    page.wait_for_selector(".modal.ashan-dialog-abgs", timeout=10000)
    page.wait_for_timeout(1500)
    
    create_card_info = page.evaluate("""() => {
        const grid = document.querySelector('.modal.ashan-dialog-abgs .ashan-po-form-grid');
        if (!grid) return null;
        return Array.from(grid.querySelectorAll('.ashan-po-form-group')).map((g, i) => ({
            idx: i + 1,
            label: g.querySelector('.ashan-po-label')?.innerText.trim(),
            width: Math.round(g.getBoundingClientRect().width),
            isFullWidth: g.classList.contains('col-span-full') || window.getComputedStyle(g).gridColumn.includes('1 / -1')
        }));
    }""")
    print("Create dialog context card fields:")
    for f in create_card_info:
        print(f"  Field {f['idx']}: [{f['label']}] (width={f['width']}px, fullWidth={f['isFullWidth']})")
    
    assert "制单人" in create_card_info[5]['label'], f"Field 6 should be 制单人, got {create_card_info[5]['label']}"
    assert "标题" in create_card_info[6]['label'], f"Field 7 should be 标题, got {create_card_info[6]['label']}"
    assert create_card_info[6]['isFullWidth'], "Field 7 should be full width!"

    page.screenshot(path="temp_screenshots/reim_v2_redesigned_create_dialog.png")
    print("Captured reim_v2_redesigned_create_dialog.png")

    print("\nALL RE-DESIGN TESTS AND DICTIONARY VERIFICATIONS PASSED PERFECTLY!")
