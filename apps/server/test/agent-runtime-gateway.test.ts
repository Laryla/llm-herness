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

function collectUntilCompleted(socket: WebSocket): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  return new Promise((resolve, reject) => {
    socket.on("message", (data) => {
      const event = JSON.parse(decodeRawData(data)) as Record<string, unknown>;
      events.push(event);
      if (event.type === "turn.status_changed" && event.status === "completed") {
        resolve(events);
      }
      if ("error" in event) {
        reject(new Error(JSON.stringify(event.error)));
      }
    });
  });
}

describe("Agent Runtime Gateway", () => {
  it("通过 WebSocket 创建 Turn，流式发布事件并持久化 Trace", async () => {
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
        baseUrl: `${upstreamAddress}/v1`,
        secretSource: "keychain",
        secretReference: "profile_runtime",
        maskedSecret: "****",
        connectionStatus: "succeeded",
      },
    });
    await database.client.modelCatalogEntry.create({
      data: {
        id: "catalog_runtime",
        profileId: "profile_runtime",
        modelName: "model-a",
        source: "manual",
      },
    });
    const secrets = new MemorySecretStore();
    secrets.values.set("profile_runtime", "runtime-secret");
    const app = createApp({
      database,
      maxSteps: 8,
      secretStores: { keychain: secrets, environment: secrets, writable: secrets },
    });
    harnessApps.push(app);
    await app.ready();
    const socket = await app.injectWS("/api/v1/runtime");
    const completed = collectUntilCompleted(socket);

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
      ]),
    );
    const turn = await database.client.turn.findFirstOrThrow();
    const steps = await database.client.step.findMany({ orderBy: { sequence: "asc" } });
    const messages = await database.client.message.findMany({ orderBy: { sequence: "asc" } });
    const conversation = await database.client.conversation.findUniqueOrThrow({
      where: { id: "conversation_runtime" },
    });
    expect(turn).toMatchObject({ status: "completed", maxIterations: 8 });
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ status: "completed", kind: "model" });
    expect(steps[0]?.output).toMatchObject({ content: "运行完成" });
    expect(steps[1]).toMatchObject({ status: "completed", kind: "title_generation" });
    expect(conversation).toMatchObject({
      title: "运行完成",
      titleSource: "generated",
    });
    expect(messages.map(({ role, content }) => [role, content])).toEqual([
      ["user", "开始运行"],
      ["assistant", "运行完成"],
    ]);
    socket.close();
  });
});
