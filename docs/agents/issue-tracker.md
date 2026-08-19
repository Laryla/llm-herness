# Issue 跟踪：GitHub

本仓库的 Issue 和 PRD 均存放在 GitHub Issues 中。所有操作使用 `gh` CLI 完成。

## 约定

- **创建 Issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 Issue**：`gh issue view <编号> --comments`，并使用 `jq` 筛选评论和读取标签。
- **列出 Issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需附加 `--label` 和 `--state` 筛选条件。
- **评论 Issue**：`gh issue comment <编号> --body "..."`。
- **添加或移除标签**：`gh issue edit <编号> --add-label "..."` 或 `--remove-label "..."`。
- **关闭 Issue**：`gh issue close <编号> --comment "..."`。

仓库身份从 `git remote -v` 推断；在仓库目录中运行时，`gh` 会自动完成该操作。

## 是否将 Pull Request 作为分诊入口

**不将 PR 作为需求入口。** 如果以后希望把外部 PR 当作功能请求，可以将本规则改为“是”；`triage` 会读取该设置。

启用后，PR 使用与 Issue 相同的标签和状态，并通过对应的 `gh pr` 命令操作：

- **读取 PR**：`gh pr view <编号> --comments`，并使用 `gh pr diff <编号>` 查看差异。
- **列出待分诊的外部 PR**：使用 `gh pr list --state open --json number,title,body,labels,author,authorAssociation,comments`，仅保留 `CONTRIBUTOR`、`FIRST_TIME_CONTRIBUTOR` 或 `NONE`，排除 `OWNER`、`MEMBER` 和 `COLLABORATOR`。
- **评论、标记或关闭**：使用 `gh pr comment`、`gh pr edit --add-label`、`gh pr edit --remove-label` 和 `gh pr close`。

GitHub 的 Issue 与 PR 共用编号空间。遇到 `#42` 之类的编号时，先运行 `gh pr view 42`；如果不是 PR，再运行 `gh issue view 42`。

## 当 Skill 要求“发布到 Issue Tracker”时

创建一个 GitHub Issue。

## 当 Skill 要求“获取相关 Ticket”时

运行 `gh issue view <编号> --comments`。

## Wayfinder 操作

Wayfinder 使用一个 Map Issue 和若干子 Issue：

- **Map**：使用带有 `wayfinder:map` 标签的单个 Issue，正文保存 Notes、Decisions-so-far 和 Fog。使用 `gh issue create --label wayfinder:map` 创建。
- **子 Ticket**：通过 GitHub sub-issue 关联到 Map，并使用 `wayfinder:<类型>` 标签，其中类型为 `research`、`prototype`、`grilling` 或 `task`。GitHub 未启用 sub-issue 时，在 Map 正文的任务列表中关联，并在子 Ticket 顶部写入 `Part of #<Map 编号>`。被认领后分配给负责开发者。
- **阻塞关系**：优先使用 GitHub 原生 Issue Dependency。通过 `gh api --method POST repos/<所有者>/<仓库>/issues/<子 Issue>/dependencies/blocked_by -F issue_id=<阻塞 Issue 数据库 ID>` 添加关系。这里使用数据库数字 ID，而不是 Issue 编号或 `node_id`。不支持原生依赖时，在子 Ticket 顶部写入 `Blocked by: #<编号>`。
- **查找可执行 Ticket**：列出 Map 下所有未关闭的子 Issue，排除仍有开放阻塞项或已分配负责人的 Ticket，按照 Map 中的顺序选择第一个。
- **认领**：运行 `gh issue edit <编号> --add-assignee @me`；这是一次工作会话中的首次写操作。
- **完成**：先评论结论，再关闭 Ticket，最后在 Map 的 Decisions-so-far 中追加上下文链接。
