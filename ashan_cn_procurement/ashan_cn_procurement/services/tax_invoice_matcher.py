# Copyright (c) 2026, Ashan CN Procurement
import frappe
from frappe.utils import now_datetime, flt
from ashan_cn_procurement.parser.common import normalize_invoice_no
from ashan_cn_procurement.services.tax_invoice_validation import has_buyer_validation_error

def get_matching_purchase_invoices(invoice_nos):
	"""
	批量根据发票号码查询有效的 Purchase Invoice (docstatus < 2)
	返回映射: { normalized_bill_no: [pi_dict, ...] }
	"""
	if not invoice_nos:
		return {}

	clean_nos = [normalize_invoice_no(n) for n in invoice_nos if n]
	if not clean_nos:
		return {}

	pis = frappe.db.sql("""
		SELECT name, bill_no, docstatus, supplier, company, grand_total, posting_date
		FROM `tabPurchase Invoice`
		WHERE docstatus < 2
		  AND bill_no IN %(bill_nos)s
	""", {"bill_nos": tuple(clean_nos)}, as_dict=True)

	by_bill_no = {}
	for pi in pis:
		b_no = normalize_invoice_no(pi.get("bill_no"))
		if b_no:
			by_bill_no.setdefault(b_no, []).append(pi)

	return by_bill_no

def update_tax_invoice_match_state(tax_inv_name_or_doc, matched_pis=None):
	"""
	根据匹配的 Purchase Invoice 列表更新 Tax Invoice 的业务状态与匹配状态
	必须遵循【铁律强校验】：
	1. 票据号码必须 100% 一模一样 (bill_no == invoice_no)
	2. 票据金额必须 100% 一模一样 (abs(pi.grand_total - tax_invoice.payable_total) < 0.01)
	遵循【人工已废弃保护原则】与【红冲对冲保护原则】
	"""
	if isinstance(tax_inv_name_or_doc, str):
		if not frappe.db.exists("Tax Invoice", tax_inv_name_or_doc):
			return None
		doc = frappe.get_doc("Tax Invoice", tax_inv_name_or_doc)
	else:
		doc = tax_inv_name_or_doc

	if has_buyer_validation_error(doc.parse_warning):
		doc.matched_purchase_invoice = None
		doc.purchase_invoice_docstatus = None
		doc.matched_at = None
		doc.match_status = "未匹配"
		if doc.business_status != "已废弃":
			doc.business_status = "待录入"
		if hasattr(doc, "save") and not doc.flags.in_insert:
			doc.save(ignore_permissions=True)
		return doc

	inv_no = normalize_invoice_no(doc.invoice_no)
	if matched_pis is None:
		pis = frappe.db.sql("""
			SELECT name, bill_no, docstatus, supplier, company, grand_total, rounded_total, posting_date
			FROM `tabPurchase Invoice`
			WHERE docstatus < 2 AND bill_no = %s
		""", (inv_no,), as_dict=True)
	else:
		pis = matched_pis

	is_abandoned = (doc.business_status == "已废弃")
	is_offset = (doc.business_status == "已对冲" and bool(doc.offset_invoice))
	target_amount = flt(doc.payable_total if doc.payable_total is not None else doc.invoice_grand_total)

	if not pis:
		# 无匹配 Purchase Invoice
		doc.matched_purchase_invoice = None
		doc.purchase_invoice_docstatus = None
		if is_abandoned:
			doc.match_status = "未匹配"
		elif is_offset:
			doc.match_status = "红冲对冲"
		else:
			doc.match_status = "未匹配"
			doc.business_status = "待录入"
	else:
		# 筛选金额完全一致的 Purchase Invoices (分毫不差，误差 < 0.01)
		exact_amount_pis = []
		mismatched_amount_pis = []
		for pi in pis:
			pi_amt = flt(pi.get("grand_total") if pi.get("grand_total") is not None else pi.get("rounded_total"))
			if abs(pi_amt - target_amount) < 0.01:
				exact_amount_pis.append(pi)
			else:
				mismatched_amount_pis.append((pi, pi_amt))

		if len(exact_amount_pis) == 1:
			# 单一完全匹配 (发票号 100% 一致且金额 100% 一致)
			pi = exact_amount_pis[0]
			doc.matched_purchase_invoice = pi.get("name")
			doc.purchase_invoice_docstatus = "已提交" if pi.get("docstatus") == 1 else "草稿"
			doc.matched_at = now_datetime()

			if is_abandoned:
				doc.match_status = "废弃冲突"
			else:
				doc.business_status = "已录入"
				doc.match_status = "单一匹配"
		elif len(exact_amount_pis) > 1:
			# 多重匹配 (同发票号且同金额被录入了多次，预警重复报销/做账)
			pi = exact_amount_pis[0]
			doc.matched_purchase_invoice = pi.get("name")
			doc.purchase_invoice_docstatus = "已提交" if pi.get("docstatus") == 1 else "草稿"
			doc.matched_at = now_datetime()

			if is_abandoned:
				doc.match_status = "废弃冲突"
			else:
				doc.business_status = "已录入"
				doc.match_status = "多重匹配"
		else:
			# 金额不符 (发票号相同，但金额不一致)
			pi, pi_amt = mismatched_amount_pis[0]
			doc.matched_purchase_invoice = pi.get("name")
			doc.purchase_invoice_docstatus = "已提交" if pi.get("docstatus") == 1 else "草稿"
			doc.matched_at = now_datetime()
			doc.match_status = "金额不符"
			if not is_abandoned and not is_offset:
				doc.business_status = "待录入"

	if hasattr(doc, "save") and not doc.flags.in_insert:
		doc.flags.ignore_links = True
		doc.save(ignore_permissions=True)

	return doc

def reconcile_single_red_invoice(red_inv_doc_or_name):
	"""
	对单张红字发票执行智能红冲对冲配对
	- 若双方均未录入 ERP，自动标记双方为【已对冲】（无需录入 ERP）；
	- 若原蓝字发票已录入 ERP，红字发票保持【待录入】，提示财务录入红字采购发票冲账。
	"""
	if isinstance(red_inv_doc_or_name, str):
		if not frappe.db.exists("Tax Invoice", red_inv_doc_or_name):
			return {"matched": False, "reason": "红字发票不存在"}
		red_doc = frappe.get_doc("Tax Invoice", red_inv_doc_or_name)
	else:
		red_doc = red_inv_doc_or_name

	if has_buyer_validation_error(red_doc.parse_warning):
		return {"matched": False, "reason": "购买方不属于允许范围，禁止红冲自动对冲"}

	# 仅对红字发票或负数发票执行对冲
	is_red = red_doc.is_red_invoice or (flt(red_doc.payable_total) < 0)
	if not is_red:
		return {"matched": False, "reason": "非红字发票"}

	# 已人工废弃或已录入 ERP 的不自动对冲
	if red_doc.business_status in ["已废弃", "已录入"]:
		return {"matched": False, "reason": f"当前状态为 {red_doc.business_status}"}

	# 若已有有效对冲关联则保持
	if red_doc.business_status == "已对冲" and red_doc.offset_invoice:
		if frappe.db.exists("Tax Invoice", red_doc.offset_invoice):
			return {"matched": True, "offset_invoice": red_doc.offset_invoice}

	red_payable_abs = abs(flt(red_doc.payable_total))
	candidate_blue_no = None

	# 1. Level 1: 依据 original_invoice_no 原发票号精准匹配
	if red_doc.original_invoice_no:
		orig_no = normalize_invoice_no(red_doc.original_invoice_no)
		if frappe.db.exists("Tax Invoice", orig_no):
			candidate_blue_no = orig_no

	# 2. Level 2: 依据【销售方 + 购买方 + 金额相反】特征智能匹配
	if not candidate_blue_no:
		filters = {
			"is_red_invoice": 0,
			"business_status": "待录入"
		}
		if red_doc.seller_name:
			filters["seller_name"] = red_doc.seller_name
		if red_doc.buyer_name:
			filters["buyer_name"] = red_doc.buyer_name
		
		blue_candidates = frappe.get_all("Tax Invoice", filters=filters, fields=["name", "invoice_no", "payable_total"])
		for bc in blue_candidates:
			if abs(abs(flt(bc.payable_total)) - red_payable_abs) < 0.05:
				candidate_blue_no = bc.invoice_no
				break

	if not candidate_blue_no:
		return {"matched": False, "reason": "未找到匹配的原蓝字发票"}

	blue_doc = frappe.get_doc("Tax Invoice", candidate_blue_no)

	# 检查原蓝字发票是否已录入 ERP
	if blue_doc.business_status == "已录入" or blue_doc.matched_purchase_invoice:
		# 原蓝字发票已进入 ERP，红字发票必须保持【待录入】，由财务在 ERP 录入红字采购发票
		return {
			"matched": False,
			"reason": f"原蓝字发票 {candidate_blue_no} 已录入 ERP，红字发票需在 ERP 中单独录入红冲单据"
		}

	# 执行双方自动红冲对冲！
	now_t = now_datetime()
	
	red_doc.business_status = "已对冲"
	red_doc.match_status = "红冲对冲"
	red_doc.offset_invoice = blue_doc.invoice_no
	red_doc.offset_at = now_t
	red_doc.offset_note = f"冲销原蓝字发票 {blue_doc.invoice_no} (双方金额归零，无需录入ERP)"
	red_doc.save(ignore_permissions=True)

	blue_doc.business_status = "已对冲"
	blue_doc.match_status = "红冲对冲"
	blue_doc.offset_invoice = red_doc.invoice_no
	blue_doc.offset_at = now_t
	blue_doc.offset_note = f"已被红字发票 {red_doc.invoice_no} 抵消对冲 (无需录入ERP)"
	blue_doc.save(ignore_permissions=True)

	frappe.db.commit()

	return {
		"matched": True,
		"red_invoice": red_doc.invoice_no,
		"blue_invoice": blue_doc.invoice_no
	}

def unlink_offset_invoices(invoice_no):
	"""
	解除税局发票的红冲对冲关联，恢复双方为【待录入】
	"""
	if not frappe.db.exists("Tax Invoice", invoice_no):
		return {"ok": False, "error": f"发票 {invoice_no} 不存在"}

	doc_a = frappe.get_doc("Tax Invoice", invoice_no)
	partner_no = doc_a.offset_invoice

	doc_a.business_status = "待录入"
	doc_a.match_status = "未匹配"
	doc_a.offset_invoice = None
	doc_a.offset_at = None
	doc_a.offset_note = None
	doc_a.save(ignore_permissions=True)

	if partner_no and frappe.db.exists("Tax Invoice", partner_no):
		doc_b = frappe.get_doc("Tax Invoice", partner_no)
		if doc_b.offset_invoice == invoice_no or doc_b.business_status == "已对冲":
			doc_b.business_status = "待录入"
			doc_b.match_status = "未匹配"
			doc_b.offset_invoice = None
			doc_b.offset_at = None
			doc_b.offset_note = None
			doc_b.save(ignore_permissions=True)

	frappe.db.commit()
	return {"ok": True, "invoice_no": invoice_no, "partner_no": partner_no}

def auto_reconcile_all_red_invoices():
	"""
	批量扫描全量红字发票并执行自动对冲
	"""
	red_invoices = frappe.db.sql("""
		SELECT name, invoice_no, original_invoice_no, payable_total, seller_name, buyer_name
		FROM `tabTax Invoice`
		WHERE (is_red_invoice = 1 OR payable_total < 0)
		  AND (parse_warning IS NULL OR parse_warning NOT LIKE '%【购买方错误】%')
		  AND business_status IN ('待录入', '已对冲')
	""", as_dict=True)

	matched_count = 0
	for r in red_invoices:
		res = reconcile_single_red_invoice(r["invoice_no"])
		if res.get("matched"):
			matched_count += 1

	return {"ok": True, "total_red": len(red_invoices), "matched_count": matched_count}

def on_purchase_invoice_change(doc, method=None):
	"""
	Purchase Invoice Hook: after_insert, on_update, on_update_after_submit, on_cancel
	实时触发税局发票状态刷新
	"""
	bill_no = normalize_invoice_no(doc.get("bill_no"))
	old_bill_no = None

	if hasattr(doc, "get_doc_before_save"):
		old_doc = doc.get_doc_before_save()
		if old_doc:
			old_bill_no = normalize_invoice_no(old_doc.get("bill_no"))

	affected_nos = set(filter(None, [bill_no, old_bill_no]))
	for b_no in affected_nos:
		tax_invs = frappe.get_all("Tax Invoice", filters={"invoice_no": b_no}, fields=["name"])
		for ti in tax_invs:
			update_tax_invoice_match_state(ti.name)

def on_purchase_invoice_delete(doc, method=None):
	"""Purchase Invoice on_trash Hook"""
	bill_no = normalize_invoice_no(doc.get("bill_no"))
	if bill_no:
		tax_invs = frappe.get_all("Tax Invoice", filters={"invoice_no": bill_no}, fields=["name"])
		for ti in tax_invs:
			update_tax_invoice_match_state(ti.name)

def reconcile_tax_invoice_matches():
	"""
	每日调度兜底：全量核对税局发票与 Purchase Invoice 的匹配状态及红冲对冲
	"""
	tax_invs = frappe.get_all("Tax Invoice", fields=["name", "invoice_no", "business_status", "matched_purchase_invoice", "match_status", "offset_invoice"])
	if not tax_invs:
		return

	inv_nos = [t.invoice_no for t in tax_invs if t.invoice_no]
	matched_map = get_matching_purchase_invoices(inv_nos)

	for ti in tax_invs:
		inv_no = normalize_invoice_no(ti.invoice_no)
		pis = matched_map.get(inv_no, [])
		update_tax_invoice_match_state(ti.name, matched_pis=pis)

	# 触发红冲自动对冲
	auto_reconcile_all_red_invoices()
