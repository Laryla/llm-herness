import {
  API_VERSION,
  createWorkspaceRequestSchema,
  setCurrentWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
} from "@llm-harness/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import type { PersistenceClient } from "../../infrastructure/database/database.js";
import { WorkspaceService, WorkspaceServiceError } from "./workspace-service.js";

/*
 * Workspace REST 传输层。
 *
 * 只负责校验请求、调用 WorkspaceService 和生成统一 Envelope；路径、状态及
 * Current Workspace 的业务规则全部保留在服务层，方便未来 Web/CLI Client 共用。
 */
/** 把 Workspace 业务错误转换成稳定的 HTTP 状态码与错误 Envelope。 */
function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof WorkspaceServiceError)) {
    throw error;
  }
  const statusCode =
    error.code === "workspace_not_found"
      ? 404
      : error.code === "path_conflict"
        ? 409
        : 400;
  return reply.code(statusCode).send({
    apiVersion: API_VERSION,
    error: { code: error.code, message: error.message, retryable: false },
  });
}

/** 向 Harness Server 注册 Workspace 资源接口和 Current Workspace 接口。 */
export function registerWorkspaceRoutes(
  app: FastifyInstance,
  client: PersistenceClient,
): void {
  const service = new WorkspaceService(client, app.log);

  // 列出全部 Workspace，并同步刷新每个路径的可用状态。
  app.get("/api/v1/workspaces", async () => ({
    apiVersion: API_VERSION,
    data: await service.list(),
  }));

  // 注册新的 Workspace；只保存目录引用，不创建或修改用户目录。
  app.post("/api/v1/workspaces", async (request, reply) => {
    const parsed = createWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        apiVersion: API_VERSION,
        error: {
          code: "invalid_request",
          message: "Workspace 请求参数无效",
          retryable: false,
          details: { issues: parsed.error.issues },
        },
      });
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

  // 重命名 Workspace，或在目录移动后重新绑定一个路径。
  app.patch<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId",
    async (request, reply) => {
      const parsed = updateWorkspaceRequestSchema.safeParse(request.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return reply.code(400).send({
          apiVersion: API_VERSION,
          error: {
            code: "invalid_request",
            message: "至少需要提供一个 Workspace 更新字段",
            retryable: false,
          },
        });
      }
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.update(request.params.workspaceId, parsed.data),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 删除 Workspace 注册记录；磁盘文件始终保留。
  app.delete<{ Params: { workspaceId: string } }>(
    "/api/v1/workspaces/:workspaceId",
    async (request, reply) => {
      try {
        await service.remove(request.params.workspaceId);
        return reply.code(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  // 读取所有 Client 共享的 Current Workspace。
  app.get("/api/v1/current-workspace", async () => ({
    apiVersion: API_VERSION,
    data: await service.getCurrent(),
  }));

  // 切换 Current Workspace；只影响之后的浏览和 Conversation 创建。
  app.put("/api/v1/current-workspace", async (request, reply) => {
    const parsed = setCurrentWorkspaceRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        apiVersion: API_VERSION,
        error: {
          code: "invalid_request",
          message: "Current Workspace 请求参数无效",
          retryable: false,
        },
      });
    }
    try {
      return {
        apiVersion: API_VERSION,
        data: await service.setCurrent(parsed.data.workspaceId),
      };
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
