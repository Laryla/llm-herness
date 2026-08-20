# LLM Harness V1 实施计划

## 目标

从已清理的仓库基线建立全栈 TypeScript Yarn Workspaces Monorepo，交付可由单个 Fastify 进程运行的 Harness Server 与 React Web Client，并满足 [V1 产品需求设计](../designs/2026-08-19-v1-product-design.md) 和 [系统架构](../architecture/system-architecture.md)。

## 实施原则

- 按可验证的垂直切片推进，不同时铺开所有页面和模块。
- 先建立领域状态机与契约测试，再接模型、数据库和 UI。
- WebSocket 只传递事件，不成为状态来源。
- 每个阶段保持 `yarn typecheck`、`yarn lint`、`yarn test` 可运行。
- SQLite 是本地开发默认值；涉及持久化契约的阶段必须在 MySQL、PostgreSQL 上执行同一套测试。
- 早期 Python 原型已经移除，不再保留双技术栈运行入口。

## 阶段 1：建立 Yarn Monorepo 基线

### 变更

- 新增根 `.nvmrc`，固定 Node.js `24.18.0`。
- 新增根 `package.json`，固定 `packageManager: yarn@4.18.0` 并声明 Workspaces。
- 新增 `.yarnrc.yml`，设置 `nodeLinker: node-modules`。
- 新增统一 TypeScript、Lint、格式化与测试配置。
- 创建：

```text
apps/web/
apps/server/
packages/contracts/
```

- 为 Web 建立 React + Vite 最小入口。
- 为 Server 建立 Fastify 健康检查与静态资源托管骨架。
- 根脚本提供 `dev`、`build`、`start`、`typecheck`、`lint`、`test`。

### 验证

```bash
nvm use
yarn install
yarn typecheck
yarn lint
yarn test
yarn build
yarn start
```

访问 `GET /health`，并确认生产进程能够返回 Vite 构建页面。

### 完成标准

- 仓库继续保持无 Python 运行入口。
- Web 与 Server 可独立开发、统一构建并由单进程生产启动。

## 阶段 2：建立共享契约

### 变更

在 `packages/contracts` 中按资源建立 Zod Schema：

- Workspace 与 Current Workspace；
- Model Profile、Model Catalog、Model Selection；
- Tool、Tool Policy、Tool Selection 与 Tool Binding 快照；
- Conversation、Turn、Iteration、Step 与 Trace；
- Queued Message 与 Steering Message；
- REST 请求/响应；
- WebSocket Client Command、Server Event 与错误 Envelope。

所有事件包含：

- `eventId`；
- 单调递增 `sequence`；
- `occurredAt`；
- 相关实体 ID；
- 可判别联合的 `type`。

### 测试

- Schema 正反例；
- REST DTO 序列化；
- WebSocket 事件判别联合穷尽性；
- 版本字段和向后兼容约束。

### 完成标准

- Web 与 Server 只从 `packages/contracts` 导入跨边界类型。
- 禁止复制 DTO 或手写平行接口。

## 阶段 3：配置、Harness Home 与数据库

### 变更

- 建立 Server 配置加载与 Zod 校验。
- 初始化 `~/.llm/data`、`~/.llm/logs`、`~/.llm/workspaces/default`。
- 建立 Prisma 配置，支持部署阶段选择 `sqlite`、`mysql`、`postgresql`。
- 定义核心持久化模型：
  - HarnessSettings；
  - Workspace；
  - ModelProfile 与 ModelCatalogEntry；
  - Conversation；
  - Turn；
  - Step；
  - Message；
  - QueuedMessage；
  - ToolConfirmation。
- 分别生成和验证三种 Provider 的迁移。
- 建立数据库初始化、健康检查和优雅关闭。
- 将数据库迁移纳入 Harness Server 启动生命周期，用户不需要在 `yarn dev` 或 `yarn start` 前手动执行迁移命令。
- 启动顺序固定为：
  1. 加载并校验 Server 配置；
  2. 初始化 Harness Home；
  3. Migration Runner 根据启动时确定的 Provider 建立临时迁移连接并执行对应的 `migrate deploy`；
  4. 迁移完成后关闭临时迁移连接；
  5. 创建并连接长期使用的业务 Prisma Client；
  6. 执行数据库健康检查；
  7. 健康检查通过后才启动 Fastify 监听。
- 迁移必须幂等；迁移失败或数据库健康检查失败时终止启动，不对外提供 HTTP/WebSocket 服务。
- `db:generate` 属于安装或构建阶段，不在 Server 运行时生成 Prisma Client。
- SQLite、MySQL、PostgreSQL 遵循同一启动迁移生命周期；运行期间仍拒绝更换 Provider。

### 测试

- SQLite 临时文件测试；
- MySQL 容器集成测试；
- PostgreSQL 容器集成测试；
- 三种数据库运行同一套 CRUD、事务、排序与状态迁移契约测试；
- 验证数据库中没有明文 API Key 字段。
- 验证空数据库通过 `yarn dev` 与 `yarn start` 启动时能够自动迁移并进入健康状态。
- 验证迁移失败时 Fastify 不开始监听，且日志不包含数据库密码或完整连接串。

### 完成标准

- 三种数据库均能从空库迁移并通过同一套契约测试。
- 运行期间拒绝更换数据库 Provider。

## 阶段 4：Workspace 与 SecretStore

### Workspace

- 实现 Workspace 注册、列表、重命名、删除记录与 Current Workspace 切换。
- 首次启动创建默认 Workspace。
- 实现路径规范化、存在性检查与 `unavailable` 状态。
- Current Workspace 变化持久化并广播。
- Conversation 列表按 Current Workspace 过滤。

### SecretStore

- 定义 SecretStore 接口。
- 实现本地 `config.json` 明文密钥存储和环境变量引用。
- Model Profile 只持久化 Secret 引用和脱敏值。
- 日志与错误序列化统一执行密钥清理。

### 测试

- Workspace 被移动、删除、恢复路径；
- 绝对路径、`..` 与符号链接逃逸；
- Secret 写入、读取、删除和不可用回退；
- 日志及 API 响应不泄漏密钥。

## 阶段 5：Model Profile 与 Chat Completions Adapter

### 变更

- 实现 Model Profile CRUD 与连接测试。
- 实现 `/v1/models` 自动发现和手动 Model Catalog 条目。
- 实现 Current Model Selection 持久化与广播。
- 建立 Model Adapter 接口。
- 使用 OpenAI Node SDK 实现 Chat Completions：
  - 自定义 `baseUrl`；
  - Bearer API Key；
  - 流式文本；
  - Tool Schema；
  - Tool Call 与 Tool Result；
  - `temperature`、`top_p`、`max_tokens`、`stop`。
- 实现调用前重试策略：临时错误最多 2 次，已有输出后不重试。

### 测试

- 使用假 OpenAI 兼容 Server 覆盖普通回复、流式分片、Tool Call、限流、超时、认证失败与中途断流。
- 验证不发送 Responses API 请求或非允许 `extra_body`。

## 阶段 6：Conversation、Turn 与 Trace 状态机

### 变更

- 实现 Conversation CRUD、Instructions 和线性消息历史。
- 实现 Turn 创建时的 Workspace、Model、Tool、Instructions、参数和最大 Iteration 快照。
- 实现 Iteration 循环与 Step 持久化。
- 实现 Turn/Step 状态转换校验。
- 实现 Context Selection：
  - Instructions 始终保留；
  - 从最近历史向前选择；
  - Tool Call/Result 成对保留；
  - 旧消息不删除；
  - 记录实际选择范围。
- 实现流式部分输出节流快照与最终内容保存。
- Server 启动时将遗留活动 Turn 标记为 `interrupted`。
- 达到最大 Iteration 时标记为 `limit_reached`。

### 测试

- 每个合法和非法状态转换；
- 正式默认 50、测试固定 8；
- Tool 失败后继续下一 Model Step；
- WebSocket 断开不影响 Turn；
- Server 重启不重放副作用；
- 上下文裁剪与 Tool 消息配对。

## 阶段 7：Tool Registry、Binding 与执行

### 变更

- 实现泛型 `defineTool()`，强制 Zod 输入/输出 Schema。
- 实现 ToolRegistry 与唯一 ID/模型函数名校验。
- 实现 Turn 级不可变 BoundToolSet：

```ts
interface BoundToolSet {
  readonly byId: ReadonlyMap<ToolId, BoundTool>;
  readonly byModelName: ReadonlyMap<string, BoundTool>;
  readonly providerSchemas: readonly ChatCompletionTool[];
}
```

- 实现 Current Tool Selection 持久化与广播。
- 实现 `automatic` 与 `requires_confirmation`，默认要求确认。
- Tool 确认不设自动超时。
- Tool 失败保存 Trace，并以结构化 Tool Result 返回模型。
- 实现 `calculator`。
- 实现 Workspace 限定的 `write_text_file`。

### 测试

- Zod 参数与输出验证；
- 未绑定 Tool Call；
- Client 伪造 Schema 或 Policy；
- 自动执行、确认、拒绝、取消；
- 同一 Tool 重复失败直到 Iteration 上限；
- 文件路径穿越和符号链接逃逸。

## 阶段 8：WebSocket Runtime 协议

### 变更

- 建立 WebSocket 连接、心跳、订阅和统一错误 Envelope。
- 实现事件序号与重连恢复流程。
- 实现：
  - Turn/Step 状态与内容增量；
  - Tool 确认与拒绝；
  - Turn 取消；
  - Queued Message 增删改、排序与暂停；
  - Steering Message；
  - Current Workspace/Model/Tool 广播；
  - Conversation 标题更新。
- Steering 规则：
  - 取消 Model Step；
  - 不强制取消活动 Tool Step；
  - 拒绝等待确认的 Tool；
  - 完成提交阶段转为 Queued Message。

### 测试

- 断线、重连、重复事件与过期命令；
- 不同 Conversation 并行；
- 同一 Conversation 单活动 Turn；
- 排队顺序、编辑、删除与失败暂停；
- Steering 在每种 Step 状态下的行为。

## 阶段 9：Web Client 产品闭环

### 页面与功能

- 首次启动向导；
- Workspace 切换与管理；
- Conversation 列表、新建、重命名与删除；
- 聊天输入、Current Model/Tool Selection 与模型参数；
- 流式 Markdown/GFM、安全清理、代码高亮与复制；
- Turn 展示与可展开 Step Trace；
- Tool 确认；
- Queued Message 与“立即介入”；
- 连接、错误、`unavailable`、`interrupted` 和 `limit_reached` 状态。

### 标题

- 首条消息前 40 字生成临时标题。
- 第一个 Turn 最终回复后，用相同 Model Selection、无 Tool 生成正式标题。
- 标题生成作为非关键 Model Step 进入 Trace；失败保留临时标题。

### 测试

- 组件交互与可访问性；
- WebSocket 重连后的状态恢复；
- Markdown XSS；
- 从首次启动到 Tool Turn 完成的端到端测试。

## 阶段 10：生产构建与验收

### 变更

- Fastify 托管 Web 构建产物和 SPA 回退。
- 默认绑定 `127.0.0.1`，拒绝未授权的非回环地址配置。
- 建立结构化日志、密钥清理和基本性能指标。
- 更新 README、环境变量模板、API 文档和本地运行文档。
- 配置 CI：类型检查、Lint、单元测试、三数据库集成测试、Web E2E 和生产构建。

### 最终验收

逐条执行产品需求设计中的 10 项验收标准，并至少验证：

```bash
nvm use
yarn install --immutable
yarn typecheck
yarn lint
yarn test
yarn test:integration
yarn test:e2e
yarn build
yarn start
```

## 迁移与回滚

- 早期 Python 原型已在实施前移除，且没有生产数据，无需数据迁移。
- 数据库迁移在测试数据库和三种 Provider 上验证后才进入主分支。
- 每个阶段保持独立可回滚，不把 Monorepo 迁移、数据库 Schema 和完整 Web UI 混在同一个提交。

## V1 完成定义

- 产品需求设计与架构文档的 V1 范围全部实现；
- 所有验收标准有自动化测试或明确的人工验证记录；
- SQLite、MySQL、PostgreSQL 契约测试通过；
- Web Client 可通过单个本地 Harness Server 完成完整 Turn/Tool/Trace 闭环；
- 仓库中不存在旧 Python 运行入口、明文密钥或未记录的架构偏差。
