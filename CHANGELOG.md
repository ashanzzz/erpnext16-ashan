# Changelog

All notable changes to this project are recorded in this file.

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
