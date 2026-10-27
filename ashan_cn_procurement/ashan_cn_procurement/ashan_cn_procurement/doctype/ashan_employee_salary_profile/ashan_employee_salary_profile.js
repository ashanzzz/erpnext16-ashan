// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.ui.form.on('Ashan Employee Salary Profile', {
	onload: function(frm) {
		set_dynamic_employee_type_options(frm);
	},
	refresh: function(frm) {
		set_dynamic_employee_type_options(frm);
	}
});

function set_dynamic_employee_type_options(frm) {
	const comp = frm.doc.company || '天津祺富机械加工有限公司';
	frappe.call({
		method: 'ashan_cn_procurement.services.employee_salary_service.get_qifu_employee_type_policies',
		args: { company: comp },
		callback: function(r) {
			const policies = r.message || [];
			const types = policies.map(p => p.employee_type).filter(Boolean);
			const opts = types.length ? types : ['正式工', '返聘工', '临时工', '其他-返聘工', '其他-正式工'];
			frm.set_df_property('employee_type', 'options', opts.join('\n'));
			frm.refresh_field('employee_type');
		}
	});
}
