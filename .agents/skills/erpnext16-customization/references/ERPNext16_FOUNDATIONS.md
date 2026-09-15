# ERPNext / Frappe 16 定制基础

## 开发决策树

| 需求 | 首选方式 | 不应优先选择 |
| --- | --- | --- |
| 新业务数据 | custom app 中的标准 DocType / Child Table | 在核心 app 中加临时表或裸 SQL |
| 标准 DocType 加少量行为 | v16 `extend_doctype_class` / Doc Events | 覆盖整个标准类 |
| 标准表单交互 | `doctype_js` / Form Script | 全局注入 JS |
| 标准 Desk Page 加行为 | `page_js` | 修改 Frappe core 页面 |
| 自定义复杂工作台 | custom Desk Page + 服务端 API | 在单一 Client Script 堆叠全部逻辑 |
| 部署 Custom Field/Property Setter | Export Customizations 或 Fixtures | 仅在某一个生产站点手工改 |
| 长耗时任务 | Background Job / Scheduler | 阻塞 HTTP 请求 |

## Document 生命周期

Document 是 Frappe 的核心业务单元；字段、权限、校验和保存行为不应绕开它。典型事件包括 `before_validate`、`validate`、`before_save`、`on_update`、`before_submit`、`on_submit`、`on_cancel` 与 `on_trash`。

- 用 `before_validate` 补全可推导值；用 `validate` 拦截非法业务状态。
- `on_change` 可能被 `db_set` 调用，因此内部逻辑必须幂等。
- 对已提交 Document，遵循控制器提供的合法流程；不要直接数据库更新来绕过审计和会计逻辑。

## API 和查询

- v1 文档 REST：`/api/resource/<DocType>`；RPC：`/api/method/<dotted.path>`。
- v2 的文档与元数据路径以 `/api/v2/` 开头。调用格式与能力应由当前官方文档和运行版本核验。
- `frappe.get_doc` 用于读完整文档并走对象方法；列表页用 `frappe.db.get_list` / Query Builder 并显式 `fields`、`filters` 和 `order_by`。
- `get_list` 与 `get_all` 的权限语义不同；高风险读取不要因方便使用会绕过权限的查询方式。
- REST Token 只从安全配置读取；禁止放进前端、代码、日志或本插件。

## Hooks 与资产

`hooks.py` 是 custom app 集成点：`app_include_css`、`app_include_js`、`doctype_js`、`page_js`、`doc_events`、`scheduler_events`、`after_migrate`、`fixtures` 等。更改共享 CSS/JS 资产时更新资源版本查询参数，以避免 Desk/反向代理继续使用旧缓存。

- Frappe 16 页面内使用 `frappe.require()` 懒加载非 bundle 的 JS/CSS 时，传入不带手工查询参数的 `/assets/.../*.js` 或 `/assets/.../*.css` 路径。不要自行拼接 `?v=`：当前 v16 资源加载器会从传入字符串推断扩展名，查询参数可能导致处理器识别失败并让 Desk Page 白屏；版本参数由 Frappe 资源加载器自动追加。
- `hooks.py` 中由服务端模板直接输出的 `app_include_js` / `app_include_css` 查询版本，与页面运行时 `frappe.require()` 的路径规则不是同一层，二者不能机械套用。

## Desk Page 生命周期与资源恢复

Frappe Desk 会缓存已访问 Page 的 wrapper；直接访问 URL 的冷启动通过，不代表在 Desk 内切走再回来仍然正确。

- `on_page_load` 只做首次资源加载与实例挂载；`on_page_show` 负责恢复已缓存工作台的可见状态、路由参数和轻量刷新。两者都必须通过同一个幂等入口工作，禁止每次显示重复创建页面、重复绑定事件或重复发起初始化。
- 将实例保存在该 `wrapper` 上；再次进入时优先调用实例的 `show()` / `refresh()`，而不是假定 `on_page_load` 会再次执行。实例不存在时才进行首次挂载。
- Page 中可能同时保留多个隐藏工作台，不能用裸 `$("#picker-data-table")`、`document.querySelector()` 等全局选择器读取或写入重复 ID。统一从 `this.$body` / `page.body` / `wrapper` 向内查找，并把委托事件绑定在该容器上。
- 遇到“首次正常、切页回来白屏”时，先检查 `on_page_show`、实例是否被保留、选择器是否越过 wrapper 和共享资源是否真正加载；不要先删除 `sites/assets`、重置 Frappe/ERPNext 核心资源或盲目清空浏览器数据。
- 自定义应用 JS/CSS 变更只按项目脚本执行 app 级 build、站点缓存失效和服务重启；不修改 `apps/frappe`、`apps/erpnext` 或核心资产目录。部署后通过已加载资产 URL、响应版本或内容标记确认服务器确实是新资产。

## 迁移与测试

- 元数据、Fixture、Patch、Doctype 变更应以可迁移、可复现方式进入 custom app。
- `bench migrate`、`bench build`、`clear-cache` 的执行顺序和项目同步方式遵从当前项目脚本。
- 高风险业务逻辑同时需要单元/集成测试和真实 Desk 浏览器验收。

## 官方资料和版本核验

本资料只提供稳定概念。具体签名、版本行为、Hook 可用性、REST v2 细节和 Vue/Frappe UI 实现须参见 `OFFICIAL_DOCUMENTS.md`，并与当前 v16 源码交叉验证。
