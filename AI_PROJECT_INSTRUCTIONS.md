# Ashan ERPNext AI Project Instructions

这是任何 AI 编码工具的统一入口。

先读 `.agents/ai-governance.json` 中的 canonical rules，再修改代码。

## 前端
- 优先 Frappe Form/List/Report/Workspace
- 自定义 Page 只用于跨单据、对账、批量、台账和复杂工作台
- 金额统一 `AshanUI.formatMoney`
- 状态优先 `AshanUI.formatDocStatus`
- 账期优先 `AshanUI.renderPeriodSelector`
- 不新增 inline `style=`
- 不新增装饰 Emoji
- 不新增页面自己的 money formatter
- 不用全局 CSS 修页面局部问题
- 一个页面状态最多一个高强调 Primary
- 行内最多一个长期可见高频动作
- 普通数值不做 badge
- Dialog 不替代完整标准 Form
- **统一样式三步法铁律 (Search First → Extend in Kit → Reference Only)**：
  1. **先查**：修改或制作任何 UI 前，必须先从 `public/css/ashan_ui_kit.css` 和 `public/js/ashan_ui_kit.js` 检索已有样式和组件；
  2. **后增**：若 Kit 缺少场景所需的基础规范或通用类，**严禁在页面私有 CSS 中写死**，必须先在 `ashan_ui_kit.css` 中扩展定义为官方公共类/Token；
  3. **再引**：页面中只引用 `ashan_ui_kit` 的公共类或变量，严禁私自硬编码像素和颜色，杜绝样式孤岛。

## 当前代码
采购新功能先看 `procurement_workbench.js/css` 和 `procurement_picker_service.py`，优先扩展现有 profile/stage。

油卡页面是历史迁移对象。不要复制它的本地 formatter、inline style、Emoji、重复 role helper。

## 后端
- 服务端权限最终决定
- 标准 ERPNext DocType 用标准 DocPerm/lifecycle
- 自定义模块用 `authorization_service.py`
- company 服务端校验
- mutation 默认 POST
- 新代码默认禁止 `ignore_permissions=True`
- 新代码默认禁止 `frappe.db.commit()`
- 禁止直接写 GL Entry / Stock Ledger Entry
- 可重试 mutation 服务端防重复
- 不按 Page 复制同一个 write service
- 祺富与吉众用工属性禁令：未经用户允许严禁添加任何用工属性（正式工、返聘工、临时工、其他-返聘工、其他-正式工、本月离职、退休返聘、劳务派遣、实习生、其他类型员工等），严禁后台自动向数据库刷入或种子填充，只有用户自己能添加，除非用户在当前指令中明确要求 AI 添加！
- 用工性质与统计归类合二为一铁律：全系统统一为单一概念【用工性质】（`employee_type`），彻底废除“用工性质 vs 统计归类”双轨二元模型，不搞“谁归属谁”的层级嵌套，UI 彻底移除【统计归类】列与字段，规则直接绑定用工性质。

## 同步与验证铁律 (Fast Hot-Sync & Targeted Verification)
- **日常与前端修改（JS/CSS/HTML/常规Python）**：强制使用**增量流式直推** `python scripts/fast_sync.py`（<1s 生效），SSH 内存管道直写容器，免容器重启，保持热机与会话；
- **测试颗粒度**：开发微调阶段强制使用**靶向单点测试**，针对受影响页面做精准 Playwright 校验（<5s），严禁在局部微调时反复空跑全量大套件；
- **全量迁移收口**：仅在新增/修改 DocType 结构字段（.json）或数据库 patches 时，才执行 `python scripts/sync_and_migrate.py`。

## 完成前
运行：
```bash
python scripts/verify_ai_architecture_governance.py
python scripts/verify_ui_style_governance.py
```
再通过靶向单点测试验证业务与浏览器功能无误。

<!-- BEGIN ASHAN HARD GUARDRAILS -->
## AI Hard Guardrails 强制规则

本仓库采用“现有架构优先、默认禁止新架构”的开发模式。

任何 AI 修改代码前必须先执行：

```bash
python scripts/ai_architecture_query.py <本次需求关键词>
```

然后优先修改查询结果中的 canonical owner。

硬规则：

- 默认修改现有 Page、Service、CSS、JS，不创建平行实现。
- 禁止 `_v2`、`_new`、`_final`、`_fixed`、`_backup`、`_copy` 逃避理解现有代码。
- 新 Service、新共享 JS/CSS、新 Page、新 DocType、新 Report、新 Workspace 必须先在独立审批变更中登记到 component registry，并合并到 base branch。
- 新 whitelist API 必须先在独立审批变更中登记到 API registry，并合并到 base branch。
- hooks、migration、dependency、跨模块大改必须先有 base-branch architecture exception。
- AI 不得在同一个 PR 里修改 registry/exception 并同时实现代码。Guard 会按 base branch 判断，当前 PR 的自我批准无效。
- 不创建第二套权限、company scope、money formatter、sidebar、task hub、UI kit。
- 不通过修改 guard script、registry、workflow 或 CODEOWNERS 来让当前任务通过。
- 完成前必须执行 `python scripts/run_ai_guards.py`，然后执行业务测试。

架构说明：

- `docs/architecture/ARCHITECTURE_OWNERSHIP.md`
- `docs/architecture/AI_HARD_GUARDRAILS.md`
- `docs/architecture/ARCHITECTURE_APPROVAL_WORKFLOW.md`

如果 Guard 拒绝当前实现，优先缩小改动、复用现有 owner。不要通过删除 Guard 或扩大 exception 绕过。

### 薪酬工作台核心业务与人机工程铁律 (2026-10-27 用户核心标准)
- **车间外部实发工资整元取整铁律**：车间外部发薪表分项未取整加总后严格执行 `=ROUND(..., 0)` 强制四舍五入整元化（例如张引弟 6374 元整）；个税 7 级累进预扣 VBA 闭式倒推引擎必须严格以四舍五入后的整数实发金额作为 target_net，严禁因未取整浮点数导致税前和个税反推发生偏差。
- **车间外部实发表与固定薪资人员绝对隔离铁律**：表头彻底移除“应发金额”列，仅保留“实发金额”；凡薪资模式包含“固定”或有固定工资人员，一律从外部实发主表彻底排除；未上传时保持纯净引导面板。
- **员工底册动态账期联动与双态行高亮铁律**：默认在册全员严格与账期动态联动，自动排除往期已离职与未来入职人员；当月离职标记黄色高亮（`.qifu-row-resigned-cur` / `#fffbeb`），当月新入职标记绿色高亮（`.qifu-row-newcomer` / `#f0fdf4`），支持“已离职”按需穿透。
- **阶段核定与撤销双态生命周期与色彩语义统一铁律**：未核定为标准深绿【确认本表】（`.btn-success.qifu-btn-confirm` / `#15803d`），已核定为标准深红【撤销本表】（`.btn-danger.qifu-btn-stage-cancel` / `#b91c1c`），封账锁定为中性禁用灰【已封账锁定】。
- **社保与公积金集中基数设置与表格行内零空按钮铁律**：彻底删除表格数据行内无文字空修改按钮，工具栏常驻【基数设置】次级线框按钮集中维护基数与费率；历史已封账月份启动只读快照保护，严禁全局配置篡改已完税历史账期。
- **车间外部实发表三大核心指标与原表勾稽铁律 (2026-10-27)**：
  - 卡片 1【发放总金额】（¥ 139,394）：全员税后实发到手总金额（整元四舍五入）；
  - 卡片 2【考勤部分总金额】（¥ 125,409.0）：车间实发表（上半部）所有工人“实发工资”列权威合计（含孟祥山计件承包 8,732 元、翟风杰调整 6,400 元、李金刚餐补 405 元等）；
  - 卡片 3【补贴总金额】（¥ 13,985）：车间实发表下半部补贴表总计（职位补贴 10,354.67 + 房车补 3,630.00 = 13,984.67，四舍五入整元）；
  - 严格闭式守恒方程：$$\text{考勤部分总金额 (125,409.0)} + \text{补贴总金额 (13,985)} = \mathbf{发放总金额 (139,394)}$$；
  - 严禁仅加总工时分项而遗漏车间调整！在导入解析与异步重算时，必须将外部实发表的【实发工资】（`workshop_net`）作为车间计薪的最高权威源，差额自动记入 `salary_adjustment`，确保任何重算和个税倒推都不会丢失这 6,807 元！
- **个人所得税台账三大核心指标卡与记账工资表勾稽铁律 (2026-10-27)**：
  - Tab 5 必须显式展示【税前工资合计】（¥ 183,068.06）、【个税代扣合计】（¥ 5,964.86）、【税后工资合计】（¥ 163,793.00）三大核心指标；
  - 勾稽闭环方程：$$\text{全员记账税后合计 (163,793)} - \text{外籍管理固定工资 (28,000)} + \text{车间现场实发免税人员徐凤云 (3,600)} = \mathbf{车间外部实发总额 (139,393)}$$；
  - 严禁将 Tab 2 车间实发表（排除了外籍工、包含了徐经理）与 Tab 5 个税申报表（包含了外籍工、排除了徐经理）的概念与人员范围混淆！
<!-- END ASHAN HARD GUARDRAILS -->
