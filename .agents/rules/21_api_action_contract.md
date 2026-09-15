# 前端动作和后端 API 配对规范

## 每个业务动作必须定义
- UI 动作
- 前端位置
- Server method
- HTTP method
- Input
- Output
- Permission
- Company scope
- Document state
- Side effect
- Duplicate protection
- Success UI
- Error UI

没有这些信息，不开始写 mutation。

## 读取
前端调用服务端后必须处理 loading、empty、error 和权限失败。

后端必须：
- read permission
- company scope
- bounded query
- stable response

## 写入
前端：
- busy
- disable
- call
- success
- refresh authoritative state
- finally restore

后端推荐：
```python
@frappe.whitelist(methods=["POST"])
def action(...):
    authorize()
    validate()
    return service(...)
```

## Capability
复杂 Workbench 推荐先由服务端返回 capability。
采购当前 `allowed_stages/capabilities/is_manager` 是可复用模式。

前端 capability 只控制体验。每个 mutation 后端仍再次授权。

## Company options
自定义模块优先 `get_module_company_options(module)`。
采购使用已有采购 company context。
不要拉全部 Company 后前端过滤。

## API 输出
已有 API 保持兼容，不为了统一格式破坏调用方。
新 API 返回稳定 dict，避免同一路径有时 list、有时 dict。

禁止返回未授权字段后要求前端隐藏。

## 错误
权限用 `frappe.PermissionError`。
业务状态用明确 `frappe.throw()`。
前端不能吞错。

## 生成下游单据
服务端必须重新检查：
1. 源单据
2. 权限
3. company
4. docstatus/workflow
5. 剩余数量/金额
6. 已存在下游关系
7. 标准 ERPNext 创建流程

成功返回新 doc identity，前端再刷新候选池。

不能直接相信页面第一次加载的旧 row 数据。

## AI 推荐
AI 只提供推荐，不提供最终授权。
确认时服务端重新验证所有业务条件。
confidence 不是 permission。
