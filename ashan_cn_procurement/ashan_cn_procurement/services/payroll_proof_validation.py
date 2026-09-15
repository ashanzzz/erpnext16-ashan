from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from typing import Any

from pypdf import PdfReader

_PERIOD_TOKEN_RE = re.compile(r"(?<!\d)(20\d{2})\s*[-/]\s*(0?[1-9]|1[0-2])")
_CN_PERIOD_TOKEN_RE = re.compile(r"(?<!\d)(20\d{2})\s*年\s*(0?[1-9]|1[0-2])\s*月")
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
    pages = [(page.extract_text() or "") for page in reader.pages]
    return "\n".join(pages), pages


def _extract_period_tokens(text: str) -> list[str]:
    periods: list[str] = []
    periods.extend(normalize_period(y, m) for y, m in _PERIOD_TOKEN_RE.findall(text or ""))
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


def parse_social_security_pdf_stream(file_bytes: bytes) -> dict[str, Any]:
    full_text, pages = _extract_pdf_text(file_bytes)
    compact = re.sub(r"\s+", "", full_text)
    recognized = "社会保险费缴费申报表" in compact and "用人单位名称" in compact

    # Only use the declaration-table region for the fee period. This avoids treating
    # 受理日期/打印日期 as the statutory 费款所属期.
    table_text = full_text
    for stop_marker in ("缴\n费\n人\n声\n明", "缴费人声明", "*受理税务机关"):
        idx = table_text.find(stop_marker)
        if idx > 0:
            table_text = table_text[:idx]
            break

    period_tokens = _extract_period_tokens(table_text)
    period_counts = Counter(period_tokens)
    period_month = _most_common_period(period_tokens)
    period_months = sorted(period_counts.keys())

    company_match = re.search(r"用人单位名称[：:]?\s*([^\s*]+)", full_text)
    tax_no_match = re.search(r"纳税人识别号[：:]?\s*([A-Za-z0-9]+)", full_text)

    # The authoritative amount is the last decimal number in the final 合计 block,
    # corresponding to *本期实际应缴纳费额. Do not use arbitrary last-number fallback
    # on non-social-security PDFs.
    total_idx = max(full_text.rfind("合\n计"), full_text.rfind("合计"))
    total_section = full_text[total_idx:] if total_idx >= 0 else ""
    total_amounts = [float(v.replace(",", "")) for v in _MONEY_RE.findall(total_section)]
    grand_total = total_amounts[-1] if total_amounts else 0.0

    return {
        "success": bool(recognized and period_month and grand_total > 0),
        "recognized": recognized,
        "type": "social_security",
        "company": company_match.group(1).strip() if company_match else "",
        "tax_no": tax_no_match.group(1).strip() if tax_no_match else "",
        "period_month": period_month,
        "period_months": period_months,
        "period_counts": dict(period_counts),
        "grand_total": round(grand_total, 2),
        "page_count": len(pages),
        "parse_error": "" if recognized else "PDF is not recognized as a social-security declaration form",
    }


def parse_housing_fund_pdf_stream(file_bytes: bytes) -> dict[str, Any]:
    full_text, pages = _extract_pdf_text(file_bytes)
    compact = re.sub(r"\s+", "", full_text)
    recognized = "住房公积金" in compact and "受理凭证" in compact

    period_match = re.search(
        r"缴存年月\s*[:：]?\s*(20\d{2})\s*[/\-年]\s*(0?[1-9]|1[0-2])(?:\s*月)?",
        full_text,
    )
    if period_match:
        period_month = normalize_period(period_match.group(1), period_match.group(2))
        period_months = [period_month]
    else:
        # Fallback for PDFs whose embedded font/text layout separates the field label.
        period_tokens = _extract_period_tokens(full_text)
        period_month = _most_common_period(period_tokens)
        period_months = sorted(set(period_tokens))

    company_match = re.search(r"单位名称\s*[:：]?\s*([^\n]+)", full_text)
    doc_no_match = re.search(r"凭证编号[：:]?\s*([A-Za-z0-9]+)", full_text)
    emp_count_match = re.search(r"人数\s+([0-9]+)", full_text)

    # Use the final monetary value in the 项目/汇缴/补缴/调整差额/合计 table.
    table_idx = full_text.rfind("项目")
    amount_section = full_text[table_idx:] if table_idx >= 0 else full_text
    amount_values = [float(v.replace(",", "")) for v in _MONEY_RE.findall(amount_section)]
    total_amount = amount_values[-1] if amount_values else 0.0

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


def validate_proof_pdf_batch(proof_type: str, pdf_entries: list[dict[str, Any]], expected_period: str) -> dict[str, Any]:
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
        amount = round(float(result.get(amount_key) or 0.0), 2)
        if not result.get("recognized"):
            errors.append(f"第 {idx} 份【{entry['pdf_name']}】无法识别为目标法定凭证")
        elif not detected_periods:
            errors.append(f"第 {idx} 份【{entry['pdf_name']}】无法解析所属期")
        elif detected_periods != [expected_period]:
            errors.append(
                f"第 {idx} 份【{entry['pdf_name']}】所属期为 {', '.join(detected_periods)}，应为 {expected_period}"
            )
        if amount <= 0:
            errors.append(f"第 {idx} 份【{entry['pdf_name']}】无法解析有效金额")
        total_amount += amount
        parsed_files.append({
            "index": idx,
            "source_name": entry.get("source_name") or entry["pdf_name"],
            "pdf_name": entry["pdf_name"],
            "period_month": result.get("period_month") or "",
            "period_months": detected_periods,
            "amount": amount,
            "parse_detail": result,
        })

    return {
        "success": not errors,
        "expected_period": expected_period,
        "file_count": len(parsed_files),
        "total_amount": round(total_amount, 2),
        "files": parsed_files,
        "errors": errors,
    }
