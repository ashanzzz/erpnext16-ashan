# 私密人事/薪酬数据放置说明

本源码包不包含真实员工姓名、身份证、手机号、历史工资等私密数据。

部署后如需执行初始化导入，请任选其一：

1. 将 `qifu_employee_seed.json`、`qifu_full_40_historical_data.json` 和 `jizhong_history_records.json` 放到当前 Frappe 站点的 `private/files/`；
2. 或设置环境变量 `QIFU_EMPLOYEE_SEED_PATH`、`QIFU_HISTORICAL_DATA_PATH` 与 `JIZHONG_HISTORY_RECORDS_PATH` 指向私密 JSON 文件。

`services/*.example.json` 仅为字段结构示例，使用的是虚构数据。
