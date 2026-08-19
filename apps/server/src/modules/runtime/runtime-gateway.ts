import type { ClientCommand, ServerEvent } from "@llm-harness/contracts";

export type RuntimeEventListener = (event: ServerEvent) => void;

/**
 * WebSocket 传输层依赖的运行网关。
 * 具体实现负责持有活动 Run、写数据库并生成全局递增事件；路由只管理连接和协议校验。
 */
export interface RuntimeGateway {
  subscribe(afterSequence: number, listener: RuntimeEventListener): () => void;
  dispatch(command: Exclude<ClientCommand, { type: "runtime.subscribe" }>): Promise<void>;
}

export class RuntimeGatewayError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly entityId?: string,
  ) {
    super(message);
    this.name = "RuntimeGatewayError";
  }
}
