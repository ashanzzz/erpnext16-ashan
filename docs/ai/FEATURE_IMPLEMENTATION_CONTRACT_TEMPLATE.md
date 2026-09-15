# Feature Implementation Contract Template

非简单功能编码前内部填写。

## 业务
- 目标
- 用户
- company scope
- 标准 DocType / 自定义模块
- 权威数据源
- 当前业务状态

## UI
- 页面类型
- 为什么不能使用更原生 Frappe 表面
- 现有 Page
- 现有 domain runtime
- 现有 AshanUI
- Primary / Secondary / Danger
- 表格类型
- Dialog 是否需要
- Loading / Empty / Error
- keyboard/focus
- laptop viewport

## 后端
- 现有 service
- 新 service 是否真的需要
- 权限来源
- company guard
- transaction
- idempotency
- standard lifecycle
- background job / scheduler

## Action Matrix
| UI 动作 | Server method | HTTP | Input | Output | Permission | Company | State | Side effect | Duplicate guard |
|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | |

## 修改文件
| 文件 | 原因 | 是否共享 | 冲突风险 |
|---|---|---|---|
| | | | |

## 兼容和回滚
- Existing callers
- Existing routes
- Existing documents
- Existing permissions
- Migration
- Rollback

## 测试
Backend：happy、invalid、denied、wrong company、invalid state、duplicate/retry。

Frontend：load、empty、error、busy、permission state、long text、large numbers、100+ rows、keyboard、common laptop width。

Gate：
- `python scripts/verify_ai_architecture_governance.py`
- `python scripts/verify_ui_style_governance.py`
