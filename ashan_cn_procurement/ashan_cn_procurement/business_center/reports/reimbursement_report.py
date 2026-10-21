#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import io
import json
from dataclasses import dataclass, field
from datetime import datetime
from types import SimpleNamespace
from typing import Any, Final
from urllib.parse import quote

from .. import local_requests as requests
from .. import legacy_wmill as wmill
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

BASE_URL_VARIABLE_PATH = "f/erpnext/base_url"
API_TOKEN_VARIABLE_PATH = "f/erpnext/api_token"
BACKEND_VERSION = "2.0.0-frappe16"
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
BASE_URL = ""
TOKEN = ""
HEADERS: dict[str, str] = {}


def _read_connection_values() -> tuple[str, str, str]:
    """Read the ERPNext connection from the App-managed ERPNext 当前站点适配器.

    The URL is stored at f/erpnext/base_url and the credential at
    f/erpnext/api_token. The token value is never returned to the frontend or
    written to logs.
    """
    variable_errors: list[str] = []

    try:
        base_url = str(wmill.get_variable(BASE_URL_VARIABLE_PATH) or "").strip().rstrip("/")
    except Exception as exc:
        base_url = ""
        variable_errors.append(f"{BASE_URL_VARIABLE_PATH}: {exc}")

    try:
        token = str(wmill.get_variable(API_TOKEN_VARIABLE_PATH) or "").strip()
    except Exception as exc:
        token = ""
        variable_errors.append(f"{API_TOKEN_VARIABLE_PATH}: {exc}")

    missing: list[str] = []
    if not base_url:
        missing.append(BASE_URL_VARIABLE_PATH)
    if not token:
        missing.append(API_TOKEN_VARIABLE_PATH)
    if missing:
        detail = f"；读取错误：{' | '.join(variable_errors)}" if variable_errors else ""
        raise RuntimeError(
            "ERPNext连接配置不可用。请在ERPNext业务中心的“连接设置”页面完成配置："
            + "、".join(missing)
            + detail
        )

    return base_url, token, "frappe_local"

def _set_connection() -> None:
    global BASE_URL, TOKEN, HEADERS
    BASE_URL, TOKEN, _source = _read_connection_values()
    HEADERS = {"Authorization": f"Token {TOKEN}", "Accept": "application/json"}




# ---------- 混合账单 17 列 (报销混合单据模式, 与 generate_reimbursement_mixed_report.py 一致) ----------

class MixedColumns:
    REIMBURSEMENT_NO = "报销凭证号"
    REIMBURSEMENT_DATE = "报销日期"
    TITLE = "报销标题"
    AMOUNT = "报销金额"
    INVOICE_NO = "发票号码"
    INVOICE_TYPE = "发票类型"
    SUPPLIER = "供应商"
    PAYMENT_METHOD = "付款方式"
    ITEM_NAME = "项目名(物料名)"
    GUIGE = "规格型号"
    RATE = "单价"
    QTY = "数量"
    UOM = "单位"
    ALLOCATED = "分配金额"
    REMARK = "备注"
    DIRECTION = "借贷方向"
    PAYMENT_REMARK = "付款备注"  # v1.7.3: 独立列, 拆出付款拆分格式

    ORDER: Final[tuple[str, ...]] = (
        REIMBURSEMENT_NO, REIMBURSEMENT_DATE, TITLE, AMOUNT,
        INVOICE_NO, INVOICE_TYPE, SUPPLIER, PAYMENT_METHOD,
        ITEM_NAME, GUIGE, RATE, QTY, UOM,
        ALLOCATED, REMARK, DIRECTION, PAYMENT_REMARK,
    )

    # 合并单元格列 (同一 RR 多行展开时合并)
    MERGE: Final[frozenset[str]] = frozenset({
        REIMBURSEMENT_NO, REIMBURSEMENT_DATE, TITLE, AMOUNT,
    })

    # 自动换行列
    WRAP: Final[frozenset[str]] = frozenset({
        REIMBURSEMENT_NO, REIMBURSEMENT_DATE, TITLE, AMOUNT, PAYMENT_METHOD,
    })

    # 强制文本格式列 (防科学计数法)
    TEXT: Final[frozenset[str]] = frozenset({INVOICE_NO})


# ---------- 吉众记账 6 列 (2026现金 / 无发票 / 金普金 三个 sheet) ----------

class BillColumns:
    DATE = "日期"
    SUMMARY = "摘要"
    DEBIT = "借方"
    CREDIT = "贷方"
    BALANCE = "余额"
    REMARK = "备注"

    ORDER: Final[tuple[str, ...]] = (DATE, SUMMARY, DEBIT, CREDIT, BALANCE, REMARK)

    CASH_SHEET: Final[tuple[str, ...]] = (DATE, SUMMARY, DEBIT, CREDIT, BALANCE, REMARK)
    NO_INVOICE_SHEET: Final[tuple[str, ...]] = (DATE, "项目", "", "支出", "结余", REMARK)
    JINPUJIN_SHEET: Final[tuple[str, ...]] = ("名称", "单位", "数量", "单价", "含税总价", REMARK)


# ---------- 报销分类 (吉众记账写入用, SKILL.md 已确认, 2026-06-28) ----------

class RRCategory:
    CASH = "2026现金"
    NO_INVOICE = "无发票支出-普通采购"
    JINPUJIN = "金普金明细"

    ALL: Final[tuple[str, ...]] = (CASH, NO_INVOICE, JINPUJIN)


# ---------- v1.7.5: 混合账单分类 (按 PE.paid_from 实际值 + 未付款兜底) ----------

class RRBillCategory:
    """混合账单分类 (第七铁律 2026-06-28).

    优先级:
      1. 未付款账单 (P0 兜底): 不管 PI 发票类型, 只要 paid_amount < total_amount
      2. 按 PE.paid_from 实际账户 (sheet 名动态): 包含无发票/普通/专用发票的所有 RR

    PI.custom_发票类型 不是分类维度, 只是 PI 元数据.
    详见 references/rr-mixed-bill-classification-iron-rule.md.

    Sheet 名 = bucket 名 + 公司简称后缀 (未付款账单) 或 PE.paid_from 实际值 (其他).
    """

    UNPAID = "未付款账单"  # P0 兜底 (所有未付 RR, 不论 PI 发票类型)


# ---------- ERPNext 字段名 (API 契约, 与 RR 字段定义一一对应) ----------

class ERPNextFields:
    RR_NAME = "name"
    POSTING_DATE = "posting_date"
    COMPANY = "company"
    DOCSTATUS = "docstatus"
    TITLE = "title"
    TOTAL_AMOUNT = "total_amount"
    PAID_AMOUNT = "paid_amount"
    CUSTOM_BIZ_MODE = "custom_biz_mode"

    # RR.invoice_items 子表字段
    INV_ITEM_NAME = "item_name"
    INV_ITEM_CODE = "item_code"
    INV_QTY = "qty"
    INV_RATE = "rate"
    INV_AMOUNT = "amount"
    INV_UOM = "uom"
    INV_INVOICE_NO = "invoice_no"
    INV_SOURCE_PI = "source_pi"
    INV_SUPPLIER = "supplier"
    INV_GUIGE = "custom_guige_xinghao"
    INV_REMARK = "custom_备注"

    # Payment Entry 字段
    PE_REFERENCE_NO = "reference_no"
    PE_PAYMENT_TYPE = "payment_type"
    PE_MODE_OF_PAYMENT = "mode_of_payment"
    PE_PAID_FROM = "paid_from"
    PE_PAID_TO = "paid_to"
    PE_PAID_FROM_TYPE = "paid_from_account_type"
    PE_PAID_TO_TYPE = "paid_to_account_type"
    PE_PAID_AMOUNT = "paid_amount"
    PE_PARTY = "party"
    PE_PARTY_NAME = "party_name"

    # Purchase Invoice 字段
    PI_BILL_NO = "bill_no"
    PI_SUPPLIER = "supplier"
    PI_INVOICE_TYPE = "custom_发票类型"


# ---------- 公司简称 (与旧脚本一致) ----------

COMPANY_SHORT_NAMES: Final[dict[str, str]] = {
    "天津祺富机械加工有限公司": "祺富",
    "天津吉众科技有限公司": "吉众",
}


def company_short(company_name: str) -> str:
    return COMPANY_SHORT_NAMES.get(company_name, company_name)

# ---------- 通用工具 (无副作用, 纯函数) ----------

def to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def clean_text(value: Any) -> str:
    if value in (None, ""):
        return ""
    return str(value).strip()


def unique_join(values: list[str], separator: str = "；") -> str:
    seen: list[str] = []
    for value in values:
        item = str(value).strip()
        if not item or item == "-":
            continue
        if item not in seen:
            seen.append(item)
    return separator.join(seen)


def cn_date(date_text: str) -> str:
    return datetime.strptime(date_text, "%Y-%m-%d").strftime("%Y年%m月%d日")


def now_text(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def elapsed_text(seconds: float) -> str:
    total = int(round(seconds))
    hours, rem = divmod(total, 3600)
    minutes, secs = divmod(rem, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def sanitize_sheet_name(name: str) -> str:
    cleaned = "".join("-" if ch in '[]:*?/\\' else ch for ch in name).strip().strip("'")
    if not cleaned:
        cleaned = "报销明细"
    return cleaned[:31]


def unique_sheet_name(base: str, used: set[str]) -> str:
    candidate = sanitize_sheet_name(base)
    original = candidate
    suffix_index = 2
    while candidate in used:
        suffix = f"-{suffix_index}"
        candidate = f"{original[: 31 - len(suffix)]}{suffix}"
        suffix_index += 1
    used.add(candidate)
    return candidate


def compute_item_amount(item: dict[str, Any]) -> float:
    """RR.invoice_items 单行金额: 优先 amount 字段, 否则 qty*rate"""
    amount = item.get("amount")
    if amount not in (None, ""):
        return round(to_float(amount), 2)
    return round(to_float(item.get("qty")) * to_float(item.get("rate")), 2)


# ---------- REST API 客户端 (低层, 无业务语义) ----------

def api_get_list(
    doctype: str,
    *,
    fields: list[str],
    filters: list[list[Any]] | None = None,
    order_by: str | None = None,
    limit_start: int = 0,
    limit_page_length: int = 200,  # Frappe 分页陷阱, 默认 200
) -> list[dict[str, Any]]:
    params: dict[str, str] = {
        "fields": json.dumps(fields, ensure_ascii=False, separators=(",", ":")),
        "limit_start": str(limit_start),
        "limit_page_length": str(limit_page_length),
    }
    if filters is not None:
        params["filters"] = json.dumps(filters, ensure_ascii=False, separators=(",", ":"))
    if order_by:
        params["order_by"] = order_by

    url = f"{BASE_URL}/api/resource/{quote(doctype, safe='')}"
    resp = requests.get(url, params=params, headers=HEADERS, timeout=60)
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data", [])
    return data if isinstance(data, list) else []


def api_get_doc(doctype: str, name: str) -> dict[str, Any] | None:
    url = f"{BASE_URL}/api/resource/{quote(doctype, safe='')}/{quote(name, safe='')}"
    resp = requests.get(url, headers=HEADERS, timeout=60)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    payload = resp.json()
    data = payload.get("data")
    return data if isinstance(data, dict) else None


def api_get_list_paginated(
    doctype: str,
    *,
    fields: list[str],
    filters: list[list[Any]] | None = None,
    order_by: str | None = None,
    page_size: int = 200,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    start = 0
    while True:
        chunk = api_get_list(
            doctype,
            fields=fields,
            filters=filters,
            order_by=order_by,
            limit_start=start,
            limit_page_length=page_size,
        )
        rows.extend(chunk)
        if len(chunk) < page_size:
            break
        start += page_size
    return rows


# ---------- 报销相关高层拉取 ----------

RR_LIST_FIELDS: list[str] = ["name", "posting_date", "company", "docstatus"]

# PE 字段列表 (v1.7.2: 去掉 amount 字段, 该字段查询时触发 ERPNext HTTP 417 DataError)
PE_LIST_FIELDS: list[str] = [
    "name",
    "posting_date",
    "payment_type",
    "mode_of_payment",
    "party_type",
    "party",
    "party_name",
    "paid_from",
    "paid_from_account_type",
    "paid_to",
    "paid_to_account_type",
    "paid_amount",  # 重要: PE 主表的实付金额 (不是子表)
    "reference_no",
    "reference_date",
]


def fetch_payment_entries(reference_no: str, company: str) -> list[dict[str, Any]]:
    """拉取关联到某 RR 的所有 Payment Entry (docstatus=1)

    第四铁律 (2026-06-28): PE.reference_no 经常是发票号不是 RR 名, 此函数可能查不到,
    不要用此函数判定 RR 是否已付款 (用 summarize_payment_status_from_rr).
    """
    filters: list[list[Any]] = [
        ["reference_no", "=", reference_no],
        ["company", "=", company],
        ["docstatus", "=", 1],
    ]
    return api_get_list_paginated(
        "Payment Entry",
        fields=PE_LIST_FIELDS,
        filters=filters,
        order_by="posting_date asc,name asc",
    )


def fetch_payment_entries_for_company(company: str) -> list[dict[str, Any]]:
    """v1.7.2: 按公司全量拉 Payment Entry, Python 端按 posting_date 过滤.

    为什么不用 posting_date filter: ERPNext 15 的 posting_date 字段在
    Payment Entry 上没有 query index, 直接 filter 触发 HTTP 417 DataError.
    全量拉后再 Python 端 filter 是稳妥的方案.

    实测性能: 吉众 4-5 月 65 PE 全量拉 0.5 秒, 接受.
    """
    filters: list[list[Any]] = [
        ["company", "=", company],
        ["docstatus", "=", 1],
    ]
    return api_get_list_paginated(
        "Payment Entry",
        fields=PE_LIST_FIELDS,
        filters=filters,
        order_by="posting_date asc,name asc",
    )


def fetch_reimbursement_requests(
    company: str, from_date: str, to_date: str
) -> list[dict[str, Any]]:
    """拉取指定公司在日期范围内的所有 Reimbursement Request (docstatus=1, 已提交)"""
    filters: list[list[Any]] = [
        ["company", "=", company],
        ["posting_date", "between", [from_date, to_date]],
        ["docstatus", "=", 1],
    ]
    return api_get_list_paginated(
        "Reimbursement Request",
        fields=RR_LIST_FIELDS,
        filters=filters,
        order_by="posting_date asc,name asc",
    )


def fetch_payment_entries(reference_no: str, company: str) -> list[dict[str, Any]]:
    """拉取关联到某 RR 的所有 Payment Entry (docstatus=1)"""
    filters: list[list[Any]] = [
        ["reference_no", "=", reference_no],
        ["company", "=", company],
        ["docstatus", "=", 1],
    ]
    return api_get_list_paginated(
        "Payment Entry",
        fields=PE_LIST_FIELDS,
        filters=filters,
        order_by="posting_date asc,name asc",
    )


# ---------- Purchase Invoice 缓存 ----------

PI_DOC_CACHE: dict[str, dict[str, Any]] = {}
PE_DOC_CACHE: dict[str, dict[str, Any]] = {}


def get_purchase_invoice(name: str | None) -> dict[str, Any] | None:
    key = clean_text(name)
    if not key:
        return None
    if key not in PI_DOC_CACHE:
        PI_DOC_CACHE[key] = api_get_doc("Purchase Invoice", key) or {}
    return PI_DOC_CACHE[key] or None


def get_payment_entry(name: str | None) -> dict[str, Any] | None:
    """按 name 拉取 Payment Entry 完整 doc，并做本地缓存."""
    key = clean_text(name)
    if not key:
        return None
    if key not in PE_DOC_CACHE:
        PE_DOC_CACHE[key] = api_get_doc("Payment Entry", key) or {}
    return PE_DOC_CACHE[key] or None


# ---------- v1.7.2: PE → RR 关联辅助 (按 reference_no 多种方式匹配) ----------

def find_payment_entries_for_rr(
    rr_name: str,
    all_company_pes: list[dict[str, Any]],
    rr_invoice_items: list[dict[str, Any]] | None = None,
    period_from: str | None = None,
    period_to: str | None = None,
) -> list[dict[str, Any]]:
    """在已全量拉的公司 PE 中找出关联到某 RR 的所有 PE.

    关联方式 (任一命中即认为关联):
    1. PE.reference_no == rr_name  (最常见, 但不是所有 PE 都这么填)
    2. PE.reference_no == PI.bill_no / PI.name (不同录入方式, 都见过)
    3. PE.references[].reference_name == rr_name / PI.name / PI.bill_no (PE 子表, 需全量拉 PE doc)

    v1.7.3+ fix (避免误匹配):
    - PE.reference_no 不能是 '0' / '' / None (空值匹配任何 invoice_no="0" 的 PI)
    - PE.posting_date 必须在 period_from/period_to 范围内 (跨期 PE 排除)
    - PI.invoice_no 不能是 '0' / '' (无意义短码也不参与匹配)
    - 若 reference_no 直接命中失败, 退回检查 PE.references 子表 (缓存 full doc)
    """
    matched: list[dict[str, Any]] = []
    # 收集 RR 关联的所有 PI 相关标识 (排除空值)
    related_bill_nos: set[str] = set()
    related_pi_names: set[str] = set()
    if rr_invoice_items:
        for it in rr_invoice_items:
            pi_name = clean_text(it.get("source_pi"))
            if pi_name:
                related_pi_names.add(pi_name)
            inv_no = clean_text(it.get("invoice_no"))
            if inv_no and inv_no not in ("0", "000"):
                related_bill_nos.add(inv_no)
        # 也从 PI cache 取 bill_no (更稳)
        for it in rr_invoice_items:
            pi = get_purchase_invoice(it.get("source_pi"))
            if pi:
                bill_no = clean_text(pi.get("bill_no"))
                if bill_no and bill_no not in ("0", "000"):
                    related_bill_nos.add(bill_no)

    target_names = {rr_name, *related_bill_nos, *related_pi_names}

    for pe in all_company_pes:
        # v1.7.2 fix: 跨期 PE 排除 (例如 1 月 PE 不能匹配到 4-5 月 RR)
        if period_from or period_to:
            pe_date = pe.get("posting_date") or ""
            if period_from and pe_date < period_from:
                continue
            if period_to and pe_date > period_to:
                continue

        ref_no = clean_text(pe.get("reference_no"))
        # 先走轻量字段直接匹配: RR 名 或 PI bill_no
        if ref_no and ref_no not in ("0", "000"):
            if ref_no in target_names:
                matched.append(pe)
                continue

        # 轻量字段没命中时, 再退回 full doc 的 references 子表
        pe_doc = get_payment_entry(pe.get("name"))
        if not pe_doc:
            continue
        for ref in pe_doc.get("references", []) or []:
            ref_name = clean_text(ref.get("reference_name"))
            if ref_name and ref_name in target_names:
                matched.append(pe)
                break

    return matched


def payment_account_from_pe(pe: dict[str, Any]) -> str:
    """v1.7.2: PE 实际使用的付款/收款账户名 (PE.paid_from 或 paid_to)."""
    payment_type = clean_text(pe.get("payment_type"))
    if payment_type == "Receive":
        return clean_text(pe.get("paid_to"))
    return clean_text(pe.get("paid_from"))


# ---------- v1.7.5: 混合账单分类器 (第七铁律 - 按 PE 实际账户 + 未付款兜底) ----------

@dataclass
class ClassificationResult:
    """单张 RR 分类结果 + 拆分明细 (部分付款时一行同时进多桶)."""
    bucket_name: str  # 主分类 bucket (Sheet 名, 含公司简称后缀)
    bucket_reason: str  # 分类原因 (用于日志/调试)
    payment_breakdown: list[tuple[str, float]] = field(default_factory=list)
    # payment_breakdown: [(bucket_name, 已付金额), ...] 用于备注列 (合计X, xA, xB, x未支付)


def classify_rr_for_mixed_report(
    rr_doc: dict[str, Any],
    rr_payment_entries: list[dict[str, Any]],
    company_short: str,
) -> ClassificationResult:
    """v1.7.5: 混合账单分类器 (第七铁律).

    优先级:
      P0 未付款账单: RR.paid_amount < RR.total_amount (含完全未付 + 部分付款)
        - 不管 PI 发票类型, 无发票/普通/专用发票都按这条判定
      P1 按 PE.paid_from 实际账户: 1 张 RR 可能进多个 bucket (按 PE 金额比例分摊)
        - PI.custom_发票类型 不是分类维度, 只在 bucket_reason 里记录

    Args:
        rr_doc: api_get_doc('Reimbursement Request', name) 完整 doc
        rr_payment_entries: 这张 RR 关联的所有 PE (由 find_payment_entries_for_rr 算出)
        company_short: 公司简称 (例 "吉众" / "祺富"), 用于 P0 sheet 名后缀

    Returns:
        ClassificationResult: bucket_name + bucket_reason + payment_breakdown
    """

    rr_total = round(to_float(rr_doc.get("total_amount")), 2)
    rr_paid = round(to_float(rr_doc.get("paid_amount")), 2)

    # === P0 未付款账单 (优先级最高) ===
    # 不管 PI 发票类型, 只要 paid_amount < total_amount 就进 P0
    # 已付部分按 PE.paid_from 进对应 bucket, 未付部分进 P0
    if rr_paid < rr_total:
        unpaid_amount = round(rr_total - rr_paid, 2)
        return ClassificationResult(
            bucket_name=f"{RRBillCategory.UNPAID} - {company_short}",
            bucket_reason=f"RR.paid_amount={rr_paid} < total_amount={rr_total}, 未付 {unpaid_amount}",
            payment_breakdown=[],  # 由 caller 填实际 PE 分桶明细
        )

    # === P1 按 PE.paid_from 实际账户 ===
    # 包含无发票/普通/专用发票的所有 RR — 全部按 PE 真实付款账户分桶
    if rr_payment_entries:
        # 按 paid_from 实际账户名聚合金额
        bucket_amounts: dict[str, float] = {}
        for pe in rr_payment_entries:
            acct = payment_account_from_pe(pe)
            if not acct:
                continue
            amount = round(to_float(pe.get("paid_amount")), 2)
            bucket_amounts[acct] = round(bucket_amounts.get(acct, 0.0) + amount, 2)
        if bucket_amounts:
            # 主 bucket = 金额最大的 (PE.paid_from 已带" - 吉众/祺富"后缀, 直接用)
            main_bucket = max(bucket_amounts.items(), key=lambda x: x[1])[0]
            breakdown = [(b, a) for b, a in bucket_amounts.items()]
            # 记录 PI 发票类型分布 (供调试)
            pi_types = _collect_pi_invoice_types(rr_doc)
            return ClassificationResult(
                bucket_name=main_bucket,  # v1.7.2 fix: 不再加后缀 (PE.paid_from 已含)
                bucket_reason=f"PE.paid_from: {dict(bucket_amounts)}, PI发票类型: {pi_types}",
                payment_breakdown=breakdown,
            )

    # 兜底: 没有 PE 也没有未付 (理论上不会到这里, P0 已覆盖未付)
    return ClassificationResult(
        bucket_name=f"{RRBillCategory.UNPAID} - {company_short}",
        bucket_reason="兜底: 无 PE 且 paid=total, 归未付款 (异常情况)",
        payment_breakdown=[],
    )


def _collect_pi_invoice_types(rr_doc: dict[str, Any]) -> list[str]:
    """v1.7.5: 收集 RR 所有 PI 的 custom_发票类型 (供分类日志, 不影响 bucket)."""
    types: set[str] = set()
    for item in rr_doc.get("invoice_items") or []:
        pi = get_purchase_invoice(item.get("source_pi"))
        if pi:
            t = (pi.get("custom_发票类型") or "").strip()
            if t:
                types.add(t)
    return sorted(types)


# ---------- Payment Entry 字段语义解析 ----------

def payment_bucket_from_entry(entry: dict[str, Any]) -> str:
    """PE 所属的"账户大类": 现金 / 银行 / 其他"""
    payment_type = clean_text(entry.get("payment_type"))
    if payment_type == "Receive":
        account_type = clean_text(entry.get("paid_to_account_type"))
        account_name = clean_text(entry.get("paid_to"))
    else:
        account_type = clean_text(entry.get("paid_from_account_type"))
        account_name = clean_text(entry.get("paid_from"))

    if account_type == "Cash" or "现金" in account_name:
        return "现金"
    if account_type == "Bank" or "银行" in account_name:
        return "银行"
    if account_name:
        return account_name
    return "其他"


def payment_account_from_entry(entry: dict[str, Any]) -> str:
    """PE 实际使用的付款/收款账户名"""
    payment_type = clean_text(entry.get("payment_type"))
    if payment_type == "Receive":
        return clean_text(entry.get("paid_to"))
    return clean_text(entry.get("paid_from"))


def payment_direction_from_entry(entry: dict[str, Any]) -> str:
    """PE 方向（stage1 信号）: 支出 / 收入 / 转账"""
    payment_type = clean_text(entry.get("payment_type"))
    mapping = {"Pay": "支出", "Receive": "收入", "Internal Transfer": "转账"}
    return mapping.get(payment_type, payment_type or "-")


# ---------- ERPNext payment_status 字段语义 ----------
# 实际存进数据库的是英文 (Paid / Unpaid / Partially Paid), 不是 Python 常量里的中文
# (Python 端 ashan_cn_procurement.utils.reimbursement 定义的是中文字面量, 但 ERPNext
#  标准字段在保存时会被翻译成英文). 我们用这一组常量做 mapping.

RR_PAYMENT_STATUS_PAID = "Paid"
RR_PAYMENT_STATUS_UNPAID = "Unpaid"
RR_PAYMENT_STATUS_PARTIAL = "Partially Paid"

# 报销分桶的中文显示名 (写进 xlsx 的"当前账户名"列)
PAYMENT_BUCKET_PAID = "已付清"
PAYMENT_BUCKET_PARTIAL = "部分付款"
PAYMENT_BUCKET_UNPAID = "未付款"


def summarize_payment_status_from_rr(
    rr_doc: dict[str, Any],
    payment_entries: list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    """直接从 RR 自带的 payment_status 字段聚合付款信息, 不依赖 PE.

    第四铁律 (2026-06-28): 不要用 fetch_payment_entries(reference_no=RR名) 来判定
    RR 是否已付款, 因为 PE.reference_no 可能是发票号而不是 RR 名, 查不到会误判.

    Args:
        rr_doc: api_get_doc('Reimbursement Request', rr_name) 的结果
        payment_entries: 兼容参数, 已废弃 (传 [] 也行). 保留是为了不让 caller 报错.

    Returns:
        dict[str, str]: {
            "付款方式":   "已付清" / "部分付款" / "未付款",
            "付款账户":   "已付清" / "部分付款" / "未付款",
            "借贷方向":   "stage1 信号: 对应入账方向/付款方向; 下游记账账单 stage2 仍需按该方向写 C/D 列, 不能默认借方=0",
            "对方":      invoice_items 中所有 supplier 的去重拼接 (；分隔),
            "payment_status": 原始英文值 "Paid" / "Unpaid" / "Partially Paid",
        }
    """
    raw_status = clean_text(rr_doc.get("payment_status")) or RR_PAYMENT_STATUS_UNPAID

    if raw_status == RR_PAYMENT_STATUS_PAID:
        bucket = PAYMENT_BUCKET_PAID
        direction = "支出"
    elif raw_status == RR_PAYMENT_STATUS_PARTIAL:
        bucket = PAYMENT_BUCKET_PARTIAL
        direction = "支出"
    else:
        bucket = PAYMENT_BUCKET_UNPAID
        direction = "支出" if to_float(rr_doc.get("total_amount")) > 0 else "-"

    # 对方: invoice_items 中所有 supplier 去重拼接
    parties: list[str] = []
    for item in rr_doc.get("invoice_items") or []:
        sup = clean_text(item.get("supplier"))
        if sup and sup not in parties:
            parties.append(sup)

    return {
        "付款方式": bucket,
        "付款账户": bucket,
        "借贷方向": direction,
        "对方": unique_join(parties) or "-",
        "payment_status": raw_status,
    }


def summarize_payment_entries(
    entries: list[dict[str, Any]], rr_total_amount: float
) -> dict[str, str]:
    """聚合一组 PE: 付款方式 / 付款账户 / 借贷方向 / 对方 (用 ； 分隔去重).

    注意: 混合账单脚本从 v1.7.1 起不再使用本函数 (改用 summarize_payment_status_from_rr).
    本函数保留给其他可能用到 PE 聚合的脚本 (如 generate.py 等).
    """
    modes = [clean_text(entry.get("mode_of_payment")) for entry in entries]
    accounts = [payment_account_from_entry(entry) for entry in entries]
    directions = [payment_direction_from_entry(entry) for entry in entries]
    parties = [
        clean_text(entry.get("party_name") or entry.get("party"))
        for entry in entries
    ]

    if not directions:
        directions = ["支出" if rr_total_amount > 0 else "-"]

    if entries:
        payment_mode = unique_join(modes) or "-"
        payment_account = unique_join(accounts) or "-"
        payment_party = unique_join(parties) or "-"
    else:
        # SKILL.md 明确: 没有 PE 时标记"未付款", 不要回退成 "-"
        payment_mode = "未付款"
        payment_account = "未付款"
        payment_party = "-"

    return {
        "付款方式": payment_mode,
        "付款账户": payment_account,
        "借贷方向": unique_join(directions) or "-",
        "对方": payment_party,
    }


# 字段契约 (单点真源来自 MixedColumns)
RR_LIST_FIELDS = ['name', 'posting_date', 'company', 'docstatus']
PE_LIST_FIELDS = [
    'name',
    'posting_date',
    'payment_type',
    'mode_of_payment',
    'party_type',
    'party',
    'party_name',
    'paid_from',
    'paid_from_account_type',
    'paid_to',
    'paid_to_account_type',
    'paid_amount',
    'reference_no',
]
COLUMNS = list(MixedColumns.ORDER)  # 17 列顺序来自契约
MERGE_COLUMNS = set(MixedColumns.MERGE)
WRAP_COLUMNS = set(MixedColumns.WRAP)
TEXT_COLUMNS = set(MixedColumns.TEXT)


@dataclass(frozen=True)
class Scope:
    company: str
    sheet: str
    raw: str = ''


# ---------- argparse helper (仅混合账单脚本用, 不抽到共享模块) ----------


def parse_scope_spec(spec: str) -> Scope:
    parts = [part.strip() for part in spec.split('|')]
    parts = [part for part in parts if part]
    if len(parts) == 1:
        company = parts[0]
        sheet = sanitize_sheet_name(company)
    elif len(parts) == 2:
        company, sheet = parts
    else:
        raise argparse.ArgumentTypeError('scope 格式必须是 公司名 或 公司名|sheet名')
    return Scope(company=company, sheet=sheet, raw=spec)


def normalize_granularity(value: str) -> str:
    normalized = value.strip().lower()
    mapping = {
        'item': 'item',
        '明细': 'item',
        'detail': 'item',
        'voucher': 'voucher',
        '账单': 'voucher',
        '凭证': 'voucher',
        'summary': 'voucher',
        '汇总': 'voucher',
    }
    if normalized in mapping:
        return mapping[normalized]
    if value in mapping:
        return mapping[value]
    raise argparse.ArgumentTypeError('granularity 只能是 item / voucher / 明细 / 汇总')


def normalize_direction(value: str) -> str:
    normalized = value.strip().lower()
    mapping = {
        'all': 'all',
        '全部': 'all',
        '支出': '支出',
        'credit': '支出',
        'out': '支出',
        '收入': '收入',
        'debit': '收入',
        'in': '收入',
    }
    if normalized in mapping:
        return mapping[normalized]
    if value in mapping:
        return mapping[value]
    raise argparse.ArgumentTypeError('direction 只能是 all / 支出 / 收入')


@dataclass
class GroupResult:
    rr_name: str
    rr_date: str
    title: str
    row_count: int
    total_amount: float
    paid_amount: float
    payment_status: str  # v1.7.1: RR.payment_status 原始值 (Paid/Unpaid/Partially Paid)
    payment_modes: str
    payment_buckets: str
    payment_accounts: str
    direction: str
    bucket_name: str = ''  # v1.7.2: 主分类 bucket (Sheet 名)
    payment_breakdown: list[tuple[str, float]] = field(default_factory=list)
    # v1.7.2: 拆分明细 [(bucket, amount), ...] 用于备注列 (合计X, xA, xB, x未支付)


@dataclass
class ScopeResult:
    scope: Scope
    payment_account: str
    rr_count: int
    row_count: int
    rr_total: float
    paid_total: float
    paid_count: int  # v1.7.1: 本桶内 payment_status=Paid 的 RR 数 (替代 payment_entry_count)
    groups: list[GroupResult] = field(default_factory=list)


def build_payment_breakdown_remark(
    rr_total: float,
    rr_paid: float,
    payment_breakdown: list[tuple[str, float]],
) -> str:
    """v1.7.3: 生成付款备注列格式: 合计X金额，x现金账单-孟祥山，x银行账单，x未支付.

    payment_breakdown 是 [(bucket_name, 已付金额), ...], 不含未付部分.
    未付部分 = rr_total - sum(breakdown amounts).

    v1.7.3 fix: 移除首尾括弧 (用户要求"删除括弧").

    v1.7.2 fix: 用户要求"如果是现金类型, 写具体账单", 所以保留完整 bucket 名
    (例 "现金账单-孟祥山 - 祺富") 不再只写 "现金".
    """
    parts: list[str] = []
    paid_so_far = 0.0
    for bucket, amt in payment_breakdown:
        # v1.7.2 fix: 用户拍板 "如果是现金类型, 比如写具体账单"
        # bucket 名直接用 PE.paid_from 实际值, 已含具体账单名
        parts.append(f"{bucket}{amt:.2f}")
        paid_so_far += amt
    unpaid = round(rr_total - paid_so_far, 2)
    if unpaid > 0:
        parts.append(f"未支付{unpaid:.2f}")
    if not parts:
        return ""
    return f"合计{rr_total:.2f}，{','.join(parts)}"


def build_rows_for_rr(
    rr: dict[str, Any],
    granularity: str,
    direction_filter: str,
    classification: ClassificationResult | None = None,
) -> tuple[list[dict[str, Any]], GroupResult] | None:
    """v1.7.2: 接收 classification (5 桶分类结果), 备注列追加拆分格式.

    classification 由 main() 在拉完 PE 后调用 classify_rr_for_mixed_report 算出.
    """
    rr_doc = api_get_doc('Reimbursement Request', rr['name'])
    if not rr_doc:
        return None

    rr_name = clean_text(rr_doc.get('name')) or clean_text(rr['name'])
    rr_date = clean_text(rr_doc.get('posting_date')) or clean_text(rr.get('posting_date'))
    title = clean_text(rr_doc.get('title')) or rr_name
    rr_total_amount = round(to_float(rr_doc.get('total_amount')) or sum(compute_item_amount(item) for item in rr_doc.get('invoice_items') or []), 2)
    paid_amount = round(to_float(rr_doc.get('paid_amount')), 2)

    payment_summary = summarize_payment_status_from_rr(rr_doc)
    rr_direction = payment_summary['借贷方向']
    # stage1 输出：把入账方向带给下游记账账单，供 stage2 决定 C/D 列，不要在这里简化成固定借方/贷方。
    if rr_direction == '-' and rr_total_amount > 0:
        rr_direction = '支出'

    if direction_filter != 'all':
        if direction_filter not in rr_direction.split('；'):
            return None

    invoice_items = rr_doc.get('invoice_items') or []
    rows: list[dict[str, Any]] = []

    # v1.7.3: 付款备注走独立列, 不再 merge 到备注列
    payment_remark = ""
    if classification:
        payment_remark = build_payment_breakdown_remark(
            rr_total=rr_total_amount,
            rr_paid=paid_amount,
            payment_breakdown=classification.payment_breakdown,
        )

    if granularity == 'voucher':
        item_names: list[str] = []
        specs: list[str] = []
        rates: list[str] = []
        qtys: list[str] = []
        uoms: list[str] = []
        bill_nos: list[str] = []
        suppliers: list[str] = []
        allocated_total = 0.0
        for item in invoice_items:
            pi_doc = get_purchase_invoice(item.get('source_pi'))
            supplier = clean_text(item.get('supplier')) or clean_text((pi_doc or {}).get('supplier'))
            if not supplier:
                supplier = payment_summary['对方']
            bill_no = clean_text(item.get('invoice_no')) or clean_text((pi_doc or {}).get('bill_no')) or clean_text((pi_doc or {}).get('name')) or clean_text(item.get('source_pi'))
            item_names.append(clean_text(item.get('item_name')) or clean_text(item.get('item_code')) or '-')
            specs.append(clean_text(item.get('custom_guige_xinghao')) or '-')
            rates.append(f"{to_float(item.get('rate')):.4f}")
            qtys.append(f"{to_float(item.get('qty')):.3f}")
            uoms.append(clean_text(item.get('uom')) or '-')
            bill_nos.append(bill_no or '-')
            suppliers.append(supplier or '-')
            allocated_total += compute_item_amount(item)

        row_dict: dict[str, Any] = {
            '报销凭证号': rr_name,
            '报销日期': rr_date,
            '报销标题': title,
            '报销金额': rr_total_amount,
            '发票号码': unique_join(bill_nos),
            '发票类型': '',
            '供应商': unique_join(suppliers) or payment_summary['对方'] or '-',
            '付款方式': payment_summary['付款方式'],
            '项目名(物料名)': unique_join(item_names),
            '规格型号': unique_join(specs),
            '单价': 0,
            '数量': 0,
            '单位': unique_join(uoms),
            '分配金额': round(allocated_total if allocated_total > 0 else rr_total_amount, 2),
            '备注': clean_text(item.get('custom_备注')) or '',
            '借贷方向': rr_direction,
            '付款备注': payment_remark,  # v1.7.3: 独立列
        }
        if not invoice_items:
            row_dict['发票号码'] = '-'
            row_dict['发票类型'] = ''
            row_dict['供应商'] = payment_summary['对方']
            row_dict['项目名(物料名)'] = '-'
            row_dict['规格型号'] = '-'
            row_dict['单位'] = '-'
            row_dict['分配金额'] = rr_total_amount
        rows.append(row_dict)
    else:
        for item in invoice_items:
            pi_doc = get_purchase_invoice(item.get('source_pi'))
            supplier = clean_text(item.get('supplier')) or clean_text((pi_doc or {}).get('supplier'))
            if not supplier:
                supplier = payment_summary['对方']
            bill_no = clean_text(item.get('invoice_no')) or clean_text((pi_doc or {}).get('bill_no')) or clean_text((pi_doc or {}).get('name')) or clean_text(item.get('source_pi'))
            invoice_type = clean_text((pi_doc or {}).get('custom_发票类型')) or ''
            amount = compute_item_amount(item)
            rows.append({
                '报销凭证号': rr_name,
                '报销日期': rr_date,
                '报销标题': title,
                '报销金额': rr_total_amount,
                '发票号码': bill_no or '-',
                '发票类型': invoice_type,
                '供应商': supplier or '-',
                '付款方式': payment_summary['付款方式'],
                '项目名(物料名)': clean_text(item.get('item_name')) or clean_text(item.get('item_code')) or '-',
                '规格型号': clean_text(item.get('custom_guige_xinghao')) or '-',
                '单价': to_float(item.get('rate')),
                '数量': to_float(item.get('qty')),
                '单位': clean_text(item.get('uom')) or '-',
                '分配金额': amount,
                '备注': clean_text(item.get('custom_备注')) or '',
                '借贷方向': rr_direction,
                '付款备注': payment_remark,  # v1.7.3: 独立列
            })
        if not invoice_items:
            rows.append({
                '报销凭证号': rr_name,
                '报销日期': rr_date,
                '报销标题': title,
                '报销金额': rr_total_amount,
                '发票号码': '-',
                '发票类型': '',
                '供应商': payment_summary['对方'] or '-',
                '付款方式': payment_summary['付款方式'],
                '项目名(物料名)': '-',
                '规格型号': '-',
                '单价': 0,
                '数量': 0,
                '单位': '-',
                '分配金额': rr_total_amount,
                '备注': '',
                '借贷方向': rr_direction,
                '付款备注': payment_remark,  # v1.7.3: 独立列
            })

    group = GroupResult(
        rr_name=rr_name,
        rr_date=rr_date,
        title=title,
        row_count=len(rows),
        total_amount=rr_total_amount,
        paid_amount=paid_amount,
        payment_status=payment_summary['payment_status'],  # v1.7.1
        payment_modes=payment_summary['付款方式'],
        payment_buckets='',
        payment_accounts=payment_summary['付款账户'],
        direction=rr_direction,
        bucket_name=classification.bucket_name if classification else '',  # v1.7.2
        payment_breakdown=classification.payment_breakdown if classification else [],  # v1.7.2
    )
    return rows, group


def build_sheet(ws, company: str, payment_account: str, rows_and_groups: list[tuple[list[dict[str, Any]], GroupResult]], from_date: str, to_date: str, granularity: str, direction_filter: str) -> tuple[float, float, int]:
    title_fill = PatternFill('solid', fgColor='1F4E79')
    header_fill = PatternFill('solid', fgColor='D9E2F3')
    alt_fill = PatternFill('solid', fgColor='F7FBFF')
    total_fill = PatternFill('solid', fgColor='E2F0D9')
    title_font = Font(bold=True, color='FFFFFF', size=13)
    header_font = Font(bold=True, color='000000', size=11)
    bold_font = Font(bold=True, color='000000')
    thin = Side('thin', color='808080')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.sheet_view.showGridLines = False
    ws.freeze_panes = 'A4'

    ws.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(COLUMNS))
    ws['A1'] = f'报销申请混合单据明细：{company}  当前账户名：{payment_account}'
    ws['A1'].font = title_font
    ws['A1'].fill = title_fill
    ws['A1'].alignment = Alignment(horizontal='center', vertical='center')

    ws.merge_cells(start_row=2, start_column=1, end_row=2, end_column=len(COLUMNS))
    ws['A2'] = f'日期范围{cn_date(from_date)}  至  {cn_date(to_date)}  当前账户名：{payment_account}'
    ws['A2'].alignment = Alignment(horizontal='center', vertical='center')

    for col_idx, col_name in enumerate(COLUMNS, 1):
        cell = ws.cell(row=3, column=col_idx, value=col_name)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = border
        cell.alignment = Alignment(horizontal='center', vertical='center')

    current_row = 4
    total_amount = 0.0
    paid_total = 0.0
    total_payment_entries = 0

    for group_rows, group in rows_and_groups:
        if not group_rows:
            continue
        start_row = current_row
        for row_offset, row in enumerate(group_rows):
            excel_row = current_row + row_offset
            fill = alt_fill if (excel_row - 4) % 2 == 1 else None
            for col_idx, col_name in enumerate(COLUMNS, 1):
                value = row.get(col_name, '')
                cell = ws.cell(row=excel_row, column=col_idx, value=value)
                cell.border = border
                if fill:
                    cell.fill = fill
                # alignment — 所有字段 shrink_to_fit
                # 注意: openpyxl xlsx XML 中 shrink_to_fit 和 wrap_text 互斥, 同时设会以 wrap 为准
                if col_name == '报销凭证号':
                    # 用户偏好: 报销凭证号较长 (BX-2026-XX-XXXXX) 但不太长, 只 shrink 不 wrap
                    cell.alignment = Alignment(horizontal='center', vertical='center', shrink_to_fit=True)
                elif col_name in WRAP_COLUMNS:
                    # 其他 WRAP 列保持原状: wrap_text + shrink_to_fit (用户已认可)
                    if col_name in ('报销日期', '报销标题', '付款方式'):
                        cell.alignment = Alignment(horizontal='center', vertical='center', wrap_text=True, shrink_to_fit=True)
                    elif col_name == '报销金额':
                        cell.alignment = Alignment(horizontal='right', vertical='center', wrap_text=True, shrink_to_fit=True)
                elif col_name in ('单价', '数量', '分配金额'):
                    cell.alignment = Alignment(horizontal='right', vertical='center', shrink_to_fit=True)
                elif col_name in ('发票号码', '发票类型', '供应商', '项目名(物料名)', '规格型号', '单位', '借贷方向', '备注', '付款备注'):
                    # v1.7.3: 付款备注走独立列, 和备注一样 shrink_to_fit
                    cell.alignment = Alignment(horizontal='center', vertical='center', shrink_to_fit=True)
                else:
                    cell.alignment = Alignment(horizontal='center', vertical='center', shrink_to_fit=True)

                # 发票号码 — 文本格式，防止数字发票号被截断/科学计数法
                if col_name in TEXT_COLUMNS:
                    cell.number_format = '@'

                if col_name == '单价':
                    cell.number_format = '#,##0.0000'
                elif col_name == '数量':
                    cell.number_format = '#,##0.000'
                elif col_name in ('分配金额', '报销金额'):
                    cell.number_format = '#,##0.00'

        current_row += len(group_rows)
        end_row = current_row - 1

        if end_row > start_row and granularity == 'item':
            # 同单合并：报销凭证号、报销日期、报销金额
            for col_name in MERGE_COLUMNS:
                merge_col = COLUMNS.index(col_name) + 1
                ws.merge_cells(start_row=start_row, start_column=merge_col, end_row=end_row, end_column=merge_col)
                align = Alignment(horizontal='right', vertical='center', shrink_to_fit=True) if col_name == '报销金额' else Alignment(horizontal='center', vertical='center', shrink_to_fit=True)
                ws.cell(start_row, merge_col).alignment = align

            # 发票号码+供应商 按相同发票号码+相同供应商合并
            bill_no_col = COLUMNS.index('发票号码') + 1
            supplier_col = COLUMNS.index('供应商') + 1
            for run_start in range(start_row, end_row + 1):
                current_bill = clean_text(ws.cell(run_start, bill_no_col).value)
                current_supplier = clean_text(ws.cell(run_start, supplier_col).value)
                run_end = run_start
                # 找相同发票号码+供应商的连续行
                for next_row in range(run_start + 1, end_row + 1):
                    next_bill = clean_text(ws.cell(next_row, bill_no_col).value)
                    next_supplier = clean_text(ws.cell(next_row, supplier_col).value)
                    if next_bill == current_bill and next_supplier == current_supplier:
                        run_end = next_row
                    else:
                        break
                if run_end > run_start:
                    ws.merge_cells(start_row=run_start, start_column=bill_no_col, end_row=run_end, end_column=bill_no_col)
                    ws.merge_cells(start_row=run_start, start_column=supplier_col, end_row=run_end, end_column=supplier_col)
                run_start = run_end  # 跳到下一段

        total_amount += group.total_amount
        paid_total += group.paid_amount
        # v1.7.1: 不再累加 PE 数 (PE 拉取已取消)

    total_row = current_row + 1
    for col_idx in range(1, len(COLUMNS) + 1):
        cell = ws.cell(row=total_row, column=col_idx)
        cell.border = border
        cell.fill = total_fill

    ws.cell(total_row, 1, '合计').font = bold_font
    ws.cell(total_row, 4, round(total_amount, 2)).font = bold_font
    ws.cell(total_row, 4).number_format = '#,##0.00'
    ws.cell(total_row, 4).alignment = Alignment(horizontal='right', vertical='center', shrink_to_fit=True)
    ws.cell(total_row, 14, round(total_amount, 2)).font = bold_font
    ws.cell(total_row, 14).number_format = '#,##0.00'
    ws.cell(total_row, 14).alignment = Alignment(horizontal='right', vertical='center', shrink_to_fit=True)

    # 列宽：1=报销凭证号,2=报销日期,3=报销标题,4=报销金额,5=发票号码,6=发票类型,
    #       7=供应商,8=付款方式,9=项目名,10=规格型号,11=单价,12=数量,13=单位,
    #       14=分配金额,15=备注,16=借贷方向,17=付款备注
    #      供应商/规格型号 *1.2 = 14.4→14，备注 *2 = 24，付款备注 *1.5 = 24
    widths = [
        12,   # 1. 报销凭证号 (wrap)
        12,   # 2. 报销日期 (wrap)
        26,   # 3. 报销标题 (wrap)
        12,   # 4. 报销金额 (wrap)
        15,   # 5. 发票号码 (缩填) — 文本格式
        12,   # 6. 发票类型 (缩填)
        14,   # 7. 供应商 (缩填) *1.2
        12,   # 8. 付款方式 (wrap)
        12,   # 9. 项目名(物料名) (缩填)
        14,   # 10. 规格型号 (缩填) *1.2
        12,   # 11. 单价
        10,   # 12. 数量
        8,    # 13. 单位
        12,   # 14. 分配金额
        24,   # 15. 备注 *2
        10,   # 16. 借贷方向
        24,   # 17. 付款备注 *1.5 (v1.7.3 新列, 容纳 (合计X,A x,B y,未支付z))
    ]
    for idx, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(idx)].width = width

    # 固定行高：表头行高 20，数据行高 18
    ws.row_dimensions[1].height = 28
    ws.row_dimensions[2].height = 22
    ws.row_dimensions[3].height = 22
    for r in range(4, current_row + 2):
        ws.row_dimensions[r].height = 18

    return total_amount, paid_total, current_row - 4  # v1.7.1: 第三个返回值改为"本 sheet 数据行数"


def build_info_sheet(ws, started_at: datetime, ended_at: datetime, elapsed_seconds: float, args, results: list[ScopeResult]) -> None:
    title_fill = PatternFill('solid', fgColor='1F4E79')
    header_fill = PatternFill('solid', fgColor='D9E2F3')
    row_fill = PatternFill('solid', fgColor='F7FBFF')
    title_font = Font(bold=True, color='FFFFFF', size=13)
    header_font = Font(bold=True, color='000000', size=11)
    center = Alignment(horizontal='center', vertical='center', wrap_text=True)
    left = Alignment(horizontal='left', vertical='center', wrap_text=True)
    thin = Side('thin', color='808080')
    border = Border(left=thin, right=thin, top=thin, bottom=thin)

    ws.sheet_view.showGridLines = False
    ws.merge_cells('A1:I1')
    ws['A1'] = '运行信息'
    ws['A1'].font = title_font
    ws['A1'].fill = title_fill
    ws['A1'].alignment = center

    meta = [
        ('脚本开始时间', now_text(started_at)),
        ('脚本结束时间', now_text(ended_at)),
        ('总耗时', elapsed_text(elapsed_seconds)),
        ('日期范围', f'{args.from_date} ~ {args.to_date}'),
        ('粒度', '明细' if args.granularity == 'item' else '汇总'),
        ('方向', '全部' if args.direction == 'all' else args.direction),
        ('scope 数量', str(len(results))),
        ('输出文件', str(args.output)),
    ]

    ws['A3'] = '参数'
    ws['B3'] = '值'
    for cell_ref in ('A3', 'B3'):
        ws[cell_ref].font = header_font
        ws[cell_ref].fill = header_fill
        ws[cell_ref].border = border
        ws[cell_ref].alignment = center

    row = 4
    for key, value in meta:
        ws.cell(row=row, column=1, value=key)
        ws.cell(row=row, column=2, value=value)
        for col in (1, 2):
            ws.cell(row=row, column=col).border = border
            ws.cell(row=row, column=col).fill = row_fill
            ws.cell(row=row, column=col).alignment = left
        row += 1

    row += 1
    headers = ['sheet', 'company', '当前账户名', '报销单数', '明细行数', '报销金额合计', '已付金额合计', '已付清单数', '付款方式']
    for idx, header in enumerate(headers, 1):
        cell = ws.cell(row=row, column=idx, value=header)
        cell.font = header_font
        cell.fill = header_fill
        cell.border = border
        cell.alignment = center

    for result in results:
        row += 1
        values = [
            result.scope.sheet,
            result.scope.company,
            result.payment_account,
            result.rr_count,
            result.row_count,
            round(result.rr_total, 2),
            round(result.paid_total, 2),
            result.paid_count,
            unique_join([group.payment_modes for group in result.groups]),
        ]
        for idx, value in enumerate(values, 1):
            cell = ws.cell(row=row, column=idx, value=value)
            cell.border = border
            cell.fill = row_fill
            cell.alignment = left if idx <= 3 else center
            if idx in (6, 7):
                cell.number_format = '#,##0.00'

    widths = [16, 26, 22, 12, 12, 14, 14, 10, 18]
    for idx, width in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(idx)].width = width





def _normalize_payment_scope(value: str) -> str:
    mapping = {
        "all": "all", "全部账户": "all", "全部": "all",
        "cash": "cash", "现金": "cash",
        "bank": "bank", "银行": "bank", "电汇": "bank",
        "unpaid": "unpaid", "未付款": "unpaid",
    }
    normalized = str(value or "all").strip().lower()
    if normalized in mapping:
        return mapping[normalized]
    raise ValueError("payment_scope 只能是 all / cash / bank / unpaid")


def _bucket_matches(bucket: str, payment_scope: str) -> bool:
    if payment_scope == "all":
        return True
    if payment_scope == "cash":
        return "现金" in bucket
    if payment_scope == "bank":
        return "银行" in bucket or "电汇" in bucket
    if payment_scope == "unpaid":
        return "未付款" in bucket
    return True


def _short_company(company: str) -> str:
    return company_short(company)[:10]


def main(companies: list[str], start_date: str, end_date: str,
         granularity: str = "item", direction: str = "all",
         payment_scope: str = "all") -> dict[str, Any]:
    companies = [str(value).strip() for value in (companies or []) if str(value).strip()]
    start_date = str(start_date or "").strip()
    end_date = str(end_date or "").strip()
    if not companies:
        raise ValueError("至少选择一家公司")
    if not start_date or not end_date or start_date > end_date:
        raise ValueError("日期范围无效")
    granularity = normalize_granularity(granularity)
    direction_filter = normalize_direction(direction)
    payment_scope = _normalize_payment_scope(payment_scope)
    _set_connection()
    PI_DOC_CACHE.clear()
    PE_DOC_CACHE.clear()

    started_at = datetime.now()
    wb = Workbook()
    info_ws = wb.active
    info_ws.title = "运行信息"
    used_sheet_names = {"运行信息"}
    scope_results: list[ScopeResult] = []
    preview_rows: list[dict[str, Any]] = []
    scanned_rr_count = 0
    excluded_bucket_count = 0

    for company in companies:
        rr_list = fetch_reimbursement_requests(company, start_date, end_date)
        scanned_rr_count += len(rr_list)
        all_pes = fetch_payment_entries_for_company(company)
        short_name = company_short(company)
        bucket_rows: dict[str, list[tuple[list[dict[str, Any]], GroupResult]]] = {}
        bucket_order: list[str] = []

        for rr in rr_list:
            rr_doc = api_get_doc("Reimbursement Request", rr["name"])
            if not rr_doc:
                continue
            rr_pes = find_payment_entries_for_rr(
                rr_name=rr["name"],
                all_company_pes=all_pes,
                rr_invoice_items=rr_doc.get("invoice_items") or [],
                period_from=start_date,
                period_to=end_date,
            )
            classification = classify_rr_for_mixed_report(
                rr_doc=rr_doc,
                rr_payment_entries=rr_pes,
                company_short=short_name,
            )
            if not _bucket_matches(classification.bucket_name, payment_scope):
                excluded_bucket_count += 1
                continue
            built = build_rows_for_rr(rr, granularity, direction_filter, classification)
            if not built:
                continue
            rows, group = built
            bucket_key = classification.bucket_name
            if bucket_key not in bucket_rows:
                bucket_rows[bucket_key] = []
                bucket_order.append(bucket_key)
            bucket_rows[bucket_key].append((rows, group))

        for bucket_key in bucket_order:
            rows_and_groups = bucket_rows[bucket_key]
            actual_sheet = unique_sheet_name(bucket_key, used_sheet_names)
            ws = wb.create_sheet(title=actual_sheet)
            total_amount, total_paid_amount, _ = build_sheet(
                ws, company, bucket_key, rows_and_groups,
                start_date, end_date, granularity, direction_filter,
            )
            rr_count = len(rows_and_groups)
            row_count = sum(len(rows) for rows, _ in rows_and_groups)
            paid_count = sum(1 for _, group in rows_and_groups if group.payment_status == "Paid")
            scope = Scope(company=company, sheet=actual_sheet, raw=company)
            scope_results.append(ScopeResult(
                scope=scope,
                payment_account=bucket_key,
                rr_count=rr_count,
                row_count=row_count,
                rr_total=round(total_amount, 2),
                paid_total=round(total_paid_amount, 2),
                paid_count=paid_count,
                groups=[group for _, group in rows_and_groups],
            ))
            for rows, _ in rows_and_groups:
                for row in rows:
                    if len(preview_rows) >= 100:
                        break
                    preview_rows.append({"公司": company, "当前账户": bucket_key, **row})
                if len(preview_rows) >= 100:
                    break

    ended_at = datetime.now()
    args = SimpleNamespace(
        from_date=start_date,
        to_date=end_date,
        granularity=granularity,
        direction=direction_filter,
        output="ERPNext 内存文件",
    )
    build_info_sheet(info_ws, started_at, ended_at, (ended_at-started_at).total_seconds(), args, scope_results)

    buffer = io.BytesIO()
    wb.save(buffer)
    content = buffer.getvalue()
    verified = load_workbook(io.BytesIO(content), read_only=True)
    company_label = "_".join(_short_company(company) for company in companies)
    scope_label = {"all": "全部账户", "cash": "现金", "bank": "银行", "unpaid": "未付款"}[payment_scope]
    filename = f"{company_label}_报销混合单据_{start_date}_{end_date}_{scope_label}.xlsx"
    summary = [{
        "Sheet": result.scope.sheet,
        "公司": result.scope.company,
        "当前账户": result.payment_account,
        "报销单数": result.rr_count,
        "明细行数": result.row_count,
        "报销金额": round(result.rr_total, 2),
        "已付金额": round(result.paid_total, 2),
        "已付清单数": result.paid_count,
    } for result in scope_results]
    business_sheet_count = max(0, len(verified.sheetnames) - 1)
    total_rows = sum(result.row_count for result in scope_results)
    coverage_warning = ""
    if total_rows <= 10 and business_sheet_count <= 1:
        coverage_warning = (
            f"本次只输出 {sum(result.rr_count for result in scope_results)} 张报销单、"
            f"{total_rows} 行明细、{business_sheet_count} 个业务 Sheet。"
            "这是当前 ERPNext 查询结果，不自动推断为完整月度账单。"
        )
    if not scope_results:
        coverage_warning = "当前筛选条件未生成业务 Sheet。请检查日期、公司、付款范围或 ERPNext 数据。"

    markdown = f"""### 报销混合单据生成完成

- 公司：{'、'.join(companies)}
- 日期：{start_date} 至 {end_date}
- 粒度：{'发票明细' if granularity == 'item' else '报销单汇总'}
- 方向：{'全部' if direction_filter == 'all' else direction_filter}
- 付款范围：{scope_label}
- 扫描报销单：{scanned_rr_count} 张
- 输出报销单：{sum(result.rr_count for result in scope_results)} 张
- 输出明细：{total_rows} 行
- 业务 Sheet：{business_sheet_count} 个"""
    if coverage_warning:
        markdown += f"\n\n> {coverage_warning}"
    encoded = base64.b64encode(content).decode("ascii")
    return {
        "render_all": [
            {"markdown": markdown},
            {"table-row-object": summary},
            {"file": {"filename": filename, "content": encoded, "mime_type": XLSX_MIME}},
        ],
        "summary": summary,
        "rows": preview_rows,
        "coverage_warning": coverage_warning,
        "excluded_bucket_count": excluded_bucket_count,
        "sheet_names": verified.sheetnames,
        "backend_version": BACKEND_VERSION,
    }
