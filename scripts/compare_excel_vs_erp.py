import os
import sys
import json
import requests
import openpyxl
from collections import defaultdict
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv('.env')

SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')

s = requests.Session()
s.post(f'{SITE_URL}/api/method/login', data={'usr': USERNAME, 'pwd': USER_PWD})

# Load Excel
excel_path = 'D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202607/祺富人事202607-20261022.xlsm'
wb = openpyxl.load_workbook(excel_path, data_only=True)
db_sheet = wb['数据库']

excel_data = defaultdict(dict) # (period_str, emp_name) -> row
for r in db_sheet.iter_rows(min_row=2, values_only=True):
    p = str(r[0]) if r[0] else None
    name = str(r[2]).strip() if r[2] else None
    if p and name:
        # normalize period 202606 -> 2026-06
        norm_p = f"{p[:4]}-{p[4:6]}"
        excel_data[norm_p][name] = r

print(f"Loaded Excel periods: {list(excel_data.keys())}")

# Compare with ERPNext
for norm_p in sorted(excel_data.keys()):
    doc_name = f'天津祺富机械加工有限公司-{norm_p}'
    res = s.get(f'{SITE_URL}/api/resource/Ashan Monthly Payroll Settlement/{doc_name}')
    if res.status_code != 200:
        print(f"[{norm_p}] Not found in ERPNext (HTTP {res.status_code})")
        continue
    doc = res.json().get('data', {})
    items = doc.get('items', [])
    erp_map = {it.get('employee_name'): it for it in items}
    
    diffs = []
    for name, xl_row in excel_data[norm_p].items():
        erp_it = erp_map.get(name)
        if not erp_it:
            diffs.append(f"Missing in ERPNext: {name}")
            continue
        
        # Check HF person: xl_row[38], HF comp: xl_row[39]
        xl_hf_p = float(xl_row[38] or 0)
        xl_hf_c = float(xl_row[39] or 0)
        erp_hf_pt = float(erp_it.get('hf_person_total') or 0)
        erp_hf_p = float(erp_it.get('housing_fund_person') or 0)
        erp_hf_val = erp_hf_pt if erp_hf_pt > 0 else erp_hf_p
        
        # Check gross: xl_row[14], net: xl_row[28]
        xl_gross = float(xl_row[14] or 0)
        xl_net = float(xl_row[28] or 0)
        erp_gross = float(erp_it.get('gross_salary') or 0)
        erp_net = float(erp_it.get('net_salary') or 0)
        
        hf_diff = abs(xl_hf_p - erp_hf_val) > 0.01
        gross_diff = abs(xl_gross - erp_gross) > 0.01
        net_diff = abs(xl_net - erp_net) > 0.01
        
        if hf_diff or gross_diff or net_diff:
            diff_msg = f"{name}: "
            if hf_diff:
                diff_msg += f"HF_p xl={xl_hf_p} vs erp={erp_hf_val} | "
            if gross_diff:
                diff_msg += f"Gross xl={xl_gross} vs erp={erp_gross} | "
            if net_diff:
                diff_msg += f"Net xl={xl_net} vs erp={erp_net} | "
            diffs.append(diff_msg)
            
    print(f"[{norm_p}] Diffs count: {len(diffs)}")
    for d in diffs[:8]:
        print(f"   {d}")
    if len(diffs) > 8:
        print(f"   ... and {len(diffs) - 8} more")
