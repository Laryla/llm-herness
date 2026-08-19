# LLM Harness V1 产品需求设计

## 背景与目标

LLM Harness 是一个本地优先、单用户的大模型运行工作台。第一版通过 Web Client 使用 Harness Server，统一管理 Workspace、OpenAI 兼容模型、Conversation、Tool 执行和可观察的 Turn Trace；未来的 CLI Client 与浏览器插件复用同一服务端契约。

第一版需要验证的核心闭环是：用户选择 Workspace 与模型，创建 Conversation，发送消息，观察流式回复与每个 Step，在需要时确认 Tool、排队下一条消息或立即介入当前 Turn。

## 用户与运行边界

- 每个 Harness Instance 只服务一个用户，不提供注册、组织、角色或租户隔离。
- 默认只监听 `127.0.0.1`，不允许直接暴露到局域网或公网。
- 模型密钥、Conversation 和运行状态默认保留在用户设备。
- 第一版只实现 Web Client；CLI Client 与浏览器插件属于后续版本。

## 首次启动

1. 创建 Harness 数据目录和默认 Workspace：`~/.llm/workspaces/default`。
2. 引导用户创建第一个 Model Profile。
3. 测试连接并从 `/v1/models` 获取 Model Catalog。
4. 用户选择 Current Model Selection。
5. 进入默认 Workspace 并创建 Conversation。
6. Current Tool Selection 默认为空。

没有可用 Model Profile 时，用户仍可进入设置和查看历史，但不能创建 Turn。

## Workspace

- Workspace 是用户注册的一个文件夹，也是文件类 Tool 的访问边界。
- 支持保存多个 Workspace，并维护一个由 Harness Server 持久化、所有 Client 共用的 Current Workspace。
- 切换 Current Workspace 后，Conversation 列表默认只展示该 Workspace 的内容。
- Conversation 创建后固定归属于一个 Workspace；已有 Turn 不受 Current Workspace 切换影响。
- Workspace 路径不存在时标记为 `unavailable`：历史仍可查看，但不能创建新 Turn 或执行文件 Tool；用户可以重新指定路径修复。
- 删除 Workspace 记录默认不删除磁盘文件。

## Model Profile 与模型选择

Model Profile 包含：

- 显示名称；
- `baseUrl`；
- API Key 引用和脱敏信息；
- 自动发现与手动补充的 Model Catalog；
- 最近一次连接测试结果。

约束：

- 第一版认证固定为 `Authorization: Bearer <API_KEY>`。
- 不支持 Azure OpenAI 特殊路径、自定义 Header、Query 参数或代理配置。
- API Key 不得明文写入数据库；默认进入操作系统密钥库，无密钥库环境可通过环境变量注入。
- 模型列表优先从 OpenAI 兼容的 `/v1/models` 获取，并允许手动补充；列表存在不代表模型一定可调用。
- Harness Instance 只有一个共享的 Current Model Selection。
- 修改 Current Model Selection 只影响之后创建的 Turn，不影响任何活动或历史 Turn。
- Turn 创建时显式保存 Model Profile 与模型名称快照，并在所有模型 Step 中保持不变。

每个 Turn 支持以下模型参数：`temperature`、`top_p`、`max_tokens`、`stop`。第一版不开放任意 `extra_body`。

## Conversation、Turn、Iteration 与 Step

```text
Workspace
└── Conversation
    ├── Turn
    │   ├── Iteration
    │   │   ├── Model Step
    │   │   └── Tool Step(s)
    │   └── Iteration ...
    └── Turn ...
```

- Conversation 是线性历史，第一版不支持分支、历史消息编辑或重新生成。
- Conversation 可以保存可编辑的 Instructions；每个 Turn 保存创建时的 Instructions 快照。
- Turn 从普通用户消息开始，直到最终回复、取消、失败、中断或达到循环上限。
- Turn 固定所属 Workspace、Model Selection、Tool Binding、Instructions 和最大 Iteration 快照。
- Iteration 从一次 Model Step 开始，并包含该模型请求产生的全部 Tool Step。
- 正式环境默认 `maxIterations = 50`，允许在 Harness 设置中配置 `1–100`；测试环境固定为 8。
- 达到上限时 Turn 以 `limit_reached` 结束，而不是普通失败。
- 不同 Conversation 可以并行；同一 Conversation 同时只执行一个活动 Turn。
- WebSocket 断开不取消 Turn；Client 重连后从持久化快照恢复观察。
- Harness Server 重启时，未完成 Turn 标记为 `interrupted`，不自动重放，以避免重复 Tool 副作用。

## Trace

Conversation 默认按 Turn 展示。每个 Turn 可展开完整 Trace，按顺序显示：

- Model Step、Tool Step 和标题生成 Step；
- Step 状态、输入、输出与结构化错误；
- 实际模型、Tool、参数快照；
- 开始时间、结束时间与耗时；
- Token 用量；
- Tool 确认、拒绝与执行结果；
- Steering Message 所在位置。

WebSocket 实时发送内容增量。数据库持久化每个 Turn、Step、状态迁移和节流后的部分输出快照；不为每个 Token 单独插入记录。Step 完成后保存最终完整内容。

## 排队与运行中介入

活动 Turn 期间输入框保持可用，提供两种发送方式：

### 排队发送

- 默认行为；消息成为 Queued Message。
- 可以存在多条 Queued Message，按提交顺序逐条创建后续 Turn。
- 尚未开始的 Queued Message 可以编辑、删除或调整顺序。
- 当前 Turn 失败或取消时暂停队列，等待用户决定是否继续。
- Queued Message 不单独保存模型或 Tool 配置；开始创建 Turn 时使用当时共享的 Current Model Selection 与 Current Tool Selection。

### 立即介入

- 消息成为当前 Turn 的 Steering Message，不创建新 Turn。
- 当前是 Model Step：取消该 Step，保留并标记部分输出，在同一 Turn 创建新的 Model Step。
- 当前是 Tool Step：不强制终止，等待 Tool 完成后把 Tool Result 与 Steering Message 一起交给下一个 Model Step。
- 当前等待 Tool 确认：拒绝待确认 Tool Call，再携带 Steering Message 继续。
- Turn 已进入完成提交阶段：介入失败，消息转为 Queued Message。
- Steering Message 不改变当前 Turn 已固定的模型或 Tool；用户切换模型或 Tool 只影响未来 Turn。

## Tool

第一版 Tool 由 Harness Server 使用 TypeScript 静态注册，不支持用户上传、动态加载、Plugin Manifest 或插件市场。

每个 Tool 包含：

- 稳定 Tool ID；
- 提供给模型的名称与描述；
- Zod 输入与输出 Schema；
- `automatic` 或 `requires_confirmation` Tool Policy；
- 异步执行函数。

Harness Instance 保存唯一 Current Tool Selection。Turn 创建时 Client 显式提交 Tool ID，Server 从可信 ToolRegistry 解析为不可变 Tool Binding；Client 不能上传 Schema、覆盖 Tool Policy 或执行代码。Turn 的每个 Model Step 都向上游携带相同 Tool Schema。

第一版内置：

- `calculator`：`automatic`；
- `write_text_file`：`requires_confirmation`，且只能写入 Turn 所属 Workspace。

Tool 未声明策略时默认要求确认。确认不设自动超时。Tool 执行失败时保存失败 Step，并把结构化错误作为 Tool Result 返回模型；失败本身不立即终止 Turn，由最大 Iteration 防止无限循环。用户拒绝 Tool 作为 `rejected` 结果返回模型。

`write_text_file` 必须拒绝绝对路径、`..` 路径穿越和符号链接逃逸。

## 对话历史与上下文

- 每次 Model Step 从 Conversation 与当前 Turn 构建上下文。
- Instructions 始终保留。
- 在模型上下文限制内从最近消息向前选择。
- Tool Call 与对应 Tool Result 必须成对保留。
- 超出上下文的旧消息只是不发送给模型，不从数据库删除。
- 第一版不做自动摘要。
- Web Client 明确展示该 Model Step 实际纳入上下文的消息范围。

## 模型协议与错误处理

- 第一版上游只兼容 OpenAI `POST /v1/chat/completions`。
- 支持流式输出、`tools`、`tool_calls` 和 Tool Result 回传。
- 不支持 Responses API。
- 模型调用在尚未输出内容前遇到超时、限流或临时服务错误时最多重试 2 次。
- 一旦已经输出内容，不自动重试。
- 认证失败、参数错误和模型不存在等确定性错误不重试。

## Conversation 标题

- 创建 Conversation 时立即截取第一条普通用户消息前 40 个字符作为临时标题。
- 第一个 Turn 产生最终回复后，使用同一 Model Selection、无 Tool、短输出限制生成正式标题。
- 标题生成作为非关键 Model Step 显示在第一个 Turn 的 Trace 中。
- 标题生成失败不影响 Turn，保留临时标题。
- 用户手动改名后不再自动覆盖。

## Web Client

- React + Vite SPA，生产构建由 Harness Server 静态托管。
- 开发环境分别运行 Vite Dev Server 与 Fastify。
- Conversation 页面按 Turn 展示，Step Trace 默认折叠。
- 模型回复支持 Markdown、GFM、代码高亮、复制、表格、任务列表和安全链接。
- 禁用原始 HTML，并对模型输出进行安全清理。
- 第一版消息只支持纯文本，不支持图片、文件、音频或视频。

## 数据库

- 正式支持 SQLite、MySQL 与 PostgreSQL，使用 Prisma。
- SQLite 是本地默认数据库。
- 数据库类型在部署或首次初始化时选定，运行时不允许切换。
- 第一版不提供不同数据库之间的历史数据迁移。
- 三种数据库必须通过相同契约测试，并分别具备可验证的 Schema 与迁移。

## 非目标

- 多用户、认证、组织与权限系统；
- CLI Client 与浏览器插件实现；
- Skill；
- 用户上传 Tool、Plugin 系统与安全沙箱；
- Responses API；
- 多模态与文件附件；
- Conversation 分支、消息编辑与重新生成；
- 自动历史摘要；
- Electron、桌面安装包、Docker 镜像与系统服务；
- 跨数据库历史迁移；
- 远程托管与公网访问。

## 验收标准

1. 用户首次启动后能创建 Model Profile、发现或手动添加模型，并完成连接测试。
2. 用户能注册多个 Workspace、切换 Current Workspace，并只看到当前 Workspace 的 Conversation。
3. 用户能创建 Conversation，以当前模型和 Tool 选择创建 Turn，并看到流式 Markdown 回复。
4. Tool Call 能按照 Tool Policy 自动执行或等待确认，失败结果能够返回模型继续处理。
5. 每个 Turn 可展开查看完整 Step Trace、模型与 Tool 快照、状态、错误、耗时和 Token 用量。
6. 用户能在活动 Turn 中排队消息或立即介入，并符合已定义的 Model/Tool/Steering 规则。
7. WebSocket 断开重连后可以恢复观察；Server 重启后未完成 Turn 正确标记为 `interrupted`。
8. SQLite、MySQL、PostgreSQL 均通过数据库契约测试；数据库中不存在明文模型 API Key。
9. `write_text_file` 不能逃逸 Turn 所属 Workspace。
10. `yarn build` 生成可由单个 Fastify 进程托管的 Web 与 Server 产物。
