import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import {
  conversationResponseSchema,
  traceResponseSchema,
} from "@llm-harness/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import {
  ConversationService,
  interruptActiveTurns,
} from "../src/modules/conversations/conversation-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function createTestContext() {
  const root = await mkdtemp(join(tmpdir(), "llm-harness-conversation-"));
  temporaryDirectories.push(root);
  const databasePath = join(root, "harness.db");
  const sqlite = new BetterSqlite3(databasePath);
  for (const migrationName of [
    "20260819000100_init",
    "20260819000200_model_catalog_refresh",
    "20260819000300_tool_confirmation_calls",
    "20260820000100_unify_model_profile",
  ]) {
    sqlite.exec(
      await readFile(
        new URL(
          `../prisma/sqlite/migrations/${migrationName}/migration.sql`,
          import.meta.url,
        ),
        "utf8",
      ),
    );
  }
  sqlite.close();
  const database = createDatabase({ provider: "sqlite", url: `file:${databasePath}` });
  await database.connect();
  await database.client.workspace.create({
    data: {
      id: "workspace_conversation",
      name: "Conversation",
      path: root,
      status: "available",
    },
  });
  return { database, root, service: new ConversationService(database.client) };
}

describe("Conversation、Turn 与 Trace", () => {
  it("创建临时标题，并在用户重命名后更新标题来源", async () => {
    const { database, service } = await createTestContext();
    const firstMessage = "这是一个用于验证中文标题截取行为的很长很长的第一条消息内容";

    const created = await service.create({
      workspaceId: "workspace_conversation",
      firstMessage,
      instructions: "保持简洁",
    });
    const updated = await service.update(created.id, { title: "用户标题" });

    expect(created.title).toBe(Array.from(firstMessage).slice(0, 30).join(""));
    expect(Array.from(created.title).length).toBeLessThanOrEqual(30);
    expect(created).toMatchObject({
      titleSource: "temporary",
      instructions: "保持简洁",
    });
    expect(updated).toMatchObject({ title: "用户标题", titleSource: "user" });
    await database.disconnect();
  });

  it("通过 REST 创建、筛选、读取和删除 Conversation", async () => {
    const { database } = await createTestContext();
    const app = createApp({ database });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/conversations",
      payload: {
        workspaceId: "workspace_conversation",
        firstMessage: "REST 第一条消息",
        instructions: "",
      },
    });
    const parsed = conversationResponseSchema.parse(created.json());
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/conversations?workspaceId=workspace_conversation",
    });
    const fetched = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${parsed.data.id}`,
    });

    expect(created.statusCode).toBe(201);
    expect(listed.json().data).toHaveLength(1);
    expect(fetched.json()).toEqual(parsed);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/v1/conversations/${parsed.data.id}`,
        })
      ).statusCode,
    ).toBe(204);
    await app.close();
  });

  it("活动 Turn 存在时拒绝删除 Conversation", async () => {
    const { database, service } = await createTestContext();
    const conversation = await service.create({
      workspaceId: "workspace_conversation",
      firstMessage: "活动 Turn",
      instructions: "",
    });
    await database.client.turn.create({
      data: {
        id: "turn_active",
        conversationId: conversation.id,
        workspaceId: "workspace_conversation",
        status: "running",
        userMessage: "运行中",
        modelSelectionSnapshot: { profileId: "profile_1", modelName: "model-a" },
        modelParametersSnapshot: {},
        toolBindingSnapshot: { tools: [] },
        instructionsSnapshot: "",
        maxIterations: 8,
      },
    });

    await expect(service.remove(conversation.id)).rejects.toMatchObject({
      code: "conversation_busy",
    });
    await database.disconnect();
  });

  it("按顺序返回 Turn Trace 和已应用的强制消息", async () => {
    const { database, service } = await createTestContext();
    const conversation = await service.create({
      workspaceId: "workspace_conversation",
      firstMessage: "Trace",
      instructions: "指令",
    });
    await database.client.turn.create({
      data: {
        id: "turn_trace",
        conversationId: conversation.id,
        workspaceId: "workspace_conversation",
        status: "completed",
        userMessage: "开始",
        modelSelectionSnapshot: { profileId: "profile_1", modelName: "model-a" },
        modelParametersSnapshot: {},
        toolBindingSnapshot: { tools: [] },
        instructionsSnapshot: "指令",
        maxIterations: 8,
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        completedAt: new Date("2026-08-19T00:00:02.000Z"),
      },
    });
    await database.client.step.create({
      data: {
        id: "step_trace",
        turnId: "turn_trace",
        iterationIndex: 1,
        sequence: 1,
        kind: "model",
        status: "completed",
        input: { messages: 1 },
        output: { content: "完成" },
        usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
        startedAt: new Date("2026-08-19T00:00:00.000Z"),
        completedAt: new Date("2026-08-19T00:00:01.000Z"),
      },
    });
    await database.client.message.create({
      data: {
        id: "message_steering",
        conversationId: conversation.id,
        turnId: "turn_trace",
        sequence: 1,
        role: "user",
        source: "steering",
        content: "补充要求",
      },
    });

    const app = createApp({ database });
    const response = await app.inject({
      method: "GET",
      url: `/api/v1/conversations/${conversation.id}/turns/turn_trace/trace`,
    });
    const trace = traceResponseSchema.parse(response.json()).data;

    expect(trace.steps).toHaveLength(1);
    expect(trace.iterations).toMatchObject([
      { id: "iteration_trace_1", index: 1, status: "completed" },
    ]);
    expect(trace.steeringMessages).toMatchObject([
      { id: "message_steering", status: "applied", content: "补充要求" },
    ]);
    await app.close();
  });

  it("启动恢复将遗留活动 Turn 和 Step 标记为 interrupted", async () => {
    const { database, service } = await createTestContext();
    const conversation = await service.create({
      workspaceId: "workspace_conversation",
      firstMessage: "恢复",
      instructions: "",
    });
    await database.client.turn.create({
      data: {
        id: "turn_interrupted",
        conversationId: conversation.id,
        workspaceId: "workspace_conversation",
        status: "running",
        userMessage: "未完成",
        modelSelectionSnapshot: { profileId: "profile_1", modelName: "model-a" },
        modelParametersSnapshot: {},
        toolBindingSnapshot: { tools: [] },
        instructionsSnapshot: "",
        maxIterations: 8,
        steps: {
          create: {
            id: "step_interrupted",
            sequence: 1,
            kind: "model",
            status: "running",
            input: {},
          },
        },
      },
    });

    await expect(interruptActiveTurns(database.client)).resolves.toEqual({
      turns: 1,
      steps: 1,
    });
    await expect(
      database.client.turn.findUniqueOrThrow({ where: { id: "turn_interrupted" } }),
    ).resolves.toMatchObject({
      status: "interrupted",
      error: { code: "server_restarted" },
    });
    await expect(
      database.client.step.findUniqueOrThrow({ where: { id: "step_interrupted" } }),
    ).resolves.toMatchObject({ status: "interrupted" });
    await database.disconnect();
  });
});
