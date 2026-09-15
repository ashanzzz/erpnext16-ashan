# 当前代码 UI 与后端审计

上一版治理方向正确，但对当前代码不够具体。V2 按实际仓库分成三类。

## 继续作为标准复用
`ashan_ui_kit.css/js` 是共享 UI 基座。不要再建平行 common utils。

`authorization_service.py` 已收敛自定义模块角色和公司范围。不要回到 Page 内硬编码角色。

## 推荐的域级模式
采购 Page 已把多个页面收敛到 `procurement_workbench.js/css`，Page 只做加载和 profile mount。这是推荐的域内复用方式。

采购后端用标准 ERPNext permission、stage capability 和 company scope，也是合理模式，因为 Purchase Order 等属于标准 DocType。

## 明确的历史迁移对象
油卡 JS 仍有本地 `formatMoney()`、inline style、Emoji、自己的账期和按钮体系。

油卡 Python 已使用统一 oil/company authorization，这是正确方向，但仍有重复 manager/system-admin helper 和个别 `ignore_permissions=True`。

新 AI 不得复制这些旧模式。改旧代码采用增量收敛，不做无关整页重写。

## 最终目标
统一的不是每个页面外形完全相同，而是：
- 同等级按钮
- 同类型状态
- 金额数量格式
- 表格扫描逻辑
- Dialog 行为
- Loading/Empty/Error
- 权限反馈
- 服务端 company/permission
- mutation 生命周期

不同模块仍保留自己的业务结构。
