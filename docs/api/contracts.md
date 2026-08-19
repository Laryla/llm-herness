# 共享契约

`packages/contracts` 是 Web、Server 以及未来 CLI、浏览器插件之间唯一的跨边界类型来源。客户端和服务端不得复制 DTO，也不得维护平行的手写接口。

## 使用方式

```ts
import {
  clientCommandSchema,
  serverEventSchema,
  type ClientCommand,
  type ServerEvent,
} from "@llm-harness/contracts";
```

在不可信边界使用 Zod Schema 解析输入；通过解析后再使用由 Schema 推导出的 TypeScript 类型。

## 模块

- `common`：协议版本、实体 ID、ISO 时间与错误 Envelope。
- `workspace`：Workspace 与 Current Workspace。
- `model`：Model Profile、Model Catalog、Model Selection 和模型参数。
- `tool`：Tool、Tool Policy、Tool Selection 与 Turn 级 Tool Binding 快照。
- `conversation`：Conversation、Turn、Iteration、Step 与状态。
- `message`：对话消息、Queued Message、Steering Message 与 Trace。
- `rest`：资源请求、响应和首次加载 Bootstrap 快照。
- `websocket`：Client Command 与 Server Event 可判别联合。

## 版本规则

- 当前协议版本固定为 `v1`。
- REST 成功响应与错误响应必须包含 `apiVersion`。
- WebSocket Command 与 Event 必须包含 `apiVersion`。
- 未知版本和未知字段默认拒绝，避免客户端静默接受不兼容数据。

## WebSocket 事件规则

每个 Server Event 必须包含：

- 稳定的 `eventId`；
- 从 1 开始单调递增的 `sequence`；
- ISO 8601 格式的 `occurredAt`；
- 与事件相关的 Conversation、Turn、Step 或资源 ID；
- 用于可判别联合的 `type`。

客户端必须对 `ServerEvent["type"]` 做穷尽处理。重连时先读取 REST 持久化快照，再通过 `runtime.subscribe` 的 `afterSequence` 订阅后续事件。

## 安全约束

- Model Profile 响应只包含 Secret 引用和脱敏值，不包含明文 API Key。
- 创建或更新 Model Profile 时的 `secretValue` 只存在于请求边界，不属于持久化资源。
- Client 创建 Turn 时只提交 `toolIds`，不能提交 Tool Schema、Policy 或可执行代码。
- Turn 必须保存 Model Selection、模型参数、Tool Binding、Instructions 与最大 Iteration 快照。
