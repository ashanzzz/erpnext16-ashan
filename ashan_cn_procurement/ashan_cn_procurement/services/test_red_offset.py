# Copyright (c) 2026, Ashan CN Procurement
import frappe
from ashan_cn_procurement.services.tax_invoice_matcher import auto_reconcile_all_red_invoices

def seed_and_test_red_offset():
	# 清理历史测试数据
	for no in ['26122000000088880001', '26122000000088880002']:
		if frappe.db.exists('Tax Invoice', no):
			frappe.delete_doc('Tax Invoice', no, force=1, ignore_permissions=True)

	# 1. 蓝字发票 (金额 5650.00, 待录入)
	blue = frappe.new_doc('Tax Invoice')
	blue.invoice_no = '26122000000088880001'
	blue.issue_date = '2026-08-10'
	blue.invoice_type = '电子发票(增值税专用发票)'
	blue.company = '天津吉众科技有限公司'
	blue.seller_name = '天津某某自动化控制设备有限公司'
	blue.seller_tax_id = '91120000MA0123456X'
	blue.buyer_name = '天津吉众科技有限公司'
	blue.buyer_tax_id = '911200000000000000'
	blue.amount_without_tax = 5000.00
	blue.tax_amount = 650.00
	blue.invoice_grand_total = 5650.00
	blue.payable_total = 5650.00
	blue.display_summary = '*自动化设备* 控制器'
	blue.business_status = '待录入'
	blue.match_status = '未匹配'
	blue.is_red_invoice = 0
	blue.insert(ignore_permissions=True)

	# 2. 红字发票 (金额 -5650.00, 原发票指向蓝字发票)
	red = frappe.new_doc('Tax Invoice')
	red.invoice_no = '26122000000088880002'
	red.issue_date = '2026-08-12'
	red.invoice_type = '电子发票(增值税专用发票)'
	red.company = '天津吉众科技有限公司'
	red.seller_name = '天津某某自动化控制设备有限公司'
	red.seller_tax_id = '91120000MA0123456X'
	red.buyer_name = '天津吉众科技有限公司'
	red.buyer_tax_id = '911200000000000000'
	red.amount_without_tax = -5000.00
	red.tax_amount = -650.00
	red.invoice_grand_total = -5650.00
	red.payable_total = -5650.00
	red.display_summary = '*自动化设备* 控制器(红字冲销)'
	red.business_status = '待录入'
	red.match_status = '未匹配'
	red.is_red_invoice = 1
	red.original_invoice_no = '26122000000088880001'
	red.credit_note_no = 'HZ202608120001'
	red.insert(ignore_permissions=True)

	frappe.db.commit()

	# 执行自动红冲对冲
	res = auto_reconcile_all_red_invoices()
	frappe.db.commit()

	b_doc = frappe.get_doc('Tax Invoice', '26122000000088880001')
	r_doc = frappe.get_doc('Tax Invoice', '26122000000088880002')
	print('RESULT_INFO:', res, 'Blue:', b_doc.business_status, b_doc.offset_invoice, 'Red:', r_doc.business_status, r_doc.offset_invoice)
	return res

def init_settings_mappings():
	settings = frappe.get_single('Tax Invoice Settings')
	settings.company_mappings = []
	
	# 吉众科技及其抬头
	settings.append('company_mappings', {
		'company': '天津吉众科技有限公司',
		'buyer_name': '天津吉众科技有限公司',
		'buyer_tax_id': ''
	})
	settings.append('company_mappings', {
		'company': '天津吉众科技有限公司',
		'buyer_name': '天津吉众机电设备安装工程有限公司',
		'buyer_tax_id': ''
	})
	
	# 祺富机械及其抬头
	settings.append('company_mappings', {
		'company': '天津祺富机械加工有限公司',
		'buyer_name': '天津祺富机械加工有限公司',
		'buyer_tax_id': ''
	})
	settings.append('company_mappings', {
		'company': '天津祺富机械加工有限公司',
		'buyer_name': '天津祺富机械有限公司',
		'buyer_tax_id': ''
	})
	settings.save(ignore_permissions=True)
	frappe.db.commit()
	print('Settings company mappings initialized successfully!')

def fix_all_invoice_companies():
	init_settings_mappings()
	from ashan_cn_procurement.services.tax_invoice_import import identify_company
	
	invoices = frappe.get_all('Tax Invoice', fields=['name', 'invoice_no', 'buyer_name', 'buyer_tax_id', 'company'])
	fixed_count = 0
	
	for inv in invoices:
		correct_comp = identify_company(inv.buyer_name, inv.buyer_tax_id)
		if correct_comp and correct_comp != inv.company:
			frappe.db.set_value('Tax Invoice', inv.name, 'company', correct_comp, update_modified=False)
			fixed_count += 1
			print(f"Fixed {inv.invoice_no}: buyer='{inv.buyer_name}' -> company was '{inv.company}' now '{correct_comp}'")
	
	frappe.db.commit()
	print(f"Total invoices checked: {len(invoices)}, fixed: {fixed_count}")
	
	# 重新执行采购发票匹配与红冲对冲
	from ashan_cn_procurement.services.tax_invoice_matcher import reconcile_tax_invoice_matches
	reconcile_tax_invoice_matches()
	return {"total": len(invoices), "fixed": fixed_count}


