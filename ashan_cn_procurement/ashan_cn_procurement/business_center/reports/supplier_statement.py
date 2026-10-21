#!/usr/bin/env python3
"""Generate supplier reconciliation statements from ERPNext Purchase Receipts.

Output contract:
- one xlsx per company
- default companies: 天津祺富机械加工有限公司 / 天津吉众科技有限公司
- default supplier filter: ERPNext Supplier.name == 金普金
- supplier display in Excel: 天津聚鑫优品五金商贸有限公司（金普金）
- data source: Purchase Receipt, not Purchase Invoice
- template=supplier: 供应商名 / 入库日期 / 物料名 / 规格型号 / 单价 / 数量 / 总价格
- template=internal: 供应商名 / 入库日期 / 入库单据号 / 物料名 / 规格型号 / 单价 / 数量 / 总价格 / 备注
- bottom total row: 总价格合计
- uses Purchase Receipt.posting_date as 入库日期 and Purchase Receipt.name as 入库单据号
- uses Purchase Receipt Item.custom_guige_xinghao as 规格型号; never fall back to description
- uses Purchase Receipt Item.custom_备注 as internal audit remark; empty stays empty
- treats item.amount - item.billed_amt > 0 as 已入库但未开发票
- all cells use Excel shrink-to-fit; fixed column widths are embedded in the XLSX
"""

from __future__ import annotations

import base64
import datetime as dt
import io
import html
import json
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Sequence, TypedDict
from urllib.parse import quote
from xml.sax.saxutils import escape

from .. import local_requests as requests
from .. import legacy_wmill as wmill

DEFAULT_COMPANIES = [
    "天津祺富机械加工有限公司",
    "天津吉众科技有限公司",
]
DEFAULT_MONTH = "2026-05"

# 用户已确认：祺富/吉众是“咱们自己家”的公司，金普金是供应商。
# ERPNext Supplier.name 是“金普金”；供应商全称/显示名是“天津聚鑫优品五金商贸有限公司”。
DEFAULT_SUPPLIER_KEYS = ["金普金"]
SUPPLIER_DISPLAY_BY_KEY = {
    "金普金": "天津聚鑫优品五金商贸有限公司（金普金）",
}
SUPPLIER_KEY_ALIASES = {
    "金普金": "金普金",
    "天津聚鑫优品五金商贸有限公司": "金普金",
    "天津聚鑫优品五金商贸有限公司（金普金）": "金普金",
    "天津聚鑫优品五金商贸有限公司(金普金)": "金普金",
    "聚鑫优品": "金普金",
}

# 用户确认：规格型号是 ERPNext Purchase Receipt Item / Purchase Invoice Item 的自定义字段，
# 不是官方 description。为空就留空，禁止 fallback。
SPEC_FIELD = "custom_guige_xinghao"
REMARK_FIELD = "custom_备注"
PURCHASE_RECEIPT_DOCTYPE = "Purchase Receipt"
BASE_URL_VARIABLE_PATH = "f/erpnext/base_url"
API_TOKEN_VARIABLE_PATH = "f/erpnext/api_token"
EPSILON = 0.000001
BACKEND_VERSION = "2.0.0-frappe16"

# 两种模板共享同一批未开票数据，只在 Excel 输出阶段切换字段。
# 所有单元格启用 shrink-to-fit，长文本缩小显示，不自动撑宽。
SUPPLIER_COLUMN_DEFS = [
    ("供应商名", 18),
    ("入库日期", 12),
    ("物料名", 18),
    ("规格型号", 24),
    ("单价", 10),
    ("数量", 8),
    ("总价格", 12),
]
INTERNAL_COLUMN_DEFS = [
    ("供应商名", 18),
    ("入库日期", 12),
    ("入库单据号", 22),
    ("物料名", 18),
    ("规格型号", 24),
    ("单价", 10),
    ("数量", 8),
    ("总价格", 12),
    ("备注", 28),
]


def column_defs(template: str) -> List[tuple[str, int]]:
    return INTERNAL_COLUMN_DEFS if template == "internal" else SUPPLIER_COLUMN_DEFS


class c_erpnext_connection(TypedDict):
    """Legacy compatibility resource type.

    Use the Legacy compatibility resource type ``c_erpnext_connection`` with:
    - base_url: string
    - api_token: string, marked sensitive
    """

    base_url: str
    api_token: str


@dataclass
class WorkbookRow:
    supplier_name: str
    entry_date: str
    item_name: str
    spec: str
    rate: float
    qty: float
    amount: float
    source_doc: str = ""
    remark: str = ""
    source_idx: int = 0


def parse_env_file(path: str) -> Dict[str, str]:
    out: Dict[str, str] = {}
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip()
    return out


def month_range(month: str) -> tuple[str, str]:
    m = re.fullmatch(r"(\d{4})-(\d{2})", month)
    if not m:
        raise ValueError("--month must be YYYY-MM")
    y = int(m.group(1))
    mo = int(m.group(2))
    start = dt.date(y, mo, 1)
    if mo == 12:
        end = dt.date(y + 1, 1, 1) - dt.timedelta(days=1)
    else:
        end = dt.date(y, mo + 1, 1) - dt.timedelta(days=1)
    return start.isoformat(), end.isoformat()


def parse_cutoff(value: str | None) -> str | None:
    if not value:
        return None
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("--cutoff must be YYYY-MM-DD")
    return value


def slug(text: str) -> str:
    text = text.strip()
    text = re.sub(r"\s+", "_", text)
    text = re.sub(r"[^0-9A-Za-z_\-\u4e00-\u9fff]", "", text)
    return text or "_"


def company_alias(company: str) -> str:
    if "祺富" in company:
        return "祺富"
    if "吉众" in company:
        return "吉众"
    return slug(company)


def normalize_supplier_key(value: str) -> str:
    v = (value or "").strip()
    return SUPPLIER_KEY_ALIASES.get(v, v)


def normalize_supplier_keys(values: Iterable[str] | None) -> List[str]:
    raw = list(values or DEFAULT_SUPPLIER_KEYS)
    out: List[str] = []
    for value in raw:
        key = normalize_supplier_key(value)
        if key and key not in out:
            out.append(key)
    return out or list(DEFAULT_SUPPLIER_KEYS)


def supplier_alias_for_filename(supplier_keys: Sequence[str]) -> str:
    if len(supplier_keys) == 1 and supplier_keys[0] == "金普金":
        return "金普金"
    if len(supplier_keys) == 1:
        return slug(supplier_keys[0])
    return "多供应商"


def supplier_display(supplier_key: str, supplier_name: str | None = None) -> str:
    key = normalize_supplier_key(supplier_key)
    if key in SUPPLIER_DISPLAY_BY_KEY:
        return SUPPLIER_DISPLAY_BY_KEY[key]
    if supplier_name and supplier_name != key:
        return f"{supplier_name}（{key}）"
    return supplier_name or key


def to_float(value: Any) -> float:
    try:
        return float(value or 0)
    except Exception:
        return 0.0


def clean_text(value: Any) -> str:
    """Normalize ERPNext text/custom fields before writing to Excel."""
    if value is None:
        return ""
    text = html.unescape(str(value))
    text = re.sub(r"(?i)<br\s*/?>", " ", text)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def unbilled_amount(item: Dict[str, Any]) -> float:
    # ERPNext Purchase Receipt Item carries how much has already been billed.
    # “已入库但未开发票” uses the remaining amount, not PI.bill_no.
    return round(to_float(item.get("amount")) - to_float(item.get("billed_amt")), 2)


def unbilled_qty(item: Dict[str, Any], remaining_amount: float) -> float:
    qty = to_float(item.get("qty"))
    amount = to_float(item.get("amount"))
    if qty <= 0 or amount <= 0:
        return qty
    ratio = max(0.0, min(1.0, remaining_amount / amount))
    return round(qty * ratio, 6)


def col_letter(n: int) -> str:
    s = ""
    while n:
        n, rem = divmod(n - 1, 26)
        s = chr(65 + rem) + s
    return s


def xlsx_escape(value: Any) -> str:
    return escape("") if value is None else escape(str(value))


def style_xml() -> str:
    # Style 0: normal shrink-to-fit text
    # Style 1: bold header/total shrink-to-fit
    # Style 2: number with two decimals, shrink-to-fit
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="等线"/></font>
    <font><b/><sz val="11"/><name val="等线"/></font>
  </fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>
    <xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="center" vertical="center" shrinkToFit="1"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''


def cols_xml(template: str) -> str:
    cols = []
    for idx, (_, width) in enumerate(column_defs(template), 1):
        cols.append(f'<col min="{idx}" max="{idx}" width="{width}" customWidth="1"/>')
    return "<cols>" + "".join(cols) + "</cols>"


def cell_inline(ref: str, val: Any, style: int = 0) -> str:
    return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t>{xlsx_escape(val)}</t></is></c>'


def cell_number(ref: str, val: Any, style: int = 2) -> str:
    try:
        num = float(val or 0)
    except Exception:
        num = 0.0
    return f'<c r="{ref}" s="{style}"><v>{num:.2f}</v></c>'


def build_sheet_xml(title: str, rows: Sequence[WorkbookRow], template: str = "supplier") -> str:
    defs = column_defs(template)
    table: List[List[Any]] = [[name for name, _ in defs]]
    if template == "internal":
        for r in rows:
            table.append([
                r.supplier_name,
                r.entry_date,
                r.source_doc,
                r.item_name,
                r.spec,
                round(float(r.rate or 0), 2),
                round(float(r.qty or 0), 2),
                round(float(r.amount or 0), 2),
                r.remark,
            ])
        amount_col = 8
    else:
        for r in rows:
            table.append([
                r.supplier_name,
                r.entry_date,
                r.item_name,
                r.spec,
                round(float(r.rate or 0), 2),
                round(float(r.qty or 0), 2),
                round(float(r.amount or 0), 2),
            ])
        amount_col = 7

    total_amount = round(sum(float(r.amount or 0) for r in rows), 2)
    total_row = [""] * len(defs)
    total_row[0] = "总价格合计"
    total_row[amount_col - 1] = total_amount
    table.append(total_row)

    numeric_cols = {6, 7, 8} if template == "internal" else {5, 6, 7}
    xml_rows: List[str] = []
    last_row_idx = len(table)
    for r_idx, row in enumerate(table, 1):
        cells: List[str] = []
        for c_idx, val in enumerate(row, 1):
            ref = f"{col_letter(c_idx)}{r_idx}"
            if r_idx == 1:
                cells.append(cell_inline(ref, val, style=1))
            elif r_idx == last_row_idx:
                if c_idx == 1:
                    cells.append(cell_inline(ref, val, style=1))
                elif c_idx == amount_col:
                    cells.append(cell_number(ref, val, style=2))
                else:
                    cells.append(cell_inline(ref, val, style=0))
            elif c_idx in numeric_cols:
                cells.append(cell_number(ref, val, style=2))
            else:
                cells.append(cell_inline(ref, val, style=0))
        xml_rows.append(f'<row r="{r_idx}">' + ''.join(cells) + '</row>')

    return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  {cols_xml(template)}
  <sheetData>
    {''.join(xml_rows)}
  </sheetData>
</worksheet>"""


def workbook_xml(sheet_name: str) -> str:
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="{xlsx_escape(sheet_name)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>'''


def workbook_rels() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>'''


def root_rels() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>'''


def content_types() -> str:
    return '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>'''


def make_session(base: str, token: str) -> requests.Session:
    sess = requests.Session()
    # ERPNext/Frappe token auth: token api_key:api_secret
    sess.headers.update({"Authorization": f"token {token}"})
    return sess


def get_resource(sess: requests.Session, base: str, doctype: str, name: str) -> Dict[str, Any]:
    url = f"{base.rstrip('/')}/api/resource/{quote(doctype)}/{quote(name)}"
    resp = sess.get(url, timeout=30)
    resp.raise_for_status()
    return resp.json().get("data") or {}


def list_purchase_receipts(
    sess: requests.Session,
    base: str,
    company: str,
    supplier_keys: Sequence[str],
    month: str,
    cutoff: str | None = None,
) -> List[Dict[str, Any]]:
    start, end = month_range(month)
    if cutoff:
        end = min(end, cutoff)
    url = f"{base.rstrip('/')}/api/resource/{quote(PURCHASE_RECEIPT_DOCTYPE)}"
    supplier_filter: list[Any]
    if len(supplier_keys) == 1:
        supplier_filter = ["supplier", "=", supplier_keys[0]]
    else:
        supplier_filter = ["supplier", "in", list(supplier_keys)]
    filters = [
        ["company", "=", company],
        supplier_filter,
        ["posting_date", "between", [start, end]],
        ["docstatus", "=", 1],
    ]
    fields = [
        "name",
        "posting_date",
        "company",
        "supplier",
        "supplier_name",
        "status",
        "grand_total",
        "per_billed",
    ]
    out: List[Dict[str, Any]] = []
    start_row = 0
    while True:
        params = {
            "filters": json.dumps(filters, ensure_ascii=False),
            "fields": json.dumps(fields, ensure_ascii=False),
            "limit_start": start_row,
            "limit_page_length": 200,
            "order_by": "posting_date asc, name asc",
        }
        resp = sess.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json().get("data") or []
        out.extend(data)
        if len(data) < 200:
            break
        start_row += 200
    return out


def sheet_data_for_company(
    base: str,
    token: str,
    company: str,
    month: str,
    supplier_keys: Sequence[str],
    cutoff: str | None = None,
) -> tuple[List[WorkbookRow], int]:
    sess = make_session(base, token)
    receipts = list_purchase_receipts(sess, base, company, supplier_keys, month, cutoff=cutoff)
    out: List[WorkbookRow] = []

    for doc in receipts:
        receipt_name = doc.get("name")
        if not receipt_name:
            continue
        detail = get_resource(sess, base, PURCHASE_RECEIPT_DOCTYPE, receipt_name)
        supplier_key = str(detail.get("supplier") or doc.get("supplier") or supplier_keys[0])
        supplier_name = str(detail.get("supplier_name") or doc.get("supplier_name") or "")
        supplier_label = supplier_display(supplier_key, supplier_name)
        posting_date = detail.get("posting_date") or doc.get("posting_date") or ""
        items = detail.get("items") or []
        for idx, item in enumerate(items, 1):
            remaining = unbilled_amount(item)
            if remaining <= EPSILON:
                continue
            out.append(
                WorkbookRow(
                    supplier_name=supplier_label,
                    entry_date=posting_date,
                    item_name=clean_text(item.get("item_name") or item.get("item_code") or ""),
                    spec=clean_text(item.get(SPEC_FIELD) or ""),
                    rate=to_float(item.get("rate")),
                    qty=unbilled_qty(item, remaining),
                    amount=remaining,
                    source_doc=str(receipt_name),
                    remark=clean_text(item.get(REMARK_FIELD) or ""),
                    source_idx=idx,
                )
            )

    # Stable sort: 入库日期 -> 入库单 -> 行号 -> 物料名
    out.sort(key=lambda r: (r.entry_date or "", r.source_doc or "", r.source_idx, r.item_name or "", r.spec or ""))
    return out, len(receipts)


def build_xlsx_bytes(sheet_name: str, rows: Sequence[WorkbookRow], template: str = "supplier") -> bytes:
    """Build one XLSX workbook entirely in memory."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types())
        z.writestr("_rels/.rels", root_rels())
        z.writestr("xl/workbook.xml", workbook_xml(sheet_name))
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels())
        z.writestr("xl/styles.xml", style_xml())
        z.writestr("xl/worksheets/sheet1.xml", build_sheet_xml(sheet_name, rows, template=template))
    return buffer.getvalue()


def as_data_url(content: bytes, mime_type: str) -> str:
    encoded = base64.b64encode(content).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def parse_iso_date(value: str | None, field_name: str) -> str | None:
    if value is None or not str(value).strip():
        return None
    text = str(value).strip()
    try:
        dt.date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError(f"{field_name} 必须是 YYYY-MM-DD") from exc
    return text


def list_outstanding_receipts(
    sess: requests.Session,
    base: str,
    company: str,
    supplier_keys: Sequence[str],
    cutoff: str,
    start_date: str | None = None,
) -> List[Dict[str, Any]]:
    """List submitted Purchase Receipts for the selected suppliers.

    We deliberately do not rely on the parent ``per_billed`` field as the
    final criterion. The authoritative check is performed on every child item
    using ``amount - billed_amt > 0`` after the full document is fetched.
    """
    url = f"{base.rstrip('/')}/api/resource/{quote(PURCHASE_RECEIPT_DOCTYPE)}"
    supplier_filter: List[Any]
    if len(supplier_keys) == 1:
        supplier_filter = ["supplier", "=", supplier_keys[0]]
    else:
        supplier_filter = ["supplier", "in", list(supplier_keys)]
    filters: List[Any] = [
        ["company", "=", company],
        supplier_filter,
        ["docstatus", "=", 1],
    ]
    if start_date:
        filters.append(["posting_date", "between", [start_date, cutoff]])
    else:
        filters.append(["posting_date", "<=", cutoff])

    fields = [
        "name",
        "posting_date",
        "company",
        "supplier",
        "supplier_name",
        "status",
        "grand_total",
        "per_billed",
    ]
    out: List[Dict[str, Any]] = []
    start_row = 0
    while True:
        params = {
            "filters": json.dumps(filters, ensure_ascii=False),
            "fields": json.dumps(fields, ensure_ascii=False),
            "limit_start": start_row,
            "limit_page_length": 200,
            "order_by": "posting_date asc, name asc",
        }
        resp = sess.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json().get("data") or []
        out.extend(data)
        if len(data) < 200:
            break
        start_row += 200
    return out


def outstanding_rows_for_company(
    base: str,
    token: str,
    company: str,
    supplier_keys: Sequence[str],
    cutoff: str,
    start_date: str | None = None,
) -> tuple[List[WorkbookRow], int]:
    sess = make_session(base, token)
    receipts = list_outstanding_receipts(
        sess,
        base,
        company,
        supplier_keys=supplier_keys,
        cutoff=cutoff,
        start_date=start_date,
    )
    out: List[WorkbookRow] = []

    for doc in receipts:
        receipt_name = doc.get("name")
        if not receipt_name:
            continue
        detail = get_resource(
            sess,
            base,
            PURCHASE_RECEIPT_DOCTYPE,
            str(receipt_name),
        )
        posting_date = str(
            detail.get("posting_date")
            or doc.get("posting_date")
            or ""
        )
        supplier_key = str(
            detail.get("supplier")
            or doc.get("supplier")
            or supplier_keys[0]
        )
        supplier_name = str(
            detail.get("supplier_name")
            or doc.get("supplier_name")
            or ""
        )
        supplier_label = supplier_display(supplier_key, supplier_name)

        for idx, item in enumerate(detail.get("items") or [], 1):
            remaining = unbilled_amount(item)
            if remaining <= EPSILON:
                continue
            out.append(
                WorkbookRow(
                    supplier_name=supplier_label,
                    entry_date=posting_date,
                    item_name=clean_text(
                        item.get("item_name")
                        or item.get("item_code")
                        or ""
                    ),
                    spec=clean_text(item.get(SPEC_FIELD) or ""),
                    rate=to_float(item.get("rate")),
                    qty=unbilled_qty(item, remaining),
                    amount=remaining,
                    source_doc=str(receipt_name),
                    remark=clean_text(item.get(REMARK_FIELD) or ""),
                    source_idx=idx,
                )
            )

    out.sort(
        key=lambda row: (
            row.entry_date or "",
            row.source_doc or "",
            row.source_idx,
            row.item_name or "",
            row.spec or "",
        )
    )
    return out, len(receipts)


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

def main(
    mode: str = "range",
    companies: list[str] = [
        "天津祺富机械加工有限公司",
        "天津吉众科技有限公司",
    ],
    suppliers: list[str] = ["金普金"],
    start_date: str | None = None,
    end_date: str | None = None,
    month: str | None = None,
    template: str = "supplier",
) -> Dict[str, Any]:
    """Generate reconciliation XLSX files with supplier/internal templates.

    mode="range": uses start_date/end_date. Empty start_date means all history.
    mode="monthly": uses month (YYYY-MM).
    template="supplier": 7-column formal statement for supplier confirmation.
    template="internal": 9-column audit statement including receipt number and remark.
    Suppliers are exact ERPNext Supplier.name values.
    """
    base_url, token, _connection_source = _read_connection_values()

    selected_mode = str(mode or "range").strip().lower()
    if selected_mode not in {"range", "monthly"}:
        raise ValueError("mode 必须是 range 或 monthly")

    selected_template = str(template or "supplier").strip().lower()
    if selected_template not in {"supplier", "internal"}:
        raise ValueError("template 必须是 supplier 或 internal")

    selected_companies = [str(v).strip() for v in (companies or DEFAULT_COMPANIES) if str(v).strip()] or list(DEFAULT_COMPANIES)
    supplier_keys = normalize_supplier_keys(suppliers)

    if selected_mode == "monthly":
        selected_month = str(month or "").strip() or dt.date.today().strftime("%Y-%m")
        parsed_start, parsed_end = month_range(selected_month)
        range_label = selected_month
        range_text = selected_month
    else:
        parsed_end = parse_iso_date(end_date, "end_date") or dt.date.today().isoformat()
        parsed_start = parse_iso_date(start_date, "start_date")
        if parsed_start and parsed_start > parsed_end:
            raise ValueError("start_date 不能晚于 end_date")
        range_label = f"{parsed_start or '全部历史'} 至 {parsed_end}"
        range_text = f"{parsed_start}_至_{parsed_end}" if parsed_start else f"截至_{parsed_end}"
        selected_month = None

    summaries: List[Dict[str, Any]] = []
    download_files: List[Dict[str, Any]] = []
    table_rows: List[Dict[str, Any]] = []
    zip_buffer = io.BytesIO()
    supplier_alias = supplier_alias_for_filename(supplier_keys)
    template_label = "内部核对版" if selected_template == "internal" else "供应商核对版"
    filename_suffix = "未开票核对明细" if selected_template == "internal" else "对账单"
    sheet_name = "内部核对" if selected_template == "internal" else "对账单"
    defs = column_defs(selected_template)

    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
        for company in selected_companies:
            rows, receipt_count = outstanding_rows_for_company(
                base_url,
                token,
                company,
                supplier_keys=supplier_keys,
                cutoff=parsed_end,
                start_date=parsed_start,
            )
            filename = f"{company_alias(company)}_{supplier_alias}_{range_text}_{filename_suffix}.xlsx"
            content = build_xlsx_bytes(sheet_name, rows, template=selected_template)
            bundle.writestr(filename, content)
            total_amount = round(sum(row.amount for row in rows), 2)

            summaries.append({
                "company": company,
                "suppliers": supplier_keys,
                "mode": selected_mode,
                "template": selected_template,
                "template_label": template_label,
                "month": selected_month,
                "start_date": parsed_start,
                "end_date": parsed_end,
                "receipt_count_checked": receipt_count,
                "unbilled_rows": len(rows),
                "total_unbilled_amount": total_amount,
                "filename": filename,
            })

            for row in rows:
                if selected_template == "internal":
                    table_rows.append({
                        "公司": company,
                        "供应商名": row.supplier_name,
                        "入库日期": row.entry_date,
                        "入库单据号": row.source_doc,
                        "物料名": row.item_name,
                        "规格型号": row.spec,
                        "单价": round(row.rate, 2),
                        "数量": round(row.qty, 6),
                        "总价格": round(row.amount, 2),
                        "备注": row.remark,
                    })
                else:
                    table_rows.append({
                        "公司": company,
                        "供应商名": row.supplier_name,
                        "入库日期": row.entry_date,
                        "物料名": row.item_name,
                        "规格型号": row.spec,
                        "单价": round(row.rate, 2),
                        "数量": round(row.qty, 6),
                        "总价格": round(row.amount, 2),
                    })

            download_files.append({
                "company": company,
                "filename": filename,
                "mime_type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "data_url": as_data_url(content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            })

    zip_name = f"{supplier_alias}_{range_text}_{filename_suffix}.zip"
    zip_content = zip_buffer.getvalue()
    grand_total = round(sum(item["total_unbilled_amount"] for item in summaries), 2)

    return {
        "ok": True,
        "backend_version": BACKEND_VERSION,
        "report_type": "supplier_reconciliation_statement",
        "mode": selected_mode,
        "template": selected_template,
        "template_label": template_label,
        "query_scope": "已提交采购入库单中 amount - billed_amt > 0 的剩余未开票金额",
        "data_source": "Purchase Receipt / Purchase Receipt Item",
        "unbilled_formula": "Purchase Receipt Item.amount - Purchase Receipt Item.billed_amt",
        "spec_field": SPEC_FIELD,
        "remark_field": REMARK_FIELD if selected_template == "internal" else None,
        "suppliers": supplier_keys,
        "range_label": range_label,
        "month": selected_month,
        "start_date": parsed_start,
        "end_date": parsed_end,
        "companies": selected_companies,
        "template_contract": {
            "sheet_name": sheet_name,
            "template": selected_template,
            "template_label": template_label,
            "columns": [name for name, _ in defs],
            "widths": {name: width for name, width in defs},
            "shrink_to_fit": True,
            "bottom_total_label": "总价格合计",
            "files_per_company": True,
        },
        "summary": summaries,
        "grand_total_unbilled_amount": grand_total,
        "rows": table_rows,
        "files": download_files,
        "zip_file": {
            "filename": zip_name,
            "mime_type": "application/zip",
            "size": len(zip_content),
            "data_url": as_data_url(zip_content, "application/zip"),
        },
    }

