# 表格与台账标准规范 V3
# 最高原则：cols 数组是唯一真理源，严禁手写 HTML 拼接表格

---

## 一、表格范式选择

| 场景 | 推荐方案 | 禁止方案 |
|------|---------|---------|
| 单 DocType 浏览 | Frappe List View | 自定义表格 |
| 稳定数据分析/导出 | Script Report / Query Report | 自定义表格 |
| 跨 DocType 对账、候选、批量、大宽表 | 自定义 Schema 驱动表格 | — |

---

## 二、Schema 驱动表格——唯一合法写法

### 2.1 cols 数组定义规范

每张自定义表格必须有且仅有一个 `cols` 数组，包含该表格所有列的完整元数据：

```javascript
const cols = [
    //  k        → 数据字段名（与服务端返回字段名完全一致）
    //  l        → 列标题（展示用，必须非空，禁止"未命名列"）
    //  cls      → 列宽类（必须来自 col-w-* 体系）
    //  type     → 渲染类型（见下方标准类型表）
    //  total    → true = 合计行自动累加此列
    //  ellipsis → true = 超长文本单行省略（必须配合 col-w-supplier/spec/details 使用）
    //  buttons  → type==="actions" 时的按钮配置
    //  render   → type==="custom" 时的自定义渲染函数 (row) => string
    { k: "docname",      l: "单号",   cls: "col-w-docname",  type: "link"   },
    { k: "status",       l: "状态",   cls: "col-w-status",   type: "badge"  },
    { k: "posting_date", l: "日期",   cls: "col-w-date",     type: "date"   },
    { k: "amount",       l: "金额",   cls: "col-w-amount",   type: "money",  total: true },
    { k: "_actions",     l: "操作",   cls: "col-w-action",   type: "actions",
      buttons: [{ label: "查看", onClick: r => openDoc(r) }]
    },
];
```

### 2.2 表格结构必须全部由 cols 驱动

- **`<thead>`**：遍历 cols 生成 `<th>`
- **`<tbody>`**：遍历 rows，每行遍历 cols 生成 `<td>`，调用统一的 `renderCell(col, row)`
- **`<tfoot>` 合计行**：遍历 cols，`total: true` 的列做 `sum`，其余列留空
- **空状态**：`<td colspan="${cols.length}">`（自动计算，禁止手算）
- **`<colgroup>`**：由渲染器自动生成，锁定列宽

**这 5 个位置全部从同一个 cols 数组派生，任何人增减一列只需修改 cols 数组，
其余 4 处自动同步，物理上不可能出现列错位。**

### 2.3 标准渲染类型（type）

| type | 对齐 | 渲染结果 |
|------|------|---------|
| `text`（默认） | 左 | `frappe.utils.escape_html(val)` |
| `link` | 左 | 可点击链接 span，自动绑定行点击穿透 |
| `badge` | 中 | `AshanUI.formatDocStatus(val, row.status_label)` |
| `date` | 中 | `val \|\| "-"` |
| `money` | 右 | `AshanUI.formatMoney(val)`，加 `.ashan-money-cell` |
| `percent` | 中 | `${flt(val)}%` — 注意：不是金额，不加 ¥ |
| `qty` | 右 | `flt(val).toFixed(2)` + tabular-nums |
| `actions` | 中 | 读 `buttons` 配置生成按钮组 |
| `custom` | 由 cls 决定 | 调用 `c.render(row)` |

**严禁在 cols 外部的模板字符串里手写渲染逻辑。**

---

## 三、对齐规则

| 内容类型 | 水平对齐 | CSS 类 |
|---------|---------|-------|
| 名称、描述、备注、单号、供应商 | 左 | 默认 |
| 状态 Badge、单位、税率、日期 | 居中 | `ashan-cell-center` |
| 金额、数量、单价、比例、余额 | 右 | `ashan-money-cell` / `ashan-cell-right` |

**所有数值使用 `font-variant-numeric: tabular-nums`（已在 col-w-* 类中内置）。**

---

## 四、合计行（tfoot）规范

```javascript
function buildFootHtml(cols, rows, prefixColCount) {
    // prefix 列（序号、勾选、公司）合并为 1 个"合计"td
    const prefixTd = `<td colspan="${prefixColCount}" class="col-sticky-foot">
        合计 (共 ${rows.length} 笔)
    </td>`;
    // 业务列
    const dataTds = cols.map(c => {
        if (!c.total) return `<td class="${c.cls}"></td>`;
        const sum = rows.reduce((acc, r) => acc + flt(r[c.k] || 0), 0);
        return `<td class="${c.cls} ashan-money-cell"><strong>${AshanUI.formatMoney(sum)}</strong></td>`;
    }).join("");
    return `<tr>${prefixTd}${dataTds}</tr>`;
}
```

**合计行中合并的前缀列数量（prefixColCount）必须等于实际的序号/复选/公司列数，
由参数传入，禁止手算 colspan 硬编码。**

---

## 五、冻结列规范

### 5.1 何时使用冻结列

只有表格横向滚动后需要识别行身份时才冻结。通常是：序号 + 复选框 + 关键标识（单号或公司名）。

不要为"高级感"让所有表格默认冻结三列。

### 5.2 冻结偏移计算（精确，不得拍脑袋）

| 冻结列位置 | left 偏移 | 宽度 | CSS 类 |
|-----------|---------|------|-------|
| 第 1 列（序号） | `0` | `40px` 绝对锁死 | `.col-sticky-1` |
| 第 2 列（复选） | `40px` | `38px` 绝对锁死 | `.col-sticky-2` |
| 第 3 列（公司/标识） | `78px` | `140px` 建议锁死 | `.col-sticky-3` |

**每个冻结列的 left 值 = 所有前面冻结列宽度之和。
若冻结列配置不同（如没有"公司"列），必须重新计算每列的 left 值。**

---

## 六、列宽类（col-w-*）完整规范

所有自定义表格必须使用以下 UI Kit 原子类，禁止自造同义类：

```css
/* 已在 ashan_ui_kit.css 定义，直接使用 */
.col-w-seq        { width: 40px;  min-width: 40px;  max-width: 40px; text-align: center; }
.col-w-check      { width: 38px;  min-width: 38px;  max-width: 38px; text-align: center; }
.col-w-status     { width: 92px;  min-width: 88px;  max-width: 96px; text-align: center; }
.col-w-docname    { width: 140px; min-width: 120px; text-align: left; }
.col-w-inv-type   { width: 92px;  min-width: 88px;  text-align: center; }
.col-w-invoice-no { width: 170px; min-width: 150px; text-align: left; }
.col-w-date       { width: 110px; min-width: 104px; text-align: center; white-space: nowrap; }
.col-w-company    { width: 150px; min-width: 130px; text-align: left; }
.col-w-supplier   { width: 200px; min-width: 160px; text-align: left; overflow: hidden; text-overflow: ellipsis; }
.col-w-item-name  { min-width: 180px; flex: 1; text-align: left; }
.col-w-spec       { min-width: 160px; flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; }
.col-w-uom        { width: 72px;  min-width: 64px;  text-align: center; }
.col-w-qty        { width: 96px;  min-width: 88px;  text-align: right; font-variant-numeric: tabular-nums; }
.col-w-rate       { width: 110px; min-width: 100px; text-align: right; font-variant-numeric: tabular-nums; }
.col-w-tax-rate   { width: 80px;  min-width: 72px;  text-align: center; font-variant-numeric: tabular-nums; }
.col-w-tax-amount { width: 110px; min-width: 100px; text-align: right; font-variant-numeric: tabular-nums; }
.col-w-amount     { width: 120px; min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
.col-w-total      { width: 130px; min-width: 120px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; }
.col-w-outstanding{ width: 120px; min-width: 110px; text-align: right; font-variant-numeric: tabular-nums; }
.col-w-linked-doc { width: 150px; min-width: 130px; text-align: left; }
.col-w-details    { min-width: 220px; flex: 1.5; text-align: left; overflow: hidden; text-overflow: ellipsis; }
.col-w-action     { width: 84px;  min-width: 76px;  max-width: 96px;  text-align: center; white-space: nowrap; }
.col-w-action-double { width: 140px; min-width: 130px; max-width: 144px; text-align: center; white-space: nowrap; }
```

---

## 七、操作列规范

### 7.1 文案标准

全系统统一三个动词：**【查看】【修改】【删除】**
严禁使用：编辑 / 详情 / 打开 / 移除 / 调整

### 7.2 生命周期状态收敛

| 单据状态 | 允许操作 |
|---------|---------|
| 草稿 / 未核定 / 活跃期 | 【修改】+ 【删除】（删除需 confirm） |
| 已核定 / 已提交 / 已封账 | 仅【查看】，严禁出现置灰的修改/删除 |

### 7.3 双按钮操作列（col-w-action-double）

用于同时需要【主业务动作（如付款）】和【删除】的场景：

```javascript
{ k: "_actions", l: "操作", cls: "col-w-action-double", type: "actions",
  buttons: [
      { label: "付款", show: r => flt(r.outstanding_amount) > 0, onClick: r => openPay(r) },
      { label: "删除", show: r => r.can_delete, onClick: r => confirmDelete(r), danger: true },
  ]
}
```

---

## 八、特殊大宽表（祺富 68 列）已验证的正确模式

祺富 68 列大宽表（`render_tax_full_68_table`）已经在用 cols 数组统一驱动，
这是本系统中已有的最复杂场景，验证结果：**从未出现列错位或 colspan 计算错误**。

其模式就是本文档的最佳实践来源。报销申请等页面须向此看齐。

复合双行表头（`<tr class="group-row">` + `<tr>` 明细行）是允许的，
但两行必须都由 cols 和 groups 配置推导，不手写。

---

## 九、空状态规范

```javascript
// 空状态的 colspan 必须自动计算，禁止手写数字
const totalCols = prefixColCount + cols.length;
body = `<tr>
    <td colspan="${totalCols}" class="ashan-table-empty-cell">
        当前 ${companyName} 在 ${periodMonth} 暂无数据
    </td>
</tr>`;
```

**空状态文案必须有业务上下文（公司、账期、筛选条件），禁止只写"暂无数据"。**

---

## 十、数据加载与分页

- 持续增长的数据（跨年采购历史、多月工资、发票流水）必须服务端筛选 + 分页
- 禁止把几年数据全部加载到浏览器再前端 filter
- 服务端每次返回有界数量（如最近 3 个月、当前账期、limit=200）
- 每个读请求必须有 loading / empty / error 三种状态处理


---

## 十一、紧凑列宽、单据标题完整性与文本防踩踏契约 (2026-10-28 核心标准)

### 1. 短列紧凑原则 (Compact Short Columns)
- 2~4 个字的短列（如企业简称'祺富/吉众'的所属公司列、状态列、单位列）：
  - 宽度必须严格限制在 **80~92px**（如 `.col-sticky-3` 88px），严禁设置 140px 以上的虚宽！
  - 目的：杜绝短文字占用巨大空白，把宝贵的水平视口最大程度留给业务长文本。
- 核心单号列（`.col-w-docname`）：标准约束为 **110~125px**，禁止随意膨胀至 150px+。

### 2. 单据汇总视图核心三要素完整性 (Doc Summary Completeness)
- 报销申请、采购合同、付款申请等单据汇总大宽表，必须显式呈现**核心业务标识三要素**：
  1. **单据编号** (`docname` / `rr_name`)
  2. **单据标题** (`title`，反映业务用途，如"自办电汇结算_上海唐仕...")
  3. **单据状态** (`status` / `docstatus`)
- **严禁遗漏【单据标题】！**

### 3. 长文本截断与单行防踩踏契约 (Text Ellipsis & Zero-Collision Law)
- 任何包含业务自由文本的列（单据标题、物料规格型号、供应商全称、单据明细摘要）：
  - 其单元格 `<td>` 必须挂载 `.ashan-cell-ellipsis`；
  - CSS 必须锁死 `overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important; max-width: 0 !important;`；
  - 内部子元素必须包含 Tooltip 提示全称；
  - **严禁文字物理横向溢出踩踏相邻列的数字或操作按钮！**


---

## 十二、单据大宽表前五列下意识标准序最高铁律 (Canonical 5-Column Reflex Standard - 2026-10-28 用户最高指示)

> **⚠️ 核心下意识神经反射**：
> 全系统所有单据型大宽表、选单中心与工作台（报销申请、采购执行、收货入库、付款申请、合同等），无论任何业务，**前五列必须形成绝对固化的下意识标准排序，严禁任何 AI 打乱此前五列铁序**：
>
> 1. **第一列**：【序号 / 选择】（`#` / 复选框，`.col-w-seq` / `.col-w-check`）
> 2. **第二列**：【所属公司】（`所属公司`，`.col-sticky-3` / `.col-w-company`，紧凑 88px）
> 3. **第三列**：【单据编号】（`报销单号` / `申请单号` / `采购订单号` / `单号`，`.col-w-docname`）
> 4. **第四列**：【单据状态】（`单据状态` / `状态`，`.col-w-status`）
> 5. **第五列**：【单据日期】（`单据日期` / `申请日期` / `开票日期` / `日期`，`.col-w-date`）
>
> **第六列起**方可依序排布：【单据标题】（`title`）、【发票信息】、【供应商】、【单据明细 / 物料明细】、【金额度量】、【关联单据】、【操作】。
> **除非用户在当前指令中明确要求其他定制排序，否则任何 AI 在生成或重构任何单据表格时，前五列必须下意识无条件严格执行上述顺序！**
