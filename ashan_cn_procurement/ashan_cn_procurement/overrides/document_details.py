# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import html
import re
import frappe
from frappe.utils import flt, cint

def patch_transaction_base_zero_rate_validation():
    """
    允许零元/暂定价采购订单（PO rate == 0）在物资入库（Purchase Receipt）时录入真实到货单价。
    ERPNext 默认 validate_rate_with_reference_doc 会阻断与前序单据单价不一致的情形。
    在此处包装原生校验：如果前置单据该明细单价 <= 0.0001，在调用原生校验期间对该行执行免检放行，
    从而既完整保留原生 ERPNext 的所有角色权限与差异比对能力，又支持暂定价订单到货后录入真实单价。
    """
    try:
        from erpnext.utilities.transaction_base import TransactionBase
        if getattr(TransactionBase, "_ashan_zero_rate_patched", False):
            return

        orig_validate = TransactionBase.validate_rate_with_reference_doc

        def wrapper_validate(self, ref_details):
            saved_rates = {}
            try:
                for ref_dt, _ref_dn_field, ref_link_field in ref_details:
                    ref_names = [d.get(ref_link_field) for d in self.get("items") if d.get(ref_link_field)]
                    if not ref_names:
                        continue
                    ref_details_map = self.get_reference_details(ref_names, ref_dt + " Item")
                    for d in self.get("items"):
                        link_id = d.get(ref_link_field)
                        if link_id and flt(ref_details_map.get(link_id)) <= 0.0001:
                            saved_rates[d] = d.rate
                            d.rate = flt(ref_details_map.get(link_id))
                return orig_validate(self, ref_details)
            finally:
                for d, old_r in saved_rates.items():
                    d.rate = old_r

        TransactionBase.validate_rate_with_reference_doc = wrapper_validate
        TransactionBase._ashan_zero_rate_patched = True
    except Exception as e:
        frappe.logger("overrides").warning(f"Failed to patch TransactionBase zero-rate validation: {e}")

patch_transaction_base_zero_rate_validation()

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
    > 3项: item1 等N项
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
    if len(item_strs) > 1:
        return f"{item_strs[0]} 等{len(item_strs)}项"
    return item_strs[0]


_ITEM_TABLE_CONFIG = {
    "Material Request Item": (
        "tabMaterial Request Item",
        "COALESCE(NULLIF(item_name, ''), NULLIF(item_code, ''), description, '物料')",
        "qty",
        "uom",
        "idx",
    ),
    "Purchase Order Item": (
        "tabPurchase Order Item",
        "COALESCE(NULLIF(item_name, ''), NULLIF(item_code, ''), description, '物料')",
        "qty",
        "uom",
        "idx",
    ),
    "Purchase Receipt Item": (
        "tabPurchase Receipt Item",
        "COALESCE(NULLIF(item_name, ''), NULLIF(item_code, ''), description, '物料')",
        "qty",
        "uom",
        "idx",
    ),
    "Purchase Invoice Item": (
        "tabPurchase Invoice Item",
        "COALESCE(NULLIF(item_name, ''), NULLIF(item_code, ''), description, '物料')",
        "qty",
        "uom",
        "idx",
    ),
    "Reimbursement Invoice Item": (
        "tabReimbursement Invoice Item",
        "COALESCE(NULLIF(item_name, ''), NULLIF(description, ''), '报销明细')",
        "qty",
        "uom",
        "idx",
    ),
}


def build_full_doc_details_map(
    parent_names: list[str] | tuple[str, ...],
    item_doctype: str,
    limit_per_doc: int = 40,
) -> dict[str, dict]:
    """Batch-fetch numbered itemized preview lines (up to `limit_per_doc`) for hover tooltips."""
    names = [n for n in dict.fromkeys(parent_names or []) if n]
    cfg = _ITEM_TABLE_CONFIG.get(item_doctype)
    if not names or not cfg:
        return {}

    table_name, name_expr, qty_col, uom_col, order_col = cfg
    rows = frappe.db.sql(
        f"""
        SELECT
            parent,
            {name_expr} AS item_name,
            COALESCE({qty_col}, 0) AS qty,
            COALESCE({uom_col}, '') AS uom
        FROM `{table_name}`
        WHERE parent IN %(names)s
        ORDER BY parent, {order_col} ASC
        """,
        {"names": tuple(names)},
        as_dict=True,
    )

    grouped: dict[str, list[str]] = {}
    totals: dict[str, int] = {}
    for r in rows:
        parent = r.parent
        totals[parent] = totals.get(parent, 0) + 1
        bucket = grouped.setdefault(parent, [])
        if len(bucket) >= limit_per_doc:
            continue
        name = strip_html_tags(r.item_name or "")
        if "\n" in name:
            name = name.split("\n")[0].strip()
        if len(name) > 28:
            name = name[:26] + ".."
        qty = flt(r.qty)
        uom = strip_html_tags(r.uom or "")
        qty_str = f"{int(qty)}" if qty == int(qty) else f"{qty:.2f}".rstrip("0").rstrip(".")
        label = f"{name} ({qty_str}{uom})" if qty > 0 else name
        bucket.append(f"{len(bucket) + 1}. {label}")

    out: dict[str, dict] = {}
    for parent, lines in grouped.items():
        total = totals.get(parent, len(lines))
        if total > limit_per_doc:
            lines = lines + [f"……其余 {total - limit_per_doc} 项请点击该行查看全部明细"]
        out[parent] = {
            "full_text": "\n".join(lines),
            "item_count": total,
        }
    return out


def attach_full_doc_details(
    rows: list[dict],
    id_field: str,
    item_doctype: str,
    limit_per_doc: int = 40,
) -> list[dict]:
    """Attach `doc_details_full` and `doc_details_count` onto summary dict rows in one batch query."""
    if not rows:
        return rows
    parent_names = [r.get(id_field) for r in rows if isinstance(r, dict) and r.get(id_field)]
    details_map = build_full_doc_details_map(parent_names, item_doctype, limit_per_doc=limit_per_doc)
    for r in rows:
        if not isinstance(r, dict):
            continue
        info = details_map.get(r.get(id_field))
        if info:
            r["doc_details_full"] = info["full_text"]
            r["doc_details_count"] = info["item_count"]
    return rows

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
            elif len(item_strs) > 1:
                details_str = f"{item_strs[0]} 等{len(item_strs)}项"
            else:
                details_str = item_strs[0]

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
            elif len(item_strs) > 1:
                details_str = f"{item_strs[0]} 等{len(item_strs)}项"
            else:
                details_str = item_strs[0]

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

        # 针对 Purchase Receipt，在提交状态下触发关联 0元暂定价采购订单的价格反填与审计存证
        elif dt == "Purchase Receipt":
            try:
                if getattr(doc, "docstatus", 0) == 1:
                    from ashan_cn_procurement.services.procurement_picker_service import backfill_po_from_purchase_receipt
                    backfill_po_from_purchase_receipt(doc)
            except Exception:
                pass

    except Exception as e:
        frappe.logger("document_details").warning(f"Failed to generate doc details for {doc.doctype} {doc.name}: {e}")
