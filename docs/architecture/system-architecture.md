# LLM Harness 系统架构

## 架构目标

系统采用本地优先、单用户、Server 中心化架构。Web Client 只负责交互与状态展示；Harness Server 是模型访问、Turn 编排、Tool 执行、Trace 和共享偏好的唯一权威来源。未来 Client 必须复用相同 REST、WebSocket 与领域契约。

## 运行拓扑

```text
React + Vite Web Client
        │
        ├── REST：资源管理与历史读取
        └── WebSocket：Turn、Step、流式内容与控制事件
                    │
              Fastify Harness Server
        ┌───────────┼───────────────┐
        │           │               │
 Model Adapter  Tool Runtime   Persistence
 Chat API       ToolRegistry   Prisma
        │           │          ├── SQLite
 OpenAI-compatible │          ├── MySQL
 model endpoint     │          └── PostgreSQL
                    │
                Workspace
```

生产环境由单个 Fastify 进程同时托管 REST、WebSocket 和 Vite 构建后的静态资源。默认只监听 `127.0.0.1`。

## Monorepo

```text
llm-harness/
├── apps/
│   ├── web/
│   │   └── src/
│   │       ├── app/
│   │       ├── features/
│   │       └── shared/
│   └── server/
│       └── src/
│           ├── main.ts
│           ├── app.ts
│           ├── config/
│           ├── common/
│           ├── modules/
│           │   ├── conversations/
│           │   ├── model-profiles/
│           │   ├── runtime/
│           │   ├── tools/
│           │   └── workspaces/
│           └── infrastructure/
│               ├── database/
│               └── secrets/
├── packages/
│   └── contracts/
└── docs/
```

`packages/contracts` 只包含 Client 与 Server 共同消费的 Zod Schema、REST DTO 和 WebSocket 事件。Server 私有业务与基础设施不得上移为伪共享包。

## 技术基线

- Node.js `24.18.0`，根 `.nvmrc` 精确锁定；
- Yarn `4.18.0`，根 `package.json#packageManager` 锁定；
- Yarn Workspaces；
- `.yarnrc.yml` 使用 `nodeLinker: node-modules`；
- TypeScript；
- Web：React + Vite；
- Server：Fastify + Zod；
- 数据：Prisma + SQLite/MySQL/PostgreSQL；
- 上游模型：OpenAI Node SDK，Chat Completions 兼容接口。

## 模块边界

### conversations

拥有 Workspace 下的 Conversation、Turn、Iteration、Step、Queued Message、Steering Message、Instructions 和 Trace。负责线性历史、上下文选择、队列顺序和标题生成。

### model-profiles

拥有 Model Profile、Model Catalog、连接测试和 Current Model Selection。只保存 Secret 引用，不读取或持久化明文密钥。

### runtime

编排 Turn 生命周期与 Iteration 循环，调用 Model Adapter 和 Tool Runtime，持久化 Step 状态，并向 WebSocket 发布事件。Client 断线不能终止 Runtime。

### tools

拥有 ToolDefinition、ToolRegistry、Tool Policy、Current Tool Selection、Tool Binding、参数校验、确认和执行。第一版 Tool 只允许静态注册。

### workspaces

拥有 Workspace 注册、Current Workspace、路径可用性与文件访问边界。文件 Tool 必须通过该模块解析安全路径。

### infrastructure/database

拥有 Prisma Client、三种 Provider 的 Schema/迁移选择、数据库初始化和契约测试适配。业务模块不得直接依赖具体数据库驱动。

### infrastructure/secrets

提供 SecretStore，V1 默认把模型密钥明文保存到 Harness Home 的 `config.json`，并支持环境变量引用。

## REST 与 WebSocket

REST 用于：

- Workspace、Model Profile、Model Catalog、Conversation 与设置 CRUD；
- 历史 Turn 与 Trace 查询；
- 首次加载与 WebSocket 重连后的状态快照。

WebSocket 用于：

- Turn 创建、取消与状态变化；
- Step 创建与状态变化；
- 模型内容增量；
- Tool 确认、拒绝与结果；
- Queued Message 与 Steering Message；
- Current Workspace、Model Selection 和 Tool Selection 广播；
- Conversation 标题更新。

所有事件必须包含递增序号和稳定实体 ID。Client 重连时先通过 REST 读取持久化快照，再订阅后续事件；WebSocket 连接不是状态来源。

## Turn 状态机

```text
queued → running → awaiting_confirmation → running
                 ├────────────────────────→ completed
                 ├────────────────────────→ limit_reached
                 ├────────────────────────→ failed
                 ├────────────────────────→ cancelled
                 └────────────────────────→ interrupted
```

Step 的状态至少包含：`pending`、`running`、`awaiting_confirmation`、`completed`、`failed`、`rejected`、`cancelled`、`interrupted`。

Tool Step 失败不直接使 Turn 失败；错误作为 Tool Result 进入下一个 Model Step。Iteration 达到快照上限时以 `limit_reached` 结束。

## Tool Binding

```ts
interface BoundToolSet {
  readonly byId: ReadonlyMap<ToolId, BoundTool>;
  readonly byModelName: ReadonlyMap<string, BoundTool>;
  readonly providerSchemas: readonly ChatCompletionTool[];
}
```

Turn 创建时，runtime 从 ToolRegistry 解析 Current Tool Selection，生成不可变 BoundToolSet。Client 只提交 Tool ID；模型只能调用 BoundToolSet 中存在的模型函数名。

## 数据与密钥

默认 Harness Home：

```text
~/.llm/
├── data/
├── logs/
├── workspaces/
│   └── default/
└── config.json
```

SQLite 数据文件位于 `~/.llm/data/`。MySQL/PostgreSQL 通过部署配置连接。数据库 Provider 一经初始化，在该部署运行期间固定；不支持跨 Provider 数据迁移。

真实 API Key 不进入 Prisma 模型。数据库只保存 Secret 引用与脱敏展示值。

## 依赖方向

```text
Web features → packages/contracts
Server API/WebSocket → Server modules → infrastructure ports
infrastructure adapters → Prisma/OpenAI/OS secret services
```

业务模块不得导入 Web 代码、具体数据库 Provider 或操作系统密钥实现。`packages/contracts` 不得依赖任何应用。

## 验证要求

- packages/contracts：Schema 与事件兼容测试；
- runtime：Turn/Step 状态机、50/8 Iteration、排队、介入、断线与重启测试；
- tools：Schema、Binding、Policy、错误回传和 Workspace 逃逸测试；
- database：SQLite、MySQL、PostgreSQL 同一套契约测试；
- server：REST、WebSocket 和静态资源集成测试；
- web：关键交互组件测试与端到端闭环；
- 构建：Node/Yarn 版本、类型检查、Lint、测试和生产单进程启动。
