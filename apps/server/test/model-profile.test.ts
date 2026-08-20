import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../src/app.js";
import { createDatabase } from "../src/infrastructure/database/database.js";
import type { SecretStore } from "../src/infrastructure/secrets/secret-store.js";
import { ModelProfileService } from "../src/modules/models/model-profile-service.js";

class MemorySecretStore implements SecretStore {
  readonly values = new Map<string, string>();

  constructor(
    readonly source: "local" | "keychain" | "environment",
    values: Record<string, string> = {},
  ) {
    for (const [reference, value] of Object.entries(values)) {
      this.values.set(reference, value);
    }
  }

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

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

async function createTestContext(
  fetchImplementation: typeof fetch = fetch,
  logger?: ConstructorParameters<typeof ModelProfileService>[3],
) {
  const root = await mkdtemp(join(tmpdir(), "llm-harness-model-profile-"));
  temporaryDirectories.push(root);
  const databasePath = join(root, "harness.db");
  const sqlite = new BetterSqlite3(databasePath);
  for (const migrationName of [
    "20260819000100_init",
    "20260819000200_model_catalog_refresh",
  ]) {
    const migration = await readFile(
      new URL(
        `../prisma/sqlite/migrations/${migrationName}/migration.sql`,
        import.meta.url,
      ),
      "utf8",
    );
    sqlite.exec(migration);
  }
  sqlite.close();
  const database = createDatabase({
    provider: "sqlite",
    url: `file:${databasePath}`,
  });
  await database.connect();
  const keychain = new MemorySecretStore("keychain");
  const local = new MemorySecretStore("local");
  const environment = new MemorySecretStore("environment", {
    MODEL_API_KEY: "env-model-secret",
  });
  const service = new ModelProfileService(
    database.client,
    { keychain, local, environment, writable: local },
    fetchImplementation,
    logger,
  );
  return {
    database,
    environment,
    keychain: local,
    local,
    service,
    stores: { keychain, local, environment, writable: local },
  };
}

describe("Model Profile", () => {
  it("创建多个 Profile，并且数据库只保存密钥引用和脱敏值", async () => {
    const { database, keychain, service } = await createTestContext();

    const first = await service.create({
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1/",
      secretValue: "sk-first-secret",
    });
    const second = await service.create({
      displayName: "环境模型",
      baseUrl: "http://127.0.0.1:8000/v1",
      secretEnvironmentVariable: "MODEL_API_KEY",
    });

    expect(first.baseUrl).toBe("https://api.openai.com/v1");
    expect(first.secret.maskedValue).not.toContain("sk-first-secret");
    expect(keychain.values.get(first.secret.reference)).toBe("sk-first-secret");
    expect(second.secret).toMatchObject({
      source: "environment",
      reference: "MODEL_API_KEY",
    });
    const records = await database.client.modelProfile.findMany();
    expect(JSON.stringify(records)).not.toContain("sk-first-secret");
    expect(records).toHaveLength(2);
    await database.disconnect();
  });

  it("连接测试携带 Bearer 密钥并保存成功状态", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ id: "model-a" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const { database, service } = await createTestContext(request);
    const profile = await service.create({
      displayName: "兼容服务",
      baseUrl: "http://127.0.0.1:9000/v1",
      secretValue: "connection-secret",
    });

    const tested = await service.testConnection(profile.id, "model-a");

    expect(tested.connection.status).toBe("succeeded");
    expect(request).toHaveBeenCalledWith(
      "http://127.0.0.1:9000/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer connection-secret" }),
      }),
    );
    await database.disconnect();
  });

  it("连接失败保存脱敏结构化错误，不保存上游响应正文", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("contains-secret", { status: 401 }));
    const { database, service } = await createTestContext(request);
    const profile = await service.create({
      displayName: "失败服务",
      baseUrl: "http://127.0.0.1:9000/v1",
      secretValue: "contains-secret",
    });

    const tested = await service.testConnection(profile.id, "model-a");

    expect(tested.connection).toMatchObject({
      status: "failed",
      error: { code: "model_connection_failed", retryable: false },
    });
    expect(JSON.stringify(tested)).not.toContain("contains-secret");
    await database.disconnect();
  });

  it("连接失败日志包含请求地址、错误详情和原始异常", async () => {
    const upstreamError = new TypeError("fetch failed");
    const request = vi.fn<typeof fetch>().mockRejectedValue(upstreamError);
    const logger = { info: vi.fn(), warn: vi.fn() };
    const { database, service } = await createTestContext(request, logger);
    const profile = await service.create({
      displayName: "不可达服务",
      baseUrl: "http://127.0.0.1:9000/v1",
      secretValue: "must-not-appear",
    });

    await service.testConnection(profile.id, "model-a");

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: "model_connection_failed",
        errorMessage: "无法连接模型服务",
        modelProfileId: profile.id,
        requestUrl: "http://127.0.0.1:9000/v1/chat/completions",
        err: upstreamError,
      }),
      "Model Profile 连接测试失败",
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("must-not-appear");
    await database.disconnect();
  });

  it("刷新发现模型并保留同名手动条目", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const { database, service } = await createTestContext(request);
    const profile = await service.create({
      displayName: "目录服务",
      baseUrl: "http://127.0.0.1:9000/v1",
      secretValue: "catalog-secret",
    });
    await service.addManualModel(profile.id, "model-a");

    const catalog = await service.refreshCatalog(profile.id);

    expect(catalog.refreshedAt).not.toBeNull();
    expect(catalog.entries.map(({ modelName, source }) => [modelName, source])).toEqual([
      ["model-a", "manual"],
      ["model-b", "discovered"],
    ]);
    await database.disconnect();
  });

  it("Current Model Selection 只能选择 Catalog 中的模型", async () => {
    const { database, service } = await createTestContext();
    const profile = await service.create({
      displayName: "选择服务",
      baseUrl: "http://127.0.0.1:9000/v1",
      secretValue: "selection-secret",
    });

    await expect(
      service.setCurrentSelection({ profileId: profile.id, modelName: "missing" }),
    ).rejects.toMatchObject({ code: "model_not_found" });
    await service.addManualModel(profile.id, "manual-model");
    await expect(
      service.setCurrentSelection({
        profileId: profile.id,
        modelName: "manual-model",
      }),
    ).resolves.toMatchObject({
      selection: { profileId: profile.id, modelName: "manual-model" },
    });
    await service.remove(profile.id);
    await expect(service.getCurrentSelection()).resolves.toMatchObject({
      selection: null,
    });
    await database.disconnect();
  });

  it("通过 REST API 创建和列出 Model Profile", async () => {
    const { database, stores } = await createTestContext();
    const app = createApp({ database, secretStores: stores });

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/model-profiles",
      payload: {
        displayName: "REST Profile",
        baseUrl: "http://127.0.0.1:9000/v1",
        secretValue: "rest-secret",
      },
    });
    const listed = await app.inject({
      method: "GET",
      url: "/api/v1/model-profiles",
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      apiVersion: "v1",
      data: {
        displayName: "REST Profile",
        secret: { source: "local" },
      },
    });
    expect(JSON.stringify(created.json())).not.toContain("rest-secret");
    expect(listed.json().data).toHaveLength(1);
    await app.close();
  });
});
