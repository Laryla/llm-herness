// @vitest-environment jsdom

import { API_VERSION } from "@llm-harness/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getCurrentToolSelection } from "../src/domains/runtime/api/runtime-settings-api.js";

describe("Runtime Settings API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("发送前读取工具选择", async () => {
    const updatedAt = "2026-08-19T00:00:00.000Z";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify({ apiVersion: API_VERSION, data: { selection: { toolIds: [] }, updatedAt } })));

    await expect(getCurrentToolSelection()).resolves.toMatchObject({ selection: { toolIds: [] } });
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/current-tool-selection", expect.any(Object));
  });
});
