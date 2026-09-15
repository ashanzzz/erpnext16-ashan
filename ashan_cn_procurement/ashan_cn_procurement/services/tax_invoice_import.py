# Copyright (c) 2026, Ashan CN Procurement
import os
import io
import re
import zipfile
import traceback
import frappe
from frappe import _
from frappe.utils import now_datetime, cint, flt
from ashan_cn_procurement.parser.common import normalize_invoice_no, calculate_sha256
from ashan_cn_procurement.parser.xml_parser import parse_tax_invoice_xml
from ashan_cn_procurement.parser.pdf_parser import parse_tax_invoice_pdf
from ashan_cn_procurement.services.tax_invoice_matcher import (
	get_matching_purchase_invoices,
	update_tax_invoice_match_state,
	auto_reconcile_all_red_invoices
)
from ashan_cn_procurement.services.tax_invoice_validation import (
	append_unique_warning,
	get_buyer_validation_error,
	normalize_buyer_name,
)
from ashan_cn_procurement.services.authorization_service import assert_company_access, assert_module_access

def decode_zip_entry_name(info):
	"""
	智能解码 ZIP 内部文件名，兼容 Windows GBK/CP936 与 Linux UTF-8
	"""
	filename = info.filename
	if info.flag_bits & 0x800:
		# ZIP 规范显式声明 UTF-8
		return filename
	try:
		# 尝试按 CP437 还原字节后按 GBK 解码
		return filename.encode('cp437').decode('gbk')
	except Exception:
		return filename

def extract_invoice_key_from_filename(filename):
	"""
	从文件名中智能提取发票号码或配对标识
	例如:
	  dzfp_24122000000012345678_... -> 24122000000012345678
	  24122000000012345678.xml     -> 24122000000012345678
	  电子发票_24122000000012345678.pdf -> 24122000000012345678
	"""
	basename = os.path.basename(filename)
	name_without_ext = os.path.splitext(basename)[0]

	# 1. 优先匹配 20 位数电发票号码 (全电发票规则)
	m20 = re.search(r'\b(\d{20})\b', basename)
	if m20:
		return m20.group(1)

	# 2. 匹配常见税局前缀 dzfp_xxxx_
	m_dzfp = re.search(r'dzfp_([a-zA-Z0-9]+)_', basename)
	if m_dzfp:
		return m_dzfp.group(1)

	# 3. 匹配传统发票号码 (8位或10位发票号，或 12位代码+8位号码)
	m_trad = re.search(r'\b(\d{8,12})\b', basename)
	if m_trad:
		return m_trad.group(1)

	return name_without_ext

def identify_company(buyer_name, buyer_tax_id):
	"""
	按税局发票设置中的精确规则识别 ERP 公司。

	不允许通过商号、词根或公司档案进行模糊兜底匹配；仅允许使用
	Tax Invoice Settings 中由管理员维护的购买方与公司映射。
	"""
	if get_buyer_validation_error(buyer_name):
		return None

	settings = frappe.get_single("Tax Invoice Settings")
	mappings = settings.get("company_mappings") or []
	clean_buyer_name = normalize_buyer_name(buyer_name)
	clean_tax_id = (buyer_tax_id or "").strip()

	for mapping in mappings:
		if normalize_buyer_name(mapping.buyer_name) != clean_buyer_name:
			continue
		if mapping.buyer_tax_id and mapping.buyer_tax_id.strip() != clean_tax_id:
			continue
		if mapping.company:
			return mapping.company
	return None

def save_private_pdf_file(pdf_bytes, filename, docname):
	"""
	将发票 PDF 字节内容保存为 Frappe Private File 并绑定到 Tax Invoice
	绝对不保存 XML，仅长期保留 PDF
	"""
	if not pdf_bytes or not filename:
		return None

	# 确保文件名安全
	safe_filename = re.sub(r'[\\/*?:"<>|]', '_', filename)
	if not safe_filename.lower().endswith(".pdf"):
		safe_filename += ".pdf"

	file_doc = frappe.new_doc("File")
	file_doc.file_name = safe_filename
	file_doc.is_private = 1
	file_doc.attached_to_doctype = "Tax Invoice"
	file_doc.attached_to_name = docname
	file_doc.attached_to_field = "invoice_pdf"
	file_doc.content = pdf_bytes
	file_doc.save(ignore_permissions=True)

	return file_doc.file_url

def process_import_batch(batch_name):
	"""
	同步/异步处理税局发票导入批次
	"""
	if not frappe.db.exists("Tax Invoice Import Batch", batch_name):
		return {"ok": False, "error": f"批次 {batch_name} 不存在"}

	batch = frappe.get_doc("Tax Invoice Import Batch", batch_name)
	assert_module_access("tax_invoice", "write", user=batch.uploaded_by)
	batch.batch_status = "处理中"
	batch.started_at = now_datetime()
	batch.progress_percent = 5
	batch.current_message = "正在读取上传文件..."
	batch.save(ignore_permissions=True)
	frappe.db.commit()

	temp_file_url = batch.temporary_upload_file
	error_logs = []
	created_nos = []
	updated_nos = []
	file_doc_name = None
	ignored_non_invoice_count = 0

	try:
		# 1. 读取临时上传文件
		if not temp_file_url:
			raise ValueError("未找到临时上传文件，请重新上传！")

		file_doc_name = frappe.db.get_value("File", {"file_url": temp_file_url}, "name")
		if not file_doc_name:
			raise ValueError(f"临时文件记录丢失: {temp_file_url}")

		file_doc = frappe.get_doc("File", file_doc_name)
		file_content = file_doc.get_content()

		if not file_content:
			raise ValueError("上传的文件内容为空 (0 字节)！")

		is_zip = (batch.source_type == "ZIP" or batch.source_filename.lower().endswith(".zip"))

		# 2. 组织待解析的发票数据包
		# { invoice_key: { "xml": bytes, "pdf": (bytes, filename), "fn_hint": str } }
		invoices_map = {}

		if is_zip:
			batch.current_message = "正在解压并分析 ZIP 压缩包..."
			batch.save(ignore_permissions=True)
			frappe.db.commit()

			try:
				zf = zipfile.ZipFile(io.BytesIO(file_content))
			except zipfile.BadZipFile:
				raise ValueError("上传的文件不是有效的 ZIP 压缩文件或已损坏！")
			except Exception as e_zip:
				raise ValueError(f"ZIP 解压异常: {str(e_zip)}")

			with zf:
				infolist = zf.infolist()
				batch.file_count = len(infolist)

				for info in infolist:
					decoded_name = decode_zip_entry_name(info)
					# 忽略目录、隐藏文件与 macOS 专有缓存
					if info.is_dir() or decoded_name.endswith('/') or '__MACOSX' in decoded_name or os.path.basename(decoded_name).startswith('.'):
						continue

					basename = os.path.basename(decoded_name)
					# 忽略统计汇总表格与非单票文件
					if basename in ["合并发票.pdf", "全量发票查询导出结果.xlsx"] or basename.lower().endswith((".xlsx", ".xls", ".csv", ".txt")):
						ignored_non_invoice_count += 1
						continue

					ext = os.path.splitext(basename)[1].lower()
					if ext not in [".xml", ".pdf", ".ofd"]:
						continue

					inv_hint = extract_invoice_key_from_filename(decoded_name)

					if inv_hint not in invoices_map:
						invoices_map[inv_hint] = {"xml": None, "pdf": None, "fn_hint": inv_hint}

					entry_bytes = zf.read(info)
					if ext == ".xml":
						invoices_map[inv_hint]["xml"] = entry_bytes
					elif ext == ".pdf":
						invoices_map[inv_hint]["pdf"] = (entry_bytes, basename)

			if not invoices_map:
				raise ValueError(
					"压缩包内未找到任何有效的数电/税局发票文件 (.xml 或 .pdf)！\n"
					"请检查 ZIP 压缩包内容，确保包含税局导出的 XML 或 PDF 发票原件。"
				)

		else:
			# 单个或直接上传的 PDF / XML
			batch.file_count = 1
			inv_hint = extract_invoice_key_from_filename(batch.source_filename)
			ext = os.path.splitext(batch.source_filename)[1].lower()

			if ext == ".xml":
				invoices_map[inv_hint] = {"xml": file_content, "pdf": None, "fn_hint": inv_hint}
			elif ext == ".pdf":
				invoices_map[inv_hint] = {"xml": None, "pdf": (file_content, batch.source_filename), "fn_hint": inv_hint}
			else:
				raise ValueError(f"不支持的文件格式: {ext}，仅支持 .pdf, .xml, .zip 格式发票文件！")

		batch.invoice_candidate_count = len(invoices_map)
		batch.progress_percent = 15
		ignored_hint = (
			f"，已忽略 {ignored_non_invoice_count} 个非发票表格/说明文件"
			if ignored_non_invoice_count else ""
		)
		batch.current_message = (
			f"识别出 {len(invoices_map)} 份待处理发票{ignored_hint}，开始逐票智能解析..."
		)
		batch.save(ignore_permissions=True)
		frappe.db.commit()

		# 3. 逐张发票解析入库
		total_candidates = len(invoices_map)
		processed_idx = 0

		for key, bundle in invoices_map.items():
			processed_idx += 1
			xml_bytes = bundle.get("xml")
			pdf_tuple = bundle.get("pdf")
			pdf_bytes = pdf_tuple[0] if pdf_tuple else None
			pdf_filename = pdf_tuple[1] if pdf_tuple else ""

			# 更新进度
			progress = int(15 + (processed_idx / max(1, total_candidates)) * 75)
			batch.progress_percent = progress
			batch.current_message = f"正在解析发票 ({processed_idx}/{total_candidates}): {key}..."
			if processed_idx % 5 == 0 or processed_idx == total_candidates:
				batch.save(ignore_permissions=True)
				frappe.db.commit()

			try:
				parsed_data = None
				# 优先 XML 高精度解析
				if xml_bytes:
					parsed_data = parse_tax_invoice_xml(xml_bytes, filename=pdf_filename)
					if not parsed_data.get("ok"):
						if pdf_bytes:
							parsed_data = parse_tax_invoice_pdf(pdf_bytes, filename=pdf_filename)
						else:
							batch.failed_count += 1
							error_logs.append(f"发票 {key} XML 解析失败: {parsed_data.get('error')}")
							continue
				elif pdf_bytes:
					parsed_data = parse_tax_invoice_pdf(pdf_bytes, filename=pdf_filename)
					if not parsed_data.get("ok"):
						batch.failed_count += 1
						error_logs.append(f"发票 {key} PDF 解析失败: {parsed_data.get('error')}")
						continue
				else:
					continue

				inv_no = normalize_invoice_no(parsed_data.get("invoice_no") or key)
				if not inv_no or inv_no == "UNKNOWN":
					batch.failed_count += 1
					error_logs.append(f"文件 {pdf_filename or key} 无法提取有效发票号码")
					continue

				batch.parsed_count += 1

				# 购买方必须匹配管理员维护的法定主体映射；未映射的来源文件
				# 仅计入批次待复核，不生成 company 为空的 Tax Invoice。
				buyer_error = get_buyer_validation_error(parsed_data.get("buyer_name"))
				comp = identify_company(parsed_data.get("buyer_name"), parsed_data.get("buyer_tax_id"))
				if buyer_error:
					parsed_data["parse_status"] = "需复核"
					parsed_data["parse_warning"] = append_unique_warning(
						parsed_data.get("parse_warning"), buyer_error
					)
				elif not comp:
					if parsed_data.get("parse_status") == "已解析":
						parsed_data["parse_status"] = "需复核"
					parsed_data["parse_warning"] = append_unique_warning(
						parsed_data.get("parse_warning"), "购买方已校验，但未配置所属 ERP 公司映射"
					)

				if not comp:
					batch.review_count += 1
					error_logs.append(
						f"发票 {inv_no} 未创建：{parsed_data.get('parse_warning') or buyer_error or '购买方未配置公司映射'}"
					)
					continue

				# 4. 去重与更新检查
				if frappe.db.exists("Tax Invoice", inv_no):
					existing_doc = frappe.get_doc("Tax Invoice", inv_no)
					assert_module_access(
						"tax_invoice", "write", existing_doc.company, user=batch.uploaded_by
					)
					is_same_amount = (
						abs(flt(existing_doc.invoice_grand_total) - flt(parsed_data.get("invoice_grand_total"))) < 0.05 and
						abs(flt(existing_doc.amount_without_tax) - flt(parsed_data.get("amount_without_tax"))) < 0.05
					)

					if is_same_amount:
						if (not existing_doc.invoice_pdf or existing_doc.pdf_removed) and pdf_bytes:
							new_url = save_private_pdf_file(pdf_bytes, pdf_filename, existing_doc.name)
							existing_doc.invoice_pdf = new_url
							existing_doc.pdf_sha256 = calculate_sha256(pdf_bytes)
							existing_doc.pdf_size = len(pdf_bytes)
							existing_doc.pdf_removed = 0
							existing_doc.save(ignore_permissions=True)
							batch.updated_count += 1
							updated_nos.append(inv_no)
						else:
							batch.duplicate_count += 1
					else:
						existing_doc.parse_status = "需复核"
						existing_doc.parse_warning = (existing_doc.parse_warning or "") + "; 重复导入且关键金额数据与已有记录冲突"
						existing_doc.save(ignore_permissions=True)
						batch.review_count += 1
					continue

				# 5. 创建新 Tax Invoice 记录
				assert_company_access(comp, user=batch.uploaded_by)
				doc = frappe.new_doc("Tax Invoice")
				doc.invoice_no = inv_no
				doc.issue_date = parsed_data.get("issue_date")
				doc.invoice_type = parsed_data.get("invoice_type")
				doc.company = comp
				doc.seller_name = parsed_data.get("seller_name")
				doc.seller_tax_id = parsed_data.get("seller_tax_id")
				doc.buyer_name = parsed_data.get("buyer_name")
				doc.buyer_tax_id = parsed_data.get("buyer_tax_id")
				doc.drawer = parsed_data.get("drawer")
				doc.amount_without_tax = parsed_data.get("amount_without_tax")
				doc.tax_amount = parsed_data.get("tax_amount")
				doc.invoice_grand_total = parsed_data.get("invoice_grand_total")
				doc.remark_total = parsed_data.get("remark_total") or 0.0
				doc.payable_total = parsed_data.get("payable_total")
				doc.remark = parsed_data.get("remark")
				doc.is_red_invoice = parsed_data.get("is_red_invoice") or 0
				doc.original_invoice_no = parsed_data.get("original_invoice_no")
				doc.credit_note_no = parsed_data.get("credit_note_no")
				doc.parse_status = parsed_data.get("parse_status") or "已解析"
				doc.parser_source = parsed_data.get("parser_source")
				doc.parser_version = parsed_data.get("parser_version")
				doc.parse_confidence = parsed_data.get("parse_confidence")
				doc.parse_warning = parsed_data.get("parse_warning")
				doc.source_xml_sha256 = parsed_data.get("source_xml_sha256")
				doc.import_batch = batch.name
				doc.original_filename = pdf_filename or batch.source_filename
				doc.imported_at = now_datetime()
				doc.imported_by = batch.uploaded_by
				doc.business_status = "待录入"
				doc.match_status = "未匹配"

				for it in (parsed_data.get("items") or []):
					doc.append("items", it)

				doc.insert(ignore_permissions=True)

				if pdf_bytes:
					pdf_url = save_private_pdf_file(pdf_bytes, pdf_filename, doc.name)
					doc.invoice_pdf = pdf_url
					doc.pdf_sha256 = calculate_sha256(pdf_bytes)
					doc.pdf_size = len(pdf_bytes)
					doc.save(ignore_permissions=True)
				else:
					doc.parse_status = "需复核"
					doc.parse_warning = (doc.parse_warning or "") + "; 缺少原始 PDF 附件"
					doc.save(ignore_permissions=True)

				batch.created_count += 1
				created_nos.append(inv_no)
				if doc.parse_status == "需复核":
					batch.review_count += 1

			except Exception as e_row:
				batch.failed_count += 1
				err_msg = f"发票 {key} 处理异常: {str(e_row)}\n{traceback.format_exc()}"
				error_logs.append(err_msg)
				frappe.log_error(err_msg, "Tax Invoice Single Process")

		# 6. 集中批量匹配 Purchase Invoice
		batch.current_message = "正在进行采购发票批量自动匹配..."
		batch.progress_percent = 95
		batch.save(ignore_permissions=True)
		frappe.db.commit()

		all_touched_nos = set(created_nos + updated_nos)
		if all_touched_nos:
			matched_map = get_matching_purchase_invoices(list(all_touched_nos))
			for inv_n in all_touched_nos:
				pis = matched_map.get(inv_n, [])
				update_tax_invoice_match_state(inv_n, matched_pis=pis)

		# 6.2 触发红字发票与原蓝字发票自动红冲对冲
		try:
			auto_reconcile_all_red_invoices()
		except Exception as e_rec:
			frappe.log_error(f"批次红冲自动对冲异常: {str(e_rec)}", "Tax Invoice Auto Offset")

		# 7. 删除临时上传文件
		batch.current_message = "正在清理临时上传文件..."
		try:
			if file_doc_name and frappe.db.exists("File", file_doc_name):
				f_doc = frappe.get_doc("File", file_doc_name)
				f_doc.delete(ignore_permissions=True)
			batch.temporary_upload_file = None
		except Exception as e_del:
			frappe.log_error(f"清理临时上传文件失败: {str(e_del)}", "Tax Invoice Cleanup Temp File")

		# 8. 批次收尾
		batch.batch_status = "已完成" if batch.failed_count == 0 else "部分失败"
		batch.finished_at = now_datetime()
		batch.progress_percent = 100
		ignored_hint = (
			f", 已忽略非发票文件: {ignored_non_invoice_count}"
			if ignored_non_invoice_count else ""
		)
		batch.current_message = (
			f"导入完成！新增: {batch.created_count}, 略过重复: {batch.duplicate_count}, "
			f"需复核: {batch.review_count}, 失败: {batch.failed_count}{ignored_hint}"
		)
		if error_logs:
			batch.error_log = "\n---\n".join(error_logs)
		batch.save(ignore_permissions=True)
		frappe.db.commit()

		return {
			"ok": True,
			"batch_name": batch.name,
			"created_count": batch.created_count,
			"duplicate_count": batch.duplicate_count,
			"review_count": batch.review_count,
			"failed_count": batch.failed_count,
			"message": batch.current_message
		}

	except Exception as e_batch:
		frappe.db.rollback()
		batch.batch_status = "失败"
		batch.finished_at = now_datetime()
		batch.current_message = f"导入失败: {str(e_batch)}"
		batch.error_log = traceback.format_exc()
		batch.save(ignore_permissions=True)
		frappe.db.commit()

		# 清理临时文件
		if file_doc_name and frappe.db.exists("File", file_doc_name):
			try:
				frappe.get_doc("File", file_doc_name).delete(ignore_permissions=True)
			except Exception:
				pass

		return {
			"ok": False,
			"batch_name": batch.name,
			"error": str(e_batch),
			"error_log": batch.error_log,
			"message": batch.current_message
		}
