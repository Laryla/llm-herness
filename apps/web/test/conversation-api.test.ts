// @vitest-environment jsdom

import { API_VERSION } from "@llm-harness/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listConversations, listMessages, listTurns } from "../src/domains/conversations/api/conversation-api.js";

describe("Conversation API", () => {
  afterEach(() => vi.restoreAllMocks());

  it("按 Workspace 查询对话并读取选中对话资源", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ apiVersion: API_VERSION, data: [] }))),
    );

    await listConversations("workspace_a/b");
    await listMessages("conversation_test");
    await listTurns("conversation_test");

    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/v1/conversations?workspaceId=workspace_a%2Fb", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/conversations/conversation_test/messages", expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/v1/conversations/conversation_test/turns", expect.any(Object));
  });
});
