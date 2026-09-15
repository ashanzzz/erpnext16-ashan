"""Link every existing employee profile to the annual minimum social-insurance base."""

import frappe


def execute():
	"""Backfill the new mode only when it was previously unset.

	No historical amount is overwritten: legacy values remain available for audit, but
	the new effective-base resolver treats every migrated employee as minimum-bound.
	Users can opt individual exceptions into the explicit custom mode afterwards.
	"""
	frappe.reload_doc("ashan_cn_procurement", "doctype", "ashan_employee_salary_profile", force=True)
	if not frappe.db.exists("DocType", "Ashan Employee Salary Profile"):
		return
	frappe.db.sql(
		"""
		UPDATE `tabAshan Employee Salary Profile`
		   SET social_security_base_mode=%s
		 WHERE COALESCE(TRIM(social_security_base_mode), '')=''
		""",
		("最低缴费基数",),
	)
	frappe.db.commit()
