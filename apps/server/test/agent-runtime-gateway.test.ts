import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import Fastify, { type FastifyInstance } from "fastify";
import type { RawData, WebSocket } from "ws";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { SecretStore } from "../src/infrastructure/secrets/secret-store.js";

class MemorySecretStore implements SecretStore {
  readonly source = "keychain" as const;
  readonly values = new Map<string, string>();

  isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  get(reference: string): Promise<string | null> {
    return Promise.resolve(this.values.get(reference) ?? null);
  }

  set(reference: string, value: string): Promise<void> {
    this.values.set(reference, value);
    return Promise.resolve();
  }

  delete(reference: string): Promise<void> {
    this.values.delete(reference);
    return Promise.resolve();
  }
}

const temporaryDirectories: string[] = [];
const upstreamServers: FastifyInstance[] = [];
const harnessApps: Array<ReturnType<typeof createApp>> = [];

afterEach(async () => {
  await Promise.all(harnessApps.splice(0).map((app) => app.close()));
  await Promise.all(upstreamServers.splice(0).map((server) => server.close()));
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function createMigratedDatabase() {
  const root = await mkdtemp(join(tmpdir(), "llm-harness-runtime-"));
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
  return { database, root };
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

function collectUntilCompleted(socket: WebSocket, expectedTurns = 1): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  let completedTurns = 0;
  return new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      const event = JSON.parse(decodeRawData(data)) as Record<string, unknown>;
      events.push(event);
      if (event.type === "turn.status_changed" && event.status === "completed") {
        completedTurns += 1;
        if (completedTurns === expectedTurns) resolve(events);
      }
      if ("error" in event) {
        reject(new Error(JSON.stringify(event.error)));
      }
    });
  });
}

describe("Agent Runtime Gateway", () => {
  it("通过 WebSocket 完成 Turn，并按顺序启动持久化的排队消息", async () => {
    const upstream = Fastify();
    upstreamServers.push(upstream);
    upstream.post("/v1/chat/completions", async (_request, reply) => {
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      reply.raw.write(
        `data: ${JSON.stringify({
          id: "chatcmpl_runtime",
          object: "chat.completion.chunk",
          created: 1,
          model: "model-a",
          choices: [{ index: 0, delta: { content: "运行完成" }, finish_reason: null }],
        })}\n\n`,
      );
      reply.raw.write(
        `data: ${JSON.stringify({
          id: "chatcmpl_runtime",
          object: "chat.completion.chunk",
          created: 1,
          model: "model-a",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        })}\n\n`,
      );
      reply.raw.end("data: [DONE]\n\n");
    });
    const upstreamAddress = await upstream.listen({ host: "127.0.0.1", port: 0 });
    const { database, root } = await createMigratedDatabase();
    await database.client.workspace.create({
      data: {
        id: "workspace_runtime",
        name: "Runtime",
        path: root,
        status: "available",
      },
    });
    await database.client.conversation.create({
      data: {
        id: "conversation_runtime",
        workspaceId: "workspace_runtime",
        title: "运行测试",
        titleSource: "temporary",
        instructions: "请简洁回答",
      },
    });
    await database.client.modelProfile.create({
      data: {
        id: "profile_runtime",
        displayName: "测试模型",
        modelName: "model-a",
        baseUrl: `${upstreamAddress}/v1`,
        secretSource: "keychain",
        secretReference: "profile_runtime",
        maskedSecret: "****",
        connectionStatus: "succeeded",
      },
    });
    await database.client.harnessSettings.create({
      data: {
        id: "settings_default",
        currentModelProfileId: "profile_runtime",
        currentModelName: "model-a",
        currentToolIds: [],
        maxIterations: 8,
      },
    });
    const secrets = new MemorySecretStore();
    secrets.values.set("profile_runtime", "runtime-secret");
    const app = createApp({
      database,
      maxSteps: 8,
      secretStores: { keychain: secrets, local: secrets, environment: secrets, writable: secrets },
    });
    harnessApps.push(app);
    await app.ready();
    const socket = await app.injectWS("/api/v1/runtime");
    const completed = collectUntilCompleted(socket, 2);
    let queuedMessageSent = false;
    socket.on("message", (data) => {
      const event = JSON.parse(decodeRawData(data)) as Record<string, unknown>;
      if (!queuedMessageSent && event.type === "turn.status_changed" && event.status === "running") {
        queuedMessageSent = true;
        socket.send(JSON.stringify({
          apiVersion: "v1",
          commandId: "command_queue",
          type: "queued_message.create",
          conversationId: "conversation_runtime",
          content: "排队继续运行",
        }));
      }
    });

    socket.send(
      JSON.stringify({
        apiVersion: "v1",
        commandId: "command_subscribe",
        type: "runtime.subscribe",
        afterSequence: 0,
      }),
    );
    socket.send(
      JSON.stringify({
        apiVersion: "v1",
        commandId: "command_turn",
        type: "turn.create",
        conversationId: "conversation_runtime",
        content: "开始运行",
        modelSelection: { profileId: "profile_runtime", modelName: "model-a" },
        toolSelection: { toolIds: [] },
        modelParameters: {},
      }),
    );

    const events = await completed;
    expect(events.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "turn.created",
        "turn.status_changed",
        "step.created",
        "step.content_delta",
        "step.status_changed",
        "queued_message.changed",
      ]),
    );
    const turns = await database.client.turn.findMany({ orderBy: { createdAt: "asc" } });
    const steps = await database.client.step.findMany({ orderBy: { sequence: "asc" } });
    const messages = await database.client.message.findMany({ orderBy: { sequence: "asc" } });
    const conversation = await database.client.conversation.findUniqueOrThrow({
      where: { id: "conversation_runtime" },
    });
    expect(turns).toHaveLength(2);
    expect(turns).toEqual(expect.arrayContaining([expect.objectContaining({ status: "completed", maxIterations: 8 })]));
    expect(steps).toHaveLength(3);
    expect(steps.filter(({ kind }) => kind === "model")).toHaveLength(2);
    expect(steps.filter(({ kind }) => kind === "model").every((step) => step.status === "completed" && (step.output as { content?: string } | null)?.content === "运行完成")).toBe(true);
    expect(steps.find(({ kind }) => kind === "title_generation")).toMatchObject({ status: "completed" });
    expect(conversation).toMatchObject({
      title: "运行完成",
      titleSource: "generated",
    });
    expect(messages.map(({ role, content }) => [role, content])).toEqual([
      ["user", "开始运行"],
      ["assistant", "运行完成"],
      ["user", "排队继续运行"],
      ["assistant", "运行完成"],
    ]);
    await expect(database.client.queuedMessage.count()).resolves.toBe(0);
    socket.close();
  });
});
