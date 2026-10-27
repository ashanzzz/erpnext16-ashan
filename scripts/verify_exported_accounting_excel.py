import sys, os, requests, base64, io, openpyxl
from dotenv import load_dotenv

load_dotenv('.env')
s = requests.Session()
s.post(f"{os.getenv('ERPNEXT_SITE_URL')}/api/method/login", data={'usr': os.getenv('ERPNEXT_USERNAME'), 'pwd': os.getenv('ERPNEXT_PASSWORD')})

# Call export_qifu_payroll_excel with sheet_type="accounting_xlsm"
res = s.post(f"{os.getenv('ERPNEXT_SITE_URL')}/api/method/ashan_cn_procurement.services.payroll_settlement_service.export_qifu_payroll_excel", data={
    'company': '天津祺富机械加工有限公司',
    'period_month': '2026-07',
    'sheet_type': 'accounting_xlsm'
})
res_json = res.json()
msg = res_json.get('message', {})
b64 = msg.get('file_base64')
fname = msg.get('filename')

print("Export filename:", fname)
wb = openpyxl.load_workbook(io.BytesIO(base64.b64decode(b64)))
print("Sheets in exported workbook:", wb.sheetnames)

# 1. Check ordinary sheet
ws = wb['记账工资表']
print("\n=== 检查「记账工资表」 ===")
# Title A1
a1 = ws['A1']
print(f"A1 text: {a1.value}")
print(f"A1 font: name={a1.font.name}, size={a1.font.size}, bold={a1.font.bold}")
print(f"A1 align: horiz={a1.alignment.horizontal}, shrink={a1.alignment.shrink_to_fit}")
assert a1.value == "2026年7月 工资表 天津祺富机械加工有限公司", f"A1 value mismatch: {a1.value}"
assert a1.font.name == "宋体", f"A1 font mismatch: {a1.font.name}"
assert a1.font.size == 20, f"A1 font size mismatch: {a1.font.size}"
assert a1.font.bold is True, "A1 should be bold"
assert a1.alignment.shrink_to_fit is True, "A1 should be shrink_to_fit"

# Header Row 2
print("\n--- 检查表头行 Row 2 ---")
for c in range(1, 12):
    cell = ws.cell(row=2, column=c)
    print(f"Col {c} ({cell.value}): font={cell.font.name} {cell.font.size} bold={cell.font.bold}, shrink={cell.alignment.shrink_to_fit}")
    assert cell.font.name == "宋体"
    assert cell.font.size == 12
    assert cell.font.bold is True
    assert cell.alignment.shrink_to_fit is True

# Data Row 3
print("\n--- 检查数据行 Row 3 ---")
for c in range(1, 12):
    cell = ws.cell(row=3, column=c)
    h_cell = ws.cell(row=2, column=c)
    print(f"Col {c} ({h_cell.value}): val={cell.value}, font={cell.font.name} {cell.font.size} bold={cell.font.bold}, shrink={cell.alignment.shrink_to_fit}")
    assert cell.font.name == "宋体"
    assert cell.font.size == 11
    if c in (10, 11):
        assert cell.font.bold is True, f"Col {c} should be bold"
    else:
        assert cell.font.bold is False, f"Col {c} should be regular"
    assert cell.alignment.shrink_to_fit is True

# Total Row
last_row = ws.max_row
print(f"\n--- 检查合计行 Row {last_row} ---")
assert ws.cell(row=last_row, column=1).value == "合计"
assert ws.cell(row=last_row, column=2).value is None
for c in range(1, 12):
    cell = ws.cell(row=last_row, column=c)
    h_cell = ws.cell(row=2, column=c)
    print(f"Col {c} ({h_cell.value}): val={cell.value}, font={cell.font.name} {cell.font.size} bold={cell.font.bold}, shrink={cell.alignment.shrink_to_fit}")
    assert cell.font.name == "宋体"
    assert cell.font.size == 11
    assert cell.font.bold is True
    assert cell.alignment.shrink_to_fit is True

# 2. Check foreign sheet
ws_f = wb['记账工资表外籍']
print("\n=== 检查「记账工资表外籍」 ===")
a1_f = ws_f['A1']
print(f"A1 text: {a1_f.value}")
assert a1_f.value == "2026年7月 工资表 天津祺富机械加工有限公司"
assert a1_f.font.name == "宋体"
assert a1_f.font.size == 20
assert a1_f.font.bold is True
assert a1_f.alignment.shrink_to_fit is True

print("\nALL ASSERTIONS PASSED! 100% PERFECT!")
