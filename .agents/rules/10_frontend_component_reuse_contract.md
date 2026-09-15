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
