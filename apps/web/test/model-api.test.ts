// @vitest-environment jsdom

import { API_VERSION } from "@llm-harness/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createModelProfile, setCurrentModelSelection, testModelProfile, updateModelProfile } from "../src/domains/models/api/model-api.js";

describe("Model API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("创建 Profile 时只通过请求发送一次真实密钥", async () => {
    const profile = { id: "profile_test", displayName: "OpenAI", modelName: "gpt-4.1", baseUrl: "https://api.openai.com/v1", secret: { source: "local", reference: "profile_test", maskedValue: "sk-***" }, connection: { status: "untested" }, createdAt: "2026-08-19T00:00:00.000Z", updatedAt: "2026-08-19T00:00:00.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: API_VERSION, data: profile }), { status: 201 }));
    const input = { displayName: "OpenAI", modelName: profile.modelName, baseUrl: profile.baseUrl, secretValue: "sk-secret" };

    await createModelProfile(input);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/model-profiles", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
  });

  it("显式更新下一个 Turn 使用的模型", async () => {
    const selection = { profileId: "profile_test", modelName: "gpt-4.1" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: API_VERSION, data: { selection, updatedAt: "2026-08-19T00:00:00.000Z" } })));

    await setCurrentModelSelection(selection);

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/current-model-selection", expect.objectContaining({ method: "PUT", body: JSON.stringify({ selection }) }));
  });

  it("编辑 Profile 时可以保留现有密钥", async () => {
    const profile = { id: "profile_test", displayName: "新名称", modelName: "gpt-4.1", baseUrl: "https://example.com/v1", secret: { source: "local", reference: "profile_test", maskedValue: "••••test" }, connection: { status: "untested" }, createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: API_VERSION, data: profile })));

    await updateModelProfile(profile.id, { displayName: profile.displayName, baseUrl: profile.baseUrl });

    expect(fetchMock).toHaveBeenCalledWith("/api/v1/model-profiles/profile_test", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ displayName: profile.displayName, baseUrl: profile.baseUrl }) }));
  });

  it("连接测试携带具体模型名称调用 Chat Completions 测试接口", async () => {
    const profile = { id: "profile_test", displayName: "OpenAI", modelName: "gpt-4.1", baseUrl: "https://api.openai.com/v1", secret: { source: "local", reference: "profile_test", maskedValue: "••••test" }, connection: { status: "succeeded", testedAt: "2026-08-20T00:00:00.000Z", latencyMs: 10 }, createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" };
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ apiVersion: API_VERSION, data: profile })));

    await testModelProfile(profile.id);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/model-profiles/profile_test/test-connection",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
