import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createDatabase } from "../src/infrastructure/database/database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function createMigratedSqliteDatabase() {
  const directory = await mkdtemp(join(tmpdir(), "llm-harness-db-"));
  temporaryDirectories.push(directory);
  const databasePath = join(directory, "harness.db");
  const migration = await readFile(
    new URL(
      "../prisma/sqlite/migrations/20260819000100_init/migration.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const sqlite = new BetterSqlite3(databasePath);
  sqlite.exec(migration);
  sqlite.close();

  return createDatabase({ provider: "sqlite", url: `file:${databasePath}` });
}

describe("SQLite 持久化契约", () => {
  it("连接、健康检查并优雅关闭", async () => {
    const database = await createMigratedSqliteDatabase();

    await database.connect();
    await expect(database.isHealthy()).resolves.toBe(true);
    await database.disconnect();
  });

  it("保存核心运行记录并保持确定排序", async () => {
    const database = await createMigratedSqliteDatabase();
    await database.connect();
    const now = new Date("2026-08-19T12:00:00.000Z");

    await database.client.workspace.create({
      data: {
        id: "workspace_default",
        name: "默认工作空间",
        path: "/tmp/workspace",
        status: "available",
        createdAt: now,
        updatedAt: now,
      },
    });
    await database.client.conversation.create({
      data: {
        id: "conversation_test",
        workspaceId: "workspace_default",
        title: "测试",
        titleSource: "temporary",
        instructions: "",
        createdAt: now,
        updatedAt: now,
      },
    });
    await database.client.turn.create({
      data: {
        id: "turn_test",
        conversationId: "conversation_test",
        workspaceId: "workspace_default",
        status: "running",
        userMessage: "你好",
        modelSelectionSnapshot: { profileId: "profile_test", modelName: "model" },
        modelParametersSnapshot: {},
        toolBindingSnapshot: { tools: [] },
        instructionsSnapshot: "",
        maxIterations: 8,
        createdAt: now,
        updatedAt: now,
      },
    });

    for (const sequence of [2, 1]) {
      await database.client.step.create({
        data: {
          id: `step_${sequence}`,
          turnId: "turn_test",
          iterationIndex: 1,
          sequence,
          kind: sequence === 1 ? "model" : "tool",
          status: "completed",
          input: {},
          output: {},
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    const steps = await database.client.step.findMany({
      where: { turnId: "turn_test" },
      orderBy: { sequence: "asc" },
    });

    expect(steps.map(({ sequence }) => sequence)).toEqual([1, 2]);
    await database.disconnect();
  });

  it("事务失败时不保存部分状态迁移", async () => {
    const database = await createMigratedSqliteDatabase();
    await database.connect();
    await database.client.workspace.create({
      data: {
        id: "workspace_rollback",
        name: "回滚测试",
        path: "/tmp/rollback",
        status: "available",
      },
    });

    await expect(
      database.client.$transaction(async (transaction) => {
        await transaction.workspace.update({
          where: { id: "workspace_rollback" },
          data: { status: "unavailable" },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await expect(
      database.client.workspace.findUniqueOrThrow({
        where: { id: "workspace_rollback" },
      }),
    ).resolves.toMatchObject({ status: "available" });
    await database.disconnect();
  });

  it("ModelProfile 表不存在明文 API Key 字段", async () => {
    const database = await createMigratedSqliteDatabase();
    await database.connect();

    const columns = await database.client.$queryRawUnsafe<
      Array<{ name: string }>
    >("PRAGMA table_info('ModelProfile')");

    expect(columns.map(({ name }) => name.toLowerCase())).not.toContain("apikey");
    expect(columns.map(({ name }) => name.toLowerCase())).not.toContain("api_key");
    await database.disconnect();
  });
});
