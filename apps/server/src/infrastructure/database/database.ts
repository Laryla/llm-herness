import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaPg } from "@prisma/adapter-pg";

import type { ServerConfig } from "../../config.js";
import { PrismaClient as MysqlPrismaClient } from "./generated/mysql/client.js";
import { PrismaClient as PostgresqlPrismaClient } from "./generated/postgresql/client.js";
import { PrismaClient as SqlitePrismaClient } from "./generated/sqlite/client.js";

type DatabaseConfig = ServerConfig["database"];
export type PersistenceClient = InstanceType<typeof SqlitePrismaClient>;

function createClient(config: DatabaseConfig): PersistenceClient {
  switch (config.provider) {
    case "sqlite":
      return new SqlitePrismaClient({
        adapter: new PrismaBetterSqlite3({ url: config.url }),
      });
    case "mysql":
      return new MysqlPrismaClient({
        adapter: new PrismaMariaDb(config.url),
      }) as unknown as PersistenceClient;
    case "postgresql":
      return new PostgresqlPrismaClient({
        adapter: new PrismaPg({ connectionString: config.url }),
      }) as unknown as PersistenceClient;
  }
}

export class DatabaseConnection {
  readonly provider: DatabaseConfig["provider"];
  readonly client: PersistenceClient;

  constructor(config: DatabaseConfig) {
    this.provider = config.provider;
    this.client = createClient(config);
  }

  async connect(): Promise<void> {
    await this.client.$connect();
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.client.$queryRawUnsafe("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.client.$disconnect();
  }
}

export function createDatabase(config: DatabaseConfig): DatabaseConnection {
  return new DatabaseConnection(config);
}
