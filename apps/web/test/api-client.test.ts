// @vitest-environment jsdom

import { API_VERSION } from "@llm-harness/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { requestApi } from "../src/shared/api/client.js";
import type { ApiClientError } from "../src/shared/api/client.js";

describe("REST API Client", () => {
  afterEach(() => vi.restoreAllMocks());

  it("校验成功 Envelope 并返回 data", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ apiVersion: API_VERSION, data: { id: "ok" } })),
    );

    await expect(requestApi("/api/test", z.object({ id: z.string() }))).resolves.toEqual({
      id: "ok",
    });
  });

  it("把错误 Envelope 转换成带状态码的 ApiClientError", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          apiVersion: API_VERSION,
          error: { code: "not_found", message: "不存在", retryable: false },
        }),
        { status: 404 },
      ),
    );

    await expect(requestApi("/api/test", z.string())).rejects.toMatchObject({
      status: 404,
      message: "不存在",
    } satisfies Partial<ApiClientError>);
  });
});
