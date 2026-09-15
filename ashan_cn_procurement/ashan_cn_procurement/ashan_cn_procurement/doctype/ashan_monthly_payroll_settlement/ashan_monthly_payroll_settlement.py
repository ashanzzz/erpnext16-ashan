# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.model.document import Document
from dateutil.relativedelta import relativedelta
from datetime import datetime


class AshanMonthlyPayrollSettlement(Document):
	def validate(self):
		if self.locked and not frappe.flags.ignore_lock:
			frappe.throw("该月度薪酬核定表已核定锁定，禁止直接修改！如需调整请先申请反审核解锁。")


@frappe.whitelist()
def get_allowed_billing_period(company):
	"""
	返回当前允许操作的最大核算账期（YYYY-MM 格式）。

	业务规则：
	  - 如果存在「已核定锁定」的最新账期 M，则 M+1 解锁（即可操作 M+1）。
	  - 如果不存在任何已封账记录，则最大可操作账期 = 当前日历月的上一个月（上月默认开账期）。
	  - 当前账期（本月）及更早的历史账期（已封账）可只读查看，但不能再提交封账。
	  - 用户永远无法选择「允许最大账期」之后的未来月份。

	返回格式示例：{"allowed_max": "2026-07", "default_period": "2026-07", "latest_closed": null}
	"""
	today = datetime.now()
	prev_month = today - relativedelta(months=1)
	prev_month_str = prev_month.strftime("%Y-%m")

	# 查找该公司最新的已封账（已核定锁定）记录
	latest_locked = frappe.db.sql("""
		SELECT period_month FROM `tabAshan Monthly Payroll Settlement`
		WHERE company = %s AND status IN ('已核定锁定', '已归档发放')
		ORDER BY period_month DESC
		LIMIT 1
	""", (company,), as_dict=True)

	if latest_locked:
		latest_closed_str = latest_locked[0].period_month
		# 封账月的下一个月解锁
		closed_dt = datetime.strptime(latest_closed_str, "%Y-%m")
		next_open = closed_dt + relativedelta(months=1)
		allowed_max = next_open.strftime("%Y-%m")
		# 默认操作账期：如果下一个开放月 <= 上个月，则 default = allowed_max；否则 = 上个月
		default_period = allowed_max if allowed_max <= prev_month_str else prev_month_str
	else:
		# 从未封账，只允许操作上个月
		latest_closed_str = None
		allowed_max = prev_month_str
		default_period = prev_month_str

	return {
		"allowed_max": allowed_max,       # 月份选择器上限（max 属性）
		"default_period": default_period,  # 打开时默认选中的账期
		"latest_closed": latest_closed_str # 最近一次已封账的账期（用于前端展示）
	}

