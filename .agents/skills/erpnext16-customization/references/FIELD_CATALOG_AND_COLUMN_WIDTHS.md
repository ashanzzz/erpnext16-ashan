# 字段、列标题与列宽目录

本目录只记录已确认的正式字段、界面标题和布局原则。它不是“见到中文就能猜字段名”的字典：每次写入或读取前，仍必须核验目标 DocType metadata、当前服务层和权限范围。

## 1. 标题与字段的命名纪律

- 用户界面使用简洁中文标题；后端使用正式 fieldname，不在 UI 直接展示 `custom_*`。
- 不新增装饰性 Emoji，尤其不得新增 `🐣`。状态名应是“草稿”“已核验”“待上传”“金额不符”等事实文本。
- `序号` 是当前表格的视图索引，不等于数据库 `name`；`单据编号` 才映射 `name`。
- `规格` 唯一正式映射为原生 `description`，字段类型为单行 `Data`。禁止创建、回填或把常规业务读写迁移到 `custom_guige_xinghao`、`custom_spec_model`、`custom_specification` 等重复规格字段。
- `备注` 必须区分来源：业务子表/发票物料使用 `custom_备注`；GL Entry 使用 `remarks`。禁止臆造 `custom_beizhu`。
- 空值保持空白，不写入“正常”“无”“系统生成”等伪业务内容；枚举默认值只有在当前字段定义明确要求时才可写入。

## 2. 通用工作台/单据列表字段

| 界面标题 | 正式字段或来源 | 用途 | 列宽策略 |
| --- | --- | --- | --- |
| 序号 | 视图索引 | 行定位 | 固定 44px |
| 状态 | `docstatus` + 业务状态字段 | 显示草稿/提交/核验/锁定等 | 84–96px，文字标签不折行 |
| 单据编号 | `name` | 单据定位和进入详情 | 110–140px |
| 所属公司 | `company` | 公司权限和归属 | 180–240px，允许扩展 |
| 单据日期 | `posting_date` | 业务发生日期 | 104–118px |
| 所属期 | 具体模块期间字段 | 月结/申报/凭证范围 | 100–116px；先核验实际 fieldname |
| 业务模式 | `custom_biz_mode` | 采购、报销、电汇、月结等流程归类 | 112–132px |
| 单据明细 | `custom_doc_details` | 系统从子表生成的可读摘要 | 最小 260px，优先伸缩 |
| 操作 | 不落库 | 详情、下载、受控删除等 | 96–120px，固定在右端 |

`custom_biz_mode` 与 `custom_doc_details` 已用于 Material Request、Purchase Order、Purchase Receipt、Purchase Invoice、Reimbursement Request。前者为“业务模式”选择项，后者为只读 Small Text 且由系统汇总；读写时仍须确认当前站点已经迁移到该结构。

## 3. 采购、报销与发票明细字段

| 界面标题 | 正式字段 | 列宽策略 | 备注 |
| --- | --- | --- | --- |
| 物料编码 | `item_code` | 110–130px | 短编码，紧凑但完整可辨 |
| 物料名称 | `item_name` | 最小 200px，弹性扩展 | 高语义文本列，优先占余量 |
| 规格 | `description` | 最小 240px，弹性扩展 | 唯一正式规格字段，标签固定为“规格” |
| 单位 | `uom` | 70–88px | 不折行 |
| 数量 | `qty` | 88–104px | 等宽数字、右对齐 |
| 单价 | `rate` | 112–128px | 金额格式化、右对齐 |
| 不含税金额 | `amount` / 当前单据实际字段 | 118–136px | 使用前核验单据字段语义 |
| 税率 | 当前税率字段 | 76–92px | 百分数右对齐 |
| 税额 | 当前税额字段 | 112–128px | 金额格式化 |
| 价税合计 | 当前含税合计字段 | 120–144px | 金额格式化、可作为关键总计 |
| 供应商 | `supplier` / `supplier_name` | 180–240px，弹性 | 名称比短代码优先展示 |
| 发票号码 | `invoice_no` | 160–200px | 长号码不截断，不显示真实敏感数据于不必要界面 |
| 发票类型 | `custom_fapiao_leixing` | 112–132px | 先核验所属 DocType；2–4 项使用分段控件 |
| 备注 | `custom_备注` 或 `remarks` | 最小 280px，弹性优先 | 根据数据来源二选一，不猜字段 |

报销发票子表已有 `item_name`、`description`、`qty`、`uom`、`rate`、`amount`、`invoice_no`、`supplier`、`source_pi`、`source_pi_item` 等字段。阅读或改动列表时，优先保持这些经过属性设置收紧后的只读/来源关系。

## 4. 车辆与薪酬已确认字段

| DocType/范围 | 界面标题 | 正式字段 | 规则 |
| --- | --- | --- | --- |
| Vehicle | 车辆状态 | `custom_vehicle_status` | `正常在用` / `封存停用`；封存后从相关选择池隐藏 |
| Vehicle | 主要驾驶员 | `custom_primary_driver` | 与高速费/台账联动 |
| Vehicle | 车辆备注/用途 | `custom_vehicle_remark` | 高语义文本，Web 最小 240px、Excel 适度加宽 |
| Vehicle | 默认/上次加油油号 | `custom_default_fuel_grade` | 自动记忆，可人工修改 |
| 员工薪酬档案 | 社保缴费基数方式 | `social_security_base_mode` | `最低缴费基数` 或 `自定义`；来源状态需明显区分 |
| 员工薪酬档案 | 自定义社保缴费基数 | `custom_social_security_base` | 只有“自定义”时生效，白底人工例外 |

公积金长期策略、长期基数、当月例外等字段以当前薪酬档案 metadata 与服务端策略为准；它们遵循“本月例外 > 员工长期策略 > 公司规则”的优先级，不能只靠界面默认值判断。

## 5. 历史兼容字段的处理

代码库可能仍出现 `custom_spec_model`、`custom_item_spec`、`custom_line_remark`、`custom_tax_rate`、`custom_tax_amount`、`custom_total_amount` 等历史兼容分支。它们不是新功能的字段白名单：

1. 不创建，不以它们作为默认写入目标，不按中文标签猜测它们。
2. 仅在现有兼容服务的 metadata 探测为真时读取，且不改变正式 `description`/备注字段的语义。
3. 清理或迁移时逐项审计历史数据和业务影响，不能批量覆盖。

## 6. 列宽实现规则

- 上表的像素是**列最小安全宽度/区间**，不是整个容器的固定宽度。页面、弹窗和表格外层仍使用 `minmax`、`clamp`、Flex/Grid 或视口计算流式布局。
- 文本列设置 `min-width` 后应可得到剩余空间；数值列使用 `white-space: nowrap; font-variant-numeric: tabular-nums; text-align: right`。
- 10 列以上表格按固定标识列 + 弹性文本列 + 紧凑数值列排列，并启用冻结、顶部同步滚动和滚轮转横向。
- Excel 另按 `EXCEL_PRINT_ENGINEERING.md` 配置列宽和打印区域，不复制 Web 的弹性规则。

