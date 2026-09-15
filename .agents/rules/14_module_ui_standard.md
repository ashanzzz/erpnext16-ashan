# 各业务模块 UI 和交互规范

## 采购
Material Request、Purchase Order、Purchase Receipt、Purchase Invoice、Payment Entry 等标准单据完整编辑继续使用 ERPNext Form。

采购 Workbench 负责：
- 候选池
- 批量选择
- 上下游关系
- 数量金额核对
- 生成下游单据
- 异常处理

先复用 `procurement_workbench.js/css`，不要重新实现完整标准单据编辑器。

权限使用标准 DocPerm/`frappe.has_permission()`。UI 从服务端 capability 决定动作可见性。company 服务端验证。

## 报销
`Reimbursement Request` 已有 Form JS、List JS 和服务端 service。
单据自身生命周期优先标准 Form。批量审核、汇总和跨单据关联才用 Workbench。
禁止平行创建第二套 Reimbursement 模型。

## 油卡和车辆
这是余额型台账。核心信息：
- 当前油卡
- 当前公司
- 账期
- 期初
- 充值
- 消费
- 期末
- 锁定状态
- 流水

新代码禁止本地 `formatMoney()`、inline style、装饰 Emoji、第三套账期控件、第三套按钮颜色、重复角色 helper。

权限使用 `assert_oil_ledger_access()` 和 `assert_company_access()`。

## 人事薪酬
祺富和吉众业务保持隔离。

允许共享：
- token
- formatter
- status
- table base
- Dialog base
- 上传基础组件
- authorization 基础能力

禁止强行共享：
- 考勤算法
- 工时算法
- 企业特定工资表
- 企业特定凭证规则
- 企业特定导入格式
- 企业特定阶段

Payroll API 先 `assert_payroll_access()`。company 必须限制。封账和解锁按后端 `PAYROLL_WORKFLOW_POLICY`，前端不自己决定下一状态。

## 合规、环保、特种设备
页面核心是主体/设备、当前状态、到期日期、剩余时间、缺失材料、待办、证据、历史。

已有 daily scheduler 刷新相关状态时，前端不再创建另一套权威到期算法。

## 物业和租赁
Workbench 聚焦账期、合同、费用、应付实付、凭证和结算状态。
标准 Contract/DocType 的详细编辑继续 Form。

## 税局发票和 AI 匹配
必须展示：
- 源票据
- 推荐对象
- 匹配分数/置信度
- 匹配依据
- 冲突
- 候选项
- 当前状态
- 用户决定

用户确认后，服务端重新读取目标并验证权限、company、状态、金额/数量、是否已被其他操作关联。

AI 推荐不能直接绕过 ERPNext lifecycle。

## 月结和封账
页面必须突出 company、账期、锁定状态、未完成前置条件、影响范围、操作人、时间和解锁原因。

封账/解锁按钮由服务端 capability 决定。确认弹窗说明影响对象。

## Workspace/Dashboard
Workspace 用于导航和需要关注的事项。
优先 2 到 4 个真正可行动指标、待办、异常、快捷入口。
不要固定每个模块 6 到 12 张彩色 KPI 卡。

## 统一的边界
统一的是颜色语义、按钮层级、金额数量格式、表格扫描、Dialog 行为、异步状态和权限反馈。

不要求所有模块相同 KPI 数量、冻结列、Tab、Dialog 宽度或表头层数。
