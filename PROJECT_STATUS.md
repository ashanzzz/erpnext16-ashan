# Ashan ERPNext 16 项目状态与设计交付台账 (Project Status Ledger)

- **更新日期**：2026-09-23
- **设计标准**：Penpot (`design.penpot.app`) · 核心工程文件 `Ashan ERPNext 16`
- **代码底座**：ERPNext 16 / Frappe 16 (`ashan_cn_procurement`)
- **系统规范**：`AGENTS.md`、`AI_PROJECT_INSTRUCTIONS.md`、`ERPNext 16 + Penpot AI 总工作规则`

---

## 1. 当前里程碑与推进阶段

| 阶段 | 任务目标 | 状态 | 负责文件 / 交付物 | 验收结果 |
| :--- | :--- | :---: | :--- | :--- |
| **P0: 规则确立** | 确立 Penpot AI 终极工作规则与项目状态底册 | **已完成** | `PROJECT_STATUS.md`、`docs/architecture/` | 规则生效，项目所有者仅负责需求与审查 |
| **P1: Foundations** | 颜色(三层)、字阶、间距(4px)、圆角、几何尺寸 | **进行中：Penpot 基础色板已建立，待验收** | `ashan_ui_kit.css`、`01 · Foundations` | 12 个 Primitive Color 对照当前 CSS；语义色、字阶和几何尺寸待核对 |
| **P2: Global Shell** | 左侧导航(216px展开/64px缩小)、左下角公司选择器、顶栏 | **设计草稿完成，Penpot 未验收** | `ashan_cn_sidebar_v2.js`、`04 · Navigation` | A风格(Frappe原生精修)，公司上下文置于左下角 |
| **P3: 样板验证** | **油卡综合台账**（第一套完整业务样板） | **待启动** | `10 · 油卡`、`oil_card_ledger.*` | 四柱守恒、纯净台账、期初始末闭环 |
| **P4: 核心供应链** | 采购与供应链（物料申请、采购执行、收货、合同、月结） | **待启动** | `20 · 采购与供应链`、`procurement_workbench.*` | 扩展现有 stage，严禁平行实现 |
| **P5: 薪酬双体系** | 祺富人事薪酬 vs 吉众人事薪酬（物理绝对隔离） | **待启动** | `50 · 祺富`、`60 · 吉众` | 维持各自算薪引擎与工作台，绝不混用 |

---

## 2. 页面与组件规范状态

- **设计工程**：`Ashan ERPNext 16`（主工作区：`design.penpot.app`）
- **左侧侧栏规范**：
  - **展开态**：~216px，单手风琴展开，路由精确高亮，待办徽标（`ashan-sidebar-count-badge`）
  - **收缩态**：~64px，图标居中，活动模块带青绿指示微光，悬浮/点击出轻量 Tooltip
  - **左下角所属公司**：位于用户头像上方，两行布局（`所属公司` / `全部公司` / `编辑`），收缩态紧凑显示 `公司/全`
- **Penpot Foundations 起步（2026-09-23）**：现有 `Page 1` 改为 `01 · Foundations`，原空白 Board 改为 1366 × 768 的 `Foundations / Tokens`；建立 `Ashan/Primitives` 色彩 Token Set（12 个）并完成色板视觉检查。主操作语义色和 216 / 64 px 导航尺寸尚未定稿。
- **首个业务模块样板**：
  - 确认采用 **油卡综合台账** 作为 Design System 首批组件（表格、台账、四柱、状态、账期、弹窗）的验收样板。

---

## 3. 待办事项 (Next Actions)

1. [x] 确立 `ERPNext 16 + Penpot AI 总工作规则` 并建立 `PROJECT_STATUS.md`
2. [ ] 在 Penpot `Ashan ERPNext 16` 建立 `01 · Foundations` 与 `04 · Navigation` 标准画板
3. [ ] 将左下角“所属公司”交互和双状态导航生成 Penpot 兼容矢量资产包
4. [x] Penpot 官方 Remote MCP 端到端只读验证（2026-09-23）：Codex 用户配置已连接官方端点；读取到 Page 1，页面 ID 与正式文件匹配。旧 localhost 条目保留为禁用备用项。
5. [ ] 启动第一个业务样板：油卡综合台账的 Penpot 画板全面梳理
