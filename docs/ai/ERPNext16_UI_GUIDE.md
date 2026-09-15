# ERPNext 16 UI GUIDE

> 目标：让 custom app 的页面现代、清楚、信息密度合理，同时保持 ERPNext / Frappe Desk 的原生操作习惯。

## 🌟 企业级侧边栏 UI 与交互标准规范 (Milestone Standard)

用户确认并喜爱的标准侧边栏设计体系（必须严格保持）：

1. **层级视觉规范**：
   - **一级标题 (Section Break)**：加粗展示（`font-weight: 700; font-size: 13.5px;`），配备专属功能图标与折叠小箭头。
   - **二级菜单 (Sub-items)**：**严格禁止图标**，纯文字左缩进 24px（`font-size: 13px; font-weight: 400;`），与一级形成鲜明主次视觉。
2. **“职责分离”双区交互模型 (Dual-Zone Action Model)**：
   - **一级文字区域**：点击进行双向平滑折叠/展开切换（180ms 缓动），同时无缝联动跳转至对应分类的 Dashboard 页面（如 `/desk/stock-and-inventory`）。
   - **一级右侧独立小箭头**：28x28px 放大热区带悬停微底色，点击纯粹执行展开/收起手风琴动画，绝不跳转路由。
   - **二级单据菜单**：纯粹进行单页应用 (SPA) 路由切换，**绝对不触发任何折叠/收起**，所属的一级分类始终稳固展开。
3. **全局默认路由**：
   - 系统根路径 `/`、`/app`、`/desk` 统一默认进入总控主页 `/desk/my-business`。

## 🌟 企业级工作台 (Workbench) 页面与单证排版规范

1. **控制栏 36px 严格统一高度**：
   - 页面顶部控制栏内所有元素（年月选择器、公司输入框、操作按钮）高度统一设为 `36px`，基线完全对齐。
2. **1:1 复刻中国企业标准单证 (Excel & Print)**：
   - 详细单证采用 8 列等宽网格排版，字体统一使用等线/微软雅黑，左右与底部外框使用 Medium 粗边框，内部 Thin 细边框；
   - 导出单公司拆分为「水电费」与「房租物业」独立 Sheet；
   - 表头第 3 行统一展示为「所属期: YYYY-MM    物业公司: ...」；
   - 水电费汇总表右侧大字合并单元格（20pt 粗/大字体）。
3. **【4个以内选项原则 (Segmented Tabs > Dropdown)】**：
   - 当表单、弹窗或筛选器中字段的备选项在 **4 个以内（含 2~4 个选项）** 时，**坚决禁止**使用默认折叠的下拉菜单（`<select>`）；
   - **必须优先采用单次点击即生效的分段选项卡 / 胶囊单选卡片组（Segmented Tabs / Pill Toggle Chips）**；
   - **人机工效依据**：下拉菜单需要“展开+寻址+点选”共 2 次点击且隐藏上下文；分段选项卡全平铺，**1 次点击即达**，直观高效，大幅降低认知负荷与操作摩擦力。
4. **原生防拦截下载**：
   - 导出 Excel 文件统一采用动态原生链接触发方式，避免被浏览器拦截。
5. **统一 UI 设计系统与组件复用库**：
   - 详见 `.agents/rules/ui_design_system_and_component_library.md`（包含 5 步流水线任务卡片、4 列 KPI 卡、防抖 Tab 导航、5 大逻辑分组表头与动态视口锁定的完整 HTML/CSS 代码模板）。
6. **业务模块完整设计哲学**：
   - 详见 `docs/ai/ASHAN_APP_MODULES_AND_DESIGN_GUIDE.md`。

## 1. UI 技术选择

按复杂度逐级选择：

```text
原生 Form / List / Report
↓
Form Script / Dialog
↓
Desk Page
↓
Vue in Desk Page
↓
Frappe UI / 独立复杂前端
```

不要从 Vue 开始。

先判断工作流。

## 2. 原生优先

如果 ERPNext 已经提供：

- Form
- List
- Grid
- Report
- Workspace
- Dialog
- Timeline
- Attachments
- Comments
- Submit / Cancel
- Permission

优先使用这些能力。

自定义 UI 应该是因为业务工作方式不同，而不是为了“看起来像 SaaS”。

## 3. 现代 UI 的定义

推荐：

```text
清楚
数据优先
低视觉噪音
状态明确
容易快速扫描
可以核对依据
操作结果可见
```

避免：

```text
大面积渐变
玻璃效果
过多阴影
每个字段一个卡片
无意义图表
巨大的空白
五个同等级主按钮
只为了效果的动画
```

## 4. 页面结构

推荐：

```text
页面身份
状态
主操作

核心数据

需要用户判断的结果

依据 / evidence

详情

次要操作
```

## 5. 主操作

一个页面通常只保留一个明显的 Primary Action。

例如 AI 发票页面：

```text
[运行匹配]
```

次要：

```text
刷新
打开发票
打开入库单
重新计算
取消
```

不可逆操作要有确认。

## 6. 表格优先于卡片堆叠

ERP 业务通常更适合表格。

例如：

```text
入库单 | 日期 | 供应商 | 金额 | 物料匹配 | 数量匹配 | 可信度 | 状态
```

不要把每一列改成独立卡片。

## 7. AI 结果必须可解释

AI 页面至少显示：

```text
推荐对象
confidence
匹配依据
冲突项
候选项
源单据
人工操作
```

示例：

```text
推荐入库单
MAT-PRE-2026-00118

可信度
94%

依据
供应商       完全一致
金额         完全一致
物料         8/8
数量         7/8
日期差       3 天

冲突
ITEM-003 数量差 1

[打开入库单] [拒绝] [确认关联]
```

## 8. 财务 / 库存 AI UX

默认：

```text
AI 推荐
↓
用户查看
↓
服务器重新验证
↓
ERPNext 执行
```

不要：

```text
AI 猜测
↓
浏览器直接写数据库
```

## 9. Loading / Empty / Error

每个异步区域都应该有：

```text
Idle
Loading
Success
Empty
Error
Retry
```

不要点击按钮后页面没有任何反馈。

## 10. 错误信息

差：

```text
Error
```

好：

```text
无法加载 Purchase Receipt 候选项。

发票
PINV-2026-0012

原因
当前用户没有 Purchase Receipt 读取权限。

[重试]
```

用户 UI 不显示不必要的 Secret 或完整 traceback。

## 11. Desk Page 适用场景

适合：

- 发票匹配中心
- 对账中心
- 批量审批
- 异常处理
- 跨 DocType 审核
- 导入复核
- AI 建议工作台

基础：

```javascript
frappe.pages["invoice-ai"].on_page_load = function(wrapper) {
    const page = frappe.ui.make_app_page({
        parent: wrapper,
        title: __("Invoice AI"),
        single_column: true,
    });

    page.set_primary_action(__("Run AI Match"), () => {
        run_match();
    });
};
```

## 12. Vue 适用场景

当页面需要大量 reactive state：

- 当前发票
- 多候选入库单
- 筛选
- 分页
- AI evidence
- 多步骤确认
- Background Job 进度
- Retry 状态
- 批量勾选

再使用 Vue。

## 13. Frappe UI

Frappe UI 更适合大型 Vue 前端。

不要假设所有 Desk 页面天然全局存在 `frappe-ui` 组件。

按项目 bundling 配置使用。

## 14. v16 Navigation

v16 引入 persistent sidebar 和 Workspace Sidebar。

原则：

- 不自己重画 ERPNext 全局导航
- 不把旧 `/app` 路由写死
- 优先使用 `frappe.set_route`
- 检查实际 v16 Site 路由
- 自定义 App 的 Workspace / Apps 展示按 v16 官方机制配置

## 15. v16 JS Scope

Reports / Dashboard Charts / Pages 的 JS 在 v16 改为 IIFE 执行。

避免依赖隐式全局变量。

确需全局：

```javascript
window.my_app = window.my_app || {};
```

## 16. 性能

不要一次把几千条 ERPNext Document 全部拉进浏览器。

使用：

```text
服务器过滤
分页
只请求需要字段
background job
渐进加载
```

## 17. 官方设计资料

```text
Page API
https://docs.frappe.io/framework/user/en/api/page

Vue inside Desk
https://docs.frappe.io/framework/using-vue-inside-a-desk-page

Frappe UI
https://ui.frappe.io/docs/introduction

Frappe Design
https://frappe.io/design

Espresso Design System
https://frappe.io/design/espresso

v16 Migration
https://github.com/frappe/frappe/wiki/Migrating-to-version-16
```
