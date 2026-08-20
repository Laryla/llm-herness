import { randomUUID } from "node:crypto";

import type {
  ContractError,
  CreateModelProfileRequest,
  CurrentModelSelection,
  ModelCatalog,
  ModelCatalogEntry,
  ModelConnection,
  ModelProfile,
  ModelSelection,
  SecretReference,
  UpdateModelProfileRequest,
} from "@llm-harness/contracts";
import { z } from "zod";

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

const modelsResponseSchema = z
  .object({
    data: z.array(z.object({ id: z.string().trim().min(1).max(200) }).passthrough()),
  })
  .passthrough();

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

function createId(prefix: "profile" | "catalog"): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
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

function serializeCatalogEntry(record: {
  id: string;
  profileId: string;
  modelName: string;
  source: string;
  createdAt: Date;
  updatedAt: Date;
}): ModelCatalogEntry {
  return {
    ...record,
    source: record.source as ModelCatalogEntry["source"],
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
        ...(input.baseUrl !== undefined || secret !== undefined
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

  /**
   * 请求上游 `/models` 测试连接并持久化状态。
   * 失败只记录结构化错误，不记录响应正文、Authorization 或真实密钥。
   */
  async testConnection(id: string): Promise<ModelProfile> {
    const profile = await this.findProfile(id);
    try {
      const { latencyMs } = await this.fetchModels(profile);
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
        { latencyMs, modelProfileId: id },
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
          errorCode: contractError.code,
          modelProfileId: id,
          retryable: contractError.retryable,
        },
        "Model Profile 连接测试失败",
      );
      return serializeProfile(record);
    }
  }

  /** 从上游 `/models` 重新发现模型，保留手动条目并维护选择一致性。 */
  async refreshCatalog(id: string): Promise<ModelCatalog> {
    const profile = await this.findProfile(id);
    try {
      const { modelNames, latencyMs } = await this.fetchModels(profile);
      const refreshedAt = new Date();
      await this.client.$transaction(async (transaction) => {
        const manualEntries = await transaction.modelCatalogEntry.findMany({
          where: { profileId: id, source: "manual" },
          select: { modelName: true },
        });
        const manualModelNames = new Set(
          manualEntries.map(({ modelName }) => modelName),
        );
        await transaction.modelCatalogEntry.deleteMany({
          where: { profileId: id, source: "discovered" },
        });
        const discoveredModelNames = modelNames.filter(
          (modelName) => !manualModelNames.has(modelName),
        );
        if (discoveredModelNames.length > 0) {
          await transaction.modelCatalogEntry.createMany({
            data: discoveredModelNames.map((modelName) => ({
              id: createId("catalog"),
              profileId: id,
              modelName,
              source: "discovered",
            })),
          });
        }
        await transaction.modelProfile.update({
          where: { id },
          data: {
            catalogRefreshedAt: refreshedAt,
            connectionStatus: "succeeded",
            connectionTestedAt: refreshedAt,
            connectionLatencyMs: latencyMs,
            connectionError: Prisma.JsonNull,
          },
        });
        const settings = await transaction.harnessSettings.findUnique({
          where: { id: SETTINGS_ID },
        });
        if (
          settings?.currentModelProfileId === id &&
          settings.currentModelName !== null &&
          !new Set([...manualModelNames, ...discoveredModelNames]).has(
            settings.currentModelName,
          )
        ) {
          await transaction.harnessSettings.update({
            where: { id: SETTINGS_ID },
            data: { currentModelProfileId: null, currentModelName: null },
          });
        }
      });
      this.logger.info(
        {
          discoveredModelCount: modelNames.length,
          latencyMs,
          modelProfileId: id,
        },
        "Model Catalog 刷新完成",
      );
      return this.getCatalog(id);
    } catch (error) {
      const contractError = this.toConnectionError(error);
      await this.client.modelProfile.update({
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
          errorCode: contractError.code,
          modelProfileId: id,
          retryable: contractError.retryable,
        },
        "Model Catalog 刷新失败",
      );
      throw new ModelProfileServiceError(
        "model_connection_failed",
        contractError.message,
        { error: contractError },
      );
    }
  }

  /** 读取一个 Profile 的自动发现和手动 Model Catalog 条目。 */
  async getCatalog(profileId: string): Promise<ModelCatalog> {
    const profile = await this.findProfile(profileId);
    const entries = await this.client.modelCatalogEntry.findMany({
      where: { profileId },
      orderBy: [{ modelName: "asc" }, { id: "asc" }],
    });
    return {
      profileId,
      entries: entries.map(serializeCatalogEntry),
      refreshedAt: profile.catalogRefreshedAt?.toISOString() ?? null,
    };
  }

  /** 添加手动模型名称；同一 Profile 下模型名称必须唯一。 */
  async addManualModel(
    profileId: string,
    modelName: string,
  ): Promise<ModelCatalogEntry> {
    await this.findProfile(profileId);
    try {
      const record = await this.client.modelCatalogEntry.create({
        data: {
          id: createId("catalog"),
          profileId,
          modelName: modelName.trim(),
          source: "manual",
        },
      });
      this.logger.info(
        { catalogEntryId: record.id, modelProfileId: profileId },
        "手动 Model Catalog 条目创建完成",
      );
      return serializeCatalogEntry(record);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "P2002") {
        throw new ModelProfileServiceError(
          "model_conflict",
          "该模型已经存在于 Model Catalog",
        );
      }
      throw error;
    }
  }

  /** 只删除手动条目；若它正被选中，同时清空 Current Model Selection。 */
  async removeManualModel(profileId: string, entryId: string): Promise<void> {
    const entry = await this.client.modelCatalogEntry.findFirst({
      where: { id: entryId, profileId, source: "manual" },
    });
    if (!entry) {
      throw new ModelProfileServiceError("model_not_found", "手动模型条目不存在");
    }
    await ensureSettings(this.client);
    await this.client.$transaction(async (transaction) => {
      await transaction.modelCatalogEntry.delete({ where: { id: entryId } });
      const settings = await transaction.harnessSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
      if (
        settings.currentModelProfileId === profileId &&
        settings.currentModelName === entry.modelName
      ) {
        await transaction.harnessSettings.update({
          where: { id: SETTINGS_ID },
          data: { currentModelProfileId: null, currentModelName: null },
        });
      }
    });
    this.logger.info(
      { catalogEntryId: entryId, modelProfileId: profileId },
      "手动 Model Catalog 条目删除完成",
    );
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

  /** 设置或清空 Current Model Selection，非 Catalog 模型不能被选中。 */
  async setCurrentSelection(
    selection: ModelSelection | null,
  ): Promise<CurrentModelSelection> {
    await ensureSettings(this.client);
    if (selection) {
      const entry = await this.client.modelCatalogEntry.findFirst({
        where: {
          profileId: selection.profileId,
          modelName: selection.modelName,
        },
      });
      if (!entry) {
        throw new ModelProfileServiceError(
          "model_not_found",
          "Model Selection 不在该 Profile 的 Model Catalog 中",
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

  private async fetchModels(profile: {
    baseUrl: string;
    secretSource: string;
    secretReference: string;
  }): Promise<{ modelNames: string[]; latencyMs: number }> {
    const store = this.stores[profile.secretSource as "local" | "keychain" | "environment"];
    const secret = await store.get(profile.secretReference);
    if (secret === null) {
      throw new ModelProfileServiceError("secret_not_found", "找不到模型密钥");
    }
    const startedAt = performance.now();
    const response = await this.fetchImplementation(
      `${profile.baseUrl}/models`,
      {
        headers: { Authorization: `Bearer ${secret}` },
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
    const parsed = modelsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ModelProfileServiceError(
        "model_connection_failed",
        "模型列表响应格式无效",
      );
    }
    return {
      modelNames: [...new Set(parsed.data.data.map(({ id }) => id))].sort(),
      latencyMs,
    };
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
