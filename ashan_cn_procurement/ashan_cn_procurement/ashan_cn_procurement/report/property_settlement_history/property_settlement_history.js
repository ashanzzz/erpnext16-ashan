// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.query_reports["Property Settlement History"] = {
	"filters": [
		{
			"fieldname": "from_month",
			"label": __("起始月份"),
			"fieldtype": "Date"
		},
		{
			"fieldname": "to_month",
			"label": __("截止月份"),
			"fieldtype": "Date"
		},
		{
			"fieldname": "company",
			"label": __("公司"),
			"fieldtype": "Link",
			"options": "Company"
		},
		{
			"fieldname": "status",
			"label": __("状态"),
			"fieldtype": "Select",
			"options": "\n草稿\n已结算\n已作废"
		}
	]
};
