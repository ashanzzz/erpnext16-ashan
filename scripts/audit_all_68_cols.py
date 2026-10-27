import openpyxl
import sys
import os
import json
import requests
from dotenv import load_dotenv

sys.stdout.reconfigure(encoding='utf-8')
load_dotenv('.env')

SITE_URL = os.getenv('ERPNEXT_SITE_URL', 'http://192.168.8.11:6888')
USERNAME = os.getenv('ERPNEXT_USERNAME', 'dev@example.invalid')
USER_PWD = os.getenv('ERPNEXT_PASSWORD', '')

s = requests.Session()
s.post(f'{SITE_URL}/api/method/login', data={'usr': USERNAME, 'pwd': USER_PWD})

# Call get_tax_settlement_full_sheet
res = s.get(f'{SITE_URL}/api/method/ashan_cn_procurement.services.payroll_settlement_service.get_tax_settlement_full_sheet?company=天津祺富机械加工有限公司&period_month=2026-07')
erp_data = res.json().get('message', {})
erp_rows = {r['employee_name']: r for r in erp_data.get('rows', [])}

# Load Excel 个人所得税
excel_path = 'D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202607/祺富人事202607-20261022.xlsm'
wb = openpyxl.load_workbook(excel_path, data_only=True)
tax_sheet = wb['个人所得税']

# Col mapping from Excel row 5 (0-indexed)
# 0:序号, 1:工号, 2:姓名, 3:证件号码, 4:性别, 5:本期所属期, 6:员工类型, 7:目标工资, 8:工资类型, 9:税前工资, 10:起征点扣除,
# 11:公积金, 12:社保, 13:工资扣除合计, 14:基本养老, 15:基本医疗, 16:大额医疗, 17:失业保险, 18:住房公积金, 19:专项扣除合计,
# 20:子女教育, 21:继续教育, 22:大病医疗, 23:住房贷款利息, 24:住房租金, 25:赡养老人, 26:3岁以下婴幼儿照护, 27:专项附加扣除合计,
# 28:税前工资(往期), 29:起征点扣除(往期), 30:基本养老(往期), 31:基本医疗(往期), 32:大额医疗(往期), 33:失业保险(往期), 34:住房公积金(往期), 35:专项扣除合计(往期),
# 36:子女教育(往期), 37:继续教育(往期), 38:大病医疗(往期), 39:住房贷款利息(往期), 40:住房租金(往期), 41:赡养老人(往期), 42:3岁以下婴幼儿照护(往期), 43:专项附加扣除合计(往期),
# 44:个税_税前工资(全部), 45:起征点扣除(全部), 46:基本养老(全部), 47:基本医疗(全部), 48:大额医疗(全部), 49:失业保险(全部), 50:个税_专项扣除_住房公积金(全部), 51:专项扣除合计(全部),
# 52:子女教育(全部), 53:继续教育(全部), 54:大病医疗(全部), 55:住房贷款利息(全部), 56:住房租金(全部), 57:赡养老人(全部), 58:3岁以下婴幼儿照护(全部), 59:专项附加扣除合计(全部),
# 60:应纳税所得额, 61:税率, 62:速算扣除数, 63:应纳税额, 64:减免税额, 65:已缴税额, 66:应补/退税额, 67:税后工资

col_erp_field = {
    7: 'target_salary',
    9: 'gross_salary',
    10: 'thresh_cur',
    11: 'hf_person',
    12: 'ss_person',
    14: 'ss_pension',
    15: 'ss_med',
    16: 'ss_large_med',
    17: 'ss_unemp',
    18: 'hf_spec',
    19: 'spec_tot_cur',
    27: 'spec_add_tot_cur',
    28: 'gross_prior',
    29: 'thresh_prior',
    30: 'ss_pension_prior',
    31: 'ss_med_prior',
    32: 'ss_large_med_prior',
    33: 'ss_unemp_prior',
    34: 'hf_spec_prior',
    35: 'spec_tot_prior',
    43: 'spec_add_tot_prior',
    44: 'gross_all',
    45: 'thresh_all',
    46: 'ss_pension_all',
    47: 'ss_med_all',
    48: 'ss_large_med_all',
    49: 'ss_unemp_all',
    50: 'hf_spec_all',
    51: 'spec_tot_all',
    59: 'spec_add_tot_all',
    60: 'taxable_all',
    61: 'tax_rate',
    62: 'quick_deduct',
    65: 'tax_paid_prior',
    66: 'tax_amount',
    67: 'net_salary',
}

headers = [c for c in list(tax_sheet.iter_rows(values_only=True))[4]]
rows = list(tax_sheet.iter_rows(values_only=True))[5:]

all_diffs = []
for r in rows:
    name = r[2]
    if not name or name == '合计':
        continue
    erp = erp_rows.get(name)
    if not erp:
        all_diffs.append((name, "ALL", "NotInERP", 0, 0))
        continue
    for col_idx, field in col_erp_field.items():
        xl_v = float(r[col_idx] or 0)
        erp_v = float(erp.get(field) or 0)
        if abs(xl_v - erp_v) > 0.02:
            col_name = headers[col_idx]
            all_diffs.append((name, f"Col {col_idx} ({col_name})", field, xl_v, erp_v, round(erp_v - xl_v, 2)))

print(f"Total differences found across all 68 columns: {len(all_diffs)}")
for d in all_diffs:
    print(f"{d[0]:<10} {d[1]:<25} {d[2]:<18} xl={d[3]:<10.2f} erp={d[4]:<10.2f} diff={d[5]:<10.2f}")
