# LLM Harness

LLM Harness 是一个本地优先、单用户的大模型运行工作台。它通过统一的 Harness Server 为 Web Client 以及未来的 CLI Client、浏览器插件提供模型访问、Workspace、Conversation、Tool 执行与 Turn Trace。

## 当前状态

项目处于 V1 设计完成、TypeScript 实现待搭建阶段。早期 FastAPI/Python 原型已移除，下一阶段将按 ADR-0001 建立全栈 TypeScript Yarn Workspaces Monorepo。

## V1 技术基线

- React + Vite Web Client
- Fastify + Zod Harness Server
- OpenAI-compatible `/v1/chat/completions`
- WebSocket 运行事件与 REST 资源 API
- Prisma，正式支持 SQLite、MySQL、PostgreSQL
- Node.js `24.18.0`、Yarn `4.18.0`

## 文档入口

- [领域词汇表](./CONTEXT.md)
- [V1 产品需求设计](./docs/designs/2026-08-19-v1-product-design.md)
- [系统架构](./docs/architecture/system-architecture.md)
- [V1 实施计划](./docs/plans/2026-08-19-v1-implementation-plan.md)
- [架构决策](./docs/adr/)
- [Agent 协作规则](./AGENTS.md)

## 目标目录

```text
apps/
├── web/
└── server/
packages/
└── contracts/
docs/
```

CLI 实现时再新增 `apps/cli/`；Server 私有的数据库、密钥、Tool 和 Runtime 能力保留在 `apps/server` 内部。
