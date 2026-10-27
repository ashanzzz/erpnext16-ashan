from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from typing import Any

from pypdf import PdfReader

_PERIOD_TOKEN_RE = re.compile(
    r"(?:(?<!\d)|(?<=\.\d{2}))(20\d{2})\s*[-/.]\s*(1[0-2]|0[1-9]|[1-9])(?!\d)"
)
_ATTACHED_COUNT_PERIOD_RE = re.compile(
    r"(?:(?<!\d)|(?<=\.\d{2}))(20\d{2})\s*[-/.]\s*(1[0-2]|0[1-9])(?:\d{1,4})(?!\d)"
)
_CN_PERIOD_TOKEN_RE = re.compile(
    r"(?<!\d)(20\d{2})\s*年\s*(1[0-2]|0[1-9]|[1-9])(?:\s*月)?(?!\s*\d+\s*日)(?!\s*月\s*\d+\s*日)(?!\d)"
)
_MONEY_RE = re.compile(r"(?<![\d.])((?:\d{1,3}(?:,\d{3})+|\d+)\.\d{2})(?!\d)")


def normalize_period(year: Any, month: Any) -> str:
    return f"{int(year):04d}-{int(month):02d}"


def expected_proof_period(payroll_period_month: str) -> str:
    """Payroll settlement month -> actual SS/HF payment/proof month (next calendar month)."""
    match = re.fullmatch(r"(20\d{2})-(0[1-9]|1[0-2])", str(payroll_period_month or "").strip())
    if not match:
        raise ValueError(f"Invalid payroll period_month: {payroll_period_month!r}; expected YYYY-MM")
    year = int(match.group(1))
    month = int(match.group(2))
    if month == 12:
        return f"{year + 1:04d}-01"
    return f"{year:04d}-{month + 1:02d}"


def _extract_pdf_text(file_bytes: bytes) -> tuple[str, list[str]]:
    reader = PdfReader(io.BytesIO(file_bytes))
    pages: list[str] = []
    for page in reader.pages:
        plain = page.extract_text() or ""
        try:
            layout = page.extract_text(extraction_mode="layout") or ""
        except Exception:
            layout = ""
        if layout and layout.strip() != plain.strip():
            page_text = layout + "\n" + plain
        else:
            page_text = plain or layout
        pages.append(page_text)
    return "\n".join(pages), pages


def _extract_period_tokens(text: str) -> list[str]:
    periods: list[str] = []
    periods.extend(normalize_period(y, m) for y, m in _PERIOD_TOKEN_RE.findall(text or ""))
    periods.extend(normalize_period(y, m) for y, m in _ATTACHED_COUNT_PERIOD_RE.findall(text or ""))
    periods.extend(normalize_period(y, m) for y, m in _CN_PERIOD_TOKEN_RE.findall(text or ""))
    return periods


def _most_common_period(periods: list[str]) -> str:
    if not periods:
        return ""
    counts = Counter(periods)
    # Stable tie-break: first appearance among periods.
    best_count = max(counts.values())
    for period in periods:
        if counts[period] == best_count:
            return period
    return periods[0]


def _is_company_match(expected_company: str, detected_company: str) -> bool:
    if not expected_company or not detected_company:
        return True
    exp = str(expected_company).strip()
    det = str(detected_company).strip()
    if exp == det:
        return True
    if "吉众" in exp:
        return "吉众" in det and "祺富" not in det
    if "祺富" in exp:
        return "祺富" in det and "吉众" not in det
    return exp in det or det in exp


def parse_social_security_pdf_stream(file_bytes: bytes) -> dict[str, Any]:
    full_text, pages = _extract_pdf_text(file_bytes)
    compact = re.sub(r"\s+", "", full_text)
    recognized = ("社会保险" in compact or "社保" in compact) and any(
        kw in compact for kw in ["缴费申报表", "缴费记录", "完税证明", "申报表", "缴费明细", "用人单位", "缴费人"]
    )

    # 截取明细表格区域提取费款所属期，避免受理日期/开具日期干扰
    table_text = full_text
    for stop_marker in ("缴\n费\n人\n声\n明", "缴费人声明", "合\n计", "合计", "合 计", "*受理税务机关", "开具机关", "开具日期", "制发日期", "打印日期"):
        idx = table_text.find(stop_marker)
        if idx > 0:
            table_text = table_text[:idx]
            break

    period_tokens = _extract_period_tokens(table_text)
    if not period_tokens:
        period_tokens = _extract_period_tokens(full_text)
    period_counts = Counter(period_tokens)
    period_month = _most_common_period(period_tokens)
    period_months = sorted(period_counts.keys())

    # 缴费单位识别：兼容用人单位名称/缴费人名称/纳税人名称/缴款单位
    company_match = re.search(r"(?:用人单位名称|缴费人名称|纳税人名称|缴款单位|单位名称)[：:\s]+([^\s\n\r，,。*]+)", full_text)
    tax_no_match = re.search(r"(?:纳税人识别号|缴费人识别号|统一社会信用代码)[：:\s]+([A-Za-z0-9]+)", full_text)

    # 合计实缴/申报金额解析
    total_idx = max(full_text.rfind("合\n计"), full_text.rfind("合计"), full_text.rfind("合 计"))
    total_section = full_text[total_idx:] if total_idx >= 0 else full_text
    total_amounts = [float(v.replace(",", "")) for v in _MONEY_RE.findall(total_section)]
    grand_total = total_amounts[-1] if total_amounts else 0.0

    # 提取缴费人数与基数总额
    emp_count = 0
    base_amount = 0.0

    # 优先匹配官方申报表明细行（如《社会保险费缴费申报表（适用单位缴费人）》）：
    # 格式：费款所属期起止 缴费人数 职工工资总额 缴费基数 费率 本期应缴费额
    # 例如：2026-09 19 44,080.00 98,420.00 16% 15,747.20
    decl_matches = re.findall(
        r"20\d{2}-\d{2}\s+(\d{1,4})\s+[\d,]+\.\d{2}\s+([\d,]+(?:\.\d+)?(?:\s+\d+)?)",
        full_text,
    )
    if decl_matches:
        counts = [int(m[0]) for m in decl_matches if 0 < int(m[0]) < 5000]
        if counts:
            emp_count = Counter(counts).most_common(1)[0][0]
        bases = []
        for m in decl_matches:
            raw_b = re.sub(r"\s+", "", m[1])
            m_num = re.match(r"([\d,]+\.\d{2})", raw_b)
            if m_num:
                b_val = float(m_num.group(1).replace(",", ""))
                if b_val > 1000:
                    bases.append(b_val)
        if bases:
            base_amount = Counter(bases).most_common(1)[0][0]

    if not emp_count:
        count_matches = [int(c) for c in re.findall(r"[\d,]+\.\d{2}\s*(\d{1,3})(?:\D|$)", full_text) if 0 < int(c) < 500]
        if count_matches:
            emp_count = Counter(count_matches).most_common(1)[0][0]
        else:
            m_cnt = re.search(r"(?:缴费人数|参保人数)[：:\s]+(\d+)", full_text)
            if m_cnt:
                emp_count = int(m_cnt.group(1))

    # 基数测算（若未直接从表格中提取到有效基数）：天津标准社保单位+个人比例 38.05% + 大额救助金 (22元/人)
    if base_amount <= 0.0 and grand_total > 0:
        net_amt = grand_total - (emp_count * 22.0 if emp_count > 0 else 0.0)
        if net_amt > 0:
            base_amount = round(net_amt / 0.3805, 2)

    return {
        "success": bool(recognized and period_month and grand_total > 0),
        "recognized": recognized,
        "type": "social_security",
        "company": company_match.group(1).strip() if company_match else "",
        "tax_no": tax_no_match.group(1).strip() if tax_no_match else "",
        "period_month": period_month,
        "period_months": period_months,
        "period_counts": dict(period_counts),
        "emp_count": emp_count,
        "base_amount": base_amount,
        "grand_total": round(grand_total, 2),
        "page_count": len(pages),
        "parse_error": "" if recognized else "PDF is not recognized as a social-security declaration or payment receipt",
    }


def parse_housing_fund_pdf_stream(file_bytes: bytes) -> dict[str, Any]:
    full_text, pages = _extract_pdf_text(file_bytes)
    compact = re.sub(r"\s+", "", full_text)
    recognized = "住房公积金" in compact and any(
        kw in compact for kw in ["受理凭证", "缴存凭证", "缴费凭证", "汇缴凭证", "记账凭证", "凭证", "缴存", "回单"]
    )

    period_tokens = _extract_period_tokens(full_text)
    period_month = _most_common_period(period_tokens)
    period_months = sorted(set(period_tokens))

    period_match = re.search(
        r"(?:缴存年月|费款所属期|税款所属期|所属时期|所属年月|所属期)\s*[:：]?\s*(20\d{2})\s*(?:[/\-.年]\s*(1[0-2]|0[1-9]|[1-9])|(1[0-2]|0[1-9]))(?:\s*月)?(?!\d)",
        full_text,
    )
    if period_match:
        m_val = period_match.group(2) or period_match.group(3)
        explicit_period = normalize_period(period_match.group(1), m_val)
        if not period_month:
            period_month = explicit_period
            period_months = [explicit_period]
        elif explicit_period not in period_months:
            period_months.append(explicit_period)
            period_months.sort()

    company_match = re.search(r"(?:单位名称|缴款单位|缴费人名称|单位全称)[：:\s]+([^\s\n\r，,。*]+)", full_text)
    doc_no_match = re.search(r"凭证编号[：:]?\s*([A-Za-z0-9]+)", full_text)

    # Use the final monetary value and actual contributing headcount in the 项目/汇缴/补缴/调整差额/合计 table.
    table_idx = full_text.rfind("项目")
    amount_section = full_text[table_idx:] if table_idx >= 0 else full_text
    amount_values = [float(v.replace(",", "")) for v in _MONEY_RE.findall(amount_section)]
    total_amount = amount_values[-1] if amount_values else 0.0

    # 优先从“项目/汇缴/合计”结算主表中提取实际参缴人数（避免误匹配到上方业务类别的启封/新开户人数）
    emp_count_match = re.search(r"人数\s+([0-9]+)", amount_section) or re.search(r"人数\s+([0-9]+)", full_text)

    cap_amt_match = re.search(r"缴存金额合计（大写）\s*([^\s]+)", full_text)
    return {
        "success": bool(recognized and period_month and total_amount > 0),
        "recognized": recognized,
        "type": "housing_fund",
        "company": company_match.group(1).strip() if company_match else "",
        "doc_no": doc_no_match.group(1).strip() if doc_no_match else "",
        "period_month": period_month,
        "period_months": period_months,
        "emp_count": int(emp_count_match.group(1)) if emp_count_match else 0,
        "base_amount": round(total_amount / 0.10, 2) if total_amount > 0 else 0.0,
        "total_amount": round(total_amount, 2),
        "cap_amount": cap_amt_match.group(1) if cap_amt_match else "",
        "page_count": len(pages),
        "parse_error": "" if recognized else "PDF is not recognized as a housing-fund receipt",
    }


def expand_upload_entries_to_pdfs(upload_entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expand selected PDF/ZIP inputs to normalized PDF byte entries; ZIP may contain multiple PDFs."""
    pdf_entries: list[dict[str, Any]] = []
    for entry in upload_entries:
        source_name = str(entry.get("file_name") or "").strip()
        raw_bytes = entry.get("raw_bytes")
        if not source_name or not isinstance(raw_bytes, (bytes, bytearray)):
            raise ValueError("Upload entry is missing file_name or raw_bytes")
        raw_bytes = bytes(raw_bytes)
        lower = source_name.lower()
        if lower.endswith(".pdf"):
            pdf_entries.append({"source_name": source_name, "pdf_name": source_name, "pdf_bytes": raw_bytes})
        elif lower.endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(raw_bytes), "r") as zf:
                names = [
                    name for name in zf.namelist()
                    if name.lower().endswith(".pdf") and not name.startswith("__MACOSX") and not name.endswith("/")
                ]
                if not names:
                    raise ValueError(f"ZIP {source_name} contains no PDF files")
                for name in names:
                    pdf_entries.append({
                        "source_name": source_name,
                        "pdf_name": name.rsplit("/", 1)[-1],
                        "pdf_bytes": zf.read(name),
                    })
        else:
            raise ValueError(f"Unsupported proof file type: {source_name}; only PDF/ZIP is allowed")
    if not pdf_entries:
        raise ValueError("No PDF proof files were supplied")
    return pdf_entries


def validate_proof_pdf_batch(proof_type: str, pdf_entries: list[dict[str, Any]], expected_period: str, expected_company: str = "") -> dict[str, Any]:
    if proof_type not in {"social_security", "housing_fund"}:
        raise ValueError(f"Unsupported proof_type: {proof_type}")
    parser = parse_social_security_pdf_stream if proof_type == "social_security" else parse_housing_fund_pdf_stream
    amount_key = "grand_total" if proof_type == "social_security" else "total_amount"
    parsed_files: list[dict[str, Any]] = []
    errors: list[str] = []
    total_amount = 0.0

    for idx, entry in enumerate(pdf_entries, start=1):
        result = parser(entry["pdf_bytes"])
        detected_periods = list(result.get("period_months") or ([result.get("period_month")] if result.get("period_month") else []))
        detected_periods = sorted({p for p in detected_periods if p})
        detected_company = str(result.get("company") or "").strip()
        amount = round(float(result.get(amount_key) or 0.0), 2)
        if not result.get("recognized"):
            errors.append(f"第 {idx} 份【{entry['pdf_name']}】无法识别为目标法定凭证")
        elif expected_company and detected_company and not _is_company_match(expected_company, detected_company):
            errors.append(
                f"第 {idx} 份【{entry['pdf_name']}】凭证缴纳人【{detected_company}】与当前核算公司【{expected_company}】不符，禁止跨公司错传凭证！"
            )
        primary_period = result.get("period_month") or (detected_periods[0] if len(detected_periods) == 1 else "")
        if not detected_periods:
            errors.append(f"第 {idx} 份【{entry['pdf_name']}】无法解析所属期")
        elif primary_period != expected_period and expected_period not in detected_periods:
            errors.append(
                f"第 {idx} 份【{entry['pdf_name']}】所属期为 {primary_period or ', '.join(detected_periods)}，应为 {expected_period}"
            )
        elif primary_period != expected_period:
            errors.append(
                f"第 {idx} 份【{entry['pdf_name']}】主要所属期为 {primary_period}，应为 {expected_period}"
            )
        if amount <= 0:
            errors.append(f"第 {idx} 份【{entry['pdf_name']}】无法解析有效金额")
        total_amount += amount
        parsed_files.append({
            "index": idx,
            "source_name": entry.get("source_name") or entry["pdf_name"],
            "pdf_name": entry["pdf_name"],
            "company": detected_company,
            "period_month": primary_period or result.get("period_month") or "",
            "period_months": [expected_period] if primary_period == expected_period else detected_periods,
            "amount": amount,
            "parse_detail": result,
        })

    total_emp_count = sum(f.get("parse_detail", {}).get("emp_count") or 0 for f in parsed_files)
    total_base_amount = round(sum(f.get("parse_detail", {}).get("base_amount") or 0.0 for f in parsed_files), 2)
    return {
        "success": not errors,
        "expected_period": expected_period,
        "expected_company": expected_company,
        "file_count": len(parsed_files),
        "total_amount": round(total_amount, 2),
        "total_emp_count": total_emp_count,
        "total_base_amount": total_base_amount,
        "files": parsed_files,
        "errors": errors,
    }
