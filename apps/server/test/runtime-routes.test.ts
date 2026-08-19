import type { ClientCommand, ServerEvent } from "@llm-harness/contracts";
import type { RawData, WebSocket } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import type {
  RuntimeEventListener,
  RuntimeGateway,
} from "../src/modules/runtime/runtime-gateway.js";

class FakeRuntimeGateway implements RuntimeGateway {
  readonly dispatch = vi.fn<(command: Exclude<ClientCommand, { type: "runtime.subscribe" }>) => Promise<void>>(
    () => Promise.resolve(),
  );
  private listener?: RuntimeEventListener;
  afterSequence?: number;

  subscribe(afterSequence: number, listener: RuntimeEventListener): () => void {
    this.afterSequence = afterSequence;
    this.listener = listener;
    return () => {
      this.listener = undefined;
    };
  }

  publish(event: ServerEvent): void {
    this.listener?.(event);
  }
}

function nextMessage(socket: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    socket.once("message", (data) =>
      resolve(JSON.parse(decodeRawData(data)) as unknown),
    );
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

describe("Runtime WebSocket 路由", () => {
  const apps: Array<ReturnType<typeof createApp>> = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it("拒绝无效 JSON 和无效 Command", async () => {
    const app = createApp({ runtimeGateway: new FakeRuntimeGateway() });
    apps.push(app);
    await app.ready();
    const socket = await app.injectWS("/api/v1/runtime");

    const invalidJson = nextMessage(socket);
    socket.send("{");
    await expect(invalidJson).resolves.toMatchObject({
      apiVersion: "v1",
      error: { code: "invalid_json", retryable: false },
    });

    const invalidCommand = nextMessage(socket);
    socket.send(JSON.stringify({ apiVersion: "v1", commandId: "command_1" }));
    await expect(invalidCommand).resolves.toMatchObject({
      apiVersion: "v1",
      commandId: "command_1",
      error: { code: "invalid_command", retryable: false },
    });
    socket.close();
  });

  it("订阅事件并把控制命令交给 Runtime Gateway", async () => {
    const gateway = new FakeRuntimeGateway();
    const app = createApp({ runtimeGateway: gateway });
    apps.push(app);
    await app.ready();
    const socket = await app.injectWS("/api/v1/runtime");
    socket.send(
      JSON.stringify({
        apiVersion: "v1",
        commandId: "command_subscribe",
        type: "runtime.subscribe",
        afterSequence: 4,
      }),
    );
    await vi.waitFor(() => expect(gateway.afterSequence).toBe(4));

    const received = nextMessage(socket);
    gateway.publish({
      apiVersion: "v1",
      eventId: "event_5",
      sequence: 5,
      occurredAt: new Date().toISOString(),
      type: "turn.status_changed",
      conversationId: "conversation_1",
      turnId: "turn_1",
      status: "running",
    });
    await expect(received).resolves.toMatchObject({
      type: "turn.status_changed",
      sequence: 5,
    });

    socket.send(
      JSON.stringify({
        apiVersion: "v1",
        commandId: "command_cancel",
        type: "turn.cancel",
        conversationId: "conversation_1",
        turnId: "turn_1",
      }),
    );
    await vi.waitFor(() => expect(gateway.dispatch).toHaveBeenCalledOnce());
    expect(gateway.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: "turn.cancel", turnId: "turn_1" }),
    );
    socket.close();
  });
});
