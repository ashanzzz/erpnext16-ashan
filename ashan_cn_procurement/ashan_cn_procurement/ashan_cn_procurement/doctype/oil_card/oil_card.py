# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import os
import frappe
from frappe.model.document import Document


class OilCard(Document):
	pass


@frappe.whitelist()
def purge_legacy_assets():
	"""
	Purges cached legacy assets on the Bench server.
	"""
	cleaned = []
	try:
		# Frappe site public assets path
		site_assets = frappe.get_site_path("public", "js", "ashan_cn_sidebar.js")
		if os.path.exists(site_assets):
			with open(site_assets, "w", encoding="utf-8") as f:
				f.write("// Deprecated legacy sidebar script\n")
			cleaned.append(site_assets)

		# Bench sites/assets path
		bench_assets = os.path.abspath(os.path.join(frappe.get_app_path("frappe"), "..", "..", "sites", "assets", "ashan_cn_procurement", "js", "ashan_cn_sidebar.js"))
		if os.path.exists(bench_assets):
			with open(bench_assets, "w", encoding="utf-8") as f:
				f.write("// Deprecated legacy sidebar script\n")
			cleaned.append(bench_assets)

		frappe.clear_cache()
	except Exception as e:
		return {"status": "error", "error": str(e)}

	return {"status": "ok", "cleaned": cleaned}
