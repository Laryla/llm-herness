import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

export interface CreateAppOptions {
  staticRoot?: string;
  logger?: boolean;
  database?: {
    readonly provider: "sqlite" | "mysql" | "postgresql";
    isHealthy(): Promise<boolean>;
    disconnect(): Promise<void>;
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
  }

  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot });
    app.setNotFoundHandler(async (_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}
