# -*- coding: utf-8 -*-
# Copyright (c) 2026, Ashan CN Procurement and contributors
# For license information, please see license.txt

import frappe
from frappe.utils import getdate, nowdate, cint, date_diff, add_months, add_days
from ashan_cn_procurement.services.authorization_service import get_allowed_companies

@frappe.whitelist()
def get_monthly_settlement_status(year=None, month=None):
    """
    动态多主体月度核定状态感知服务 (每个小项目独立自适应探测最早未核定月份)
    核心逻辑：
    - 按月连续检测各业务事项；
    - 若 5月已核定、6月未核定，则直接呈现【2026年06月未核定】；
    - 绝不受死板下拉框限制，直观呈现每项业务当前最急需处理的待核定月份。
    """
    try:
        user = frappe.session.user
        roles = frappe.get_roles(user)
        company_scope = get_allowed_companies(user)
        is_admin = company_scope is None
        scoped_companies = company_scope or set()
        has_jizhong_perm = is_admin or any("吉众" in company for company in scoped_companies)
        has_qifu_perm = is_admin or any("祺富" in company for company in scoped_companies)

        # 角色权限感知
        can_manage_oil = is_admin or any(r in roles for r in ["Oil Card Operator", "Oil Card Manager", "油卡操作员", "油卡管理员", "Accounts User", "Accounts Manager"])
        can_manage_property = is_admin or any(r in roles for r in ["Property Operator", "Property Manager", "物业操作员", "物业管理员", "Accounts User", "Accounts Manager"])
        can_manage_payroll = is_admin or any(r in roles for r in ["Payroll Operator", "Payroll Manager", "薪酬操作员", "薪酬管理员", "HR User", "HR Manager"])
        can_manage_finance = is_admin or any(r in roles for r in ["Accounts User", "Accounts Manager", "财务经理", "System Manager"])

        # 生成候选检测月份序列（从 2026-06 起至当前核算月）
        candidate_months = []
        now_d = getdate(nowdate())
        cur_y, cur_m = now_d.year, now_d.month
        period_str = f"{cur_y}-{cur_m:02d}"
        period_label = f"{cur_y}年{cur_m}月"

        start_tot = 2026 * 12 + 6
        cur_tot = cur_y * 12 + cur_m
        for tot_m in range(start_tot, cur_tot + 1):
            y = (tot_m - 1) // 12
            m = (tot_m - 1) % 12 + 1
            candidate_months.append(f"{y:04d}-{m:02d}")

        # -----------------------------------------------------------------
        # 独立检测器定义
        # -----------------------------------------------------------------
        def _check_oil_card(p):
            has_summary = False
            if frappe.db.exists("DocType", "Oil Card Invoice Batch"):
                has_summary = bool(frappe.db.exists("Oil Card Invoice Batch", {"batch_period": p, "docstatus": 1}))
            if not has_summary and frappe.db.exists("DocType", "Oil Card Monthly Summary"):
                has_summary = bool(frappe.db.exists("Oil Card Monthly Summary", {"period": p, "docstatus": 1}))
            if not has_summary and frappe.db.exists("DocType", "Oil Card Monthly Closing"):
                try:
                    y_i, m_i = [int(x) for x in p.split("-")]
                    has_summary = bool(frappe.db.exists("Oil Card Monthly Closing", {"fiscal_year": y_i, "fiscal_month": m_i, "closing_locked": 1}))
                except Exception:
                    pass
            if has_summary:
                return True, "油卡台账已核定锁定"
            
            refuel_count = 0
            if frappe.db.exists("DocType", "Oil Card Refuel Log"):
                try:
                    refuel_count = frappe.db.count("Oil Card Refuel Log", {
                        "posting_date": ["between", [f"{p}-01", f"{p}-31"]]
                    })
                except Exception:
                    refuel_count = 0
            detail = f"有 {refuel_count} 笔加油记录待核定" if refuel_count > 0 else "尚未录入/核定加油明细"
            return False, detail

        def _check_highway_toll(p):
            has_toll = False
            if frappe.db.exists("DocType", "Vehicle Toll Monthly Sheet"):
                has_toll = bool(frappe.db.exists("Vehicle Toll Monthly Sheet", {"sheet_period": p, "docstatus": 1}))
            if has_toll:
                return True, "高速费月度台账已核定"
            return False, "高速费通行流水待生成月度账单"

        def _check_meal(p):
            has_meal = False
            meal_doc = f"MEAL-{p}"
            if frappe.db.exists("Ashan Monthly Meal Settlement", meal_doc):
                st = frappe.db.get_value("Ashan Monthly Meal Settlement", meal_doc, "status")
                if st == "已核定":
                    has_meal = True
            if has_meal:
                return True, "车间餐费已核定锁定"
            return False, "车间日常就餐记录待核定"

        def _check_jz_payroll(p):
            has_close = False
            if frappe.db.exists("DocType", "Payroll Month Close"):
                has_close = bool(frappe.db.exists("Payroll Month Close", {"payroll_period": p, "company": ["like", "%吉众%"], "is_locked": 1}))
            if not has_close and frappe.db.exists("DocType", "Ashan Payroll Entry"):
                has_close = bool(frappe.db.exists("Ashan Payroll Entry", {"payroll_month": p, "company": ["like", "%吉众%"], "status": "已封账"}))
            if has_close:
                return True, "吉众薪酬已核定封账"
            return False, "吉众薪酬待测算与核定锁定"

        def _check_qf_payroll(p):
            has_close = False
            if frappe.db.exists("DocType", "Payroll Month Close"):
                has_close = bool(frappe.db.exists("Payroll Month Close", {"payroll_period": p, "company": ["like", "%祺富%"], "is_locked": 1}))
            if not has_close and frappe.db.exists("DocType", "Ashan Payroll Entry"):
                has_close = bool(frappe.db.exists("Ashan Payroll Entry", {"payroll_month": p, "company": ["like", "%祺富%"], "status": "已封账"}))
            if has_close:
                return True, "祺富薪酬与个税已封账"
            return False, "薪资核算与凭证待核定封账"

        def _check_property_utility(p):
            has_util = False
            if frappe.db.exists("DocType", "Property Monthly Settlement"):
                has_util = bool(frappe.db.exists("Property Monthly Settlement", {
                    "settlement_period": p,
                    "settlement_type": ["in", ["水电费月结", "综合月结", "水电月结"]],
                    "docstatus": 1
                }))
            if has_util:
                return True, "水电费已核定完成并过账"
            return False, "水电抄表与差额分摊未锁定"

        def _check_jz_inv(p):
            has_inv = False
            if frappe.db.exists("DocType", "Monthly Invoice Closing"):
                has_inv = bool(frappe.db.exists("Monthly Invoice Closing", {"company": ["like", "%吉众%"], "period": p, "is_locked": 1}))
            if has_inv:
                return True, "采购发票已关账锁定"
            return False, "采购发票待核定关账"

        def _check_qf_inv(p):
            has_inv = False
            if frappe.db.exists("DocType", "Monthly Invoice Closing"):
                has_inv = bool(frappe.db.exists("Monthly Invoice Closing", {"company": ["like", "%祺富%"], "period": p, "is_locked": 1}))
            if has_inv:
                return True, "采购发票已关账锁定"
            return False, "采购发票待核定关账"

        def detect_item(check_fn):
            for p in candidate_months:
                is_settled, detail = check_fn(p)
                if not is_settled:
                    y_i, m_i = [int(x) for x in p.split("-")]
                    lbl = f"{y_i}年{m_i:02d}月"
                    return {
                        "status": "unsettled",
                        "period": p,
                        "period_label": lbl,
                        "status_label": "未核定",
                        "action_label": "去核定",
                        "summary_text": f"{lbl}未核定 · {detail}" if detail else f"{lbl}未核定"
                    }
            # 全核定
            latest = candidate_months[-1]
            y_i, m_i = [int(x) for x in latest.split("-")]
            lbl = f"{y_i}年{m_i:02d}月"
            return {
                "status": "settled",
                "period": latest,
                "period_label": lbl,
                "status_label": "已核定",
                "action_label": "查看台账",
                "summary_text": f"已核定至 {lbl}"
            }

        # -----------------------------------------------------------------
        # 组装吉众各项月度核定
        # -----------------------------------------------------------------
        jizhong_items = []
        if has_jizhong_perm:
            if can_manage_oil or is_admin:
                oil_data = detect_item(_check_oil_card)
                jizhong_items.append({
                    "id": "oil_card",
                    "title": "油卡明细",
                    "icon": "",
                    "status": oil_data["status"],
                    "status_label": oil_data["status_label"],
                    "action_label": oil_data["action_label"],
                    "target_period": oil_data["period"],
                    "route": "/desk/oil-card-ledger",
                    "summary_text": oil_data["summary_text"]
                })

                toll_data = detect_item(_check_highway_toll)
                jizhong_items.append({
                    "id": "highway_toll",
                    "title": "车辆高速费",
                    "icon": "",
                    "status": toll_data["status"],
                    "status_label": toll_data["status_label"],
                    "action_label": toll_data["action_label"],
                    "target_period": toll_data["period"],
                    "route": "/desk/vehicle-toll-monthly-sheet",
                    "summary_text": toll_data["summary_text"]
                })

            meal_data = detect_item(_check_meal)
            jizhong_items.append({
                "id": "jz_meal",
                "title": "车间日常餐费",
                "icon": "",
                "status": meal_data["status"],
                "status_label": meal_data["status_label"],
                "action_label": meal_data["action_label"],
                "target_period": meal_data["period"],
                "route": "/desk/meal-settlement-workbench",
                "summary_text": meal_data["summary_text"]
            })

            if can_manage_payroll or is_admin:
                jz_pay_data = detect_item(_check_jz_payroll)
                jizhong_items.append({
                    "id": "jz_payroll",
                    "title": "吉众工资核定",
                    "icon": "",
                    "status": jz_pay_data["status"],
                    "status_label": "未封账" if jz_pay_data["status"] == "unsettled" else "已封账",
                    "action_label": jz_pay_data["action_label"],
                    "target_period": jz_pay_data["period"],
                    "route": "/desk/jizhong-hr-salary-workbench",
                    "summary_text": jz_pay_data["summary_text"]
                })

            if can_manage_finance or is_admin:
                jz_inv_data = detect_item(_check_jz_inv)
                jizhong_items.append({
                    "id": "jz_inv_close",
                    "title": "发票月度核定",
                    "icon": "",
                    "company_name": "天津吉众科技有限公司",
                    "status": jz_inv_data["status"],
                    "status_label": "未关账" if jz_inv_data["status"] == "unsettled" else "已关账",
                    "action_label": jz_inv_data["action_label"],
                    "is_invoice_action": True,
                    "target_period": jz_inv_data["period"],
                    "target_period_label": jz_inv_data["period_label"],
                    "summary_text": jz_inv_data["summary_text"]
                })

        # -----------------------------------------------------------------
        # 组装祺富各项月度核定
        # -----------------------------------------------------------------
        qifu_items = []
        if has_qifu_perm:
            if can_manage_property or is_admin:
                util_data = detect_item(_check_property_utility)
                qifu_items.append({
                    "id": "utility_settlement",
                    "title": "水电费月结",
                    "icon": "",
                    "status": util_data["status"],
                    "status_label": util_data["status_label"],
                    "action_label": util_data["action_label"],
                    "target_period": util_data["period"],
                    "route": "/desk/property-settlement-workbench",
                    "summary_text": util_data["summary_text"]
                })

            meal_data_qf = detect_item(_check_meal)
            qifu_items.append({
                "id": "qf_meal",
                "title": "车间日常餐费",
                "icon": "",
                "status": meal_data_qf["status"],
                "status_label": meal_data_qf["status_label"],
                "action_label": meal_data_qf["action_label"],
                "target_period": meal_data_qf["period"],
                "route": "/desk/meal-settlement-workbench",
                "summary_text": meal_data_qf["summary_text"]
            })

            if can_manage_payroll or is_admin:
                qf_pay_data = detect_item(_check_qf_payroll)
                qifu_items.append({
                    "id": "qf_payroll",
                    "title": "祺富工资核定",
                    "icon": "",
                    "status": qf_pay_data["status"],
                    "status_label": "未封账" if qf_pay_data["status"] == "unsettled" else "已封账",
                    "action_label": qf_pay_data["action_label"],
                    "target_period": qf_pay_data["period"],
                    "route": "/desk/qifu-payroll-center",
                    "summary_text": qf_pay_data["summary_text"]
                })

            if can_manage_finance or is_admin:
                qf_inv_data = detect_item(_check_qf_inv)
                qifu_items.append({
                    "id": "qf_inv_close",
                    "title": "发票月度核定",
                    "icon": "",
                    "company_name": "天津祺富机械加工有限公司",
                    "status": qf_inv_data["status"],
                    "status_label": "未关账" if qf_inv_data["status"] == "unsettled" else "已关账",
                    "action_label": qf_inv_data["action_label"],
                    "is_invoice_action": True,
                    "target_period": qf_inv_data["period"],
                    "target_period_label": qf_inv_data["period_label"],
                    "summary_text": qf_inv_data["summary_text"]
                })

        show_jizhong = len(jizhong_items) > 0 and has_jizhong_perm
        show_qifu = len(qifu_items) > 0 and has_qifu_perm

        total_items = (len(jizhong_items) if show_jizhong else 0) + (len(qifu_items) if show_qifu else 0)
        settled_items = (
            sum(1 for i in jizhong_items if i['status'] == 'settled') if show_jizhong else 0
        ) + (
            sum(1 for i in qifu_items if i['status'] == 'settled') if show_qifu else 0
        )

        return {
            "period": period_str,
            "period_label": period_label,
            "current_user": user,
            "is_admin": is_admin,
            "total_items": total_items,
            "settled_items": settled_items,
            "all_done": total_items > 0 and (total_items == settled_items),
            "companies": {
                "jizhong": {
                    "company_name": "天津吉众科技有限公司",
                    "short_name": "吉众",
                    "visible": show_jizhong,
                    "items": jizhong_items
                },
                "qifu": {
                    "company_name": "天津祺富机械加工有限公司",
                    "short_name": "祺富",
                    "visible": show_qifu,
                    "items": qifu_items
                }
            }
        }
    except Exception as e:
        frappe.log_error(f"get_monthly_settlement_status error: {str(e)}")
        return {
            "period": f"{target_year}-{target_month:02d}" if "target_year" in locals() else "",
            "period_label": f"{target_year}年{target_month}月" if "target_year" in locals() else "",
            "error": str(e),
            "total_items": 0,
            "settled_items": 0,
            "all_done": False,
            "companies": {}
        }

@frappe.whitelist()
def get_pending_reimbursement_count():
    """
    高效统计当前用户垫付待报销的发票数量
    """
    try:
        user = frappe.session.user
        roles = frappe.get_roles(user)
        is_admin = user == "Administrator" or "System Manager" in roles

        filters = {"docstatus": 1, "custom_biz_mode": "现金报销"}
        if not is_admin:
            filters["owner"] = user

        pi_names = frappe.get_all("Purchase Invoice", filters=filters, pluck="name")
        if not pi_names:
            return {"count": 0}

        claimed = frappe.get_all(
            "Reimbursement Invoice Item",
            filters={
                "parenttype": "Reimbursement Request",
                "source_pi": ["in", pi_names],
                "docstatus": ["!=", 2]
            },
            pluck="source_pi"
        )
        unclaimed = set(pi_names) - set(claimed)
        return {"count": len(unclaimed)}
    except Exception as e:
        return {"count": 0, "error": str(e)}

@frappe.whitelist()
def get_compliance_expiry_status():
    """
    获取【我的临期预警】状态列表（合同、车辆、设备、员工资质）
    支持天数智能分级、红黄绿 SLA 预警与一键弹窗快速记录完成/核定
    """
    try:
        today = getdate(nowdate())
        user = frappe.session.user
        roles = frappe.get_roles(user)
        company_scope = get_allowed_companies(user)
        is_admin = company_scope is None
        scoped_companies = company_scope or set()
        has_jizhong = is_admin or any("吉众" in company for company in scoped_companies)
        has_qifu = is_admin or any("祺富" in company for company in scoped_companies)

        expiry_items = []

        # 1. 房租与物业租约合同到期 (Property Lease -> 祺富)
        if has_qifu and frappe.db.exists("DocType", "Property Lease"):
            leases = frappe.get_all("Property Lease", fields=["name", "property_name", "company", "end_date", "enabled"], filters={"enabled": 1})
            for l in leases:
                if l.end_date:
                    days = date_diff(l.end_date, today)
                    if days <= 60:
                        level = "danger" if days < 0 else ("warning" if days <= 30 else "info")
                        status_text = f"已逾期 {abs(days)} 天" if days < 0 else f"剩余 {days} 天到期"
                        suggested_next = str(add_months(getdate(l.end_date), 12))
                        expiry_items.append({
                            "id": f"lease_{l.name}",
                            "doctype": "Property Lease",
                            "docname": l.name,
                            "category": "合同租约",
                            "icon": "",
                            "company": "祺富",
                            "title": f"租赁合同: {l.property_name or l.name}",
                            "due_date": str(l.end_date),
                            "cycle_months": 12,
                            "suggested_next_due": suggested_next,
                            "days_remaining": days,
                            "level": level,
                            "status_text": status_text,
                            "action_label": "办理续租",
                            "route": f"/desk/property-lease/{l.name}",
                            "is_cyclical": True
                        })

        # 2. 员工外籍工作证与资格证书 (Employee Certificate Item)
        if frappe.db.exists("DocType", "Employee Certificate Item"):
            certs = frappe.get_all("Employee Certificate Item", fields=["name", "certificate_name", "employee", "company", "next_due_date", "cycle_months", "is_active"], filters={"is_active": 1})
            for c in certs:
                comp_name = str(c.company or "")
                match_comp = (has_jizhong and "吉众" in comp_name) or (has_qifu and "祺富" in comp_name) or is_admin
                if match_comp and c.next_due_date:
                    days = date_diff(c.next_due_date, today)
                    if days <= 45:
                        level = "danger" if days < 0 else ("warning" if days <= 20 else "info")
                        status_text = f"已超期 {abs(days)} 天" if days < 0 else f"剩余 {days} 天到期"
                        emp_name = c.employee or "员工"
                        cycle_m = cint(c.cycle_months) or 12
                        suggested_next = str(add_months(today, cycle_m))
                        expiry_items.append({
                            "id": f"cert_{c.name}",
                            "doctype": "Employee Certificate Item",
                            "docname": c.name,
                            "category": "员工资质",
                            "icon": "",
                            "company": "吉众" if "吉众" in comp_name else ("祺富" if "祺富" in comp_name else "公司"),
                            "title": f"{emp_name} - {c.certificate_name}",
                            "due_date": str(c.next_due_date),
                            "cycle_months": cycle_m,
                            "suggested_next_due": suggested_next,
                            "days_remaining": days,
                            "level": level,
                            "status_text": status_text,
                            "action_label": "记录续期",
                            "route": f"/desk/employee-certificate-item/{c.name}",
                            "is_cyclical": True
                        })

        # 3. 特种设备检验 (Compliance Equipment Item)
        if frappe.db.exists("DocType", "Compliance Equipment Item"):
            eqs = frappe.get_all("Compliance Equipment Item", fields=["name", "equipment_name", "company", "next_due_date", "cycle_months", "is_active"], filters={"is_active": 1})
            for e in eqs:
                comp_name = str(e.company or "")
                match_comp = (has_jizhong and "吉众" in comp_name) or (has_qifu and "祺富" in comp_name) or is_admin
                if match_comp and e.next_due_date:
                    days = date_diff(e.next_due_date, today)
                    if days <= 45:
                        level = "danger" if days < 0 else ("warning" if days <= 20 else "info")
                        status_text = f"检验逾期 {abs(days)} 天" if days < 0 else f"剩余 {days} 天检验"
                        cycle_m = cint(e.cycle_months) or 12
                        suggested_next = str(add_months(today, cycle_m))
                        expiry_items.append({
                            "id": f"eq_{e.name}",
                            "doctype": "Compliance Equipment Item",
                            "docname": e.name,
                            "category": "特种设备",
                            "icon": "",
                            "company": "吉众" if "吉众" in comp_name else ("祺富" if "祺富" in comp_name else "车间"),
                            "title": f"特检: {e.equipment_name}",
                            "due_date": str(e.next_due_date),
                            "cycle_months": cycle_m,
                            "suggested_next_due": suggested_next,
                            "days_remaining": days,
                            "level": level,
                            "status_text": status_text,
                            "action_label": "记录检验",
                            "route": f"/desk/compliance-equipment-item/{e.name}",
                            "is_cyclical": True
                        })

        # 4. 环保合规检测 (Environmental Compliance Item)
        if frappe.db.exists("DocType", "Environmental Compliance Item"):
            envs = frappe.get_all("Environmental Compliance Item", fields=["name", "title", "company", "next_due_date", "cycle_months", "is_active"], filters={"is_active": 1})
            for env in envs:
                comp_name = str(env.company or "")
                match_comp = (has_jizhong and "吉众" in comp_name) or (has_qifu and "祺富" in comp_name) or is_admin
                if match_comp and env.next_due_date:
                    days = date_diff(env.next_due_date, today)
                    if days <= 45:
                        level = "danger" if days < 0 else ("warning" if days <= 20 else "info")
                        status_text = f"检测已超期 {abs(days)} 天" if days < 0 else f"剩余 {days} 天检测"
                        cycle_m = cint(env.cycle_months) or 3
                        suggested_next = str(add_months(today, cycle_m))
                        expiry_items.append({
                            "id": f"env_{env.name}",
                            "doctype": "Environmental Compliance Item",
                            "docname": env.name,
                            "category": "环保检测",
                            "icon": "",
                            "company": "祺富" if "祺富" in comp_name else "吉众",
                            "title": f"环保: {env.title}",
                            "due_date": str(env.next_due_date),
                            "cycle_months": cycle_m,
                            "suggested_next_due": suggested_next,
                            "days_remaining": days,
                            "level": level,
                            "status_text": status_text,
                            "action_label": "安排检测",
                            "route": f"/desk/environmental-compliance-item/{env.name}",
                            "is_cyclical": True
                        })

        # 5. 车辆保险与审验 (Vehicle -> 吉众)
        if has_jizhong and frappe.db.exists("DocType", "Vehicle"):
            vehs = frappe.get_all("Vehicle", fields=["name", "license_plate", "company", "end_date"], filters={})
            for v in vehs:
                if v.end_date:
                    days = date_diff(v.end_date, today)
                    if days <= 30:
                        level = "danger" if days < 0 else ("warning" if days <= 15 else "info")
                        status_text = f"车险逾期 {abs(days)} 天" if days < 0 else f"剩余 {days} 天到期"
                        suggested_next = str(add_months(getdate(v.end_date), 12))
                        expiry_items.append({
                            "id": f"veh_{v.name}",
                            "doctype": "Vehicle",
                            "docname": v.name,
                            "category": "车辆保险",
                            "icon": "",
                            "company": "吉众",
                            "title": f"车辆保险: {v.license_plate or v.name}",
                            "due_date": str(v.end_date),
                            "cycle_months": 12,
                            "suggested_next_due": suggested_next,
                            "days_remaining": days,
                            "level": level,
                            "status_text": status_text,
                            "action_label": "办理续保",
                            "route": f"/desk/vehicle/{v.name}",
                            "is_cyclical": True
                        })

        # 排序：逾期越严重的排最前
        expiry_items.sort(key=lambda x: x["days_remaining"])

        danger_count = sum(1 for x in expiry_items if x["level"] == "danger")
        warning_count = sum(1 for x in expiry_items if x["level"] == "warning")
        total_count = len(expiry_items)

        return {
            "total_count": total_count,
            "danger_count": danger_count,
            "warning_count": warning_count,
            "all_valid": total_count == 0,
            "items": expiry_items
        }
    except Exception as e:
        frappe.log_error(f"get_compliance_expiry_status error: {str(e)}")
        return {
            "error": str(e),
            "total_count": 0,
            "danger_count": 0,
            "warning_count": 0,
            "all_valid": True,
            "items": []
        }

@frappe.whitelist(methods=["POST"])
def record_compliance_inspection(doctype, docname, done_date=None, next_due_date=None, notes=None):
    """
    快速记录周期性检测/检验/续租完成，直接就地推进下一周期到期日，无需跳转
    """
    try:
        if not doctype or not docname:
            frappe.throw("缺少 DocType 或单据编号")

        if not frappe.has_permission(doctype, "write"):
            frappe.throw(f"您没有修改 {doctype} 的权限")

        doc = frappe.get_doc(doctype, docname)
        today = getdate(nowdate())
        effective_done_date = getdate(done_date) if done_date else today

        updated_next_due = None

        if doctype == "Environmental Compliance Item":
            cycle = cint(doc.cycle_months) or 3
            doc.last_done_date = effective_done_date
            if next_due_date:
                doc.next_due_date = getdate(next_due_date)
            else:
                doc.next_due_date = add_months(effective_done_date, cycle)
            updated_next_due = str(doc.next_due_date)
            doc.remarks = f"{doc.remarks or ''}\n[{nowdate()}] 已完成检验/处置记录。完成日期: {effective_done_date}，下次到期: {updated_next_due}。备注: {notes or '无'}"
            doc.save()

        elif doctype == "Compliance Equipment Item":
            cycle = cint(doc.cycle_months) or 12
            doc.last_inspection_date = effective_done_date
            if next_due_date:
                doc.next_due_date = getdate(next_due_date)
            else:
                doc.next_due_date = add_months(effective_done_date, cycle)
            updated_next_due = str(doc.next_due_date)
            doc.remarks = f"{doc.remarks or ''}\n[{nowdate()}] 特种设备检验完成。完成日期: {effective_done_date}，下次到期: {updated_next_due}。备注: {notes or '无'}"
            doc.save()

        elif doctype == "Employee Certificate Item":
            cycle = cint(doc.cycle_months) or 12
            doc.issue_date = effective_done_date
            if next_due_date:
                doc.next_due_date = getdate(next_due_date)
            else:
                doc.next_due_date = add_months(effective_done_date, cycle)
            updated_next_due = str(doc.next_due_date)
            doc.remarks = f"{doc.remarks or ''}\n[{nowdate()}] 员工资质/外籍工作证复审续期完成。完成日期: {effective_done_date}，下次到期: {updated_next_due}。备注: {notes or '无'}"
            doc.save()

        elif doctype == "Property Lease":
            if next_due_date:
                doc.end_date = getdate(next_due_date)
            else:
                doc.end_date = add_months(getdate(doc.end_date or today), 12)
            updated_next_due = str(doc.end_date)
            doc.remark = f"{doc.remark or ''}\n[{nowdate()}] 办理续租。新到期日: {updated_next_due}。备注: {notes or '无'}"
            doc.save()

        elif doctype == "Vehicle":
            if next_due_date:
                doc.end_date = getdate(next_due_date)
            else:
                doc.end_date = add_months(getdate(doc.end_date or today), 12)
            updated_next_due = str(doc.end_date)
            doc.save()

        return {
            "success": True,
            "doctype": doctype,
            "docname": docname,
            "done_date": str(effective_done_date),
            "next_due_date": updated_next_due,
            "message": f"已成功更新！下期到期时间已推进至: {updated_next_due}"
        }
    except Exception as e:
        frappe.log_error(f"record_compliance_inspection error: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }
