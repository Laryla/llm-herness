import type { ToolDefinition } from "@llm-harness/model-runtime";
import { z } from "zod";

import type { AgentRunContext } from "./context.js";

/** 可执行工具；definition 发给模型，execute 只由 Agent Runtime 调用。 */
export interface AgentTool {
  readonly id: string;
  readonly policy: "automatic" | "requires_confirmation";
  readonly definition: ToolDefinition;
  execute(input: unknown, context: AgentRunContext): Promise<unknown>;
}

export class AgentToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentToolError";
  }
}

export interface DefineToolOptions<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly policy?: AgentTool["policy"];
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;
  execute(
    input: z.infer<InputSchema>,
    context: AgentRunContext,
  ): Promise<z.infer<OutputSchema>> | z.infer<OutputSchema>;
}

/** 用 Zod 同时约束工具输入、输出和发给模型的 JSON Schema。 */
export function defineTool<
  InputSchema extends z.ZodType,
  OutputSchema extends z.ZodType,
>(options: DefineToolOptions<InputSchema, OutputSchema>): AgentTool & {
  readonly inputSchema: InputSchema;
  readonly outputSchema: OutputSchema;
} {
  return Object.freeze({
    id: options.id,
    policy: options.policy ?? "requires_confirmation",
    definition: {
      name: options.name,
      description: options.description,
      inputSchema: z.toJSONSchema(options.inputSchema),
    },
    inputSchema: options.inputSchema,
    outputSchema: options.outputSchema,
    async execute(input: unknown, context: AgentRunContext): Promise<unknown> {
      const parsedInput = options.inputSchema.safeParse(input);
      if (!parsedInput.success) {
        throw new AgentToolError("invalid_tool_arguments", "工具参数校验失败");
      }
      const output = await options.execute(parsedInput.data, context);
      const parsedOutput = options.outputSchema.safeParse(output);
      if (!parsedOutput.success) {
        throw new AgentToolError("invalid_tool_output", "工具输出校验失败");
      }
      return parsedOutput.data;
    },
  });
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
