// Copyright (c) 2026, Ashan CN Procurement
frappe.ui.form.on('Tax Invoice', {
    refresh(frm) {
        if (!frm.is_new()) {
            if (frm.doc.business_status !== '已废弃') {
                frm.add_custom_button(__('标记已废弃'), function() {
                    frappe.prompt([
                        {
                            label: __('废弃原因'),
                            fieldname: 'reason',
                            fieldtype: 'Select',
                            options: '开错发票\n不属于本公司\n重复发票\n已红冲/无需录入\n其他',
                            reqd: 1
                        },
                        {
                            label: __('补充说明'),
                            fieldname: 'note',
                            fieldtype: 'Small Text'
                        }
                    ], function(values) {
                        frappe.call({
                            method: 'ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.abandon_tax_invoice',
                            args: {
                                invoice_no: frm.doc.invoice_no,
                                reason: values.reason,
                                note: values.note
                            },
                            callback: function(r) {
                                if (r.message && r.message.ok) {
                                    frappe.show_alert({ message: __('发票已成功标记为废弃'), indicator: 'orange' });
                                    frm.reload_doc();
                                }
                            }
                        });
                    }, __('确认废弃发票'), __('确认废弃'));
                }, __('发票操作'));
            } else {
                frm.add_custom_button(__('恢复为待录入'), function() {
                    frappe.confirm(__('确定将此发票恢复为待录入状态？系统将重新进行采购发票匹配。'), function() {
                        frappe.call({
                            method: 'ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.restore_tax_invoice',
                            args: { invoice_no: frm.doc.invoice_no },
                            callback: function(r) {
                                if (r.message && r.message.ok) {
                                    frappe.show_alert({ message: __('已恢复为待录入状态并重新匹配'), indicator: 'green' });
                                    frm.reload_doc();
                                }
                            }
                        });
                    });
                }, __('发票操作'));
            }

            frm.add_custom_button(__('重新匹配 Purchase Invoice'), function() {
                frappe.call({
                    method: 'ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.rematch_tax_invoice',
                    args: { invoice_no: frm.doc.invoice_no },
                    callback: function(r) {
                        frappe.show_alert({ message: __('匹配状态已更新'), indicator: 'blue' });
                        frm.reload_doc();
                    }
                });
            }, __('发票操作'));

            if (frm.doc.invoice_pdf && !frm.doc.pdf_removed) {
                frm.add_custom_button(__('清理 PDF 附件'), function() {
                    frappe.confirm(__('仅删除原始 PDF 附件，发票号码、金额、明细与匹配记录将永久保留。确认清理？'), function() {
                        frappe.call({
                            method: 'ashan_cn_procurement.page.tax_invoice_center.tax_invoice_center.delete_tax_invoice_pdf',
                            args: { invoice_no: frm.doc.invoice_no },
                            callback: function(r) {
                                if (r.message && r.message.ok) {
                                    frappe.show_alert({ message: __('PDF 附件已清理'), indicator: 'gray' });
                                    frm.reload_doc();
                                }
                            }
                        });
                    });
                }, __('附件管理'));
            }
        }
    }
});
