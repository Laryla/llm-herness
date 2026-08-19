import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";

export interface CreateAppOptions {
  staticRoot?: string;
}

export function createApp(options: CreateAppOptions = {}): FastifyInstance {
  const app = Fastify();

  app.get("/health", () => ({ status: "ok" }));

  if (options.staticRoot) {
    app.register(fastifyStatic, { root: options.staticRoot });
    app.setNotFoundHandler(async (_request, reply) => reply.sendFile("index.html"));
  }

  return app;
}
