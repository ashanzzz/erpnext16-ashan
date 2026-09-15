# 按钮和业务动作强制规范

## 动作等级
Primary 是当前状态最重要的下一步。一个可见页面状态最多一个高强调 Primary。

Secondary 用于刷新、导出、打开记录、新建辅助资料、视图切换。

Danger 用于删除、取消、反审核、解锁、清空、作废等会破坏或逆转状态的动作。

颜色由动作等级和风险决定，不由模块作者喜好决定。

## Frappe 标准页面
标准 Form 保留原生 Save、Submit、Cancel，不用自定义绿色按钮替换生命周期。

Desk Page 适合标题栏主动作时使用 `page.set_primary_action()`。次级动作使用 Frappe Page secondary/inner button 能力。

同一个主动作不要同时放标题栏、内容顶部和表格上方。

## Workbench 操作区
采购现有 action bar 可以继续作为域结构。
- 左侧选择摘要
- 右侧动作
- 主动作视觉最强并靠后
- 未选对象时依赖选择的动作 disabled
- 取消/删除和提交/生成保持视觉间距

## 行内动作
每行最多一个长期可见高频操作。其他操作进入更多菜单、详情或选中后的批量动作。

禁止把编辑、删除、提交、取消、查看、打印、导出、复制全部平铺。

## 高度
页面/工具栏约 30 到 36 px。
表格内紧凑按钮约 26 到 30 px。
36 px 不是全系统铁律。采购当前 30 px 可以在该域保持。

## 色彩
新代码逐步统一为共享：
- action-primary
- neutral
- success
- warning
- danger

不要继续让每个模块定义自己的 primary 颜色。
采购现有 `.picker-btn-primary` 可兼容，但新增共享组件不再照抄绿色规则。

## 文案
使用动词加对象：
`生成采购订单`、`录入充值`、`保存草稿`、`确认核定`、`申请解锁`、`导出 Excel`。

避免只写 `确定`、`执行`、`操作`、`OK`。

## 图标
中文 ERP 默认文字优先。icon-only 只适合刷新、关闭、展开、更多等稳定通用动作，并且必须有 accessible name 和 tooltip/title。

禁止新增装饰 Emoji 按钮。

## 异步按钮
写操作点击后立即 busy/disabled，防止 double-click。服务端成功后更新，失败后恢复。

不能只靠前端 disabled 作为幂等保护。生成单据、支付、入库、封账等还必须服务端防重复。

## 权限
前端可根据服务端 capability 隐藏或禁用按钮，但服务端 mutation 必须再次授权。

不要把 `frappe.user_roles.includes(...)` 当最终安全边界。

## 危险动作
必须服务端实时检查权限和状态。需要 reason 的动作强制 reason。确认文案说明对象和影响。
薪酬封账/解锁等下一状态必须由后端 policy 决定。
