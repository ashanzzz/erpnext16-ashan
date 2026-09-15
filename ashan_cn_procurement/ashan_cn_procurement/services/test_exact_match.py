# Copyright (c) 2026, Ashan CN Procurement
import frappe
from ashan_cn_procurement.services.tax_invoice_matcher import update_tax_invoice_match_state

def test_exact_match_rule():
	# 清理旧数据
	inv_no = '26122000000099990001'
	if frappe.db.exists('Tax Invoice', inv_no):
		frappe.delete_doc('Tax Invoice', inv_no, force=1, ignore_permissions=True)

	pis = frappe.get_all('Purchase Invoice', filters={'bill_no': inv_no}, fields=['name'])
	for p in pis:
		frappe.delete_doc('Purchase Invoice', p.name, force=1, ignore_permissions=True)

	# 1. 创建税局发票 (金额 ¥3,390.00)
	doc = frappe.new_doc('Tax Invoice')
	doc.invoice_no = inv_no
	doc.issue_date = '2026-08-15'
	doc.invoice_type = '电子发票(增值税专用发票)'
	doc.company = '天津吉众科技有限公司'
	doc.seller_name = '天津市某某科技有限公司'
	doc.buyer_name = '天津吉众科技有限公司'
	doc.amount_without_tax = 3000.00
	doc.tax_amount = 390.00
	doc.invoice_grand_total = 3390.00
	doc.payable_total = 3390.00
	doc.business_status = '待录入'
	doc.match_status = '未匹配'
	doc.insert(ignore_permissions=True)

	# 2. 模拟 ERP 采购发票金额不符 (录入了 ¥3,000.00)
	pi = frappe.new_doc('Purchase Invoice')
	pi.company = '天津吉众科技有限公司'
	pi.supplier = frappe.db.get_value('Supplier', {}, 'name') or '默认供应商'
	pi.bill_no = inv_no
	pi.grand_total = 3000.00
	pi.rounded_total = 3000.00
	pi.docstatus = 0
	
	# 测试更新匹配
	update_tax_invoice_match_state(doc, matched_pis=[pi.as_dict()])
	print('TEST 1 (金额不符 ¥3000 vs ¥3390):', 'business_status =', doc.business_status, ', match_status =', doc.match_status)
	assert doc.match_status == '金额不符', f"Expected 金额不符, got {doc.match_status}"
	assert doc.business_status == '待录入', f"Expected 待录入, got {doc.business_status}"

	# 3. 模拟 ERP 采购发票金额完全一致 (录入了 ¥3,390.00)
	pi.grand_total = 3390.00
	pi.rounded_total = 3390.00
	update_tax_invoice_match_state(doc, matched_pis=[pi.as_dict()])
	print('TEST 2 (金额完全一致 ¥3390 vs ¥3390):', 'business_status =', doc.business_status, ', match_status =', doc.match_status)
	assert doc.match_status == '单一匹配', f"Expected 单一匹配, got {doc.match_status}"
	assert doc.business_status == '已录入', f"Expected 已录入, got {doc.business_status}"

	# 清理测试数据
	frappe.delete_doc('Tax Invoice', inv_no, force=1, ignore_permissions=True)
	frappe.db.commit()
	print('[ALL EXACT INVOICE NO AND AMOUNT MATCHING TESTS PASSED 100%!]')
	return True

def seed_mismatch_invoice():
	inv_no = '26122000000099990001'
	if frappe.db.exists('Tax Invoice', inv_no):
		frappe.delete_doc('Tax Invoice', inv_no, force=1, ignore_permissions=True)

	# 创建税局发票 (金额 ¥3,390.00)
	doc = frappe.new_doc('Tax Invoice')
	doc.invoice_no = inv_no
	doc.issue_date = '2026-08-18'
	doc.invoice_type = '电子发票(增值税专用发票)'
	doc.company = '天津吉众科技有限公司'
	doc.seller_name = '天津市某某科技有限公司'
	doc.buyer_name = '天津吉众科技有限公司'
	doc.amount_without_tax = 3000.00
	doc.tax_amount = 390.00
	doc.invoice_grand_total = 3390.00
	doc.payable_total = 3390.00
	doc.display_summary = '*自动化配件* 传感器'
	doc.business_status = '待录入'
	doc.match_status = '未匹配'
	doc.insert(ignore_permissions=True)

	# 模拟 ERP 采购发票金额填写错误 (ERP 录成了 ¥3,000.00, 与税局 ¥3,390.00 不一致)
	pi_dict = {
		'name': 'ACC-PINV-2026-00088',
		'bill_no': inv_no,
		'grand_total': 3000.00,
		'rounded_total': 3000.00,
		'docstatus': 0
	}
	update_tax_invoice_match_state(doc, matched_pis=[pi_dict])
	frappe.db.commit()
	print('Seeded mismatch invoice successfully!')
	return True

