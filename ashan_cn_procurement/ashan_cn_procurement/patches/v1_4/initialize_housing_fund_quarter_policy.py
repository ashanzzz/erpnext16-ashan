import frappe


def execute():
    """Initialize V5 housing-fund policy without hardcoding runtime behavior.

    Existing employees follow the company rule by default. The one currently known
    long-term exception, 孟祥山, is initialized as 固定缴纳 once during migration; after
    that HR manages the same field from the workbench like any other employee.
    """
    if frappe.db.has_column("Ashan Employee Salary Profile", "housing_fund_policy"):
        frappe.db.sql(
            """
            UPDATE `tabAshan Employee Salary Profile`
               SET housing_fund_policy='跟随公司规则'
             WHERE IFNULL(housing_fund_policy, '')=''
            """
        )
        frappe.db.sql(
            """
            UPDATE `tabAshan Employee Salary Profile`
               SET housing_fund_policy='固定缴纳'
             WHERE employee_name=%s
               AND IFNULL(employment_status, '在职') NOT IN ('离职', '已离职')
            """,
            ("孟祥山",),
        )

    if frappe.db.has_column("Ashan Insurance Setting", "hf_auto_rule_enabled"):
        frappe.db.sql(
            """
            UPDATE `tabAshan Insurance Setting`
               SET hf_auto_rule_enabled=1,
                   hf_contribution_months=CASE WHEN IFNULL(hf_contribution_months,'')='' THEN '1,4,7,10' ELSE hf_contribution_months END,
                   hf_off_month_action=CASE WHEN IFNULL(hf_off_month_action,'')='' THEN '停缴' ELSE hf_off_month_action END
            """
        )
