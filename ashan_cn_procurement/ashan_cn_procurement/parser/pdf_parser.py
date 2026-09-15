# Copyright (c) 2026, Ashan CN Procurement
import io
import re
import pypdf
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


def _compact_pdf_text(text):
	"""Remove layout whitespace introduced by some electronic invoice PDFs."""
	return re.sub(r"\s+", "", text or "")


def _pdf_text_position(cm, tm):
	"""Return the visual PDF coordinates for a pypdf text matrix."""
	return (
		float(cm[4]) + float(cm[0]) * float(tm[4]) + float(cm[2]) * float(tm[5]),
		float(cm[5]) + float(cm[1]) * float(tm[4]) + float(cm[3]) * float(tm[5]),
	)


def _extract_pdf_content(reader):
	"""Extract normal text, layout text and positioned text chunks from a PDF."""
	normal_pages = []
	layout_pages = []
	positioned_pages = []

	for page in reader.pages:
		chunks = []

		def collect_text(text, cm, tm, _font_dict, _font_size):
			value = (text or "").strip()
			if not value:
				return
			try:
				x_pos, y_pos = _pdf_text_position(cm, tm)
			except (IndexError, TypeError, ValueError):
				return
			chunks.append({"text": value, "x": x_pos, "y": y_pos})

		try:
			normal_text = page.extract_text(visitor_text=collect_text) or ""
		except TypeError:
			# Keep compatibility with older pypdf releases that lack visitor_text.
			normal_text = page.extract_text() or ""

		try:
			layout_text = page.extract_text(extraction_mode="layout") or ""
		except (TypeError, ValueError):
			layout_text = normal_text

		normal_pages.append(normal_text)
		layout_pages.append(layout_text)
		positioned_pages.append(chunks)

	return normal_pages, layout_pages, positioned_pages


def _column_text(chunks, x_min, x_max):
	"""Read one visual table column from the text chunks in a detail row."""
	values = [
		chunk["text"].strip()
		for chunk in sorted(chunks, key=lambda item: item["x"])
		if x_min <= chunk["x"] < x_max and chunk["text"].strip()
	]
	return "".join(values)


def _column_number(chunks, x_min, x_max):
	"""Read a numeric table cell, returning None when its content is uncertain."""
	value = _column_text(chunks, x_min, x_max).replace(",", "")
	if not re.fullmatch(r"-?\d+(?:\.\d+)?", value):
		return None
	return clean_decimal(value)


def _extract_positioned_detail_items(positioned_pages, amount_without_tax, tax_amount, grand_total):
	"""Extract PDF detail rows only when their row totals reconcile to the invoice."""
	items = []

	for chunks in positioned_pages:
		anchors = sorted(
			[
				chunk for chunk in chunks
				if chunk["x"] < 180 and chunk["text"].lstrip().startswith("*")
			],
			key=lambda item: item["y"],
			reverse=True,
		)
		if not anchors:
			continue

		for index, anchor in enumerate(anchors):
			next_y = anchors[index + 1]["y"] if index + 1 < len(anchors) else float("-inf")
			lower_y = max(next_y + 3, anchor["y"] - 35)
			data_y = anchor["y"] + 9
			name_row_chunks = [
				chunk for chunk in chunks
				if lower_y < chunk["y"] <= anchor["y"] + 5
			]
			left_value_chunks = [
				chunk for chunk in name_row_chunks
				if abs(chunk["y"] - anchor["y"]) <= 5
			]
			right_value_chunks = [
				chunk for chunk in chunks
				if lower_y < chunk["y"] <= data_y + 5
				and abs(chunk["y"] - data_y) <= 5
			]
			name_chunks = [
				chunk for chunk in name_row_chunks
				if chunk["x"] < 180 and abs(chunk["x"] - anchor["x"]) <= 10
			]
			item_name = "".join(
				chunk["text"].strip()
				for chunk in sorted(name_chunks, key=lambda item: (-item["y"], item["x"]))
			)
			unit = _column_text(left_value_chunks, 180, 230)
			quantity = _column_number(left_value_chunks, 230, 293)
			unit_price = _column_number(left_value_chunks, 293, 355)
			amount = _column_number(right_value_chunks, 355, 435)
			tax_rate_text = _column_text(right_value_chunks, 435, 500)
			line_tax = _column_number(right_value_chunks, 500, 600)

			if not item_name or amount is None or line_tax is None:
				return []

			items.append({
				"line_type": "普通",
				"item_name": item_name,
				"spec_model": None,
				"unit": unit or None,
				"quantity": quantity,
				"unit_price": unit_price,
				"amount": amount,
				"tax_rate_text": tax_rate_text,
				"tax_amount": line_tax,
				"line_total": round(amount + line_tax, 2),
				"plate_number": None,
				"vehicle_type": None,
				"passage_start": None,
				"passage_end": None,
				"source_note": "PDF 版面逐行提取并通过金额自校验",
			})

	if not items:
		return []

	parsed_amount = round(sum(item["amount"] for item in items), 2)
	parsed_tax = round(sum(item["tax_amount"] for item in items), 2)
	parsed_total = round(sum(item["line_total"] for item in items), 2)
	if (
		abs(parsed_amount - amount_without_tax) > 0.05
		or abs(parsed_tax - tax_amount) > 0.05
		or abs(parsed_total - grand_total) > 0.05
	):
		return []

	return items


def parse_tax_invoice_pdf(pdf_bytes, filename=""):
	"""
	解析税局发票 PDF 字节数据，提取结构化数据并返回字典
	用于降级解析（在缺少 XML 时使用）
	支持数电发票标准版式及通用发票版式
	"""
	sha256_hash = calculate_sha256(pdf_bytes)
	pdf_size = len(pdf_bytes)

	# 1. 尝试从文件名提取发票号提示
	filename_hint_inv = ""
	if filename:
		m_fn = re.search(r'dzfp_(\d+)_', filename)
		if m_fn:
			filename_hint_inv = m_fn.group(1)

	# 2. 读取 PDF 文本
	try:
		reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
		text_pages, layout_pages, positioned_pages = _extract_pdf_content(reader)
	except Exception as e:
		return {
			"ok": False,
			"error": f"PDF 文件无法读取: {str(e)}",
			"sha256": sha256_hash,
			"pdf_size": pdf_size
		}

	full_text = "\n".join(text_pages)
	layout_text = "\n".join(layout_pages)
	compact_text = _compact_pdf_text(f"{full_text}\n{layout_text}")
	lookup_texts = (full_text, layout_text, compact_text)
	if not full_text.strip():
		return {
			"ok": True,
			"invoice_no": filename_hint_inv or "UNKNOWN",
			"parse_status": "需复核",
			"parser_source": "PDF",
			"parse_confidence": "低",
			"parse_warning": "PDF 无可提取的文本层 (可能是纯图片/扫描件)",
			"sha256": sha256_hash,
			"pdf_size": pdf_size,
			"items": []
		}

	warnings = []

	# 3. 发票类型
	invoice_type = "电子发票"
	if "增值税专用发票" in full_text:
		invoice_type = "电子发票（增值税专用发票）"
	elif "普通发票" in full_text:
		invoice_type = "电子发票（普通发票）"

	# 4. 数电发票专属连续数据块解析
	# 数电发票文本特征：发票号(20位)、日期(YYYY年MM月DD日)、购买方名、购方税号、销方名、销方税号、金额、价税合计、开票人
	inv_no = ""
	issue_date = None
	buyer_name, buyer_tax_id = "", ""
	seller_name, seller_tax_id = "", ""
	amt_without_tax = 0.0
	tax_amt = 0.0
	grand_tot = 0.0
	drawer = ""

	lines = [line.strip() for line in full_text.splitlines() if line.strip()]

	# 扫描 20 位发票号码行
	inv_idx = -1
	for idx, line in enumerate(lines):
		if re.match(r'^\d{20}$', line):
			inv_no = line
			inv_idx = idx
			break

	if inv_idx != -1 and inv_idx + 1 < len(lines):
		# 数电发票典型行序列
		# line 1: 日期
		m_d = re.match(r'^(\d{4}年\d{1,2}月\d{1,2}日|\d{4}-\d{2}-\d{2})', lines[inv_idx + 1])
		if m_d:
			issue_date = clean_date_str(m_d.group(1))

		# 寻找后续的税号与名称
		for off in range(2, min(15, len(lines) - inv_idx)):
			curr = lines[inv_idx + off]
			# 统一信用代码
			if re.match(r'^[0-9A-Za-z]{15,20}$', curr):
				if not buyer_tax_id:
					buyer_tax_id = curr
					if inv_idx + off - 1 >= 0 and not buyer_name:
						buyer_name = lines[inv_idx + off - 1]
				elif not seller_tax_id and curr != buyer_tax_id:
					seller_tax_id = curr
					if inv_idx + off - 1 >= 0 and not seller_name:
						seller_name = lines[inv_idx + off - 1]
			# 金额合计行 (如 ¥ 25633.63 ¥ 3332.37 或 ¥ 817.00)
			elif '¥' in curr or '￥' in curr:
				amts = re.findall(r'[0-9.,-]+', curr)
				if len(amts) == 2:
					amt_without_tax = clean_decimal(amts[0])
					tax_amt = clean_decimal(amts[1])
				elif len(amts) == 1:
					if grand_tot == 0.0:
						grand_tot = clean_decimal(amts[0])

	# 兜底正则提取
	if not inv_no:
		for text in lookup_texts:
			m_inv = re.search(r'发\s*票\s*号\s*码\s*[:：]?\s*([0-9]{10,25})', text)
			if m_inv:
				inv_no = m_inv.group(1)
				break
		if not inv_no and filename_hint_inv:
			inv_no = filename_hint_inv
		if not inv_no:
			for text in lookup_texts:
				m_num = re.search(r'(?<!\d)(\d{20})(?!\d)', text)
				if m_num:
					inv_no = m_num.group(1)
					break

	inv_no = normalize_invoice_no(inv_no)

	if not issue_date:
		for text in lookup_texts:
			m_date = re.search(
				r'开\s*票\s*日\s*期\s*[:：]?\s*([0-9]{4}\s*年\s*[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*日|[0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2})',
				text,
			)
			if m_date:
				issue_date = clean_date_str(m_date.group(1))
				break

	# 兜底购买方/销售方
	if not buyer_tax_id or not seller_tax_id:
		for text in lookup_texts:
			tax_ids = re.findall(r'(?:统一社会信用代码|纳税人识别号)\s*[:：/]?\s*([0-9A-Za-z]{15,20})', text)
			if len(tax_ids) >= 2:
				buyer_tax_id = buyer_tax_id or tax_ids[0].strip()
				seller_tax_id = seller_tax_id or tax_ids[1].strip()
				break
			if len(tax_ids) == 1:
				buyer_tax_id = buyer_tax_id or tax_ids[0].strip()

	if not buyer_name:
		m_buyer_name = re.search(r'购\s*名称[:：]\s*(.*?)\s+销\s*名称[:：]', layout_text)
		if m_buyer_name:
			buyer_name = _compact_pdf_text(m_buyer_name.group(1))
	if not seller_name:
		m_seller_name = re.search(r'销\s*名称[:：]\s*([^\n\r]+)', layout_text)
		if m_seller_name:
			seller_name = _compact_pdf_text(m_seller_name.group(1))

	# 价税合计 (小写)
	if amt_without_tax == 0.0 and tax_amt == 0.0:
		for text in lookup_texts:
			total_pairs = re.findall(r'[¥￥]\s*(-?[0-9.,]+)\s*[¥￥]\s*(-?[0-9.,]+)', text)
			if total_pairs:
				amt_without_tax = clean_decimal(total_pairs[-1][0])
				tax_amt = clean_decimal(total_pairs[-1][1])
				break

	if grand_tot == 0.0:
		for text in lookup_texts:
			m_gt = re.search(r'价\s*税\s*合\s*计[\s\S]{0,120}?小\s*写[^¥￥]{0,20}[¥￥]\s*(-?[0-9.,]+)', text)
			if m_gt:
				grand_tot = clean_decimal(m_gt.group(1))
				break

	# 若只有不含税和税额，则价税合计 = 不含税 + 税额
	if grand_tot == 0.0 and (amt_without_tax != 0.0 or tax_amt != 0.0):
		grand_tot = round(amt_without_tax + tax_amt, 2)
	elif amt_without_tax == 0.0 and tax_amt == 0.0 and grand_tot != 0.0:
		# 不征税发票
		amt_without_tax = grand_tot
		tax_amt = 0.0

	# 5. 开票人与备注
	for text in lookup_texts:
		m_dr = re.search(r'开\s*票\s*人\s*[:：]\s*([^\s\n\r]+)', text)
		if m_dr:
			drawer = m_dr.group(1)
			break

	remark = ""
	m_rem = re.search(r'备\s*注\s*[:：]?\s*([\s\S]*?)(?:开\s*票\s*人|$)', full_text)
	if m_rem:
		remark = m_rem.group(1).strip()

	remark_data = parse_remark_vehicle_vessel_tax(remark or full_text)
	vehicle_vessel_tax = remark_data["vehicle_vessel_tax"]
	late_fee = remark_data["late_fee"]
	remark_total = remark_data["remark_total"]

	if remark_total > 0:
		payable_total = remark_total
	else:
		payable_total = round(grand_tot + vehicle_vessel_tax + late_fee, 2)

	# 6. 红字发票
	is_red = (grand_tot < 0 or amt_without_tax < 0 or "红字" in full_text)

	# 7. 明细项提取
	items = []
	is_toll = "通行日期" in full_text or "车牌号" in full_text and ("客车" in full_text or "货车" in full_text)

	if vehicle_vessel_tax > 0 or "保费" in full_text or "保险" in full_text:
		items.append({
			"line_type": "普通",
			"item_name": "*金融服务*保费" if "保费" in full_text else "保险服务费",
			"spec_model": None,
			"unit": "次",
			"quantity": 1.0,
			"unit_price": amt_without_tax or grand_tot,
			"amount": amt_without_tax,
			"tax_rate_text": "6%" if abs(tax_amt - round(amt_without_tax * 0.06, 2)) < 0.1 else "",
			"tax_amount": tax_amt,
			"line_total": grand_tot,
			"plate_number": remark_data.get("plate_number"),
			"vehicle_type": None,
			"passage_start": None,
			"passage_end": None,
			"source_note": None
		})
		items.extend(build_vehicle_vessel_tax_items(remark_data))
	elif is_toll:
		plate_toll = remark_data.get("plate_number")
		if not plate_toll:
			m_p = re.search(r'([津京冀沪粤鲁豫苏浙皖黑吉辽蒙晋陕甘宁青新鄂湘赣闽川黔滇渝藏桂琼][A-Z0-9]{5,7})', full_text)
			if m_p:
				plate_toll = m_p.group(1)

		items.append({
			"line_type": "通行费",
			"item_name": "*通行费*通行费",
			"spec_model": None,
			"unit": "次",
			"quantity": None,
			"unit_price": None,
			"amount": amt_without_tax,
			"tax_rate_text": "不征税" if tax_amt == 0 else "",
			"tax_amount": tax_amt,
			"line_total": grand_tot,
			"plate_number": plate_toll,
			"vehicle_type": "客车" if "客车" in full_text else ("货车" if "货车" in full_text else None),
			"passage_start": None,
			"passage_end": None,
			"source_note": None
		})
	else:
		items = _extract_positioned_detail_items(
			positioned_pages, amt_without_tax, tax_amt, grand_tot
		)
		if not items:
			warnings.append(
				"PDF 未提取到可自校验的逐行金额，已按票面合计保留单行，禁止平均分摊"
			)
			items.append({
				"line_type": "普通",
				"item_name": "发票项目明细（待核对）",
				"spec_model": None,
				"unit": None,
				"quantity": None,
				"unit_price": None,
				"amount": amt_without_tax,
				"tax_rate_text": "",
				"tax_amount": tax_amt,
				"line_total": grand_tot,
				"plate_number": None,
				"vehicle_type": None,
				"passage_start": None,
				"passage_end": None,
				"source_note": "PDF 无法提取完整逐行金额，保留票面合计，禁止平均分摊",
			})

	# 8. 置信度评估
	confidence = "高"
	parse_status = "已解析"

	if not inv_no or not issue_date or grand_tot == 0.0:
		confidence = "低"
		parse_status = "需复核"
		warnings.append("关键字段 (发票号/日期/价税合计) 提取不完整")
	elif any("禁止平均分摊" in warning for warning in warnings):
		confidence = "中"
		parse_status = "需复核"
	elif abs((amt_without_tax + tax_amt) - grand_tot) > 0.05:
		confidence = "中"
		warnings.append("金额自校验存在微小差异")

	return {
		"ok": True,
		"invoice_no": inv_no or filename_hint_inv or "UNKNOWN",
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
		"original_invoice_no": None,
		"credit_note_no": None,
		"items": items,
		"parse_status": parse_status,
		"parser_source": "PDF",
		"parser_version": "1.1.0",
		"parse_confidence": confidence,
		"parse_warning": "; ".join(warnings) if warnings else "",
		"source_xml_sha256": None,
		"pdf_sha256": sha256_hash,
		"pdf_size": pdf_size
	}
