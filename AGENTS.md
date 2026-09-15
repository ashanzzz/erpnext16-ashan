# ERPNext 16 全局开发哲学与用户核心中心思想总纲 (Supreme Core Mental Model & Global Philosophy)

## AI 架构治理 V2 强制入口

任何 AI 在生成或修改代码前，必须先读取 `AI_PROJECT_INSTRUCTIONS.md` 和 `.agents/ai-governance.json`，并按其中 canonical rules 读取前端、按钮、表格、弹窗、模块、后端权限、API 与冲突规范。

新代码不得继续复制历史页面中的本地金额 formatter、inline style、装饰 Emoji、重复角色判断、普通 `ignore_permissions=True`、普通 `frappe.db.commit()` 或直接写 GL/Stock Ledger 的模式。

完成前必须运行 `python scripts/verify_ai_architecture_governance.py` 和现有 UI style governance 检查。

本总纲保留核心业务原则，但任何 AI 在生成或修改代码前，必须同时读取以下规范：

1. `PROJECT_MAP.md`
2. `AI_PROJECT_INSTRUCTIONS.md`
3. `.agents/ai-governance.json`
4. `.agents/rules/00_ai_execution_contract.md`
5. `.agents/rules/01_repository_current_state.md`
6. `.agents/rules/10_frontend_component_reuse_contract.md`
7. `.agents/rules/11_button_and_action_standard.md`
8. `.agents/rules/12_table_and_ledger_standard.md`
9. `.agents/rules/13_dialog_and_form_standard.md`
10. `.agents/rules/14_module_ui_standard.md`
11. `.agents/rules/20_backend_service_permission_standard.md`
12. `.agents/rules/21_api_action_contract.md`
13. `.agents/rules/30_current_code_reuse_catalog.md`
14. `.agents/rules/change_conflict_prevention.md`
15. `docs/ai/FEATURE_IMPLEMENTATION_CONTRACT_TEMPLATE.md`

当历史 UI 示例、固定像素、旧组件习惯或旧实现方式与安全、权限、Frappe 生命周期、可访问性、数据完整性发生冲突时，以安全、权限、数据完整性和上述架构规范为准。

任何非简单功能必须先确定页面类型、复用项、前后端契约、权限、事务、冲突文件和测试，再生成代码。禁止只根据当前页面外观继续堆叠新的 CSS、组件或 API。

> **⚠️ 核心最高原则**：本项目的所有开发、重构、UI 设计与前后端架构，必须无条件深度贯彻本总纲。
> **💡 动态核心思想**：**所有铁律必须完全动态自适应，绝不死板硬编码！** 人数、金额、人员结构、分类比例、账期月份与凭证数据，必须根据实际业务发生与上传文件**动态计算、动态核验、动态呈现**！文档中出现的数字仅为当前账期实例，系统必须在任意人数、任意企业、任意月份下具备完全自适应的动态处理能力！

---

## 🌟 用户的四大核心中心思想支柱 (The 4 Pillars of Core Philosophy)

### 🏛️ 第一支柱：动态业务权责边界纯净化、四柱守恒与财务凭证严肃性 (Dynamic Financial Integrity & Boundary Purity)

1. **业务权责边界绝对纯净化与动态隔离 (Boundary Purity & Dynamic Isolation)**：
   - 每个模块、表格、台账严格只承载其权责范围内的纯净数据，绝不概念混淆或强塞异构数据；
   - **局部台账/外部实发表**：严格只动态包含当期实际发生出勤与发薪/领用的实体集合，非当前范围人员或项目系统自动动态识别并隔离过滤，绝不混入局部明细；
   - **全员母表底册**：完整承载全公司当期全部在册员工/全局物料；
   - **法定汇算与月度综合结算**：完整动态汇算全公司全部在册人员/综合成本，保障企业法定合规与综合支出的一致性。

2. **四柱清册与闭式守恒会计模型 (Four-Pillar Conservation Law & Accounting Integrity)**：
   - 无论是物料库存、资金现金流、往来应收应付、油卡额度、还是企业用工成本，任何维度的流水台账与明细穿透必须满足四柱守恒闭环：
     $$\text{期初结转} + \text{本期流入 (增加)} - \text{本期流出 (减少)} = \text{期末结余}$$
   - **首行必须显式呈现【上期结转 (期初)】**（展示期初记账时间与期初结存基数）；
   - **中间行按业务发生时序倒序排列明细流水**；
   - **末尾行必须显式呈现【本期发生合计与期末结余 (实物/资金守恒平账)】**；
   - 严禁孤立罗列流水而不交代期初与期末的闭式平账关系。

3. **业务流向二元化与主体角色严格对齐 (Dual Flow & Clear Entity Roles)**：
   - 任何交易流转，输入/流入（正向/增加，如入库、收入、借方）与 输出/流出（负向/扣减，如出库、支出、贷方）在列头、色彩（绿色加号 `+` vs 琥珀/红色减号 `-`）、穿透单据主体（供货来源/供应商 vs 领用去向/领料人）上必须泾渭分明；
   - 绝不使用模糊通用的列名，严禁反向单据套用正向单据角色（如严禁把入库单的目标收货仓误标为发货仓）。

4. **法定计量与货币表达规范 (Strict Measurement & Currency Standards)**：
   - 数值绝不孤立展示，数量必须强带法定主计量单位（如 `72.00 Nos` / `42.00 个`），金额必须强带货币符号与千分位（`¥ #,##0.00`），等宽靠右排版，绝不出现无量纲的光秃秃数字。

5. **在册用工结构与纯净分类体系 (5大标准分类与0工资动态感知)**：
   - 彻底解耦五险一金绑定标签，按法定与用工性质纯净划分为 5 大类：正式工、退休返聘人员、临时工、其他类型员工、本月离职人员；
   - 任务中枢副标题动态呈现：`系统计薪 {N_sys}人 ｜ 外部实发计薪 {N_ext}人 ｜ 0工资 {N_zero}人`。

6. **个税 VBA 1:1 精准对齐与闭式反推算法 (VBA 1:1 Tax Engine)**：
   - 核心反推函数 `derive_gross_from_net_vba()`：根据 7 级累计预扣闭式反推算法，与 Excel VBA 算法达到 100% 吻合、0.00 元误差；
   - 动态累计基本减除费用（5,000 元/月），完整贯通 7 项专项附加扣除。

7. **原始凭证神圣不可篡改与交付纯净源文件**：
   - **原始凭证无损归档**：原始实发表（.xlsx/.xls）、税务局社保申报表（PDF）、公积金凭证（ZIP/PDF）上传后必须原汁原味保存原始二进制文件流；
   - **自动解压与交付纯净源文件**：上传 ZIP 压缩包时，系统必须在后台自动解压并仅提取内部真正的 PDF 凭证，下载时直接交付规范命名的纯净 PDF；
   - 统一规范中文命名法则：`{期间月份}_{企业名称}_{凭证类型}_原始凭证.{ext}`。

8. **铁的财务纪律与前置动态强拦截机制**：
   - 前置任务未全部齐备前，绝对禁止最终核定封账；
   - 点击核定时实时动态校验，缺失条件时弹出清单式警示；封账后全局只读保护，反审核必须登记原因并可审计追溯。

9. **薪酬核算月与法定缴费月双时钟（社保、公积金必守）**：
   - `工资核算月 P` 与 `实际缴费/凭证所属月 P + 1` 严格分离；
   - 公积金季度规则（1/4/7/10）必须以 `P + 1` 判定；
   - 社保大额医疗救助金（基准22元 vs 特殊21元）的生效月份判定，必须严格以实际缴费/凭证所属月 `P + 1` 判定，保证社保台账与税局实际缴费申报凭证完全对齐。
   - 任务中枢顶部必须同时明确展示：`核定账期: {P} ｜ 社保账期: {P+1}`。

10. **多企业薪酬体系绝对隔离铁律（祺富 vs 吉众 100% 物理、模型与表单双不通用）**：
    - **两家公司业务哲学异构，表单完全不通用**：祺富（天津市祺富汽车配件有限公司）与吉众（天津吉众科技有限公司）的考勤模式、工时逻辑、薪酬计算公式、五险一金费率与配钞点钞彻底不同，两家公司的薪酬相关表单、工作台与算薪引擎**绝对不通用，严禁任何形式的混用、过度抽象或强行统一！**
    - **祺富薪酬体系（Qifu HR）**：
      - 导航入口：【祺富人事薪酬与用工】 -> 【祺富人事薪酬工作台】（`qifu-hr-salary-workbench`）；
      - 核心模型：法定五险一金汇算、车间实发表核对与导入、68 列全员大宽表、四柱守恒企业综合用工成本台账、税局社保公积金原始申报凭证解压归档。
    - **吉众薪酬体系（Jizhong HR）**：
      - 导航入口：【吉众人事薪酬与用工】 -> 【吉众人事薪酬工作台】（`jizhong-hr-salary-workbench`）；
      - 核心模型：标准 5 行月度 Excel 结构化打卡表（班次、作业时间、加班时间、餐补、备注）、倒休工时二倍抵扣闭环算法、双基准工时模型（动态法定工作日 $\times 8.0\text{h}$ vs 固定平均 $172.0\text{h}$）、管理岗税后工资 1:1 VBA 闭式倒推、五档现金配钞点钞（RoundUp 向上取整至元 + 100/50/10/5/1元贪心拆分）、421 条全量历史底册穿透。
    - **全架构隔离底线**：
      - 侧边栏导航：严格独立分为【祺富人事薪酬与用工】与【吉众人事薪酬与用工】两组；
      - 底层数据：`Ashan Monthly Attendance`、`Ashan Monthly Payroll Settlement`、`Ashan Employee Salary Profile` 必须显式携带 `company` 物理过滤隔离，严禁无公司约束的跨主体交叉查询；
      - 业务逻辑：各自维持专属业务流程与 UI 视图，绝不破坏各自独立性。

---

### 🎨 第二支柱：体系化设计语言、高信息密度与人机工程美学 (UI Design Logic & Ergonomics)

1. **单层语义化复合表头与极致冻结窗口 (Single-tier Dual-line Freeze Panes)**：
   - 采用单层 `th` 复合设计（Dual-line Header Badges），上方为逻辑分组小胶囊（9px/600字重），下方为主标题（12px/700字重），彻底杜绝原生多层表头在缩放与横向滚动时造成的冻结列脱轨缺陷；
   - 语义化冻结体系：序号列（`.qifu-col-sticky-1`）、编码列（`.qifu-col-sticky-2`）、名称列（`.qifu-col-sticky-3`）、底部合计行（`.qifu-col-sticky-foot`），末尾冻结列配置微立体渐变投影。

2. **动态视口锁定大宽表高度与零垂直滚动条 (Zero Outer Vertical Scroll)**：
   - 通过 `adjust_active_table_height()` 动态计算视口高度，将横向滚动条永久常驻贴合在当前屏幕视口底沿；
   - 表头与顶部辅助滚动条挂载滚轮事件，滑轮拨动平滑转换为横向左右滚动，表格内容行保持原生垂直滚动。

3. **动态视口流式响应与弹性约束哲学 (Fluid & Dynamic Viewport Adaptive Architecture)**：
   - 严禁使用固定死板的 `px` 宽度，必须采用弹性约束（Fluid Clamp & Minmax）：
     - 弹窗宽度：`width: min(94vw, 1400px); max-width: 95vw; margin: 1.25rem auto;`；
     - 弹窗高度：主体内容区 `max-height: calc(88vh - 120px); overflow-y: auto;`；
     - 列宽弹性分配：固定标识列紧凑最小安全宽度，文本列弹性伸缩（`flex: 1`），数值列等宽靠右永不折行。

4. **原位闭环与极速直接生效哲学 (In-Place Action & Direct Submit by Default)**：
   - **看账即办单，拒绝繁琐跳转**：在查看台账、看板或明细穿透的任何位置，用户若需要发起业务动作（出库、报销、调拨、付款、领料、审批），系统必须在当前视口直接提供轻量录单通道，自动携带当前上下文（物料/账户/公司/可用结存/默认仓位），只让用户录入最核心变量，杜绝要求用户跨页面跳转繁琐的原生表单；
   - **默认直接提交生效**：针对日常高频业务，系统默认提供“提交即过账生效”模式（`default: 1` ☑），一键直接生成已过账（Submitted, `docstatus = 1`）的正式凭证并实时更新台账与结余，极大缩短业务链条；同时保留草稿模式满足特殊需要。

5. **多维快捷切换与零抖动局部微更新 (In-Place Micro-Update & Zero Page Reload)**：
   - 所有的筛选切换（期间快捷点选、仓库点选、分类点选）或单据提交后，严禁整页刷新、销毁重建整个弹窗或让页面滚动跳动；
   - 仅对数据区域（`tbody`、`tfoot`、KPI 卡片）执行微量局部更新，实现桌面级丝滑体验。

6. **零降级 UI 特效深度性能优化标准 (Zero-Degradation High-Performance Rendering Standard)**：
   - **严禁粗暴削减视觉特效**：绝不可为了所谓“性能”而降低设计语言标准（如粗暴去除磨砂玻璃模糊 `backdrop-filter: blur`、微立体渐变、微投影、圆角）；
   - **底层渲染管线与 GPU 独立硬件合成层加速**：
     - 为全屏遮罩与模态弹窗配置 `contain: strict;` 或 `contain: layout style;`，配合 `will-change: opacity, transform;` 与 `transform: translate3d(0, 0, 0);`，强制由独立显卡 GPU 显存纹理层执行硬件插值光栅化，杜绝 CPU 软件光栅化逐帧重绘（Paint Thrashing）；
   - **渲染时序与任务解耦 (rAF Scheduling)**：
     - 打开弹窗时，使用 `window.requestAnimationFrame()` 将首帧动画与数据网络请求/DOM 构建解耦；首帧纯 GPU 极速推开弹窗框架，次帧平滑灌入数据，确保 60fps/120fps 满帧展开。

7. **弹窗防误触与显式双安全出口标准 (Modal Anti-Misclick & Explicit Dual-Exit Navigation)**：
   - **防误触背景拦截**：所有录单、编辑与审批弹窗必须配置 `backdrop: "static"`（或 `static: true`），禁止因误触背景导致数据丢失；
   - **显式双重安全退出通道**：右上角必须常驻醒目的 `✕` 关闭按钮（悬浮微红反馈），底部操作栏必须显式配置【`✕ 取消`】或【`✕ 关闭`】次级按钮；
   - **安全退出自动暂存**：用户退出时已录入数据自动同步完成草稿缓存。

8. **全场景实时自动保存与草稿恢复引擎 (Bulletproof Auto-Save & Draft Engine)**：
   - 字符键入（防抖 150ms）、单元格失焦、结构化增删行均实时自动保存；离开页面前同步写入 `localStorage`；重新打开时完整恢复。

9. **现代分段控件与全生命周期状态梯队排序铁律 (Modern Segmented Control & 3-Tier Lifecycle Sorting)**：
   - 固定 2~4 个互斥状态优先采用分段控件（`.ashan-segmented-control`），实现单手极速点选；
   - **全工作台状态梯队排序原则**：
     - **第一梯队（置顶）**：`🟡 待提交草稿`（`Draft`）——永远置顶于主列表最上方，高亮提醒优先处理；
     - **第二梯队（中间）**：进行中的待收货、待开票、待付款、待审核等活跃单据——按业务日期倒序排列；
     - **第三梯队（沉底）**：`✅ 已完成`、`✅ 已付款 / 已结清`、`🔒 已关闭`、`⚪ 已作废`——自动沉底至列表最后方，避免历史归档数据冲淡或干扰当前活跃业务。

10. **企业级 Autocomplete 选单与新建浮层标准 (Enterprise Suggest Dropdown & Fast Creation Standard)**：
    - 统一采用高质感浮层体系，双行高密度呈现代码、全称、规格与单价，底部常驻快捷新建入口。

11. **表格数据列纯净化与杜绝无谓卡片药丸包裹铁律 (Pure Tabular Data & Zero-Badge Clutter Standard)**：
    - **常规数值度量列严禁套用药丸卡片**：表格中的常规数值度量列（如可用库存、单价、出库量、结余、单重等）必须以**纯粹的【数字 + 法定计量单位】（如 `590.00 Nos` / `400.00 Kg` / `¥ 1,250.00`）等宽靠右排版（`tabular-nums`）**呈现，绝不给每一行数值数据套上带边框、带背景底色的“小药丸/小卡片（Badge/Pill/Card）”；
    - **胶囊徽标严格受限**：药丸/徽标仅用于表示互斥的**核心单据生命周期状态**（如 `草稿` / `已过账` / `已作废` / `待审核`）；
    - **彻底根除“盒子套盒子”与视觉噪点**：消除多余的边框与底色包裹，保障大宽表横向视线扫描的平滑性、高信息密度与纯净严肃的专业财务/仓储台账美学；
    - **交互动作静默化**：如需支持点击快捷填满或单据穿透，使用纯文字悬浮手型/微下划线反馈，绝不用粗暴的按钮/卡片包围破坏整体排版。

12. **禁止非状态 Emoji 铁律 (Zero Decorative Emoji Standard)**：
    - **严禁任何装饰性 Emoji**：标题（工作台主标题、任务中枢、子模块标题）、导航 Tab 选项卡、卡片、统计指标名称、工具栏按钮、表头文字、弹窗标题等处，一律严禁使用装饰性 Emoji（如 📋, 👥, 📤, 🛡️, 🏛️, ⚖️, 📊, 🗂️, 🏢, 👤, ⚙️, ⚡, ➕, 📥, 🖨️, 🧮, 🔄 等）；
    - **唯一例外场景：明确的状态指示灯**：仅允许使用表达业务流转和单据状态的状态指示灯（如 🟢 核验通过、🔴 失败错误、🟡 处理中/待核验、⛔ 异常阻断、🔒 封账锁定、📝 草稿等）；
    - 确保系统呈现严肃、克制、高专业度的企业财务与工业管理视觉质感。

---

### ⚙️ 第三支柱：清晰架构、原生优先与代码规范 (Clean Architecture & Code Style)

1. **Python 服务层规范**：
   - 遵循 PEP 8 标准，函数必须具备明确的 docstring 与清晰的入参校验；
   - 正常文档写入优先使用 `doc.save(ignore_permissions=True)` 或 `doc.insert()`，保证完整生命周期；
   - 数据修改类 RPC 强制使用 POST 请求，显式声明 `@frappe.whitelist(methods=["POST"])`；
   - 数据库查询必须显式加 `order_by` 排序，杜绝顺序不确定性；
   - 复杂计算前后使用 Python `ast.parse()` 进行静态语法安全自检。

2. **前端 JavaScript / CSS 规范**：
   - 严禁全局变量污染，统一在页面闭包中管理状态；
   - 金额格式化统一调用 `fmtMoney(val)`（输出 `¥ #,##0.00`），金额单元格统一添加 `.qifu-money-cell` 保持等宽靠右排版；
   - 模态弹窗统一使用标准 `frappe.ui.Dialog` 或体系化 Modal，关闭时安全清理 DOM。

3. **自定义模块权限底线：一个模块只保留管理员 / 操作员两级**：
   - 所有新建或改造中的自定义业务模块必须在 `services/authorization_service.py` 的 `MODULE_ACCESS_MODEL` 中声明唯一角色对：
     - 薪酬：`Payroll Manager` / `Payroll Operator`；
     - 油卡与车辆：`Oil Card Manager` / `Oil Card Operator`；
     - 合规与特种设备：`Compliance Manager` / `Compliance Operator`；
     - 物业与租赁：`Property Manager` / `Property Operator`；
     - 税局发票：`Tax Invoice Manager` / `Tax Invoice Operator`。
   - `System Manager` / `Administrator` 是平台级全局管理身份，不算模块的第三种业务角色；通用业务角色不得自动获得自定义模块权限；
   - 操作员承担日常录入、导入、计算、导出与解锁申请；管理员额外承担配置、删除、月度封账和解锁审批；
   - 页面入口（`Page.roles`）、DocType 权限（`DocPerm`）和服务端 RPC 三层同时收口，凡带 `company` 的操作必须调用 `assert_company_access()`。

4. **前端设计系统、复用与内联样式零增长**：
   - 全局视觉令牌和共享组件唯一入口为 `public/css/ashan_ui_kit.css`，新代码**禁止新增** HTML `style=`；
   - 每次前端交付必须运行 `python scripts/verify_ui_style_governance.py`（以 `ui_style_baseline.json` 为上限，只减不增）。

5. **生产迁移与验收的额外底线**：
   - `scripts/sync_and_migrate.py` 输出“完成”不等于迁移成功，必须以实际 `migrate` 退出码 `0` 为准；
   - 禁止修改 Frappe/ERPNext 核心源码，所有业务定制沉淀于 `ashan_cn_procurement`。

6. **环境安全与数据脱敏铁律**：
   - 严禁在源码中硬编码密码/Token，统一从 `.env` 读取；真实员工敏感信息严禁提交至 Git 仓库。

7. **严格禁止无授权 Emoji 铁律 (Zero-Emoji Standard)**：
   - 在系统界面文本、表单标签、按钮文字、提示信息、代码注释以及交流回复中，除非用户明确要求，一律严禁使用任何 emoji 图标；保持严肃、严谨、纯净的企业级财务与工程界面风格。

---

### 🚀 第四支柱：交付铁律：Playwright 自动化实机验收闭环 (Zero-Guessing Automated Verification Standard)

1. **绝对禁止仅凭模型记忆猜测**：所有功能、接口与 UI 修改必须经过实机代码验证；
2. **热同步与迁移闭环**：任何改动必须执行本地到 Docker 容器热同步与迁移（`python scripts/sync_and_migrate.py`）；
3. **Playwright 实机验证与全景截图**：
   - 编写并运行 Playwright 自动化测试脚本；
   - 真实访问 Desk 界面、测试点击与弹窗交互、排查浏览器 Console 报错与网络请求；
   - 截取完整全景图进行视觉与逻辑自检；
4. **100% 无报错后汇报**：确认 100% 运行无误、控制台 0 报错后才向用户汇报并提交 Git 推送。

---

## 📚 常用指令与自动化工具速查 (Command & Tool Cheatsheet)

| 操作目标 | 命令 / 脚本 | 说明 |
| :--- | :--- | :--- |
| **代码热同步与迁移** | `python scripts/sync_and_migrate.py` | 同步代码到容器、执行 migrate、清除缓存并重启服务 |
| **样式治理门禁检查** | `python scripts/verify_ui_style_governance.py` | 确保 0 新增内联样式，内联样式总数低于基线上限 |
| **吉众薪酬工作台验收**| `python scripts/verify_jizhong_live_playwright.py` | Playwright 实机测试吉众薪酬工作台、确认表与宽表滚动 |
| **个税功能回归测试** | `python test_china_tax_integration.py` | 验证 7 级预扣税率与 VBA 闭式倒推 1:1 对齐 |
| **代码提交与推送** | `git add -A; git commit -m "..."; git push origin main` | 仅在实机验证 0 报错后执行提交推送 |

<!-- BEGIN ASHAN HARD GUARDRAILS -->
## AI Hard Guardrails 强制规则

本仓库采用“现有架构优先、默认禁止新架构”的开发模式。

任何 AI 修改代码前必须先执行：

```bash
python scripts/ai_architecture_query.py <本次需求关键词>
```

然后优先修改查询结果中的 canonical owner。

硬规则：

- 默认修改现有 Page、Service、CSS、JS，不创建平行实现。
- 禁止 `_v2`、`_new`、`_final`、`_fixed`、`_backup`、`_copy` 逃避理解现有代码。
- 新 Service、新共享 JS/CSS、新 Page、新 DocType、新 Report、新 Workspace 必须先在独立审批变更中登记到 component registry，并合并到 base branch。
- 新 whitelist API 必须先在独立审批变更中登记到 API registry，并合并到 base branch。
- hooks、migration、dependency、跨模块大改必须先有 base-branch architecture exception。
- AI 不得在同一个 PR 里修改 registry/exception 并同时实现代码。Guard 会按 base branch 判断，当前 PR 的自我批准无效。
- 不创建第二套权限、company scope、money formatter、sidebar、task hub、UI kit。
- 不通过修改 guard script、registry、workflow 或 CODEOWNERS 来让当前任务通过。
- 完成前必须执行 `python scripts/run_ai_guards.py`，然后执行业务测试。

架构说明：

- `docs/architecture/ARCHITECTURE_OWNERSHIP.md`
- `docs/architecture/AI_HARD_GUARDRAILS.md`
- `docs/architecture/ARCHITECTURE_APPROVAL_WORKFLOW.md`

如果 Guard 拒绝当前实现，优先缩小改动、复用现有 owner。不要通过删除 Guard 或扩大 exception 绕过。
<!-- END ASHAN HARD GUARDRAILS -->
