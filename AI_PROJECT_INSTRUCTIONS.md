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

### 薪酬工作台多模式人员计薪、反推与防踩坑规范 (2026-11-08 用户最高经验沉淀)
任何 AI 处理祺富或吉众薪酬工作台、外部实发表解析、税后倒推与发放表导出时，必须严格遵守以下法则：
1. **全厂人员四大分类模型**：
   - **计件考勤操作工族（王永等）**：有工时、加班、达标率，考勤加减算车间实发；正式工缴社保公积金，返聘工不缴但全额参与个税；全员税后实发反推税前与个税；24列发放表第 P 列用考勤加减公式 `=F+G+H+J+L+N-O`；
   - **定额技术/管理反推族（孟祥山、翟风杰）**：不通过考勤计件算薪。孟祥山管理岗直接给定车间定额（8752元），翟风杰车间底薪定额（6500元）+ 职位补贴（2000元）= 8500元；在册参保正式工，档案发薪模式必须为“税后动态工资（税后倒推）”，以最终实发为目标闭式反推税前应发与个税；**导出 24 列实发表时第 P 列必须直接填入车间实发定额数值，严禁套用考勤加减公式清零**！
   - **纯补贴管理/临时工族（徐凤云/徐经理）**：上方车间表完全无行次（0工时0出勤），仅在下方补贴表以别名（徐经理）出现领取职位补贴（3600元）；档案标记为“临时工/不税动态工资”，不缴社保，免除个税台账预扣；**发放表严禁因工时为0或工号非A开头误杀，必须纳入 24 列实发表并生成现金点钞**；
   - **独立外籍工（UNURBAYARENKHZUL）**：独立外籍合同发放，不进入内资 24 列实发表。
2. **自动化测试与连续账期保护铁律**：
   - 严禁任何测试脚本（如 Playwright、API 接口调用）向已封账的历史月份（如 2026-09）重复执行真实文件上传或重新导入，因为导入会无条件将该月份重置为“草稿”，破坏 `get_allowed_billing_period` 的账期保护，导致下一月（2026-10）被锁死并强制用户重新确认上一月；
   - 自动化测试与质检只能在当前草稿账期或隔离数据空间中执行。
3. **详细规范与数学公式**：
   详见 `docs/ai/QIFU_PAYROLL_EMPLOYEE_PATTERNS_AND_CALCULATION_SPEC.md`。
### 24 列薪资发放表 (车间签领单) 排版与打印铁律
1. **行顺序与序号 (序号 1~N)**：
   - 严禁按系统工号 (QF0001, QF0003...) 字母排序！必须严格继承车间实发源表原始编号 `source_serial_no` (孟祥山 1、翟风杰 2、王永 3 ... 余莉影 23)，纯补贴管理人员 (徐凤云/徐经理) 紧随其后作为 24 号；
   - 保证车间签字领钞时工人序号与车间排产表 100% 一致。
2. **合计行公式覆盖 (SUM 全覆盖)**：
   - 必须覆盖第 4 列(作业天数)至第 22 列(实发工资合计)全部数值列（包括天工资、小时工资、加班小时、达标率等），严禁遗漏任何列的 `=SUM(...)`；
   - 现金面额辅助列（第 25 列至第 31 列）同样必须逐列配置 `=SUM(...)` 公式。
3. **打印格式与单人单页签领规范**：
   - **顶端标题行重复 (Rows to repeat at top)**：`ws.print_title_rows = "1:2"`（主标题与 24 列表头在每一打印页自动置顶）；
   - **打印范围 (Print Area)**：严格限定为 `A1:X{last_seq_row}`（A-X 列，序号 1 至最后序号/合计上一行；合计行与现金辅助列严禁混入签领打印范围）；
   - **单人单页分页符 (Page Breaks)**：自序号 1（第 3 行）至最后序号/合计上一行（第 `last_seq_row` 行），必须逐行插入分页符 `Break(id=r)`，实现打印输出时每页独立呈现 1 位员工的完整薪资与签字签领单；
   - **页面自适应 (Landscape A4)**：A4 横向，`fitToWidth = 1`, `fitToHeight = 0`，上下左右边距紧凑适配。

<!-- END ASHAN HARD GUARDRAILS -->
