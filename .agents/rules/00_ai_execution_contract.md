# AI Engineering Execution Contract V2

本文件是 AI 修改本仓库时的工程执行入口。业务规则继续由 `AGENTS.md` 和业务文档定义。

## 强制读取
1. `PROJECT_MAP.md`
2. `AGENTS.md`
3. `AI_PROJECT_INSTRUCTIONS.md`
4. `.agents/ai-governance.json`
5. `.agents/rules/01_repository_current_state.md`
6. `.agents/rules/10_frontend_component_reuse_contract.md`
7. `.agents/rules/11_button_and_action_standard.md`
8. `.agents/rules/12_table_and_ledger_standard.md`
9. `.agents/rules/13_dialog_and_form_standard.md`
10. `.agents/rules/14_module_ui_standard.md`
11. `.agents/rules/20_backend_service_permission_standard.md`
12. `.agents/rules/21_api_action_contract.md`
13. `.agents/rules/change_conflict_prevention.md`
14. `.agents/rules/30_current_code_reuse_catalog.md`
15. `docs/ai/FEATURE_IMPLEMENTATION_CONTRACT_TEMPLATE.md`
16. 本次任务相关的现有代码和测试

## 冲突时优先级
数据完整性和安全，服务端权限，Frappe/ERPNext 生命周期，生产兼容，本治理规范，业务规则，历史 UI 示例，视觉偏好。

旧页面存在的写法不自动成为新规范。

## 写代码前
必须先确认：
- 业务结果
- 用户和 company scope
- 标准 DocType 还是自定义模块
- 页面类型
- 已有 Page/domain runtime/AshanUI
- 已有 service/API
- 权限入口
- transaction 和 duplicate protection
- 会触碰哪些共享文件
- 测试

非简单功能先内部填写 `FEATURE_IMPLEMENTATION_CONTRACT_TEMPLATE.md`。

## Search before create
Page、Dialog、formatter、CSS class、JS helper、service、API、role map、company helper、DocType、Custom Field、Workspace、sidebar、patch、scheduler、test helper，都必须先搜索再创建。

## Frontend hard rules
- 优先 Frappe native
- 不新增 inline style
- 不新增装饰 Emoji
- 不新增重复 money formatter
- 页面局部 CSS 不污染全局
- 一个页面状态最多一个高强调 Primary
- 普通数值不用 badge
- Dialog 不替代完整标准 Form
- 请求必须有 loading/error/success
- 服务端自由文本进入 HTML 先 escape
- global event 不重复绑定

## Backend hard rules
- 服务端权限最终决定
- company 服务端校验
- 标准 ERPNext DocType 用标准 permission/lifecycle
- 自定义模块用 authorization service
- mutation 默认 POST
- 新代码默认禁止 ignore_permissions
- 新代码默认禁止 manual commit
- 禁止直接 GL Entry / Stock Ledger Entry 写入
- 可重试 mutation 服务端防重复
- 不按 Page 复制同一个 write service

## 当前代码判定
推荐复用：
- `ashan_ui_kit.css/js`
- `authorization_service.py`
- `procurement_workbench.js/css`
- `procurement_picker_service.py`

历史迁移对象：
- 油卡 Page 本地 formatter
- inline style
- 装饰 Emoji
- 重复 role helper
- 其他同类 Page 内重复实现

## 最小改动
不做无关重构。`hooks.py`、UI kit、authorization registry、workspace/sidebar、fixtures、DocType JSON 只做最小编辑。

## 完成门禁
必须运行：
- `python scripts/verify_ai_architecture_governance.py`
- `python scripts/verify_ui_style_governance.py`

然后运行相关测试、权限 allow/deny、wrong-company、invalid-state、duplicate-retry、build/migrate、浏览器/Playwright。
