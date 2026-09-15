// Copyright (c) 2026, Ashan CN Procurement and contributors
// For license information, please see license.txt

frappe.ui.form.on("Special Equipment Inspection", {
	refresh(frm) {
		toggle_precision_fields(frm);
	},

	special_equipment(frm) {
		if (frm.doc.special_equipment && !frm.doc.company) {
			frappe.db.get_value("Special Equipment", frm.doc.special_equipment, "company", (r) => {
				if (r && r.company) {
					frm.set_value("company", r.company);
				}
			});
		}
	},

	due_date_precision(frm) {
		toggle_precision_fields(frm);
	},

	valid_until_month(frm) {
		if (frm.doc.valid_until_month) {
			const m = frm.doc.valid_until_month.trim();
			const match = m.match(/(\d{4})[^\d]?(\d{1,2})/);
			if (match) {
				const year = match[1];
				const month = String(parseInt(match[2])).padStart(2, '0');
				frm.set_value("reminder_due_date", `${year}-${month}-01`);
			}
		}
	},
});

function toggle_precision_fields(frm) {
	const isExact = frm.doc.due_date_precision === "精确日期";
	frm.toggle_reqd("valid_until", isExact);
	frm.toggle_reqd("valid_until_month", !isExact);
	frm.toggle_display("valid_until", isExact);
	frm.toggle_display("valid_until_month", !isExact);
	frm.toggle_display("reminder_due_date", !isExact);
}
