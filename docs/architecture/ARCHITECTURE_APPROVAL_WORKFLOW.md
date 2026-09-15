# Architecture Approval Workflow

只有真正需要新增架构时才走本流程。普通功能修改不需要。

## A. 新 Service / 共享组件 / Page / DocType

第一步只修改：

`.agents/architecture/component_registry.json`

新增条目至少写：

```json
{
  "id": "meaningful-domain-name",
  "kind": "domain",
  "domain": "existing-domain",
  "responsibility": "这个组件唯一负责什么",
  "canonical_files": [
    "planned/path.py"
  ],
  "reuse_keywords": [
    "搜索过的业务关键词"
  ],
  "parallel_implementations_forbidden": true,
  "reuse_searches": [
    "现有 service/path",
    "搜索关键词"
  ],
  "why_existing_cannot_extend": "为什么现有 owner 确实不能扩展"
}
```

这个 PR 不允许同时创建 `planned/path.py`。

审批并 merge 后，第二个 PR 才创建实现。

## B. 新 whitelist API

第一步只修改：

`.agents/architecture/api_registry.json`

例如：

```json
{
  "endpoint": "ashan_cn_procurement.services.example.confirm_action",
  "domain": "procurement",
  "mutation": true,
  "http_methods": ["POST"],
  "permission_guard": "standard Purchase Order write permission + company scope",
  "company_scope": "required",
  "reason": "现有 API 无法表达这个独立的原子业务动作"
}
```

合并后才实现 API。

## C. 跨模块、大重构、hooks、migration、dependency

第一步只修改：

`.agents/architecture/architecture_exceptions.json`

例如：

```json
{
  "id": "ARCH-2026-001",
  "enabled": true,
  "expires": "2026-10-31",
  "reason": "统一工资和月结任务协议",
  "allowed_domains": ["payroll_qifu", "payroll_jizhong", "tasks"],
  "allowed_paths": [
    "ashan_cn_procurement/ashan_cn_procurement/services/task_hub_service.py",
    "ashan_cn_procurement/ashan_cn_procurement/services/*payroll*.py"
  ],
  "capabilities": ["cross-domain", "large-change"]
}
```

审批合并后再做实现。

## 为什么必须分两个 PR

Guard 总是从 base branch 读取批准信息。

AI 在当前 PR 修改 registry 并不能影响当前 PR 的许可。

这是防止“AI 自己扩权”的关键机制。
