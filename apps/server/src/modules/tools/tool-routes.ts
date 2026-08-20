import {
  API_VERSION,
  setCurrentToolSelectionRequestSchema,
} from "@llm-harness/contracts";
import type { FastifyInstance } from "fastify";

import { ToolRegistryError } from "./tool-service.js";
import type { ToolService } from "./tool-service.js";

/** 注册静态 Tool Catalog 和所有 Client 共享的当前工具勾选状态接口。 */
export function registerToolRoutes(app: FastifyInstance, service: ToolService): void {
  // 返回 Server 当前安装的工具；V1 仅包含代码内注册的内置工具。
  app.get("/api/v1/tools", () => ({
    apiVersion: API_VERSION,
    data: service.list(),
  }));

  // 读取 Web/CLI 共用的工具勾选偏好；Turn 创建时仍需显式携带 toolIds。
  app.get("/api/v1/current-tool-selection", async () => ({
    apiVersion: API_VERSION,
    data: await service.getCurrent(),
  }));

  // 更新界面勾选偏好，不影响正在运行或已经完成的 Turn。
  app.put("/api/v1/current-tool-selection", async (request, reply) => {
    const parsed = setCurrentToolSelectionRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        apiVersion: API_VERSION,
        error: {
          code: "invalid_request",
          message: "Current Tool Selection 请求参数无效",
          retryable: false,
          details: { issues: parsed.error.issues },
        },
      });
    }
    try {
      return {
        apiVersion: API_VERSION,
        data: await service.setCurrent(parsed.data.selection),
      };
    } catch (error) {
      if (!(error instanceof ToolRegistryError)) throw error;
      return reply.code(400).send({
        apiVersion: API_VERSION,
        error: { code: error.code, message: error.message, retryable: false },
      });
    }
  });
}
