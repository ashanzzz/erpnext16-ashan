# GitHub Branch Protection

`CODEOWNERS` 文件本身不能单独阻止 AI 合并代码。GitHub 必须启用 branch protection 或 ruleset。

在 GitHub 仓库中对 `main` 建议启用：

1. Require a pull request before merging
2. Require approvals
3. Require review from Code Owners
4. Require status checks to pass
5. 把 `AI hard guardrails` 设为 Required status check
6. Require branches to be up to date before merging
7. Block force pushes
8. Block branch deletion
9. 不允许绕过以上规则，或只允许仓库所有者紧急绕过

启用后，弱 AI 即使修改了：

- guard script
- component registry
- API registry
- architecture exception
- hooks
- authorization
- UI kit
- DocType

也不能自己完成合并，因为这些路径需要 `@ashanzzz` Code Owner review。

## 最强模式

对 AI 使用的 GitHub token / App：

- 允许创建 branch
- 允许 push branch
- 允许创建 PR
- 不给 main 直接 push
- 不给 ruleset 管理权限
- 不给管理员 bypass 权限

这样 AI 可以干活，但不能解除约束。
