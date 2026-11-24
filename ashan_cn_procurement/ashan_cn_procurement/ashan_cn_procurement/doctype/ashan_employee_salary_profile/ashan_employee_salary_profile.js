// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.ui.form.on('Ashan Employee Salary Profile', {
	refresh(frm) {
		apply_salary_mode_linkage(frm);
	},
	employee_type(frm) {
		apply_salary_mode_linkage(frm);
	}
});

function apply_salary_mode_linkage(frm) {
	const isTemp = (frm.doc.employee_type || '').trim() === '临时工';
	if (isTemp) {
		frm.set_df_property('salary_mode', 'options', ['不税动态工资']);
		if (frm.doc.salary_mode !== '不税动态工资') {
			frm.set_value('salary_mode', '不税动态工资');
		}
		frm.set_df_property('salary_mode', 'read_only', 1);
	} else {
		frm.set_df_property('salary_mode', 'options', [
			'税前动态工资',
			'税后动态工资',
			'税前固定工资',
			'税后固定工资'
		]);
		frm.set_df_property('salary_mode', 'read_only', 0);
		if (frm.doc.salary_mode === '不税动态工资' || !frm.doc.salary_mode) {
			frm.set_value('salary_mode', '税后动态工资');
		}
	}
}
