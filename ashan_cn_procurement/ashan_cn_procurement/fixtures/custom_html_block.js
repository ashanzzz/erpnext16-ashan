(function () {
  function getRoot() {
    if (typeof root_element !== "undefined" && root_element) return root_element;
    const cbs = Array.from(document.querySelectorAll('*')).filter(el => el.tagName && el.tagName.startsWith('CUSTOM-BLOCK-'));
    for (const cb of cbs) {
      if (cb.shadowRoot && cb.shadowRoot.querySelector('.mission-control-container')) {
        return cb.shadowRoot;
      }
    }
    return document;
  }
  const ROOT = getRoot();

  function getCurrentUser() {
    return (frappe.session && frappe.session.user) ? frappe.session.user : "";
  }

  function isAdminUser() {
    const u = getCurrentUser();
    return u === "Administrator" || (frappe.user_roles || []).includes("System Manager");
  }

  function isFinanceUser() {
    if (isAdminUser()) return true;
    const roles = frappe.user_roles || [];
    return roles.includes("Accounts User") || roles.includes("Accounts Manager") || roles.includes("财务经理");
  }

  function userCanRead(doctype) {
    if (!doctype) return false;
    if (isAdminUser()) return true;
    if (frappe.model && typeof frappe.model.can_read === "function") {
      return frappe.model.can_read(doctype);
    }
    if (frappe.boot && frappe.boot.user && Array.isArray(frappe.boot.user.can_read)) {
      return frappe.boot.user.can_read.includes(doctype);
    }
    return true;
  }

  function userCanCreate(doctype) {
    if (!doctype) return false;
    if (isAdminUser()) return true;
    if (frappe.model && typeof frappe.model.can_create === "function") {
      return frappe.model.can_create(doctype);
    }
    if (frappe.boot && frappe.boot.user && Array.isArray(frappe.boot.user.can_create)) {
      return frappe.boot.user.can_create.includes(doctype);
    }
    return true;
  }

  function withOwnerFilter(filters) {
    const base = Object.assign({}, (filters || {}));
    if (!isAdminUser()) {
      base.owner = getCurrentUser();
    }
    return base;
  }

  function applyPermissionAdaptation() {
    const taskCards = ROOT.querySelectorAll('.task-pill-card[data-task-perm]');
    taskCards.forEach((card) => {
      const permTarget = card.getAttribute('data-task-perm');
      let isVisible = false;

      if (permTarget === "Payment Entry") {
        isVisible = isFinanceUser() && userCanRead("Purchase Invoice");
      } else if (permTarget === "Purchase Order") {
        isVisible = userCanCreate("Purchase Order") || userCanRead("Material Request");
      } else if (permTarget === "Purchase Receipt") {
        isVisible = userCanCreate("Purchase Receipt") || userCanRead("Purchase Order");
      } else if (permTarget === "Purchase Invoice") {
        isVisible = userCanCreate("Purchase Invoice") || userCanRead("Purchase Receipt");
      } else if (permTarget === "Reimbursement Request") {
        isVisible = userCanCreate("Reimbursement Request") || userCanRead("Purchase Invoice");
      } else {
        isVisible = userCanRead(permTarget);
      }

      if (!isVisible) {
        card.classList.add('step-hidden');
      } else {
        card.classList.remove('step-hidden');
      }
    });
  }

  function hasRole(role) {
    if (isAdminUser()) return true;
    const roles = frappe.user_roles || [];
    return roles.includes(role);
  }

  // ============================================================
  // 2.5 「我的业务」模块资产库与个性化引擎
  // ============================================================
  const MY_BIZ_CATALOG = [
    // 采购供应链
    {
      key: "material_request",
      title: "提物料申请",
      icon: "",
      colorClass: "btn-qa-blue",
      category: "采购供应链",
      route: "/desk/material-request-workbench",
      workbenchRoute: "material-request-workbench",
      permCheck: () => userCanCreate("Material Request") || userCanRead("Material Request"),
      defaultSelected: true,
    },
    {
      key: "wire_transfer",
      title: "自办电汇录单",
      icon: "",
      colorClass: "btn-qa-purple",
      category: "采购供应链",
      route: "/desk/wire-transfer-picker",
      workbenchRoute: "wire-transfer-picker",
      permCheck: () => isFinanceUser() && userCanRead("Purchase Invoice"),
      defaultSelected: true,
    },
    {
      key: "monthly_settlement",
      title: "月结补录录单",
      icon: "",
      colorClass: "btn-qa-teal",
      category: "采购供应链",
      route: "/desk/monthly-settlement-picker",
      workbenchRoute: "monthly-settlement-picker",
      permCheck: () => userCanCreate("Purchase Invoice") || userCanRead("Purchase Invoice"),
      defaultSelected: true,
    },
    {
      key: "procurement_workbench",
      title: "采购执行工作台",
      icon: "",
      colorClass: "btn-qa-amber",
      category: "采购供应链",
      route: "/desk/procurement-execution-workbench",
      workbenchRoute: "procurement-execution-workbench",
      permCheck: () => userCanCreate("Purchase Order") || userCanRead("Material Request"),
      defaultSelected: false,
    },
    {
      key: "material_receipt",
      title: "收货入库工作台",
      icon: "",
      colorClass: "btn-qa-emerald",
      category: "采购供应链",
      route: "/desk/material-receipt-workbench",
      workbenchRoute: "material-receipt-workbench",
      permCheck: () => userCanCreate("Purchase Receipt") || userCanRead("Purchase Order"),
      defaultSelected: false,
    },
    {
      key: "material_inventory",
      title: "物料资产总览",
      icon: "",
      colorClass: "btn-qa-cyan",
      category: "采购供应链",
      route: "/desk/material-inventory-workbench",
      workbenchRoute: "material-inventory-workbench",
      permCheck: () => userCanRead("Item"),
      defaultSelected: false,
    },
    {
      key: "supplier_ledger",
      title: "供应商结算台账",
      icon: "",
      colorClass: "btn-qa-slate",
      category: "采购供应链",
      route: "/desk/supplier-ledger-workbench",
      workbenchRoute: "supplier-ledger-workbench",
      permCheck: () => userCanRead("Supplier"),
      defaultSelected: false,
    },

    // 费用报销与税务
    {
      key: "reimbursement",
      title: "员工报销申请",
      icon: "",
      colorClass: "btn-qa-orange",
      category: "费用报销",
      route: "/desk/reimbursement-picker",
      workbenchRoute: "reimbursement-picker",
      permCheck: () => userCanCreate("Reimbursement Request") || userCanRead("Purchase Invoice"),
      defaultSelected: true,
    },
    {
      key: "reimbursement_workbench",
      title: "报销综合台账",
      icon: "",
      colorClass: "btn-qa-orange",
      category: "费用报销",
      route: "/desk/reimbursement-request-workbench",
      workbenchRoute: "reimbursement-request-workbench",
      permCheck: () => userCanRead("Reimbursement Request"),
      defaultSelected: false,
    },
    {
      key: "tax_invoice",
      title: "税局发票底册",
      icon: "",
      colorClass: "btn-qa-teal",
      category: "费用报销",
      route: "/desk/tax-invoice-ledger",
      workbenchRoute: "tax-invoice-ledger",
      permCheck: () => hasRole("Tax Invoice Manager") || hasRole("Tax Invoice Operator") || isAdminUser(),
      defaultSelected: false,
    },

    // 人力与薪酬
    {
      key: "qifu_payroll",
      title: "祺富薪酬中心",
      icon: "",
      colorClass: "btn-qa-indigo",
      category: "人力薪酬",
      route: "/desk/qifu-payroll-center",
      workbenchRoute: "qifu-payroll-center",
      permCheck: () => hasRole("Payroll Manager") || hasRole("Payroll Operator") || isAdminUser(),
      defaultSelected: true,
    },
    {
      key: "employee_list",
      title: "员工花名册",
      icon: "",
      colorClass: "btn-qa-blue",
      category: "人力薪酬",
      route: "/desk/Employee",
      workbenchRoute: "Employee",
      permCheck: () => userCanRead("Employee"),
      defaultSelected: false,
    },

    // 车辆与油卡
    {
      key: "oil_card_refuel",
      title: "加油能耗登记",
      icon: "",
      colorClass: "btn-qa-slate",
      category: "车辆油卡",
      route: "/desk/oil-card-refuel-log/new",
      workbenchRoute: "oil-card-refuel-log/new",
      permCheck: () => userCanCreate("Oil Card Refuel Log") || hasRole("Oil Card Operator") || hasRole("Oil Card Manager") || isAdminUser(),
      defaultSelected: true,
    },
    {
      key: "oil_card_ledger",
      title: "油卡综合台账",
      icon: "",
      colorClass: "btn-qa-sky",
      category: "车辆油卡",
      route: "/desk/oil-card-ledger",
      workbenchRoute: "oil-card-ledger",
      permCheck: () => hasRole("Oil Card Manager") || hasRole("Oil Card Operator") || isAdminUser(),
      defaultSelected: false,
    },
    {
      key: "vehicle_workbench",
      title: "车辆资产台账",
      icon: "",
      colorClass: "btn-qa-indigo",
      category: "车辆油卡",
      route: "/desk/Vehicle",
      workbenchRoute: "Vehicle",
      permCheck: () => userCanRead("Vehicle"),
      defaultSelected: false,
    },

    // 合规与物业
    {
      key: "compliance_center",
      title: "特种设备与合规",
      icon: "",
      colorClass: "btn-qa-rose",
      category: "合规物业",
      route: "/desk/compliance-management-center",
      workbenchRoute: "compliance-management-center",
      permCheck: () => hasRole("Compliance Manager") || hasRole("Compliance Operator") || isAdminUser(),
      defaultSelected: false,
    },
    {
      key: "property_workbench",
      title: "物业租赁中枢",
      icon: "",
      colorClass: "btn-qa-teal",
      category: "合规物业",
      route: "/desk/property-lease-center",
      workbenchRoute: "property-lease-center",
      permCheck: () => hasRole("Property Manager") || hasRole("Property Operator") || isAdminUser(),
      defaultSelected: false,
    }
  ];

  // ─── localStorage cache key helpers ─────────────────────────────────────
  function getMyBizStorageKey()  { return "ashan_my_biz_shortcuts_" + (getCurrentUser() || "default"); }
  function getMyBizClickKey()    { return "ashan_my_biz_clicks_"    + (getCurrentUser() || "default"); }
  function getMyBizAutoSortKey() { return "ashan_my_biz_autosort_"  + (getCurrentUser() || "default"); }

  // ─── Debounce helper for batched click sync to server ────────────────────
  const _myBizSyncTimer = { id: null };
  let   _pendingClickDeltas = {};

  function _flushClicksToServer() {
    if (!Object.keys(_pendingClickDeltas).length) return;
    const toSend = Object.assign({}, _pendingClickDeltas);
    _pendingClickDeltas = {};
    frappe.call({
      method: "ashan_cn_procurement.services.user_preference_service.save_my_biz_prefs",
      args: { click_counts: JSON.stringify(toSend) },
      freeze: false,
      callback: function() {}
    });
  }

  function _scheduleClickFlush() {
    clearTimeout(_myBizSyncTimer.id);
    _myBizSyncTimer.id = setTimeout(_flushClicksToServer, 1500);
  }

  // ─── One-time server pull on page load ───────────────────────────────────
  let _serverPrefsLoaded = false;

  function initMyBizPrefsFromServer() {
    if (_serverPrefsLoaded) return;
    _serverPrefsLoaded = true;
    frappe.call({
      method: "ashan_cn_procurement.services.user_preference_service.get_my_biz_prefs",
      freeze: false,
      callback: function(r) {
        if (!r || r.exc || !r.message) return;
        const prefs = r.message;
        if (Array.isArray(prefs.shortcuts)) {
          try { localStorage.setItem(getMyBizStorageKey(), JSON.stringify(prefs.shortcuts)); } catch(e) {}
        }
        if (typeof prefs.auto_sort === 'boolean') {
          try { localStorage.setItem(getMyBizAutoSortKey(), prefs.auto_sort ? 'true' : 'false'); } catch(e) {}
        }
        if (prefs.click_counts && typeof prefs.click_counts === 'object') {
          const local = getMyBizClickCounts();
          const merged = Object.assign({}, prefs.click_counts);
          Object.keys(local).forEach(k => { merged[k] = Math.max(merged[k] || 0, local[k] || 0); });
          try { localStorage.setItem(getMyBizClickKey(), JSON.stringify(merged)); } catch(e) {}
        }
        renderMyBizStrip();
      }
    });
  }

  // ─── Read helpers (localStorage cache, always instant) ───────────────────
  function getMyBizKeys() {
    const raw = localStorage.getItem(getMyBizStorageKey());
    if (raw) {
      try {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr) && arr.length >= 0) return arr;
      } catch (e) {}
    }
    return MY_BIZ_CATALOG.filter(it => it.defaultSelected).map(it => it.key);
  }

  function getMyBizClickCounts() {
    try { return JSON.parse(localStorage.getItem(getMyBizClickKey()) || '{}'); }
    catch (e) { return {}; }
  }

  function getMyBizAutoSort() {
    try { return localStorage.getItem(getMyBizAutoSortKey()) === 'true'; }
    catch (e) { return false; }
  }

  // ─── Write helpers (localStorage first → async to server) ────────────────
  function saveMyBizKeys(keys) {
    try { localStorage.setItem(getMyBizStorageKey(), JSON.stringify(keys)); } catch(e) {}
    frappe.call({
      method: "ashan_cn_procurement.services.user_preference_service.save_my_biz_prefs",
      args: { shortcuts: JSON.stringify(keys) },
      freeze: false, callback: function() {}
    });
  }

  function saveMyBizAutoSort(enabled) {
    try { localStorage.setItem(getMyBizAutoSortKey(), enabled ? 'true' : 'false'); } catch(e) {}
    frappe.call({
      method: "ashan_cn_procurement.services.user_preference_service.save_my_biz_prefs",
      args: { auto_sort: enabled ? 'true' : 'false' },
      freeze: false, callback: function() {}
    });
  }

  function recordMyBizClick(key) {
    const counts = getMyBizClickCounts();
    counts[key] = (counts[key] || 0) + 1;
    try { localStorage.setItem(getMyBizClickKey(), JSON.stringify(counts)); } catch(e) {}
    _pendingClickDeltas[key] = (_pendingClickDeltas[key] || 0) + 1;
    _scheduleClickFlush();
  }

  function clearMyBizClickCounts() {
    try { localStorage.removeItem(getMyBizClickKey()); } catch(e) {}
    _pendingClickDeltas = {};
    clearTimeout(_myBizSyncTimer.id);
    frappe.call({
      method: "ashan_cn_procurement.services.user_preference_service.clear_my_biz_click_counts",
      freeze: false, callback: function() {}
    });
  }

  function renderMyBizStrip() {
    const container = ROOT.querySelector('#my-biz-quick-actions-btns');
    if (!container) return;

    const savedKeys = getMyBizKeys();
    const catalogMap = new Map(MY_BIZ_CATALOG.map(it => [it.key, it]));
    const autoSort = getMyBizAutoSort();
    const counts = autoSort ? getMyBizClickCounts() : {};

    // Filter valid items in saved order and check permission
    let visibleItems = [];
    savedKeys.forEach(k => {
      const item = catalogMap.get(k);
      if (item && item.permCheck()) {
        visibleItems.push(item);
      }
    });

    // If auto-sort enabled, stable-sort by click count descending
    if (autoSort && visibleItems.length > 1) {
      visibleItems = visibleItems
        .map((it, originalIdx) => ({ it, originalIdx, cnt: counts[it.key] || 0 }))
        .sort((a, b) => b.cnt - a.cnt || a.originalIdx - b.originalIdx)
        .map(x => x.it);
    }

    if (visibleItems.length === 0) {
      container.innerHTML = `<span class="my-biz-empty-hint">暂未配置业务入口，点击右侧自定义添加</span>`;
      return;
    }

    container.innerHTML = visibleItems.map(it => {
      const wbAttr = it.workbenchRoute ? `data-workbench-route="${it.workbenchRoute}"` : '';
      const cntBadge = autoSort && counts[it.key] > 0
        ? `<span class="my-biz-freq-badge">${counts[it.key]}</span>`
        : '';
      return `
        <a href="${it.route}" class="quick-action-btn ${it.colorClass}" ${wbAttr} data-biz-key="${it.key}">
          ${frappe.utils.escape_html(it.title)}${cntBadge}
        </a>
      `;
    }).join('');

    // Track clicks on each button
    container.querySelectorAll('a[data-biz-key]').forEach(a => {
      a.addEventListener('click', (e) => {
        const k = a.getAttribute('data-biz-key');
        if (k) {
          recordMyBizClick(k);
          if (getMyBizAutoSort()) {
            // Defer re-render so frappe.set_route runs first
            setTimeout(() => renderMyBizStrip(), 50);
          }
        }
      });
    });

    bindAllWorkbenchAndRouteLinks();
  }

  function openMyBizCustomizeDialog() {
    const catalogMap = new Map(MY_BIZ_CATALOG.map(it => [it.key, it]));
    let currentKeys = [...getMyBizKeys()];
    let autoSort = getMyBizAutoSort();

    // Permitted items for this user
    const permittedItems = MY_BIZ_CATALOG.filter(it => it.permCheck());
    const permittedKeysSet = new Set(permittedItems.map(it => it.key));

    // Filter out keys the user has no perm for
    currentKeys = currentKeys.filter(k => permittedKeysSet.has(k));

    const d = new frappe.ui.Dialog({
      title: '自定义「我的业务」快捷直达',
      size: 'large',
      static: true,
      fields: [
        {
          fieldtype: 'HTML',
          fieldname: 'custom_html',
        }
      ],
      primary_action_label: '保存并应用',
      primary_action: function () {
        saveMyBizKeys(currentKeys);
        saveMyBizAutoSort(autoSort);
        renderMyBizStrip();
        frappe.show_alert({ message: '「我的业务」快捷直达已保存', indicator: 'green' }, 3);
        d.hide();
      },
      secondary_action_label: '关闭',
      secondary_action: function () {
        d.hide();
      }
    });

    function renderDialogBody() {
      const htmlField = d.get_field('custom_html');
      if (!htmlField || !htmlField.$wrapper) return;

      const currentSelectedItems = currentKeys.map(k => catalogMap.get(k)).filter(Boolean);
      const selectedKeysSet = new Set(currentKeys);
      const availableItems = permittedItems.filter(it => !selectedKeysSet.has(it.key));
      const counts = getMyBizClickCounts();

      // Group available by category
      const categories = ["采购供应链", "费用报销", "人力薪酬", "车辆油卡", "合规物业"];
      const candByCat = {};
      categories.forEach(c => { candByCat[c] = []; });
      availableItems.forEach(it => {
        if (!candByCat[it.category]) candByCat[it.category] = [];
        candByCat[it.category].push(it);
      });

      let selectedListHtml = '';
      if (currentSelectedItems.length === 0) {
        selectedListHtml = `<div class="my-biz-empty-hint" style="padding: 10px; text-align: center;">尚未选择任何业务，请从下方资产库中添加</div>`;
      } else {
        const displayItems = autoSort
          ? [...currentSelectedItems]
              .map((it, oi) => ({ it, oi, cnt: counts[it.key] || 0 }))
              .sort((a, b) => b.cnt - a.cnt || a.oi - b.oi)
              .map(x => x.it)
          : currentSelectedItems;

        selectedListHtml = displayItems.map((it, idx) => {
          const origIdx = currentKeys.indexOf(it.key);
          const isFirst = origIdx === 0;
          const isLast = origIdx === currentKeys.length - 1;
          const cnt = counts[it.key] || 0;
          const freqBadge = cnt > 0
            ? `<span class="my-biz-freq-badge-dialog" title="本机累计点击 ${cnt} 次">${cnt} 次</span>`
            : '';
          const moveDisabled = autoSort ? 'disabled title="自动排序开启时，请先关闭后再手动调序"' : '';
          return `
            <div class="my-biz-selected-item" data-key="${it.key}">
              <div class="my-biz-item-left">
                <span class="my-biz-item-idx">#${idx + 1}</span>
                
                <span class="my-biz-item-name">${frappe.utils.escape_html(it.title)}</span>
                <span class="my-biz-item-cat">${frappe.utils.escape_html(it.category)}</span>
                ${freqBadge}
              </div>
              <div class="my-biz-item-actions">
                <button type="button" class="btn-mybiz-tool btn-tool-up" data-idx="${origIdx}" ${isFirst || autoSort ? moveDisabled + (isFirst ? ' disabled' : '') : ''} title="上移">上移</button>
                <button type="button" class="btn-mybiz-tool btn-tool-down" data-idx="${origIdx}" ${isLast || autoSort ? moveDisabled + (isLast ? ' disabled' : '') : ''} title="下移">下移</button>
                <button type="button" class="btn-mybiz-tool btn-tool-del" data-key="${it.key}" title="移除">移除</button>
              </div>
            </div>
          `;
        }).join('');
      }

      let candHtml = '';
      categories.forEach(cat => {
        const items = candByCat[cat] || [];
        if (items.length === 0) return;
        candHtml += `
          <div class="my-biz-cand-category">
            <div class="my-biz-cand-cat-title">${cat} (${items.length})</div>
            <div class="my-biz-cand-grid">
              ${items.map(it => `
                <div class="my-biz-cand-card">
                  <div class="my-biz-cand-left">
                    <span>${it.icon}</span>
                    <span class="my-biz-cand-name">${frappe.utils.escape_html(it.title)}</span>
                  </div>
                  <button type="button" class="btn-cand-add" data-key="${it.key}">添加</button>
                </div>
              `).join('')}
            </div>
          </div>
        `;
      });

      if (!candHtml) {
        candHtml = `<div class="my-biz-empty-hint" style="padding: 10px; text-align: center;">所有权限内业务模块已全部添加至我的业务</div>`;
      }

      // Auto-sort toggle strip
      const autoSortHtml = `
        <div class="my-biz-autosort-row">
          <div class="my-biz-autosort-left">
            
            <div class="my-biz-autosort-text">
              <span class="my-biz-autosort-title">智能频次自动排序</span>
              <span class="my-biz-autosort-desc">根据您的实际点击习惯，自动将常用业务前置显示</span>
            </div>
          </div>
          <label class="my-biz-toggle-label">
            <input type="checkbox" id="chk-autosort" class="my-biz-toggle-input" ${autoSort ? 'checked' : ''}>
            <span class="my-biz-toggle-track">
              <span class="my-biz-toggle-thumb"></span>
            </span>
            <span class="my-biz-toggle-state-text">${autoSort ? '已开启' : '已关闭'}</span>
          </label>
        </div>
      `;

      const totalHtml = `
        <div class="my-biz-dialog-wrapper">
          <div class="my-biz-section">
            <div class="my-biz-section-title">
              <span>当前已选业务 (${currentSelectedItems.length})</span>
              <div style="display:flex;gap:8px;align-items:center;">
                <button type="button" class="btn-mybiz-tool" id="btn-clear-freq-data" title="清除本机点击记录">清除频次记录</button>
                <button type="button" class="btn-mybiz-tool" id="btn-reset-default-biz">恢复系统推荐</button>
              </div>
            </div>
            ${autoSortHtml}
            <div class="my-biz-selected-list">
              ${selectedListHtml}
            </div>
          </div>

          <div class="my-biz-section">
            <div class="my-biz-section-title">
              <span>权限内可用业务资产库</span>
              <span class="my-biz-section-tip">已根据您的实际角色与权限自动过滤</span>
            </div>
            <div class="my-biz-cand-wrapper">
              ${candHtml}
            </div>
          </div>
        </div>
      `;

      htmlField.$wrapper.html(totalHtml);

      // Toggle auto-sort
      htmlField.$wrapper.find('#chk-autosort').on('change', function () {
        autoSort = $(this).is(':checked');
        renderDialogBody();
      });

      // Event listeners: Up / Down / Del / Add / Reset / Clear freq
      htmlField.$wrapper.find('.btn-tool-up').on('click', function () {
        if (autoSort) return;
        const idx = parseInt($(this).data('idx'));
        if (idx > 0) {
          const temp = currentKeys[idx];
          currentKeys[idx] = currentKeys[idx - 1];
          currentKeys[idx - 1] = temp;
          renderDialogBody();
        }
      });

      htmlField.$wrapper.find('.btn-tool-down').on('click', function () {
        if (autoSort) return;
        const idx = parseInt($(this).data('idx'));
        if (idx < currentKeys.length - 1) {
          const temp = currentKeys[idx];
          currentKeys[idx] = currentKeys[idx + 1];
          currentKeys[idx + 1] = temp;
          renderDialogBody();
        }
      });

      htmlField.$wrapper.find('.btn-tool-del').on('click', function () {
        const key = $(this).data('key');
        currentKeys = currentKeys.filter(k => k !== key);
        renderDialogBody();
      });

      htmlField.$wrapper.find('.btn-cand-add').on('click', function () {
        const key = $(this).data('key');
        if (!currentKeys.includes(key)) {
          currentKeys.push(key);
          renderDialogBody();
        }
      });

      htmlField.$wrapper.find('#btn-reset-default-biz').on('click', function () {
        currentKeys = MY_BIZ_CATALOG.filter(it => it.defaultSelected && it.permCheck()).map(it => it.key);
        renderDialogBody();
        frappe.show_alert({ message: '已恢复系统推荐业务配置', indicator: 'blue' }, 2);
      });

      htmlField.$wrapper.find('#btn-clear-freq-data').on('click', function () {
        clearMyBizClickCounts();
        renderDialogBody();
        frappe.show_alert({ message: '频次记录已清除', indicator: 'orange' }, 2);
      });
    }

    d.show();
    renderDialogBody();
  }

  // ============================================================
  // 3. 通用路由与点击跳转拦截 (支持工作台直通与原生路由)
  // ============================================================
  function bindAllWorkbenchAndRouteLinks() {
    const wbLinks = ROOT.querySelectorAll('[data-workbench-route]');
    wbLinks.forEach((a) => {
      if (a.dataset && a.dataset.wbBound === "1") return;
      if (a.dataset) a.dataset.wbBound = "1";

      a.addEventListener('click', (e) => {
        const isNewTab = e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0;
        if (isNewTab) return;

        e.preventDefault();
        const wbRoute = a.getAttribute('data-workbench-route');
        if (wbRoute) {
          const parts = wbRoute.split('#');
          const routeName = parts[0];
          const hashParam = parts[1] || '';
          if (hashParam) {
            window.location.hash = hashParam;
          }
          frappe.set_route(routeName);
        }
      });
    });
  }

  // ============================================================
  // 4. 日常待办数据统计 (6 大任务实时计算)
  // ============================================================
  let todayTotalPending = 0;
  let todayTaskCounts = { po: 0, pr: 0, pi: 0, rr: 0, pay: 0, reim: 0 };

  function checkUpdateTodayCapsule() {
    const cap = ROOT.querySelector('#cap-today');
    const capText = ROOT.querySelector('#cap-text-today');
    if (!cap || !capText) return;

    todayTotalPending = Object.values(todayTaskCounts).reduce((a, b) => a + b, 0);
    if (todayTotalPending > 0) {
      cap.className = 'status-capsule capsule-today has-pending';
      capText.innerHTML = `日常待办：<b>${todayTotalPending}</b> 笔需处理`;
    } else {
      cap.className = 'status-capsule capsule-today all-done';
      capText.innerHTML = '日常待办：已全部清空';
    }
  }

  function updateTaskPill(pillId, textId, actId, count, singleUnitLabel, zeroLabel, taskKey) {
    const pill = ROOT.querySelector(pillId);
    const text = ROOT.querySelector(textId);
    const act = ROOT.querySelector(actId);
    if (!pill || !text) return;

    pill.classList.remove('is-loading', 'is-done', 'has-pending');
    todayTaskCounts[taskKey] = count || 0;
    checkUpdateTodayCapsule();

    if ((count || 0) > 0) {
      pill.classList.add('has-pending');
      text.innerHTML = `<b>${count}</b> ${singleUnitLabel}待处理`;
      if (act) {
        act.classList.remove('is-disabled');
      }
    } else {
      pill.classList.add('is-done');
      text.innerHTML = zeroLabel || '已全部处理';
      if (act) {
        act.classList.add('is-disabled');
      }
    }
  }

  function fetchTaskCardCount(doctype, filters, pillId, textId, actId, unitLabel, applyOwner, taskKey) {
    if (!userCanRead(doctype)) return;
    const actualFilters = applyOwner ? withOwnerFilter(filters) : filters;

    frappe.db.count(doctype, { filters: actualFilters })
      .then((count) => {
        updateTaskPill(pillId, textId, actId, count, unitLabel, '已全部处理', taskKey);
      })
      .catch(() => {
        const pill = ROOT.querySelector(pillId);
        const text = ROOT.querySelector(textId);
        if (pill) pill.classList.remove('is-loading');
        if (text) text.innerText = '统计失败';
      });
  }

  function fetchTaskPendingReimbursement() {
    if (!userCanRead('Purchase Invoice')) return;

    const pillId = '#pill-reim';
    const textId = '#pill-text-reim';
    const actId = '#act-reim';

    frappe.call({
      method: 'ashan_cn_procurement.services.periodic_tasks.get_pending_reimbursement_count',
      callback: function(r) {
        const count = (r && r.message) ? (r.message.count || 0) : 0;
        updateTaskPill(pillId, textId, actId, count, '笔发票', '无垫付待报销', 'reim');
      },
      error: function() {
        const pill = ROOT.querySelector(pillId);
        const text = ROOT.querySelector(textId);
        if (pill) pill.classList.remove('is-loading');
        if (text) text.innerText = '0 笔待报销';
      }
    });
  }

  function reloadAllTasks() {
    // 1. 待采购下单
    fetchTaskCardCount('Material Request', { docstatus: 1, status: ['in', ['Submitted', 'Pending', 'Partially Ordered']] }, '#pill-po', '#pill-text-po', '#act-po', '笔申请', false, 'po');
    // 2. 待物资入库
    fetchTaskCardCount('Purchase Order', { docstatus: 1, status: ['in', ['On Hold', 'To Receive', 'To Receive and Bill']] }, '#pill-pr', '#pill-text-pr', '#act-pr', '笔订单', false, 'pr');
    // 3. 待采购开票
    fetchTaskCardCount('Purchase Receipt', { status: ['in', ['Partly Billed', 'To Bill']] }, '#pill-pi', '#pill-text-pi', '#act-pi', '笔入库单', true, 'pi');
    // 4. 待整算审批
    fetchTaskCardCount('Purchase Invoice', { docstatus: 1, custom_biz_mode: ['in', ['现金报销', '综合采购']], outstanding_amount: ['>', 0] }, '#pill-rr', '#pill-text-rr', '#act-rr', '笔发票', false, 'rr');
    // 5. 待对公付款
    fetchTaskCardCount('Purchase Invoice', { docstatus: 1, custom_biz_mode: ['!=', '自办电汇'], outstanding_amount: ['>', 0] }, '#pill-pay', '#pill-text-pay', '#act-pay', '笔发票', false, 'pay');
    // 6. 待发起报销
    fetchTaskPendingReimbursement();
  }

  // ============================================================
  // 5. 发票月度核定关账 Dialog
  // ============================================================
  function openInvoiceClosingDialog(company, period, periodLabel) {
    frappe.call({
      method: 'ashan_cn_procurement.services.invoice_closing_service.get_invoice_closing_data',
      args: { company: company, period: period },
      callback: function(r) {
        if (!r || !r.message) return;
        const d_data = r.message;
        const isLocked = d_data.is_locked;

        const d = new frappe.ui.Dialog({
          title: `发票月度核定关账 · ${company}`,
          fields: [
            {
              fieldtype: 'HTML',
              fieldname: 'stats_html',
              options: `
                <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px; margin-bottom:12px;">
                  <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                    <span style="font-size:13px; font-weight:700; color:#1e293b;">核定账期：${periodLabel || period} (${period})</span>
                    <span style="font-size:12px; font-weight:700; color:${isLocked ? '#16a34a' : '#d97706'};">
                      ${isLocked ? '已核定关账锁定' : '草稿 / 未关账'}
                    </span>
                  </div>
                  <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap:8px; font-size:12px;">
                    <div>已录入发票：<b>${d_data.invoice_count}</b> 笔</div>
                    <div>价税总额：<b style="color:#2563eb;">¥ ${format_currency(d_data.total_grand_total)}</b></div>
                    <div>不含税金额：<b>¥ ${format_currency(d_data.total_net_amount)}</b></div>
                    <div>进项税额：<b>¥ ${format_currency(d_data.total_tax_amount)}</b></div>
                  </div>
                  ${isLocked ? `
                    <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #cbd5e1; font-size:11px; color:#64748b;">
                      核定人：${d_data.locked_by || '-'} ｜ 核定时间：${d_data.locked_at || '-'}
                    </div>
                  ` : ''}
                </div>
                ${!isLocked ? `
                  <div style="background:#fffbeb; border:1px solid #fde68a; border-radius:6px; padding:8px 10px; font-size:11.5px; color:#b45309; margin-bottom:12px;">
                    <b>核定锁定说明：</b>核定关账后，系统将<b>严密禁止</b>新增、修改或提交发票日期/记账日期为 <b>${periodLabel || period}</b> 的任何发票！
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
          primary_action_label: isLocked ? '反审核解锁' : '确认核定并关账锁定',
          primary_action: function(values) {
            d.get_primary_btn().prop('disabled', true);
            if (isLocked) {
              // 反审核解锁
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
                    fetchMonthlySettlementStatus();
                  } else {
                    frappe.msgprint(res.message ? res.message.error : '操作失败');
                  }
                }
              });
            } else {
              // 确认核定关账
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
                    fetchMonthlySettlementStatus();
                  } else {
                    frappe.msgprint(res.message ? res.message.error : '操作失败');
                  }
                }
              });
            }
          },
          secondary_action_label: '查看当月发票列表',
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

  // ============================================================
  // 6. 月度任务逻辑 (每个小项目自适应探测最早未核定月份)
  // ============================================================
  function renderPeriodicCompanyItems(containerSel, badgeSel, titleSel, companyPrefix, items) {
    const box = ROOT.querySelector(containerSel);
    const badge = ROOT.querySelector(badgeSel);
    const titleEl = ROOT.querySelector(titleSel);
    if (!box) return;

    if (titleEl) {
      titleEl.innerText = `${companyPrefix} · 月度核定`;
    }

    if (!items || items.length === 0) {
      box.innerHTML = '<div class="periodic-item-empty">当前无需核定事项</div>';
      if (badge) {
        badge.innerText = '无待办';
        badge.className = 'company-status-badge';
      }
      return;
    }

    const allDone = items.every(i => i.status === 'settled');
    const pendingCount = items.filter(i => i.status !== 'settled').length;

    if (badge) {
      if (allDone) {
        badge.innerText = '全部核定';
        badge.className = 'company-status-badge badge-done';
      } else {
        badge.innerText = `待核定 ${pendingCount} 项`;
        badge.className = 'company-status-badge badge-pending';
      }
    }

    const html = items.map(it => {
      const isSettled = it.status === 'settled';
      const actionClass = isSettled ? 'monthly-item-action action-done' : 'monthly-item-action';
      const actionText = isSettled ? (it.status_label || '已核定') : ((it.action_label || '去核定').replace(/[\u2794\u2192]/g, '').trim());

      const isInvAction = it.is_invoice_action ? 'data-is-inv="1"' : '';
      const compAttr = it.company_name ? `data-comp="${frappe.utils.escape_html(it.company_name)}"` : '';
      const periodAttr = it.target_period ? `data-period="${frappe.utils.escape_html(it.target_period)}"` : '';
      const periodLblAttr = it.target_period_label ? `data-period-label="${frappe.utils.escape_html(it.target_period_label)}"` : '';

      return `
        <div class="monthly-item-row">
          <div class="monthly-item-left">
            
            <div class="monthly-item-meta">
              <span class="monthly-item-title">${frappe.utils.escape_html(it.title)}</span>
              <span class="monthly-item-summary">${frappe.utils.escape_html(it.summary_text || '')}</span>
            </div>
          </div>
          <a href="${it.route || '#'}" class="${actionClass}" data-route="${(it.route || '').replace('/desk/', '')}" ${isInvAction} ${compAttr} ${periodAttr} ${periodLblAttr}>
            ${actionText}
          </a>
        </div>
      `;
    }).join('');

    box.innerHTML = html;

    box.querySelectorAll('a[data-is-inv="1"]').forEach(a => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const comp = a.getAttribute('data-comp');
        const period = a.getAttribute('data-period');
        const periodLabel = a.getAttribute('data-period-label');
        openInvoiceClosingDialog(comp, period, periodLabel);
      });
    });

    box.querySelectorAll('a[data-route]:not([data-is-inv="1"])').forEach(a => {
      a.addEventListener('click', (e) => {
        const isNewTab = e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0;
        if (isNewTab) return;
        const r = a.getAttribute('data-route');
        if (r && r !== '#') {
          e.preventDefault();
          frappe.set_route(r);
        }
      });
    });
  }

  function fetchMonthlySettlementStatus() {
    const badge = ROOT.querySelector('#periodic-period-badge');
    const capMonth = ROOT.querySelector('#cap-month');
    const capTextMonth = ROOT.querySelector('#cap-text-month');

    frappe.call({
      method: 'ashan_cn_procurement.services.periodic_tasks.get_monthly_settlement_status',
      callback: function (r) {
        if (r && r.message) {
          const data = r.message;
          const comp = data.companies || {};
          const jizhong = comp.jizhong || {};
          const qifu = comp.qifu || {};

          const pendingCount = (data.total_items || 0) - (data.settled_items || 0);

          if (badge) {
            if (pendingCount > 0) {
              badge.innerText = `待核定 ${pendingCount} 项`;
              badge.className = 'panel-badge badge-pending';
            } else if ((data.total_items || 0) > 0 && data.all_done) {
              badge.innerText = '全部核定';
              badge.className = 'panel-badge badge-done';
            } else {
              badge.innerText = '月度事项全景感知';
              badge.className = 'panel-badge';
            }
          }

          if (capMonth && capTextMonth) {
            if (pendingCount > 0) {
              capMonth.className = 'status-capsule capsule-month has-pending';
              capTextMonth.innerHTML = `月度任务：<b>${pendingCount} 项</b>待核定`;
            } else {
              capMonth.className = 'status-capsule capsule-month all-done';
              capTextMonth.innerHTML = '月度任务：全部核定';
            }
          }

          const jzCard = ROOT.querySelector('#company-card-jizhong');
          if (jzCard) {
            if (jizhong.visible) {
              jzCard.style.display = 'block';
              renderPeriodicCompanyItems('#jizhong-items-list', '#jizhong-status-badge', '#jizhong-subcard-title', '吉众', jizhong.items);
            } else {
              jzCard.style.display = 'none';
            }
          }

          const qfCard = ROOT.querySelector('#company-card-qifu');
          if (qfCard) {
            if (qifu.visible) {
              qfCard.style.display = 'block';
              renderPeriodicCompanyItems('#qifu-items-list', '#qifu-status-badge', '#qifu-subcard-title', '祺富', qifu.items);
            } else {
              qfCard.style.display = 'none';
            }
          }

          setTimeout(adjustDualPanelsHeight, 50);
        }
      }
    });
  }

  // ============================================================
  // 7. 周期任务 (合规与证照特种设备)
  // ============================================================
  function openComplianceActionDialog(item) {
    const d = new frappe.ui.Dialog({
      title: `${item.category || '合规'}核定 · ${item.title}`,
      fields: [
        {
          fieldtype: 'HTML',
          fieldname: 'info_html',
          options: `
            <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; margin-bottom:12px; font-size:12px;">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span style="color:#64748b;">归属主体：<b>${frappe.utils.escape_html(item.company || '')}</b></span>
                <span style="color:#64748b;">预设周期：<b>每 ${item.cycle_months || 3} 个月</b></span>
              </div>
              <div style="display:flex; justify-content:space-between;">
                <span style="color:#64748b;">原到期日：<b style="color:#0f172a;">${item.due_date}</b></span>
                <span style="color:${item.level === 'danger' ? '#dc2626' : '#d97706'}; font-weight:700;">${item.status_text}</span>
              </div>
            </div>
          `
        },
        {
          fieldtype: 'Select',
          fieldname: 'action_choice',
          label: '处理方式',
          options: [
            { label: '已完成外部检验/检测（更新下期到期日）', value: 'done_inspection' },
            { label: '需要发起采购申请委托第三方处理', value: 'procure' }
          ],
          default: 'done_inspection'
        },
        {
          fieldtype: 'Date',
          fieldname: 'done_date',
          label: '本次检验/处置完成日期',
          default: frappe.datetime.get_today(),
          reqd: 1,
          onchange: function() {
            const doneD = d.get_value('done_date');
            if (doneD && item.cycle_months) {
              const nextD = frappe.datetime.add_months(doneD, parseInt(item.cycle_months) || 3);
              d.set_value('next_due_date', nextD);
            }
          }
        },
        {
          fieldtype: 'Date',
          fieldname: 'next_due_date',
          label: '下期检验/到期日 (系统根据周期自动推算，支持微调)',
          default: item.suggested_next_due || frappe.datetime.add_months(frappe.datetime.get_today(), parseInt(item.cycle_months) || 3),
          reqd: 1
        },
        {
          fieldtype: 'Small Text',
          fieldname: 'notes',
          label: '执行备注 / 报告编号 (选填)'
        }
      ],
      primary_action_label: '确认并更新台账',
      primary_action: function(values) {
        if (values.action_choice === 'procure') {
          d.hide();
          frappe.new_doc('Material Request', {
            material_request_type: 'Purchase',
            company: item.company === '祺富' ? '天津祺富机械加工有限公司' : '天津吉众机电设备有限公司',
            schedule_date: item.due_date
          });
          return;
        }

        d.get_primary_btn().prop('disabled', true);
        frappe.call({
          method: 'ashan_cn_procurement.services.periodic_tasks.record_compliance_inspection',
          args: {
            doctype: item.doctype,
            docname: item.docname,
            done_date: values.done_date,
            next_due_date: values.next_due_date,
            notes: values.notes
          },
          callback: function(r) {
            d.get_primary_btn().prop('disabled', false);
            if (r && r.message && r.message.success) {
              d.hide();
              frappe.show_alert({
                message: `已成功记录！下期到期日已更新至: ${r.message.next_due_date}`,
                indicator: 'green'
              }, 5);
              fetchComplianceExpiryStatus();
            } else {
              frappe.msgprint(r.message ? r.message.error : '更新失败');
            }
          }
        });
      },
      secondary_action_label: '查看台账原表单',
      secondary_action: function() {
        d.hide();
        if (item.route) {
          frappe.set_route(item.route.replace('/desk/', ''));
        }
      }
    });

    d.show();
  }

  function fetchComplianceExpiryStatus() {
    const list = ROOT.querySelector('#expiry-items-list');
    const badge = ROOT.querySelector('#expiry-summary-badge');
    const capExpiry = ROOT.querySelector('#cap-expiry');
    const capTextExpiry = ROOT.querySelector('#cap-text-expiry');

    if (!list) return;

    frappe.call({
      method: 'ashan_cn_procurement.services.periodic_tasks.get_compliance_expiry_status',
      callback: function (r) {
        if (r && r.message) {
          const data = r.message;
          const items = data.items || [];

          if (badge) {
            if (data.danger_count > 0) {
              badge.innerText = `${data.danger_count} 项已超期`;
              badge.className = 'panel-badge badge-pending';
            } else if (data.warning_count > 0) {
              badge.innerText = `${data.warning_count} 项临期关注`;
              badge.className = 'panel-badge badge-pending';
            } else {
              badge.innerText = `全项合规`;
              badge.className = 'panel-badge badge-done';
            }
          }

          if (capExpiry && capTextExpiry) {
            if (data.danger_count > 0) {
              capExpiry.className = 'status-capsule capsule-expiry has-pending';
              capTextExpiry.innerHTML = `周期任务：<b>${data.danger_count}</b> 项已超期`;
            } else if (data.warning_count > 0) {
              capExpiry.className = 'status-capsule capsule-expiry has-pending';
              capTextExpiry.innerHTML = `周期任务：<b>${data.warning_count}</b> 项临期`;
            } else {
              capExpiry.className = 'status-capsule capsule-expiry all-done';
              capTextExpiry.innerHTML = '周期任务：全项合规在期';
            }
          }

          if (items.length === 0) {
            list.innerHTML = `
              <div class="expiry-all-valid-box">
                当前无临期或超期事项，各合同与特种证照运转良好
              </div>
            `;
            return;
          }

          const html = items.map((it, idx) => {
            const levelClass = `level-${it.level || 'info'}`;
            const tagClass = `tag-${it.level || 'info'}`;

            return `
              <div class="expiry-row ${levelClass}" data-idx="${idx}">
                <div class="expiry-left">
                  
                  <div class="expiry-meta">
                    <span class="expiry-title">${frappe.utils.escape_html(it.title)}</span>
                    <span class="expiry-desc">${frappe.utils.escape_html(it.company || '')} · 到期日: ${it.due_date}</span>
                  </div>
                </div>
                <div class="expiry-right">
                  <span class="expiry-tag ${tagClass}">${frappe.utils.escape_html(it.status_text)}</span>
                  <button type="button" class="expiry-action-btn btn-open-dialog" data-idx="${idx}">
                    ${frappe.utils.escape_html((it.action_label || '记录核定').replace(/[\u2794\u2192]/g, '').trim())}
                  </button>
                </div>
              </div>
            `;
          }).join('');

          list.innerHTML = html;

          list.querySelectorAll('.btn-open-dialog').forEach(btn => {
            btn.addEventListener('click', () => {
              const idx = parseInt(btn.getAttribute('data-idx'));
              const item = items[idx];
              if (item) openComplianceActionDialog(item);
            });
          });
          setTimeout(adjustDualPanelsHeight, 50);
        }
      }
    });
  }

  // ============================================================
  // 7.5 动态视口高度自适应引擎 (Dynamic Viewport Height Adaptation)
  // ============================================================
  function adjustDualPanelsHeight() {
    const rootEl = getRoot();
    const dualRow = rootEl ? rootEl.querySelector('.mission-row-dual') : null;
    if (!dualRow) return;

    if (window.innerWidth <= 860) {
      dualRow.style.height = 'auto';
      dualRow.querySelectorAll('.panel-card').forEach(c => { c.style.height = 'auto'; });
      return;
    }

    // 测量双列网格相对于当前视口顶部的实际位置
    const rect = dualRow.getBoundingClientRect();
    const topOffset = rect.top;

    // 预留底部舒适呼吸边距 (26px)，保证整个卡片在用户视口内完整可见，消除外层纵向滚动条
    const bottomMargin = 26;
    const availableHeight = window.innerHeight - topOffset - bottomMargin;

    // 设立流式自适应高度（弹性下限 400px）
    const finalHeight = Math.max(400, Math.floor(availableHeight));
    dualRow.style.height = finalHeight + 'px';
    dualRow.querySelectorAll('.panel-card').forEach(c => {
      c.style.height = finalHeight + 'px';
    });
  }

  let _resizeDebounce = null;
  window.addEventListener('resize', () => {
    clearTimeout(_resizeDebounce);
    _resizeDebounce = setTimeout(adjustDualPanelsHeight, 80);
  });

  // ============================================================
  // 8. 统一初始化执行
  // ============================================================
  function initAllMissionHub() {
    applyPermissionAdaptation();
    renderMyBizStrip();       // Instant render from localStorage cache
    initMyBizPrefsFromServer(); // Async server pull → re-render with authoritative data
    bindAllWorkbenchAndRouteLinks();

    reloadAllTasks();
    fetchMonthlySettlementStatus();
    fetchComplianceExpiryStatus();
    adjustDualPanelsHeight();
  }

  const refreshAllBtn = ROOT.querySelector('#btn-refresh-all-data');
  if (refreshAllBtn) {
    refreshAllBtn.addEventListener('click', () => {
      initAllMissionHub();
      frappe.show_alert({ message: '总控中枢全盘数据已刷新', indicator: 'green' }, 3);
    });
  }

  const customizeBizBtn = ROOT.querySelector('#btn-customize-my-biz');
  if (customizeBizBtn) {
    customizeBizBtn.addEventListener('click', () => {
      openMyBizCustomizeDialog();
    });
  }

  initAllMissionHub();

})();
