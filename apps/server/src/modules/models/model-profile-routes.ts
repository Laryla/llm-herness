import {
  API_VERSION,
  createManualModelRequestSchema,
  createModelProfileRequestSchema,
  setCurrentModelSelectionRequestSchema,
  updateModelProfileRequestSchema,
} from "@llm-harness/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import {
  ModelProfileServiceError,
} from "./model-profile-service.js";
import type { ModelProfileService } from "./model-profile-service.js";

/*
 * Model Profile REST 传输层。
 * 这里只校验请求并生成 Envelope；密钥、连接测试、Catalog 和选择规则由服务层负责。
 */
/** 生成统一的 400 请求校验错误。 */
function invalidRequest(reply: FastifyReply, message: string, issues?: unknown) {
  return reply.code(400).send({
    apiVersion: API_VERSION,
    error: {
      code: "invalid_request",
      message,
      retryable: false,
      ...(issues ? { details: { issues } } : {}),
    },
  });
}

/** 把 Models 业务错误映射成稳定的 HTTP 状态码与错误 Envelope。 */
function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ModelProfileServiceError)) {
    throw error;
  }
  const statusCode =
    error.code === "model_profile_not_found" || error.code === "model_not_found"
      ? 404
      : error.code === "model_conflict"
        ? 409
        : error.code === "model_connection_failed"
          ? 502
          : 400;
  return reply.code(statusCode).send({
    apiVersion: API_VERSION,
    error: {
      code: error.code,
      message: error.message,
      retryable:
        error.code === "model_connection_failed" &&
        typeof error.details?.error === "object" &&
        error.details.error !== null &&
        "retryable" in error.details.error
          ? error.details.error.retryable === true
          : false,
      ...(error.details ? { details: error.details } : {}),
    },
  });
}

/** 向 Harness Server 注册 Model Profile、Catalog 和 Current Model Selection 接口。 */
export function registerModelProfileRoutes(
  app: FastifyInstance,
  service: ModelProfileService,
): void {
  // 列出全部 Profile，响应只包含密钥引用和脱敏值。
  app.get("/api/v1/model-profiles", async () => ({
    apiVersion: API_VERSION,
    data: await service.list(),
  }));

  // 创建 Profile，并把真实密钥写入系统密钥库或绑定环境变量引用。
  app.post("/api/v1/model-profiles", async (request, reply) => {
    const parsed = createModelProfileRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidRequest(reply, "Model Profile 请求参数无效", parsed.error.issues);
    }
    try {
      return reply.code(201).send({
        apiVersion: API_VERSION,
        data: await service.create(parsed.data),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // 修改显示名称、上游地址或密钥来源；连接相关变化会重置测试状态。
  app.patch<{ Params: { profileId: string } }>(
    "/api/v1/model-profiles/:profileId",
    async (request, reply) => {
      const parsed = updateModelProfileRequestSchema.safeParse(request.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return invalidRequest(reply, "至少需要提供一个 Model Profile 更新字段");
      }
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.update(request.params.profileId, parsed.data),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 删除 Profile、Catalog、选择引用和对应的系统密钥。
  app.delete<{ Params: { profileId: string } }>(
    "/api/v1/model-profiles/:profileId",
    async (request, reply) => {
      try {
        await service.remove(request.params.profileId);
        return reply.code(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 调用上游 `/models` 验证地址与 Bearer 密钥，并保存连接结果。
  app.post<{ Params: { profileId: string } }>(
    "/api/v1/model-profiles/:profileId/test-connection",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.testConnection(request.params.profileId),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 读取该 Profile 当前的自动发现与手动模型条目。
  app.get<{ Params: { profileId: string } }>(
    "/api/v1/model-profiles/:profileId/models",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.getCatalog(request.params.profileId),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 从上游 `/models` 刷新自动发现条目，手动条目保持不变。
  app.post<{ Params: { profileId: string } }>(
    "/api/v1/model-profiles/:profileId/models/refresh",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.refreshCatalog(request.params.profileId),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 为不支持模型发现或未返回完整列表的服务添加手动模型。
  app.post<{ Params: { profileId: string } }>(
    "/api/v1/model-profiles/:profileId/models",
    async (request, reply) => {
      const parsed = createManualModelRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return invalidRequest(reply, "手动模型请求参数无效", parsed.error.issues);
      }
      try {
        return reply.code(201).send({
          apiVersion: API_VERSION,
          data: await service.addManualModel(
            request.params.profileId,
            parsed.data.modelName,
          ),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 删除指定手动模型；自动发现条目只能通过刷新更新。
  app.delete<{ Params: { profileId: string; entryId: string } }>(
    "/api/v1/model-profiles/:profileId/models/:entryId",
    async (request, reply) => {
      try {
        await service.removeManualModel(
          request.params.profileId,
          request.params.entryId,
        );
        return reply.code(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 读取所有 Client 共享的 Current Model Selection。
  app.get("/api/v1/current-model-selection", async () => ({
    apiVersion: API_VERSION,
    data: await service.getCurrentSelection(),
  }));

  // 切换或清空 Current Model Selection，只接受 Catalog 中已有模型。
  app.put("/api/v1/current-model-selection", async (request, reply) => {
    const parsed = setCurrentModelSelectionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidRequest(reply, "Current Model Selection 请求参数无效");
    }
    try {
      return {
        apiVersion: API_VERSION,
        data: await service.setCurrentSelection(parsed.data.selection),
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
