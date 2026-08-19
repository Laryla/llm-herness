import { describe, expect, it } from "vitest";

import {
  modelCatalogSchema,
  queuedMessageSchema,
  steeringMessageSchema,
  toolBindingSnapshotSchema,
  traceSchema,
} from "../src/index.js";

const occurredAt = "2026-08-19T12:00:00.000Z";

describe("运行资源契约", () => {
  it("Model Catalog 区分自动发现与手动条目", () => {
    const catalog = modelCatalogSchema.parse({
      profileId: "profile_01JABCDEF0123456789",
      refreshedAt: occurredAt,
      entries: [
        {
          id: "catalog_01JABCDEF0123456789",
          profileId: "profile_01JABCDEF0123456789",
          modelName: "model-a",
          source: "discovered",
          createdAt: occurredAt,
          updatedAt: occurredAt,
        },
      ],
    });

    expect(catalog.entries[0]?.source).toBe("discovered");
  });

  it("Tool Binding 快照拒绝重复模型函数名", () => {
    const tool = {
      id: "tool_calculator",
      modelName: "calculate",
      description: "执行计算",
      policy: "automatic",
      inputSchema: { type: "object" },
      outputSchema: { type: "number" },
    } as const;

    expect(
      toolBindingSnapshotSchema.safeParse({
        tools: [tool, { ...tool, id: "tool_other" }],
      }).success,
    ).toBe(false);
  });

  it("Queued Message 保存顺序但不保存模型或 Tool 选择", () => {
    const message = {
      id: "queued_01JABCDEF0123456789",
      conversationId: "conversation_01JABCDEF0123456789",
      content: "下一条消息",
      position: 0,
      status: "queued",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(queuedMessageSchema.safeParse(message).success).toBe(true);
    expect(
      queuedMessageSchema.safeParse({
        ...message,
        modelSelection: { profileId: "profile_x", modelName: "x" },
      }).success,
    ).toBe(false);
  });

  it("Steering Message 始终关联当前 Turn", () => {
    expect(
      steeringMessageSchema.safeParse({
        id: "steering_01JABCDEF0123456789",
        conversationId: "conversation_01JABCDEF0123456789",
        content: "补充限制",
        status: "accepted",
        createdAt: occurredAt,
      }).success,
    ).toBe(false);
  });

  it("Trace 按 Turn 聚合 Iteration、Step 与 Steering Message", () => {
    const turn = {
      id: "turn_01JABCDEF0123456789",
      conversationId: "conversation_01JABCDEF0123456789",
      workspaceId: "workspace_01JABCDEF0123456789",
      status: "completed",
      userMessage: "你好",
      modelSelection: {
        profileId: "profile_01JABCDEF0123456789",
        modelName: "model-a",
      },
      modelParameters: {},
      toolBinding: { tools: [] },
      instructions: "",
      maxIterations: 50,
      createdAt: occurredAt,
      completedAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(
      traceSchema.safeParse({
        turn,
        iterations: [],
        steps: [],
        steeringMessages: [],
      }).success,
    ).toBe(true);
  });
});
