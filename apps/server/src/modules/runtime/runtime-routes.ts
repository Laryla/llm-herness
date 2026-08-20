import { randomUUID } from "node:crypto";

import {
  API_VERSION,
  clientCommandSchema,
  type ContractError,
} from "@llm-harness/contracts";
import type { FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";

import {
  RuntimeGatewayError,
  type RuntimeGateway,
} from "./runtime-gateway.js";

/** WebSocket 直接错误 Envelope；命令未进入 Runtime 时不占用全局事件序号。 */
interface RuntimeErrorEnvelope {
  readonly apiVersion: typeof API_VERSION;
  readonly commandId?: string;
  readonly error: ContractError;
}

/** 注册统一 Runtime WebSocket，处理订阅、Turn 控制、取消和强制消息命令。 */
export function registerRuntimeRoutes(
  app: FastifyInstance,
  gateway: RuntimeGateway,
): void {
  app.get(
    "/api/v1/runtime",
    { websocket: true },
    (socket) => handleRuntimeConnection(socket, gateway, app),
  );
}

function handleRuntimeConnection(
  socket: WebSocket,
  gateway: RuntimeGateway,
  app: FastifyInstance,
): void {
  const connectionId = `connection_${randomUUID().replaceAll("-", "")}`;
  let unsubscribe: (() => void) | undefined;
  let commandChain = Promise.resolve();
  app.log.info({ connectionId }, "Runtime WebSocket 已连接");

  // 同步注册消息处理器，避免连接建立和异步初始化之间丢失 Client Command。
  socket.on("message", (data) => {
    // 同一连接的 Command 严格串行，确保 subscribe 一定先于随后发送的 turn.create 生效。
    commandChain = commandChain
      .then(() =>
        handleCommand(decodeRawData(data), socket, gateway, (next) => {
          unsubscribe?.();
          unsubscribe = next;
        }),
      )
      .catch((error: unknown) => {
        app.log.warn({ connectionId, err: error }, "Runtime WebSocket 命令处理失败");
        sendError(socket, toContractError(error));
      });
  });
  socket.once("close", () => {
    unsubscribe?.();
    app.log.info({ connectionId }, "Runtime WebSocket 已断开");
  });
  socket.once("error", (error) => {
    app.log.warn({ connectionId, err: error }, "Runtime WebSocket 连接错误");
  });
}

function decodeRawData(data: RawData): string {
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  return data.toString("utf8");
}

async function handleCommand(
  payload: string,
  socket: WebSocket,
  gateway: RuntimeGateway,
  replaceSubscription: (unsubscribe: () => void) => void,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(payload) as unknown;
  } catch {
    sendError(socket, {
      code: "invalid_json",
      message: "Runtime Command 必须是有效的 JSON",
      retryable: false,
    });
    return;
  }
  const parsed = clientCommandSchema.safeParse(value);
  if (!parsed.success) {
    sendError(
      socket,
      {
        code: "invalid_command",
        message: "Runtime Command 参数无效",
        retryable: false,
        details: { issues: parsed.error.issues },
      },
      readCommandId(value),
    );
    return;
  }
  const command = parsed.data;
  if (command.type === "runtime.subscribe") {
    replaceSubscription(
      gateway.subscribe(command.afterSequence, (event) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(event));
        }
      }),
    );
    return;
  }
  try {
    await gateway.dispatch(command);
  } catch (error) {
    sendError(socket, toContractError(error), command.commandId);
  }
}

function sendError(
  socket: WebSocket,
  error: ContractError,
  commandId?: string,
): void {
  if (socket.readyState !== socket.OPEN) {
    return;
  }
  const envelope: RuntimeErrorEnvelope = {
    apiVersion: API_VERSION,
    ...(commandId ? { commandId } : {}),
    error,
  };
  socket.send(JSON.stringify(envelope));
}

function toContractError(error: unknown): ContractError {
  if (error instanceof RuntimeGatewayError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error.entityId ? { details: { entityId: error.entityId } } : {}),
    };
  }
  return {
    code: "runtime_command_failed",
    message: "Runtime Command 处理失败",
    retryable: false,
  };
}

function readCommandId(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("commandId" in value)) {
    return undefined;
  }
  return typeof value.commandId === "string" ? value.commandId : undefined;
}
