import { randomUUID } from "node:crypto";

import type {
  ContractError,
  CreateModelProfileRequest,
  CurrentModelSelection,
  ModelConnection,
  ModelProfile,
  ModelSelection,
  SecretReference,
  UpdateModelProfileRequest,
} from "@llm-harness/contracts";

import type { PersistenceClient } from "../../infrastructure/database/database.js";
import { Prisma } from "../../infrastructure/database/generated/sqlite/client.js";
import { maskSecret } from "../../infrastructure/secrets/secret-redaction.js";
import type { SecretStore } from "../../infrastructure/secrets/secret-store.js";

const SETTINGS_ID = "settings_default";

/**
 * Model Profile 模块使用的最小日志接口。
 * 领域服务只依赖结构化日志能力，不直接依赖 Fastify 或具体日志实现。
 */
export interface ModelProfileLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

const silentLogger: ModelProfileLogger = {
  info: () => undefined,
  warn: () => undefined,
};

export interface ModelSecretStores {
  readonly keychain: SecretStore;
  readonly local: SecretStore;
  readonly environment: SecretStore;
  readonly writable: SecretStore;
}

/** Model Profile 业务错误，由 REST 层转换为稳定的 HTTP Error Envelope。 */
export class ModelProfileServiceError extends Error {
  constructor(
    readonly code:
      | "model_profile_not_found"
      | "model_not_found"
      | "model_conflict"
      | "secret_not_found"
      | "secret_store_unavailable"
      | "model_connection_failed",
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

type Fetch = typeof fetch;

function createId(prefix: "profile"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

/** 生成可安全写入日志的上游地址，移除 URL 中可能携带的凭据和查询参数。 */
function createSafeUpstreamUrl(baseUrl: string, path: string): string {
  const url = new URL(`${normalizeBaseUrl(baseUrl)}${path}`);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** 保留排障所需异常对象及契约详情，由 Pino 通过 `err` 字段输出名称、消息和堆栈。 */
function createConnectionLogContext(
  error: unknown,
  contractError: ContractError,
  profile: { baseUrl: string },
  path: string,
): Record<string, unknown> {
  return {
    err: error,
    errorCode: contractError.code,
    errorDetails: contractError.details,
    errorMessage: contractError.message,
    requestUrl: createSafeUpstreamUrl(profile.baseUrl, path),
    retryable: contractError.retryable,
    upstreamStatus: contractError.details?.status,
  };
}

function serializeConnection(record: {
  connectionStatus: string;
  connectionTestedAt: Date | null;
  connectionLatencyMs: number | null;
  connectionError: unknown;
}): ModelConnection {
  if (record.connectionStatus === "succeeded" && record.connectionTestedAt) {
    return {
      status: "succeeded",
      testedAt: record.connectionTestedAt.toISOString(),
      latencyMs: record.connectionLatencyMs ?? 0,
    };
  }
  if (record.connectionStatus === "failed" && record.connectionTestedAt) {
    return {
      status: "failed",
      testedAt: record.connectionTestedAt.toISOString(),
      error: record.connectionError as ContractError,
    };
  }
  return { status: "untested" };
}

function serializeProfile(record: {
  id: string;
  displayName: string;
  modelName: string;
  baseUrl: string;
  secretSource: string;
  secretReference: string;
  maskedSecret: string;
  connectionStatus: string;
  connectionTestedAt: Date | null;
  connectionLatencyMs: number | null;
  connectionError: unknown;
  createdAt: Date;
  updatedAt: Date;
}): ModelProfile {
  return {
    id: record.id,
    displayName: record.displayName,
    modelName: record.modelName,
    baseUrl: record.baseUrl,
    secret: {
      source: record.secretSource as SecretReference["source"],
      reference: record.secretReference,
      maskedValue: record.maskedSecret,
    },
    connection: serializeConnection(record),
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function ensureSettings(client: PersistenceClient): Promise<void> {
  await client.harnessSettings.upsert({
    where: { id: SETTINGS_ID },
    create: { id: SETTINGS_ID, currentToolIds: [], maxIterations: 50 },
    update: {},
  });
}

export class ModelProfileService {
  /**
   * Model Profile、Model Catalog 与 Current Model Selection 的统一用例入口。
   * 真实密钥只通过 SecretStore 读写，任何返回值和日志都不得包含密钥明文。
   */
  constructor(
    private readonly client: PersistenceClient,
    private readonly stores: ModelSecretStores,
    private readonly fetchImplementation: Fetch = fetch,
    private readonly logger: ModelProfileLogger = silentLogger,
  ) {}

  /** 按创建时间列出全部 Model Profile，只返回密钥引用和脱敏值。 */
  async list(): Promise<ModelProfile[]> {
    const records = await this.client.modelProfile.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    return records.map(serializeProfile);
  }

  /** 创建 Model Profile，并将真实密钥写入本地 config.json 或绑定环境变量引用。 */
  async create(input: CreateModelProfileRequest): Promise<ModelProfile> {
    const id = createId("profile");
    const secret = await this.prepareNewSecret(id, input);
    try {
      const record = await this.client.modelProfile.create({
        data: {
          id,
          displayName: input.displayName.trim(),
          modelName: input.modelName.trim(),
          baseUrl: normalizeBaseUrl(input.baseUrl),
          secretSource: secret.source,
          secretReference: secret.reference,
          maskedSecret: secret.maskedValue,
          connectionStatus: "untested",
        },
      });
      // Profile 创建成功后再记录，避免把失败的外部密钥写入误报为有效配置。
      this.logger.info(
        {
          modelProfileId: record.id,
          secretSource: record.secretSource,
        },
        "Model Profile 创建完成",
      );
      return serializeProfile(record);
    } catch (error) {
      if (secret.source !== "environment") {
        await this.stores[secret.source].delete(secret.reference).catch(() => undefined);
      }
      throw error;
    }
  }

  /** 更新 Profile 配置；地址或密钥变化时重置连接状态和过期的发现结果。 */
  async update(
    id: string,
    input: UpdateModelProfileRequest,
  ): Promise<ModelProfile> {
    const existing = await this.findProfile(id);
    let secret: SecretReference | undefined;
    if (input.secretValue !== undefined) {
      if (this.stores.writable.source !== "local") {
        throw new ModelProfileServiceError(
          "secret_store_unavailable",
          "本地密钥配置不可用，请改用环境变量引用",
        );
      }
      await this.stores.writable.set(id, input.secretValue);
      secret = {
        source: this.stores.writable.source,
        reference: id,
        maskedValue: maskSecret(input.secretValue),
      };
    } else if (input.secretEnvironmentVariable !== undefined) {
      const value = await this.stores.environment.get(
        input.secretEnvironmentVariable,
      );
      if (value === null) {
        throw new ModelProfileServiceError(
          "secret_not_found",
          "指定的环境变量不存在",
        );
      }
      secret = {
        source: "environment",
        reference: input.secretEnvironmentVariable,
        maskedValue: maskSecret(value),
      };
    }

    const record = await this.client.modelProfile.update({
      where: { id },
      data: {
        ...(input.displayName === undefined
          ? {}
          : { displayName: input.displayName.trim() }),
        ...(input.modelName === undefined
          ? {}
          : { modelName: input.modelName.trim() }),
        ...(input.baseUrl === undefined
          ? {}
          : {
              baseUrl: normalizeBaseUrl(input.baseUrl),
              catalogRefreshedAt: null,
            }),
        ...(secret
          ? {
              secretSource: secret.source,
              secretReference: secret.reference,
              maskedSecret: secret.maskedValue,
            }
          : {}),
        ...(input.baseUrl !== undefined || input.modelName !== undefined || secret !== undefined
          ? {
              connectionStatus: "untested",
              connectionTestedAt: null,
              connectionLatencyMs: null,
              connectionError: Prisma.JsonNull,
            }
          : {}),
      },
    });
    if (input.baseUrl !== undefined) {
      await this.client.$transaction(async (transaction) => {
        await transaction.modelCatalogEntry.deleteMany({
          where: { profileId: id, source: "discovered" },
        });
        const settings = await transaction.harnessSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if (
          settings?.currentModelProfileId === id &&
          settings.currentModelName !== null
        ) {
          const manualSelection = await transaction.modelCatalogEntry.findFirst({
            where: {
              profileId: id,
              modelName: settings.currentModelName,
              source: "manual",
            },
          });
          if (!manualSelection) {
            await transaction.harnessSettings.update({
              where: { id: SETTINGS_ID },
              data: { currentModelProfileId: null, currentModelName: null },
            });
          }
        }
      });
    }
    if (
      secret &&
      (existing.secretSource === "keychain" || existing.secretSource === "local") &&
      (secret.source !== existing.secretSource ||
        existing.secretReference !== secret.reference)
    ) {
      await this.stores[existing.secretSource]
        .delete(existing.secretReference)
        .catch(() => undefined);
    }
    this.logger.info(
      {
        changedBaseUrl: input.baseUrl !== undefined,
        changedDisplayName: input.displayName !== undefined,
        changedModelName: input.modelName !== undefined,
        changedSecret:
          input.secretValue !== undefined ||
          input.secretEnvironmentVariable !== undefined,
        modelProfileId: id,
      },
      "Model Profile 更新完成",
    );
    return serializeProfile(record);
  }

  /** 删除 Profile、所属 Catalog 和 Current Model Selection，并清理系统密钥引用。 */
  async remove(id: string): Promise<void> {
    const profile = await this.findProfile(id);
    await ensureSettings(this.client);
    await this.client.$transaction(async (transaction) => {
      const settings = await transaction.harnessSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
      if (settings.currentModelProfileId === id) {
        await transaction.harnessSettings.update({
          where: { id: SETTINGS_ID },
          data: { currentModelProfileId: null, currentModelName: null },
        });
      }
      await transaction.modelProfile.delete({ where: { id } });
    });
    if (profile.secretSource === "keychain" || profile.secretSource === "local") {
      await this.stores[profile.secretSource]
        .delete(profile.secretReference)
        .catch(() => undefined);
    }
    this.logger.info({ modelProfileId: id }, "Model Profile 删除完成");
  }

  /** 发送最小 Chat Completions 请求测试连接，不依赖供应商可选的模型列表接口。 */
  async testConnection(id: string): Promise<ModelProfile> {
    const profile = await this.findProfile(id);
    const modelName = profile.modelName;
    try {
      const { latencyMs } = await this.fetchChatCompletion(profile, modelName);
      const record = await this.client.modelProfile.update({
        where: { id },
        data: {
          connectionStatus: "succeeded",
          connectionTestedAt: new Date(),
          connectionLatencyMs: latencyMs,
          connectionError: Prisma.JsonNull,
        },
      });
      this.logger.info(
        { latencyMs, modelName, modelProfileId: id },
        "Model Profile 连接测试成功",
      );
      return serializeProfile(record);
    } catch (error) {
      const contractError = this.toConnectionError(error);
      const record = await this.client.modelProfile.update({
        where: { id },
        data: {
          connectionStatus: "failed",
          connectionTestedAt: new Date(),
          connectionLatencyMs: null,
          connectionError: contractError as unknown as Prisma.InputJsonValue,
        },
      });
      this.logger.warn(
        {
          ...createConnectionLogContext(error, contractError, profile, "/chat/completions"),
          modelName,
          modelProfileId: id,
        },
        "Model Profile 连接测试失败",
      );
      return serializeProfile(record);
    }
  }

  /** 读取 Harness Instance 中所有 Client 共享的 Current Model Selection。 */
  async getCurrentSelection(): Promise<CurrentModelSelection> {
    await ensureSettings(this.client);
    const settings = await this.client.harnessSettings.findUniqueOrThrow({
      where: { id: SETTINGS_ID },
    });
    return {
      selection:
        settings.currentModelProfileId && settings.currentModelName
          ? {
              profileId: settings.currentModelProfileId,
              modelName: settings.currentModelName,
            }
          : null,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  /** 设置或清空 Current Model Selection，选择必须匹配一条完整模型配置。 */
  async setCurrentSelection(
    selection: ModelSelection | null,
  ): Promise<CurrentModelSelection> {
    await ensureSettings(this.client);
    if (selection) {
      const profile = await this.client.modelProfile.findUnique({
        where: { id: selection.profileId },
      });
      if (!profile || profile.modelName !== selection.modelName) {
        throw new ModelProfileServiceError(
          "model_not_found",
          "Model Selection 与模型配置不匹配",
        );
      }
    }
    const settings = await this.client.harnessSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        currentModelProfileId: selection?.profileId ?? null,
        currentModelName: selection?.modelName ?? null,
      },
    });
    this.logger.info(
      {
        modelName: selection?.modelName ?? null,
        modelProfileId: selection?.profileId ?? null,
      },
      selection ? "Current Model Selection 切换完成" : "Current Model Selection 已清空",
    );
    return {
      selection,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private async findProfile(id: string) {
    const profile = await this.client.modelProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new ModelProfileServiceError(
        "model_profile_not_found",
        "Model Profile 不存在",
      );
    }
    return profile;
  }

  private async prepareNewSecret(
    id: string,
    input: CreateModelProfileRequest,
  ): Promise<SecretReference> {
    if (input.secretEnvironmentVariable) {
      const value = await this.stores.environment.get(
        input.secretEnvironmentVariable,
      );
      if (value === null) {
        throw new ModelProfileServiceError(
          "secret_not_found",
          "指定的环境变量不存在",
        );
      }
      return {
        source: "environment",
        reference: input.secretEnvironmentVariable,
        maskedValue: maskSecret(value),
      };
    }
    if (this.stores.writable.source !== "local") {
      throw new ModelProfileServiceError(
        "secret_store_unavailable",
        "本地密钥配置不可用，请改用环境变量引用",
      );
    }
    await this.stores.writable.set(id, input.secretValue as string);
    return {
      source: "local",
      reference: id,
      maskedValue: maskSecret(input.secretValue as string),
    };
  }

  private async fetchChatCompletion(
    profile: { baseUrl: string; secretSource: string; secretReference: string },
    modelName: string,
  ): Promise<{ latencyMs: number }> {
    const store = this.stores[profile.secretSource as "local" | "keychain" | "environment"];
    const secret = await store.get(profile.secretReference);
    if (secret === null) {
      throw new ModelProfileServiceError("secret_not_found", "找不到模型密钥");
    }
    const startedAt = performance.now();
    const response = await this.fetchImplementation(
      `${profile.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: modelName.trim(),
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
          stream: false,
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
    if (!response.ok) {
      throw new ModelProfileServiceError(
        "model_connection_failed",
        `模型服务返回 HTTP ${response.status}`,
        { status: response.status },
      );
    }
    return { latencyMs };
  }

  private toConnectionError(error: unknown): ContractError {
    if (error instanceof ModelProfileServiceError) {
      const status = error.details?.status;
      return {
        code: error.code,
        message: error.message,
        retryable:
          typeof status === "number" ? status === 429 || status >= 500 : false,
        ...(error.details ? { details: error.details } : {}),
      };
    }
    return {
      code: "model_connection_failed",
      message: "无法连接模型服务",
      retryable: true,
    };
  }
}
