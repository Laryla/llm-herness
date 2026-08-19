import type { ToolCall } from "@llm-harness/model-runtime";

export type ToolConfirmationDecision = "confirmed" | "rejected";

interface PendingConfirmation {
  readonly resolve: (decision: ToolConfirmationDecision) => void;
  readonly reject: (error: Error) => void;
  detachAbort(): void;
}

/** 每个 AgentRun 独立持有确认门，不跨 Turn 共享任何决策。 */
export class ToolConfirmationController {
  private readonly pending = new Map<string, PendingConfirmation>();

  wait(toolCall: ToolCall, signal: AbortSignal): Promise<ToolConfirmationDecision> {
    if (signal.aborted) {
      return Promise.reject(new Error("Tool Call 确认已取消"));
    }
    if (this.pending.has(toolCall.id)) {
      return Promise.reject(new Error(`Tool Call 正在等待确认：${toolCall.id}`));
    }
    return new Promise((resolve, reject) => {
      const abort = () => {
        this.pending.delete(toolCall.id);
        reject(new Error("Tool Call 确认已取消"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(toolCall.id, {
        resolve,
        reject,
        detachAbort: () => signal.removeEventListener("abort", abort),
      });
    });
  }

  decide(toolCallId: string, decision: ToolConfirmationDecision): boolean {
    const pending = this.pending.get(toolCallId);
    if (!pending) {
      return false;
    }
    this.pending.delete(toolCallId);
    pending.detachAbort();
    pending.resolve(decision);
    return true;
  }

  close(): void {
    for (const pending of this.pending.values()) {
      pending.detachAbort();
      pending.reject(new Error("Agent Run 已结束"));
    }
    this.pending.clear();
  }
}
