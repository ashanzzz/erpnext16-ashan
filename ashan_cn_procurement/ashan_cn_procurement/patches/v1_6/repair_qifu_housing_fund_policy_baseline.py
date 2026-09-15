"""Restore the confirmed Qifu housing-fund master-data baseline."""

import frappe


def execute():
	"""Repair legacy policy/base values before the next open payroll calculation."""
	if not frappe.db.exists("DocType", "Ashan Employee Salary Profile"):
		return

	from ashan_cn_procurement.services.housing_fund_policy_service import (
		repair_qifu_housing_fund_baseline,
	)

	repair_qifu_housing_fund_baseline()
