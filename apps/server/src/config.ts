import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

import { z } from "zod";

const optionalEnvironmentString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().optional(),
);

export const databaseProviderSchema = z.enum([
  "sqlite",
  "mysql",
  "postgresql",
]);

export const serverConfigEnvironmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    SERVER_HOST: z.literal("127.0.0.1").default("127.0.0.1"),
    SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3_000),
    HARNESS_HOME: optionalEnvironmentString,
    DATABASE_PROVIDER: databaseProviderSchema.default("sqlite"),
    DATABASE_URL: optionalEnvironmentString,
    MAX_ITERATIONS: z.coerce.number().int().min(1).max(100).default(50),
  })
  .passthrough()
  .superRefine((environment, context) => {
    const { DATABASE_PROVIDER: provider, DATABASE_URL: url } = environment;

    if (provider === "sqlite") {
      if (url !== undefined && !url.startsWith("file:")) {
        context.addIssue({
          code: "custom",
          message: "SQLite DATABASE_URL 必须使用 file: 协议",
          path: ["DATABASE_URL"],
        });
      }
      return;
    }

    const validPrefixes =
      provider === "mysql" ? ["mysql://"] : ["postgresql://", "postgres://"];
    if (url === undefined || !validPrefixes.some((prefix) => url.startsWith(prefix))) {
      context.addIssue({
        code: "custom",
        message: `${provider} 必须提供匹配的 DATABASE_URL`,
        path: ["DATABASE_URL"],
      });
    }
  });

export interface ServerConfig {
  readonly environment: "development" | "test" | "production";
  readonly host: "127.0.0.1";
  readonly port: number;
  readonly harnessHome: string;
  readonly database: {
    readonly provider: z.infer<typeof databaseProviderSchema>;
    readonly url: string;
  };
  readonly maxIterations: number;
}

function resolveHarnessHome(value: string | undefined): string {
  if (value === undefined) {
    return join(homedir(), ".llm");
  }
  return isAbsolute(value) ? value : resolve(value);
}

export function loadConfig(
  environment: Record<string, string | undefined> = process.env,
): ServerConfig {
  const parsed = serverConfigEnvironmentSchema.parse(environment);
  const harnessHome = resolveHarnessHome(parsed.HARNESS_HOME);
  const databaseUrl =
    parsed.DATABASE_URL ?? `file:${join(harnessHome, "data", "harness.db")}`;

  return {
    environment: parsed.NODE_ENV,
    host: parsed.SERVER_HOST,
    port: parsed.SERVER_PORT,
    harnessHome,
    database: {
      provider: parsed.DATABASE_PROVIDER,
      url: databaseUrl,
    },
    maxIterations: parsed.NODE_ENV === "test" ? 8 : parsed.MAX_ITERATIONS,
  };
}
