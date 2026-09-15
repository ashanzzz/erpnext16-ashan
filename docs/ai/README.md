# ERPNext 16 AI 开发知识包

用途：让 AI 编程助手在 ERPNext 16 / Frappe Framework 16 项目中，优先采用正确的 custom app、DocType、Hooks、Client Script、Python Controller、REST API、Desk Page 和迁移方式，而不是凭旧版经验修改 core。

## 文件

- `AGENTS_ERPNext16.md`
  - 放到项目根目录，或把其中内容合并进现有 `AGENTS.md`
  - 只保存 AI 每次开发都必须遵守的纪律
- `ERPNext16_LEARN.md`
  - 主学习文件
  - 解释 ERPNext 16 custom app 的前端、后端、脚本、API、DocType、迁移和调试
- `ERPNext16_API_MAP.md`
  - API 和扩展方式速查
- `ERPNext16_UI_GUIDE.md`
  - ERPNext 16 原生 Desk、自定义 Page、Vue / Frappe UI 的使用边界与 UI 规范
- `ERPNext_PROJECT_RULES.md`
  - 当前项目自己的字段、业务规则和禁止事项
  - 官方知识不要写进这个文件

## 建议目录

```text
project-root/
├── AGENTS.md
└── docs/
    └── ai/
        ├── ERPNext16_LEARN.md
        ├── ERPNext16_API_MAP.md
        ├── ERPNext16_UI_GUIDE.md
        └── ERPNext_PROJECT_RULES.md
```

## AI 读取顺序

```text
AGENTS.md
↓
ERPNext_PROJECT_RULES.md
↓
ERPNext16_LEARN.md
↓
ERPNext16_API_MAP.md
↓
ERPNext16_UI_GUIDE.md
↓
当前项目源码
↓
Frappe / ERPNext version-16 官方源码
```

## 维护原则

1. ERPNext / Frappe 升级主版本时，更新 `ERPNext16_*` 文件。
2. 企业自己的字段和操作习惯只更新 `ERPNext_PROJECT_RULES.md`。
3. 官方文档和实际 v16 源码冲突时，以当前项目实际版本和源码为准。
4. 任何高风险财务、库存、提交、取消逻辑都必须先读 ERPNext v16 对应 Controller。
5. 本知识包不是 core fork 指南。默认不直接修改 `apps/frappe` 或 `apps/erpnext`。

最后核验日期：2026-08-12
