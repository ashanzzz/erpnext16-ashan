import sys
"""Static contract tests for the unified Qifu/Jizhong salary workbench tables."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[3]
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
        for label in ("部门", "计薪方式", "固定工资", "长期津贴", "社保方式", "社保基数", "公积金方式", "公积金基数", "原退休年龄", "延迟退休年月", "在职状态"):
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
        self.assertTrue("<td>${escHtml(empType)}</td>" in source)

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

if __name__ == "__main__":
    unittest.main()
