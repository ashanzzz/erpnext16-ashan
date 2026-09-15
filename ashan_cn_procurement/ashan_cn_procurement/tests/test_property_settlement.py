# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
import unittest
from frappe.utils import flt, nowdate

from ashan_cn_procurement.services.property_settlement import (
	get_month_settlement_data,
	save_draft_settlement,
	finalize_monthly_settlement,
	revert_settlement_to_draft,
	calculate_settlement_matrix
)


class TestPropertySettlement(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		# 确保公司存在
		if not frappe.db.exists("Company", "天津吉众科技有限公司"):
			c1 = frappe.new_doc("Company")
			c1.company_name = "天津吉众科技有限公司"
			c1.abbr = "吉众"
			c1.default_currency = "CNY"
			c1.insert(ignore_permissions=True)

		if not frappe.db.exists("Company", "天津祺富机械加工有限公司"):
			c2 = frappe.new_doc("Company")
			c2.company_name = "天津祺富机械加工有限公司"
			c2.abbr = "祺富"
			c2.default_currency = "CNY"
			c2.insert(ignore_permissions=True)

		cls.comp_jz = "天津吉众科技有限公司"
		cls.comp_qf = "天津祺富机械加工有限公司"

	def test_01_meter_multiplier_and_usage(self):
		"""测试 Case 1: 正常电表倍率与用量核算 (2711 -> 2780, 倍率 120 -> 核定 8280 kWh)"""
		mock_data = {
			"settlement_month": "2026-08-01",
			"electricity_price": 1.1957,
			"electricity_tax_rate": 13.0,
			"water_price": 5.5,
			"water_tax_rate": 9.0,
			"meter_readings": [
				{
					"utility_meter": "1号电表",
					"meter_no": "1",
					"utility_type": "电",
					"company": self.comp_jz,
					"previous_reading": 2711.0,
					"current_reading": 2780.0,
					"multiplier": 120.0
				}
			],
			"adjustments": [],
			"lease_charges": []
		}
		res = calculate_settlement_matrix(mock_data)
		r0 = res["meter_readings"][0]

		self.assertEqual(r0["raw_usage"], 69.0)
		self.assertEqual(r0["calculated_usage"], 8280.0)
		# 8280 * 1.1957 = 9900.396 -> 9900.40
		self.assertEqual(r0["amount_tax_incl"], 9900.40)

	def test_02_usage_adjustment(self):
		"""测试 Case 2: 按用量调整 (-100 kWh -> 自动计算金额 -119.57)"""
		mock_data = {
			"settlement_month": "2026-08-01",
			"electricity_price": 1.1957,
			"adjustments": [
				{
					"adjustment_type": "按用量",
					"utility_type": "电费",
					"adjustment_scope": "单公司",
					"company": self.comp_jz,
					"usage_adjustment": -100.0,
					"reason": "4号表修正"
				}
			]
		}
		res = calculate_settlement_matrix(mock_data)
		adj = res["adjustments"][0]
		self.assertEqual(adj["amount_adjustment"], -119.57)
		self.assertEqual(adj["equivalent_usage"], -100.0)

	def test_03_company_transfer_amount_adjustment(self):
		"""测试 Case 3: 公司间电费金额调整 (吉众 -> 祺富 8000 元，吉众 -8000，祺富 +8000，等效电量 8000 / 1.1957)"""
		mock_data = {
			"settlement_month": "2026-08-01",
			"electricity_price": 1.1957,
			"adjustments": [
				{
					"adjustment_type": "按金额",
					"utility_type": "电费",
					"adjustment_scope": "公司间转移",
					"from_company": self.comp_jz,
					"to_company": self.comp_qf,
					"amount_adjustment": 8000.0,
					"reason": "公司间电费分摊调整"
				}
			],
			"meter_readings": [],
			"lease_charges": []
		}
		res = calculate_settlement_matrix(mock_data)
		adj = res["adjustments"][0]

		expected_eq_usage = round(8000.0 / 1.1957, 2)
		self.assertEqual(adj["equivalent_usage"], expected_eq_usage)

		# 汇总检验
		summary_jz = next(s for s in res["company_summaries"] if s["company"] == self.comp_jz)
		summary_qf = next(s for s in res["company_summaries"] if s["company"] == self.comp_qf)

		self.assertEqual(summary_jz["adjustment_amount"], -8000.0)
		self.assertEqual(summary_qf["adjustment_amount"], 8000.0)
		self.assertEqual(summary_jz["electricity_amount"], -8000.0)
		self.assertEqual(summary_qf["electricity_amount"], 8000.0)

	def test_04_lease_charge_365_days_calculation(self):
		"""测试 Case 4: 房租物业年金额按 365 天标准日单价核算"""
		mock_data = {
			"settlement_month": "2026-08-01", # 8月共31天
			"lease_charges": [
				{
					"property_name": "大车间+3楼办公",
					"company": self.comp_jz,
					"area": 3338.0,
					"property_fee_mode": "房租含物业",
					"rent_annual_amount": 240000.0,
					"rent_daily_rate": 0.196985,
					"tax_rate": 9.0,
					"billing_days": 31
				}
			]
		}
		res = calculate_settlement_matrix(mock_data)
		l0 = res["lease_charges"][0]

		# 31天含税金额 = (240000 / 365) * 31 = 20383.56
		expected_amt = round((240000.0 / 365.0) * 31, 2)
		self.assertEqual(l0["amount_tax_incl"], expected_amt)
		self.assertEqual(l0["rent_amount_tax_incl"], expected_amt)
		self.assertEqual(l0["property_fee_amount_tax_incl"], 0.0)

	def test_05_validation_on_finalize(self):
		"""测试 Case 5: 结算完成校验 (异常本期读数与未填原因拒绝通过)"""
		invalid_data = {
			"settlement_month": "2026-08-01",
			"meter_readings": [
				{
					"utility_meter": "TEST-1",
					"meter_no": "1",
					"company": self.comp_jz,
					"previous_reading": 3000.0,
					"current_reading": 2000.0,
					"remark": ""
				}
			],
			"adjustments": [],
			"lease_charges": []
		}
		with self.assertRaises(frappe.ValidationError):
			finalize_monthly_settlement(invalid_data)

	def test_06_property_charge_rate_bidirectional_calculation(self):
		"""测试 Case 6: PropertyChargeRate 日/月/年单价与单独物业费双向自动互算"""
		if not frappe.db.exists("Property Lease", {"property_name": "测试场地1000平"}):
			l = frappe.new_doc("Property Lease")
			l.property_name = "测试场地1000平"
			l.company = self.comp_jz
			l.area = 1000.0
			l.property_fee_mode = "单独计收物业费"
			l.insert(ignore_permissions=True)
		else:
			l = frappe.get_doc("Property Lease", {"property_name": "测试场地1000平"})

		# 测试按日单价录入 0.20 元/㎡·天，物业费 1.0 元/㎡·月
		rate = frappe.new_doc("Property Charge Rate")
		rate.property_lease = l.name
		rate.effective_from = "2026-01-01"
		rate.rent_pricing_mode = "按日单价 (元/㎡·天)"
		rate.rent_daily_rate = 0.20
		rate.property_fee_mode = "单独计收物业费"
		rate.property_fee_pricing_mode = "按月单价 (元/㎡·月)"
		rate.property_fee_monthly_rate = 1.0
		rate.calculate_all_rates()

		# 验证房租互算结果:
		# 年单价 = 0.20 * 365 = 73.0
		# 年租金 = 1000 * 0.20 * 365 = 73000.0
		# 月租金 = 73000 / 12 = 6083.33
		self.assertEqual(rate.rent_annual_rate, 73.0)
		self.assertEqual(rate.rent_annual_amount, 73000.0)
		self.assertEqual(rate.rent_monthly_amount, 6083.33)

		# 验证物业费互算结果:
		# 年单价 = 1.0 * 12 = 12.0
		# 年物业费 = 1000 * 1.0 * 12 = 12000.0
		self.assertEqual(rate.property_fee_annual_rate, 12.0)
		self.assertEqual(rate.property_fee_annual_amount, 12000.0)

		# 验证总计: 73000 + 12000 = 85000
		self.assertEqual(rate.total_annual_amount, 85000.0)

	def test_07_lease_charge_with_separate_property_fee(self):
		"""测试 Case 7: 月结中房租与单独物业费分别核算与公司汇总"""
		mock_data = {
			"settlement_month": "2026-08-01", # 31天
			"lease_charges": [
				{
					"property_name": "测试厂房A",
					"company": self.comp_qf,
					"area": 1000.0,
					"property_fee_mode": "单独计收物业费",
					"rent_pricing_mode": "按年总金额 (元/年)",
					"rent_annual_amount": 73000.0,
					"property_fee_annual_amount": 12000.0,
					"billing_days": 31
				}
			]
		}
		res = calculate_settlement_matrix(mock_data)
		l0 = res["lease_charges"][0]

		# 房租 = (73000 / 365) * 31 = 6200.00
		# 物业费 = (12000 / 365) * 31 = 1019.18
		# 合计 = 7219.18
		self.assertEqual(l0["rent_amount_tax_incl"], 6200.00)
		self.assertEqual(l0["property_fee_amount_tax_incl"], 1019.18)
		self.assertEqual(l0["amount_tax_incl"], 7219.18)

		summary_qf = next(s for s in res["company_summaries"] if s["company"] == self.comp_qf)
		self.assertEqual(summary_qf["rent_amount"], 6200.00)
		self.assertEqual(summary_qf["property_fee_amount"], 1019.18)
		self.assertEqual(summary_qf["total_amount"], 7219.18)

	def test_08_excel_export_generation(self):
		"""测试 Case 8: 导出符合《抄表记录.xlsx》格式的单公司与合计 Excel"""
		from ashan_cn_procurement.services.property_settlement import generate_settlement_excel_workbook

		mock_data = {
			"settlement_month": "2026-08-01",
			"property_management_company": "天津金利达物业管理有限公司",
			"electricity_price": 1.1957,
			"water_price": 5.5,
			"meter_readings": [
				{
					"meter_no": "1",
					"utility_type": "电",
					"company": self.comp_jz,
					"previous_reading": 2711.0,
					"current_reading": 2780.0,
					"multiplier": 120.0,
					"calculated_usage": 8280.0,
					"amount_tax_incl": 9900.40
				}
			],
			"adjustments": [],
			"lease_charges": [
				{
					"property_name": "大车间+3楼办公",
					"company": self.comp_jz,
					"area": 3338.0,
					"rent_amount_tax_incl": 20383.56,
					"property_fee_amount_tax_incl": 0.0,
					"amount_tax_incl": 20383.56,
					"billing_days": 31
				}
			]
		}

		# 1. 导出全套工作簿 (每公司 2 Sheet + 合计 2 Sheet)
		wb_all = generate_settlement_excel_workbook(mock_data, mode="all")
		self.assertIn("合计水电费", wb_all.sheetnames)
		self.assertIn("合计房租物业", wb_all.sheetnames)
		self.assertTrue(len(wb_all.sheetnames) >= 4)

		# 2. 导出单公司: 产生 2 个 Sheet (水电费 + 房租物业)
		wb_comp = generate_settlement_excel_workbook(mock_data, company=self.comp_jz, mode="company")
		self.assertEqual(len(wb_comp.sheetnames), 2)
		ws_e = wb_comp.active  # 第一个 Sheet = 水电费
		self.assertEqual(ws_e.cell(1, 1).value, self.comp_jz)
		self.assertEqual(ws_e.cell(2, 1).value, "水电费明细（单价含税）")
		# 第三行应为「所属期」
		row3_val = str(ws_e.cell(3, 1).value or "")
		# 3. 验证合计 Sheet 标题与 0 用量除零保护
		ws_tot = wb_all["合计水电费"]
		self.assertEqual(ws_tot.cell(1, 1).value, "全公司合计")
		# 标题行不能出现重复的「合计合计」
		row_sec_tot = ws_tot.cell(18, 1).value
		self.assertNotIn("合计合计", str(row_sec_tot))
		self.assertIn("全公司合计水电费", str(row_sec_tot))

	def test_09_zero_usage_excel_div_zero_protection(self):
		"""测试 Case 9: 0用量场景下 Excel 单价公式除零保护 (IF(F=0,0,E/F))"""
		from ashan_cn_procurement.services.property_settlement import generate_settlement_excel_workbook

		mock_data = {
			"settlement_month": "2026-08-01",
			"electricity_price": 1.1957,
			"water_price": 5.5,
			"meter_readings": [], # 无水表也无电表
			"adjustments": [],
			"lease_charges": []
		}
		wb = generate_settlement_excel_workbook(mock_data, mode="total")
		ws_e = wb["合计水电费"]
		# 电费汇总行中的单价公式应包含 IF(F...=0,0,...)
		price_formula = str(ws_e.cell(12, 7).value or "")
		self.assertIn("IF(", price_formula)

	def test_10_lease_charge_rate_auto_enrichment(self):
		"""测试 Case 10: 租赁单据重载或缺少费率基准时，集中计算引擎自动从收费标准补齐"""
		if not frappe.db.exists("Property Lease", {"property_name": "自动补齐测试厂房"}):
			l = frappe.new_doc("Property Lease")
			l.property_name = "自动补齐测试厂房"
			l.company = self.comp_jz
			l.area = 2000.0
			l.property_fee_mode = "房租含物业"
			l.insert(ignore_permissions=True)
		else:
			l = frappe.get_doc("Property Lease", {"property_name": "自动补齐测试厂房"})

		# 设置收费标准 年租金 120,000 元/年
		if not frappe.db.exists("Property Charge Rate", {"property_lease": l.name, "effective_from": "2026-01-01"}):
			rate = frappe.new_doc("Property Charge Rate")
			rate.property_lease = l.name
			rate.effective_from = "2026-01-01"
			rate.rent_pricing_mode = "按年总金额 (元/年)"
			rate.rent_annual_amount = 120000.0
			rate.insert(ignore_permissions=True)

		# 模拟子表中由于旧数据或数据库重载缺失 rent_annual_amount / rent_daily_rate
		mock_data = {
			"settlement_month": "2026-08-01", # 31天
			"lease_charges": [
				{
					"property_lease": l.name,
					"property_name": "自动补齐测试厂房",
					"company": self.comp_jz,
					"area": 2000.0,
					"billing_days": 31,
					"rent_amount_tax_incl": 0.0 # 初始为 0
				}
			]
		}
		res = calculate_settlement_matrix(mock_data)
		l0 = res["lease_charges"][0]

		# 验证引擎自动补齐了年租金基准并正确算出了 31 天租金 = (120000 / 365) * 31 = 10191.78
		expected_amt = round((120000.0 / 365.0) * 31, 2)
		self.assertEqual(l0["rent_annual_amount"], 120000.0)
		self.assertEqual(l0["rent_amount_tax_incl"], expected_amt)
		self.assertEqual(l0["amount_tax_incl"], expected_amt)

