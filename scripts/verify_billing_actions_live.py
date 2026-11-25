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

# 1. 测试在吉众自动生成当月固定支出 (会计工资 2400)
res_gen = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.services.billing_recurring_service.auto_generate_monthly_recurring_expenses",
    headers=HEADERS,
    json={"period_month": "2026-07", "company": "天津吉众科技有限公司"},
    timeout=10
)
print("Auto-generate status:", res_gen.status_code)
gen_data = res_gen.json().get("message", {})
print("Auto-generate results:", gen_data.get("results"))

# 2. 再次获取吉众账单数据，核验无票支出是否真实增加
res_jz = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.get_jizhong_billing_data",
    headers=HEADERS,
    json={"period_month": "2026-07"},
    timeout=10
)
jz_data = res_jz.json().get("message", {})
summary_jz = jz_data.get("summary", {})
print(f"Jizhong after recurring auto-gen:")
print(f"  - 无票支出: ¥{summary_jz.get('no_inv_total', 0):,.2f} ({summary_jz.get('no_inv_count', 0)} 笔)")
for r in jz_data.get("no_inv_rows", []):
    print(f"    * {r.get('date')} | {r.get('item')} | ¥{r.get('expense')} | 结余: ¥{r.get('balance')} | 单号: {r.get('voucher_no')}")

# 3. 测试核定封账与解锁
res_lock = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.toggle_jizhong_billing_lock",
    headers=HEADERS,
    json={"period_month": "2026-07", "lock": 1},
    timeout=10
)
print("Lock toggle status:", res_lock.status_code, res_lock.json().get("message"))

# 检查是否为 locked
res_jz_locked = requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.get_jizhong_billing_data",
    headers=HEADERS,
    json={"period_month": "2026-07"},
    timeout=10
)
is_locked = res_jz_locked.json().get("message", {}).get("is_locked")
print("Verified is_locked in workbench data:", is_locked)
assert is_locked == 1, "Failed to verify locked state"

# 解锁恢复待对账状态
requests.post(
    f"{SITE_URL}/api/method/ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench.toggle_jizhong_billing_lock",
    headers=HEADERS,
    json={"period_month": "2026-07", "lock": 0},
    timeout=10
)
print("Restored to unlocked (pending) status successfully!")
