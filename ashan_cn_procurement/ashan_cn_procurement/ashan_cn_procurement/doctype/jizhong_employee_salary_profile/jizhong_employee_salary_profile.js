// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.ui.form.on('Jizhong Employee Salary Profile', {
	onload: function(frm) {
		set_jizhong_employee_type_options(frm);
	},
	refresh: function(frm) {
		calculate_deductions_total(frm);
		set_jizhong_employee_type_options(frm);
	},
	btn_parse_id_card: function(frm) {
		parse_id_card_and_set(frm, false);
	},
	id_card: function(frm) {
		if ((frm.doc.certificate_type || '中国居民身份证') === '中国居民身份证') {
			parse_id_card_and_set(frm, true);
		}
	},
	deduction_child_education: function(frm) { calculate_deductions_total(frm); },
	deduction_continuing_education: function(frm) { calculate_deductions_total(frm); },
	deduction_serious_illness: function(frm) { calculate_deductions_total(frm); },
	deduction_housing_loan: function(frm) { calculate_deductions_total(frm); },
	deduction_housing_rent: function(frm) { calculate_deductions_total(frm); },
	deduction_elderly_care: function(frm) { calculate_deductions_total(frm); },
	deduction_infant_care: function(frm) { calculate_deductions_total(frm); }
});

function set_jizhong_employee_type_options(frm) {
	const comp = frm.doc.company || '天津吉众科技有限公司';
	frappe.call({
		method: 'ashan_cn_procurement.services.jizhong_payroll_service.get_jizhong_employee_type_policies',
		args: { company: comp },
		callback: function(r) {
			const policies = r.message || [];
			const types = policies.map(p => p.employee_type).filter(Boolean);
			const opts = types.length ? types : ['正式工', '返聘工', '临时工', '其他-返聘工', '其他-正式工', '其他-管理'];
			frm.set_df_property('employee_type', 'options', opts.join('\n'));
			frm.refresh_field('employee_type');
		}
	});
}

function parse_id_card_and_set(frm, is_auto) {
	const id_card = (frm.doc.id_card || '').trim();
	if (!id_card) return;
	frappe.call({
		method: 'ashan_cn_procurement.services.jizhong_payroll_service.parse_id_card_info',
		args: { id_card: id_card },
		callback: function(r) {
			if (r.message && r.message.success) {
				const d = r.message;
				if (d.birth_date) frm.set_value('birth_date', d.birth_date);
				if (d.gender) frm.set_value('gender', d.gender);
				if (d.current_age) frm.set_value('current_age', d.current_age);
				if (d.retirement_category) frm.set_value('retirement_category', d.retirement_category);
				if (d.original_retirement_age) frm.set_value('original_retirement_age', d.original_retirement_age);
				if (d.original_retirement_period) frm.set_value('original_retirement_period', d.original_retirement_period);
				if (d.delayed_retirement_age) frm.set_value('delayed_retirement_age', d.delayed_retirement_age);
				if (d.delayed_retirement_period) frm.set_value('delayed_retirement_period', d.delayed_retirement_period);
				if (d.additional_delay_months !== undefined) frm.set_value('additional_delay_months', d.additional_delay_months);
				if (!is_auto) {
					frappe.show_alert({ message: __('已成功识别身份证信息！'), indicator: 'green' });
				}
			}
		}
	});
}

function calculate_deductions_total(frm) {
	const flds = [
		'deduction_child_education', 'deduction_continuing_education', 'deduction_serious_illness',
		'deduction_housing_loan', 'deduction_housing_rent', 'deduction_elderly_care', 'deduction_infant_care'
	];
	let tot = 0;
	flds.forEach(f => { tot += Number(frm.doc[f] || 0); });
	frm.set_value('special_additional_deductions_total', tot);
}
