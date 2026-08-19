# 使用最小化 Yarn Workspaces Monorepo

仓库使用 Yarn Workspaces，并将可运行应用放在 `apps/`：第一版包含 React + Vite 的 `apps/web` 与 Fastify 的 `apps/server`，CLI 实现时再新增 `apps/cli`。只有 Web 与 Server 共同消费的 Zod API 和事件契约进入 `packages/contracts`；数据库、密钥、运行时和 Tool 等 Server 私有能力保留在 `apps/server`，避免提前创建没有多个消费者的共享包。
