// -*- coding: utf-8 -*-
// Copyright (c) 2026, Ashan CN Procurement and contributors
// Vehicle Form Custom Enhancements: Status Toggle (启用/封存), Fuel Grade Linkage, Driver Display

frappe.ui.form.on('Vehicle', {
    refresh(frm) {
        // 1. 状态徽章与一键封存/启用按钮
        const status = frm.doc.custom_vehicle_status || '正常在用';
        if (status === '封存停用') {
            frm.dashboard.set_headline_alert(
                '<span class="indicator red">⚠️ 此车辆已封存停用，已从油卡加油录入、高速费入池选择中自动隐藏</span>'
            );
            frm.add_custom_button(__('🟢 恢复正常在用'), function() {
                frappe.confirm('确定要恢复该车辆为【正常在用】状态吗？恢复后可在加油和高速费中正常选用。', () => {
                    frm.set_value('custom_vehicle_status', '正常在用');
                    frm.save();
                });
            }).addClass('btn-primary');
        } else {
            frm.dashboard.set_headline_alert(
                '<span class="indicator green">✅ 车辆正常在用中（支持油卡加油与高速费管理）</span>'
            );
            frm.add_custom_button(__('🔒 封存停用此车辆'), function() {
                frappe.confirm('确定要【封存停用】该车辆吗？封存后将不会出现在加油录入和高速费入池选择中。', () => {
                    frm.set_value('custom_vehicle_status', '封存停用');
                    frm.save();
                });
            }).addClass('btn-danger');
        }

        // 2. 如果主要驾驶员为空，提供友情提示
        if (!frm.doc.custom_primary_driver && !frm.is_new()) {
            frm.set_df_property('custom_primary_driver', 'description',
                '💡 建议填写主要驾驶员（如“张师傅”），保存后将自动同步至高速费台账'
            );
        }
    },

    fuel_type(frm) {
        // 动力类型联动默认油号
        const ft = (frm.doc.fuel_type || '').toLowerCase();
        if (ft.includes('diesel') || ft.includes('柴油')) {
            frm.set_value('custom_default_fuel_grade', '0# 柴油');
        } else if (ft.includes('petrol') || ft.includes('汽油')) {
            frm.set_value('custom_default_fuel_grade', '92# 汽油');
        } else if (ft.includes('electric') || ft.includes('纯电')) {
            frm.set_value('custom_default_fuel_grade', '纯电动');
        } else if (ft.includes('gas') || ft.includes('天然气')) {
            frm.set_value('custom_default_fuel_grade', '天然气');
        }
    }
});
