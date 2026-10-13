# Changelog

All notable changes to this project are recorded in this file.

## [v2026.10.13-iit-refactor] - 2026-10-13

### Added
- **通用中国居民个人所得税核心计算引擎 (Universal China IIT Engine)**：
  - 核心计算全面采用 `Decimal` 与 `ROUND_HALF_UP` 严格还原 Excel/VBA 舍入口径，彻底消除二进制浮点 0.01 元误差。
  - 税后工资反推采用闭式 7 级累计预扣模型，验算必须到分严格完全相等（`money_round(net_verified) == money_round(target_net)`），彻底废除 `abs < 0.02` 宽松容差。
  - 严格解耦“实发工资实际扣款 (`actual_payroll_deduction_cur`)”与“个税税前允许专项扣除 (`tax_deductible_special_cur`)”，支持公积金及各项社保法定抵扣封顶。
  - 祺富与吉众统一接入权威计算核心，两公司调用同一底层算法实现 0.00 元误差完全一致。
  - **陈亮 (A0001) 2026-07 真实黄金算例 1:1 对齐**：税前金额精确对齐至 **11,247.88 元**，当月个税 **61.86 元**，税后实发 **10,500.00 元**。
- **吉众薪酬工作台前置准入强拦截 (Prerequisite Gate)**：
  - 只有【员工档案】、【社会保险】、【住房公积金】以及【考勤与工时】（固定工资人员免考勤工时）全部核定确认后，才允许进入【工资核定】、【个人所得税】、【现金发放】等后续页面。
  - 前置未全部齐备前，点击后续 Tab 自动拦截并弹窗列出未完成步骤清单进行明确引导。
- **四大前置核定瞬间自动触发算薪与个税 (Instant Auto-Calculation)**：
  - 在前置核定最后一步确认的瞬间，后台即刻自动触发执行全员薪酬核算与个税累计预扣计算，无需用户手动寻找或点击“执行月度薪酬核算”按钮。
- **吉众全要素综合历史数据大宽表 (Full-Element Comprehensive Master Ledger)**：
  - 扩展历史数据台账至 45+ 列全要素大宽表，系统涵盖：人事档案、考勤与工时、工资薪酬收入、个人五险一金扣除分项、专项附加扣除 7 项分项、个人所得税核算明细、税后实发与 5 档现金配钞、单位统筹成本分项与企业综合总成本。
  - 支持“本月当前数据（全部在册人员）”、各个历史归档月份与“全部账期”无缝穿透切换，支持表头滑轮横向滚动。
- **个人所得税台账目标工资与设置优化**：
  - 个税台账“目标工资”列根据计薪方式动态标注明确的【税后】（实发）或【税前】（应发）胶囊徽标，杜绝业务概念混淆。
  - 个税台账左侧集成免征额度（默认上月值 5000.00 元/月）与计薪周期起始月（默认 12 月开始，可调整为 1 月开始）快捷设置面板。

### Changed
- **实现工资核定、个税、现金发放自动确认标绿与封账就绪**：
  - 四大前置步骤人工确认后触发自动算薪，【工资核定】、【个人所得税】、【现金发放】自动确认并同步标绿，全部 7 项步骤圆点全部为绿灯（\`status-ok\`）。
  - 测算完成后立即进入【可核定本月数据】就绪状态，顶栏【立即核定本月数据】与工资表【核定锁定 (只读封账)】按钮自动高亮激活，用户核对后可直接一键封账归档。
- **工资核定 KPI 卡片重构为 5 大核心财务指标**：
  - 全面更新为【合计税前工资】、【合计税后工资】、【合计社保】、【合计公积金】、【合计个税】5 张单行指标卡片。
  - 主数值精准对应：税前工资 ¥174,591.13 - 个人社保 ¥10,640.38 - 个人公积金 ¥3,986.00 - 代扣个税 ¥4,607.14 = 税后工资 ¥155,357.61，平账关系一目了然。
  - 副标题完整展现：在职计薪人数、草稿/已核定状态、现金实发、单位统筹成本与社保/公积金总额。
- **新增计算中动态过渡与标题自动流转**：
  - 在四大前置核定瞬间触发后台计算或点击一键测算时，【工资核定】、【个人所得税】、【现金发放】Tab 页签及明细单标题动态隐藏常规名称，切换显示【计算中...】及旋转呼吸指示灯。
  - 计算完成后，系统自动恢复正规标题（【工资核定】、【个人所得税】、【现金发放】与对应月度明细单标题），并平滑灌入完整的三表最新数据。
- **修复历史数据台账选择全部账期时的全量穿透展示**：
  - `get_tax_settlement_full_sheet` 增加 `period_month='ALL'` 支持，自动汇聚全部历史账期记录与大汇总。
  - 修复历史数据前端在选择【全部账期】时强制取当月的缺陷；个税 68 列台账、综合工资台账、五险一金明细表选择【全部账期】时，均能 100% 完整穿透并展示涵盖全部 20 个历史账期的 460+ 条全量记录。
- **修正确认与数据展示时序（三表同源同时生成）**：
  - 【工资核定】、【个人所得税】、【现金发放】三者是由同一次算薪操作同时生成的，数据相互影响闭环。
  - 彻底废除在已测算状态下把有效金额遮蔽为“还未生成个税”的逻辑；算薪完成后，工资核定表完整展示税前应发、各项扣除、代扣个税、实发薪资与现金发放，与个税 68 列台账、现金配钞表 100% 保持同步互通印证。
- 调整工作台页面 Tab 顺序为：【员工档案】-> 【社会保险】-> 【住房公积金】-> 【考勤与工时】-> 【工资核定】-> 【个人所得税】-> 【现金发放】-> 【历史数据】。
- 工资核定页面在个人所得税尚未确认生成前：
  - 税后固定工资：不显示税前工资与个税，实发显示约定固定工资，税前/个税列黄色高亮标注 `<span class="jz-status-badge jz-status-tax-pending">还未生成个税</span>`。
  - 动态计薪工资：不显示税后实发与现金发放，实发/现金/个税列黄色高亮标注 `<span class="jz-status-badge jz-status-tax-pending">还未生成个税</span>`。
- 修复历史账期个税起征点累计 SQL 读取逻辑，在遇到历史数据起征点缺失或为 0 时自动兜底为法定 5,000 元/月，保证 `prev_thresh` 历史累计连续性。

### Verification
- 单元测试套件 `test_china_iit_engine.py` 11 项核心个税与舍入测试 100% 通过。
- 薪酬模式与 UI 契约测试 `test_jizhong_salary_mode.py`、`test_salary_workbench_ui_contract.py` 全部 39 项测试 100% 通过。
- Playwright 桌面实机全流程测试通过：验证 Tab 顺序、前置准入拦截、黄色未生成状态、个税 68 列税后/税前标签、45 列综合历史大宽表，浏览器控制台 0 报错。
- `python scripts/run_ai_guards.py` 与 `python scripts/verify_ui_style_governance.py` 门禁 100% 通过。

## [Unreleased] - 2026-10-13

### Added

- Added a complete Jizhong payroll history center with four views:
  - 68-column individual income tax ledger.
  - 22-column social insurance and housing fund ledger.
  - 26-column payroll, attendance, and personnel ledger.
  - 14-column payroll summary.
- Added current-month personnel coverage to the Jizhong history center.
- Added period and employee filters for historical payroll records.
- Added history export for each ledger view.
- Added inline monthly tax exemption amount settings beside the tax ledger confirmation action.
- Added monthly tax cycle start-month settings. The default cycle starts in December.
- Added tax-cycle recalculation after changing the exemption amount or cycle start month.
- Added salary-mode-aware target salary reporting in the tax ledger.

### Changed

- Moved the Jizhong payroll approval tab before the individual income tax tab.
- Added yellow `还未生成个税` status display when tax-dependent values are not ready.
- Kept tax-after fixed salary rows focused on target net salary before tax approval.
- Kept tax-before salary rows focused on gross salary before tax approval.
- Improved company-specific employee policy and payroll data isolation for Qifu and Jizhong.
- Updated payroll workflow, UI contracts, and verification scripts.

### Verification

- AI architecture governance passed with zero blocking violations.
- UI style governance passed with no new inline styles.
- Frappe migration and frontend asset build passed on October 13, 2026.
- Jizhong Playwright verification passed with zero console errors.
