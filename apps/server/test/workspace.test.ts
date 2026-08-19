import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import {
  initializeWorkspaces,
  WorkspaceService,
} from "../src/modules/workspaces/workspace-service.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function createTestContext() {
  const root = await mkdtemp(join(tmpdir(), "llm-harness-workspace-"));
  temporaryDirectories.push(root);
  const databasePath = join(root, "harness.db");
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
  const database = createDatabase({
    provider: "sqlite",
    url: `file:${databasePath}`,
  });
  await database.connect();
  return { database, root, service: new WorkspaceService(database.client) };
}

describe("Workspace 管理", () => {
  it("首次初始化默认 Workspace，重复启动不覆盖用户选择", async () => {
    const { database, root, service } = await createTestContext();
    const defaultPath = join(root, "default");
    const otherPath = join(root, "other");
    await mkdir(defaultPath);
    await mkdir(otherPath);

    await initializeWorkspaces(database.client, defaultPath);
    const other = await service.create({ name: "其他", path: otherPath });
    await service.setCurrent(other.id);
    await initializeWorkspaces(database.client, defaultPath);

    await expect(service.getCurrent()).resolves.toMatchObject({
      workspaceId: other.id,
    });
    await expect(service.list()).resolves.toHaveLength(2);
    await database.disconnect();
  });

  it("规范化路径、解析符号链接并拒绝重复注册", async () => {
    const { database, root, service } = await createTestContext();
    const target = join(root, "target");
    const link = join(root, "link");
    await mkdir(target);
    await symlink(target, link);

    const workspace = await service.create({ name: "链接", path: link });

    expect(workspace.path).toBe(await realpath(target));
    await expect(
      service.create({ name: "重复", path: target }),
    ).rejects.toMatchObject({ code: "path_conflict" });
    await expect(
      service.create({ name: "相对路径", path: "../escape" }),
    ).rejects.toMatchObject({ code: "invalid_path" });
    await database.disconnect();
  });

  it("目录移动后刷新为 unavailable，并可通过更新路径恢复", async () => {
    const { database, root, service } = await createTestContext();
    const original = join(root, "original");
    const restored = join(root, "restored");
    await mkdir(original);
    const workspace = await service.create({ name: "项目", path: original });
    await rm(original, { recursive: true });

    await expect(service.list()).resolves.toMatchObject([
      { id: workspace.id, status: "unavailable" },
    ]);
    await expect(service.setCurrent(workspace.id)).rejects.toMatchObject({
      code: "invalid_path",
    });

    await mkdir(restored);
    await expect(
      service.update(workspace.id, { path: restored }),
    ).resolves.toMatchObject({
      path: await realpath(restored),
      status: "available",
    });
    await database.disconnect();
  });

  it("删除记录不删除磁盘目录，并为 Current Workspace 选择后备项", async () => {
    const { database, root, service } = await createTestContext();
    const firstPath = join(root, "first");
    const secondPath = join(root, "second");
    await mkdir(firstPath);
    await mkdir(secondPath);
    const first = await service.create({ name: "第一", path: firstPath });
    const second = await service.create({ name: "第二", path: secondPath });
    await service.setCurrent(first.id);

    await service.remove(first.id);

    await expect(service.getCurrent()).resolves.toMatchObject({
      workspaceId: second.id,
    });
    await expect(stat(firstPath)).resolves.toBeDefined();
    await database.disconnect();
  });

  it("REST API 校验请求并返回统一 Envelope", async () => {
    const { database, root } = await createTestContext();
    const workspacePath = join(root, "api-workspace");
    await mkdir(workspacePath);
    const app = createApp({ database });

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      payload: { name: "API", path: "relative" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json()).toMatchObject({
      apiVersion: "v1",
      error: { code: "invalid_path" },
    });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/workspaces",
      payload: { name: "API", path: workspacePath },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      apiVersion: "v1",
      data: {
        name: "API",
        path: await realpath(workspacePath),
        status: "available",
      },
    });
    await app.close();
  });
});
