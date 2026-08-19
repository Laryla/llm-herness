import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

import type { PersistenceClient } from "./infrastructure/database/database.js";
import type { SecretStore } from "./infrastructure/secrets/secret-store.js";
import { registerModelProfileRoutes } from "./modules/models/model-profile-routes.js";
import { ModelProfileService } from "./modules/models/model-profile-service.js";
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
    readonly environment: SecretStore;
    readonly writable: SecretStore;
  };
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });

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
