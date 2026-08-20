import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import type { PersistenceClient } from "./infrastructure/database/database.js";
import type { SecretStore } from "./infrastructure/secrets/secret-store.js";
import { registerConversationRoutes } from "./modules/conversations/conversation-routes.js";
import { ConversationService } from "./modules/conversations/conversation-service.js";
import { registerModelProfileRoutes } from "./modules/models/model-profile-routes.js";
import { ModelProfileService } from "./modules/models/model-profile-service.js";
import type { RuntimeGateway } from "./modules/runtime/runtime-gateway.js";
import { AgentRuntimeGateway } from "./modules/runtime/agent-runtime-gateway.js";
import { registerRuntimeRoutes } from "./modules/runtime/runtime-routes.js";
import { createBuiltinTools } from "./modules/tools/builtin-tools.js";
import { ToolRegistry } from "./modules/tools/tool-registry.js";
import { registerToolRoutes } from "./modules/tools/tool-routes.js";
import { ToolService } from "./modules/tools/tool-service.js";
import { registerWorkspaceRoutes } from "./modules/workspaces/workspace-routes.js";

export interface CreateAppOptions {
  staticRoot?: string;
  logger?: boolean;
  database?: {
    readonly provider: "sqlite" | "mysql" | "postgresql";
    readonly client?: PersistenceClient;
    isHealthy(): Promise<boolean>;
    disconnect(): Promise<void>;
  };
  secretStores?: {
    readonly keychain: SecretStore;
    readonly local: SecretStore;
    readonly environment: SecretStore;
    readonly writable: SecretStore;
  };
  /** 注入运行网关后启用 `/api/v1/runtime` WebSocket。 */
  runtimeGateway?: RuntimeGateway;
  /** 单个 Turn 最多调用模型的次数。 */
  maxSteps?: number;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const toolRegistry = new ToolRegistry(createBuiltinTools());
  // WebSocket 插件必须先于所有路由注册，才能正确接管 Upgrade 请求。
  void app.register(fastifyWebsocket, { options: { maxPayload: 1_048_576 } });

  const runtimeGateway =
    options.runtimeGateway ??
    (options.database?.client && options.secretStores
      ? new AgentRuntimeGateway(
          options.database.client,
          options.secretStores,
          toolRegistry,
          options.maxSteps ?? 50,
          app.log,
        )
      : undefined);
  if (runtimeGateway) {
    void app.register((runtimeApp, _pluginOptions, done) => {
      registerRuntimeRoutes(runtimeApp, runtimeGateway);
      done();
    });
  }

  app.get("/health", async (_request, reply) => {
    if (!options.database) {
      return { status: "ok" };
    }

    const healthy = await options.database.isHealthy();
    const database = {
      provider: options.database.provider,
      status: healthy ? "ok" : "unhealthy",
    };

    if (!healthy) {
      return reply.code(503).send({ status: "unhealthy", database });
    }

    return { status: "ok", database };
  });

  if (options.database) {
    app.addHook("onClose", async () => options.database?.disconnect());
    if (options.database.client) {
      registerToolRoutes(
        app,
        new ToolService(options.database.client, toolRegistry),
      );
      registerConversationRoutes(
        app,
        new ConversationService(options.database.client, app.log),
      );
      registerWorkspaceRoutes(app, options.database.client);
      if (options.secretStores) {
        registerModelProfileRoutes(
          app,
          new ModelProfileService(
            options.database.client,
            options.secretStores,
            fetch,
            app.log,
          ),
        );
      }
    }
  }

  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot });
    app.setNotFoundHandler(async (_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}
