# Copyright (c) 2026, Ashan CN Procurement
import re
import hashlib
from datetime import datetime

def normalize_invoice_no(val):
	"""
	标准化发票号：转字符串，去除首尾空白和不可见字符
	禁止转 int，禁止删除前导 0
	"""
	if val is None:
		return ""
	s = str(val).strip()
	# 去除非打印/不可见控制字符
	s = re.sub(r'[\x00-\x1f\x7f-\x9f\u200b-\u200f\ufeff]', '', s)
	return s

def calculate_sha256(data_bytes):
	"""计算字节数据的 SHA-256 哈希"""
	if not data_bytes:
		return ""
	return hashlib.sha256(data_bytes).hexdigest()

def clean_decimal(val, default=0.0):
	"""清理并转换为浮点数"""
	if val is None:
		return default
	if isinstance(val, (int, float)):
		return float(val)
	s = str(val).strip().replace(',', '').replace('¥', '').replace('￥', '').replace('元', '')
	try:
		return float(s)
	except ValueError:
		return default

def clean_date_str(val):
	"""清理并格式化日期为 YYYY-MM-DD"""
	if not val:
		return None
	s = str(val).strip()
	# 常见格式：2026-04-02, 2026年04月02日, 20260402
	m1 = re.match(r'^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})', s)
	if m1:
		return f"{m1.group(1)}-{int(m1.group(2)):02d}-{int(m1.group(3)):02d}"
	m2 = re.match(r'^(\d{4})年(\d{1,2})月(\d{1,2})日', s)
	if m2:
		return f"{m2.group(1)}-{int(m2.group(2)):02d}-{int(m2.group(3)):02d}"
	m3 = re.match(r'^(\d{4})(\d{2})(\d{2})$', s)
	if m3:
		return f"{m3.group(1)}-{m3.group(2)}-{m3.group(3)}"
	return s

def parse_remark_vehicle_vessel_tax(remark_text):
	"""
	从发票备注中提取车船税、滞纳金、车牌号、所属期与备注合计
	真实样例：
	保\\批单号:PDZA202600000000000090;
	车牌号:津A00000;
	代收车船税:325.00元,税款所属期:2026年01月-2026年12月;
	滞纳金:0.00元;
	合计:1059.50元;
	"""
	res = {
		"vehicle_vessel_tax": 0.0,
		"late_fee": 0.0,
		"remark_total": 0.0,
		"plate_number": None,
		"tax_period": None,
		"policy_no": None
	}
	if not remark_text:
		return res

	# 1. 代收车船税
	m_vv = re.search(r'代收车船税\s*[:：]\s*([0-9.,]+)\s*元?', remark_text)
	if m_vv:
		res["vehicle_vessel_tax"] = clean_decimal(m_vv.group(1))

	# 2. 滞纳金
	m_lf = re.search(r'滞纳金\s*[:：]\s*([0-9.,]+)\s*元?', remark_text)
	if m_lf:
		res["late_fee"] = clean_decimal(m_lf.group(1))

	# 3. 备注中的“合计”
	m_tot = re.search(r'合计\s*[:：]\s*([0-9.,]+)\s*元?', remark_text)
	if m_tot:
		res["remark_total"] = clean_decimal(m_tot.group(1))

	# 4. 车牌号
	m_plate = re.search(r'车牌号?\s*[:：]\s*([^\s;；,，]+)', remark_text)
	if m_plate:
		res["plate_number"] = m_plate.group(1).strip()

	# 5. 税款所属期
	m_period = re.search(r'税款所属期\s*[:：]\s*([^\s;；,，]+)', remark_text)
	if m_period:
		res["tax_period"] = m_period.group(1).strip()

	# 6. 保单号
	m_pol = re.search(r'保[\\/]?批单号\s*[:：]\s*([^\s;；,，]+)', remark_text)
	if m_pol:
		res["policy_no"] = m_pol.group(1).strip()

	return res
