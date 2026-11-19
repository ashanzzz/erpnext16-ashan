# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import html
import re
import frappe
from frappe.utils import flt, cint

def strip_html_tags(val):
    """
    彻底杜绝 description/item_name 等字段出现 <div>, <p> 等 HTML 包装标签。
    剥离所有 HTML 标签并反转义为纯净、单行纯文本。
    """
    if not val:
        return ""
    s = str(val)
    if "<" in s and ">" in s:
        s = re.sub(r"<[^>]+>", " ", s)
        s = html.unescape(s)
        s = re.sub(r"\s+", " ", s).strip()
    return s.strip()

def format_pending_doc_details(pending_items):
    """
    根据剩余待采物料列表格式化生成纯净待采购明细文本:
    [{"name": "...", "qty": 1200, "uom": "副", "amount": 0.0}, ...]
    <= 3项: item1、item2
    > 3项: item1、item2、item3 等共N项
    无剩余: ""
    """
    item_strs = []
    for item in pending_items:
        name = strip_html_tags(item.get("name") or "")
        if chr(10) in name:
            name = name.split(chr(10))[0].strip()
        if len(name) > 30:
            name = name[:28] + ".."

        qty = flt(item.get("qty"))
        uom = strip_html_tags(item.get("uom") or "")

        if qty > 0:
            qty_str = f"{int(qty)}" if qty == int(qty) else f"{qty:.2f}".rstrip("0").rstrip(".")
            if uom:
                item_strs.append(f"{name} ({qty_str}{uom})")
            else:
                item_strs.append(f"{name} ({qty_str})")
        else:
            amount = flt(item.get("amount"))
            if amount > 0:
                item_strs.append(f"{name} (¥{amount:,.2f})")
            elif name:
                item_strs.append(name)

    if not item_strs:
        return ""
    if len(item_strs) > 3:
        return "、".join(item_strs[:3]) + f" 等共{len(item_strs)}项"
    return "、".join(item_strs)

def update_doc_details(doc, method=None):
    """
    通用【单据明细】(custom_doc_details) 自动推导生成引擎
    支持:
      - Material Request (采购申请)
      - Purchase Order (采购订单)
      - Purchase Receipt (物资入库)
      - Purchase Invoice (采购发票)
      - Reimbursement Request (员工报销申请)
    """
    try:
        dt = doc.doctype
        details_str = ""

        # 1. 采购物料类单据 (MR, PO, PR, PI)
        if dt in ["Material Request", "Purchase Order", "Purchase Receipt", "Purchase Invoice"]:
            items = doc.get("items") or []
            item_strs = []
            for item in items:
                # 原地彻底纯净化明细行的 description 与 item_name，杜绝 <div><p> 存入数据库
                if item.get("description"):
                    item.description = strip_html_tags(item.get("description"))
                if item.get("item_name"):
                    item.item_name = strip_html_tags(item.get("item_name"))

                # 提取纯净物料名称/编号
                name = strip_html_tags(item.get("item_name") or item.get("item_code") or item.get("description") or "")
                # 过滤多余换行符与超长描述
                if chr(10) in name:
                    name = name.split(chr(10))[0].strip()
                if len(name) > 30:
                    name = name[:28] + ".."

                qty = flt(item.get("qty"))
                uom = strip_html_tags(item.get("uom") or item.get("stock_uom") or "")

                # 格式化数量与单位
                if qty > 0:
                    qty_str = f"{int(qty)}" if qty == int(qty) else f"{qty:.2f}".rstrip("0").rstrip(".")
                    if uom:
                        item_strs.append(f"{name} ({qty_str}{uom})")
                    else:
                        item_strs.append(f"{name} ({qty_str})")
                else:
                    amount = flt(item.get("amount") or item.get("custom_tax_inclusive_amount") or item.get("base_amount"))
                    if amount > 0:
                        item_strs.append(f"{name} (¥{amount:,.2f})")
                    else:
                        item_strs.append(name if name else "物料")

            if not item_strs:
                details_str = ""
            elif len(item_strs) > 3:
                details_str = "、".join(item_strs[:3]) + f" 等共{len(item_strs)}项"
            else:
                details_str = "、".join(item_strs)

        # 2. 报销申请单据 (Reimbursement Request)
        elif dt == "Reimbursement Request":
            items = doc.get("invoice_items") or doc.get("invoices") or []
            item_strs = []
            for item in items:
                if item.get("description"):
                    item.description = strip_html_tags(item.get("description"))
                if item.get("item_name"):
                    item.item_name = strip_html_tags(item.get("item_name"))

                name = strip_html_tags(item.get("item_name") or item.get("item_code") or item.get("description") or "")
                if chr(10) in name:
                    name = name.split(chr(10))[0].strip()
                if len(name) > 30:
                    name = name[:28] + ".."

                qty = flt(item.get("qty"))
                uom = strip_html_tags(item.get("uom") or "")

                # 格式化数量与单位
                if qty > 0:
                    qty_str = f"{int(qty)}" if qty == int(qty) else f"{qty:.2f}".rstrip("0").rstrip(".")
                    if uom:
                        item_strs.append(f"{name} ({qty_str}{uom})")
                    else:
                        item_strs.append(f"{name} ({qty_str})")
                else:
                    amt = flt(item.get("amount") or item.get("tax_inclusive_amount"))
                    if amt > 0:
                        item_strs.append(f"{name} (¥{amt:,.2f})")
                    elif name:
                        item_strs.append(name)

            if not item_strs:
                reason = strip_html_tags(doc.get("reimbursement_reason") or doc.get("description") or doc.get("title") or "")
                tot = flt(doc.get("total_amount") or doc.get("tax_inclusive_amount"))
                if reason:
                    details_str = f"{reason} (¥{tot:,.2f})" if tot > 0 else reason
                else:
                    details_str = ""
            elif len(item_strs) > 3:
                details_str = "、".join(item_strs[:3]) + f" 等共{len(item_strs)}项"
            else:
                details_str = "、".join(item_strs)

        # 写入字段 (确保本身不带任何 HTML 标签)
        doc.custom_doc_details = strip_html_tags(details_str)

        # 兼顾旧版 Purchase Invoice 字段兼容性
        if dt == "Purchase Invoice" and hasattr(doc, "custom_items_summary"):
            doc.custom_items_summary = doc.custom_doc_details

        # 针对 Material Request 自动物化维护待采项数、待采总量与待采购明细摘要
        if dt == "Material Request":
            try:
                items = doc.get("items") or []
                p_items = 0
                p_qty = 0.0
                pending_item_list = []
                for item in items:
                    stk = flt(item.get("stock_qty") if item.get("stock_qty") is not None else item.get("qty"))
                    cf = flt(item.get("conversion_factor")) or 1.0
                    ord_q = flt(item.get("ordered_qty"))
                    rem = stk - ord_q
                    if rem > 0.0001:
                        p_items += 1
                        rem_uom_qty = rem / cf
                        p_qty += rem_uom_qty
                        i_name = strip_html_tags(item.get("item_name") or item.get("item_code") or item.get("description") or "")
                        i_uom = strip_html_tags(item.get("uom") or item.get("stock_uom") or "")
                        pending_item_list.append({
                            "name": i_name,
                            "qty": rem_uom_qty,
                            "uom": i_uom,
                            "amount": flt(item.get("amount")),
                        })
                doc.custom_pending_item_count = p_items
                doc.custom_pending_qty_total = round(p_qty, 2)
                doc.custom_pending_doc_details = format_pending_doc_details(pending_item_list)
            except Exception:
                pass

        # 针对 Purchase Order，在提交状态下触发关联 MR 待采缓存同步刷新
        elif dt == "Purchase Order":
            try:
                if getattr(doc, "docstatus", 0) == 1:
                    from ashan_cn_procurement.services.procurement_picker_service import compute_mr_pending_cache
                    mr_names = {it.material_request for it in (doc.get("items") or []) if getattr(it, "material_request", None)}
                    for mr_name in mr_names:
                        compute_mr_pending_cache(mr_name)
            except Exception:
                pass

    except Exception as e:
        frappe.logger("document_details").warning(f"Failed to generate doc details for {doc.doctype} {doc.name}: {e}")
