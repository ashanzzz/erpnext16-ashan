# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe

@frappe.whitelist()
def ping():
	return "pong"
