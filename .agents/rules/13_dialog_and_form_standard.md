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

## Ashan 工业与严肃财务人机工程对称卡片与内嵌抽屉标准 (Ashan Symmetrical Context Card & Audit Drawer Standard)

### 1. 对称法定要素卡片 (Symmetrical Context Card Grid)
单据详情、修改与新建弹窗一律采用 `.ashan-doc-context-card`（或调用 `AshanKit.buildContextCard()`）：
- **所属公司必须置于第 1 位 (Position 1 铁律)**：首行首列必须为 `所属公司 *`，强化集团多主体权责边界。
- **期望日期必填加粗红星且默认下月当天 (Position 6 铁律)**：末项固定为 `<strong>期望日期</strong> <span class="ashan-req">*</span>`，值默认自适应取下个月当天（`AshanKit.getNextMonthSameDay()`）。
- **严格 2行 $\times$ 3列对称网格**：
  - Row 1: `所属公司 *`、`单据编号`、`单据状态`
  - Row 2: `业务单位 *`、`单据日期`、`期望日期 *`
- **严禁私自脑补冗余项**：彻底禁止添加经办人、采购员、付款方式、整单备注、送货单号、申请部门、用途等冗余项。
- **控件高度死守**：卡片内部输入框/下拉框高度统一为 30px（`calc(var(--ashan-modal-row-height, 38px) - 4px)`），字号 13px，圆角 5px。

### 2. 单据生命周期审计胶囊与内嵌侧抽屉 (Audit Capsule & Inner Drawer)
- **弹窗右上角标配审计胶囊**：`.ashan-meta-audit-capsule`（或调用 `AshanKit.buildAuditCapsule()`），展示 `创建: YYYY-MM-DD (创建人) · 修改: YYYY-MM-DD (修改人) 履历 ❯`。
- **操作履历内嵌侧抽屉**：点击审计胶囊或底部 30px【操作履历】按钮平滑滑出内嵌抽屉（`.ashan-audit-drawer`，宽 360px）。
- **实色半透明遮罩**：严禁使用 `backdrop-filter: blur` 磨砂毛玻璃滤镜（杜绝 3 代 Intel 办公显卡掉帧），遮罩统一使用实色半透明 `rgba(15, 23, 42, 0.28)`。
- **底部操作按钮统一契约**：所有 Footer 按钮高度固定为 30px（行高 28px），字重 500，严禁参差不齐与装饰 Emoji。
