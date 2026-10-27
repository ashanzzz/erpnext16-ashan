import re
import sys
"""Static contract tests for the unified Qifu/Jizhong salary workbench tables."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
app_root = Path(__file__).resolve().parents[2]
inner_pkg = Path(__file__).resolve().parents[1]
if str(app_root) not in sys.path:
    sys.path.insert(0, str(app_root))
import ashan_cn_procurement
if str(inner_pkg) not in ashan_cn_procurement.__path__:
    ashan_cn_procurement.__path__.append(str(inner_pkg))


ROOT = Path(__file__).resolve().parents[3]
if str(ROOT / "ashan_cn_procurement") not in sys.path:
    sys.path.insert(0, str(ROOT / "ashan_cn_procurement"))
QIFU_JS = ROOT / "ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page/qifu_hr_salary_workbench/qifu_hr_salary_workbench.js"
JIZHONG_JS = ROOT / "ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page/jizhong_hr_salary_workbench/jizhong_hr_salary_workbench.js"


class SalaryWorkbenchUiContractTests(unittest.TestCase):
    def test_qifu_employee_master_uses_single_row_detail_columns(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        self.assertFalse("身份资料 (证件号/年龄/性别)" in source)
        for label in ("证件号码", "年龄", "性别", "证件类型"):
            self.assertTrue(f">{label}<" in source, f"Missing column: {label}")

    def test_jizhong_employee_master_matches_qifu_detail_columns(self):
        source = JIZHONG_JS.read_text(encoding="utf-8")
        for label in ("证件号码", "年龄", "性别", "证件类型"):
            self.assertTrue(f">{label}<" in source, f"Missing column: {label}")
        self.assertFalse("显示详细列" in source)

    def test_qifu_employee_rows_have_no_stacked_fields(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        start = source.index("visibleList.forEach((emp, idx) =>")
        end = source.index("$('#tbody-qifu-emp').html(html)", start)
        rows = source[start:end]
        self.assertFalse("qifu-emp-cell-sub" in rows, "Employee attributes must be independent columns")
        for label in ("计薪方式", "固定工资", "职位补贴", "房/车补", "社保方式", "社保基数", "公积金方式", "公积金基数", "原退休年龄", "延迟退休年月", "在职状态"): 
            self.assertTrue(f">{label}<" in source, f"Missing column: {label}")
        self.assertFalse(">长期津贴<" in source, "长期津贴 column must not exist in Qifu employee table")
        self.assertFalse(">部门<" in rows, "Department column must be removed")
        self.assertFalse(">岗位<" in rows, "Job title column must be removed")
        for label in ():
            self.assertTrue(f">{label}<" in source, f"Missing column: {label}")

    def test_jizhong_age_uses_selected_period_not_current_clock(self):
        source = JIZHONG_JS.read_text(encoding="utf-8")
        start = source.index("    function format_employee_age(")
        end = source.index("    function render_employees_table()", start)
        helper = source[start:end]
        self.assertFalse("new Date()" in helper, "Age must use the selected payroll month")
        self.assertTrue("current_month" in helper)

    def test_workbench_sources_contain_no_decorative_emoji(self):
        forbidden = "".join(chr(cp) for cp in (0x23F1, 0x2699, 0x26A0, 0x26D4, 0x2705, 0xFE0F, 0x1F30F, 0x1F3F7, 0x1F474, 0x1F504, 0x1F50D, 0x1F512, 0x1F6AA, 0x1F6E1))
        for path in (QIFU_JS, JIZHONG_JS):
            source = path.read_text(encoding="utf-8")
            self.assertFalse(set(source) & set(forbidden), path.name)



    def test_table_standardization_tokens_defined_in_ui_kit(self):
        ui_kit = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css").read_text(encoding="utf-8")
        tokens = [
            "--ashan-table-font-family",
            "--ashan-table-font-mono",
            "--ashan-table-header-font-size",
            "--ashan-table-header-height",
            "--ashan-table-header-padding",
            "--ashan-table-cell-font-size",
            "--ashan-table-cell-line-height",
            "--ashan-table-row-height",
            "--ashan-table-cell-padding",
            "--ashan-table-cell-vertical-align",
            "--ashan-table-footer-height",
            "--ashan-table-footer-font-size",
        ]
        for token in tokens:
            self.assertTrue(token in ui_kit, f"Missing token: {token}")

    def test_vertical_alignment_middle_enforced_across_tables(self):
        ui_kit = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css").read_text(encoding="utf-8")
        self.assertTrue("--ashan-table-cell-vertical-align: middle;" in ui_kit)
        self.assertTrue("vertical-align: var(--ashan-table-cell-vertical-align) !important;" in ui_kit)

    def test_horizontal_alignment_standard_rules(self):
        ui_kit = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css").read_text(encoding="utf-8")
        # Checkbox, seq, date, status, actions must be centered
        self.assertTrue("text-align: center !important;" in ui_kit)
        # Names, departments, specs must be left
        self.assertTrue("text-align: left !important;" in ui_kit)
        # Amounts, hours, rates must be right
        self.assertTrue("text-align: right !important;" in ui_kit)



    def test_qifu_payroll_settlement_splits_attendance_days_and_hours(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        self.assertFalse("出勤天/工时" in source, "出勤天/工时 must be split into two columns")
        self.assertTrue(">出勤天数<" in source)
        self.assertTrue(">出勤工时<" in source)



    def test_table_fonts_are_unified_without_conflicting_font_overrides(self):
        ui_kit = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css").read_text(encoding="utf-8")
        qifu_css = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page/qifu_hr_salary_workbench/qifu_hr_salary_workbench.css").read_text(encoding="utf-8")
        jz_css = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page/jizhong_hr_salary_workbench/jizhong_hr_salary_workbench.css").read_text(encoding="utf-8")

        # Table elements must inherit var(--ashan-table-font-family)
        self.assertTrue("font-family: var(--ashan-table-font-family)" in ui_kit)

        # Tables must not override numbers or IDs with Consolas or monospace
        self.assertFalse("font-family: Consolas" in qifu_css)
        self.assertFalse("font-family: Consolas" in jz_css)



    def test_qifu_settlement_emp_type_has_no_badge_or_box(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        # In settlement tab render_payroll_view, empType must be plain text
        self.assertFalse("qifu-status-badge ${empType" in source)
        self.assertTrue("<td>${escHtml(empType)}</td>" in source or '<td class="qifu-text-center">${escHtml(empType)}</td>' in source)

    def test_universal_table_sorting_engine_defined(self):
        js = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js").read_text(encoding="utf-8")
        css = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css").read_text(encoding="utf-8")
        self.assertTrue("sortCurrentTable:" in js)
        self.assertTrue("click.ashanTableSort" in js)
        self.assertTrue(".ashan-sort-indicator" in css)



    def test_qifu_social_insurance_and_housing_fund_proof_upload_buttons_exist(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        # Tab 3 Social Security proof upload & verification controls
        self.assertTrue('id="btn-tab3-upload-ss"' in source)
        self.assertTrue('id="tab3-proof-verify-badge"' in source)
        self.assertTrue('id="btn-tab3-view-ss-proof"' in source)

        # Tab 4 Housing Fund proof upload & verification controls
        self.assertTrue('id="btn-tab4-upload-hf"' in source)
        self.assertTrue('id="tab4-proof-verify-badge"' in source)
        self.assertTrue('id="btn-tab4-view-hf-proof"' in source)



    def test_qifu_social_security_and_housing_fund_comparison_panels_and_modals_exist(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        self.assertTrue('id="tab3-proof-compare-panel"' in source)
        self.assertTrue('id="tab4-proof-compare-panel"' in source)
        self.assertTrue("show_social_security_comparison_modal" in source)
        self.assertTrue("show_housing_fund_comparison_modal" in source)
        self.assertTrue("frappe.ui.FileUploader" in source)

    def test_both_workbenches_have_standard_social_and_housing_fund_4_columns(self):
        for path in (QIFU_JS, JIZHONG_JS):
            src = path.read_text(encoding="utf-8")
            for col in (">社保方式<", ">社保基数<", ">公积金方式<", ">公积金基数<", ">公积金周期<"):
                self.assertTrue(col in src, f"{path.name} missing standard column {col}")
            for field_label in ("label: '公积金方式'", "label: '基数'", "label: '周期'"):
                self.assertTrue(field_label in src, f"{path.name} missing dialog setting field {field_label}")

    def test_canonical_insurance_color_classes_enforced(self):
        ui_kit = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/css/ashan_ui_kit.css").read_text(encoding="utf-8")
        required_color_tokens = [
            ".jz-ins-mode-min",
            ".jz-ins-mode-fixed",
            ".jz-ins-mode-dynamic",
            ".jz-ins-mode-none",
            "#15803d", # Green for minimum base
            "#b45309", # Yellow/Amber for fixed base
            "#1d4ed8", # Blue for dynamic base
            "#64748b", # Gray for none
        ]
        for token in required_color_tokens:
            self.assertTrue(token in ui_kit, f"Missing canonical color token: {token}")


    def test_both_workbenches_support_dual_mode_employee_editing(self):
        qifu_src = QIFU_JS.read_text(encoding="utf-8")
        jz_src = JIZHONG_JS.read_text(encoding="utf-8")

        # 1. Jizhong: row-click and action-button-click both open edit dialog
        self.assertTrue("tbody.find('.jz-emp-row').on('click'" in jz_src)
        self.assertTrue("open_jizhong_employee_edit_dialog(emp, false)" in jz_src)
        self.assertTrue("tbody.find('.jz-btn-edit-emp').on('click'" in jz_src)

        # 2. Qifu: row-click and action-button-click both open edit dialog
        self.assertTrue('$container.on("click", "#tbody-qifu-emp tr"' in qifu_src)
        self.assertTrue('$container.on("click", ".btn-edit-emp"' in qifu_src)
        self.assertTrue("handle_qifu_emp_edit" in qifu_src)

    def test_header_wheel_to_horizontal_scroll_registered(self):
        ui_kit_js = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js").read_text(encoding="utf-8")
        jz_src = JIZHONG_JS.read_text(encoding="utf-8")
        qifu_src = QIFU_JS.read_text(encoding="utf-8")

        # Global delegation in ui_kit_js
        self.assertTrue("wheel.ashanHeaderScroll" in ui_kit_js)
        self.assertTrue("scrollLeft += dy" in ui_kit_js)

        # Page-level listeners in Jizhong and Qifu
        self.assertTrue(".jz-table thead, .jz-table-box thead" in jz_src)
        self.assertTrue(".qifu-table thead" in qifu_src)


    def test_housing_fund_dynamic_base_rate_is_5_percent(self):
        qifu_src = QIFU_JS.read_text(encoding="utf-8")
        jz_src = JIZHONG_JS.read_text(encoding="utf-8")

        for path_name, src in (("Qifu", qifu_src), ("Jizhong", jz_src)):
            self.assertTrue("动态基数(税前工资5%)" in src, f"{path_name} missing 动态基数(税前工资5%)")
            self.assertTrue("动态基数(税前工资20%)" in src, f"{path_name} missing 动态基数(税前工资20%) for SS")

    def test_multiselect_mode_row_click_selects_not_edits(self):
        qifu_src = QIFU_JS.read_text(encoding="utf-8")
        jz_src = JIZHONG_JS.read_text(encoding="utf-8")

        # Jizhong checks selected_emp_nos.size > 0
        self.assertTrue("selected_emp_nos.size > 0" in jz_src)
        # Qifu checks tab1-emp-check:checked
        self.assertTrue(".tab1-emp-check:checked" in qifu_src)


    def test_jizhong_policy_panel_always_expanded_and_sheet_header_format(self):
        jz_src = JIZHONG_JS.read_text(encoding="utf-8")
        # 1. Policy panel always expanded, no toggle button, no decorative clutter, has setting button
        self.assertFalse('id="btn-jz-toggle-policy"' in jz_src)
        self.assertFalse("收起政策参数" in jz_src)
        self.assertFalse("核定账期与实际缴费所属期分开管理" in jz_src)
        self.assertTrue('id="btn-jz-edit-policy-setting"' in jz_src)
        # 2. Proof upload & auto-verification workflow controls
        self.assertTrue('id="btn-jz-upload-proof"' in jz_src)
        self.assertTrue('id="jz-ss-proof-badge"' in jz_src)
        self.assertTrue('id="jz-hf-proof-badge"' in jz_src)
        # 3. Sheet header format
        self.assertTrue("社会保险明细" in jz_src)
        self.assertTrue("住房公积金明细" in jz_src)
        self.assertTrue("（其中：正式工" in jz_src)


    def test_live_pdf_parsing_and_company_matching(self):
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        if str(inner) not in sys.path:
            sys.path.insert(0, str(inner))
        from services.payroll_proof_validation import (
            parse_social_security_pdf_stream,
            validate_proof_pdf_batch,
            expand_upload_entries_to_pdfs
        )
        pdf_path = Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津吉众科技有限公司/月报表/202608/202608吉众社保缴费记录.pdf")
        if not pdf_path.exists():
            return
        raw = pdf_path.read_bytes()
        res = parse_social_security_pdf_stream(raw)
        self.assertTrue(res["success"])
        self.assertEqual(res["company"], "天津吉众科技有限公司")
        self.assertEqual(res["period_month"], "2026-08")
        self.assertEqual(res["grand_total"], 37461.92)

        # Matching company passes
        entries = expand_upload_entries_to_pdfs([{"file_name": pdf_path.name, "raw_bytes": raw}])
        valid_res = validate_proof_pdf_batch("social_security", entries, "2026-08", expected_company="天津吉众科技有限公司")
        self.assertTrue(valid_res["success"])
        self.assertEqual(valid_res["total_amount"], 37461.92)

        # Mismatched company fails
        mismatch_res = validate_proof_pdf_batch("social_security", entries, "2026-08", expected_company="天津市祺富机械加工有限公司")
        self.assertFalse(mismatch_res["success"])
        self.assertTrue("不符，禁止跨公司错传凭证" in mismatch_res["errors"][0])

    def test_social_security_parser_supports_qifu_and_jizhong(self):
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        if str(inner) not in sys.path:
            sys.path.insert(0, str(inner))
        from services.payroll_proof_validation import (
            expand_upload_entries_to_pdfs,
            validate_proof_pdf_batch,
        )

        fixtures = [
            (
                Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津吉众科技有限公司/月报表/202608/202608吉众社保缴费记录.pdf"),
                "2026-08",
                "天津吉众科技有限公司",
                37461.92,
                19,
            ),
            (
                Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津吉众科技有限公司/月报表/202609/社会保险费缴费申报表（适用单位缴费人）.pdf"),
                "2026-09",
                "天津吉众科技有限公司",
                37866.81,
                19,
            ),
            (
                Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202608/202608祺富社保缴费凭证.pdf"),
                "2026-08",
                "天津祺富机械加工有限公司",
                35490.24,
                18,
            ),
            (
                Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202609/社会保险费缴费申报表（适用单位缴费人）.pdf"),
                "2026-09",
                "天津祺富机械加工有限公司",
                35873.82,
                18,
            ),
            (
                Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津吉众科技有限公司/月报表/202610/202610吉众社保缴费记录.pdf"),
                "2026-10",
                "天津吉众科技有限公司",
                37847.81,
                19,
            ),
        ]

        for pdf_path, period, company, expected_amount, expected_count in fixtures:
            if not pdf_path.exists():
                continue
            entries = expand_upload_entries_to_pdfs([
                {"file_name": pdf_path.name, "raw_bytes": pdf_path.read_bytes()}
            ])
            result = validate_proof_pdf_batch(
                "social_security",
                entries,
                period,
                expected_company=company,
            )
            self.assertTrue(result["success"], result["errors"])
            self.assertEqual(result["total_amount"], expected_amount)
            self.assertEqual(result["total_emp_count"], expected_count)

    def test_live_pdf_declaration_form_parsing(self):
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        if str(inner) not in sys.path:
            sys.path.insert(0, str(inner))
        from services.payroll_proof_validation import parse_social_security_pdf_stream
        decl_pdf_path = Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津吉众科技有限公司/月报表/202609/社会保险费缴费申报表（适用单位缴费人）.pdf")
        if decl_pdf_path.exists():
            decl_raw = decl_pdf_path.read_bytes()
            decl_res = parse_social_security_pdf_stream(decl_raw)
            self.assertTrue(decl_res["success"])
            self.assertEqual(decl_res["company"], "天津吉众科技有限公司")
            self.assertEqual(decl_res["period_month"], "2026-09")
            self.assertEqual(decl_res["emp_count"], 19)
            self.assertEqual(decl_res["base_amount"], 98420.00)
            self.assertEqual(decl_res["grand_total"], 37866.81)

    def test_housing_fund_parser_october(self):
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        if str(inner) not in sys.path:
            sys.path.insert(0, str(inner))
        from services.payroll_proof_validation import (
            expand_upload_entries_to_pdfs,
            validate_proof_pdf_batch,
            parse_housing_fund_pdf_stream,
        )
        hf_path = Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津吉众科技有限公司/月报表/202610/202610吉众公积金缴费记录.pdf")
        if hf_path.exists():
            raw = hf_path.read_bytes()
            res = parse_housing_fund_pdf_stream(raw)
            self.assertTrue(res["success"])
            self.assertEqual(res["company"], "天津吉众科技有限公司")
            self.assertEqual(res["period_month"], "2026-10")
            self.assertEqual(res["total_amount"], 7972.00)
            self.assertEqual(res["emp_count"], 17)

            entries = expand_upload_entries_to_pdfs([{"file_name": hf_path.name, "raw_bytes": raw}])
            valid_res = validate_proof_pdf_batch("housing_fund", entries, "2026-10", expected_company="天津吉众科技有限公司")
            self.assertTrue(valid_res["success"], valid_res["errors"])
            self.assertEqual(valid_res["total_amount"], 7972.00)

    def test_qifu_202608_social_security_proof_parsing(self):
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        if str(inner) not in sys.path:
            sys.path.insert(0, str(inner))
        from services.payroll_proof_validation import (
            parse_social_security_pdf_stream,
            validate_proof_pdf_batch,
            expand_upload_entries_to_pdfs,
            expected_proof_period,
        )
        self.assertEqual(expected_proof_period("2026-07"), "2026-08")
        pdf_path = Path(r"D:/SynologyDrive/Cloud Sync/OneDrive-zeros/工作/天津祺富机械加工有限公司/月报表-孟/202608/202608祺富社保缴费凭证.pdf")
        if not pdf_path.exists():
            return
        raw = pdf_path.read_bytes()
        res = parse_social_security_pdf_stream(raw)
        self.assertTrue(res["success"], res.get("parse_error"))
        self.assertEqual(res["company"], "天津祺富机械加工有限公司")
        self.assertEqual(res["period_month"], "2026-08")
        self.assertEqual(res["period_months"], ["2026-08"])
        self.assertEqual(res["grand_total"], 35490.24)
        self.assertEqual(res["emp_count"], 18)
        self.assertEqual(res["base_amount"], 92232.00)

        entries = expand_upload_entries_to_pdfs([{"file_name": pdf_path.name, "raw_bytes": raw}])
        val = validate_proof_pdf_batch("social_security", entries, "2026-08", expected_company="天津祺富机械加工有限公司")
        self.assertTrue(val["success"], val.get("errors"))
        self.assertEqual(val["total_amount"], 35490.24)
        self.assertEqual(val["total_emp_count"], 18)
        self.assertEqual(val["total_base_amount"], 92232.00)

    def test_period_token_extraction_all_months(self):
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        if str(inner) not in sys.path:
            sys.path.insert(0, str(inner))
        from services.payroll_proof_validation import _extract_period_tokens

        for m in range(1, 13):
            expected = f"2026-{m:02d}"
            tokens_dash = _extract_period_tokens(f"费款所属期：2026-{m:02d}")
            self.assertEqual(tokens_dash, [expected], f"Failed on month {m} with dash")

            tokens_slash = _extract_period_tokens(f"缴存年月 2026/{m:02d}")
            self.assertEqual(tokens_slash, [expected], f"Failed on month {m} with slash")

            tokens_cn = _extract_period_tokens(f"税款所属期 2026年{m}月")
            self.assertEqual(tokens_cn, [expected], f"Failed on month {m} with Chinese")

        # Ensure print date / daily date does not get parsed as a month token
        tokens_date = _extract_period_tokens("制发日期：2026年10月10日")
        self.assertEqual(tokens_date, [])

    def test_jizhong_workflow_step_dependencies(self):
        py_path = ROOT / "ashan_cn_procurement/ashan_cn_procurement/services/jizhong_payroll_service.py"
        source = py_path.read_text(encoding="utf-8")
        self.assertIn('"attendance": ("employees",)', source)
        self.assertIn('"social_insurance": ("employees",)', source)
        self.assertIn('"housing_fund": ("employees",)', source)
        self.assertIn('"tax": ("employees", "attendance", "social_insurance", "housing_fund")', source)
        self.assertIn('"cash_bills": ("tax",)', source)

    def test_attendance_confirmed_clear_and_upload_blocked(self):
        att_py = ROOT / "ashan_cn_procurement/ashan_cn_procurement/services/jizhong_attendance_service.py"
        att_source = att_py.read_text(encoding="utf-8")
        self.assertIn('confirmations_check["attendance"]["confirmed"]', att_source)
        self.assertIn('考勤与工时已核定确认，严禁清空', att_source)
        self.assertIn('考勤与工时已核定确认，严禁重新上传', att_source)

        js_source = JIZHONG_JS.read_text(encoding="utf-8")
        self.assertIn("当前考勤与工时已核定确认，严禁清空", js_source)
        self.assertIn("当前考勤与工时已核定确认，严禁重新上传", js_source)
        self.assertIn("isAttConfirmed", js_source)

    def test_jizhong_formula_inspector_contract(self):
        js_source = JIZHONG_JS.read_text(encoding="utf-8")
        self.assertIn("jz-formula-cell", js_source)
        self.assertIn("show_payroll_formula_popover", js_source)
        self.assertIn("toFixed(2)", js_source)
        self.assertIn("data-formula-field", js_source)
        self.assertIn("jz-formula-popover-line", js_source)
        self.assertNotIn("计算结果</span>", js_source)
        self.assertIn("基本工资 ÷ 固定月计薪工时", js_source)
        self.assertIn("病假工资 = 基本工资 × 80.00%", js_source)

        py_source = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/services/jizhong_payroll_service.py").read_text(encoding="utf-8")
        self.assertIn("formula_dynamic_work_hours", py_source)
        self.assertIn("formula_fixed_monthly_hours", py_source)

    def test_jizhong_sick_leave_columns_contract(self):
        js_source = JIZHONG_JS.read_text(encoding="utf-8")
        self.assertIn(">病假天数<", js_source)
        self.assertIn(">病假工资<", js_source)
        self.assertIn("Jizhong Employee Type Policy", js_source)

        py_source = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/services/jizhong_payroll_service.py").read_text(encoding="utf-8")
        self.assertIn("sal_sick = round(base_sal * 0.8, 2)", py_source)
        self.assertIn('"salary_sick_leave": sal_sick', py_source)


    def test_housing_fund_statutory_round_half_up_contract(self):
        """验证住房公积金国家标准 GB/T 51271-2017: 以元为单位，元以下四舍五入(分别计算)"""
        if "frappe" not in sys.modules:
            import types
            from datetime import timedelta
            mock_frappe = types.ModuleType("frappe")
            mock_frappe.throw = lambda msg: (_ for _ in ()).throw(ValueError(msg))
            mock_frappe.whitelist = lambda *a, **k: (lambda fn: fn)
            mock_frappe._ = lambda msg: msg
            mock_frappe.db = types.SimpleNamespace(exists=lambda *a, **k: False, get_value=lambda *a, **k: None)
            mock_utils = types.ModuleType("frappe.utils")
            mock_utils.flt = lambda v=0: float(v or 0)
            mock_utils.cint = lambda v=0: int(v or 0)
            mock_utils.now_datetime = lambda: None
            mock_utils.getdate = lambda v: v
            mock_utils.today = lambda: "2026-10-22"
            mock_utils.add_days = lambda d, days: d
            mock_utils.date_diff = lambda d1, d2: 0
            mock_frappe.utils = mock_utils
            sys.modules["frappe"] = mock_frappe
            sys.modules["frappe.utils"] = mock_utils

        import importlib.util
        from decimal import Decimal, ROUND_HALF_UP
        inner = ROOT / "ashan_cn_procurement/ashan_cn_procurement"
        pe_path = inner / "ashan_cn_procurement/payroll_engine.py"
        pe_spec = importlib.util.spec_from_file_location("pe_engine", str(pe_path))
        pe_mod = importlib.util.module_from_spec(pe_spec)
        pe_spec.loader.exec_module(pe_mod)
        AshanPayrollCalculator = pe_mod.AshanPayrollCalculator
        round_housing_fund_amount = pe_mod.round_housing_fund_amount
        qifu_round_hf = pe_mod.round_housing_fund_amount
        def jizhong_round_hf(base, rate):
            r = float(rate) / 100.0 if float(rate) > 1.0 else float(rate)
            return float((Decimal(str(float(base))) * Decimal(str(r))).quantize(Decimal("1"), rounding=ROUND_HALF_UP))

        # 1. 基数 2510, 费率 5%: 2510 * 0.05 = 125.5 -> 四舍五入到元为 126.0
        calc_res = AshanPayrollCalculator.calculate_housing_fund(2510.0, 0.05)
        self.assertEqual(calc_res["fund_p"], 126.0)
        self.assertEqual(calc_res["fund_c"], 126.0)
        self.assertEqual(calc_res["total"], 252.0)

        self.assertEqual(qifu_round_hf(2510.0, 5.0), 126.0)
        self.assertEqual(qifu_round_hf(2510.0, 0.05), 126.0)
        self.assertEqual(jizhong_round_hf(2510.0, 5.0), 126.0)
        self.assertEqual(jizhong_round_hf(2510.0, 0.05), 126.0)

        # 2. 基数 20000, 费率 5%: 20000 * 0.05 = 1000.0
        calc_top = AshanPayrollCalculator.calculate_housing_fund(20000.0, 0.05)
        self.assertEqual(calc_top["fund_p"], 1000.0)
        self.assertEqual(calc_top["fund_c"], 1000.0)
        self.assertEqual(calc_top["total"], 2000.0)

        # 3. 2026年10月天津祺富 18 人全景凭证守恒验证 (17 人基数 2510 + 1 人基数 20000)
        total_p = 17 * qifu_round_hf(2510.0, 5.0) + qifu_round_hf(20000.0, 5.0)
        total_c = 17 * qifu_round_hf(2510.0, 5.0) + qifu_round_hf(20000.0, 5.0)
        grand_total = total_p + total_c
        self.assertEqual(total_p, 3142.0)
        self.assertEqual(total_c, 3142.0)
        self.assertEqual(grand_total, 6284.0)

        # 4. 四舍五入临界值校验 (ROUND_HALF_UP)
        # 2509 * 0.05 = 125.45 -> 125.0
        self.assertEqual(qifu_round_hf(2509.0, 0.05), 125.0)
        # 2511 * 0.05 = 125.55 -> 126.0
        self.assertEqual(qifu_round_hf(2511.0, 0.05), 126.0)
        # 2530 * 0.05 = 126.50 -> 必须进位为 127.0 (规避 Python 银行家舍入五成双陷阱)
        self.assertEqual(qifu_round_hf(2530.0, 0.05), 127.0)
        self.assertEqual(jizhong_round_hf(2530.0, 0.05), 127.0)

    def test_qifu_personnel_scope_segmented_control_contract(self):
        source = QIFU_JS.read_text(encoding="utf-8")
        ui_kit = (ROOT / "ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js").read_text(encoding="utf-8")

        # 1. 严禁对分段控件外壳 div 调用 .val()
        self.assertNotIn("$('#qifu-emp-type-filter').val()", source, "Must not call .val() on segmented control div")
        self.assertNotIn("$(\"#qifu-emp-type-filter\").val()", source)

        # 2. 严禁残留幽灵过滤选择器
        self.assertNotIn("#qifu-emp-status-filter", source)
        self.assertNotIn("#qifu-emp-ret-filter", source)
        self.assertNotIn("#qifu-emp-profile-filter", source)

        # 3. 分段控件必须包含全员底册与五大纯净用工性质分类按钮
        for dt in ('data-type="all"', 'data-type="正式工"', 'data-type="返聘工"', 'data-type="其他"', 'data-type="临时工"', 'data-type="resigned"'):
            self.assertIn(dt, source, f"qifu-emp-type-filter must include {dt}")

        # 4. 离职员工芯片人数必须同步更新
        self.assertTrue("$('#tab1-type-resigned').text(resignedList.length)" in source or "resignedList.length" in source)

        # 5. AshanUI Kit 必须导出 getSegmentedValue 与 setSegmentedValue
        self.assertIn("getSegmentedValue: function", ui_kit)
        self.assertIn("setSegmentedValue: function", ui_kit)
        self.assertIn("ashan-segmented-control", ui_kit)

    def test_overtime_and_meal_allowance_decoupling(self):
        from ashan_cn_procurement.services.payroll_excel_import_service import extract_overtime_and_meal_allowance

        res1 = extract_overtime_and_meal_allowance(
            ot_hours=0.0,
            raw_ot_salary=405.0,
            ot_formula="=+H23*15+405",
            remarks="含餐补27*15=405",
            work_days=27.0
        )
        self.assertEqual(res1["overtime_salary"], 0.0, "Pure overtime pay must be 0 for 0 overtime hours")
        self.assertEqual(res1["meal_allowance"], 405.0, "Meal allowance must be decoupled as 405.0")
        self.assertEqual(res1["meal_count"], 27)
        self.assertEqual(res1["meal_unit_price"], 15.0)
        self.assertEqual(res1["raw_overtime_salary"], 405.0)
        self.assertTrue(res1["has_embedded_meal"])

        res2 = extract_overtime_and_meal_allowance(
            ot_hours=4.5,
            raw_ot_salary=67.5,
            ot_formula="=+H6*15",
            remarks="",
            work_days=26.0
        )
        self.assertEqual(res2["overtime_salary"], 67.5)
        self.assertEqual(res2["meal_allowance"], 0.0)
        self.assertFalse(res2["has_embedded_meal"])

        res3 = extract_overtime_and_meal_allowance(
            ot_hours=10.0,
            raw_ot_salary=450.0,
            ot_formula="=+H5*15+300",
            remarks="含餐补20*15=300",
            work_days=25.0
        )
        self.assertEqual(res3["overtime_salary"], 150.0)
        self.assertEqual(res3["meal_allowance"], 300.0)
        self.assertEqual(res3["meal_count"], 20)
        self.assertEqual(res3["meal_unit_price"], 15.0)
        self.assertEqual(res3["raw_overtime_salary"], 450.0)
        self.assertTrue(res3["has_embedded_meal"])


    def test_no_unscoped_global_selectors_in_page_css(self):
        """Ensure page-level CSS files never leak unscoped global Desk selectors."""
        page_dir = ROOT / "ashan_cn_procurement/ashan_cn_procurement/ashan_cn_procurement/page"
        dangerous_patterns = [
            re.compile(r"^\s*(?:\.page-head|\.page-body|\.standard-actions|\.primary-action|\.layout-main)\s*[{,]", re.M),
            re.compile(r"^\s*(?:\.modal\.fade|\.modal-dialog|\.modal-content)\s*[{,]", re.M),
        ]
        violations = []
        for p in page_dir.rglob("*.css"):
            content = p.read_text(encoding="utf-8", errors="ignore")
            for i, line in enumerate(content.splitlines(), 1):
                for pat in dangerous_patterns:
                    if pat.search(line):
                        violations.append(f"{p.name}:{i} -> {line.strip()}")
        self.assertEqual(violations, [], f"Unscoped dangerous CSS selectors found in page CSS: {violations}")

if __name__ == "__main__":
    unittest.main()