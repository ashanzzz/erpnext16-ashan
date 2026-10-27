# AI 任务执行规范 V3（agent 实操版）
# 专为 ashan_cn_procurement ERPNext 16 项目设计

---

## 核心原则（背诵）

**1. 先读后写**：任何修改前，先读相关文件的相关 section。不猜测文件内容。

**2. Schema 驱动**：所有自定义表格必须用 cols 数组驱动，严禁手写 HTML 拼串。

**3. 最小改动**：只改任务要求的内容，不顺带"优化"无关代码。

**4. 实机验证**：运行架构门禁脚本，运行 fast_sync.py，截图确认视觉效果。

**5. Fail-Fast**：出错了立即显式报告，不做假兼容，不静默回退到旧数据。

---

## 任务开始前必读文件（按顺序）

1. `.agents/rules/00_ai_execution_contract.md`（总契约）
2. `.agents/rules/01_repository_current_state.md`（当前状态）
3. `PROJECT_MAP.md`（路径地图）
4. `.agents/rules/30_current_code_reuse_catalog.md`（可复用目录）
5. 任务相关的现有代码文件

如果任务涉及：
- 表格 → 还需读 `12_table_and_ledger_standard.md`
- 弹窗/表单 → 还需读 `13_dialog_and_form_standard.md`
- 按钮/动作 → 还需读 `11_button_and_action_standard.md`
- 后端 API → 还需读 `20_backend_service_permission_standard.md`
- CSS 样式 → 还需读 `10_frontend_component_reuse_contract.md`

---

## 任务执行决策树

```
收到任务
  ↓
1. 确认业务目标和用户需求
2. 确认涉及的 Page/DocType/Service
3. 确认是否需要填写 FEATURE_IMPLEMENTATION_CONTRACT_TEMPLATE.md
   （非简单改动必须填写）
  ↓
4. 读取相关现有代码
5. 规划最小改动范围
6. 确认不会破坏其他功能
  ↓
7. 执行代码修改
  ↓
8. python scripts/fast_sync.py（同步到容器）
9. python scripts/run_ai_guards.py（架构门禁）
10. 靶向 Playwright 验证截图
11. 报告结果（含截图证据）
```

---

## 高冲突文件操作规范

以下文件修改前必须完整读取相关 section，禁止整文件替换：

```
hooks.py
public/css/ashan_ui_kit.css
public/js/ashan_ui_kit.js
public/js/ashan_cn_sidebar_v2.js
public/js/ashan_work_context.js
services/authorization_service.py
workspace JSON / sidebar JSON
patches.txt
```

---

## 同步验证命令

```bash
# 日常代码修改（JS/CSS/Python 业务逻辑）
python scripts/fast_sync.py

# DocType 结构变更（.json 字段改动）
python scripts/sync_and_migrate.py

# 架构合规门禁
python scripts/verify_ai_architecture_governance.py
python scripts/verify_ui_style_governance.py
python scripts/run_ai_guards.py

# 靶向浏览器测试（改了哪个页面就跑哪个）
python scripts/verify_reimbursement_modal_live.py
# 或者对应的页面验证脚本
```

---

## 祺富/吉众薪酬数据操作红线

**绝对禁止未经用户授权：**
- 自动插入用工属性（正式工、返聘工、临时工、本月离职等任何类型）
- 在代码里编写任何 `doc.insert()` 用工属性的后台静默逻辑
- 跨公司查询（祺富数据用在吉众，或反过来）
- 修改历史封账月份的数据

**薪酬相关 API 必须先调用：**
```python
assert_payroll_access(action="read/write", company=company)
```

---

## 错误响应协议

当发现 Bug 或不符合预期：
1. **立即明确报告错误**，说明：
   - 哪个文件哪一行
   - 什么行为
   - 预期是什么
   - 实际是什么
2. **不做假兼容**（不写"如果数据存在就用真实数据，否则用硬编码列表"的伪兜底）
3. **不静默吞错**（不只 console.error，必须告知用户）
4. 提供明确的修复建议

---

## 交付物清单

每次任务完成必须提供：

| 交付物 | 格式 |
|--------|------|
| 修改的文件列表 | 绝对路径 |
| 架构门禁通过结果 | `run_ai_guards.py` 输出 |
| 浏览器验证截图 | 关键状态（加载完成、操作后、错误状态） |
| Git diff 摘要 | 说明改了什么，为什么 |
