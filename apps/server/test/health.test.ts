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
});
