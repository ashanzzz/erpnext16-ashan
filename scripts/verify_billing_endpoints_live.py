import os
import sys
import requests
from pathlib import Path
from dotenv import load_dotenv

if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding='utf-8')

PROJECT_ROOT = Path(__file__).resolve().parents[1]
load_dotenv(PROJECT_ROOT / ".env")

SITE_URL = os.getenv("ERPNEXT_SITE_URL", "http://192.168.8.11:6888")
TOKEN = os.getenv("ERPNEXT_TOKEN")
HEADERS = {"Authorization": TOKEN}

print(f"Connecting to {SITE_URL} with token...")

# 1. 验证获取固定支出配置
res = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.services.billing_recurring_service.get_recurring_configs",
    headers=HEADERS,
    json={"company": "天津吉众科技有限公司"},
    timeout=10
)
print("Recurring configs status:", res.status_code)
configs = res.json().get("message", [])
print(f"Loaded {len(configs)} recurring configs for Jizhong")
for c in configs:
    print(f"  - {c.get('expense_name')}: ¥{c.get('default_amount')} ({c.get('account_category')})")

# 2. 验证获取祺富账单数据
res_qf = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.ashan_cn_procurement.page.qifu_billing_workbench.qifu_billing_workbench.get_qifu_billing_data",
    headers=HEADERS,
    json={"period_month": "2026-07"},
    timeout=10
)
print("Qifu billing status:", res_qf.status_code)
qf_data = res_qf.json().get("message", {})
summary_qf = qf_data.get("summary", {})
print(f"Qifu 2026-07 Summary:")
print(f"  - 期初结存: ¥{summary_qf.get('opening_balance', 0):,.2f}")
print(f"  - 本月流入: ¥{summary_qf.get('total_income', 0):,.2f}")
print(f"  - 本月支出: ¥{summary_qf.get('total_expense', 0):,.2f}")
print(f"  - 期末结余: ¥{summary_qf.get('closing_balance', 0):,.2f}")
print(f"  - 流水笔数: {len(qf_data.get('stream_rows', []))} 笔")

# 3. 验证获取吉众账单数据
res_jz = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.get_jizhong_billing_data",
    headers=HEADERS,
    json={"period_month": "2026-07"},
    timeout=10
)
print("Jizhong billing status:", res_jz.status_code)
jz_data = res_jz.json().get("message", {})
summary_jz = jz_data.get("summary", {})
print(f"Jizhong 2026-07 Summary:")
print(f"  - 银行支出: ¥{summary_jz.get('bank_total', 0):,.2f} ({summary_jz.get('bank_count', 0)} 笔)")
print(f"  - 现金支出: ¥{summary_jz.get('cash_total', 0):,.2f} ({summary_jz.get('cash_count', 0)} 笔)")
print(f"  - 无票支出: ¥{summary_jz.get('no_inv_total', 0):,.2f} ({summary_jz.get('no_inv_count', 0)} 笔)")
print(f"  - 无票其他: ¥{summary_jz.get('no_inv_other_total', 0):,.2f} ({summary_jz.get('no_inv_other_count', 0)} 笔)")
print(f"  - 五金辅助库: ¥{summary_jz.get('hardware_total', 0):,.2f} ({summary_jz.get('hardware_count', 0)} 项)")

# 4. 验证 Excel 导出二进制输出
res_exp_qf = requests.get(
    f"{SITE_URL}/api/method/ashan_cn_procurement.services.billing_export_service.export_qifu_billing_excel?period_month=2026-07",
    headers=HEADERS,
    timeout=15
)
print("Qifu export status:", res_exp_qf.status_code, "Bytes:", len(res_exp_qf.content))

res_exp_jz = requests.get(
    f"{SITE_URL}/api/method/ashan_cn_procurement.services.billing_export_service.export_jizhong_billing_excel?period_month=2026-07&mode=single_month",
    headers=HEADERS,
    timeout=15
)
print("Jizhong export status:", res_exp_jz.status_code, "Bytes:", len(res_exp_jz.content))

assert res.status_code == 200, "Recurring configs failed"
assert res_qf.status_code == 200, "Qifu billing failed"
assert res_jz.status_code == 200, "Jizhong billing failed"
assert res_exp_qf.status_code == 200 and len(res_exp_qf.content) > 1000, "Qifu export failed"
assert res_exp_jz.status_code == 200 and len(res_exp_jz.content) > 1000, "Jizhong export failed"
print("\nALL BILLING WORKBENCH LIVE CHECKS PASSED!")
