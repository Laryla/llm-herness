import {
  API_VERSION,
  createConversationRequestSchema,
  entityIdSchema,
  updateConversationRequestSchema,
} from "@llm-harness/contracts";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";

import {
  ConversationServiceError,
  type ConversationService,
} from "./conversation-service.js";

const listQuerySchema = z.object({ workspaceId: entityIdSchema.optional() }).strict();

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

function sendError(reply: FastifyReply, error: unknown) {
  if (!(error instanceof ConversationServiceError)) {
    throw error;
  }
  const statusCode =
    error.code === "conversation_not_found" ||
    error.code === "turn_not_found" ||
    error.code === "workspace_not_found"
      ? 404
      : 409;
  return reply.code(statusCode).send({
    apiVersion: API_VERSION,
    error: { code: error.code, message: error.message, retryable: false },
  });
}

/** 注册 Conversation 资源、线性消息历史、Turn 列表和 Trace 查询接口。 */
export function registerConversationRoutes(
  app: FastifyInstance,
  service: ConversationService,
): void {
  app.get("/api/v1/conversations", async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return invalidRequest(reply, "Conversation 查询参数无效", parsed.error.issues);
    }
    return {
      apiVersion: API_VERSION,
      data: await service.list(parsed.data.workspaceId),
    };
  });

  app.post("/api/v1/conversations", async (request, reply) => {
    const parsed = createConversationRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return invalidRequest(reply, "Conversation 请求参数无效", parsed.error.issues);
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

  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.get(request.params.conversationId),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.patch<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId",
    async (request, reply) => {
      const parsed = updateConversationRequestSchema.safeParse(request.body);
      if (!parsed.success || Object.keys(parsed.data).length === 0) {
        return invalidRequest(reply, "至少需要提供一个 Conversation 更新字段");
      }
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.update(request.params.conversationId, parsed.data),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.delete<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId",
    async (request, reply) => {
      try {
        await service.remove(request.params.conversationId);
        return reply.code(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/messages",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.listMessages(request.params.conversationId),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get<{ Params: { conversationId: string } }>(
    "/api/v1/conversations/:conversationId/turns",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.listTurns(request.params.conversationId),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  app.get<{ Params: { conversationId: string; turnId: string } }>(
    "/api/v1/conversations/:conversationId/turns/:turnId/trace",
    async (request, reply) => {
      try {
        return {
          apiVersion: API_VERSION,
          data: await service.getTrace(
            request.params.conversationId,
            request.params.turnId,
          ),
        };
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
