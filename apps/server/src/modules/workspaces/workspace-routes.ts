import {
  API_VERSION,
  createWorkspaceRequestSchema,
  setCurrentWorkspaceRequestSchema,
  updateWorkspaceRequestSchema,
} from "@llm-harness/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";

import type { PersistenceClient } from "../../infrastructure/database/database.js";
import { WorkspaceService, WorkspaceServiceError } from "./workspace-service.js";

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

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  client: PersistenceClient,
): void {
  const service = new WorkspaceService(client);

  app.get("/api/v1/workspaces", async () => ({
    apiVersion: API_VERSION,
    data: await service.list(),
  }));

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

  app.get("/api/v1/current-workspace", async () => ({
    apiVersion: API_VERSION,
    data: await service.getCurrent(),
  }));

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
