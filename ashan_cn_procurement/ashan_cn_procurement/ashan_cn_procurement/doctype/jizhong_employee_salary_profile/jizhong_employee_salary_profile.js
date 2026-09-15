// Copyright (c) 2026, Ashan and contributors
// For license information, please see license.txt

frappe.ui.form.on('Jizhong Employee Salary Profile', {
	refresh: function(frm) {
		calculate_deductions_total(frm);
	},
	btn_parse_id_card: function(frm) {
		parse_id_card_and_set(frm, false);
	},
	id_card: function(frm) {
		if ((frm.doc.certificate_type || '居民身份证') === '居民身份证') {
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

function parse_id_card_and_set(frm, silent) {
	const certType = frm.doc.certificate_type || '居民身份证';
	if (certType !== '居民身份证') {
		if (!silent) {
			frappe.msgprint(__('当前证件类型非居民身份证，无法自动解析，请手动选择性别与出生日期。'));
		}
		return;
	}
	const idCard = (frm.doc.id_card || '').trim().toUpperCase();
	if (!idCard) {
		if (!silent) frappe.msgprint(__('请先输入居民身份证号码。'));
		return;
	}
	if (idCard.length === 18 && /^\d{17}[\dXx]$/.test(idCard)) {
		const year = idCard.substring(6, 10);
		const month = idCard.substring(10, 12);
		const day = idCard.substring(12, 14);
		const birthDate = `${year}-${month}-${day}`;
		const genderCode = parseInt(idCard.substring(16, 17), 10);
		const gender = (genderCode % 2 === 1) ? '男' : '女';

		frm.set_value('birth_date', birthDate);
		frm.set_value('gender', gender);
		if (!silent) {
			frappe.show_alert({
				message: `身份证识别成功：${gender}性，出生日期 ${birthDate}`,
				indicator: 'green'
			});
		}
	} else if (!silent) {
		frappe.msgprint(__('请输入有效的18位居民身份证号码。'));
	}
}

function calculate_deductions_total(frm) {
	const total = flt(frm.doc.deduction_child_education) +
		flt(frm.doc.deduction_continuing_education) +
		flt(frm.doc.deduction_serious_illness) +
		flt(frm.doc.deduction_housing_loan) +
		flt(frm.doc.deduction_housing_rent) +
		flt(frm.doc.deduction_elderly_care) +
		flt(frm.doc.deduction_infant_care);
	frm.set_value('special_additional_deductions_total', total);
}
