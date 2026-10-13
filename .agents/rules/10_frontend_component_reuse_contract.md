# 前端组件复用和页面结构强制规范

## 页面类型先行
创建 UI 前先分类：
1. 标准记录编辑用 Form
2. 单 DocType 浏览用 List
3. 稳定分析用 Report
4. 模块入口用 Workspace
5. 跨 DocType、对账、批量、异常、复杂台账才用 Desk Page
6. Vue 只在 Desk Page 已经合理且响应式状态明显复杂时使用

不能因为“更现代”就重做 Form/List。

## 自定义 Page 固定层级
推荐顺序：
1. 页面身份
2. 公司/账期等业务上下文
3. 任务阶段或 Tab
4. 筛选
5. 选择摘要与动作
6. 核心表格/工作区
7. 必要证据或详情
8. Loading/Empty/Error

禁止每个 AI 随机重排信息架构。

## 页面 CSS
每个新 Page 必须有唯一根类 `.ashan-<feature>-page`，已有域 runtime 可沿用现有根类。

禁止新增裸全局覆盖：
`body`、`.page`、`.btn`、`.form-control`、`table`、`th`、`td`、`.modal-dialog`、`.modal-content`。

禁止新 `style=`。显示/隐藏使用 class 或 Frappe API。

## 金额
显示统一 `AshanUI.formatMoney(value)`。
金额 cell 统一 `.ashan-money-cell`。
祺富旧页可保留 `.qifu-money-cell`，新通用模块优先 `.ashan-*`。

禁止：
- 页面自己再写 `formatMoney()`
- 用浏览器 formatter 做权威会计/税务/工资舍入
- 金额左对齐
- 无币种上下文

## 状态
优先 `AshanUI.formatDocStatus()` 和共享 `.ashan-status-badge`。
普通金额、数量、姓名、公司、物料不能套 badge。
新共享状态只有多个页面确实需要时才扩展中央映射。

## 账期
优先 `AshanUI.renderPeriodSelector()`。
需要其他年份就传 `minYear/maxYear`，不要复制上月/下月/本月逻辑。

## 公司和实体
少量短选项可用 `AshanUI.renderEntityTabs()`。
公司较多时用 Select/Link/Autocomplete。
公司列表必须来自服务端权限结果，不能从全部公司加载后只靠前端隐藏。

## 保存状态
只有服务端保存成功后才 `setSaved()`。
浏览器本地变化不等于已持久化。

## 横向滚动
仅真实宽表使用 `AshanUI.enableMousewheelHorizontalScroll()`。
普通窄表不加顶部双滚动条。

## Hotkey
当前 `AshanUI.bindGlobalHotkeys()` 会重置固定 `keydown.ashanHotkeys`。把它视为当前活动 Page 的单一快捷键控制器。

禁止 Page 和 Dialog 各自调用后假设互不影响。禁止新增裸 document keydown 处理器。

## 页面生命周期
避免 `on_page_show` 重复绑定 handler。全局 event、timer、observer 必须可清理。优先在 page body 使用事件委托。

## 网络状态
每个读请求处理 loading、success、empty、error。
每个写请求进入 busy 并防重复，失败后恢复按钮，成功后重新拉取权威状态。

不能只 `console.error`。

## HTML 安全
服务端自由文本插入 HTML 前使用 `frappe.utils.escape_html()`。

## 共享组件准入
只有至少两个真实模块需要，或属于基础 token/control，才加入 `ashan_ui_kit`。否则保持域内组件。


## 全项目共用一套颜色体系与 CSS 标准 (2026-10-12 用户最高架构指令)
> **最高原则**：整个 `ashan_cn_procurement` 项目共用**唯一一套颜色体系、CSS 令牌与表格规范**（以 `public/css/ashan_ui_kit.css` 与 `public/js/ashan_ui_kit.js` 为全局 SSOT），**不区分具体表格，也不区分祺富或吉众**。此举旨在彻底保证全系统视觉与交互的绝对统一、便于全局维护；**仅在重点业务差异部分允许按模块单独配置**。

### 1. 全局统一项（严禁按表格或按公司搞多套标准）
1. **统一颜色体系**：
   * 品牌与操作主色：科技蓝 `#2563eb` / `#1d4ed8`；
   * 确认放行与最低基数：翡翠绿 `#15803d`（背景 `#f0fdf4`，边框 `#86efac`）、正常月缴青翠绿 `#0f766e`（背景 `#f0fdfa`，边框 `#5eead4`）；
   * 固定基数与预警提示：琥珀黄 `#b45309`（背景 `#fffbeb`，边框 `#fcd34d`）、正常月缴暖橙黄 `#c2410c`（背景 `#fff7ed`，边框 `#fdba74`）；
   * 动态基数（税前工资20%）：宝石蓝 `#1d4ed8`（背景 `#eff6ff`，边框 `#93c5fd`）；
   * 免参保/免缴纳与只读辅助：中性岩灰 `#64748b`（背景 `#f8fafc`，边框 `#cbd5e1`）；
   * 校验错误与红框高亮：警示红 `#ef4444` / `#b91c1c`（背景 `#fef2f2`，内嵌框 `inset 0 0 0 1.5px #ef4444`）。
2. **统一表格 CSS 与网格标准（不区分任何表格）**：
   * **字体层级**：页面主标题 `20px`（800字重）、区块标题 `16px`（700字重）、表头 `12px`（700字重，`#334155`）、表格明细 `13px`（400字重，`#1e293b`）、辅助说明 `12px`；
   * **完整行列网格线**：所有表格统一绘制行横线（`border-bottom: 1px solid #e2e8f0`）与列竖线（`border-right: 1px solid #e2e8f0`，表头 `1px solid #cbd5e1`）；
   * **非按钮零底色**：除真实 `<button>` 按钮外，普通文本、班次、作业工时、用工性质等严禁添加背景底色或胶囊包裹；
   * **通用交互能力**：所有表格自动共享表头滚轮左右横向滚动（`Mousewheel-to-Horizontal Scroll`）、表头点击智能排序（合并单元格按原子分组整组排序）、以及未确认状态下“点击整行 + 点击右侧按钮”双通道修改。

### 2. 重点差异单独配置项（仅限核心业务异构部分）
* **底层业务模型隔离，视觉基座共享**：
  * **祺富重点差异**：车间 24 列外部实发表核对、68 列全员综合结算大宽表列定义、税局申报 PDF/ZIP 原件解压比对、大额医疗救助金（21元/22元）、姓名别名容错映射；
  * **吉众重点差异**：5 行月度结构化打卡矩阵（班次/作业/加班/餐补/备注）、倒休 2 倍冲抵闭环、管理岗税后固定工资 1:1 VBA 闭式倒推、现金五档配钞点钞。
* 除上述核心业务字段、列结构与计算公式外，**严禁在各自页面 CSS 中私自发明第二套颜色或覆盖全局表格标准**。
