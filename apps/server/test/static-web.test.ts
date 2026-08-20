import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

describe("Web 静态资源托管", () => {
  let staticRoot: string;

  beforeEach(async () => {
    staticRoot = await mkdtemp(join(tmpdir(), "llm-harness-web-"));
    await writeFile(
      join(staticRoot, "index.html"),
      "<!doctype html><title>LLM Harness</title>",
      "utf8",
    );
  });

  afterEach(async () => {
    await rm(staticRoot, { force: true, recursive: true });
  });

  it.each(["/", "/conversations/new"])(
    "为 %s 返回 Web 入口",
    async (url) => {
      const app = createApp({ staticRoot });

      const response = await app.inject({ method: "GET", url });
      await app.close();

      expect(response.statusCode).toBe(200);
      expect(response.body).toContain("<title>LLM Harness</title>");
    },
  );
});
