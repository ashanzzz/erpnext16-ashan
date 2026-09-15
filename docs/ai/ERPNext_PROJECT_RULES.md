# ERPNext PROJECT RULES

> 本文件保存当前 ERPNext 项目的真实业务约定。
>
> AI 不得自行发明字段名。遇到未记录的字段，先检查当前 DocType metadata、custom app 源码或实际 Site。

## 1. 目标版本

```text
ERPNext 16
Frappe Framework 16
```

实际修改前仍需运行：

```bash
bench version
bench --site <site> list-apps
```

如果实际环境不是 v16，不得静默按 v16 强行修改。

## 2. 总体开发原则

- ERPNext 是核心业务系统。
- 新增正式功能优先进入 custom app。
- 默认不直接修改 `apps/frappe` 和 `apps/erpnext`。
- 长期业务逻辑不堆在临时 Client Script。
- 前端负责交互，服务器负责业务完整性。
- 对标准 ERPNext 单据的提交、取消、库存、总账行为必须使用标准业务流程。

## 3. 已确认的自定义字段

### 物料说明

本项目不使用独立“规格型号”字段。物料、采购订单、采购收货、采购发票、物料需求计划和报销明细统一使用 `description`。

```text
description 的字段类型统一为 Data（单行文本），界面标签统一为“规格”。
不得创建、读取或回填 custom_guige_xinghao、custom_spec_model 等规格型号字段。
```

### 备注

业务子表 / 发票物料中：

```text
custom_备注
```

GL Entry：

```text
remarks
```

禁止自行假设存在：

```text
custom_beizhu
```

### 已出现的其他自定义字段

```text
custom_biz_mode
custom_fapiao_leixing
```

使用前仍要检查实际 DocType metadata 和当前代码，确认字段所属 DocType。

## 4. 字段读取原则

任何自定义字段：

```text
先读 metadata / 当前项目代码
再使用
```

禁止：

```text
看到中文“规格型号”就自己猜 custom_guige_xinghao、custom_spec_model 或 custom_specification
看到中文“备注”就自己猜 custom_beizhu
```

## 5. Purchase Receipt

正式逻辑涉及：

```text
Purchase Receipt
Purchase Receipt Item
```

如果读取已提交入库单：

```text
docstatus = 1
```

涉及 billed amount、退货、取消、修改已提交行时，必须检查 ERPNext v16 对应 Controller 和数据模型。

## 6. Purchase Invoice

正式逻辑涉及：

```text
Purchase Invoice
Purchase Invoice Item
```

AI 匹配入库单时：

1. 可以推荐候选 Purchase Receipt。
2. 可以计算供应商、物料、规格、数量、单价、金额、日期等匹配依据。
3. 前端不能把 AI 结果直接当作最终财务事实。
4. 确认执行前，后端重新加载 ERPNext Document。
5. 后端重新检查权限、docstatus、供应商、金额和行项目。
6. 最终使用 ERPNext 标准 Document / Controller 流程。

## 7. AI 发票识别 / 匹配建议输出

推荐保留：

```text
发票号码
发票日期
发票类型
供应商
金额
税额
价税合计
车船税
明细物料
规格型号
数量
单价
金额
候选入库单
匹配度
匹配依据
冲突
```

如果 AI 不确定：

```text
明确标记需要人工确认
```

不要静默填入猜测值。

## 8. Secret

ERPNext API Secret / Token：

```text
不得进入浏览器 JS
不得进入 Git
不得进入 public asset
不得进入 localStorage
```

服务器端集成从安全配置中读取。

## 9. 权限

不要用以下方式修复普通权限错误：

```python
ignore_permissions=True
frappe.get_all(...)
```

先确认：

```text
调用用户是谁
需要什么 Role
哪个 DocType Permission 不足
是否需要专用 Integration User
```

## 10. 财务和库存

默认禁止 AI 直接：

```text
修改 GL Entry
修改 Stock Ledger Entry
修改已提交库存数量
修改已提交会计关键金额
跳过标准 submit/cancel
用 SQL 模拟 ERPNext 会计过账
```

需要扩展这些流程时，先读 v16 标准 ERPNext Controller。

## 11. UI 使用习惯

优先：

```text
清楚
数据密度合理
少装饰
按钮位置明确
状态就地显示
错误就在对应模块显示
```

不要把保存 / 测试结果只显示在用户看不到的页面顶部。

对于独立配置区块：

```text
保存结果
测试结果
错误
连接状态
```

应优先显示在对应配置区块附近。

## 12. 页面层级

优先：

```text
ERPNext 原生 Form/List
↓
Form Script / Dialog
↓
Desk Page
↓
Vue/Frappe UI
```

不要把普通 ERPNext 表单重写成独立前端。

## 13. AI 开发交付

每次改动报告：

```text
修改文件
影响 DocType
新增 hooks
新增 API
权限变化
需要运行的 bench 命令
测试结果
财务/库存影响
```

如果需要操作生产环境，必须基于实际部署方式给命令，不得凭空假设 Supervisor、Docker 或其他运行方式。

## 14. 核心业务扩展模块与设计规范记忆

本项目核心 App `ashan_cn_procurement` 涵盖四大业务板块，完整设计哲学与数据流详见 `docs/ai/ASHAN_APP_MODULES_AND_DESIGN_GUIDE.md`：

1. **🏢 物业与租赁 (Property & Lease)**：
   - 多周期租金自动折算（日/月/年，标准 365 天）；
   - 房租含物业与独立物业费双模式；
   - 工业水电表高压倍率与公司间电费分摊调整；
   - Excel 导出 1:1 双 Sheet 拆分（`{公司}水电费` + `{公司}房租物业`），第 3 行统一为「所属期」，水电表去名称留表号。
2. **🚗 车辆和车用油管理 (Vehicle & Fuel)**：
   - 车辆档案、油卡档案、油卡充值流水与加油能耗台账。
3. **🛡️ 企业合规中心 (Compliance)**：
   - 特种设备档案与法定检验预警、环保台账、员工特种作业资质证照。
4. **💰 中国税控与采购发票 (China Tax & Procurement)**：
   - 物料规格统一使用 `description`（单行 Data，标签“规格”）；
   - 采购发票中国增值税税率双向反算与报销管理。

## 15. 统一月份与日期范围选择器规范 (UI Standard)

项目全域页面（工作台、报表、台账）涉及期间选择时必须遵循 `.agents/rules/ui_month_and_date_picker_standard.md`：
1. **月份选择器**：统一采用胶囊 `[ ◀ 上月 ] [ YYYY-MM ] [ 下月 ▶ ] [ 🔄 刷新数据 ]`；
2. **日期范围选择器**：统一采用 `[ 快捷标签: 本月/上月/本季度/本年 ] [ 起止日期 ] [ 🔍 查询 ]`；
3. **防跳月规则**：当前月份未核定封账时禁止跳往下一月份，允许自由回看上一月份；
4. **备考纯净原则**：系统不得私自注入默认字（如系统核定、一口价、正常等），无值保持空白 `""`。

