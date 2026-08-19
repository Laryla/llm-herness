import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { z } from "zod";

import { databaseProviderSchema, type ServerConfig } from "./config.js";

const persistedSettingsSchema = z
  .object({
    databaseProvider: databaseProviderSchema,
    maxIterations: z.number().int().min(1).max(100),
  })
  .strict();

export interface HarnessHomePaths {
  readonly root: string;
  readonly data: string;
  readonly logs: string;
  readonly workspaces: string;
  readonly defaultWorkspace: string;
  readonly configFile: string;
}

export function getHarnessHomePaths(harnessHome: string): HarnessHomePaths {
  const workspaces = join(harnessHome, "workspaces");
  return {
    root: harnessHome,
    data: join(harnessHome, "data"),
    logs: join(harnessHome, "logs"),
    workspaces,
    defaultWorkspace: join(workspaces, "default"),
    configFile: join(harnessHome, "config.json"),
  };
}

export async function initializeHarnessHome(
  config: ServerConfig,
): Promise<HarnessHomePaths> {
  const paths = getHarnessHomePaths(config.harnessHome);

  await Promise.all([
    mkdir(paths.data, { recursive: true }),
    mkdir(paths.logs, { recursive: true }),
    mkdir(paths.defaultWorkspace, { recursive: true }),
  ]);

  try {
    const existing = persistedSettingsSchema.parse(
      JSON.parse(await readFile(paths.configFile, "utf8")),
    );
    if (existing.databaseProvider !== config.database.provider) {
      throw new Error(
        `不支持在运行期间切换数据库 Provider：${existing.databaseProvider} → ${config.database.provider}`,
      );
    }
    return paths;
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "ENOENT"
    ) {
      throw error;
    }
  }

  const persistedSettings = `${JSON.stringify(
    {
      databaseProvider: config.database.provider,
      maxIterations: config.maxIterations,
    },
    null,
    2,
  )}\n`;

  try {
    await writeFile(paths.configFile, persistedSettings, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !("code" in error) ||
      error.code !== "EEXIST"
    ) {
      throw error;
    }
  }

  return paths;
}
