import { spawn } from "node:child_process";
import { open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig, type ServerConfig } from "../../config.js";
import { initializeHarnessHome } from "../../harness-home.js";

export async function migrateDatabase(config: ServerConfig): Promise<void> {
  if (config.database.provider === "sqlite") {
    const databaseFile = await open(
      fileURLToPath(new URL(config.database.url)),
      "a",
      0o600,
    );
    await databaseFile.close();
  }
  const prismaConfig = resolve(
    process.cwd(),
    "prisma",
    config.database.provider,
    "prisma.config.ts",
  );

  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      "prisma",
      ["migrate", "deploy", "--config", prismaConfig],
      {
        env: { ...process.env, DATABASE_URL: config.database.url },
        stdio: "inherit",
      },
    );

    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      reject(
        new Error(
          `数据库迁移失败（code=${String(code)}, signal=${String(signal)}）`,
        ),
      );
    });
  });
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const config = loadConfig();
  await initializeHarnessHome(config);
  await migrateDatabase(config);
}
