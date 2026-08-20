import type {
  ModelMessage,
  TokenUsage,
  ToolCall,
} from "@llm-harness/model-runtime";

import type { ToolExecutionResult } from "./tool.js";

export type AgentRunStatus = "completed" | "stopped" | "cancelled" | "failed";

export interface AgentRunError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

interface AgentEventBase {
  readonly runId: string;
  readonly sequence: number;
}

/** 一个 Step 以模型调用为起点，并包含该响应产生的全部顺序工具执行。 */
export type AgentEvent =
  | (AgentEventBase & { readonly type: "run.started" })
  | (AgentEventBase & {
      readonly type: "message.applied";
      readonly messageId: string;
      readonly content: string;
    })
  | (AgentEventBase & {
      readonly type: "step.started";
      readonly stepId: string;
      readonly stepIndex: number;
    })
  | (AgentEventBase & {
      readonly type: "model.text.delta";
      readonly stepId: string;
      readonly delta: string;
    })
  | (AgentEventBase & {
      readonly type: "model.tool_call.delta";
      readonly stepId: string;
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta?: string;
    })
  | (AgentEventBase & {
      readonly type: "model.completed";
      readonly stepId: string;
      readonly finishReason: string | null;
      readonly usage?: TokenUsage;
    })
  | (AgentEventBase & {
      readonly type: "tool.confirmation.requested";
      readonly stepId: string;
      readonly toolId: string;
      readonly toolCall: ToolCall;
    })
  | (AgentEventBase & {
      readonly type: "tool.confirmation.resolved";
      readonly stepId: string;
      readonly toolId: string;
      readonly toolCall: ToolCall;
      readonly decision: "confirmed" | "rejected";
    })
  | (AgentEventBase & {
      readonly type: "tool.started";
      readonly stepId: string;
      readonly toolId: string;
      readonly toolCall: ToolCall;
    })
  | (AgentEventBase & {
      readonly type: "tool.completed";
      readonly stepId: string;
      readonly toolId: string;
      readonly toolCall: ToolCall;
      readonly result: ToolExecutionResult;
    })
  | (AgentEventBase & {
      readonly type: "step.completed";
      readonly stepId: string;
      readonly stepIndex: number;
      readonly toolCallCount: number;
      readonly usage?: TokenUsage;
    })
  | (AgentEventBase & {
      readonly type: "run.completed";
      readonly stepCount: number;
      readonly usage: TokenUsage;
    })
  | (AgentEventBase & {
      readonly type: "run.stopped";
      readonly reason: "max_steps_reached";
      readonly stepCount: number;
    })
  | (AgentEventBase & { readonly type: "run.cancelled"; readonly stepCount: number })
  | (AgentEventBase & {
      readonly type: "run.failed";
      readonly stepCount: number;
      readonly error: AgentRunError;
    });

export interface AgentRunResult {
  readonly runId: string;
  readonly status: AgentRunStatus;
  readonly finalText: string;
  readonly messages: readonly ModelMessage[];
  readonly stepCount: number;
  readonly usage: TokenUsage;
  readonly stopReason?: "max_steps_reached";
  readonly error?: AgentRunError;
}
