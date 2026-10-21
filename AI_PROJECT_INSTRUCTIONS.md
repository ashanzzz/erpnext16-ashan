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
<!-- END ASHAN HARD GUARDRAILS -->
