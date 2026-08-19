import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("Harness Server health", () => {
  let app: Awaited<ReturnType<typeof createApp>> | undefined;

  afterEach(async () => {
    await app?.close();
  });

  it("reports that the server is healthy", async () => {
    app = createApp();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("数据库不可用时返回 503", async () => {
    app = createApp({
      database: {
        provider: "sqlite",
        isHealthy: () => Promise.resolve(false),
        disconnect: () => Promise.resolve(),
      },
    });

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "unhealthy",
      database: { provider: "sqlite", status: "unhealthy" },
    });
  });

  it("关闭应用时断开数据库", async () => {
    let disconnected = false;
    app = createApp({
      database: {
        provider: "sqlite",
        isHealthy: () => Promise.resolve(true),
        disconnect: () => {
          disconnected = true;
          return Promise.resolve();
        },
      },
    });

    await app.close();
    app = undefined;

    expect(disconnected).toBe(true);
  });
});
