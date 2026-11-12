import frappe
from frappe.custom.doctype.custom_field.custom_field import create_custom_fields

def execute():
    """
    在 Purchase Invoice 和 Payment Entry 上建立 custom_accounting_voucher_no，
    支持会计打包凭证号（如 记-0001）关联与三源闭环自动拆解。
    """
    custom_fields = {
        "Purchase Invoice": [
            {
                "fieldname": "custom_accounting_voucher_no",
                "label": "会计凭证号",
                "fieldtype": "Data",
                "insert_after": "bill_no",
                "description": "对应会计做账凭证号 (如 记-0001)，用于三源闭环勾稽与自动拆解",
                "in_list_view": 1,
                "in_standard_filter": 1,
            }
        ],
        "Payment Entry": [
            {
                "fieldname": "custom_accounting_voucher_no",
                "label": "会计凭证号",
                "fieldtype": "Data",
                "insert_after": "reference_no",
                "description": "对应会计做账凭证号 (如 记-0001)，用于银行/现金出纳对账与凭证拆解",
                "in_list_view": 1,
                "in_standard_filter": 1,
            }
        ]
    }
    create_custom_fields(custom_fields, update=True)
