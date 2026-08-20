import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  loadConfig,
  serverConfigEnvironmentSchema,
} from "../src/config.js";
import { initializeHarnessHome } from "../src/harness-home.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe("Server 配置", () => {
  it("默认使用本地 SQLite，并从 Harness Home 派生数据库路径", () => {
    const config = loadConfig({
      HARNESS_HOME: "/tmp/llm-harness-test",
      NODE_ENV: "development",
    });

    expect(config.database).toEqual({
      provider: "sqlite",
      url: "file:/tmp/llm-harness-test/data/harness.db",
    });
    expect(config.maxIterations).toBe(50);
  });

  it("测试环境固定 maxIterations 为 8", () => {
    expect(loadConfig({ NODE_ENV: "test" }).maxIterations).toBe(8);
  });

  it.each([
    ["mysql", "postgresql://localhost/harness"],
    ["postgresql", "mysql://localhost/harness"],
    ["mysql", undefined],
  ])("拒绝 Provider %s 与连接串不匹配", (provider, databaseUrl) => {
    expect(
      serverConfigEnvironmentSchema.safeParse({
        DATABASE_PROVIDER: provider,
        DATABASE_URL: databaseUrl,
      }).success,
    ).toBe(false);
  });
});

describe("Harness Home", () => {
  it("幂等创建标准目录和非敏感配置文件", async () => {
    const harnessHome = await mkdtemp(join(tmpdir(), "llm-harness-home-"));
    temporaryDirectories.push(harnessHome);
    const config = loadConfig({ HARNESS_HOME: harnessHome, NODE_ENV: "test" });

    await initializeHarnessHome(config);
    await initializeHarnessHome(config);

    await expect(stat(join(harnessHome, "data"))).resolves.toMatchObject({});
    await expect(stat(join(harnessHome, "logs"))).resolves.toMatchObject({});
    await expect(
      stat(join(harnessHome, "workspaces", "default")),
    ).resolves.toMatchObject({});

    const saved = JSON.parse(
      await readFile(join(harnessHome, "config.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(saved).toEqual({
      databaseProvider: "sqlite",
      maxIterations: 8,
      secrets: {},
    });
    expect(JSON.stringify(saved)).not.toContain("DATABASE_URL");
  });

  it("拒绝在同一 Harness Home 运行时更换数据库 Provider", async () => {
    const harnessHome = await mkdtemp(join(tmpdir(), "llm-harness-home-"));
    temporaryDirectories.push(harnessHome);
    await initializeHarnessHome(
      loadConfig({ HARNESS_HOME: harnessHome, NODE_ENV: "test" }),
    );

    const mysqlConfig = loadConfig({
      HARNESS_HOME: harnessHome,
      NODE_ENV: "test",
      DATABASE_PROVIDER: "mysql",
      DATABASE_URL: "mysql://root:password@127.0.0.1:3306/harness",
    });

    await expect(initializeHarnessHome(mysqlConfig)).rejects.toThrow(
      "不支持在运行期间切换数据库 Provider",
    );
  });
});
