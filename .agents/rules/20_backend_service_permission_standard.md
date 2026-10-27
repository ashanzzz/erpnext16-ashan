# 后端服务、权限和数据完整性规范 V3

---

## 一、权限守卫选择（必须先调用）

| 场景 | 必须调用的守卫 |
|------|--------------|
| 所有采购相关 | `frappe.has_permission(doctype)` 或 `assert_company_access(company)` |
| 薪酬相关 | `assert_payroll_access(action, company)` |
| 油卡相关 | `assert_oil_ledger_access(action, oil_card)` |
| 通用自定义模块 | `assert_module_access(module, action, company)` |
| 公司范围验证 | `assert_company_access(company)` |

**所有自定义模块 API 必须先调用上面其中一个守卫，再执行业务逻辑。**

守卫顺序铁律：
```python
@frappe.whitelist()  # 或 methods=["POST"]
def my_api(company, ...):
    # 1. 权限第一（不信任前端传来的任何参数）
    assert_company_access(company)
    # 2. 业务校验
    # 3. 数据操作
```

---

## 二、标准 API 骨架

### 读取 API

```python
@frappe.whitelist()
def get_data(company, filters=None):
    assert_company_access(company)
    filters = frappe.parse_json(filters or "{}")
    
    # 有界查询：必须有 company 过滤，有时间/数量范围限制
    rows = frappe.db.get_all(
        "My DocType",
        filters={"company": company, ...},
        fields=["name", "status", ...],
        order_by="creation desc",
        limit=500  # 必须有上限
    )
    return {"rows": rows, "total_count": len(rows)}
```

### 写入 API

```python
@frappe.whitelist(methods=["POST"])  # 写操作必须 POST
def create_or_update(company, name=None, **kwargs):
    assert_company_access(company)
    
    # 状态校验：不信任前端传来的状态
    if name:
        doc = frappe.get_doc("My DocType", name)
        if doc.docstatus != 0:
            frappe.throw("该单据已提交，不能修改")
        if doc.company != company:
            frappe.throw("公司不匹配")
    
    # 幂等检查
    existing = frappe.db.exists("My DocType", {"source_ref": kwargs.get("source_ref")})
    if existing:
        return {"name": existing, "already_exists": True}
    
    # 标准 Frappe 生命周期
    doc = frappe.get_doc({"doctype": "My DocType", "company": company, ...})
    doc.insert()
    return {"name": doc.name, "success": True}
```

---

## 三、绝对禁止项（无例外）

```python
ignore_permissions=True   # 禁止（新代码）
frappe.db.commit()        # 禁止（Frappe 已管理事务）
直接写 GL Entry            # 禁止（用标准 accounting entry API）
直接写 Stock Ledger        # 禁止（用标准 stock entry API）
用户输入拼接 SQL            # 禁止（使用参数化查询）
查全公司数据后前端过滤       # 禁止（服务端必须有 company 过滤）
```

例外（需要注释说明）：
```python
# AI-GOVERNANCE-EXCEPTION: ignore_permissions <具体原因>
# AI-GOVERNANCE-EXCEPTION: db_commit <具体原因和恢复策略>
```

---

## 四、薪酬数据最高级禁令

**以下行为未经用户在当前会话明确授权，绝对禁止：**

1. 自动插入任何用工属性（正式工/临时工/返聘工/本月离职等）
2. 在后端代码里编写任何 `doc.insert()` 用工属性的静默逻辑
3. 为用工属性提供"默认值"、"种子数据"或"兜底数组"
4. 跨公司查询（祺富数据混入吉众，或反过来）
5. 修改历史封账月份的数据

---

## 五、公司隔离原则

任何 API 只要接收或可推导 company 参数，必须服务端验证：

```python
# ✅ 正确
def get_employees(company):
    assert_company_access(company)
    return frappe.db.get_all("Employee", filters={"company": company, ...})

# ❌ 错误：全量查询后前端过滤
def get_employees():
    return frappe.db.get_all("Employee")  # 返回所有公司数据
```

---

## 六、Service vs Page Python 分工

| 文件类型 | 应该包含 |
|---------|---------|
| `services/<domain>_service.py` | 复杂业务逻辑、计算、跨 DocType 操作 |
| `page/<page_name>/<page_name>.py` | Page 级 read model、薄适配层、少量 UI metadata |
| DocType Controller (`<name>.py`) | Lifecycle hooks、字段校验、触发器 |

**同一个 mutation 服务不因不同 Page 而复制。**

---

## 七、幂等保护（必须实现）

以下操作必须服务端防重复：
- 生成下游单据（采购发票、入库单、付款单）
- 薪酬封账/解锁
- 批量导入
- 后台异步任务

实现方式（任选其一）：
- Existing linked doc check（已存在关联单据）
- Unique key constraint（数据库唯一约束）
- Source operation ID（来源操作 ID 去重）
- Workflow state guard（工作流状态守卫）

**前端按钮 disabled 不算幂等保护，服务端必须再次检查。**

---

## 八、余额型台账

油卡、库存余额、资金余额等余额型台账：

1. 余额必须服务端计算：`开期 + 本期流入 - 本期流出 = 期末`
2. 如果缓存 current_balance，必须能从权威流水重建
3. 新增、取消、删除相关事件时必须统一更新缓存
4. 浏览器传来的余额值不算权威，服务端必须重新计算

---

## 九、测试铁律（动态自检，禁止魔法数字）

```python
# ❌ 禁止：写死人数（系统增减一人就失效）
assert len(rows) == 26

# ✅ 要求：从数据库动态计算期望值
expected = frappe.db.count("Employee", {
    "company": company,
    "status": "Active",
    "date_of_joining": ["<=", period_end]
})
assert len(rows) == expected
```
