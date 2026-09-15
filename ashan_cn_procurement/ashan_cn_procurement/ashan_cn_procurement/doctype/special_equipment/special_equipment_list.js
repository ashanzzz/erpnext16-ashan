// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.listview_settings["Special Equipment"] = {
	add_fields: ["inspection_status", "annual_check_status", "equipment_status", "plate_number", "internal_number"],
	get_indicator(doc) {
		if (doc.equipment_status && doc.equipment_status !== "在用") {
			return [__(doc.equipment_status), "gray", `equipment_status,=,${doc.equipment_status}`];
		}
		if (doc.inspection_status === "已逾期" || doc.annual_check_status === "已逾期") {
			return [__("已逾期"), "red", "inspection_status,=,已逾期"];
		}
		if (doc.inspection_status === "今日到期" || doc.annual_check_status === "今日到期") {
			return [__("今日到期"), "red", "inspection_status,=,今日到期"];
		}
		if (doc.inspection_status === "即将到期" || doc.annual_check_status === "即将到期") {
			return [__("即将到期"), "orange", "inspection_status,=,即将到期"];
		}
		if (doc.inspection_status === "注意" || doc.annual_check_status === "注意") {
			return [__("注意"), "yellow", "inspection_status,=,注意"];
		}
		if (doc.inspection_status === "正常" && (doc.annual_check_status === "正常" || !doc.annual_check_status)) {
			return [__("正常"), "green", "inspection_status,=,正常"];
		}
		return [__("待录入"), "gray", "inspection_status,=,待录入"];
	},
};
