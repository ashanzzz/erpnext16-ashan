# AI 交接：首次登录路由与公开仓库安全

> 本文记录 2026-08-19 已定位并修复的问题。任何 AI 在修改登录、Desk 路由、首页、`.gitignore`、提交或推送 GitHub 前，必须先阅读本文。

## 1. 已修复：首次登录进入官方 App 选择页

### 现象

用户从站点根地址 `/` 第一次登录时，先看到 Frappe v16 的官方 desktop/App 选择页；刷新后才进入：

```text
/desk/Workspaces/Home
```

### 已确认根因

不能只依赖服务端登录响应里的 `home_page`，也不能只在前端加载完成后调用 `frappe.set_route`。

当登录页 URL 带有 `redirect-to=/` 时，官方 `login.js` 会优先回到 `/`，从而覆盖登录接口给出的目标地址。空 Desk 路由随后会按 `bootinfo.home_page` 渲染 Frappe 的 `desktop` 页面，用户便先看到官方 App 选择页。

`bootinfo.home_page` 也不能直接写成 `Workspaces/Home`：Frappe v16 会把它作为 `Page` 名称处理，而 Workspace 不是 `Page`。

### 固定方案：三层职责不可混淆

1. **HTTP 根路径落地**：`hooks.py` 中的 `website_redirects` 必须保持：

   ```python
   {"source": "/", "target": "/desk/Workspaces/Home", "redirect_http_status": 302}
   ```

   这是本问题的关键修复。它在 Website Path Resolver 阶段处理根地址，避免登录后再次进入空路由。

2. **登录 API 目标**：`boot.py` 的 `set_login_redirect` 和 `get_website_user_home_page` 对 System Manager / Administrator 必须返回或写入：

   ```text
   /desk/Workspaces/Home
   ```

   路由字符串格式要与当前函数的约定一致：`get_website_user_home_page` 返回无前导 `/` 的 `desk/Workspaces/Home`。

3. **Desk 空路由回退**：`boot_session` 中管理员的 `bootinfo.home_page` 必须继续是合法 Page 名称 `desktop`；不要把它改成 Workspace 路径。真正的首次 HTTP 落地由前两层处理；Desk 的其他场景由现有侧边栏路由守卫兜底。

### 禁止的“修复”

- 删除 `website_redirects`，只保留 `role_home_page`。
- 只用前端 `frappe.set_route("Workspaces", "Home")` 修复。
- 把 `bootinfo.home_page` 改为 `Workspaces/Home`。
- 将目标回退为 `/desk`，再等待页面加载后跳转。
- 删除 `hooks.py` 与 `boot.py` 中解释上述原因的注释。

### 必须执行的回归验证

1. 执行现有测试：

   ```bash
   bench --site <site> run-tests --app ashan_cn_procurement --module ashan_cn_procurement.tests.test_login_landing_route
   ```

2. 热同步后，在新浏览器会话（无旧 Cookie/缓存）从：

   ```text
   http://192.168.8.11:6888/
   ```

   登录，确认首次最终地址即为 `/desk/Workspaces/Home`，没有出现官方 App 选择页。

3. 同时确认 `/` 的 HTTP 响应会重定向到目标 Workspace；不要只测试刷新后的 SPA 路由。

相关实现和测试：

```text
ashan_cn_procurement/ashan_cn_procurement/hooks.py
ashan_cn_procurement/ashan_cn_procurement/boot.py
ashan_cn_procurement/ashan_cn_procurement/tests/test_login_landing_route.py
```

## 2. 公开 GitHub 仓库：真实数据与凭据处理

该远程仓库当前是公开仓库。提交前必须把所有新增/未跟踪文件视为可能泄露源，而不是默认执行 `git add -A`。

### 已纳入 `.gitignore` 的本地文件

以下文件必须保留在本地、不得上传：

```text
/temp_screenshots/
/scripts/extracted_*_seed_data.json
/scripts/extracted_vba_macros.txt
```

它们可能包含真实人事、工资、订餐、Excel、宏或验收截图数据。未来如必须共享，请先脱敏并放入显式命名的 fixture/sample 文件。

### 凭据规则

- 密码、API Key、Token、数据库密码仅从环境变量或服务器安全配置读取；默认值必须为空。
- 禁止在测试、排障、浏览器自动化和一次性脚本中给 `os.getenv` 写真实密码默认值。
- `.env` 必须保持忽略，绝不提交。
- 发现已经提交过的凭据时：先停止扩散、立即轮换凭据；只从当前提交删除**不能**清除 Git 历史。是否重写公开历史必须先由用户明确批准。

### 每次提交前的最小检查

```bash
git status --short --ignored
git check-ignore -v <可疑文件>
git diff --cached --check
git diff --name-only
```

还要检查暂存内容是否包含真实数据、二进制 Excel、截图或硬编码凭据。只有用户明确要求“全部提交”时，才包含所有**非忽略且已审查**的文件。

## 3. 共享工作区的提交纪律

本工作区可能在 AI 操作期间继续出现用户或其他自动化产生的改动。

1. 提交前先看 `git status --short`。
2. 暂存后立刻再检查 `git diff --name-only`，确保没有未暂存内容。
3. 提交后、推送前再次检查状态；若出现新改动，不得静默丢弃。
4. 用户已明确要求“全部提交”时，将新出现的非忽略文件单独复核、测试并补充提交；否则保留并向用户说明。

## 4. 推荐交付顺序

```text
本地修改
→ dev_sync_and_verify.py（DocType/Schema 变化则加 --migrate）
→ 无 Cookie 的真实浏览器验收
→ 用户确认
→ 安全/忽略检查
→ commit、push、草稿 PR
```

提交大批量变更时，PR 目标分支必须先核对真实活跃分支；不要仅根据 GitHub 默认分支名称猜测。
