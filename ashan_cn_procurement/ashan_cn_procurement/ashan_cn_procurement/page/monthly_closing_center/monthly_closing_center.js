// Copyright (c) 2026, Ashan CN Procurement and contributors
// Monthly Closing Governance Center Workbench

frappe.pages['monthly-closing-center'].on_page_load = function(wrapper) {
  const page = frappe.ui.make_app_page({
    parent: wrapper,
    title: '月度核定全景管理中枢',
    single_column: true
  });

  const $parent = $(wrapper).find('.layout-main-section');
  $parent.empty();

  let currentTab = 'matrix'; // 'matrix' | 'timeline' | 'compliance'
  let currentCompanyFilter = 'all'; // 'all' | 'jizhong' | 'qifu'
  let currentStatusFilter = 'all'; // 'all' | 'pending' | 'settled'
  let dashboardData = null;
  let timelineData = null;
  let complianceData = null;

  // 基础 DOM 骨架
  const htmlSkeleton = `
    <div class="mcc-container">
      <div class="mcc-header">
        <div class="mcc-title-area">
          <div class="mcc-main-title">
            <span>ERPNext 16 月度核定全景管理中枢</span>
          </div>
          <div class="mcc-sub-title">
            <span>动态业务流水自适应感知 · 严格四柱平账与底层锁死 · 0 手工任务注册配置</span>
          </div>
        </div>
        <div class="mcc-header-actions">
          <button type="button" class="mcc-btn mcc-btn--outline" id="btn-mcc-refresh">刷新感知数据</button>
        </div>
      </div>

      <div class="mcc-kpi-grid" id="mcc-kpi-container">
        <div class="mcc-kpi-card">
          <div class="mcc-kpi-label">当前感知账期</div>
          <div class="mcc-kpi-val" id="kpi-current-period">-</div>
          <div class="mcc-kpi-desc">自动探测最早未核定月份</div>
        </div>
        <div class="mcc-kpi-card is-pending-alert">
          <div class="mcc-kpi-label">待核定任务数</div>
          <div class="mcc-kpi-val" id="kpi-pending-count">-</div>
          <div class="mcc-kpi-desc">急需财务/业务核定并锁定</div>
        </div>
        <div class="mcc-kpi-card is-all-settled">
          <div class="mcc-kpi-label">已核定锁定任务</div>
          <div class="mcc-kpi-val" id="kpi-settled-count">-</div>
          <div class="mcc-kpi-desc">受底层只读防篡改保护</div>
        </div>
        <div class="mcc-kpi-card">
          <div class="mcc-kpi-label">覆盖业务主体</div>
          <div class="mcc-kpi-val">2 <span class="mcc-kpi-val-unit">个法人公司</span></div>
          <div class="mcc-kpi-desc">天津吉众科技 ｜ 天津祺富机械</div>
        </div>
      </div>

      <div class="mcc-philosophy-banner">
        <div class="mcc-philosophy-text">
          <strong>动态核心思想：</strong>系统月度核定任务内生于业务事实（加油流水、考勤就餐、采购发票、水电抄表），自动按月连续探测，<strong>无需每月手动注册任务</strong>。核定封账后即刻进入底层只读保护，禁止擅自修改。
        </div>
        <span class="mcc-philosophy-tag">四柱守恒与防篡改</span>
      </div>

      <div class="mcc-filter-strip">
        <div class="mcc-segmented-group" id="mcc-view-segments">
          <button type="button" class="mcc-segment-btn is-active" data-view="matrix">全景核定任务大宽表</button>
          <button type="button" class="mcc-segment-btn" data-view="timeline">12个月时序核定看板</button>
          <button type="button" class="mcc-segment-btn" data-view="compliance">合规与特检周期底册</button>
        </div>

        <div id="mcc-sub-filters">
          <div class="mcc-segmented-group" id="mcc-comp-segments">
            <button type="button" class="mcc-segment-btn is-active" data-comp="all">全部主体</button>
            <button type="button" class="mcc-segment-btn" data-comp="jizhong">天津吉众</button>
            <button type="button" class="mcc-segment-btn" data-comp="qifu">天津祺富</button>
          </div>
          <div class="mcc-segmented-group" id="mcc-status-segments">
            <button type="button" class="mcc-segment-btn is-active" data-status="all">全部状态</button>
            <button type="button" class="mcc-segment-btn" data-status="pending">待核定</button>
            <button type="button" class="mcc-segment-btn" data-status="settled">已锁定</button>
          </div>
        </div>
      </div>

      <div id="mcc-content-view">
        <div class="ashan-loading-placeholder">正在探测系统月度核定状态...</div>
      </div>
    </div>
  `;

  $parent.html(htmlSkeleton);

  // 绑定切换事件
  $parent.find('#mcc-view-segments .mcc-segment-btn').on('click', function() {
    $parent.find('#mcc-view-segments .mcc-segment-btn').removeClass('is-active');
    $(this).addClass('is-active');
    currentTab = $(this).data('view');
    renderActiveTab();
  });

  $parent.find('#mcc-comp-segments .mcc-segment-btn').on('click', function() {
    $parent.find('#mcc-comp-segments .mcc-segment-btn').removeClass('is-active');
    $(this).addClass('is-active');
    currentCompanyFilter = $(this).data('comp');
    renderActiveTab();
  });

  $parent.find('#mcc-status-segments .mcc-segment-btn').on('click', function() {
    $parent.find('#mcc-status-segments .mcc-segment-btn').removeClass('is-active');
    $(this).addClass('is-active');
    currentStatusFilter = $(this).data('status');
    renderActiveTab();
  });

  $parent.find('#btn-mcc-refresh').on('click', function() {
    loadAllData();
  });

  function loadAllData() {
    frappe.call({
      method: 'ashan_cn_procurement.services.monthly_closing_service.get_monthly_closing_dashboard',
      callback: function(r) {
        if (r && r.message) {
          dashboardData = r.message;
          updateKPICards(dashboardData);
          renderActiveTab();
        }
      }
    });

    frappe.call({
      method: 'ashan_cn_procurement.services.monthly_closing_service.get_annual_timeline_matrix',
      callback: function(r) {
        if (r && r.message) {
          timelineData = r.message;
          if (currentTab === 'timeline') {
            renderActiveTab();
          }
        }
      }
    });

    frappe.call({
      method: 'ashan_cn_procurement.services.periodic_tasks.get_compliance_expiry_status',
      callback: function(r) {
        if (r && r.message) {
          complianceData = r.message;
          if (currentTab === 'compliance') {
            renderActiveTab();
          }
        }
      }
    });
  }

  function updateKPICards(data) {
    if (!data) return;
    $parent.find('#kpi-current-period').text(data.period_label || data.period || '-');
    const summary = data.summary || {};
    $parent.find('#kpi-pending-count').text(summary.pending_tasks || 0);
    $parent.find('#kpi-settled-count').text(summary.settled_tasks || 0);
  }

  function renderActiveTab() {
    const $container = $parent.find('#mcc-content-view');
    if (currentTab === 'matrix') {
      $parent.find('#mcc-sub-filters').show();
      renderMatrixTable($container);
    } else if (currentTab === 'timeline') {
      $parent.find('#mcc-sub-filters').show();
      renderTimelineView($container);
    } else if (currentTab === 'compliance') {
      $parent.find('#mcc-sub-filters').hide();
      renderComplianceView($container);
    }
  }

  // 1. 全景核定任务管理大宽表
  function renderMatrixTable($container) {
    if (!dashboardData || !dashboardData.tasks) {
      $container.html('<div class="ashan-loading-placeholder">正在加载数据...</div>');
      return;
    }

    let tasks = dashboardData.tasks;

    // 过滤主体
    if (currentCompanyFilter === 'jizhong') {
      tasks = tasks.filter(t => t.company_short === '吉众');
    } else if (currentCompanyFilter === 'qifu') {
      tasks = tasks.filter(t => t.company_short === '祺富');
    }

    // 过滤状态
    if (currentStatusFilter === 'pending') {
      tasks = tasks.filter(t => !t.is_settled);
    } else if (currentStatusFilter === 'settled') {
      tasks = tasks.filter(t => t.is_settled);
    }

    if (tasks.length === 0) {
      $container.html('<div class="mcc-table-wrapper"><div class="periodic-item-empty">无符合筛选条件的月度核定任务</div></div>');
      return;
    }

    let rowsHtml = '';
    tasks.forEach((t, idx) => {
      const compClass = t.company_short === '吉众' ? 'mcc-badge--company-jz' : 'mcc-badge--company-qf';
      const statusBadgeClass = t.is_settled ? 'mcc-badge--success' : 'mcc-badge--warning';
      
      const auditHtml = t.is_settled && t.verifier ? `
        <div class="mcc-audit-info">
          <span>核定人: ${frappe.utils.escape_html(t.verifier)}</span>
          <span class="mcc-audit-time">${frappe.utils.escape_html(t.verified_at || '')}</span>
        </div>
      ` : (t.unlock_reason ? `
        <div class="mcc-audit-info">
          <span>解锁原因: ${frappe.utils.escape_html(t.unlock_reason)}</span>
        </div>
      ` : '<span class="mcc-audit-time">待核定锁定</span>');

      const isInv = t.action_type === 'invoice_dialog';
      const invAttrs = isInv ? `data-is-inv="1" data-comp="${frappe.utils.escape_html(t.company)}" data-period="${frappe.utils.escape_html(t.target_period)}" data-period-label="${frappe.utils.escape_html(t.target_period_label)}"` : '';
      const hrefAttr = isInv ? 'href="javascript:void(0)"' : `href="${t.route || '#'}"`;
      const routeAttr = isInv ? '' : `data-route="${(t.route || '').replace('/desk/', '')}"`;

      const actClass = t.is_settled ? 'mcc-btn mcc-btn--outline' : 'mcc-btn mcc-btn--primary';

      rowsHtml += `
        <tr>
          <td class="mcc-col-sticky-1">${idx + 1}</td>
          <td class="mcc-col-sticky-2">
            <strong>${frappe.utils.escape_html(t.title)}</strong>
          </td>
          <td><span class="${compClass}">${frappe.utils.escape_html(t.company_short)}</span></td>
          <td>${frappe.utils.escape_html(t.category)}</td>
          <td><strong>${frappe.utils.escape_html(t.target_period_label)}</strong></td>
          <td><span class="mcc-badge ${statusBadgeClass}">${frappe.utils.escape_html(t.status_label)}</span></td>
          <td>${frappe.utils.escape_html(t.detail_text || '-')}</td>
          <td>
            <div class="mcc-lock-info">
              <span class="mcc-lock-title">${frappe.utils.escape_html(t.lock_strength)}</span>
              <span class="mcc-lock-desc">${frappe.utils.escape_html(t.lock_desc)}</span>
            </div>
          </td>
          <td>${frappe.utils.escape_html(t.edit_rule)}</td>
          <td>${auditHtml}</td>
          <td>
            <a ${hrefAttr} class="${actClass}" ${routeAttr} ${invAttrs}>
              ${t.action_label}
            </a>
          </td>
        </tr>
      `;
    });

    const tableHtml = `
      <div class="mcc-table-wrapper">
        <table class="mcc-table">
          <thead>
            <tr>
              <th class="mcc-col-sticky-1">#</th>
              <th class="mcc-col-sticky-2">月度核定任务</th>
              <th>所属主体</th>
              <th>业务板块</th>
              <th>待办账期</th>
              <th>核定状态</th>
              <th>待办业务事实规模</th>
              <th>核定锁定强度与机制</th>
              <th>修改权限与反审核规则</th>
              <th>核定留痕 / 审计轨迹</th>
              <th>原位操作</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    $container.html(tableHtml);
    bindTableEvents($container);
  }

  // 2. 12个月时序核定看板
  function renderTimelineView($container) {
    if (!timelineData || !timelineData.rows) {
      $container.html('<div class="ashan-loading-placeholder">正在提取 12 个月核定时序矩阵...</div>');
      return;
    }

    let rows = timelineData.rows;
    if (currentCompanyFilter === 'jizhong') {
      rows = rows.filter(r => r.company_short === '吉众');
    } else if (currentCompanyFilter === 'qifu') {
      rows = rows.filter(r => r.company_short === '祺富');
    }

    let rowsHtml = '';
    rows.forEach((r, idx) => {
      const compClass = r.company_short === '吉众' ? 'mcc-badge--company-jz' : 'mcc-badge--company-qf';
      let monthCells = '';
      (r.months || []).forEach(m => {
        const stateClass = `state-${m.state}`;
        const tooltip = m.detail_text ? `title="${frappe.utils.escape_html(m.detail_text)}"` : '';
        monthCells += `
          <td class="mcc-matrix-cell">
            <span class="mcc-matrix-pill ${stateClass}" ${tooltip}>${frappe.utils.escape_html(m.label)}</span>
          </td>
        `;
      });

      const isInv = r.action_type === 'invoice_dialog';
      const invAttrs = isInv ? `data-is-inv="1" data-comp="${frappe.utils.escape_html(r.company)}"` : '';

      rowsHtml += `
        <tr>
          <td class="mcc-col-sticky-1">${idx + 1}</td>
          <td class="mcc-col-sticky-2">
            <strong>${frappe.utils.escape_html(r.title)}</strong>
          </td>
          <td><span class="${compClass}">${frappe.utils.escape_html(r.company_short)}</span></td>
          ${monthCells}
          <td>
            <a href="${r.route || '#'}" class="mcc-btn mcc-btn--outline" data-route="${(r.route || '').replace('/desk/', '')}" ${invAttrs}>
              进入工作台
            </a>
          </td>
        </tr>
      `;
    });

    const tableHtml = `
      <div class="mcc-table-wrapper">
        <table class="mcc-table mcc-matrix-table">
          <thead>
            <tr>
              <th class="mcc-col-sticky-1">#</th>
              <th class="mcc-col-sticky-2">核定任务</th>
              <th>主体</th>
              <th>1月</th>
              <th>2月</th>
              <th>3月</th>
              <th>4月</th>
              <th>5月</th>
              <th>6月</th>
              <th>7月</th>
              <th>8月</th>
              <th>9月</th>
              <th>10月</th>
              <th>11月</th>
              <th>12月</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    $container.html(tableHtml);
    bindTableEvents($container);
  }

  // 3. 周期性合规与特检底册
  function renderComplianceView($container) {
    if (!complianceData || !complianceData.items) {
      $container.html('<div class="ashan-loading-placeholder">正在加载周期合规与特检底册...</div>');
      return;
    }

    const items = complianceData.items;
    if (items.length === 0) {
      $container.html('<div class="periodic-item-empty">所有特检、设备与合规项目均处于有效期内</div>');
      return;
    }

    let cardsHtml = '';
    items.forEach(it => {
      const levelClass = `level-${it.level || 'info'}`;
      const badgeClass = it.level === 'danger' ? 'mcc-badge--danger' : (it.level === 'warning' ? 'mcc-badge--warning' : 'mcc-badge--success');

      cardsHtml += `
        <div class="mcc-compliance-card ${levelClass}">
          <div class="mcc-compliance-header">
            <span class="mcc-compliance-title">${frappe.utils.escape_html(it.title)}</span>
            <span class="mcc-badge ${badgeClass}">${frappe.utils.escape_html(it.status_text)}</span>
          </div>
          <div class="mcc-compliance-meta">
            <div>所属公司: <strong>${frappe.utils.escape_html(it.company || '-')}</strong> ｜ 类别: ${frappe.utils.escape_html(it.category || '-')}</div>
            <div>当前到期日: <strong>${frappe.utils.escape_html(it.due_date || '-')}</strong> ｜ 检验周期: ${it.cycle_months || 12} 个月</div>
          </div>
          <div class="mcc-compliance-actions">
            <button type="button" class="mcc-btn mcc-btn--primary btn-quick-inspect" 
              data-doctype="${frappe.utils.escape_html(it.doctype)}" 
              data-docname="${frappe.utils.escape_html(it.docname)}"
              data-suggested-next="${frappe.utils.escape_html(it.suggested_next_due || '')}">
              ${it.action_label || '登记完成'}
            </button>
            <a href="${it.route || '#'}" class="mcc-btn mcc-btn--outline" data-route="${(it.route || '').replace('/desk/', '')}">
              查看单据
            </a>
          </div>
        </div>
      `;
    });

    $container.html(`<div class="mcc-compliance-grid">${cardsHtml}</div>`);

    // 绑定合规检验快速记录弹窗
    $container.find('.btn-quick-inspect').on('click', function() {
      const dt = $(this).data('doctype');
      const dn = $(this).data('docname');
      const nextDue = $(this).data('suggested-next');
      openComplianceQuickInspectDialog(dt, dn, nextDue);
    });

    bindTableEvents($container);
  }

  // 绑定路由与发票弹窗
  function bindTableEvents($container) {
    $container.find('a[data-is-inv="1"]').on('click', function(e) {
      e.preventDefault();
      const comp = $(this).data('comp');
      const period = $(this).data('period') || dashboardData.period;
      const periodLabel = $(this).data('period-label') || dashboardData.period_label;
      openInvoiceClosingDialog(comp, period, periodLabel);
    });

    $container.find('a[data-route]:not([data-is-inv="1"])').on('click', function(e) {
      const isNewTab = e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0;
      if (isNewTab) return;
      const r = $(this).data('route');
      if (r && r !== '#') {
        e.preventDefault();
        frappe.set_route(r);
      }
    });
  }

  // 发票月度核定与反审核 Dialog
  function openInvoiceClosingDialog(company, period, periodLabel) {
    frappe.call({
      method: 'ashan_cn_procurement.services.invoice_closing_service.get_invoice_closing_data',
      args: { company: company, period: period },
      callback: function(r) {
        if (!r || !r.message) return;
        const d_data = r.message;
        const isLocked = d_data.is_locked;

        const d = new frappe.ui.Dialog({
          title: `采购与供应链月度综合封账 · ${company}`,
          fields: [
            {
              fieldtype: 'HTML',
              fieldname: 'stats_html',
              options: `
                <div class="mcc-kpi-card mcc-dialog-card">
                  <div class="mcc-dialog-header-row">
                    <strong>核定账期：${periodLabel || period} (${period})</strong>
                    <span class="mcc-badge ${isLocked ? 'mcc-badge--success' : 'mcc-badge--warning'}">
                      ${isLocked ? '已全链条封账锁定' : '草稿 / 待封账'}
                    </span>
                  </div>
                  <div class="mcc-dialog-grid">
                    <div>采购订单：<b>${d_data.po_count || 0}</b> 笔 (¥ ${format_currency(d_data.po_amount || 0)})</div>
                    <div>采购入库：<b>${d_data.pr_count || 0}</b> 笔 (¥ ${format_currency(d_data.pr_amount || 0)})</div>
                    <div>采购发票：<b>${d_data.invoice_count || 0}</b> 笔 (<b class="mcc-dialog-val-highlight">¥ ${format_currency(d_data.total_grand_total || 0)}</b>)</div>
                    <div>报销申请：<b>${d_data.reim_count || 0}</b> 笔 (¥ ${format_currency(d_data.reim_amount || 0)})</div>
                  </div>
                  ${isLocked ? `
                    <div class="mcc-dialog-audit-row">
                      核定人：${d_data.locked_by || '-'} ｜ 核定时间：${d_data.locked_at || '-'}
                    </div>
                  ` : ''}
                </div>
                ${!isLocked ? `
                  <div class="mcc-philosophy-banner mcc-dialog-banner">
                    <div class="mcc-philosophy-text">
                      <strong>全链条封账说明：</strong>核定封账后，系统在底层强拦截当月采购申请、采购订单、采购入库单、采购发票与报销单，严密禁止新增、修改、提交、作废或删除所属账期为 <strong>${periodLabel || period}</strong> 的任何单据。
                    </div>
                  </div>
                ` : ''}
              `
            },
            ...(isLocked ? [
              {
                fieldtype: 'Small Text',
                fieldname: 'unlock_reason',
                label: '反审核解锁原因 (必填)',
                reqd: 1
              }
            ] : [
              {
                fieldtype: 'Small Text',
                fieldname: 'notes',
                label: '核准备注 (选填)'
              }
            ])
          ],
          primary_action_label: isLocked ? '反审核解锁' : '确认核定并全链条封账',
          primary_action: function(values) {
            d.get_primary_btn().prop('disabled', true);
            if (isLocked) {
              frappe.call({
                method: 'ashan_cn_procurement.services.invoice_closing_service.unlock_monthly_invoice_closing',
                args: {
                  company: company,
                  period: period,
                  unlock_reason: values.unlock_reason
                },
                callback: function(res) {
                  d.get_primary_btn().prop('disabled', false);
                  if (res && res.message && res.message.success) {
                    d.hide();
                    frappe.show_alert({ message: res.message.message, indicator: 'orange' }, 5);
                    loadAllData();
                  } else {
                    frappe.msgprint(res.message ? res.message.error : '操作失败');
                  }
                }
              });
            } else {
              frappe.call({
                method: 'ashan_cn_procurement.services.invoice_closing_service.lock_monthly_invoice_closing',
                args: {
                  company: company,
                  period: period,
                  notes: values.notes
                },
                callback: function(res) {
                  d.get_primary_btn().prop('disabled', false);
                  if (res && res.message && res.message.success) {
                    d.hide();
                    frappe.show_alert({ message: res.message.message, indicator: 'green' }, 5);
                    loadAllData();
                  } else {
                    frappe.msgprint(res.message ? res.message.error : '操作失败');
                  }
                }
              });
            }
          },
          secondary_action_label: '查看当月发票明细',
          secondary_action: function() {
            d.hide();
            frappe.route_options = {
              company: company,
              posting_date: ['between', [`${period}-01`, `${period}-31`]]
            };
            frappe.set_route('List', 'Purchase Invoice');
          }
        });

        d.show();
      }
    });
  }

  // 合规快速记录检验 Dialog
  function openComplianceQuickInspectDialog(doctype, docname, suggestedNext) {
    const d = new frappe.ui.Dialog({
      title: `记录周期检验/复审 · ${docname}`,
      fields: [
        {
          fieldtype: 'Date',
          fieldname: 'done_date',
          label: '完成日期',
          default: frappe.datetime.get_today(),
          reqd: 1
        },
        {
          fieldtype: 'Date',
          fieldname: 'next_due_date',
          label: '下次到期/检验日',
          default: suggestedNext,
          reqd: 1
        },
        {
          fieldtype: 'Small Text',
          fieldname: 'notes',
          label: '检验/处置备注'
        }
      ],
      primary_action_label: '保存并推进下期',
      primary_action: function(values) {
        frappe.call({
          method: 'ashan_cn_procurement.services.periodic_tasks.record_compliance_inspection',
          args: {
            doctype: doctype,
            docname: docname,
            done_date: values.done_date,
            next_due_date: values.next_due_date,
            notes: values.notes
          },
          callback: function(res) {
            if (res && res.message && res.message.success) {
              d.hide();
              frappe.show_alert({ message: res.message.message, indicator: 'green' }, 3);
              loadAllData();
            } else {
              frappe.msgprint(res.message ? res.message.error : '记录失败');
            }
          }
        });
      }
    });
    d.show();
  }

  // 初始加载
  loadAllData();

  wrapper.loadAllData = loadAllData;
};

frappe.pages['monthly-closing-center'].on_page_show = function(wrapper) {
  if (wrapper && typeof wrapper.loadAllData === "function") {
    wrapper.loadAllData();
  }
};
