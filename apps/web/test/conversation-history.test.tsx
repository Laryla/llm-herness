// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ServerEvent, Turn } from "@llm-harness/contracts";
import { describe, expect, it, vi } from "vitest";

import { ConversationHistory } from "../src/domains/conversations/components/conversation-history.js";

const turn: Turn = { id: "turn_test", conversationId: "conversation_test", workspaceId: "workspace_test", status: "awaiting_confirmation", userMessage: "写文件", modelSelection: { profileId: "profile_test", modelName: "gpt-4.1" }, modelParameters: {}, toolBinding: { tools: [] }, instructions: "", maxIterations: 8, createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:01.000Z" };
const confirmation: Extract<ServerEvent, { type: "tool.confirmation_requested" }> = { apiVersion: "v1", eventId: "event_test", sequence: 1, occurredAt: "2026-08-20T00:00:01.000Z", type: "tool.confirmation_requested", conversationId: turn.conversationId, turnId: turn.id, stepId: "step_test", toolId: "tool_write", toolCallId: "call_test", arguments: { path: "README.md" } };

describe("Conversation History", () => {
  it("展示增量文本并把工具确认操作交给 Runtime", () => {
    const onConfirmTool = vi.fn();
    render(<ConversationHistory confirmations={[confirmation]} liveText={{ [turn.id]: "正在处理" }} loading={false} messages={[]} onConfirmTool={onConfirmTool} onSelectTrace={vi.fn()} selectedTraceTurnId={turn.id} turns={[turn]} />);

    expect(screen.getByText(/正在处理/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "确认执行" }));
    expect(onConfirmTool).toHaveBeenCalledWith(confirmation, true);
  });
});
