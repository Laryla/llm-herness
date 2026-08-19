import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseConnection } from "../src/infrastructure/database/database.js";

const provider = process.env.TEST_DATABASE_PROVIDER;
const url = process.env.TEST_DATABASE_URL;
const enabled =
  (provider === "mysql" || provider === "postgresql") && url !== undefined;

describe.runIf(enabled)(`${provider ?? "external"} 持久化契约`, () => {
  let database: DatabaseConnection;

  beforeAll(async () => {
    database = createDatabase({
      provider: provider as "mysql" | "postgresql",
      url: url as string,
    });
    await database.connect();
  });

  afterAll(async () => {
    await database.disconnect();
  });

  it("通过健康检查并执行 CRUD、排序和事务回滚", async () => {
    const suffix = `${Date.now()}`;
    const workspaceId = `workspace_${suffix}`;
    const firstPath = `/tmp/${provider}-${suffix}-a`;
    const secondPath = `/tmp/${provider}-${suffix}-b`;

    await expect(database.isHealthy()).resolves.toBe(true);
    await database.client.workspace.createMany({
      data: [
        {
          id: `${workspaceId}_b`,
          name: "B",
          path: secondPath,
          status: "available",
        },
        {
          id: `${workspaceId}_a`,
          name: "A",
          path: firstPath,
          status: "available",
        },
      ],
    });

    const workspaces = await database.client.workspace.findMany({
      where: { id: { startsWith: workspaceId } },
      orderBy: { name: "asc" },
    });
    expect(workspaces.map(({ name }) => name)).toEqual(["A", "B"]);

    await expect(
      database.client.$transaction(async (transaction) => {
        await transaction.workspace.update({
          where: { id: `${workspaceId}_a` },
          data: { status: "unavailable" },
        });
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    await expect(
      database.client.workspace.findUniqueOrThrow({
        where: { id: `${workspaceId}_a` },
      }),
    ).resolves.toMatchObject({ status: "available" });
  });
});
