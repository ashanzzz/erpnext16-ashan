# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import io
from datetime import datetime
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

import frappe
from frappe import _
from frappe.utils import flt, getdate, today
from ashan_cn_procurement.services.permission_query_service import assert_doctype_permission


# 统一 Ashan 工业级报表样式 Token
FONT_FAMILY = "Microsoft YaHei"
HEADER_FILL = PatternFill(start_color="F1F5F9", end_color="F1F5F9", fill_type="solid")
SUBHEADER_FILL = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
TOTAL_FILL = PatternFill(start_color="E2E8F0", end_color="E2E8F0", fill_type="solid")
HIGHLIGHT_FILL = PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid")

THIN_BORDER = Border(
    left=Side('thin', color='CBD5E1'),
    right=Side('thin', color='CBD5E1'),
    top=Side('thin', color='CBD5E1'),
    bottom=Side('thin', color='CBD5E1')
)
DOUBLE_BOTTOM_BORDER = Border(
    left=Side('thin', color='CBD5E1'),
    right=Side('thin', color='CBD5E1'),
    top=Side('thin', color='CBD5E1'),
    bottom=Side('double', color='0F172A')
)

CURRENCY_FORMAT = '¥#,##0.00'
PERCENT_FORMAT = '0.0%'


def _style_header_row(ws, row_idx, max_col):
    for col in range(1, max_col + 1):
        cell = ws.cell(row=row_idx, column=col)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True, color="1E293B")
        cell.fill = HEADER_FILL
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = THIN_BORDER
    ws.row_dimensions[row_idx].height = 28


def _auto_fit_columns(ws, max_col):
    for col in range(1, max_col + 1):
        col_letter = get_column_letter(col)
        max_len = 0
        for row in range(1, ws.max_row + 1):
            val = ws.cell(row=row, column=col).value
            if val is not None:
                # 针对中文字符做 1.5 宽度倍率估算
                str_val = str(val)
                val_len = sum(2 if ord(c) > 127 else 1 for c in str_val)
                if val_len > max_len:
                    max_len = val_len
        ws.column_dimensions[col_letter].width = max(max_len + 3, 11)


@frappe.whitelist(methods=["GET", "POST"])
def export_qifu_billing_excel(period_month=None):
    """导出天津祺富机械加工有限公司现金大账与科目分析 .xlsx"""
    assert_doctype_permission("Purchase Invoice", "read")
    from ashan_cn_procurement.ashan_cn_procurement.page.qifu_billing_workbench.qifu_billing_workbench import get_qifu_billing_data
    
    data = get_qifu_billing_data(period_month=period_month)
    period = data.get("period_month") or today()[:7]
    company = data.get("company")
    stream_rows = data.get("stream_rows") or []
    cat_summary = data.get("category_summary") or []
    summary = data.get("summary") or {}

    wb = openpyxl.Workbook()
    
    # ----------------- Sheet 1: 现金流水明细账 -----------------
    ws1 = wb.active
    ws1.title = "现金流水明细账"
    ws1.views.sheetView[0].showGridLines = True

    # 标题行
    ws1.merge_cells("A1:M1")
    title_cell = ws1.cell(row=1, column=1, value=f"{company} · 现金流水明细账 ({period})")
    title_cell.font = Font(name=FONT_FAMILY, size=14, bold=True, color="0F172A")
    title_cell.alignment = Alignment(horizontal="center", vertical="center")
    ws1.row_dimensions[1].height = 36

    # 表头
    headers = [
        "序号", "记账日期", "单据日期", "项目/收款单位", "规格描述",
        "流向", "发生金额", "动态结存余额", "费用科目", "经办/报销人",
        "发票号", "用途备注说明", "关联单号"
    ]
    for col_idx, h in enumerate(headers, 1):
        ws1.cell(row=2, column=col_idx, value=h)
    _style_header_row(ws1, 2, len(headers))

    # 首行：上月结转 (期初)
    r_idx = 3
    opening_bal = flt(summary.get("opening_balance") or 0.0)
    ws1.cell(row=r_idx, column=1, value=0)
    ws1.cell(row=r_idx, column=2, value=f"{period}-01")
    ws1.cell(row=r_idx, column=3, value=f"{period}-01")
    ws1.cell(row=r_idx, column=4, value="【上期结转 (期初余额)】")
    ws1.cell(row=r_idx, column=5, value="资金初始结存")
    ws1.cell(row=r_idx, column=6, value="期初")
    c_amt = ws1.cell(row=r_idx, column=7, value=opening_bal)
    c_amt.number_format = CURRENCY_FORMAT
    c_bal = ws1.cell(row=r_idx, column=8, value=opening_bal)
    c_bal.number_format = CURRENCY_FORMAT
    ws1.cell(row=r_idx, column=9, value="期初结存")
    ws1.cell(row=r_idx, column=10, value="财务部")
    ws1.cell(row=r_idx, column=11, value="-")
    ws1.cell(row=r_idx, column=12, value="上月结转确认基数")
    ws1.cell(row=r_idx, column=13, value="-")

    for c in range(1, len(headers) + 1):
        cell = ws1.cell(row=r_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=10, bold=True, color="475569")
        cell.fill = SUBHEADER_FILL
        cell.border = THIN_BORDER
        if c in [1, 2, 3, 6, 10, 11, 13]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        elif c in [7, 8]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    r_idx += 1

    # 数据行
    for r in stream_rows:
        ws1.cell(row=r_idx, column=1, value=r.get("seq"))
        ws1.cell(row=r_idx, column=2, value=str(r.get("posting_date") or ""))
        ws1.cell(row=r_idx, column=3, value=str(r.get("voucher_date") or ""))
        ws1.cell(row=r_idx, column=4, value=r.get("item_name") or "")
        ws1.cell(row=r_idx, column=5, value=r.get("specification") or "-")
        ws1.cell(row=r_idx, column=6, value=r.get("direction") or "支出")
        
        c_amt = ws1.cell(row=r_idx, column=7, value=flt(r.get("amount")))
        c_amt.number_format = CURRENCY_FORMAT
        
        c_bal = ws1.cell(row=r_idx, column=8, value=flt(r.get("balance")))
        c_bal.number_format = CURRENCY_FORMAT
        
        ws1.cell(row=r_idx, column=9, value=r.get("category") or "")
        ws1.cell(row=r_idx, column=10, value=r.get("creator") or r.get("user") or "")
        ws1.cell(row=r_idx, column=11, value=r.get("invoice_no") or "无票")
        ws1.cell(row=r_idx, column=12, value=r.get("usage") or "")
        ws1.cell(row=r_idx, column=13, value=r.get("reimbursement_no") or "")

        for c in range(1, len(headers) + 1):
            cell = ws1.cell(row=r_idx, column=c)
            cell.font = Font(name=FONT_FAMILY, size=10)
            cell.border = THIN_BORDER
            if c in [1, 2, 3, 6, 10, 11, 13]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif c in [7, 8]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
        r_idx += 1

    # 底部四柱守恒合计行
    ws1.cell(row=r_idx, column=1, value="合计")
    ws1.cell(row=r_idx, column=4, value="本期发生与期末结余")
    ws1.cell(row=r_idx, column=6, value=f"共{len(stream_rows)}笔")
    
    # 发生额求和
    tot_exp = flt(summary.get("total_expense"))
    c_tot_exp = ws1.cell(row=r_idx, column=7, value=tot_exp)
    c_tot_exp.number_format = CURRENCY_FORMAT
    
    # 期末结余
    closing_bal = flt(summary.get("closing_balance"))
    c_cls_bal = ws1.cell(row=r_idx, column=8, value=closing_bal)
    c_cls_bal.number_format = CURRENCY_FORMAT

    ws1.cell(row=r_idx, column=12, value=f"期初 ¥{opening_bal:,.2f} + 流入 ¥{summary.get('total_income', 0):,.2f} - 支出 ¥{tot_exp:,.2f} = 期末 ¥{closing_bal:,.2f}")

    for c in range(1, len(headers) + 1):
        cell = ws1.cell(row=r_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True, color="0F172A")
        cell.fill = TOTAL_FILL
        cell.border = DOUBLE_BOTTOM_BORDER
        if c in [7, 8]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif c in [1, 2, 3, 6]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    _auto_fit_columns(ws1, len(headers))

    # ----------------- Sheet 2: 费用科目分类汇总 -----------------
    ws2 = wb.create_sheet(title="费用科目汇总")
    ws2.views.sheetView[0].showGridLines = True

    ws2.merge_cells("A1:E1")
    t2 = ws2.cell(row=1, column=1, value=f"{company} · 费用科目分类汇总 ({period})")
    t2.font = Font(name=FONT_FAMILY, size=14, bold=True, color="0F172A")
    t2.alignment = Alignment(horizontal="center", vertical="center")
    ws2.row_dimensions[1].height = 36

    headers2 = ["序号", "费用科目类别", "支出笔数", "科目支出合计", "占当月支出比例"]
    for col_idx, h in enumerate(headers2, 1):
        ws2.cell(row=2, column=col_idx, value=h)
    _style_header_row(ws2, 2, len(headers2))

    r2_idx = 3
    for idx, row in enumerate(cat_summary, 1):
        ws2.cell(row=r2_idx, column=1, value=idx)
        ws2.cell(row=r2_idx, column=2, value=row.get("category"))
        ws2.cell(row=r2_idx, column=3, value=f"{row.get('count')} 笔")
        
        amt_cell = ws2.cell(row=r2_idx, column=4, value=flt(row.get("amount")))
        amt_cell.number_format = CURRENCY_FORMAT
        
        pct_val = (flt(row.get("amount")) / tot_exp) if tot_exp > 0 else 0.0
        pct_cell = ws2.cell(row=r2_idx, column=5, value=pct_val)
        pct_cell.number_format = PERCENT_FORMAT

        for c in range(1, len(headers2) + 1):
            cell = ws2.cell(row=r2_idx, column=c)
            cell.font = Font(name=FONT_FAMILY, size=10)
            cell.border = THIN_BORDER
            if c in [1, 3]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif c in [4, 5]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
        r2_idx += 1

    # 汇总行
    ws2.cell(row=r2_idx, column=1, value="合计")
    ws2.cell(row=r2_idx, column=2, value="全科目总支出")
    ws2.cell(row=r2_idx, column=3, value=f"{sum(r.get('count', 0) for r in cat_summary)} 笔")
    c_tot = ws2.cell(row=r2_idx, column=4, value=tot_exp)
    c_tot.number_format = CURRENCY_FORMAT
    c_pct_tot = ws2.cell(row=r2_idx, column=5, value=1.0 if tot_exp > 0 else 0.0)
    c_pct_tot.number_format = PERCENT_FORMAT

    for c in range(1, len(headers2) + 1):
        cell = ws2.cell(row=r2_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True, color="0F172A")
        cell.fill = TOTAL_FILL
        cell.border = DOUBLE_BOTTOM_BORDER
        if c in [4, 5]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif c in [1, 3]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    _auto_fit_columns(ws2, len(headers2))

    # 输出字节流并交付
    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    filename = f"{period}_祺富机械_账单明细.xlsx"
    frappe.response['filename'] = filename
    frappe.response['filecontent'] = out.getvalue()
    frappe.response['type'] = 'binary'


@frappe.whitelist(methods=["GET", "POST"])
def export_jizhong_billing_excel(period_month=None, mode="single_month"):
    """
    导出天津吉众科技有限公司账单 .xlsx。
    mode: 'single_month' (当月5个Sheet) | 'all' (多Sheet全量规范导出)
    """
    assert_doctype_permission("Purchase Invoice", "read")
    from ashan_cn_procurement.ashan_cn_procurement.page.jizhong_billing_workbench.jizhong_billing_workbench import get_jizhong_billing_data
    
    data = get_jizhong_billing_data(period_month=period_month)
    period = data.get("period_month") or today()[:7]
    company = data.get("company")

    acc_names = data.get("account_names") or {}
    bank_name = acc_names.get("bank") or "银行-农行"
    cash_name = acc_names.get("cash") or "现金-孟祥山"
    no_inv_name = acc_names.get("no_inv") or "现金-无票"
    other_name = acc_names.get("no_inv_other") or "现金-其他"

    wb = openpyxl.Workbook()

    # 1. 银行账户 (动态对齐真实科目)
    ws_bank = wb.active
    ws_bank.title = bank_name
    _populate_bank_sheet(ws_bank, company, period, data.get("bank_rows") or [], data.get("summary", {}).get("bank_total", 0.0), account_name=bank_name)

    # 2. 现金账户 (动态对齐真实科目)
    ws_cash = wb.create_sheet(title=cash_name)
    _populate_cash_sheet(ws_cash, company, period, data.get("cash_rows") or [], data.get("summary", {}).get("cash_total", 0.0), account_name=cash_name)

    # 3. 现金-无票
    ws_no_inv = wb.create_sheet(title=no_inv_name)
    _populate_no_inv_sheet(ws_no_inv, company, period, data.get("no_inv_rows") or [], data.get("summary", {}).get("no_inv_total", 0.0), f"【{no_inv_name}】明细账")

    # 4. 现金-其他
    ws_other = wb.create_sheet(title=other_name)
    _populate_no_inv_sheet(ws_other, company, period, data.get("no_inv_other_rows") or [], data.get("summary", {}).get("no_inv_other_total", 0.0), f"【{other_name}】明细账")

    # 5. 五金明细辅助库
    ws_hw = wb.create_sheet(title="五金明细辅助库")
    _populate_hardware_sheet(ws_hw, company, period, data.get("hardware_rows") or [], data.get("summary", {}).get("hardware_total", 0.0))

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    suffix = "全量大账簿" if mode == "all" else "单月账单"
    filename = f"{period}_吉众科技_{suffix}.xlsx"
    frappe.response['filename'] = filename
    frappe.response['filecontent'] = out.getvalue()
    frappe.response['type'] = 'binary'


def _populate_bank_sheet(ws, company, period, rows, total_amt, account_name="银行-农行"):
    ws.views.sheetView[0].showGridLines = True
    ws.merge_cells("A1:H1")
    ws.cell(row=1, column=1, value=f"{company} · 【{account_name}】明细账 ({period})").font = Font(name=FONT_FAMILY, size=14, bold=True)
    ws.cell(row=1, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36

    headers = ["序号", "过账日期", "往来单位/摘要", "借方(流入)", "贷方(支出)", "账户动态余额", "发票号/凭证号", "备注与单号"]
    for i, h in enumerate(headers, 1):
        ws.cell(row=2, column=i, value=h)
    _style_header_row(ws, 2, len(headers))

    r_idx = 3
    for idx, r in enumerate(rows, 1):
        ws.cell(row=r_idx, column=1, value=idx)
        ws.cell(row=r_idx, column=2, value=str(r.get("date") or ""))
        ws.cell(row=r_idx, column=3, value=r.get("summary") or "")
        
        c_deb = ws.cell(row=r_idx, column=4, value=flt(r.get("debit")) if r.get("debit") else None)
        if c_deb.value: c_deb.number_format = CURRENCY_FORMAT
        
        c_crd = ws.cell(row=r_idx, column=5, value=flt(r.get("credit")) if r.get("credit") else None)
        if c_crd.value: c_crd.number_format = CURRENCY_FORMAT
        
        c_bal = ws.cell(row=r_idx, column=6, value=flt(r.get("balance")))
        c_bal.number_format = CURRENCY_FORMAT

        ws.cell(row=r_idx, column=7, value=r.get("voucher_no") or "-")
        ws.cell(row=r_idx, column=8, value=r.get("note") or "")

        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c)
            cell.font = Font(name=FONT_FAMILY, size=10)
            cell.border = THIN_BORDER
            if c in [1, 2, 7]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif c in [4, 5, 6]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
        r_idx += 1

    # 合计行
    ws.cell(row=r_idx, column=1, value="合计")
    ws.cell(row=r_idx, column=3, value=f"共 {len(rows)} 笔")
    c_tot = ws.cell(row=r_idx, column=5, value=flt(total_amt))
    c_tot.number_format = CURRENCY_FORMAT

    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=r_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True)
        cell.fill = TOTAL_FILL
        cell.border = DOUBLE_BOTTOM_BORDER
        if c in [4, 5, 6]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif c in [1, 2, 7]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    _auto_fit_columns(ws, len(headers))


def _populate_cash_sheet(ws, company, period, rows, total_amt, account_name="现金-孟祥山"):
    ws.views.sheetView[0].showGridLines = True
    ws.merge_cells("A1:G1")
    ws.cell(row=1, column=1, value=f"{company} · 【{account_name}】明细账 ({period})").font = Font(name=FONT_FAMILY, size=14, bold=True)
    ws.cell(row=1, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36

    headers = ["序号", "报销日期", "项目摘要", "收入", "支出", "动态结余", "备注说明"]
    for i, h in enumerate(headers, 1):
        ws.cell(row=2, column=i, value=h)
    _style_header_row(ws, 2, len(headers))

    r_idx = 3
    for idx, r in enumerate(rows, 1):
        is_hw = r.get("summary") == "五金一批"
        ws.cell(row=r_idx, column=1, value=idx)
        ws.cell(row=r_idx, column=2, value=str(r.get("date") or ""))
        ws.cell(row=r_idx, column=3, value=r.get("summary") or "")
        
        c_in = ws.cell(row=r_idx, column=4, value=flt(r.get("debit")) if r.get("debit") else None)
        if c_in.value: c_in.number_format = CURRENCY_FORMAT
        
        c_out = ws.cell(row=r_idx, column=5, value=flt(r.get("credit")) if r.get("credit") else None)
        if c_out.value: c_out.number_format = CURRENCY_FORMAT
        
        c_bal = ws.cell(row=r_idx, column=6, value=flt(r.get("balance")))
        c_bal.number_format = CURRENCY_FORMAT

        ws.cell(row=r_idx, column=7, value=r.get("note") or "")

        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c)
            cell.font = Font(name=FONT_FAMILY, size=10, bold=is_hw)
            cell.border = THIN_BORDER
            if is_hw:
                cell.fill = HIGHLIGHT_FILL
            if c in [1, 2]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif c in [4, 5, 6]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
        r_idx += 1

    # 合计行
    ws.cell(row=r_idx, column=1, value="合计")
    ws.cell(row=r_idx, column=3, value=f"共 {len(rows)} 笔")
    c_tot = ws.cell(row=r_idx, column=5, value=flt(total_amt))
    c_tot.number_format = CURRENCY_FORMAT

    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=r_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True)
        cell.fill = TOTAL_FILL
        cell.border = DOUBLE_BOTTOM_BORDER
        if c in [4, 5, 6]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif c in [1, 2]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    _auto_fit_columns(ws, len(headers))


def _populate_no_inv_sheet(ws, company, period, rows, total_amt, title_suffix):
    ws.views.sheetView[0].showGridLines = True
    ws.merge_cells("A1:G1")
    ws.cell(row=1, column=1, value=f"{company} · {title_suffix} ({period})").font = Font(name=FONT_FAMILY, size=14, bold=True)
    ws.cell(row=1, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36

    headers = ["序号", "发生日期", "支出项目", "收入", "支出金额", "结存余额", "备注说明"]
    for i, h in enumerate(headers, 1):
        ws.cell(row=2, column=i, value=h)
    _style_header_row(ws, 2, len(headers))

    r_idx = 3
    for idx, r in enumerate(rows, 1):
        ws.cell(row=r_idx, column=1, value=idx)
        ws.cell(row=r_idx, column=2, value=str(r.get("date") or ""))
        ws.cell(row=r_idx, column=3, value=r.get("item") or "")
        
        c_in = ws.cell(row=r_idx, column=4, value=flt(r.get("income")) if r.get("income") else None)
        if c_in.value: c_in.number_format = CURRENCY_FORMAT
        
        c_out = ws.cell(row=r_idx, column=5, value=flt(r.get("expense")) if r.get("expense") else None)
        if c_out.value: c_out.number_format = CURRENCY_FORMAT
        
        c_bal = ws.cell(row=r_idx, column=6, value=flt(r.get("balance")))
        c_bal.number_format = CURRENCY_FORMAT

        ws.cell(row=r_idx, column=7, value=r.get("note") or "")

        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c)
            cell.font = Font(name=FONT_FAMILY, size=10)
            cell.border = THIN_BORDER
            if c in [1, 2]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif c in [4, 5, 6]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
        r_idx += 1

    # 合计行
    ws.cell(row=r_idx, column=1, value="合计")
    ws.cell(row=r_idx, column=3, value=f"共 {len(rows)} 笔")
    c_tot = ws.cell(row=r_idx, column=5, value=flt(total_amt))
    c_tot.number_format = CURRENCY_FORMAT

    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=r_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True)
        cell.fill = TOTAL_FILL
        cell.border = DOUBLE_BOTTOM_BORDER
        if c in [4, 5, 6]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif c in [1, 2]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    _auto_fit_columns(ws, len(headers))


def _populate_hardware_sheet(ws, company, period, rows, total_amt):
    ws.views.sheetView[0].showGridLines = True
    ws.merge_cells("A1:G1")
    ws.cell(row=1, column=1, value=f"{company} · 车间五金明细辅助库 ({period})").font = Font(name=FONT_FAMILY, size=14, bold=True)
    ws.cell(row=1, column=1).alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 36

    headers = ["序号", "零配件/五金物料名称", "单位", "数量", "单价", "金额合计", "采购日期与备注说明"]
    for i, h in enumerate(headers, 1):
        ws.cell(row=2, column=i, value=h)
    _style_header_row(ws, 2, len(headers))

    r_idx = 3
    for idx, r in enumerate(rows, 1):
        ws.cell(row=r_idx, column=1, value=idx)
        ws.cell(row=r_idx, column=2, value=r.get("name") or "")
        ws.cell(row=r_idx, column=3, value=r.get("unit") or "个")
        ws.cell(row=r_idx, column=4, value=flt(r.get("qty") or 1))
        
        c_prc = ws.cell(row=r_idx, column=5, value=flt(r.get("unit_price")))
        c_prc.number_format = CURRENCY_FORMAT
        
        c_amt = ws.cell(row=r_idx, column=6, value=flt(r.get("total_amount")))
        c_amt.number_format = CURRENCY_FORMAT

        ws.cell(row=r_idx, column=7, value=r.get("note") or "")

        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=r_idx, column=c)
            cell.font = Font(name=FONT_FAMILY, size=10)
            cell.border = THIN_BORDER
            if c in [1, 3]:
                cell.alignment = Alignment(horizontal="center", vertical="center")
            elif c in [4, 5, 6]:
                cell.alignment = Alignment(horizontal="right", vertical="center")
            else:
                cell.alignment = Alignment(horizontal="left", vertical="center")
        r_idx += 1

    # 合计行
    ws.cell(row=r_idx, column=1, value="合计")
    ws.cell(row=r_idx, column=2, value=f"五金辅助核算总计 (共 {len(rows)} 项)")
    c_tot = ws.cell(row=r_idx, column=6, value=flt(total_amt))
    c_tot.number_format = CURRENCY_FORMAT

    for c in range(1, len(headers) + 1):
        cell = ws.cell(row=r_idx, column=c)
        cell.font = Font(name=FONT_FAMILY, size=11, bold=True)
        cell.fill = TOTAL_FILL
        cell.border = DOUBLE_BOTTOM_BORDER
        if c in [4, 5, 6]:
            cell.alignment = Alignment(horizontal="right", vertical="center")
        elif c in [1, 3]:
            cell.alignment = Alignment(horizontal="center", vertical="center")
        else:
            cell.alignment = Alignment(horizontal="left", vertical="center")

    _auto_fit_columns(ws, len(headers))
