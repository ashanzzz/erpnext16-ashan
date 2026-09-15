# Copyright (c) 2026, Ashan CN Procurement
import xml.etree.ElementTree as ET
from ashan_cn_procurement.parser.common import (
	normalize_invoice_no,
	calculate_sha256,
	clean_decimal,
	clean_date_str,
	parse_remark_vehicle_vessel_tax
)
from ashan_cn_procurement.services.tax_invoice_validation import (
	build_vehicle_vessel_tax_items,
)

def _strip_ns(tag):
	"""去除 XML namespace 前缀"""
	if tag and '}' in tag:
		return tag.split('}', 1)[1]
	return tag

def _find_elem(root, path):
	"""按 tag 名（忽略 namespace）查找单节点"""
	parts = path.strip('/').split('/')
	curr = [root]
	for part in parts:
		next_curr = []
		for node in curr:
			for child in node:
				if _strip_ns(child.tag) == part:
					next_curr.append(child)
		if not next_curr:
			return None
		curr = next_curr
	return curr[0] if curr else None

def _find_all(root, path):
	"""按 tag 名（忽略 namespace）查找全部匹配节点"""
	parts = path.strip('/').split('/')
	curr = [root]
	for i, part in enumerate(parts):
		next_curr = []
		for node in curr:
			for child in node:
				if _strip_ns(child.tag) == part:
					next_curr.append(child)
		curr = next_curr
	return curr

def _get_text(root, path, default=""):
	node = _find_elem(root, path)
	if node is not None and node.text:
		return node.text.strip()
	return default

def parse_tax_invoice_xml(xml_bytes, filename=""):
	"""
	解析税局发票 XML 字节数据，返回结构化字典
	XML 仅在内存中处理，不落地保存
	"""
	sha256_hash = calculate_sha256(xml_bytes)
	try:
		root = ET.fromstring(xml_bytes)
	except Exception as e:
		return {
			"ok": False,
			"error": f"XML 解析语法错误: {str(e)}",
			"sha256": sha256_hash
		}

	# 1. 发票号
	eiid = _get_text(root, "Header/EIid")
	inv_num = _get_text(root, "TaxSupervisionInfo/InvoiceNumber")
	invoice_no = normalize_invoice_no(eiid or inv_num)

	warnings = []
	if eiid and inv_num and normalize_invoice_no(eiid) != normalize_invoice_no(inv_num):
		warnings.append(f"EIid ({eiid}) 与 InvoiceNumber ({inv_num}) 不一致")

	# 2. 开票日期
	issue_time = _get_text(root, "TaxSupervisionInfo/IssueTime")
	issue_date = clean_date_str(issue_time)

	# 3. 发票类型
	type_label = _get_text(root, "Header/InherentLabel/EInvoiceType/LabelName")
	vat_label = _get_text(root, "Header/InherentLabel/GeneralOrSpecialVAT/LabelName")
	invoice_type = " ".join(filter(None, [type_label, vat_label])) or "电子发票"

	# 4. 交易双方
	seller_tax_id = _get_text(root, "EInvoiceData/SellerInformation/SellerIdNum")
	seller_name = _get_text(root, "EInvoiceData/SellerInformation/SellerName")
	buyer_tax_id = _get_text(root, "EInvoiceData/BuyerInformation/BuyerIdNum")
	buyer_name = _get_text(root, "EInvoiceData/BuyerInformation/BuyerName")

	# 5. 总额与开票人
	amt_without_tax = clean_decimal(_get_text(root, "EInvoiceData/BasicInformation/TotalAmWithoutTax"))
	tax_amt = clean_decimal(_get_text(root, "EInvoiceData/BasicInformation/TotalTaxAm"))
	grand_tot = clean_decimal(_get_text(root, "EInvoiceData/BasicInformation/TotalTax-includedAmount"))
	drawer = _get_text(root, "EInvoiceData/BasicInformation/Drawer")

	# 6. 备注全文与车船税提取
	remark = _get_text(root, "EInvoiceData/AdditionalInformation/Remark")
	remark_data = parse_remark_vehicle_vessel_tax(remark)
	vehicle_vessel_tax = remark_data["vehicle_vessel_tax"]
	late_fee = remark_data["late_fee"]
	remark_total = remark_data["remark_total"]

	# 实际应付合计：优先备注合计，否则票面价税合计 + 车船税 + 滞纳金
	if remark_total > 0:
		payable_total = remark_total
	else:
		payable_total = round(grand_tot + vehicle_vessel_tax + late_fee, 2)

	# 7. 红字发票识别
	orig_inv_code = _get_text(root, "EInvoiceData/SpecificInformation/RedEInvoice/OriginalInvoiceCode")
	credit_note_no = _get_text(root, "EInvoiceData/SpecificInformation/RedEInvoice/CreditNoteNumber")
	is_red = bool(orig_inv_code or credit_note_no or grand_tot < 0 or amt_without_tax < 0)

	# 8. 通行费信息 (若存在)
	toll_node = _find_elem(root, "EInvoiceData/SpecificInformation/Toll")
	toll_info = {}
	if toll_node is not None:
		toll_info = {
			"plate_number": _get_text(toll_node, "PlateNumber"),
			"vehicle_type": _get_text(toll_node, "VehicleType"),
			"passage_start": clean_date_str(_get_text(toll_node, "StartDatesOfPassage")),
			"passage_end": clean_date_str(_get_text(toll_node, "EndDatesOfPassage")),
		}

	# 9. 明细项
	item_nodes = _find_all(root, "EInvoiceData/IssuItemInformation")
	items = []
	sum_item_amt = 0.0
	sum_item_tax = 0.0

	for it in item_nodes:
		item_name = _get_text(it, "ItemName")
		spec_mod = _get_text(it, "SpecMod")
		mea_units = _get_text(it, "MeaUnits")
		qty_raw = _get_text(it, "Quantity")
		unit_p_raw = _get_text(it, "UnPrice")
		amt = clean_decimal(_get_text(it, "Amount"))
		tax_r_raw = _get_text(it, "TaxRate")
		com_tax_am = clean_decimal(_get_text(it, "ComTaxAm"))
		line_tot = clean_decimal(_get_text(it, "TotaltaxIncludedAmount"))

		# 税率文本格式化
		tax_rate_text = tax_r_raw
		try:
			r_flt = float(tax_r_raw)
			tax_rate_text = f"{int(r_flt * 100)}%" if (r_flt * 100).is_integer() else f"{r_flt * 100:.2f}%"
		except (ValueError, TypeError):
			pass

		# 通行费特殊判断：若数量或单价被填成日期（如 8 位纯数字 20260327），置空
		qty = None
		unit_p = None
		if toll_node is not None:
			line_type = "通行费"
			plate_num = toll_info.get("plate_number")
			v_type = toll_info.get("vehicle_type")
			p_start = toll_info.get("passage_start")
			p_end = toll_info.get("passage_end")
			# 过滤误填日期的 quantity
			if qty_raw and not (len(qty_raw) == 8 and qty_raw.startswith("20")):
				qty = clean_decimal(qty_raw, None)
			if unit_p_raw and not (len(unit_p_raw) == 8 and unit_p_raw.startswith("20")):
				unit_p = clean_decimal(unit_p_raw, None)
		else:
			line_type = "普通"
			plate_num = None
			v_type = None
			p_start = None
			p_end = None
			qty = clean_decimal(qty_raw, None) if qty_raw else None
			unit_p = clean_decimal(unit_p_raw, None) if unit_p_raw else None

		if line_tot == 0.0:
			line_tot = round(amt + com_tax_am, 2)

		sum_item_amt += amt
		sum_item_tax += com_tax_am

		items.append({
			"line_type": line_type,
			"item_name": item_name,
			"spec_model": spec_mod,
			"unit": mea_units,
			"quantity": qty,
			"unit_price": unit_p,
			"amount": amt,
			"tax_rate_text": tax_rate_text,
			"tax_amount": com_tax_am,
			"line_total": line_tot,
			"plate_number": plate_num,
			"vehicle_type": v_type,
			"passage_start": p_start,
			"passage_end": p_end,
			"source_note": None
		})

	# 10. 车船税与滞纳金必须作为独立的发票项目明细行入库。
	items.extend(build_vehicle_vessel_tax_items(remark_data))

	# 11. 金额自校验
	confidence = "高"
	parse_status = "已解析"

	# 普通金额自校验 (允许 0.05 容差)
	if abs((amt_without_tax + tax_amt) - grand_tot) > 0.05:
		warnings.append(f"票面价税合计 ({grand_tot}) 不等于 不含税 ({amt_without_tax}) + 税额 ({tax_amt})")
		confidence = "中"

	if items and abs(sum_item_amt - amt_without_tax) > 0.05:
		warnings.append(f"明细不含税合计 ({sum_item_amt:.2f}) 与票面不含税 ({amt_without_tax:.2f}) 存在微小差异")
		confidence = "中"

	if vehicle_vessel_tax > 0 and remark_total > 0:
		if abs((grand_tot + vehicle_vessel_tax + late_fee) - remark_total) > 0.05:
			warnings.append(f"备注合计 ({remark_total}) 与票面+车船税 ({grand_tot + vehicle_vessel_tax + late_fee:.2f}) 不一致")
			confidence = "中"
			parse_status = "需复核"

	if warnings and confidence != "高":
		parse_status = "需复核"

	return {
		"ok": True,
		"invoice_no": invoice_no,
		"issue_date": issue_date,
		"invoice_type": invoice_type,
		"seller_name": seller_name,
		"seller_tax_id": seller_tax_id,
		"buyer_name": buyer_name,
		"buyer_tax_id": buyer_tax_id,
		"amount_without_tax": amt_without_tax,
		"tax_amount": tax_amt,
		"invoice_grand_total": grand_tot,
		"vehicle_vessel_tax": vehicle_vessel_tax,
		"late_fee": late_fee,
		"remark_total": remark_total,
		"payable_total": payable_total,
		"drawer": drawer,
		"remark": remark,
		"is_red_invoice": 1 if is_red else 0,
		"original_invoice_no": normalize_invoice_no(orig_inv_code),
		"credit_note_no": credit_note_no,
		"items": items,
		"parse_status": parse_status,
		"parser_source": "XML",
		"parser_version": "1.0.0",
		"parse_confidence": confidence,
		"parse_warning": "; ".join(warnings) if warnings else "",
		"source_xml_sha256": sha256_hash
	}
