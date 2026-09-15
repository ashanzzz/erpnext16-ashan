# Change and Code Conflict Prevention V2

## 高冲突文件
以下文件修改前必须完整读取相关 section：
- `AGENTS.md`
- `PROJECT_MAP.md`
- `hooks.py`
- `public/css/ashan_ui_kit.css`
- `public/js/ashan_ui_kit.js`
- `public/js/ashan_cn_sidebar_v2.js`
- `public/js/ashan_work_context.js`
- `services/authorization_service.py`
- workspace/sidebar JSON
- fixtures
- patches.txt
- boot/session code

禁止为了一个功能整文件替换。

## 域级 runtime
已经存在时先扩展。采购优先 `procurement_workbench.js/css`。
禁止新建 `procurement_workbench_v2.js`、`better_procurement.js`、`procurement_final.css` 来逃避理解旧代码。

## CSS
页面局部问题页面局部解决。共享 primitive 只有至少两个真实模块需要或属于基础 token/control 时才上提 UI kit。

不能静默修改已有共享 class 的语义并影响其他页面。

## JavaScript
不新增无管理全局变量。加入 AshanUI 前先查现有方法。document/window event 必须去重和清理。

## API
改现有 API 前搜索全部 call site。默认 additive compatible change。
不能静默改 input、output type、status meaning、permission、route。

## 权限
自定义模块不建第二套 authorization。标准 ERPNext DocType 不被强行改成自定义 Manager/Operator。

## Schema
使用 Frappe DocType/Custom Field/fixture/patch。历史已执行 patch 不重写行为。

## 并发修改
目标文件有本任务之外改动时，保留并做局部编辑。禁止按旧 prompt 覆盖。

## 文件名
新文件默认禁止 `_v2`、`_v3`、`_new`、`_final`、`_fixed`、`_backup`、`_temp`，除非真的是外部 API version contract。

## 最终检查
检查 git diff、shared files、new globals、new CSS、new API、permission bypass、hooks、scheduler、schema、无关格式变化。
目标是最小且完整的改动。
