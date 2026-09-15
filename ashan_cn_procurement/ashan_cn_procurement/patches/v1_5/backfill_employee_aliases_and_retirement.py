import re
import frappe


KNOWN_ALIASES = {
    ("天津祺富机械加工有限公司", "A0016"): [("张引娣", "外部实发表历史写法")],
    ("天津祺富机械加工有限公司", "A0003"): [("刘海峰", "外部实发表历史写法")],
    ("天津祺富机械加工有限公司", "Z0005"): [("徐经理", "外部实发表称谓")],
}


def _split(value):
    result = []
    seen = set()
    for part in re.split(r"[,，;；/、\n\r]+", str(value or "")):
        text = part.strip()
        key = re.sub(r"\s+", "", text).lower()
        if text and key not in seen:
            seen.add(key)
            result.append(text)
    return result


def _looks_like_prc_id(value):
    text = str(value or "").strip().upper()
    return bool(re.fullmatch(r"\d{15}|\d{17}[\dX]", text))


def execute():
    """Upgrade V3-V5 payroll masters to structured aliases and refresh identity/retirement fields."""
    frappe.reload_doc("ashan_cn_procurement", "doctype", "ashan_employee_name_alias", force=True)
    frappe.reload_doc("ashan_cn_procurement", "doctype", "ashan_employee_salary_profile", force=True)

    if not frappe.db.exists("DocType", "Ashan Employee Salary Profile"):
        return

    names = frappe.get_all("Ashan Employee Salary Profile", pluck="name")
    for name in names:
        doc = frappe.get_doc("Ashan Employee Salary Profile", name)

        # Old data pre-dates certificate_type. Avoid treating known passport/foreign IDs as PRC IDs.
        if not getattr(doc, "certificate_type", None):
            if _looks_like_prc_id(doc.id_card):
                doc.certificate_type = "中国居民身份证"
            elif doc.id_card:
                doc.certificate_type = "护照"
            else:
                doc.certificate_type = "其他证件"
        elif doc.certificate_type == "中国居民身份证" and doc.id_card and not _looks_like_prc_id(doc.id_card):
            # Existing non-PRC identifiers such as E2669993 were imported before the field existed.
            doc.certificate_type = "护照"

        current = []
        notes = {}
        for row in list(getattr(doc, "name_aliases", None) or []):
            alias = str(row.alias_name or "").strip()
            if alias:
                current.append(alias)
                notes[re.sub(r"\s+", "", alias).lower()] = str(row.alias_note or "").strip()
        if not current:
            current.extend(_split(getattr(doc, "external_name_aliases", "")))

        for alias, note in KNOWN_ALIASES.get((doc.company, doc.employee_no), []):
            current.append(alias)
            notes[re.sub(r"\s+", "", alias).lower()] = note

        primary_key = re.sub(r"\s+", "", str(doc.employee_name or "")).lower()
        cleaned = []
        seen = set()
        for alias in current:
            key = re.sub(r"\s+", "", alias).lower()
            if not key or key == primary_key or key in seen:
                continue
            seen.add(key)
            cleaned.append(alias)

        doc.set("name_aliases", [])
        for alias in cleaned:
            doc.append("name_aliases", {
                "alias_name": alias,
                "alias_note": notes.get(re.sub(r"\s+", "", alias).lower(), "历史外部工资表兼容"),
            })
        doc.external_name_aliases = "\n".join(cleaned)

        if doc.certificate_type != "中国居民身份证":
            if (doc.company, doc.employee_no) == ("天津祺富机械加工有限公司", "Y0001") or doc.id_card == "E2669993":
                if not doc.birth_date:
                    doc.birth_date = "1984-04-23"
                if not doc.gender:
                    doc.gender = "女"

        # validate() re-derives birth date/gender for valid PRC IDs, current age and retirement fields.
        # Female 50/55 category remains a personnel confirmation item instead of being guessed from job title.
        doc.flags.ignore_version = True
        doc.flags.skip_alias_uniqueness = True
        doc.flags.skip_birth_validation = True
        doc.save(ignore_permissions=True)

    frappe.db.commit()
