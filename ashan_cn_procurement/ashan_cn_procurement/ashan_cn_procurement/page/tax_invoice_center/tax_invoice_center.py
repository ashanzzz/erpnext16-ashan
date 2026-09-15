# ASHAN-COMPLETE: bounded invoice intake and permission-aware tax invoice read model
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import json

import frappe
from frappe import _
from frappe.utils import now_datetime, cint, flt
from ashan_cn_procurement.services.authorization_service import (
	assert_company_access,
	assert_module_access,
	can_module_access,
	get_allowed_companies,
)
from ashan_cn_procurement.services.permission_query_service import (
    assert_doctype_permission,
    filter_rows_by_doctype_permission,
)
from ashan_cn_procurement.services.tax_invoice_matcher import update_tax_invoice_match_state
from ashan_cn_procurement.services.tax_invoice_cleanup import delete_single_tax_invoice_pdf, run_cleanup_now as run_cleanup_service
from ashan_cn_procurement.services.tax_invoice_import import process_import_batch
from ashan_cn_procurement.services.tax_invoice_validation import (
	BUYER_VALIDATION_ERROR_MARKER,
	get_buyer_validation_error,
)


def _load_authorized_tax_invoice(invoice_no, action="read"):
	"""Load a tax invoice before deriving its company authorization scope."""
	if not frappe.db.exists("Tax Invoice", invoice_no):
		frappe.throw(_("税局发票不存在: {0}").format(invoice_no))
	doc = frappe.get_doc("Tax Invoice", invoice_no)
	assert_module_access("tax_invoice", action, doc.company)
	return doc


def _assert_authorized_batch(batch):
	"""Authorize a batch using the companies of the invoices it actually owns."""
	assert_module_access("tax_invoice", "read")
	companies = frappe.get_all(
		"Tax Invoice",
		filters={"import_batch": batch.name},
		pluck="company",
		order_by="company asc",
	)
	for company in sorted({str(company).strip() for company in companies if str(company).strip()}):
		assert_company_access(company)

@frappe.whitelist()
def get_tax_invoices(filters=None, start=0, page_length=50):
	"""
	获取税局发票列表及动态复核原因卡片统计。
	"""
	assert_doctype_permission("Tax Invoice", "read")
	assert_module_access("tax_invoice", "read")
	if isinstance(filters, str):
		filters = frappe.parse_json(filters) or {}
	if filters is None:
		filters = {}
	if not isinstance(filters, dict):
		frappe.throw(_("发票筛选条件格式无效"))

	if filters.get("company"):
		assert_company_access(filters["company"])
	allowed_companies = get_allowed_companies()

	# 1. 统计 KPI 指标 (不受当前状态过滤器影响)
	kpi_conditions = []
	kpi_values = {}
	buyer_error_pattern = f"%{BUYER_VALIDATION_ERROR_MARKER}%"

	if filters.get("company"):
		kpi_conditions.append("company = %(company)s")
		kpi_values["company"] = filters["company"]
	elif allowed_companies is not None:
		kpi_conditions.append("company IN %(allowed_companies)s")
		kpi_values["allowed_companies"] = tuple(sorted(allowed_companies))
	if filters.get("from_date"):
		kpi_conditions.append("issue_date >= %(from_date)s")
		kpi_values["from_date"] = filters["from_date"]
	if filters.get("to_date"):
		kpi_conditions.append("issue_date <= %(to_date)s")
		kpi_values["to_date"] = filters["to_date"]

	kpi_where = ("WHERE " + " AND ".join(kpi_conditions)) if kpi_conditions else ""

	kpi_query = f"""
		SELECT
			SUM(CASE WHEN business_status = '待录入'
				AND COALESCE(parse_status, '已解析') = '已解析' THEN 1 ELSE 0 END) AS pending_count,
			SUM(CASE WHEN business_status = '已录入'
				AND COALESCE(parse_warning, '') NOT LIKE %(buyer_error_pattern)s THEN 1 ELSE 0 END) AS entered_count,
			SUM(CASE WHEN business_status = '已对冲'
				AND COALESCE(parse_warning, '') NOT LIKE %(buyer_error_pattern)s THEN 1 ELSE 0 END) AS offset_count,
			SUM(CASE WHEN business_status = '已废弃'
				AND COALESCE(parse_warning, '') NOT LIKE %(buyer_error_pattern)s THEN 1 ELSE 0 END) AS abandoned_count,
			SUM(CASE WHEN parse_status = '需复核' THEN 1 ELSE 0 END) AS review_count,
			SUM(CASE WHEN parse_warning LIKE %(buyer_error_pattern)s THEN 1 ELSE 0 END) AS buyer_error_count,
			SUM(CASE WHEN parse_status = '需复核'
				AND COALESCE(parse_warning, '') NOT LIKE %(buyer_error_pattern)s
				THEN 1 ELSE 0 END) AS data_review_count,
			COUNT(*) AS total_count
		FROM `tabTax Invoice`
		{kpi_where}
	"""
	kpi_values["buyer_error_pattern"] = buyer_error_pattern
	kpi_res = frappe.db.sql(kpi_query, kpi_values, as_dict=True)[0]

	# 2. 查询列表数据
	list_conditions = []
	list_values = {"start": cint(start), "page_length": cint(page_length)}

	if filters.get("company"):
		list_conditions.append("company = %(company)s")
		list_values["company"] = filters["company"]
	elif allowed_companies is not None:
		list_conditions.append("company IN %(allowed_companies)s")
		list_values["allowed_companies"] = tuple(sorted(allowed_companies))
	if filters.get("business_status"):
		list_conditions.append("business_status = %(business_status)s")
		list_values["business_status"] = filters["business_status"]
	if filters.get("parse_status"):
		list_conditions.append("parse_status = %(parse_status)s")
		list_values["parse_status"] = filters["parse_status"]
	if filters.get("pending_mode") == "normal":
		list_conditions.append("business_status = '待录入'")
		list_conditions.append("COALESCE(parse_status, '已解析') = '已解析'")
	if filters.get("workflow_only"):
		list_conditions.append("COALESCE(parse_warning, '') NOT LIKE %(buyer_error_pattern)s")
		list_values["buyer_error_pattern"] = buyer_error_pattern
	if filters.get("review_category") == "buyer_error":
		list_conditions.append("parse_warning LIKE %(buyer_error_pattern)s")
		list_values["buyer_error_pattern"] = buyer_error_pattern
	elif filters.get("review_category") == "data_issue":
		list_conditions.append("parse_status = '需复核'")
		list_conditions.append("COALESCE(parse_warning, '') NOT LIKE %(buyer_error_pattern)s")
		list_values["buyer_error_pattern"] = buyer_error_pattern
	elif filters.get("review_category"):
		frappe.throw(_("未知的复核筛选类别"))
	if filters.get("from_date"):
		list_conditions.append("issue_date >= %(from_date)s")
		list_values["from_date"] = filters["from_date"]
	if filters.get("to_date"):
		list_conditions.append("issue_date <= %(to_date)s")
		list_values["to_date"] = filters["to_date"]
	if filters.get("seller_name"):
		list_conditions.append("seller_name LIKE %(seller_name)s")
		list_values["seller_name"] = f"%{filters['seller_name']}%"
	if filters.get("search_text"):
		list_conditions.append("""
			(invoice_no LIKE %(st)s
			 OR seller_name LIKE %(st)s
			 OR buyer_name LIKE %(st)s
			 OR display_summary LIKE %(st)s
			 OR offset_invoice LIKE %(st)s
			 OR remark LIKE %(st)s)
		""")
		list_values["st"] = f"%{filters['search_text']}%"

	list_where = ("WHERE " + " AND ".join(list_conditions)) if list_conditions else ""

	invoices = frappe.db.sql(f"""
		SELECT
			name, invoice_no, issue_date, invoice_type, company,
			seller_name, seller_tax_id, buyer_name, buyer_tax_id, drawer,
			amount_without_tax, tax_amount, invoice_grand_total,
			remark_total, payable_total,
			display_summary, business_status, matched_purchase_invoice,
			purchase_invoice_docstatus, match_status, matched_at,
			is_red_invoice, original_invoice_no, credit_note_no,
			offset_invoice, offset_at, offset_note,
			parse_status, parser_source, parse_confidence, parse_warning,
			invoice_pdf, pdf_removed, pdf_removed_at, pdf_remove_reason,
			abandoned_reason, abandoned_note, abandoned_by, abandoned_at,
			import_batch, original_filename, imported_at, remark
		FROM `tabTax Invoice`
		{list_where}
		ORDER BY issue_date DESC, creation DESC
		LIMIT %(start)s, %(page_length)s
	""", list_values, as_dict=True)
	invoices = filter_rows_by_doctype_permission(invoices, "Tax Invoice", "name")

	return {
		"kpis": {
			"pending_count": cint(kpi_res.pending_count or 0),
			"entered_count": cint(kpi_res.entered_count or 0),
			"offset_count": cint(kpi_res.offset_count or 0),
			"abandoned_count": cint(kpi_res.abandoned_count or 0),
			"review_count": cint(kpi_res.review_count or 0),
			"buyer_error_count": cint(kpi_res.buyer_error_count or 0),
			"data_review_count": cint(kpi_res.data_review_count or 0),
			"total_count": cint(kpi_res.total_count or 0)
		},
		"invoices": invoices,
		"permissions": {
			"can_delete_invalid_buyer": can_module_access("tax_invoice", "delete"),
		},
	}

@frappe.whitelist()
def get_tax_invoice_detail(invoice_no):
	"""获取单张税局发票完整明细与子表"""
	doc = _load_authorized_tax_invoice(invoice_no, "read")
	return doc.as_dict()


def _unlink_deleted_invoice_offset(invoice):
	"""Remove a reciprocal red-offset link before its invalid source is deleted."""
	partner_no = str(invoice.offset_invoice or "").strip()
	if not partner_no or not frappe.db.exists("Tax Invoice", partner_no):
		return False

	partner = frappe.get_doc("Tax Invoice", partner_no)
	if partner.company:
		assert_company_access(partner.company)
	if partner.offset_invoice != invoice.invoice_no:
		return False

	partner.offset_invoice = None
	partner.offset_at = None
	partner.offset_note = None
	if not partner.matched_purchase_invoice and partner.business_status == "已对冲":
		partner.business_status = "待录入"
		partner.match_status = "未匹配"
	partner.flags.ignore_links = True
	partner.save(ignore_permissions=True)
	return True


@frappe.whitelist(methods=["POST"])
def delete_invalid_buyer_tax_invoice(invoice_no, confirmed_invoice_no, deletion_reason):
	"""Archive an invalid invoice without destroying its source evidence."""
	invoice_no = str(invoice_no or "").strip()
	confirmed_invoice_no = str(confirmed_invoice_no or "").strip()
	deletion_reason = str(deletion_reason or "").strip()
	if not invoice_no or not confirmed_invoice_no or not deletion_reason:
		frappe.throw(_("删除前必须填写发票号码确认和删除原因"))
	if invoice_no != confirmed_invoice_no:
		frappe.throw(_("确认发票号码不一致，未执行删除"))
	if len(deletion_reason) > 500:
		frappe.throw(_("删除原因不能超过 500 个字符"))
	invoice = _load_authorized_tax_invoice(invoice_no, "delete")
	if not get_buyer_validation_error(invoice.buyer_name):
		frappe.throw(_("仅允许删除购买方错误的税局发票，正常发票请使用废弃流程"))
	if invoice.matched_purchase_invoice:
		frappe.throw(_("该发票已关联 ERP 采购发票，不能删除；请先按财务流程解除关联"))

	offset_unlinked = _unlink_deleted_invoice_offset(invoice)
	invoice.business_status = "已废弃"
	invoice.abandoned_reason = "其他"
	invoice.abandoned_note = f"购买方校验错误，保留原始凭证。原因：{deletion_reason}"
	invoice.abandoned_by = frappe.session.user
	invoice.abandoned_at = now_datetime()
	invoice.save(ignore_permissions=True)
	audit_record = {
		"invoice_no": invoice.invoice_no,
		"buyer_name": invoice.buyer_name,
		"deleted_by": frappe.session.user,
		"deleted_at": str(now_datetime()),
		"reason": deletion_reason,
		"source_evidence_retained": True,
		"offset_unlinked": offset_unlinked,
	}
	frappe.log_error(
		title=f"Tax Invoice Invalid Buyer Archive Audit: {invoice_no}",
		message=json.dumps(audit_record, ensure_ascii=False, sort_keys=True),
	)
	return {
		"ok": True,
		"invoice_no": invoice_no,
		"archived": True,
		"source_evidence_retained": True,
		"offset_unlinked": offset_unlinked,
	}

@frappe.whitelist(methods=["POST"])
def upload_tax_invoice_file():
	"""
	接收发票文件 (PDF 或 ZIP) 上传接口
	创建 Tax Invoice Import Batch 并触发后台 Background Job
	"""
	assert_doctype_permission("Tax Invoice Import Batch", "create")
	assert_module_access("tax_invoice", "write")
	if "file" not in frappe.request.files:
		frappe.throw(_("未找到上传文件"))

	uploaded_file = frappe.request.files["file"]
	filename = str(uploaded_file.filename or "").strip()
	lower_name = filename.lower()
	if not (lower_name.endswith(".pdf") or lower_name.endswith(".zip")):
		frappe.throw(_("仅支持 PDF 或 ZIP 发票文件。"))
	content = uploaded_file.read()
	if not content:
		frappe.throw(_("上传文件为空。"))
	if len(content) > 50 * 1024 * 1024:
		frappe.throw(_("单次上传文件不能超过 50MB，请拆分批次后重试。"))

	is_zip = lower_name.endswith(".zip")
	source_type = "ZIP" if is_zip else "PDF"

	# 保存为临时私有 File
	file_doc = frappe.new_doc("File")
	file_doc.file_name = filename
	file_doc.is_private = 1
	file_doc.content = content
	# AI-GOVERNANCE-EXCEPTION: private upload File is infrastructure owned by this authorized import service.
	file_doc.save(ignore_permissions=True)

	# 创建批次记录
	batch = frappe.new_doc("Tax Invoice Import Batch")
	batch.source_type = source_type
	batch.source_filename = filename
	batch.uploaded_by = frappe.session.user
	batch.uploaded_at = now_datetime()
	batch.batch_status = "等待处理"
	batch.progress_percent = 0
	batch.current_message = "文件已接收，开始智能解析..."
	batch.temporary_upload_file = file_doc.file_url
	batch.insert()

	# 优先同步极速解析，失败时回退至异步队列
	from ashan_cn_procurement.services.tax_invoice_import import process_import_batch
	res = {}
	try:
		res = process_import_batch(batch.name)
	except Exception as e:
		frappe.log_error(title=f"Tax Invoice Direct Import Error: {filename}")
		try:
			frappe.enqueue(
				"ashan_cn_procurement.services.tax_invoice_import.process_import_batch",
				queue="long",
				batch_name=batch.name,
				timeout=3600,
				enqueue_after_commit=True,
			)
		except Exception:
			pass

	batch.reload()
	is_ok = (batch.batch_status != "失败") and (batch.created_count > 0 or batch.duplicate_count > 0 or batch.review_count > 0)
	created_invoices = frappe.get_all("Tax Invoice", filters={"import_batch": batch.name}, pluck="name") if batch.name else []
	return {
		"ok": is_ok,
		"batch_name": batch.name,
		"filename": filename,
		"source_type": source_type,
		"status": batch.batch_status,
		"created_count": batch.created_count or 0,
		"duplicate_count": batch.duplicate_count or 0,
		"review_count": batch.review_count or 0,
		"failed_count": batch.failed_count or 0,
		"invoice_names": created_invoices,
		"current_message": batch.current_message,
		"error_log": batch.error_log or (res.get("error_log") if isinstance(res, dict) else "") or (res.get("error") if isinstance(res, dict) else "")
	}

@frappe.whitelist()
def get_import_batch_status(batch_name):
	"""轮询查询导入批次进度"""
	if not frappe.db.exists("Tax Invoice Import Batch", batch_name):
		frappe.throw(_("批次不存在: {0}").format(batch_name))

	batch = frappe.get_doc("Tax Invoice Import Batch", batch_name)
	_assert_authorized_batch(batch)
	return {
		"batch_name": batch.name,
		"status": batch.batch_status,
		"progress_percent": batch.progress_percent,
		"current_message": batch.current_message,
		"file_count": batch.file_count,
		"candidate_count": batch.invoice_candidate_count,
		"parsed_count": batch.parsed_count,
		"created_count": batch.created_count,
		"updated_count": batch.updated_count,
		"duplicate_count": batch.duplicate_count,
		"review_count": batch.review_count,
		"failed_count": batch.failed_count,
		"started_at": batch.started_at,
		"finished_at": batch.finished_at,
		"error_log": batch.error_log
	}

@frappe.whitelist(methods=["POST"])
def abandon_tax_invoice(invoice_no, reason, note=None):
	"""人工标记发票为【已废弃】"""
	doc = _load_authorized_tax_invoice(invoice_no, "write")
	doc.business_status = "已废弃"
	doc.abandoned_reason = reason
	doc.abandoned_note = note
	doc.abandoned_by = frappe.session.user
	doc.abandoned_at = now_datetime()

	# 若存在匹配的 Purchase Invoice，标记为废弃冲突
	if doc.matched_purchase_invoice:
		doc.match_status = "废弃冲突"

	doc.save(ignore_permissions=True)
	return {"ok": True, "invoice_no": invoice_no}

@frappe.whitelist(methods=["POST"])
def restore_tax_invoice(invoice_no):
	"""将已废弃发票恢复为【待录入】并自动重新匹配"""
	doc = _load_authorized_tax_invoice(invoice_no, "write")
	doc.business_status = "待录入"
	doc.abandoned_reason = None
	doc.abandoned_note = None
	doc.abandoned_by = None
	doc.abandoned_at = None
	doc.save(ignore_permissions=True)

	# 立即重新匹配一次
	update_tax_invoice_match_state(doc)
	return {"ok": True, "invoice_no": invoice_no}

@frappe.whitelist(methods=["POST"])
def rematch_tax_invoice(invoice_no):
	"""手动重新执行 Purchase Invoice 匹配"""
	_load_authorized_tax_invoice(invoice_no, "write")
	doc = update_tax_invoice_match_state(invoice_no)
	return {"ok": True, "match_status": doc.match_status, "business_status": doc.business_status}

@frappe.whitelist(methods=["POST"])
def delete_tax_invoice_pdf(invoice_no):
	"""Reject source-file destruction through a regular business endpoint."""
	_load_authorized_tax_invoice(invoice_no, "delete")
	return delete_single_tax_invoice_pdf(invoice_no, user=frappe.session.user, reason="用户请求清理")

@frappe.whitelist()
def get_recent_batches():
	"""获取最近导入批次记录"""
	assert_module_access("tax_invoice", "read")
	batches = frappe.get_all(
		"Tax Invoice Import Batch",
		fields=[
			"name", "source_type", "source_filename", "uploaded_by", "uploaded_at",
			"batch_status", "progress_percent", "created_count", "duplicate_count",
			"review_count", "failed_count", "current_message", "error_log"
		],
		order_by="creation DESC",
		limit=20
	)
	allowed_companies = get_allowed_companies()
	if allowed_companies is None:
		return batches
	visible_batches = []
	for batch in batches:
		companies = frappe.get_all(
			"Tax Invoice",
			filters={"import_batch": batch.name},
			pluck="company",
			order_by="company asc",
		)
		company_scope = {str(company).strip() for company in companies if str(company).strip()}
		if company_scope and company_scope.issubset(allowed_companies):
			visible_batches.append(batch)
		elif not company_scope and batch.uploaded_by == frappe.session.user:
			visible_batches.append(batch)
	return visible_batches

@frappe.whitelist()
def get_settings():
	"""获取发票设置"""
	assert_module_access("tax_invoice", "configure")
	settings = frappe.get_single("Tax Invoice Settings")
	return settings.as_dict()

@frappe.whitelist(methods=["POST"])
def save_settings(settings_data):
	"""保存发票设置"""
	assert_module_access("tax_invoice", "configure")
	if isinstance(settings_data, str):
		settings_data = frappe.parse_json(settings_data) or {}

	settings = frappe.get_single("Tax Invoice Settings")
	settings.auto_cleanup_enabled = 1 if settings_data.get("auto_cleanup_enabled") else 0
	settings.pdf_retention_days = cint(settings_data.get("pdf_retention_days") or 730)
	settings.cleanup_reference = settings_data.get("cleanup_reference") or "发票日期"
	settings.pdf_parser_enabled = 1 if settings_data.get("pdf_parser_enabled") else 0
	settings.max_files_per_batch = cint(settings_data.get("max_files_per_batch") or 200)

	settings.set("company_mappings", [])
	for m in settings_data.get("company_mappings", []):
		settings.append("company_mappings", {
			"company": m.get("company"),
			"buyer_name": m.get("buyer_name"),
			"buyer_tax_id": m.get("buyer_tax_id")
		})

	settings.save(ignore_permissions=True)
	return {"ok": True}

@frappe.whitelist(methods=["POST"])
def run_cleanup_now():
	"""Report the immutable-source retention policy to an authorized manager."""
	assert_module_access("tax_invoice", "configure")
	return run_cleanup_service(user=frappe.session.user)

@frappe.whitelist(methods=["POST"])
def trigger_red_invoice_reconciliation():
	"""手动触发全量红字发票红冲对冲"""
	assert_module_access("tax_invoice", "write")
	for company in frappe.get_all("Tax Invoice", pluck="company", order_by="company asc"):
		if company:
			assert_company_access(company)
	from ashan_cn_procurement.services.tax_invoice_matcher import auto_reconcile_all_red_invoices
	return auto_reconcile_all_red_invoices()

@frappe.whitelist(methods=["POST"])
def unlink_tax_invoice_offset(invoice_no):
	"""手动解除红冲对冲"""
	_load_authorized_tax_invoice(invoice_no, "write")
	from ashan_cn_procurement.services.tax_invoice_matcher import unlink_offset_invoices
	return unlink_offset_invoices(invoice_no)
