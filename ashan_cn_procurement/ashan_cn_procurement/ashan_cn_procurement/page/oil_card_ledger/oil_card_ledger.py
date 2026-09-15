# ASHAN-COMPLETE: native permissions for user-triggered oil-card masters and ledger documents
# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import calendar
import frappe
from frappe.utils import flt, getdate, nowdate, now_datetime
from ashan_cn_procurement.services.permission_query_service import (
    assert_doctype_permission,
    assert_standard_lifecycle_permissions,
)
from ashan_cn_procurement.services.authorization_service import (
	assert_company_access,
	assert_oil_ledger_access,
	can_module_access,
	get_allowed_companies,
)


def is_oil_card_manager():
	"""Return the canonical oil-card manager capability."""
	return can_module_access("oil_card", "lock")


def _recalculate_oil_card_balance(oil_card):
	"""Recalculate one card from submitted transactions only."""
	card = frappe.get_doc("Oil Card", oil_card)
	recharges_sum = frappe.db.sql(
		"SELECT COALESCE(SUM(COALESCE(effective_amount, recharge_amount)), 0) AS total "
		"FROM `tabOil Card Recharge` WHERE oil_card = %s AND docstatus = 1",
		oil_card,
		as_dict=True,
	)[0].total
	refuels_sum = frappe.db.sql(
		"SELECT COALESCE(SUM(amount), 0) AS total "
		"FROM `tabOil Card Refuel Log` WHERE oil_card = %s AND docstatus = 1",
		oil_card,
		as_dict=True,
	)[0].total
	balance = flt(card.opening_balance) + flt(recharges_sum) - flt(refuels_sum)
	frappe.db.set_value("Oil Card", oil_card, "current_balance", balance, update_modified=True)
	return balance


@frappe.whitelist()
def get_all_oil_cards():
	"""
	获取所有有效油卡列表及其当前余额，包含供应商简称解析（优先显示供应商简称，无简称才显示全称）
	"""
	assert_doctype_permission("Oil Card", "read")
	assert_oil_ledger_access("read")
	cards = frappe.get_list(
		"Oil Card",
		fields=[
			"name",
			"card_code",
			"card_name",
			"card_no_masked",
			"card_type",
			"supplier",
			"company",
			"status",
			"opening_balance",
			"current_balance",
			"uninvoiced_amount",
		],
		order_by="idx asc, modified desc",
	)
	allowed_companies = get_allowed_companies()
	if allowed_companies is not None:
		cards = [card for card in cards if str(card.get("company") or "") in allowed_companies]

	# 预加载所有供应商的简称与全称映射
	suppliers = frappe.get_all("Supplier", fields=["name", "supplier_name", "alias"])
	supplier_map = {}
	for s in suppliers:
		alias_text = (s.alias or "").strip()
		full_text = (s.supplier_name or s.name or "").strip()
		supplier_map[s.name] = {
			"abbr": alias_text if alias_text else full_text,
			"full": full_text,
		}

	# 预加载所有公司的简称与全称映射（作为备用）
	companies = frappe.get_all("Company", fields=["name", "company_name", "abbr"])
	company_map = {}
	for c in companies:
		abbr_text = (c.abbr or "").strip()
		full_text = (c.company_name or c.name or "").strip()
		company_map[c.name] = {
			"abbr": abbr_text if abbr_text else full_text,
			"full": full_text,
		}

	for card in cards:
		sup_name = card.get("supplier")
		comp_name = card.get("company")

		if sup_name and sup_name in supplier_map:
			card["supplier_abbr"] = supplier_map[sup_name]["abbr"]
			card["supplier_full"] = supplier_map[sup_name]["full"]
		elif comp_name and comp_name in company_map:
			card["supplier_abbr"] = company_map[comp_name]["abbr"]
			card["supplier_full"] = company_map[comp_name]["full"]
		else:
			card["supplier_abbr"] = sup_name or comp_name or ""
			card["supplier_full"] = sup_name or comp_name or ""

	return cards


def get_fuel_label(fuel_type):
	"""燃油动力类型纯中文转换"""
	if not fuel_type:
		return "汽油"
	f = str(fuel_type).strip()
	if f in ["Diesel", "柴油"]:
		return "柴油"
	if f in ["Petrol", "汽油"]:
		return "汽油"
	if "混动" in f or "Hybrid" in f:
		return "插电混动"
	if "纯电" in f or "Electric" in f:
		return "纯电动"
	if "气" in f or "Gas" in f:
		return "天然气"
	return f


@frappe.whitelist()
def get_quick_entry_meta():
	"""
	获取行内快速补录与新建油卡所需的车辆档案、付款方式、公司及供应商元数据（自动过滤封存车辆）
	"""
	assert_oil_ledger_access("read")
	# 仅获取“正常在用”车辆，封存车辆自动过滤隐藏
	filters = {}
	allowed_companies = get_allowed_companies()
	if allowed_companies is not None:
		filters["company"] = ["in", sorted(allowed_companies)]
	if frappe.db.has_column("Vehicle", "custom_vehicle_status"):
		filters["custom_vehicle_status"] = ["!=", "封存停用"]

	fields = ["name", "license_plate", "model", "make", "company", "fuel_type", "last_odometer"]
	if frappe.db.has_column("Vehicle", "custom_vehicle_status"):
		fields.append("custom_vehicle_status")
	if frappe.db.has_column("Vehicle", "custom_primary_driver"):
		fields.append("custom_primary_driver")
	if frappe.db.has_column("Vehicle", "custom_vehicle_remark"):
		fields.append("custom_vehicle_remark")
	if frappe.db.has_column("Vehicle", "custom_default_fuel_grade"):
		fields.append("custom_default_fuel_grade")

	vehicles = frappe.get_all(
		"Vehicle",
		filters=filters,
		fields=fields,
		order_by="license_plate asc",
	)
	for v in vehicles:
		v["fuel_type_label"] = get_fuel_label(v.get("fuel_type"))

	modes = frappe.get_all("Mode of Payment", fields=["name"], filters={"enabled": 1})
	mode_names = [m.name for m in modes] if modes else ["Cheque", "Cash", "银行转账", "微信支付", "支付宝"]

	company_filters = {"name": ["in", sorted(allowed_companies)]} if allowed_companies is not None else {}
	companies = frappe.get_all("Company", fields=["name", "company_name"], filters=company_filters)
	suppliers = frappe.get_all("Supplier", fields=["name", "supplier_name"], order_by="name asc", limit=100)
	default_company = frappe.defaults.get_user_default("Company") or (companies[0].name if companies else "")
	default_supplier = suppliers[0].name if suppliers else ""

	return {
		"vehicles": vehicles,
		"modes_of_payment": mode_names,
		"companies": companies,
		"suppliers": suppliers,
		"default_company": default_company,
		"default_supplier": default_supplier,
		"is_manager": is_oil_card_manager(),
		"is_system_admin": is_system_admin(),
	}


@frappe.whitelist(methods=["POST"])
def quick_create_vehicle(license_plate, vehicle_category="货车", fuel_type="柴油", default_fuel_grade=None, vehicle_remark=None, last_odometer=0, make=None, company=None, primary_driver=None):
	"""
	单页极速新建车辆档案（零跳转，纯中文，默认正常在用，完全同步至车辆主数据）
	"""
	assert_doctype_permission("Vehicle", "create")
	assert_oil_ledger_access("write")
	if not license_plate:
		frappe.throw("车牌号码为必填项！")

	plate = license_plate.strip().upper()
	if frappe.db.exists("Vehicle", plate):
		frappe.throw(f"车牌号为【{plate}】的车辆已存在！")

	if not company or not frappe.db.exists("Company", company):
		company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
		if not company or not frappe.db.exists("Company", company):
			companies = frappe.get_all("Company", fields=["name"], limit=1)
			company = companies[0].name if companies else None
	assert_company_access(company)

	# 规范化 ERPNext 标准 fuel_type 字段
	fuel_norm = "Diesel"
	fuel_label = get_fuel_label(fuel_type)
	calc_default_grade = "0# 柴油"
	if fuel_label == "汽油" or fuel_label == "插电混动":
		fuel_norm = "Petrol"
		calc_default_grade = "92# 汽油"
	elif fuel_label == "纯电动":
		fuel_norm = "Electric"
		calc_default_grade = "纯电动"
	elif fuel_label == "天然气":
		fuel_norm = "Natural Gas"
		calc_default_grade = "天然气"
	else:
		fuel_norm = "Diesel"
		calc_default_grade = "0# 柴油"

	actual_grade = default_fuel_grade or calc_default_grade

	# 规范化车型
	model_val = vehicle_category.split("/")[0].strip() if "/" in vehicle_category else vehicle_category.strip()

	doc = frappe.new_doc("Vehicle")
	doc.license_plate = plate
	doc.make = make or ""
	doc.model = model_val or "货车"
	doc.company = company
	doc.last_odometer = int(flt(last_odometer))
	doc.fuel_type = fuel_norm
	if frappe.db.has_column("Vehicle", "custom_vehicle_status"):
		doc.custom_vehicle_status = "正常在用"
	if frappe.db.has_column("Vehicle", "custom_default_fuel_grade"):
		doc.custom_default_fuel_grade = actual_grade
	if primary_driver and frappe.db.has_column("Vehicle", "custom_primary_driver"):
		doc.custom_primary_driver = primary_driver.strip()
	if vehicle_remark and frappe.db.has_column("Vehicle", "custom_vehicle_remark"):
		doc.custom_vehicle_remark = vehicle_remark.strip()
	# Service-level fast-create is already role- and company-scoped above.
	# AI-GOVERNANCE-EXCEPTION: ignore_permissions avoid granting broad Vehicle create permission to Oil Card Operator.
	doc.insert()

	return {
		"status": "ok",
		"message": f"车辆【{doc.license_plate}】已成功创建并归入车辆主档案！",
		"vehicle": {
			"name": doc.name,
			"license_plate": doc.license_plate,
			"model": doc.model,
			"fuel_type": doc.fuel_type,
			"fuel_type_label": fuel_label,
			"custom_default_fuel_grade": actual_grade,
			"custom_primary_driver": doc.get("custom_primary_driver") or "",
			"custom_vehicle_remark": doc.get("custom_vehicle_remark") or "",
			"custom_vehicle_status": "正常在用",
			"last_odometer": doc.last_odometer,
		},
	}





def is_system_admin():
	"""
	严格系统管理员鉴权：仅 System Manager / Administrator 可创建与删除油卡主数据
	"""
	if frappe.session.user == "Administrator":
		return True
	user_roles = set(frappe.get_roles())
	return "System Manager" in user_roles


@frappe.whitelist(methods=["POST"])
def quick_create_oil_card(card_name, card_no, card_code=None, card_type="主卡", company=None, supplier=None, opening_balance=0):
	"""
	单页模态对话框极速新建油卡档案（管理员专用）
	"""
	assert_doctype_permission("Oil Card", "create")
	if not is_oil_card_manager():
		frappe.throw("权限不足：只有管理员可以新建油卡档案！")

	if not card_name or not card_no:
		frappe.throw("油卡名称与卡号为必填项！")

	if not company or not frappe.db.exists("Company", company):
		company = frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
		if not company or not frappe.db.exists("Company", company):
			companies = frappe.get_all("Company", fields=["name"], limit=1)
			company = companies[0].name if companies else None
	assert_company_access(company)

	if not supplier or not frappe.db.exists("Supplier", supplier):
		suppliers = frappe.get_all("Supplier", fields=["name"], limit=1)
		supplier = suppliers[0].name if suppliers else None

	# 若未指定系统卡号/编码，则按序号或规则自动生成
	if not card_code:
		count = frappe.db.count("Oil Card") + 1
		card_code = f"CARD-{count:03d}"
		while frappe.db.exists("Oil Card", card_code):
			count += 1
			card_code = f"CARD-{count:03d}"

	# 生成脱敏卡号
	clean_no = str(card_no).strip()
	if len(clean_no) >= 10:
		masked_no = clean_no[:6] + "******" + clean_no[-4:]
	else:
		masked_no = clean_no

	op_bal = flt(opening_balance)

	doc = frappe.new_doc("Oil Card")
	doc.card_code = card_code
	doc.card_name = card_name.strip()
	doc.card_no = clean_no
	doc.card_no_masked = masked_no
	doc.card_type = card_type or "主卡"
	doc.company = company
	doc.supplier = supplier
	doc.status = "Active"
	doc.opening_balance = op_bal
	doc.current_balance = op_bal
	doc.insert()

	return {"status": "ok", "message": f"油卡【{doc.card_name}】已成功创建！", "name": doc.name}


@frappe.whitelist(methods=["POST"])
def delete_oil_card(oil_card):
	"""
	删除无流水的油卡档案（管理员专用）
	"""
	if not oil_card or not frappe.db.exists("Oil Card", oil_card):
		frappe.throw("指定的油卡不存在或已被删除！")
	assert_oil_ledger_access("unlock_approve", oil_card)

	card_name = frappe.db.get_value("Oil Card", oil_card, "card_name") or oil_card
	for transaction_type in ("Oil Card Recharge", "Oil Card Refuel Log"):
		if frappe.db.exists(transaction_type, {"oil_card": oil_card}):
			frappe.throw("该油卡已有业务流水，必须保留档案与审计链路，不能删除。")
	frappe.delete_doc("Oil Card", oil_card)

	return {"status": "ok", "message": f"油卡【{card_name}】已成功删除！"}


@frappe.whitelist()
def get_unified_ledger_data(oil_card, year=None, month=None):
	"""
	获取油卡单一合流流水总账数据：
	1. 首行固定：XXXX年X月结转余额 (上月结转)
	2. 加油与充值按发生时间合流，逐行计算实时结余余额 (running_balance)
	3. 检查月度核定锁定状态
	4. 判定当前用户是否为管理员 (用于高级列自适应控制)
	"""
	if not oil_card:
		return {}
	assert_oil_ledger_access("read", oil_card)

	card = frappe.get_doc("Oil Card", oil_card)
	today = getdate(nowdate())
	y = int(year) if year else today.year
	m = int(month) if (month and str(month).isdigit() and int(month) > 0) else today.month

	_, last_day = calendar.monthrange(y, m)
	start_date = f"{y}-{m:02d}-01"
	end_date = f"{y}-{m:02d}-{last_day:02d}"

	# 1. 计算【上期结转余额】
	prior_recharges = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(COALESCE(effective_amount, recharge_amount)), 0) as total
		FROM `tabOil Card Recharge`
		WHERE oil_card = %s AND posting_date < %s AND docstatus = 1
	""",
		(oil_card, start_date),
		as_dict=True,
	)[0].total

	prior_refuels = frappe.db.sql(
		"""
		SELECT COALESCE(SUM(amount), 0) as total
		FROM `tabOil Card Refuel Log`
		WHERE oil_card = %s AND posting_date < %s AND docstatus = 1
	""",
		(oil_card, start_date),
		as_dict=True,
	)[0].total

	opening_balance = flt(card.opening_balance) + flt(prior_recharges) - flt(prior_refuels)

	# 2. 拉取本月【充值记录】
	recharges = frappe.get_all(
		"Oil Card Recharge",
		filters={"oil_card": oil_card, "posting_date": ["between", [start_date, end_date]], "docstatus": 1},
		fields=[
			"name",
			"posting_date",
			"transaction_type",
			"recharge_amount",
			"bonus_amount",
			"effective_amount",
			"mode_of_payment",
			"reference_no",
			"status",
			"remark",
			"creation",
		],
	)

	# 3. 拉取本月【加油记录】
	refuels = frappe.get_all(
		"Oil Card Refuel Log",
		filters={"oil_card": oil_card, "posting_date": ["between", [start_date, end_date]], "docstatus": 1},
		fields=[
			"name",
			"posting_date",
			"vehicle",
			"fuel_grade",
			"odometer",
			"distance_since_last",
			"liters",
			"unit_price",
			"amount",
			"km_per_liter",
			"liter_per_100km",
			"invoice_status",
			"remark",
			"creation",
		],
	)

	# 4. 合流并按日期与创建时间正序排序
	raw_txns = []
	for r in recharges:
		raw_txns.append({
			"doc_type": "Oil Card Recharge",
			"name": r.name,
			"posting_date": str(r.posting_date),
			"txn_type": "充值",
			"target": r.mode_of_payment or "银行充值",
			"fuel_grade": "--",
			"odometer": None,
			"liters": None,
			"change_amount": flt(r.effective_amount or r.recharge_amount),
			"recharge_amount": flt(r.recharge_amount),
			"bonus_amount": flt(r.bonus_amount),
			"effective_amount": flt(r.effective_amount or r.recharge_amount),
			"distance": None,
			"consumption": None,
			"invoice_status": "--",
			"remark": r.remark or "",
			"creation": str(r.creation),
		})

	for f in refuels:
		raw_txns.append({
			"doc_type": "Oil Card Refuel Log",
			"name": f.name,
			"posting_date": str(f.posting_date),
			"txn_type": "加油",
			"target": f.vehicle or "车辆加油",
			"fuel_grade": f.fuel_grade or "",
			"odometer": f.odometer,
			"liters": flt(f.liters),
			"unit_price": flt(f.unit_price),
			"change_amount": -flt(f.amount),
			"recharge_amount": None,
			"bonus_amount": None,
			"effective_amount": None,
			"distance": f.distance_since_last,
			"consumption": flt(f.liter_per_100km),
			"invoice_status": f.invoice_status or "未开票",
			"remark": f.remark or "",
			"creation": str(f.creation),
		})

	# 排序：日期升序，创建时间升序
	raw_txns.sort(key=lambda x: (x["posting_date"], x["creation"]))

	# 5. 逐行计算实时结余余额 (Running Balance)
	running_bal = opening_balance
	txns = []
	for t in raw_txns:
		running_bal += t["change_amount"]
		t["running_balance"] = running_bal
		txns.append(t)

	ending_balance = running_bal

	# 6. 汇总指标
	period_recharges = sum(flt(r.effective_amount or r.recharge_amount) for r in recharges)
	period_refuels = sum(flt(f.amount) for f in refuels)
	period_liters = sum(flt(f.liters) for f in refuels)
	period_distance = sum(flt(f.distance_since_last) for f in refuels)
	avg_consumption = round((period_liters / period_distance) * 100, 2) if period_distance else 0

	# 7. 检查【月度核定与锁定状态】
	closing_name = f"{oil_card}-{y}-{m}"
	is_locked = False
	locked_info = None

	if frappe.db.exists("Oil Card Monthly Closing", closing_name):
		closing_doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
		is_locked = bool(closing_doc.get("closing_locked") or closing_doc.get("is_locked"))
		locked_info = {
			"locked_by": closing_doc.locked_by or "",
			"locked_at": str(closing_doc.locked_at) if closing_doc.locked_at else "",
			"closing_balance": flt(closing_doc.closing_balance),
			"remark": closing_doc.remark or "",
			"unlock_requested": bool(closing_doc.get("unlock_requested")),
			"unlock_requested_by": closing_doc.get("unlock_requested_by") or "",
			"unlock_requested_at": str(closing_doc.get("unlock_requested_at") or ""),
			"unlock_request_reason": closing_doc.get("unlock_request_reason") or "",
		}

	is_mgr = is_oil_card_manager()

	sup_abbr = ""
	sup_full = ""
	if card.supplier and frappe.db.exists("Supplier", card.supplier):
		s_doc = frappe.get_doc("Supplier", card.supplier)
		alias_text = (s_doc.alias or "").strip()
		full_text = (s_doc.supplier_name or s_doc.name or "").strip()
		sup_abbr = alias_text if alias_text else full_text
		sup_full = full_text
	elif card.company and frappe.db.exists("Company", card.company):
		c_doc = frappe.get_doc("Company", card.company)
		abbr_text = (c_doc.abbr or "").strip()
		full_text = (c_doc.company_name or c_doc.name or "").strip()
		sup_abbr = abbr_text if abbr_text else full_text
		sup_full = full_text
	else:
		sup_abbr = card.supplier or card.company or ""
		sup_full = card.supplier or card.company or ""

	return {
		"card_info": {
			"name": card.name,
			"card_code": card.card_code,
			"card_name": card.card_name,
			"card_no_masked": card.card_no_masked,
			"card_type": card.card_type,
			"supplier": card.supplier,
			"company": card.company,
			"supplier_abbr": sup_abbr,
			"supplier_full": sup_full,
			"status": card.status,
			"current_balance": flt(card.current_balance),
			"uninvoiced_amount": flt(card.uninvoiced_amount),
		},
		"kpis": {
			"year": y,
			"month": m,
			"start_date": start_date,
			"end_date": end_date,
			"opening_balance": opening_balance,
			"period_recharge_total": period_recharges,
			"recharge_count": len(recharges),
			"period_refuel_total": period_refuels,
			"refuel_count": len(refuels),
			"period_liters": period_liters,
			"period_distance": period_distance,
			"avg_consumption": avg_consumption,
			"ending_balance": ending_balance,
		},
		"transactions": txns,
		"is_locked": is_locked,
		"locked_info": locked_info,
		"is_manager": is_mgr,
		"is_system_admin": is_system_admin(),
	}


# 兼容旧版本 API 调用
@frappe.whitelist()
def get_oil_card_ledger_data(oil_card, year=None, month=None):
	"""
	兼容旧版接口别名
	"""
	return get_unified_ledger_data(oil_card, year, month)


@frappe.whitelist(methods=["POST"])
def quick_add_refuel(oil_card, posting_date, vehicle, odometer, liters, amount, fuel_grade=None, remark=None):
	"""
	行内快速录入加油记录
	"""
	assert_standard_lifecycle_permissions("Oil Card Refuel Log", create=True, submit=True)
	if not oil_card or not posting_date or not vehicle:
		frappe.throw("油卡、日期与车辆为必填项！")
	assert_oil_ledger_access("write", oil_card)

	dt = getdate(posting_date)
	closing_name = f"{oil_card}-{dt.year}-{dt.month}"
	if frappe.db.exists("Oil Card Monthly Closing", closing_name):
		closing_doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
		if closing_doc.get("closing_locked") or closing_doc.get("is_locked"):
			frappe.throw(f"该月份 ({dt.year}年{dt.month}月) 已被月度核定锁定，禁止直接录入加油！如需修改请先在页面右上角执行【解除锁定】或【申请取消核定】。")

	card = frappe.get_doc("Oil Card", oil_card)
	company = card.company or frappe.defaults.get_user_default("Company") or frappe.db.get_single_value("Global Defaults", "default_company")
	supplier = card.supplier or frappe.db.get_value("Supplier", {}, "name") or "津科能源"
	odo = int(flt(odometer))
	lit = flt(liters)
	amt = flt(amount)

	# 油标格式化
	grade_str = str(fuel_grade or "0# 柴油").strip()
	grade_map = {
		"92# 汽油": "92# 汽油", "92#": "92# 汽油", "92": "92# 汽油", "92号": "92# 汽油",
		"95# 汽油": "95# 汽油", "95#": "95# 汽油", "95": "95# 汽油", "95号": "95# 汽油",
		"98# 汽油": "98# 汽油", "98#": "98# 汽油", "98": "98# 汽油", "98号": "98# 汽油",
		"0# 柴油": "0# 柴油", "0#": "0# 柴油", "0": "0# 柴油", "0号": "0# 柴油", "柴油": "0# 柴油",
		"-10# 柴油": "-10# 柴油", "-10#": "-10# 柴油", "-10": "-10# 柴油",
		"-20# 柴油": "-20# 柴油", "-20#": "-20# 柴油", "-20": "-20# 柴油",
		"-35# 柴油": "-35# 柴油", "-35#": "-35# 柴油", "-35": "-35# 柴油",
		"CNG 天然气": "CNG 天然气", "CNG": "CNG 天然气", "LNG 液化气": "LNG 液化气", "LNG": "LNG 液化气", "天然气": "CNG 天然气",
	}
	fuel_grade_norm = grade_map.get(grade_str, grade_str)

	doc = frappe.new_doc("Oil Card Refuel Log")
	doc.naming_series = "OCRL-.YYYY.-.#####"
	doc.company = company
	doc.supplier = supplier
	doc.oil_card = oil_card
	doc.vehicle = vehicle
	doc.posting_date = posting_date
	doc.current_odometer = odo
	if hasattr(doc, "odometer"):
		doc.odometer = odo
	doc.fuel_grade = fuel_grade_norm
	doc.liters = lit
	doc.amount = amt
	doc.unit_price = round(amt / lit, 3) if lit > 0 else 0
	doc.invoice_status = "未开票"
	doc.status = "Submitted"
	doc.remark = remark or ""
	doc.insert()
	doc.submit()


	# 更新车辆里程与上次加油油号（供下次加油默认自动带出）
	if frappe.db.exists("Vehicle", vehicle):
		update_fields = {}
		veh_odo = flt(frappe.db.get_value("Vehicle", vehicle, "last_odometer") or 0)
		if odo > veh_odo:
			update_fields["last_odometer"] = odo
		if fuel_grade_norm and frappe.db.has_column("Vehicle", "custom_default_fuel_grade"):
			update_fields["custom_default_fuel_grade"] = fuel_grade_norm
		if update_fields:
			frappe.db.set_value("Vehicle", vehicle, update_fields, update_modified=True)


	_recalculate_oil_card_balance(oil_card)
	return {"status": "ok", "message": "加油记录已成功保存并实时核算！", "name": doc.name}


@frappe.whitelist(methods=["POST"])
def quick_add_recharge(oil_card, posting_date, recharge_amount, mode_of_payment=None, bonus_amount=None, remark=None):
	"""
	行内快速录入充值记录
	"""
	assert_standard_lifecycle_permissions("Oil Card Recharge", create=True, submit=True)
	if not oil_card or not posting_date:
		frappe.throw("油卡和日期为必填项！")
	assert_oil_ledger_access("write", oil_card)

	dt = getdate(posting_date)
	closing_name = f"{oil_card}-{dt.year}-{dt.month}"
	if frappe.db.exists("Oil Card Monthly Closing", closing_name):
		closing_doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
		if closing_doc.get("closing_locked") or closing_doc.get("is_locked"):
			frappe.throw(f"该月份 ({dt.year}年{dt.month}月) 已被月度核定锁定，禁止直接录入充值！如需修改请先在页面右上角执行【解除锁定】或【申请取消核定】。")

	card = frappe.get_doc("Oil Card", oil_card)
	rec_amt = flt(recharge_amount)
	bonus = flt(bonus_amount)
	eff_amt = rec_amt + bonus

	# 付款方式校验与容错
	if not mode_of_payment or not frappe.db.exists("Mode of Payment", mode_of_payment):
		default_mode = frappe.db.get_value("Mode of Payment", {"enabled": 1}, "name")
		mode_of_payment = default_mode or "Cheque"

	doc = frappe.new_doc("Oil Card Recharge")
	doc.naming_series = "OCR-.YYYY.-.#####"
	doc.oil_card = oil_card
	doc.company = card.company
	doc.supplier = card.supplier
	doc.posting_date = posting_date
	doc.transaction_type = "主卡充值"
	doc.mode_of_payment = mode_of_payment
	doc.recharge_amount = rec_amt
	doc.bonus_amount = bonus
	doc.effective_amount = eff_amt
	doc.status = "Submitted"
	doc.remark = remark or ""
	doc.insert()
	doc.submit()

	_recalculate_oil_card_balance(oil_card)
	return {"status": "ok", "message": "充值记录已成功保存并实时核算！", "name": doc.name}


@frappe.whitelist(methods=["POST"])
def lock_monthly_ledger(oil_card, year, month, remark=None):
	"""
	【本月核定 / 锁定月度】：
	仅油卡管理员可执行。核定后锁定该月所有加油与充值记录，进入保护状态。
	"""
	assert_oil_ledger_access("lock", oil_card)
	y = int(year)
	m = int(month)
	closing_name = f"{oil_card}-{y}-{m}"

	# 计算当前期末余额
	data = get_unified_ledger_data(oil_card, y, m)
	closing_bal = data.get("kpis", {}).get("ending_balance", 0)
	card_name = data.get("card_info", {}).get("card_name") or oil_card

	if frappe.db.exists("Oil Card Monthly Closing", closing_name):
		doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
		doc.closing_locked = 1
		doc.closing_balance = closing_bal
		doc.locked_by = frappe.session.user
		doc.locked_at = now_datetime()
		doc.unlock_requested = 0
		doc.unlock_requested_by = None
		doc.unlock_requested_at = None
		doc.unlock_request_reason = None
		if remark:
			doc.remark = remark
		# AI-GOVERNANCE-EXCEPTION: custom closing write is authorized by oil-card lock policy above.
		doc.save(ignore_permissions=True)
	else:
		doc = frappe.get_doc({
			"doctype": "Oil Card Monthly Closing",
			"oil_card": oil_card,
			"fiscal_year": y,
			"fiscal_month": m,
			"closing_locked": 1,
			"closing_balance": closing_bal,
			"locked_by": frappe.session.user,
			"locked_at": now_datetime(),
			"remark": remark or "月度核定锁定",
		})
		# AI-GOVERNANCE-EXCEPTION: custom closing creation is authorized by oil-card lock policy above.
		doc.insert(ignore_permissions=True)

	return {"status": "ok", "message": f"【{card_name}】{y}年{m}月已成功核定并锁定（期末结存: ¥{closing_bal:,.2f}）！"}


@frappe.whitelist(methods=["POST"])
def request_unlock_monthly_ledger(oil_card, year, month, reason):
	"""
	【操作员申请取消核定 / 申请解锁月度】：
	操作员提交申请理由，由油卡管理员审核批准后方可解锁。
	"""
	if not reason or not str(reason).strip():
		frappe.throw("请填写申请取消核定的具体原因！")
	assert_oil_ledger_access("unlock_request", oil_card)

	y = int(year)
	m = int(month)
	closing_name = f"{oil_card}-{y}-{m}"

	if not frappe.db.exists("Oil Card Monthly Closing", closing_name):
		frappe.throw("该月尚未核定锁定，无需申请解锁。")

	doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
	if not (doc.get("closing_locked") or doc.get("is_locked")):
		frappe.throw("该月当前处于未锁定状态，无需申请解锁。")

	doc.unlock_requested = 1
	doc.unlock_requested_by = frappe.session.user
	doc.unlock_requested_at = now_datetime()
	doc.unlock_request_reason = str(reason).strip()
	doc.save(ignore_permissions=True)
	return {"status": "ok", "message": f"已提交【{y}年{m}月】取消核定申请，请等待油卡管理员审核解锁！"}


@frappe.whitelist(methods=["POST"])
def approve_unlock_monthly_ledger(oil_card, year, month, approved=1):
	"""
	【管理员审核取消核定申请 / 直接解锁】：
	仅油卡管理员可执行。
	"""
	assert_oil_ledger_access("unlock_approve", oil_card)

	y = int(year)
	m = int(month)
	closing_name = f"{oil_card}-{y}-{m}"

	if not frappe.db.exists("Oil Card Monthly Closing", closing_name):
		return {"status": "ok", "message": "该月未锁定。"}

	doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
	is_appr = bool(int(approved)) if str(approved).isdigit() else bool(approved)

	if is_appr:
		doc.closing_locked = 0
		doc.unlock_requested = 0
		doc.save(ignore_permissions=True)
		return {"status": "ok", "message": f"{y}年{m}月已解除锁定，恢复可编辑状态。"}
	else:
		doc.unlock_requested = 0
		doc.save(ignore_permissions=True)
		return {"status": "ok", "message": f"{y}年{m}月的取消核定申请已被驳回。"}


@frappe.whitelist(methods=["POST"])
def unlock_monthly_ledger(oil_card, year, month):
	"""
	【解除月度锁定】：
	仅油卡管理员可执行。
	"""
	return approve_unlock_monthly_ledger(oil_card, year, month, approved=1)


@frappe.whitelist(methods=["POST"])
def delete_ledger_record(doc_type, name, oil_card, year, month, reason=None):
	"""
	删除单笔充值或加油流水（检查月度锁定与操作授权审计）
	"""
	if doc_type not in ["Oil Card Recharge", "Oil Card Refuel Log"]:
		frappe.throw("非法的单据类型")

	if not frappe.db.exists(doc_type, name):
		return {"status": "ok"}

	doc = frappe.get_doc(doc_type, name)
	target_oil_card = str(doc.oil_card or "").strip()
	if not target_oil_card:
		frappe.throw("目标流水未绑定油卡，无法执行作废。")
	if oil_card and str(oil_card).strip() != target_oil_card:
		frappe.throw("请求油卡与目标流水所属油卡不一致，已拒绝操作。", frappe.PermissionError)
	assert_oil_ledger_access("unlock_approve", target_oil_card)

	posting_date = getdate(doc.posting_date)
	y = int(year)
	m = int(month)
	if posting_date.year != y or posting_date.month != m:
		frappe.throw("请求期间与目标流水记账期间不一致，已拒绝操作。", frappe.PermissionError)
	closing_name = f"{target_oil_card}-{y}-{m}"
	if frappe.db.exists("Oil Card Monthly Closing", closing_name):
		closing_doc = frappe.get_doc("Oil Card Monthly Closing", closing_name)
		if closing_doc.get("closing_locked") or closing_doc.get("is_locked"):
			frappe.throw(f"该月份 ({y}年{m}月) 已被核定锁定，禁止作废单据！请先按流程申请并批准解锁。")
	if not str(reason or "").strip():
		frappe.throw("作废油卡流水必须填写原因。")

	# 记录操作审计
	try:
		audit_entry = {
			"user": frappe.session.user,
		"action": "Cancel",
			"doc_type": doc_type,
			"doc_name": name,
			"oil_card": target_oil_card,
			"year": y,
			"month": m,
			"amount": getattr(doc, "amount", None) or getattr(doc, "recharge_amount", None) or 0,
		"reason": str(reason).strip(),
			"timestamp": str(now_datetime()),
		}
		frappe.logger("oil_card").info(f"Oil Card Record Deleted: {audit_entry}")
	except Exception:
		pass

	if doc.docstatus == 1:
		doc.check_permission("cancel")
		doc.cancel()
	else:
		doc.check_permission("delete")
		doc.delete()
	_recalculate_oil_card_balance(target_oil_card)
	return {"status": "ok", "message": "记录已作废并重新核算。"}
