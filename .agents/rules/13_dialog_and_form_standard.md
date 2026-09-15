# 弹窗、表单和快速录入强制规范

## 是否使用 Dialog
简单 Yes/No 用 `frappe.confirm`。

少量字段快速创建、参数输入、小型审核、证据确认、批量动作配置用 `frappe.ui.Dialog`。

以下情况回到标准 Form：
- 字段很多
- 有附件
- 有评论或 Timeline
- 有 Workflow
- 需要长期编辑
- 本身是重要业务单据
- 需要完整 Save/Submit/Cancel 生命周期

不要把完整 Purchase Order、Purchase Invoice、Vehicle 等主数据维护长期复制进大弹窗。

## Dialog 结构
1. 标题
2. 必要业务上下文
3. 输入字段
4. 必要验证或证据
5. 一个 Primary
6. Cancel/Close

一个 Dialog 只能有一个高强调 Primary。

## 字段
优先 Frappe Field Type：
Data、Link、Select、Autocomplete、Date、Currency、Float、Int、Check、Small Text、Table。

不要先手写 `<input>` 再模拟 Frappe 字段。

## 2 到 4 个选项
只有互斥、标签短、一屏放得下、高频切换、非危险并且键盘可访问时，才使用 segmented control。

否则使用 Radio、Select 或标准字段。

选项数量不是唯一判断条件。

## 快速创建
快速创建只适合当前工作缺少少量主数据，而且新建后马上回到当前任务。

必须：
- 服务端权限
- company scope
- 重复检查
- 正常 DocType lifecycle
- 返回新记录 identity
- 可恢复错误不丢用户输入

不要因为追求零跳转，把完整主数据维护复制到每个 Workbench。

## 异步提交
点击 Primary 后立即 disabled。成功后关闭或进入成功状态。失败不关闭，并恢复按钮、显示原因。

## 验证职责
前端只做必填、格式、即时提示。
后端负责权限、公司、状态、重复、金额数量规则、期间锁定、关联单据和最终计算。

## 弹窗尺寸
默认用 Frappe Dialog 正常尺寸。
只有大表选择、凭证比较、多列证据核验才使用宽 Dialog。

可采用 `width: min(94vw, 1400px)` 一类弹性上限，但不是所有弹窗固定值。

## CSS
禁止新增裸 `.modal-dialog`、`.modal-content`、`.modal-body`。
必须限定到功能/Page root。
禁止 inline `style=`。

## Nested Dialog
禁止一个业务 Dialog 再弹出另一个同级业务 Dialog。
复杂选择用 Link/Autocomplete、内嵌选择区或专门页面。

## 清理
自定义 Dialog 若绑定 document/window event、timer、observer，关闭时必须清理。

## 油卡历史代码
新增油卡 Dialog 不复制旧页面 inline style、本地金额 formatter 和重复 role helper。
