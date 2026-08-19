import { describe, expect, it } from "vitest";

import {
  conversationSchema,
  modelParametersSchema,
  modelProfileSchema,
  stepSchema,
  toolSelectionSchema,
  turnSchema,
  workspaceSchema,
} from "../src/index.js";

const occurredAt = "2026-08-19T12:00:00.000Z";

describe("领域资源契约", () => {
  it("解析 Workspace，并明确标记路径可用性", () => {
    expect(
      workspaceSchema.parse({
        id: "workspace_01JABCDEF0123456789",
        name: "默认工作空间",
        path: "/Users/demo/.llm/workspaces/default",
        status: "available",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }).status,
    ).toBe("available");
  });

  it("Model Profile 只接受 URL 和密钥引用，不接受明文 apiKey", () => {
    const profile = {
      id: "profile_01JABCDEF0123456789",
      displayName: "Local Model",
      baseUrl: "http://127.0.0.1:11434/v1",
      secret: {
        source: "keychain",
        reference: "llm-harness/profile_01JABCDEF0123456789",
        maskedValue: "sk-••••1234",
      },
      connection: { status: "untested" },
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(modelProfileSchema.safeParse(profile).success).toBe(true);
    expect(
      modelProfileSchema.safeParse({ ...profile, apiKey: "sk-plaintext" }).success,
    ).toBe(false);
    expect(
      modelProfileSchema.safeParse({ ...profile, baseUrl: "not-a-url" }).success,
    ).toBe(false);
  });

  it("限制模型参数并拒绝未知 extra_body", () => {
    expect(
      modelParametersSchema.safeParse({
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 2048,
        stop: ["END"],
      }).success,
    ).toBe(true);
    expect(
      modelParametersSchema.safeParse({ temperature: 3, extraBody: {} }).success,
    ).toBe(false);
  });

  it("Tool Selection 不允许重复 ID", () => {
    expect(
      toolSelectionSchema.safeParse({
        toolIds: ["tool_calculator", "tool_calculator"],
      }).success,
    ).toBe(false);
  });

  it("Conversation 固定归属 Workspace", () => {
    expect(
      conversationSchema.parse({
        id: "conversation_01JABCDEF0123456789",
        workspaceId: "workspace_01JABCDEF0123456789",
        title: "你好",
        titleSource: "temporary",
        instructions: "回答保持简洁",
        createdAt: occurredAt,
        updatedAt: occurredAt,
      }).workspaceId,
    ).toBe("workspace_01JABCDEF0123456789");
  });

  it("Turn 强制保存运行快照，并限制 maxIterations 为 1–100", () => {
    const turn = {
      id: "turn_01JABCDEF0123456789",
      conversationId: "conversation_01JABCDEF0123456789",
      workspaceId: "workspace_01JABCDEF0123456789",
      status: "running",
      userMessage: "计算 1 + 1",
      modelSelection: {
        profileId: "profile_01JABCDEF0123456789",
        modelName: "gpt-compatible",
      },
      modelParameters: { temperature: 0.2 },
      toolBinding: { tools: [] },
      instructions: "",
      maxIterations: 50,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };

    expect(turnSchema.safeParse(turn).success).toBe(true);
    expect(
      turnSchema.safeParse({ ...turn, maxIterations: 101 }).success,
    ).toBe(false);
  });

  it("Step 使用 kind 判别，并保存 Trace 所需的顺序和状态", () => {
    const parsed = stepSchema.parse({
      id: "step_01JABCDEF0123456789",
      turnId: "turn_01JABCDEF0123456789",
      iterationId: "iteration_01JABCDEF0123456789",
      sequence: 2,
      kind: "model",
      status: "completed",
      input: { messageIds: ["message_01JABCDEF0123456789"] },
      output: { content: "2" },
      usage: { inputTokens: 10, outputTokens: 1, totalTokens: 11 },
      startedAt: occurredAt,
      completedAt: occurredAt,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    });

    expect(parsed.kind).toBe("model");
  });
});
