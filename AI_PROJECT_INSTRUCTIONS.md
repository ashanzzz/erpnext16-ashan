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
- **表格渲染必须且只能由 `AshanUI.renderTable` Schema 驱动**，全系统严禁手拼 `<table>` 字符串。
- **单据大宽表前五列固定下意识标准序 (Rule 18)**：`# / 勾选` -> `所属公司 (88px)` -> `单据编号 (105px)` -> `单据状态 (92px)` -> `单据日期 (104px)` -> `单据标题 (自适应弹性)...`。
- **字段统一收敛至 `AshanUI.Dictionary` 字典 (Rule 19 & 20)**：经手人/录单人统一为【制单人】(`owner`)，物料字段统一为【物料名称】(`item_name`)，严禁私创同义词或猜测字段。
- **弹窗统一使用 `AshanUI.createDialog` 工厂**：自动注入防误触与 `.ashan-modal-close-btn` 标准关闭按钮，顶部三行高密度卡片排版，底部保留双安全退出通道。
- **后端源数据纯净交付与前端自适应展开 (Rule 21)**：后端交付 100% 原始数据，严禁后端切片截断；前端通过 `.ashan-cell-ellipsis` 控制自适应展开。
- **AI 轮子治理与四步决策契约 (Search First → Evaluate → Register in Kit → Reference Only)**：
  1. **先查**：在 `.agents/rules/30_current_code_reuse_catalog.md` 与 `ashan_ui_kit.js` 检索已有轮子；
  2. **评定**：已有轮子覆盖则直接调用；
  3. **注册**：确需新通用能力，先在 `ashan_ui_kit.js`/`css` 抽象实现并在此目录登记；
  4. **仅引用**：业务页面只传配置 Schema，严禁在页面本地私自造轮子。

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
- **供应链三大核心角色与单/多流程工作台权限架构 (Rule 22 - 2026-10-28 用户最高指示)**：
  - **申请员 (`applicant`)**：权责范围涵盖采购申请、收货入库（现场初验）、自办电汇（垫付整算）、报销申请（现金发票）、月结补录（先收后补）、采购发票初登。职责是业务前端诉求发起、现场到货初验与垫付报销；
  - **仓库管理 (`warehouse`)**：权责范围涵盖收货入库（实物点验过账）、材料出库（生产领料出库台账与超领审计）。职责是实物资产保管、仓位分配与库存分类账（Stock Ledger）准确性；
  - **采购员 (`buyer`)**：权责范围涵盖采购执行（多流程中枢）、采购合同（大宗物资分期履约台账）。职责是对接供应商寻价比价、订货下单、督促开票、组织整算与推进付款；
  - **工作台单流程 vs 多流程形态标准**：
    - 单流程工作台（物料申请、收货入库、自办电汇、报销申请、月结补录、材料出库）：围绕单一业务生命周期展开，高信息密度，单手极速闭环；
    - 多流程中枢工作台（采购执行）：内部串联四大接力阶段 `mr_to_po`（申请转订单）、`pr_to_pi`（收货转开票）、`pi_to_rr`（发票转整算）、`pi_to_pay`（发票转对公付款申请），由采购员专属作为中枢枢纽组织推进；
  - **AI 权限研发三铁律**：
    1. 唯一权限守卫：全系统禁止在页面或服务本地写死 `frappe.get_roles`，必须调用 `authorization_service.can_user_access_workbench(key, action)` 与 `authorization_service.assert_workbench_access(key, action, company)`；
    2. 严禁越界越权：AI 编写/修改任何工作台或 API 时，严格遵守角色与工作台对应关系，禁止把仓库出库逻辑塞给申请员，禁止把采购订单寻价下单逻辑塞给申请员，禁止拆散采购执行工作台的多流程中枢；
    3. 单/多流程纯净隔离：单流程工作台保持极速直达与纯净性，多流程工作台保持阶段接力连贯性。

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
