// @vitest-environment jsdom

import type { QueuedMessage } from "@llm-harness/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MessageQueue } from "../src/domains/conversations/components/message-queue.js";

const messages: QueuedMessage[] = [
  { id: "queued_first", conversationId: "conversation_test", content: "第一条", position: 0, status: "queued", createdAt: "2026-08-20T00:00:00.000Z", updatedAt: "2026-08-20T00:00:00.000Z" },
  { id: "queued_second", conversationId: "conversation_test", content: "第二条", position: 1, status: "queued", createdAt: "2026-08-20T00:00:01.000Z", updatedAt: "2026-08-20T00:00:01.000Z" },
];

describe("MessageQueue", () => {
  it("支持调整顺序、编辑、删除和立即介入", () => {
    const onDelete = vi.fn();
    const onReorder = vi.fn();
    const onSteer = vi.fn();
    const onUpdate = vi.fn();
    render(<MessageQueue messages={messages} onDelete={onDelete} onReorder={onReorder} onSteer={onSteer} onUpdate={onUpdate} />);

    fireEvent.click(screen.getAllByLabelText("下移")[0]!);
    expect(onReorder).toHaveBeenCalledWith(["queued_second", "queued_first"]);

    fireEvent.click(screen.getAllByText("编辑")[0]!);
    fireEvent.change(screen.getByLabelText("编辑排队消息"), { target: { value: "修改后" } });
    fireEvent.click(screen.getByText("保存"));
    expect(onUpdate).toHaveBeenCalledWith("queued_first", "修改后");

    fireEvent.click(screen.getAllByText("立即介入")[0]!);
    expect(onSteer).toHaveBeenCalledWith(messages[0]);
    fireEvent.click(screen.getAllByText("×")[0]!);
    expect(onDelete).toHaveBeenCalledWith("queued_first");
  });
});
