import type { ToolDefinition } from "@llm-harness/model-runtime";

import type { AgentRunContext } from "./context.js";

/** 可执行工具；definition 发给模型，execute 只由 Agent Runtime 调用。 */
export interface AgentTool {
  readonly definition: ToolDefinition;
  execute(input: unknown, context: AgentRunContext): Promise<unknown>;
}

export type ToolExecutionResult =
  | { readonly ok: true; readonly content: string }
  | {
      readonly ok: false;
      readonly content: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly retryable: boolean;
      };
    };
