import type { ModelMessage } from "./messages.js";
import type { ToolDefinition } from "./tools.js";

export interface ModelParameters {
  readonly temperature?: number;
  readonly topP?: number;
  readonly maxTokens?: number;
  readonly stop?: readonly string[];
}

export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ToolDefinition[];
  readonly parameters?: ModelParameters;
  readonly signal?: AbortSignal;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
}

/** 模型流只表达供应商无关的增量；Agent Runtime 负责聚合 Tool Call。 */
export type ModelEvent =
  | { readonly type: "text_delta"; readonly delta: string }
  | {
      readonly type: "tool_call_delta";
      readonly index: number;
      readonly id?: string;
      readonly name?: string;
      readonly argumentsDelta?: string;
    }
  | {
      readonly type: "completed";
      readonly finishReason: string | null;
      readonly usage?: TokenUsage;
    };

/** Agent Runtime 只依赖该接口，不依赖任何供应商 SDK。 */
export interface LanguageModel {
  readonly provider: string;
  readonly modelId: string;
  stream(request: ModelRequest): AsyncGenerator<ModelEvent>;
}
