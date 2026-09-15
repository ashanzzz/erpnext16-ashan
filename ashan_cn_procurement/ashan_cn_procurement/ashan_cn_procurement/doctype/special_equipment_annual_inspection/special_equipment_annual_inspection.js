// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.ui.form.on("Special Equipment Annual Inspection", {
	special_equipment(frm) {
		if (frm.doc.special_equipment && !frm.doc.company) {
			frappe.db.get_value("Special Equipment", frm.doc.special_equipment, "company", (r) => {
				if (r && r.company) {
					frm.set_value("company", r.company);
				}
			});
		}
	},

	check_date(frm) {
		if (frm.doc.check_date) {
			const d = frappe.datetime.str_to_obj(frm.doc.check_date);
			frm.set_value("inspection_year", d.getFullYear());

			// 自动推算下次检查日期 (+12个月)
			const nextD = frappe.datetime.add_months(frm.doc.check_date, 12);
			frm.set_value("next_check_date", nextD);
		}
	},
});
