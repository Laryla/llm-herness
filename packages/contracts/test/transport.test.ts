import { describe, expect, it } from "vitest";

import {
  bootstrapResponseSchema,
  clientCommandSchema,
  createWorkspaceRequestSchema,
  serverEventSchema,
  type ServerEvent,
} from "../src/index.js";

const occurredAt = "2026-08-19T12:00:00.000Z";

function eventName(event: ServerEvent): string {
  switch (event.type) {
    case "turn.created":
    case "turn.status_changed":
    case "step.created":
    case "step.status_changed":
    case "step.content_delta":
    case "tool.confirmation_requested":
    case "queued_message.changed":
    case "steering_message.accepted":
    case "current_workspace.changed":
    case "current_model_selection.changed":
    case "current_tool_selection.changed":
    case "conversation.title_changed":
    case "runtime.error":
      return event.type;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

describe("REST 契约", () => {
  it("拒绝带额外字段的创建 Workspace 请求", () => {
    expect(
      createWorkspaceRequestSchema.safeParse({
        name: "项目",
        path: "/Users/demo/project",
        deleteFiles: true,
      }).success,
    ).toBe(false);
  });

  it("Bootstrap 响应可 JSON 序列化，且 Model Profile 不存在 apiKey", () => {
    const parsed = bootstrapResponseSchema.parse({
      apiVersion: "v1",
      data: {
        workspaces: [],
        currentWorkspace: null,
        modelProfiles: [],
        currentModelSelection: {
          selection: null,
          updatedAt: occurredAt,
        },
        tools: [],
        currentToolSelection: {
          selection: { toolIds: [] },
          updatedAt: occurredAt,
        },
      },
    });

    expect(JSON.parse(JSON.stringify(parsed))).toEqual(parsed);
    expect(JSON.stringify(parsed)).not.toContain("apiKey");
  });
});

describe("WebSocket 契约", () => {
  it("解析带稳定 ID、序号和实体 ID 的 Server Event", () => {
    const event = serverEventSchema.parse({
      apiVersion: "v1",
      eventId: "event_01JABCDEF0123456789",
      sequence: 42,
      occurredAt,
      type: "step.content_delta",
      conversationId: "conversation_01JABCDEF0123456789",
      turnId: "turn_01JABCDEF0123456789",
      stepId: "step_01JABCDEF0123456789",
      delta: "你好",
    });

    expect(eventName(event)).toBe("step.content_delta");
  });

  it.each([
    { sequence: 0 },
    { eventId: undefined },
    { stepId: undefined },
  ])("拒绝不完整事件：%o", (override) => {
    expect(
      serverEventSchema.safeParse({
        apiVersion: "v1",
        eventId: "event_01JABCDEF0123456789",
        sequence: 1,
        occurredAt,
        type: "step.content_delta",
        conversationId: "conversation_01JABCDEF0123456789",
        turnId: "turn_01JABCDEF0123456789",
        stepId: "step_01JABCDEF0123456789",
        delta: "x",
        ...override,
      }).success,
    ).toBe(false);
  });

  it("Client Command 只能通过可信 ID 选择 Tool，不能上传 Schema", () => {
    const command = {
      apiVersion: "v1",
      commandId: "command_01JABCDEF0123456789",
      type: "turn.create",
      conversationId: "conversation_01JABCDEF0123456789",
      content: "帮我计算",
      modelSelection: {
        profileId: "profile_01JABCDEF0123456789",
        modelName: "gpt-compatible",
      },
      toolSelection: { toolIds: ["tool_calculator"] },
      modelParameters: {},
    };

    expect(clientCommandSchema.safeParse(command).success).toBe(true);
    expect(
      clientCommandSchema.safeParse({
        ...command,
        tools: [{ id: "tool_bad", inputSchema: {} }],
      }).success,
    ).toBe(false);
  });
});
