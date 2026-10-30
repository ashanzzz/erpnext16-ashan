# ERPNext 16 业务操作系统 (ashan_cn_procurement)

当前唯一维护仓库为 `ashanzzz/erpnext16-ashan`，默认分支为 `main`。  
旧仓库 `ashanzzz/erpnext-private-customizations` 已归档，仅用于历史追溯，不再接收代码更新。

本项目是基于 Frappe Framework 与 ERPNext 16 构建的企业级全流程业务定制应用，承载**天津吉众科技有限公司**与**天津祺富机械加工有限公司**的双工厂核心业务运营体系。

---

## 一、 架构原则与工程约束

1. **核心定制代码边界**：
   - 所有业务逻辑、自定义单据模型、工作台页面、报表与钩子，**严格收敛在 `ashan_cn_procurement` App 目录内**。
   - 严禁直接修改 Frappe 或 ERPNext 官方源码；标准单据扩展优先使用 Hooks、Server Script、Client Script 或 DocType 继承覆写。
2. **多工厂与数据隔离**：
   - 系统原生支持吉众与祺富双主体账目隔离与合并统计；
   - 统一由 `services/authorization_service.py` 在服务端执行公司权限范围裁定（Company Scope Enforcement），杜绝越权访问。
3. **CI/CD 与容器化构建闭环**：
   - 业务源码仓库（本仓库）：`https://github.com/ashanzzz/erpnext16-ashan`
   - 构建镜像仓库：`https://github.com/ashanzzz/docker`（`.github/workflows/erpnext16-single-container-aio.yml`）
   - 构建时由 CI 自动拉取本仓库 `main` 分支代码编译注入至 `ghcr.io/ashanzzz/erpnext16:latest` 容器镜像。
   - 生产环境运行于 Unraid 宿主机（`192.168.8.11`，WebUI 映射端口 `6888`，Desk 入口地址 `/desk`）。

---

## 二、 完整项目目录结构

```text
erpnext16-ashan/
├── ashan_cn_procurement/                      # 核心业务 App 目录 (Frappe App Root)
│   ├── pyproject.toml                         # Python 依赖与包构建定义
│   ├── setup.py                               # setuptools 安装脚本
│   ├── README.md                              # App 模块概览说明
│   ├── ui_style_baseline.json                 # UI 样式基线配置与合规标准
│   └── ashan_cn_procurement/                  # App 核心代码包 (Package Root)
│       ├── __init__.py
│       ├── hooks.py                           # App 全局钩子、资源挂载与事件监听
│       ├── modules.txt                        # Frappe 模块声明 (Ashan CN Procurement)
│       ├── patches.txt                        # 数据库补丁执行序列清单
│       ├── boot.py                            # 启动上下文注入与 Desk 引导逻辑
│       ├── payroll_engine.py                  # 双工厂薪资精准计算引擎核心
│       ├── custom/                            # 标准单据自定义属性与脚本配置
│       │   ├── client_script/                 # 客户端脚本配置
│       │   ├── server_script/                 # 服务端脚本配置
│       │   ├── reimbursement_invoice_item.json# 报销发票明细属性注入
│       │   └── reimbursement_request.json     # 报销申请单属性注入
│       ├── fixtures/                          # 核心 UI 块与全局挂载组件
│       │   ├── custom_html_block.html         # 双区折叠导航侧边栏 HTML 模板
│       │   ├── custom_html_block.css          # 侧边栏与工作台通用样式
│       │   ├── custom_html_block.js           # 侧边栏动态 DOM 注入与 SPA 路由劫持
│       │   └── custom_html_block.json         # Frappe Custom HTML Block 导出元数据
│       ├── overrides/                         # 标准 ERPNext 核心行为覆写
│       │   ├── document_details.py            # 单据详情扩展与业务日期支持
│       │   ├── procurement_closing.py         # 采购结案控制与发票状态流转
│       │   ├── purchase_invoice_tax.py        # 中国式采购发票明细行含税/反算引擎
│       │   └── vehicle_sync.py                # 车辆台账与加油记录实时联动
│       ├── parser/                            # 外部发票结构化解析引擎
│       │   ├── common.py                      # 解析器抽象基类与格式化工具
│       │   ├── xml_parser.py                  # 数电发票 XML 结构全量提取
│       │   └── pdf_parser.py                  # 数电发票 PDF 版式智能抽取
│       ├── patches/                           # 历史版本数据库迁移补丁 (v1_0 至 v1_8)
│       ├── public/                            # 全局共享前端资产
│       │   ├── css/
│       │   │   ├── ashan_cn_procurement.css   # App 全局通用基础样式
│       │   │   ├── ashan_ui_kit.css           # 统一设计系统组件库 (AshanUI)
│       │   │   └── procurement_workbench.css  # 采购工作台专属响应式样式
│       │   └── js/
│       │       ├── ashan_ui_kit.js            # 统一前端工具集 (AshanUI 核心库)
│       │       ├── ashan_procurement_entry.js # 采购业务统一入口挂载脚本
│       │       └── procurement_workbench.js   # 采购多阶段共享工作台运行时
│       ├── reimbursement/                     # 报销核心业务子服务与单元测试
│       ├── services/                          # 业务逻辑服务层 (46 个业务服务模块)
│       │   ├── authorization_service.py       # 统一权限模型与工厂作用域裁定
│       │   ├── jizhong_payroll_service.py     # 吉众现场/计件/考勤薪资核算
│       │   ├── employee_salary_service.py     # 员工薪酬档案与基数管理
│       │   ├── housing_fund_policy_service.py # 公积金政策基数与跨月核算
│       │   ├── procurement_picker_service.py  # 采购申请/收货/发票跨单据拾取
│       │   ├── property_settlement.py         # 厂房租赁/仪表抄表/水电公摊结算
│       │   ├── tax_invoice_import.py          # 数电发票批量导入与映射
│       │   └── ...
│       ├── translations/                      # 中文本地化词典
│       │   └── zh.csv                         # 采购、财务、薪酬及合规中文翻译
│       └── ashan_cn_procurement/              # Frappe 模块元数据注册目录
│           ├── doctype/                       # 55 个自定义 DocType 模型
│           ├── page/                          # 22 个专属交互工作台 (Page / Workbench)
│           ├── report/                        # 15 个业务审计与对账报表 (Script Report)
│           ├── workspace/                     # 7 个专属业务工作区 (Workspace)
│           └── workspace_sidebar/             # 9 个导航侧边栏布局定义 (JSON)
├── docs/                                      # 项目架构设计、规划与开发规范文档
│   ├── ai/                                    # AI 架构审计、设计原则与上下文
│   ├── plans/                                 # 历史演进方案、交付路线与设计说明
│   └── standards/                             # 治理基准、边界定义与单据规范
├── scripts/                                   # 自动化部署、数据同步与治理验证脚本
│   ├── verify_ai_architecture_governance.py   # AI 架构与代码规范拦截卫士 (CI/Pre-commit)
│   ├── sync_and_migrate.py                    # 生产环境一键同步与 bench migrate
│   ├── run_ai_guards.py                       # 静态代码治理守卫集合
│   └── ...
├── tests/                                     # 单元测试与端到端验收用例
├── .agents/                                   # AI 代理协作规范、执行契约与分工规则
├── .githooks/                                 # Git 提交与推送安全校验钩子
├── AGENTS.md                                  # AI 编码指导与禁止操作约束
├── PROJECT_MAP.md                             # 核心仓库、容器、端口与网络拓扑映射
├── PROJECT_STATUS.md                          # 项目里程碑与开发进展状态
├── CHANGELOG.md                               # 项目历史变更记录
├── erpnext16_figma_tokens.json                # 设计系统设计令牌
├── *.svg                                      # 核心业务看板架构矢量图
└── README.md                                  # 本全局说明文档
```

---

## 三、 八大业务功能板块

系统聚焦于离散制造双工厂的核心管理场景，划分为 8 大业务域：

### 1. 采购与报销操作系统 (Procurement & Reimbursement)
- **多单据中国式改造**：采购申请（Material Request）、采购订单（Purchase Order）、采购入库（Purchase Receipt）与采购发票（Purchase Invoice）全面汉化，引入行级含税反算、税率自由配置与规格型号独立列。
- **跨单据智能拾取**：通过 `reimbursement_picker` 与 `wire_transfer_picker` 实现采购发票、费用单据向报销申请、电汇付款凭据的快速无缝勾稽。
- **核心模型**：`reimbursement_request`、`reimbursement_invoice_item`、`reimbursement_source_reservation`。

### 2. 车油与通行管理 (Vehicle, Fuel & Toll Management)
- **油卡全生命周期管控**：管理中石化/中石油主卡与分卡，支持一主多副预分配资金池。
- **优惠自动摊销**：充值优惠（如充 4000 送 200）采用 FIFO 原则在加油与发票开具时后台自动分摊，前台无需手动折算。
- **通行费与押金管理**：支持高速 ETC、通行费月结对账单、押金台账与跨期清算。
- **核心模型**：`oil_card`、`oil_card_recharge`、`oil_card_refuel_log`、`oil_card_invoice_batch`、`vehicle_toll_config`、`vehicle_toll_deposit`、`vehicle_toll_monthly_sheet`。

### 3. 人事薪资、考勤与社保公积金 (HR Payroll & Social Security)
- **双工厂差异化核算**：
  - **祺富**：涵盖白班/夜班、辅助工种（打沙/卫生/检验/送货/维修）出勤核算、单人计件统计与餐补结算。
  - **吉众**：现场倒班、外协调度、质量检验工时考勤与离退休固定扣税。
- **社保公积金自动化对账**：严格落实“当月工资对次月实缴”规则，支持跨月调整、封存名单管理及政策基数自动校验。
- **核心模型**：`ashan_employee_salary_profile`、`jizhong_employee_salary_profile`、`ashan_monthly_attendance`、`jizhong_monthly_attendance`、`ashan_payroll_settlement`、`ashan_housing_fund_monthly_override`、`ashan_insurance_setting`。

### 4. 物业、仪表与租赁结算 (Property & Lease Management)
- **厂区租赁合同**：支持多租户合同起止期、固定租金、阶梯租金与免租期规则。
- **仪表与公摊计费**：水电表抄表记录、变压器损耗公摊、单价阶梯核算与月度结算单生成。
- **核心模型**：`property_lease`、`property_lease_charge`、`property_meter_reading`、`utility_meter`、`property_monthly_settlement`、`property_charge_rate`。

### 5. 公司合规与特种设备 (Compliance & Special Equipment)
- **特种设备全生命周期**：行车、叉车、压力容器、锅炉等特种设备台账、定检周期排期、检验报告与隐患排查。
- **人员证书与环保资质**：焊工证、电工证、特种设备操作证到期提前 30/60 天预警；排污许可证与环保检测台账穿透监管。
- **核心模型**：`special_equipment`、`special_equipment_inspection`、`special_equipment_annual_inspection`、`compliance_equipment_item`、`employee_certificate_item`、`environmental_compliance_item`。

### 6. 税务发票与进项管理 (Tax Invoice Management)
- **数电发票全格式支持**：内置 XML 与 PDF 专用解析器，一键批量解析并提取发票号码、税率、价税合计、销方信息与明细条目。
- **自动对账与三单闭环**：通过 `tax_invoice_matcher` 实现发票与采购入库单、报销单的自动匹配，无票账单严格标记并校验管理依据。
- **核心模型**：`tax_invoice`、`tax_invoice_item`、`tax_invoice_import_batch`、`tax_invoice_company_mapping`、`tax_invoice_settings`、`monthly_invoice_closing`。

### 7. 库存与物料领发 (Stock & Inventory)
- **极速流水与物料账**：支持车间易耗品、生产原材料（清洗剂、乐泰胶水、随行卡、防护用品等）实时结存。
- **领发料工作台**：告别复杂的多层嵌套，通过 `stock_issue_workbench` 与 `stock_ledger_workbench` 快速录入车间出入库流水。

### 8. 权限控制组体系 (Restricted Access Groups)
- **基于场景的数据脱敏**：针对财务核心账、采购机密价、薪资名册设立独立受限单据组。
- **轻量级受限授权**：通过用户与角色映射白名单控制单据行级可见性，不破坏标准 Frappe 角色体系。
- **核心模型**：`restricted_access_group`、`restricted_access_group_role`、`restricted_access_group_user`。

---

## 四、 核心资产明细汇总

### 1. 工作区 (Workspaces - 共 7 个)
| 工作区标识 | 名称 | 业务涵盖范围 |
| :--- | :--- | :--- |
| `my_business` | 个人业务台账 | 快捷待办、个人报销、快速录入与日常任务看板 |
| `procurement_management` | 采购与报销管理 | 采购申请、采购订单、入库检验、采购发票与费用报销 |
| `accounting_and_finance` | 财务与核对中心 | 薪酬结算、发票导入、银行对账、付款勾稽与税费汇总 |
| `vehicle_fuel_hub` | 车油与通行中心 | 加油流水、油卡充值、车队油耗、ETC 通行与押金对账 |
| `property_and_lease` | 物业与租赁结算 | 厂房租赁、水电抄表、公摊结算、餐费结算与合同台账 |
| `company_compliance_center` | 公司合规中心 | 特种设备定检、人员资质证书、环保检测与年检预警 |
| `stock_and_inventory` | 库存与物料中心 | 领发料工作台、出入库动态流水、物料台账与盘点清册 |

### 2. 交互工作台 (Pages / Workbenches - 共 22 个)
- **采购与供应链**：`material_request_workbench`、`procurement_execution_workbench`、`material_receipt_workbench`、`reimbursement_picker`、`wire_transfer_picker`
- **人事薪酬**：`qifu_hr_salary_workbench`、`jizhong_hr_salary_workbench`、`employee_salary_workbench`、`payroll_settlement_workbench`
- **车油与通行**：`oil_card_ledger`、`vehicle_toll_ledger`
- **物业与资产**：`property_settlement_workbench`、`lease_settlement_workbench`、`meal_settlement_workbench`、`contract_workbench`
- **合规与特设**：`special_equipment_center`、`environmental_management`
- **税务与结算**：`tax_invoice_center`、`monthly_closing_center`、`monthly_settlement_picker`
- **库存与发料**：`stock_issue_workbench`、`stock_ledger_workbench`

### 3. 统计与审计报表 (Script Reports - 共 15 个)
- **车油与通行**：`oil_card_operating_summary`、`oil_card_monthly_ledger`、`oil_card_balance_reconciliation`、`oil_card_card_summary`、`oil_card_recharge_ledger`、`oil_supplier_invoice_summary`、`vehicle_fuel_cost_summary`、`vehicle_monthly_fuel_trend`、`vehicle_refuel_ledger`
- **合规中心**：`company_compliance_overview`、`company_compliance_pending_purchase`、`compliance_expiry_trend`
- **财务与报销**：`unpaid_reimbursement_list`、`reimbursement_payment_status`
- **物业结算**：`property_settlement_history`

---

## 五、 前端设计系统规范 (AshanUI)

为确保企业级交互的高效、严谨与一致性，前端界面遵循统一规范：

1. **共享组件与工具库**：
   - 全局核心样式收敛于 `public/css/ashan_ui_kit.css`，提供语义化 Badge、卡片布局、标准金额对齐及状态颜色。
   - 前端逻辑统一调用 `AshanUI`（`public/js/ashan_ui_kit.js`），严禁在业务页面中私自重复定义 `formatMoney`、状态计算或日期控件。
2. **纯净企业风格（严禁装饰性 Emoji）**：
   - 遵从代码审查铁律，界面、按钮、Tab 标签及单据描述严禁使用任何装饰性 Emoji，保持纯文本严谨专业。
3. **无缝双区侧边栏与 SPA 路由保护**：
   - 通过 `custom_html_block` 组件挂载在 Desk 侧边栏，支持 7 大核心业务板块折叠展开与记忆状态持久化（`localStorage`）。
   - 彻底解决 Frappe 单页面应用路由切换时侧边栏意外丢失的问题。

---

## 六、 常用运维与验证命令

```bash
# 1. 运行 AI 架构合规与代码规范检查 (提交前必跑，必须 0 blocking violations)
python3 scripts/verify_ai_architecture_governance.py

# 2. 运行单据与服务层单元测试
python3 -m unittest discover ashan_cn_procurement/ashan_cn_procurement/tests

# 3. 触发代码向运行容器同步并执行数据库迁移
python3 scripts/sync_and_migrate.py

# 4. 检查容器运行状态与最新错误日志
python3 scripts/check_status.py
```
