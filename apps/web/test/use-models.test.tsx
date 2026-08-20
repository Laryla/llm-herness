// @vitest-environment jsdom

import { API_VERSION } from "@llm-harness/contracts";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useModels } from "../src/domains/models/model/use-models.js";

afterEach(() => vi.restoreAllMocks());

describe("模型状态", () => {
  it("已有模型但尚未选择时自动选择第一个模型", async () => {
    const profile = {
      id: "profile_test",
      displayName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      secret: { source: "local", reference: "profile_test", maskedValue: "••••test" },
      connection: { status: "untested" },
      createdAt: "2026-08-20T00:00:00.000Z",
      updatedAt: "2026-08-20T00:00:00.000Z",
    };
    const selection = { profileId: profile.id, modelName: "gpt-4.1" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const data = path === "/api/v1/model-profiles"
        ? [profile]
        : path === "/api/v1/current-model-selection" && init?.method === "PUT"
          ? { selection, updatedAt: profile.updatedAt }
          : path === "/api/v1/current-model-selection"
            ? { selection: null, updatedAt: profile.updatedAt }
            : { profileId: profile.id, entries: [{ id: "catalog_test", ...selection, source: "manual", createdAt: profile.createdAt, updatedAt: profile.updatedAt }], refreshedAt: null };
      return Promise.resolve(new Response(JSON.stringify({ apiVersion: API_VERSION, data })));
    });

    const { result } = renderHook(() => useModels());

    await waitFor(() => expect(result.current.currentSelection).toEqual(selection));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/current-model-selection",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ selection }) }),
    );
  });
});
