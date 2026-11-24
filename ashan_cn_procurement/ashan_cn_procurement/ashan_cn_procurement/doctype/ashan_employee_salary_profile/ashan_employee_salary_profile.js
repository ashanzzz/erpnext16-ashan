// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.ui.form.on('Ashan Employee Salary Profile', {
	refresh(frm) {
		load_active_employee_types(frm);
		apply_salary_mode_linkage(frm);
	},
	employee_type(frm) {
		apply_salary_mode_linkage(frm);
	}
});

function load_active_employee_types(frm) {
	frappe.db.get_list('Qifu Employee Type Policy', {
		filters: { company: frm.doc.company || '天津祺富机械加工有限公司', is_active: 1 },
		pluck: 'employee_type',
		order_by: 'creation asc',
		limit: 50
	}).then(records => {
		if (records && records.length) {
			const opts = [...records];
			if (frm.doc.employee_type && !opts.includes(frm.doc.employee_type)) {
				opts.push(frm.doc.employee_type);
			}
			frm.set_df_property('employee_type', 'options', opts);
		}
	});
}

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
