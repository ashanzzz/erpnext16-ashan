# 当前可复用代码目录与公共轮子治理规范 (Search Before Create & Wheel Governance)

> **最高铁律**：在新建、修改任何 UI、组件、弹窗、表格或 API 之前，**必须先阅读本目录**。
> **严禁孤岛自建**：全系统严格禁止在单页面内部私自造轮子、手拼原生 HTML 标签或私写孤立样式。

---

## 零、AI 轮子治理与四步决策契约 (The Wheel Decision Protocol)

为了杜绝不同页面重复发明轮子、代码风格分裂、低质代码跑偏，所有 AI 参与者必须严格遵循以下四步闭环协议：

```
                      ┌────────────────────────────────────────┐
                      │ 步骤一：查轮子 (Search Wheel Catalog)  │
                      │ 检索当前文件清单与 ashan_ui_kit.js     │
                      └──────────────────┬─────────────────────┘
                                         │
                                         ▼
                      ┌────────────────────────────────────────┐
                      │ 步骤二：评适配 (Evaluate Fit)          │
                      │ 当前轮子是否覆盖了 >90% 的交互需求？   │
                      └──────────┬───────────────────┬─────────┘
                                 │ 是                │ 否
                                 ▼                   ▼
                      ┌──────────────────────┐ ┌───────────────────────────────────────┐
                      │ 直接复用 (Direct Use)│ │ 步骤三：合规造轮子与注册 (Register)   │
                      │ 调用 AshanUI.* 方法  │ │ 1. 提炼通用能力写入 ashan_ui_kit.js   │
                      │ 与全局 CSS 类名      │ │ 2. 样式写入 ashan_ui_kit.css          │
                      └──────────────────────┘ │ 3. 在本目录登记 API 与入参出参用例     │
                                               └──────────────────┬────────────────────┘
                                                                  │
                                                                  ▼
                                               ┌───────────────────────────────────────┐
                                               │ 步骤四：业务层引用 (Reference Only)   │
                                               │ 页面仅配置 Schema 消费公共轮子        │
                                               └───────────────────────────────────────┘
```

1. **查轮子 (Search First)**：AI 接收到任何 UI 或功能变更需求时，严禁直接手写 HTML。必须首先检查 `ashan_ui_kit.js` 是否已包含对应的渲染器或处理函数；
2. **评适配 (Evaluate Fit)**：绝大多数场景（普通单据列表、报销选单、出库台账、明细弹窗）已被本目录组件 100% 覆盖，直接传入 Schema 即可工作；
3. **造轮子与平台注册 (Register Wheel)**：若遇到真正颠覆性、现有组件无法承载的全新业务形态（例如五档现金配钞矩阵、时序工时打卡图），**严禁直接在某个业务页面的 JS/CSS 内部私写死逻辑**！必须将核心逻辑抽象封装到 `ashan_ui_kit.js` / `ashan_ui_kit.css`，并在本文件完成登记与用例补充；
4. **仅引用 (Reference Only)**：业务页面（如 `reimbursement_picker.js`、`stock_issue_workbench.js`）只扮演 Schema 配置文件和数据装配者角色，零私有样式，零孤岛标签。

---

## 一、Schema 驱动通用表格渲染器（AshanUI.renderTable）

* **文件归属**：`ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js`
* **解决痛点**：彻底根除手拼 `<table>` 字符串、合计行 `colspan` 算错左移、发票子表税率与金额列序倒挂、空状态缺角、行高被固定写死等所有历史结构性缺陷。
* **核心输入**：单一纯配置对象 `options`，自动推导全套 DOM 结构（`<colgroup>`、`<thead>`、`<tbody>`、`<tfoot>` 与空状态跨列）。

### 1. 单据大宽表前五列“下意识标准序”铁律 (Rule 18)
任何单据大宽表默认必须遵循以下前五列次序，禁止 AI 凭空打乱：
* **Col 1**：`#` / 复选框（序号与批量操作）
* **Col 2**：`所属公司`（紧凑 88px）
* **Col 3**：`单据编号` / `报销单号`（紧凑 105px）
* **Col 4**：`单据状态`（状态胶囊，92px）
* **Col 5**：`单据日期`（日期，104px）
* **Col 6+**：`单据标题`（带单行省略与 Tooltip，自适应弹性）、发票信息、供应商、物料明细、金额度量、操作列。

### 2. 配置项参数规格 (Options Schema)

| 参数名 | 类型 | 必填 | 默认值 | 描述 |
| :--- | :---: | :---: | :---: | :--- |
| `container` | `string \| HTMLElement` | 是 | - | 表格挂载容器选择器或 DOM 节点（如 `"#my-table-wrap"`） |
| `prefixCols` | `number` | 否 | `0` | 前置标准列模式：`0` (无), `1` (仅序号), `2` (序号+复选框), `3` (序号+复选框+公司徽标) |
| `isAllCompany`| `boolean` | 否 | `false`| 当 `prefixCols=3` 且处于单公司模式时，自动降级隐藏公司列 |
| `columns` | `Array<ColumnSchema>` | 是 | `[]` | 业务列定义数组（见下表） |
| `data` | `Array<Object>` | 是 | `[]` | 表格行数据数组 |
| `emptyText` | `string` | 否 | `"暂无数据"` | 空状态文案 |
| `getRowKey` | `Function(row): string`| 否 | `row.name` | 获取行唯一键（用于复选框绑定） |
| `selectedMap`| `Map \| Set` | 否 | `null` | 选中项集合，用于回显复选框 `checked` 状态 |
| `getRowClass`| `Function(row, idx): string` | 否 | `""` | 动态行类名计算钩子 |
| `footerCells`| `Array<FooterCellSchema>` | 否 | `[]` | 底部合计行单元格定义 |

#### ColumnSchema 列定义规格：
* `label` (`string`): 表头显示文本（**强制优先使用 `AshanUI.Dictionary.getLabel()` 获取**）
* `key` (`string`): 绑定的字段名（如 `"company"`, `"name"`, `"posting_date"`）
* `width` (`string`): 列宽类名或样式（如 `"col-w-docname"`, `"col-w-company"`, `"105px"`）
* `align` (`string`): 对齐方式：`"left"` (默认), `"center"`, `"right"`
* `type` (`string`): 语义类型：`"text"`, `"money"`, `"qty"`, `"badge"`, `"date"`（为 `"money"` 时自动靠右并格式化）
* `ellipsis` (`boolean`): 是否开启单行截断与全量 `title` Tooltip（**Rule 21 铁律必须开启**）
* `render(row, value, idx)` (`Function`): 自定义单元格 HTML 渲染钩子

### 3. 标准调用范例 (Canonical Example)

```javascript
// 渲染报销申请大宽表
const result = AshanUI.renderTable({
    container: "#reim-main-table-wrap",
    prefixCols: 2, // 自动生成 #序号列 与 复选框列
    columns: [
        {
            label: AshanUI.Dictionary.getLabel("company"),
            key: "company",
            width: "col-w-company", // 88px
            render: (row) => `<span class="picker-company-badge">${frappe.utils.escape_html(row.company_short)}</span>`
        },
        {
            label: AshanUI.Dictionary.getLabel("docname"),
            key: "name",
            width: "col-w-docname", // 105px
            render: (row) => `<a class="picker-doc-link font-mono" data-name="${row.name}">${row.name}</a>`
        },
        {
            label: AshanUI.Dictionary.getLabel("status"),
            key: "docstatus",
            width: "col-w-status", // 92px
            render: (row) => AshanUI.formatDocStatus(row.docstatus)
        },
        {
            label: AshanUI.Dictionary.getLabel("date"),
            key: "posting_date",
            width: "col-w-date" // 104px
        },
        {
            label: AshanUI.Dictionary.getLabel("title"),
            key: "title",
            width: "col-w-title", // 弹性自适应
            ellipsis: true // 自动注入 .ashan-cell-ellipsis 和 title Tooltip
        },
        {
            label: AshanUI.Dictionary.getLabel("amount"),
            key: "total_amount",
            width: "col-w-money",
            type: "money" // 自动等宽靠右排版 + formatMoney
        }
    ],
    data: dataList,
    emptyText: "当前筛选条件下暂无单据",
    footerCells: [
        { text: `合计 (共 ${dataList.length} 笔)`, colspan: 3, align: "left" },
        { text: AshanUI.formatMoney(sumAmount), colspan: 3, align: "right", type: "money" }
    ]
});
```

---

## 二、标准字段中英文与别名权威字典（AshanUI.Dictionary）

* **文件归属**：`ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js`
* **解决痛点**：消除“经手人 / 录单人 / 申请人 / 单据人员 / creator”各自为政的命名混乱；全系统物料字段严格收敛为【物料名称】（`item_name`），严禁 AI 凭空自创字段名（**Rule 19 & Rule 20**）。

### 1. 核心对照与收敛矩阵 (Canonical Fields & Aliases)

| 标准 Key | 官方权威中文标签 (`label`) | 简写标签 (`shortLabel`) | 官方 ERPNext 字段名 (`en`) | 已收敛同义别名 (输入任意别名自动归一化) |
| :--- | :--- | :--- | :--- | :--- |
| `creator` | **制单人** | 制单人 | `owner` | 经手人、录单人、创建人、单据人员、申请人、制单人、owner、applicant、user |
| `item_name` | **物料名称** | 物料 | `item_name` | 物料/费用项目、费用项目、物料、费用名称、物料名称、item_name |
| `docname` | **单据编号** / **报销单号** | 单号 | `name` (或 `rr_name`) | 单号、单据编号、报销单号、申请单号、报销申请单号、docname、name |
| `company` | **所属公司** | 公司 | `company` | 公司、所属公司、company |
| `status` | **单据状态** | 状态 | `docstatus` | 状态、单据状态、docstatus、status |
| `date` | **单据日期** | 日期 | `posting_date` | 日期、单据日期、开票日期、posting_date |
| `title` | **报销标题** / **单据标题** | 标题 | `title` | 标题、单据标题、报销标题、title |
| `amount` | **报销金额** / **单据金额** | 金额 | `total_amount` | 金额、报销金额、报销总额、总额、总金额、total_amount |
| `outstanding` | **待付金额** | 待付 | `outstanding_amount` | 待付、待付金额、待结款、outstanding_amount |
| `supplier` | **供应商** | 供应商 | `supplier` | 供应商、往来主体、商户、supplier |
| `invoice_no` | **发票号码** | 发票号 | `invoice_no` | 发票号码、发票号、发票编号、invoice_no |
| `spec` | **规格型号** | 规格 | `spec` | 规格、规格型号、spec |
| `qty` | **数量** | 数量 | `qty` | 数量、qty |
| `rate` | **单价** | 单价 | `rate` | 单价、单价值、rate |
| `line_total` | **价税合计** | 合计 | `line_total` | 价税合计、总价、价税总计、line_total |

### 2. API 方法

```javascript
// 1. 获取规范中文标签
AshanUI.Dictionary.getLabel("经手人"); // 返回: "制单人"
AshanUI.Dictionary.getLabel("费用项目"); // 返回: "物料名称"
AshanUI.Dictionary.getLabel("docname", true); // 返回简写: "单号"

// 2. 获取规范英文数据库字段名
AshanUI.Dictionary.getFieldName("制单人"); // 返回: "owner"
AshanUI.Dictionary.getFieldName("物料名称"); // 返回: "item_name"
AshanUI.Dictionary.getFieldName("单据日期"); // 返回: "posting_date"
```

---

## 三、统一标准防误触业务弹窗工厂（AshanUI.createDialog）

* **文件归属**：`ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js`
* **解决痛点**：杜绝点击背景意外关闭弹窗导致数据丢失、杜绝弹窗样式丢失、杜绝右上角关闭按钮失去格式。
* **特性保障**：
  1. 默认强制注入 `static: true`, `data-backdrop="static"`, `data-keyboard="false"`（防误触关闭）；
  2. 自动挂载 `ashan-dialog-abgs` 全局现代磨砂视效类；
  3. 自动在 `.modal-header` 注入官方标准关闭按钮 **`.ashan-modal-close-btn`**（28×28px 实心白底、浅灰框、悬浮微红），且自动替换 Frappe 原生无边框关闭按钮。

### 1. 弹窗 3 行高密度核心要素卡片规范
弹窗顶部核心要素统一采用三行卡片布局（`.ashan-po-context-card`），禁止自行拼凑稀疏表单：
* **Row 1 (三等分)**：单据单号 ｜ 单据状态 ｜ 单据日期
* **Row 2 (三等分)**：所属公司 ｜ 报销总额 / 待付 ｜ **制单人**
* **Row 3 (满宽 100%)**：**报销标题**（独占一整行，防止长标题截断折行）

### 2. 双安全退出通道与底部操作栏规范
* 弹窗右上角必须常驻醒目的 `✕` 关闭按钮；
* 底部操作栏左侧放置破坏性动作（如【删除草稿】），右侧必须显式配置【关闭】或【取消】次级按钮，保障双出口。

### 3. 标准调用范例

```javascript
const d = AshanUI.createDialog({
    title: __("报销申请明细 · {0}", [data.rr_name]),
    size: "extra-large",
    fields: [{
        fieldtype: "HTML",
        fieldname: "detail_html",
        options: `
            <div class="reim-v2-modal-container">
                <div class="ashan-po-context-card">
                    <div class="ashan-po-form-grid">
                        <!-- 第一行 -->
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">报销申请单号</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly font-mono" value="${data.name}" readonly tabindex="-1" />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">单据状态</label>
                            <div class="ashan-status-display is-submitted">已提交</div>
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">单据日期</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly" value="${data.posting_date}" readonly tabindex="-1" />
                        </div>
                        <!-- 第二行 -->
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">所属公司</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly" value="${data.company}" readonly tabindex="-1" />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">报销金额</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly font-bold" value="${AshanUI.formatMoney(data.total_amount)}" readonly tabindex="-1" />
                        </div>
                        <div class="ashan-po-form-group">
                            <label class="ashan-po-label">制单人</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly" value="${data.owner}" readonly tabindex="-1" />
                        </div>
                        <!-- 第三行：独占满宽 -->
                        <div class="ashan-po-form-group col-span-full">
                            <label class="ashan-po-label">报销标题</label>
                            <input type="text" class="ashan-po-input ashan-po-input-readonly font-bold" value="${frappe.utils.escape_html(data.title)}" readonly tabindex="-1" />
                        </div>
                    </div>
                </div>
            </div>
        `
    }]
});

// 底部标准双出口
d.footer.empty().append(`
    <button type="button" class="ashan-btn ashan-btn-secondary" id="btn-dlg-close">关闭</button>
    <button type="button" class="ashan-btn ashan-btn-primary" id="btn-dlg-submit">提交审核</button>
`);
d.footer.find("#btn-dlg-close").on("click", () => d.hide());
d.show();
```

---

## 四、全局尺度调度与列宽引擎（AshanUI.TableLayoutEngine & TableColumns）

* **文件归属**：`ashan_cn_procurement/ashan_cn_procurement/public/js/ashan_ui_kit.js`
* **功能**：提供用户全局/单表列宽拖拽、列设置弹窗、以及排版尺度（行高、字体）调度。

### 核心约束与安全底线：
1. **最低行高防踩踏保护**：表格内容行最低安全行高限制为 **28px**，严禁因过小行高导致文字重叠；
2. **后端全量源数据纯净性与前端自适应展开 (Rule 21)**：
   * 后端服务（Python/SQL）**绝对禁止对业务文本做人为截断**（严禁 `[:8]`、`f"…{x[-8:]}"`）；
   * 前端通过 `.ashan-cell-ellipsis` 控制溢出：**用户拉大列宽，单元格按像素呈现更多真实内容**；单元格必须常驻完整 `title` Tooltip。

---

## 五、通用基础方法清单

| 方法 | 用途 | 约束要求 |
| :--- | :--- | :--- |
| `AshanUI.formatMoney(val)` | 金额格式化（`¥ #,##0.00`） | **全系统唯一来源**，禁止在本地写正则或手写 `toFixed(2)` |
| `AshanUI.formatDocStatus(val, label)` | 状态胶囊生成 | 统一渲染草稿（灰/黄）、已提交（绿）、已取消（红） |
| `AshanUI.renderPeriodSelector(el, opts)` | 账期选择器 | 统一的月度切换控制器 |
| `AshanUI.renderEntityTabs(el, items, onSelect)`| 公司/实体 Tab 切换 | 统一的实体切换 Tab |
| `AshanUI.enableMousewheelHorizontalScroll(el)` | 表头滚轮横向滚动 | 表头滑轮上下平滑映射为左右滚动 |
| `AshanUI.bindGlobalHotkeys(bindings)` | 页面全局快捷键 | 单控制器绑定 Esc/Enter |
| `AshanUI.getSegmentedValue(el)` / `setSegmentedValue` | 分段控件读写 | 配合 `.ashan-segmented-control` 使用 |
| `AshanWorkContext.getCompany()` / `setCompany` | 工作上下文多公司 | **禁止新建第二套公司 localStorage** |

---


---

## 六、官方标准搜索单元与输入框渲染器 (Canonical Search Input - Rule 23)

### 1. 核心设计与视觉统一标准
- **定位**：全系统所有工作台、单流程选单器（Picker）以及薪酬工作台，其搜索输入框必须且只能采用官方标准组件 `.ashan-search-input`；
- **视觉规格**：
  - 内嵌 14px 矢量 SVG 放大镜图标（纯 Data URI，免外部网络资源，距左侧 8px 居中定位）；
  - 左侧 `28px` 安全内边距（文字绝不遮挡放大镜图标）；
  - 32px 标准控制高度，基准宽度 `210px`（焦点态平滑展开至 `240px`，`transition: all 0.18s ease`）；
  - 焦点态统一呈现 Ashan 品牌蓝微光晕（`border: 1px solid #2563eb; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.12)`）；
  - 严禁任何子页面私自覆盖为裸露无图标 input 或使用突兀的橙红色焦点。
- **文案规范（零“搜索 搜索”复读）**：
  - 前置标签为【`搜索`】（`.ashan-filter-label`）；
  - 内部 Placeholder 统一使用【`工号、姓名、证件、岗位...`】（严禁在 Placeholder 中重复包含“搜索”二字）。

### 2. 标准调用与使用范例
```javascript
// 方式一：JavaScript 动态渲染调用
const searchHtml = AshanUI.renderSearchInput({
    id: "qifu-emp-search",
    placeholder: "工号、姓名、证件、岗位..."
});

// 方式二：HTML 模板直接挂载标准类名
<div class="ashan-search-unit">
    <label class="ashan-filter-label" for="jz-emp-search">搜索</label>
    <input type="text" class="form-control input-sm ashan-search-input jz-search-input" id="jz-emp-search" placeholder="工号、姓名、证件、岗位...">
</div>
```

---

## 七、后端服务与权限层复用目录

| 文件路径 | 职责与覆盖范围 |
| :--- | :--- |
| `services/authorization_service.py` | 统一权限守卫：`assert_company_access`、`assert_module_access`、`assert_payroll_access` |
| `services/reimbursement_picker_service.py` | 报销申请单据拉取、明细穿透、批量删除、入库单生成 |
| `services/procurement_picker_service.py` | 采购协同公共数据、供应商下拉、公司过滤 |
| `ashan_cn_procurement/payroll_engine.py` | 薪酬核心计算、7级个税 1:1 VBA 闭式反推 |
| `services/jizhong_payroll_service.py` | 吉众薪酬专属服务、打卡矩阵、倒休工时、五档现金配钞 |
| `services/qifu_payroll_service.py` | 祺富车间实发表解析、68列大宽表汇算 |

---

## 八、同步与开发加速工具（免容器重启）

| 脚本路径 | 用途 | 适用时机 |
| :--- | :--- | :--- |
| `python scripts/fast_sync.py` | **内存热同步直推 (< 1.5s)** | 日常所有 JS、CSS、Python 代码改动，免重启容器，F5 即刻生效 |
| `python scripts/sync_and_migrate.py` | 完整同步 + bench migrate | 仅限 DocType JSON 字段增减或数据库结构升级时使用 |
| `python scripts/verify_ai_architecture_governance.py` | 架构合规门禁扫描 | 提交代码前必跑，确保零架构违规 |
| `python scripts/verify_ui_style_governance.py` | UI 样式基线检查 | 提交代码前必跑，确保无新增 inline styles |
| `python scripts/run_ai_guards.py` | 全套守卫检查 | Git push pre-push 钩子执行门禁 |
