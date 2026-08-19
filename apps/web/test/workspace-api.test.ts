// @vitest-environment jsdom

import { API_VERSION } from "@llm-harness/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createWorkspace,
  getCurrentWorkspace,
  listWorkspaces,
  setCurrentWorkspace,
} from "../src/domains/workspaces/api/workspace-api.js";

const workspace = {
  id: "workspace_test",
  name: "测试项目",
  path: "/tmp/test-project",
  status: "available",
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

describe("Workspace API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("读取列表和当前工作空间", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiVersion: API_VERSION, data: [workspace] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiVersion: API_VERSION, data: { workspaceId: workspace.id, updatedAt: workspace.updatedAt } })));

    await expect(listWorkspaces()).resolves.toEqual([workspace]);
    await expect(getCurrentWorkspace()).resolves.toMatchObject({ workspaceId: workspace.id });
  });

  it("使用明确的 JSON 请求创建和切换工作空间", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiVersion: API_VERSION, data: workspace }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ apiVersion: API_VERSION, data: { workspaceId: workspace.id, updatedAt: workspace.updatedAt } })));

    await createWorkspace({ name: workspace.name, path: workspace.path });
    await setCurrentWorkspace(workspace.id);

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/workspaces", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: workspace.name, path: workspace.path }) }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/current-workspace", expect.objectContaining({ method: "PUT", body: JSON.stringify({ workspaceId: workspace.id }) }));
  });
});
