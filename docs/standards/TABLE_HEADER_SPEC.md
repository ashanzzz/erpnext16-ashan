# 阿山工控表格标准表头顺序与列布局规范
**文档版本**: v1.0.0  
**适用范围**: ERPNext 16 采购、报销、仓储、人事、财务及所有自定义工作台表格  
**核心哲学**: 严格眼动流对齐、8 阶段结构化布局、强类型像素锁死、全生命周期责任人溯源  

---

## 一、 核心设计哲学与 8 阶段认知眼动流

在工控与财务核算系统中，数据表格不仅是展示组件，更是**高频决策、批量操作与责任审计的工作台**。  
用户查阅表格时的视线移动遵循从左到右的自然流向。全系统所有数据表格必须统一划分为以下 **8 个标准功能区阶梯**，严禁各页面各自为政：

```
[1. 控制锚定] ➔ [2. 业务护照] ➔ [3. 时效状态] ➔ [4. 往来主体] ➔ [5. 弹性内容] ➔ [6. 财务核算] ➔ [7. 链路追溯] ➔ [8. 责任审计与动作]
```

### 核心布局准则：固定长度绝对定宽 vs 动态长文本弹性吸收
1. **固定长度列（强类型像素锁死）**：
   - 多选框 (`√`)、序号 (`#`)、所属公司、单据编号、发票号码、单据日期、单据状态、物料项数、单位、制单人、操作列，由于其内容字符长度恒定（如发票号码为 20 位纯数字锁定 180px、日期为 10 位、状态为 2~4 字、姓名 2~4 字），**必须全部采用纯定宽 px 原子类锁死**，严禁设为百分比或由浏览器自动计算拉伸，保证在任何屏幕下视觉排版雷打不动；
2. **发票号码列宽规范 (`.col-w-bill-no` / `.col-w-invoice-no`)**：
   - 宽度锁死 `180px !important; min-width: 180px !important; max-width: 185px !important;`（专为中国 20 位数电发票和传统发票代码+号码设计，等宽左对齐，彻底杜绝尾部截断）；
3. **选项卡圆角与间距规范 (`.picker-nav-tabs-wrap`)**：
   - 顶部流程选项卡容器必须独立成卡，外壳采用 `9px` 圆角 (`border-radius: 9px !important`)，并与下方筛选栏保持 `margin-bottom: 7~10px` 的舒适呼吸间距，严禁紧挨粘连；
4. **动态视口高度自适应引擎 (`AshanUI.adjustViewportHeight`)**：
   - 表格滚动容器必须根据浏览器视口高度动态流式计算 (`height: window.innerHeight - topOffset - 22px`)，并在 resize 时自动重算，彻底消除页面外层纵向滚动条；
5. **页面平滑切换与就地静默刷新铁律 (Smooth Page Transition & Zero-Flash UI)**：
   - 用户严禁在切页面、切工作台时出现全屏黑屏遮罩或抽空白屏跳闪；
   - 切换到已渲染页面时，严禁使用 `$container.empty()`、`$bar.empty()` 或 `$tbody.empty()` 暴力抽空 DOM 造成视口塌陷白屏；
   - 必须保留视觉骨架与上一屏数据，在后台静默请求接口，拿到数据后就地无感平滑置换，达到桌面原生 App 级丝滑；
   - 公共工作台核心资源必须在系统启动时静默预加载，严防切页面触发 Frappe 原生全屏黑遮罩 `frappe.dom.freeze()`。
6. **动态/长文本列（空间弹性吸收海绵）**：
   - 单据明细、物料名称、业务备注等变长文本，必须设为 `.col-w-fluid`（`width: auto !important; min-width: 220px !important;`）；
   - 该列负责吸收屏幕剩余的全部空白空间，严禁使用 `width: 100% !important` 强行挤压邻近列。
7. **AI 增设字段与表头治理先行法**：
   - 任何新增表头必须先查 `FIELD_NAMING_TAXONOMY.md` 词典；有则无条件复用，无则新增并锁死 1-to-1 中英文法定绑定，杜绝同义异名。

---

## 二、 标准表头 8 阶段详细定义与排布铁律

| 阶段序号 | 功能区名称 | 包含列名示例 | CSS 原子类 / 标准宽度 | 对齐方式 | 冻结 / 吸附属性 | 核心设计意图与说明 |
| :---: | :--- | :--- | :--- | :---: | :---: | :--- |
| **第 1 区** | **控制锚定区**<br>(Controls) | **#** (序号)<br>**√** (多选框) | `.col-w-seq` (44px)<br>`.col-w-check` (40px) | 居中 | `sticky` 冻结<br>(第 1 列 left:0, 第 2 列 left:44px) | **物理定位与批量入口**：序号提供唯一的行坐标（便于口头沟通“第几行”）；复选框用于批量提交、整算、删除操作。 |
| **第 2 区** | **业务护照区**<br>(Identity) | **所属公司**<br>**单据编号** | `.col-w-company-badge` (72px)<br>`.col-w-docname` (135px) | 公司居中<br>单号居左 | 单号可选 sticky<br>(流式或吸附) | **唯一法定业务标识**：在祺富/吉众双法人架构下，公司是第一归属要素；单据号是全局唯一流水号，强制使用 `font-mono` 等宽字体并支持穿透。 |
| **第 3 区** | **时效状态区**<br>(State & Time) | **单据日期**<br>**单据状态** | `.col-w-date` (108px)<br>`.col-w-status` (88px) | 居中 | 流式 static | **业务生命周期**：日期固定为 10 位 `YYYY-MM-DD`；状态采用工业胶囊徽章（草稿/待批/已提交/已关闭/已作废），直观展示单据流转阶段。 |
| **第 4 区** | **往来主体区**<br>(Business Party) | **供应商 / 往来主体**<br>*(可选: 部门/仓库)* | `.col-w-supplier` (150~180px)<br>`.col-w-warehouse` (110~130px) | 居左 | 流式 static | **业务对接实体**：标明与哪家单位或内部哪个部门发生经济往来，文本溢出采用省略号截断（Tooltip 提示全称）。 |
| **第 5 区** | **空间弹性区**<br>(Fluid Sponge) | **单据明细 / 物料名称 / 备注** | `.col-w-fluid`<br>(`width: auto !important; min-width: 220px !important;`) | 居左 | 流式 static | **全屏唯一空间吸收海绵**：整行必须有且仅有这一列吸收屏幕所有多余空白，彻底锁定其他所有定长列不被拉伸，杜绝表格留白均分缺陷。 |
| **第 6 区** | **财务量化区**<br>(Financials) | **项数 / 数量 / 单位**<br>**单价 / 税率 / 税额**<br>**总金额 / 待付金额** | `.col-w-item-count` (75px)<br>`.col-w-qty` (85~95px)<br>`.col-w-rate` (100px)<br>`.col-w-money` (110~130px) | 数值强等宽<br>**一律右对齐** | 流式 static | **严谨对账与核算**：所有数字、价格、金额强制 `font-mono`，表头文字与数据行必须垂直咬合，金额列可适度加粗。 |
| **第 7 区** | **全链路追溯区**<br>(Lineage) | **关联采购订单**<br>**关联入库单 / 关联发票**<br>**关联整算单 / 关联付款单** | `.col-w-linked-doc`<br>(130px ~ 140px) | 居中或居左 | 流式 static | **穿透溯源闭环**：单据全链路流转上下游关联单号，点击可弹出下级明细或跳转官方 Desk 原生表单。 |
| **第 8 区** | **责任审计与操作区**<br>(Audit & Actions) | **制单人**<br>**操作** (台账/编辑/删除) | `.col-w-user` (90~100px)<br>`.col-w-action` (80~100px) | 制单人居中/居左<br>操作居中 | 靠右流式<br>或右侧 sticky | **全生命周期责任归属与动作闭环**：每张表必须明确标明“谁做的这个表”；操作列提供台账穿透或单据生命周期动作。 |

---

## 三、 “制单人”全量强制入表规约 (Accountability Standards)

根据阿山业务管理与内控审计要求：**所有业务单据与工作台表格必须显式包含制单人列，明确数据责任人。**

### 1. 制单人定义与角色边界
- **制单人 (Created By / Owner)**：
  - 定义：在系统内首次创建该单据、录入明细并提交的系统操作人；
  - 对应 ERPNext 字段：`doc.owner`；
  - 表头统一命名：**“制单人”**（特定发票场景可为“录单人”，特定收货场景可为“收货员/制单人”）。
- **经手人 / 申请人 (Applicant / Handler)**：
  - 定义：实际在线下发生业务开支、出差、采购申请的具体员工；
  - 对应 ERPNext 字段：`doc.applicant` 或 `doc.contact_person`；
  - 在报销或采购整算场景中，“申请人”属于**第 4 区（往来主体区）**，“制单人”属于**第 8 区（责任审计区）**，两者各司其职，杜绝混淆。

### 2. 真实姓名转换铁律 (No Naked Emails)
- **展示规则**：严禁在表格界面直接裸露内部系统邮箱（如禁止直接渲染 `ashanzzz1213@gmail.com` 或 `user@ashan.com`）；
- **全名映射**：后端 SQL 或前端渲染时，必须通过 `frappe.user_info(owner).fullname` 或 `tabUser.full_name` 解析为真实中文姓名（如“孟祥山”、“米庆菊”、“刘丽艳”、“陈亮”）；若无可解析姓名，则提取邮箱前缀字母。

### 3. 列宽与样式标准
- 原子类：`.col-w-user`；
- 宽度：`width: 90px !important; min-width: 90px !important; max-width: 100px !important;`；
- 对齐：`text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`。

---

## 四、 7 大核心工作台标准表头顺序映射对照表

### 1. 物料申请工作台 (`material-request-workbench`)
- **单据汇总视图 (Doc View)**：
  1. `#` (44px) ➔ 2. `√` (40px) ➔ 3. `所属公司` (72px) ➔ 4. `申请单号` (135px) ➔ 5. `申请日期` (108px) ➔ 6. `单据状态` (88px) ➔ 7. `单据明细` (fluid 吸收) ➔ 8. `物料项数` (75px) ➔ 9. `申请总数` (85px) ➔ 10. `预估总额` (100px) ➔ 11. `制单人` (90px) ➔ 12. `操作` (80px)
- **物料明细视图 (Item View)**：
  1. `#` ➔ 2. `√` ➔ 3. `所属公司` ➔ 4. `申请单号` ➔ 5. `申请日期` ➔ 6. `单据状态` ➔ 7. `物料代码` ➔ 8. `物料名称` (fluid) ➔ 9. `规格型号` ➔ 10. `申请数量` ➔ 11. `单位` ➔ 12. `价格` ➔ 13. `金额` ➔ 14. `备注` ➔ 15. `制单人` ➔ 16. `操作`

### 2. 采购执行工作台 (`procurement-execution-workbench`)
- **单据汇总视图 (Doc View)**：
  1. `#` ➔ 2. `√` ➔ 3. `所属公司` ➔ 4. `采购订单号` (135px) ➔ 5. `订单日期` (108px) ➔ 6. `单据状态` (88px) ➔ 7. `供应商` (160px) ➔ 8. `单据明细` (fluid 吸收) ➔ 9. `采购项数` ➔ 10. `采购总数` ➔ 11. `订单总额` ➔ 12. `关联入库单` ➔ 13. `制单人` (90px) ➔ 14. `操作`

### 3. 收货入库工作台 (`material-receipt-workbench`)
- **单据汇总视图 (Doc View)**：
  1. `#` ➔ 2. `√` ➔ 3. `所属公司` (72px) ➔ 4. `入库单号` (135px) ➔ 5. `过账日期` (108px) ➔ 6. `单据状态` (88px) ➔ 7. `供应商` (160px) ➔ 8. `收货仓库` (120px) ➔ 9. `单据明细` (fluid 吸收) ➔ 10. `入库项数` ➔ 11. `实收总数` ➔ 12. `入库总额` ➔ 13. `关联订单` ➔ 14. `关联发票` ➔ 15. `制单人` (90px) ➔ 16. `操作`

### 4. 采购合同工作台 (`contract-workbench`)
- **合同总览视图**：
  1. `#` (44px) ➔ 2. `单据编号` (135px) ➔ 3. `单据日期` (108px) ➔ 4. `单据状态` (88px) ➔ 5. `往来主体` (160px) ➔ 6. `合同类别` (120px) ➔ 7. `单据明细 / 合同标题` (fluid 吸收) ➔ 8. `合同总额` ➔ 9. `已整算金额` ➔ 10. `实际已付款` ➔ 11. `待付金额` ➔ 12. `分期里程碑规划` (320px) ➔ 13. `制单人` (90px) ➔ 14. `操作` (100px)

### 5. 月结补录工作台 (`monthly-settlement-picker`)
- **补录单据明细视图**：
  1. `#` ➔ 2. `√` ➔ 3. `所属公司` (72px) ➔ 4. `入库单号` (135px) ➔ 5. `入库日期` (108px) ➔ 6. `开票状态` (88px) ➔ 7. `供应商` (160px) ➔ 8. `物料代码` ➔ 9. `物料名称` (fluid 吸收) ➔ 10. `规格型号` ➔ 11. `入库数量` ➔ 12. `单位` ➔ 13. `价格` ➔ 14. `金额` ➔ 15. `入库仓库` ➔ 16. `关联发票` ➔ 17. `制单人` (90px) ➔ 18. `操作`

### 6. 自办电汇工作台 (`wire-transfer-picker`)
- **电汇发票汇总视图 (Doc View)**：
  1. `#` ➔ 2. `√` ➔ 3. `所属公司` (72px) ➔ 4. `单据编号` (135px) ➔ 5. `单据日期` (108px) ➔ 6. `单据状态` (88px) ➔ 7. `往来主体` (160px) ➔ 8. `发票号码` (130px) ➔ 9. `票据类型` (90px) ➔ 10. `单据明细` (fluid 吸收) ➔ 11. `单据总额` ➔ 12. `待付金额` ➔ 13. `关联付款单` ➔ 14. `制单人` (90px) ➔ 15. `操作`

### 7. 报销申请工作台 (`reimbursement-picker`)
- **报销单据汇总视图 (Doc View)**：
  1. `#` ➔ 2. `√` ➔ 3. `所属公司` (72px) ➔ 4. `报销单号` (135px) ➔ 5. `单据日期` (108px) ➔ 6. `单据状态` (88px) ➔ 7. `供应商 / 费用对象` (160px) ➔ 8. `报销申请人` (90px) ➔ 9. `单据明细 / 事由` (fluid 吸收) ➔ 10. `报销总额` ➔ 11. `待付金额` ➔ 12. `关联采购发票` ➔ 13. `制单人` (90px) ➔ 14. `操作`

---

## 五、 CSS 原子类速查表 (Class Reference)

```css
/* 1. 控制区 */
.col-w-seq           { width: 44px !important; min-width: 44px !important; max-width: 44px !important; text-align: center; }
.col-w-check         { width: 40px !important; min-width: 40px !important; max-width: 40px !important; text-align: center; }

/* 2. 身份区 */
.col-w-company-badge { width: 72px !important; min-width: 72px !important; max-width: 72px !important; text-align: center; white-space: nowrap; }
.col-w-docname       { width: 135px !important; min-width: 130px !important; max-width: 140px !important; font-family: var(--ashan-font-mono, monospace); text-align: left; }

/* 3. 状态时效区 */
.col-w-date          { width: 108px !important; min-width: 108px !important; max-width: 108px !important; text-align: center; font-family: var(--ashan-font-mono, monospace); }
.col-w-status        { width: 88px !important; min-width: 88px !important; max-width: 88px !important; text-align: center; }

/* 4. 主体与物料区 */
.col-w-supplier      { width: 160px !important; min-width: 140px !important; max-width: 200px !important; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-w-item-code     { width: 120px !important; min-width: 110px !important; font-family: var(--ashan-font-mono, monospace); }
.col-w-uom           { width: 68px !important; min-width: 68px !important; max-width: 76px !important; text-align: center; }

/* 5. 唯一流式空间吸收列 */
.col-w-fluid         { width: auto !important; min-width: 220px !important; max-width: none !important; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* 6. 财务与量化区 (强等宽右对齐) */
.col-w-item-count    { width: 75px !important; min-width: 70px !important; text-align: center; font-family: var(--ashan-font-mono, monospace); }
.col-w-qty           { width: 90px !important; min-width: 85px !important; text-align: right; font-family: var(--ashan-font-mono, monospace); }
.col-w-rate          { width: 100px !important; min-width: 95px !important; text-align: right; font-family: var(--ashan-font-mono, monospace); }
.col-w-money         { width: 115px !important; min-width: 105px !important; text-align: right; font-weight: 700; font-family: var(--ashan-font-mono, monospace); }

/* 7. 追溯区 */
.col-w-linked-doc    { width: 135px !important; min-width: 125px !important; font-family: var(--ashan-font-mono, monospace); text-align: left; }

/* 8. 审计与操作区 */
.col-w-user          { width: 90px !important; min-width: 90px !important; max-width: 105px !important; text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.col-w-action        { width: 90px !important; min-width: 80px !important; text-align: center; }
```

---

## 六、 落实与执行纪律 (Execution Contract)

1. **新增与重构表格默认依循**：后续任何新增工作台（如资产折旧、薪酬核算、危废环保申报等）或对旧表格的重构，必须无条件遵循本 8 阶段标准顺序；
2. **表头文本对齐规则**：
   - 序号、选框、公司、日期、状态、单位、制单人、操作：**强制居中对齐**；
   - 单号、物料代码、供应商、仓库、明细、备注：**强制居左对齐**；
   - 数量、单价、税率、税额、各级金额：**强制居右对齐**（表头与数据行垂直强咬合）。
3. **两权分立验收标准**：独立验收 BOT 在审查表格时，必须按本规范核验表头顺序与“制单人”存在性，凡缺失制单人或顺序逆乱者直接出具 FAIL 报告打回整改。
