import os
import sys
import json
import requests
import openpyxl
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv('.env')

SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')

s = requests.Session()
s.post(f'{SITE_URL}/api/method/login', data={'usr': USERNAME, 'pwd': USER_PWD})

# Call get_tax_settlement_full_sheet for 2026-07
res = s.get(f'{SITE_URL}/api/method/ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_full_sheet?company=天津祺富机械加工有限公司&period_month=2026-07')
erp_tax_data = res.json().get('message', {})
erp_rows = erp_tax_data.get('rows', [])
print(f"ERP Tax Rows: {len(erp_rows)}")

# Load Excel 个人所得税
excel_path = 'D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202607/祺富人事202607-20261022.xlsm'
wb = openpyxl.load_workbook(excel_path, data_only=True)
tax_sheet = wb['个人所得税']

# Row 5 is header, row 6 onwards is data
xl_rows = list(tax_sheet.iter_rows(values_only=True))[5:]
xl_map = {}
for r in xl_rows:
    if r[2] and r[2] != '合计':
        xl_map[str(r[2]).strip()] = r

print(f"Excel Tax Rows: {len(xl_map)}")

erp_map = {r.get('employee_name'): r for r in erp_rows if r.get('employee_name')}

# Compare
print(f"\n{'姓名':<10} {'项':<15} {'Excel值':<15} {'ERP值':<15} {'差额'}")
print("-" * 65)
diff_count = 0
for name, xl in xl_map.items():
    erp = erp_map.get(name)
    if not erp:
        print(f"{name:<10} 缺失在ERP中!")
        diff_count += 1
        continue
    
    # Let's compare key 68 columns:
    # xl[7] = 目标工资, xl[9] = 税前工资, xl[11] = 本月公积金, xl[12] = 本月社保
    # xl[34] = 往期公积金, xl[50] = 全部公积金, xl[60] = 应纳税所得额, xl[66] = 应补退税额, xl[67] = 税后工资
    checks = [
        ('目标工资', float(xl[7] or 0), float(erp.get('target_salary') or 0)),
        ('税前工资', float(xl[9] or 0), float(erp.get('gross_salary') or 0)),
        ('本月公积金', float(xl[11] or 0), float(erp.get('housing_fund_person') or 0)),
        ('往期公积金', float(xl[34] or 0), float(erp.get('housing_fund_prior') or 0)),
        ('全部公积金', float(xl[50] or 0), float(erp.get('housing_fund_all') or 0)),
        ('应纳税所得额', float(xl[60] or 0), float(erp.get('taxable_income_all') or 0)),
        ('应补退税额', float(xl[66] or 0), float(erp.get('tax_amount') or 0)),
        ('税后工资', float(xl[67] or 0), float(erp.get('net_salary') or 0)),
    ]
    person_diffs = []
    for item_name, xl_val, erp_val in checks:
        if abs(xl_val - erp_val) > 0.01:
            person_diffs.append((item_name, xl_val, erp_val, round(erp_val - xl_val, 2)))
    
    if person_diffs:
        diff_count += 1
        for item_name, xl_val, erp_val, diff in person_diffs:
            print(f"{name:<10} {item_name:<15} {xl_val:<15.2f} {erp_val:<15.2f} {diff:<15.2f}")

print(f"\nTotal people with diffs: {diff_count} / {len(xl_map)}")
