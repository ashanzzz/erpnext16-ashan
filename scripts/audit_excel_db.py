import openpyxl
import sys
from collections import defaultdict
sys.stdout.reconfigure(encoding='utf-8')

excel_path = 'D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202607/祺富人事202607-20261022.xlsm'
wb = openpyxl.load_workbook(excel_path, data_only=True)
db_sheet = wb['数据库']

headers = [cell.value for cell in db_sheet[1]]
print("Headers count:", len(headers))

# Let's inspect all months in '数据库'
# Col 0: 所属期, Col 1: 工号, Col 2: 姓名
# Col 11: 公积金_基数, Col 14: 个税_税前工资, Col 28: 个税_税后工资, Col 38: 公积金_个人_住房公积金, Col 39: 公积金_单位_住房公积金
rows_by_period = defaultdict(list)
for r in db_sheet.iter_rows(min_row=2, values_only=True):
    p = str(r[0]) if r[0] else None
    if p:
        rows_by_period[p].append(r)

print("\n--- Summary per period in Excel 数据库 ---")
for p, rows in sorted(rows_by_period.items()):
    hf_person_sum = sum(float(r[38] or 0) for r in rows)
    hf_comp_sum = sum(float(r[39] or 0) for r in rows)
    gross_sum = sum(float(r[14] or 0) for r in rows)
    net_sum = sum(float(r[28] or 0) for r in rows)
    non_zero_hf = [(r[2], r[38]) for r in rows if float(r[38] or 0) > 0]
    print(f"Period {p}: {len(rows)} people, Gross={gross_sum:,.2f}, Net={net_sum:,.2f}, HF_Person={hf_person_sum:,.2f}, HF_Comp={hf_comp_sum:,.2f}")
    print(f"   HF Contributors ({len(non_zero_hf)}): {non_zero_hf[:5]} ...")
