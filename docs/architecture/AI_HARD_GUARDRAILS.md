# AI Hard Guardrails

这套机制不是提示词，而是仓库级约束。

## 会直接阻断

- `_v2`、`_new`、`_final`、`_fixed`、`_backup`、`_copy` 类复制文件
- 新的 `window.Xxx` 全局命名空间
- 页面重新定义 `formatMoney`
- 页面/Service 重新定义 company/role authorization helper
- inline `style=`
- 非共享 CSS 中的裸全局 selector
- 普通请求中的 `frappe.db.commit()`
- 普通用户路径中的无说明 `ignore_permissions=True`
- 直接写 GL Entry / Stock Ledger Entry
- 未预批准的新 Service / Shared JS/CSS / Page / DocType / Report / Workspace
- 未预批准的新 whitelist API
- 同一个 PR 一边改 registry 一边写实现
- 未预批准的 hooks / migration / dependency 变更
- 新文件高度复制现有大文件
- 一次普通任务跨多个业务域
- 一次修改文件过多、加行过多、共享层过多
- 大文件被整体推倒重写

## 会警告

- 新 `frappe.get_all`
- f-string raw SQL
- 非共享 CSS 新增 `!important`
- ownership 没有覆盖到的路径

## AI 正常工作方式

```text
收到需求
↓
python scripts/ai_architecture_query.py <关键词>
↓
找到现有 owner
↓
只修改现有 owner + 当前 Page
↓
python scripts/run_ai_guards.py
↓
业务测试
↓
PR
```

不是：

```text
收到需求
↓
新建一个 service
↓
复制一个 page
↓
新建一套 CSS
↓
在 hooks 注册
↓
再写一个权限 helper
```
