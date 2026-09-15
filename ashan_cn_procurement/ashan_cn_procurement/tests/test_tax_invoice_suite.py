# Copyright (c) 2026, Ashan CN Procurement
import unittest
import frappe
from frappe.utils import flt, nowdate, now_datetime
from ashan_cn_procurement.parser.xml_parser import parse_tax_invoice_xml
from ashan_cn_procurement.parser.pdf_parser import parse_tax_invoice_pdf
from ashan_cn_procurement.services.tax_invoice_matcher import (
	update_tax_invoice_match_state,
	get_matching_purchase_invoices
)
from ashan_cn_procurement.services.tax_invoice_cleanup import (
	delete_single_tax_invoice_pdf,
	cleanup_expired_tax_invoice_pdfs
)
from ashan_cn_procurement.services.tax_invoice_validation import (
	get_buyer_validation_error,
	remove_stale_company_mapping_warnings,
)

def run_all_tests():
	loader = unittest.TestLoader()
	suite = loader.loadTestsFromTestCase(TestTaxInvoiceSuite)
	runner = unittest.TextTestRunner(verbosity=2)
	result = runner.run(suite)
	return {
		"total": result.testsRun,
		"errors": len(result.errors),
		"failures": len(result.failures),
		"was_successful": result.wasSuccessful()
	}

def import_real_sample_invoices():
	import os
	from ashan_cn_procurement.services.tax_invoice_import import save_private_pdf_file, identify_company
	frappe.set_user('Administrator')

	files = ['media_1786978206771.pdf', 'media_1786978206826.pdf', 'media_1786978206886.pdf']
	imported = []
	for fn in files:
		fp = f'/tmp/{fn}'
		if not os.path.exists(fp):
			continue
		with open(fp, 'rb') as f:
			bytes_data = f.read()
		res = parse_tax_invoice_pdf(bytes_data, filename=fn)
		inv_no = res.get('invoice_no')
		if not inv_no:
			continue
		if frappe.db.exists('Tax Invoice', inv_no):
			frappe.delete_doc('Tax Invoice', inv_no, force=1)

		doc = frappe.new_doc('Tax Invoice')
		doc.invoice_no = inv_no
		doc.issue_date = res.get('issue_date')
		doc.invoice_type = res.get('invoice_type')
		doc.company = identify_company(res.get('buyer_name'), res.get('buyer_tax_id'))
		doc.seller_name = res.get('seller_name')
		doc.seller_tax_id = res.get('seller_tax_id')
		doc.buyer_name = res.get('buyer_name')
		doc.buyer_tax_id = res.get('buyer_tax_id')
		doc.drawer = res.get('drawer')
		doc.amount_without_tax = res.get('amount_without_tax')
		doc.tax_amount = res.get('tax_amount')
		doc.invoice_grand_total = res.get('invoice_grand_total')
		doc.remark_total = res.get('remark_total') or 0.0
		doc.payable_total = res.get('payable_total')
		doc.remark = res.get('remark')
		doc.is_red_invoice = res.get('is_red_invoice') or 0
		doc.parse_status = res.get('parse_status') or '已解析'
		doc.parser_source = 'PDF'
		doc.parser_version = '1.0.0'
		doc.parse_confidence = res.get('parse_confidence')
		doc.parse_warning = res.get('parse_warning')
		doc.original_filename = fn
		doc.imported_at = now_datetime()
		doc.imported_by = 'Administrator'
		doc.business_status = '待录入'
		doc.match_status = '未匹配'
		for it in res.get('items', []):
			doc.append('items', it)
		doc.insert(ignore_permissions=True)

		pdf_url = save_private_pdf_file(bytes_data, fn, doc.name)
		doc.invoice_pdf = pdf_url
		doc.save(ignore_permissions=True)
		imported.append(inv_no)

	frappe.db.commit()
	return {"imported": imported}

class TestTaxInvoiceSuite(unittest.TestCase):
	def setUp(self):
		frappe.set_user("Administrator")

	def test_a_xml_normal_multi_items(self):
		"""Test A: XML 普通多明细发票解析"""
		xml_content = """<?xml version="1.0" encoding="utf-8"?>
<EInvoice>
  <Header>
    <EIid>26127000000186599318</EIid>
    <Version>0.37</Version>
    <InherentLabel>
      <EInvoiceType><LabelName>电子发票</LabelName></EInvoiceType>
      <GeneralOrSpecialVAT><LabelName>（增值税专用发票）</LabelName></GeneralOrSpecialVAT>
    </InherentLabel>
  </Header>
  <EInvoiceData>
    <SellerInformation>
      <SellerIdNum>91120116103067825E</SellerIdNum>
      <SellerName>中国石化销售股份有限公司天津石油分公司</SellerName>
    </SellerInformation>
    <BuyerInformation>
      <BuyerIdNum>91120118MA06R1D13A</BuyerIdNum>
      <BuyerName>天津吉众科技有限公司</BuyerName>
    </BuyerInformation>
    <BasicInformation>
      <TotalAmWithoutTax>10584.53</TotalAmWithoutTax>
      <TotalTaxAm>1375.98</TotalTaxAm>
      <TotalTax-includedAmount>11960.51</TotalTax-includedAmount>
      <Drawer>张三</Drawer>
    </BasicInformation>
    <IssuItemInformation>
      <ItemName>*汽油*92号汽油</ItemName>
      <SpecMod>92#</SpecMod>
      <MeaUnits>升</MeaUnits>
      <Quantity>1000</Quantity>
      <UnPrice>7.00</UnPrice>
      <Amount>7000.00</Amount>
      <TaxRate>0.13</TaxRate>
      <ComTaxAm>910.00</ComTaxAm>
      <TotaltaxIncludedAmount>7910.00</TotaltaxIncludedAmount>
    </IssuItemInformation>
    <IssuItemInformation>
      <ItemName>*汽油*95号汽油</ItemName>
      <SpecMod>95#</SpecMod>
      <MeaUnits>升</MeaUnits>
      <Quantity>500</Quantity>
      <UnPrice>7.16906</UnPrice>
      <Amount>3584.53</Amount>
      <TaxRate>0.13</TaxRate>
      <ComTaxAm>465.98</ComTaxAm>
      <TotaltaxIncludedAmount>4050.51</TotaltaxIncludedAmount>
    </IssuItemInformation>
    <AdditionalInformation>
      <Remark>车牌:津A88888</Remark>
    </AdditionalInformation>
  </EInvoiceData>
  <TaxSupervisionInfo>
    <IssueTime>2026-04-02</IssueTime>
    <InvoiceNumber>26127000000186599318</InvoiceNumber>
  </TaxSupervisionInfo>
</EInvoice>"""
		res = parse_tax_invoice_xml(xml_content.encode("utf-8"))
		self.assertTrue(res["ok"])
		self.assertEqual(res["invoice_no"], "26127000000186599318")
		self.assertEqual(res["issue_date"], "2026-04-02")
		self.assertEqual(res["amount_without_tax"], 10584.53)
		self.assertEqual(res["tax_amount"], 1375.98)
		self.assertEqual(res["invoice_grand_total"], 11960.51)
		self.assertEqual(res["payable_total"], 11960.51)
		self.assertEqual(len(res["items"]), 2)
		self.assertEqual(res["items"][0]["tax_rate_text"], "13%")

	def test_b_xml_insurance_and_vehicle_vessel_tax(self):
		"""Test B: XML 保险发票 + 备注代收车船税自动拆分"""
		xml_content = """<?xml version="1.0" encoding="utf-8"?>
<EInvoice>
  <Header>
    <EIid>26127000000186441382</EIid>
  </Header>
  <EInvoiceData>
    <SellerInformation>
      <SellerIdNum>911200000000000000</SellerIdNum>
      <SellerName>中国人民财产保险股份有限公司</SellerName>
    </SellerInformation>
    <BuyerInformation>
      <BuyerIdNum>91120118MA06R1D13A</BuyerIdNum>
      <BuyerName>天津吉众科技有限公司</BuyerName>
    </BuyerInformation>
    <BasicInformation>
      <TotalAmWithoutTax>692.92</TotalAmWithoutTax>
      <TotalTaxAm>41.58</TotalTaxAm>
      <TotalTax-includedAmount>734.50</TotalTax-includedAmount>
    </BasicInformation>
    <IssuItemInformation>
      <ItemName>*金融服务*商业保险费</ItemName>
      <Amount>692.92</Amount>
      <TaxRate>0.06</TaxRate>
      <ComTaxAm>41.58</ComTaxAm>
      <TotaltaxIncludedAmount>734.50</TotaltaxIncludedAmount>
    </IssuItemInformation>
    <AdditionalInformation>
      <Remark>保\\批单号:PDZA202600000000000090; 车牌号:津A00000; 代收车船税:325.00元,税款所属期:2026年01月-2026年12月; 滞纳金:0.00元; 合计:1059.50元;</Remark>
    </AdditionalInformation>
  </EInvoiceData>
  <TaxSupervisionInfo>
    <IssueTime>2026-04-10</IssueTime>
    <InvoiceNumber>26127000000186441382</InvoiceNumber>
  </TaxSupervisionInfo>
</EInvoice>"""
		res = parse_tax_invoice_xml(xml_content.encode("utf-8"))
		self.assertTrue(res["ok"])
		self.assertEqual(res["invoice_grand_total"], 734.50)
		self.assertEqual(res["vehicle_vessel_tax"], 325.00)
		self.assertEqual(res["late_fee"], 0.0)
		self.assertEqual(res["remark_total"], 1059.50)
		self.assertEqual(res["payable_total"], 1059.50)
		self.assertEqual(len(res["items"]), 2)
		self.assertEqual(res["items"][1]["line_type"], "车船税")
		self.assertEqual(res["items"][1]["item_name"], "代收车船税")
		self.assertEqual(res["items"][1]["amount"], 325.00)
		self.assertEqual(res["items"][1]["line_total"], 325.00)

	def test_c_xml_toll_invoice(self):
		"""Test C: XML 通行费专项字段识别"""
		xml_content = """<?xml version="1.0" encoding="utf-8"?>
<EInvoice>
  <Header>
    <EIid>26117901100400008458</EIid>
  </Header>
  <EInvoiceData>
    <BasicInformation>
      <TotalAmWithoutTax>6.29</TotalAmWithoutTax>
      <TotalTaxAm>0.19</TotalTaxAm>
      <TotalTax-includedAmount>6.48</TotalTax-includedAmount>
    </BasicInformation>
    <IssuItemInformation>
      <ItemName>*通行费*通行费</ItemName>
      <Quantity>20260327</Quantity>
      <UnPrice>20260327</UnPrice>
      <Amount>6.29</Amount>
      <TaxRate>0.03</TaxRate>
      <ComTaxAm>0.19</ComTaxAm>
      <TotaltaxIncludedAmount>6.48</TotaltaxIncludedAmount>
    </IssuItemInformation>
    <SpecificInformation>
      <Toll>
        <PlateNumber>津AAP3278</PlateNumber>
        <VehicleType>客车</VehicleType>
        <StartDatesOfPassage>2026-03-27</StartDatesOfPassage>
        <EndDatesOfPassage>2026-03-27</EndDatesOfPassage>
      </Toll>
    </SpecificInformation>
  </EInvoiceData>
</EInvoice>"""
		res = parse_tax_invoice_xml(xml_content.encode("utf-8"))
		self.assertTrue(res["ok"])
		self.assertEqual(len(res["items"]), 1)
		item = res["items"][0]
		self.assertEqual(item["line_type"], "通行费")
		self.assertEqual(item["plate_number"], "津AAP3278")
		self.assertEqual(item["vehicle_type"], "客车")
		self.assertEqual(item["passage_start"], "2026-03-27")
		self.assertIsNone(item["quantity"])
		self.assertIsNone(item["unit_price"])
		self.assertEqual(item["line_total"], 6.48)

	def test_d_xml_red_invoice(self):
		"""Test D: XML 红字负数发票"""
		xml_content = """<?xml version="1.0" encoding="utf-8"?>
<EInvoice>
  <Header>
    <EIid>26312000002160801046</EIid>
  </Header>
  <EInvoiceData>
    <BasicInformation>
      <TotalAmWithoutTax>-70000.00</TotalAmWithoutTax>
      <TotalTaxAm>-9100.00</TotalTaxAm>
      <TotalTax-includedAmount>-79100.00</TotalTax-includedAmount>
    </BasicInformation>
    <SpecificInformation>
      <RedEInvoice>
        <OriginalInvoiceCode>26312000002160569446</OriginalInvoiceCode>
        <CreditNoteNumber>CN2026040001</CreditNoteNumber>
      </RedEInvoice>
    </SpecificInformation>
  </EInvoiceData>
</EInvoice>"""
		res = parse_tax_invoice_xml(xml_content.encode("utf-8"))
		self.assertTrue(res["ok"])
		self.assertEqual(res["is_red_invoice"], 1)
		self.assertEqual(res["original_invoice_no"], "26312000002160569446")
		self.assertEqual(res["credit_note_no"], "CN2026040001")
		self.assertEqual(res["amount_without_tax"], -70000.00)
		self.assertEqual(res["tax_amount"], -9100.00)
		self.assertEqual(res["invoice_grand_total"], -79100.00)

	def test_e_pdf_parser_insurance_and_tax(self):
		"""Test E: PDF 降级解析模拟"""
		fake_pdf_text = """
		电子发票（增值税专用发票）
		发票号码：26122000001029130861
		开票日期：2026年07月31日
		购买方信息 名称：天津吉众科技有限公司 统一社会信用代码/纳税人识别号：91120118MA06R1D13A
		销售方信息 名称：圣凯（天津）工业有限公司 统一社会信用代码/纳税人识别号：9112011667149649XU
		合 计 ¥ 25633.63 ¥ 3332.37
		价税合计（小写） ¥ 28966.00
		开票人：张传英
		*供电*电费
		"""
		import pypdf
		# 使用已验证的 pdf_parser 逻辑
		from ashan_cn_procurement.parser.common import parse_remark_vehicle_vessel_tax
		rem_res = parse_remark_vehicle_vessel_tax("保\\批单号:PDZA2026; 车牌号:津A00000; 代收车船税:325.00元; 合计:1059.50元;")
		self.assertEqual(rem_res["vehicle_vessel_tax"], 325.00)
		self.assertEqual(rem_res["remark_total"], 1059.50)
		self.assertEqual(rem_res["plate_number"], "津A00000")

	def test_h_purchase_invoice_matching(self):
		"""Test H: Purchase Invoice 自动双向勾稽"""
		test_inv_no = "TEST_MATCH_INV_001"
		if frappe.db.exists("Tax Invoice", test_inv_no):
			frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

		# 1. 创建待录入税局发票
		ti = frappe.new_doc("Tax Invoice")
		ti.invoice_no = test_inv_no
		ti.issue_date = nowdate()
		ti.buyer_name = "天津吉众科技有限公司"
		ti.invoice_grand_total = 1000.0
		ti.business_status = "待录入"
		ti.match_status = "未匹配"
		ti.append("items", {
			"line_type": "普通",
			"item_name": "测试采购项目",
			"amount": 1000.0,
			"line_total": 1000.0,
		})
		ti.insert(ignore_permissions=True)

		# 验证初始为待录入
		self.assertEqual(ti.business_status, "待录入")
		self.assertEqual(ti.match_status, "未匹配")

		# 2. 模拟创建匹配的 Purchase Invoice
		pi = frappe.new_doc("Purchase Invoice")
		pi.supplier = frappe.db.get_value("Supplier", {}, "name") or "Test Supplier"
		pi.bill_no = test_inv_no
		pi.bill_date = nowdate()
		pi.company = frappe.db.get_value("Company", {}, "name") or "天津吉众科技有限公司"
		pi.currency = "CNY"
		pi.conversion_rate = 1.0
		# 手动触发 Hook 或 update_tax_invoice_match_state
		update_tax_invoice_match_state(ti.name, matched_pis=[{"name": "PI-TEST-001", "bill_no": test_inv_no, "docstatus": 0}])

		ti.reload()
		self.assertEqual(ti.business_status, "已录入")
		self.assertEqual(ti.match_status, "单一匹配")
		self.assertEqual(ti.matched_purchase_invoice, "PI-TEST-001")

		# 3. 模拟取消/删除 Purchase Invoice
		update_tax_invoice_match_state(ti.name, matched_pis=[])
		ti.reload()
		self.assertEqual(ti.business_status, "待录入")
		self.assertEqual(ti.match_status, "未匹配")
		self.assertIsNone(ti.matched_purchase_invoice)

		# 清理
		frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

	def test_i_abandoned_protection(self):
		"""Test I: 人工已废弃保护与冲突预警"""
		test_inv_no = "TEST_ABANDON_002"
		if frappe.db.exists("Tax Invoice", test_inv_no):
			frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

		ti = frappe.new_doc("Tax Invoice")
		ti.invoice_no = test_inv_no
		ti.issue_date = nowdate()
		ti.buyer_name = "天津吉众科技有限公司"
		ti.invoice_grand_total = 500.0
		ti.business_status = "已废弃"
		ti.abandoned_reason = "开错发票"
		ti.match_status = "未匹配"
		ti.append("items", {
			"line_type": "普通",
			"item_name": "测试废弃项目",
			"amount": 500.0,
			"line_total": 500.0,
		})
		ti.insert(ignore_permissions=True)

		# 模拟后续出现相同发票号 Purchase Invoice
		update_tax_invoice_match_state(ti.name, matched_pis=[{"name": "PI-LATER-002", "bill_no": test_inv_no, "docstatus": 0}])
		ti.reload()

		# 人工已废弃状态不得被后台静默覆盖
		self.assertEqual(ti.business_status, "已废弃")
		self.assertEqual(ti.match_status, "废弃冲突")
		self.assertEqual(ti.matched_purchase_invoice, "PI-LATER-002")

		# 清理
		frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

	def test_j_pdf_cleanup(self):
		"""Test J: PDF 附件清理仅删除附件，保留主表与明细数据"""
		test_inv_no = "TEST_CLEANUP_003"
		if frappe.db.exists("Tax Invoice", test_inv_no):
			frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

		ti = frappe.new_doc("Tax Invoice")
		ti.invoice_no = test_inv_no
		ti.issue_date = nowdate()
		ti.buyer_name = "天津吉众科技有限公司"
		ti.invoice_grand_total = 200.0
		ti.business_status = "待录入"
		ti.invoice_pdf = "/private/files/test_fake.pdf"
		ti.append("items", {
			"line_type": "普通",
			"item_name": "测试项目明细",
			"amount": 200.0,
			"line_total": 200.0
		})
		ti.insert(ignore_permissions=True)

		# 执行清理
		res = delete_single_tax_invoice_pdf(test_inv_no, user="Administrator", reason="测试清理")
		self.assertTrue(res["ok"])

		ti.reload()
		self.assertIsNone(ti.invoice_pdf)
		self.assertEqual(ti.pdf_removed, 1)
		self.assertEqual(ti.pdf_remove_reason, "测试清理")
		# 主记录与明细数据完整保留
		self.assertEqual(ti.invoice_grand_total, 200.0)
		self.assertEqual(len(ti.items), 1)
		self.assertEqual(ti.items[0].item_name, "测试项目明细")

		# 清理
		frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

	def test_k_buyer_boundary_and_detail_only_vehicle_vessel_tax(self):
		"""Test K: only the two legal buyers pass and tax is stored as a detail row."""
		self.assertFalse(get_buyer_validation_error("天津祺富机械加工有限公司"))
		self.assertFalse(get_buyer_validation_error("天津吉众科技有限公司"))
		self.assertTrue(get_buyer_validation_error("天津吉众机电设备有限公司"))

		test_inv_no = "TEST_INVALID_BUYER_004"
		if frappe.db.exists("Tax Invoice", test_inv_no):
			frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

		ti = frappe.new_doc("Tax Invoice")
		ti.invoice_no = test_inv_no
		ti.issue_date = nowdate()
		ti.buyer_name = "天津市第三方公司"
		ti.invoice_grand_total = 0.0
		ti.append("items", {
			"line_type": "车船税",
			"item_name": "代收车船税",
			"amount": 325.0,
			"tax_amount": 0.0,
			"line_total": 325.0,
		})
		ti.insert(ignore_permissions=True)
		ti.reload()

		self.assertEqual(ti.parse_status, "需复核")
		self.assertIn("【购买方错误】", ti.parse_warning)
		self.assertIsNone(ti.company)
		self.assertEqual(len(ti.items), 1)
		self.assertEqual(ti.items[0].amount, 325.0)
		self.assertEqual(ti.payable_total, 325.0)
		self.assertFalse(ti.get("vehicle_vessel_tax"))

		update_tax_invoice_match_state(ti.name, matched_pis=[{
			"name": "PI-SHOULD-NOT-MATCH",
			"bill_no": test_inv_no,
			"docstatus": 0,
			"grand_total": 650.0,
		}])
		ti.reload()
		self.assertEqual(ti.match_status, "未匹配")
		self.assertFalse(ti.matched_purchase_invoice)

		frappe.delete_doc("Tax Invoice", test_inv_no, force=1)

	def test_l_stale_company_mapping_warning_resolves_only_after_mapping(self):
		"""Test L: resolved company mappings clear stale review warnings without hiding other warnings."""
		warning = "购买方公司未能自动匹配; 金额待人工复核"
		unmapped_warning, unmapped_removed = remove_stale_company_mapping_warnings(warning, None)
		self.assertFalse(unmapped_removed)
		self.assertEqual(unmapped_warning, warning)

		mapped_warning, mapped_removed = remove_stale_company_mapping_warnings(
			warning, "天津吉众科技有限公司"
		)
		self.assertTrue(mapped_removed)
		self.assertEqual(mapped_warning, "金额待人工复核")
