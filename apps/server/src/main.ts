import { fileURLToPath } from "node:url";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { initializeHarnessHome } from "./harness-home.js";
import { createDatabase } from "./infrastructure/database/database.js";
import { migrateDatabase } from "./infrastructure/database/migrate.js";
import {
  EnvironmentSecretStore,
  selectSecretStore,
  SystemKeychainSecretStore,
} from "./infrastructure/secrets/secret-store.js";
import { initializeWorkspaces } from "./modules/workspaces/workspace-service.js";

const config = loadConfig();
const staticRoot = fileURLToPath(new URL("../../web/dist", import.meta.url));
let app: ReturnType<typeof createApp> | undefined;

try {
  console.info(
    {
      databaseProvider: config.database.provider,
      environment: config.environment,
      harnessHome: config.harnessHome,
      host: config.host,
      maxIterations: config.maxIterations,
      port: config.port,
    },
    "服务配置加载完成",
  );

  console.info({ harnessHome: config.harnessHome }, "正在初始化 Harness Home");
  const harnessHomePaths = await initializeHarnessHome(config);
  console.info(
    {
      configFile: harnessHomePaths.configFile,
      dataDirectory: harnessHomePaths.data,
      defaultWorkspace: harnessHomePaths.defaultWorkspace,
      logsDirectory: harnessHomePaths.logs,
    },
    "Harness Home 初始化完成",
  );

  console.info(
    { databaseProvider: config.database.provider },
    "正在执行数据库迁移",
  );
  await migrateDatabase(config);
  console.info(
    { databaseProvider: config.database.provider },
    "数据库迁移完成",
  );

  const database = createDatabase(config.database);
  console.info(
    { databaseProvider: database.provider },
    "正在连接数据库",
  );
  await database.connect();
  if (!(await database.isHealthy())) {
    await database.disconnect();
    throw new Error("数据库健康检查失败，Harness Server 未启动");
  }
  console.info(
    { databaseProvider: database.provider },
    "数据库连接与健康检查完成",
  );

  await initializeWorkspaces(database.client, harnessHomePaths.defaultWorkspace);
  console.info("默认 Workspace 与 Current Workspace 初始化完成");

  const keychainSecretStore = new SystemKeychainSecretStore();
  const environmentSecretStore = new EnvironmentSecretStore();
  const writableSecretStore = await selectSecretStore(
    keychainSecretStore,
    environmentSecretStore,
  );
  console.info(
    { secretStoreSource: writableSecretStore.source },
    "SecretStore 初始化完成",
  );

  const runningApp = createApp({
    database,
    logger: true,
    secretStores: {
      keychain: keychainSecretStore,
      environment: environmentSecretStore,
      writable: writableSecretStore,
    },
    staticRoot,
  });
  app = runningApp;
  runningApp.log.info({ staticRoot }, "Web 静态资源目录已配置");

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      runningApp.log.info({ signal }, "收到关闭信号，正在停止服务");
      void runningApp.close();
    });
  }

  const address = await runningApp.listen({ host: config.host, port: config.port });
  runningApp.log.info({ address }, "LLM Harness Server 启动完成");
} catch (error) {
  if (app === undefined) {
    console.error("LLM Harness Server 启动失败", error);
  } else {
    app.log.error({ err: error }, "LLM Harness Server 启动失败");
    await app.close();
  }
  process.exitCode = 1;
}
