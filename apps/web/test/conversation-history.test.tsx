// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { Message, ServerEvent, Turn } from "@llm-harness/contracts";
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

  it("把历史消息和流式内容按 GFM 与换行规则渲染", () => {
    const assistantMessage: Message = { id: "message_test", conversationId: turn.conversationId, turnId: turn.id, stepId: "step_done", sequence: 1, role: "assistant", content: "## 已完成\n第一行\n第二行\n\n- 项目 A\n- 项目 B", createdAt: "2026-08-20T00:00:01.000Z" };
    const view = render(<ConversationHistory confirmations={[]} liveText={{ [turn.id]: "**生成中**\n下一行" }} loading={false} messages={[assistantMessage]} onConfirmTool={vi.fn()} onSelectTrace={vi.fn()} selectedTraceTurnId={turn.id} turns={[turn]} />);

    expect(screen.getByRole("heading", { level: 2, name: "已完成" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("生成中").tagName).toBe("STRONG");
    expect(view.container.querySelectorAll("br").length).toBeGreaterThanOrEqual(2);
  });
});
