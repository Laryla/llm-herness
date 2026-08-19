import { randomUUID } from "node:crypto";

import {
  ModelError,
  type AssistantMessage,
  type LanguageModel,
  type ModelMessage,
  type ModelParameters,
  type SystemMessage,
  type TokenUsage,
  type ToolCall,
} from "@llm-harness/model-runtime";

import {
  abortRunContext,
  closeRunContext,
  consumePendingMessages,
  hasPendingMessages,
  type AgentRunContext,
} from "./context.js";
import { ToolConfirmationController } from "./confirmation.js";
import { AsyncEventQueue } from "./event-queue.js";
import type { AgentEvent, AgentRunError, AgentRunResult } from "./events.js";
import {
  AgentToolError,
  type AgentTool,
  type ToolExecutionResult,
} from "./tool.js";

export interface AgentLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

export interface CreateAgentOptions {
  readonly model: LanguageModel;
  readonly systemMessage?: SystemMessage;
  readonly tools?: readonly AgentTool[];
  readonly maxSteps?: number;
  readonly idGenerator?: () => string;
  readonly logger?: AgentLogger;
}

export interface AgentRunInput {
  readonly messages: readonly Exclude<ModelMessage, SystemMessage>[];
  readonly context: AgentRunContext;
  readonly parameters?: ModelParameters;
}

export interface AgentRun {
  readonly events: AsyncIterable<AgentEvent>;
  readonly result: Promise<AgentRunResult>;
  abort(reason?: string): void;
  confirmTool(toolCallId: string): boolean;
  rejectTool(toolCallId: string): boolean;
}

export interface Agent {
  run(input: AgentRunInput): AgentRun;
}

const emptyUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
});

interface MutableTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

type AgentEventInput = AgentEvent extends infer Event
  ? Event extends AgentEvent
    ? Omit<Event, "runId" | "sequence">
    : never
  : never;

const silentLogger: AgentLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 创建不可变 Agent 配置；每次 run 都拥有独立的 Context 和消息状态。 */
export function createAgent(options: CreateAgentOptions): Agent {
  const maxSteps = options.maxSteps ?? 50;
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) {
    throw new Error("maxSteps 必须是 1–100 之间的整数");
  }
  const tools = [...(options.tools ?? [])];
  const toolsByName = new Map<string, AgentTool>();
  for (const tool of tools) {
    if (toolsByName.has(tool.definition.name)) {
      throw new Error(`工具名称重复：${tool.definition.name}`);
    }
    toolsByName.set(tool.definition.name, tool);
  }
  const configuration = Object.freeze({
    idGenerator: options.idGenerator ?? randomUUID,
    logger: options.logger ?? silentLogger,
    maxSteps,
    model: options.model,
    systemMessage: options.systemMessage,
    tools: Object.freeze(tools),
    toolsByName,
  });

  return Object.freeze({
    run(input: AgentRunInput): AgentRun {
      const queue = new AsyncEventQueue<AgentEvent>();
      const confirmations = new ToolConfirmationController();
      const result = executeAgentRun(
        configuration,
        input,
        queue,
        confirmations,
      ).finally(() => {
        confirmations.close();
        closeRunContext(input.context);
        queue.close();
      });
      return Object.freeze({
        events: queue,
        result,
        abort: (reason?: string) => abortRunContext(input.context, reason),
        confirmTool: (toolCallId: string) =>
          confirmations.decide(toolCallId, "confirmed"),
        rejectTool: (toolCallId: string) =>
          confirmations.decide(toolCallId, "rejected"),
      });
    },
  });
}

interface AgentConfiguration {
  readonly idGenerator: () => string;
  readonly logger: AgentLogger;
  readonly maxSteps: number;
  readonly model: LanguageModel;
  readonly systemMessage?: SystemMessage;
  readonly tools: readonly AgentTool[];
  readonly toolsByName: ReadonlyMap<string, AgentTool>;
}

interface MutableToolCall {
  id?: string;
  name?: string;
  arguments: string;
}

async function executeAgentRun(
  configuration: AgentConfiguration,
  input: AgentRunInput,
  queue: AsyncEventQueue<AgentEvent>,
  confirmations: ToolConfirmationController,
): Promise<AgentRunResult> {
  let sequence = 0;
  let stepCount = 0;
  let finalText = "";
  const usage: MutableTokenUsage = emptyUsage();
  const messages: ModelMessage[] = [
    ...(configuration.systemMessage ? [configuration.systemMessage] : []),
    ...input.messages,
  ];
  const emit = (event: AgentEventInput) => {
    sequence += 1;
    queue.push({ ...event, runId: input.context.runId, sequence });
  };

  emit({ type: "run.started" });
  configuration.logger.info(
    { modelId: configuration.model.modelId, runId: input.context.runId },
    "Agent Run 开始",
  );

  try {
    while (stepCount < configuration.maxSteps) {
      throwIfAborted(input.context.signal);
      for (const steeringMessage of consumePendingMessages(input.context)) {
        messages.push({ role: "user", content: steeringMessage.content });
        emit({
          type: "message.applied",
          messageId: steeringMessage.id,
          content: steeringMessage.content,
        });
      }

      stepCount += 1;
      const stepId = configuration.idGenerator();
      emit({ type: "step.started", stepId, stepIndex: stepCount });
      const toolCallParts = new Map<number, MutableToolCall>();
      let stepText = "";
      let finishReason: string | null = null;
      let stepUsage: TokenUsage | undefined;

      for await (const event of configuration.model.stream({
        // 每个 Step 持有独立消息快照，避免后续追加消息污染已发出的请求与 Trace。
        messages: [...messages],
        parameters: input.parameters,
        signal: input.context.signal,
        ...(configuration.tools.length > 0
          ? { tools: configuration.tools.map(({ definition }) => definition) }
          : {}),
      })) {
        if (event.type === "text_delta") {
          stepText += event.delta;
          emit({ type: "model.text.delta", stepId, delta: event.delta });
        } else if (event.type === "tool_call_delta") {
          const part = toolCallParts.get(event.index) ?? { arguments: "" };
          part.id = event.id ?? part.id;
          part.name = event.name ?? part.name;
          part.arguments += event.argumentsDelta ?? "";
          toolCallParts.set(event.index, part);
          emit({
            type: "model.tool_call.delta",
            stepId,
            index: event.index,
            ...(event.id ? { id: event.id } : {}),
            ...(event.name ? { name: event.name } : {}),
            ...(event.argumentsDelta
              ? { argumentsDelta: event.argumentsDelta }
              : {}),
          });
        } else {
          finishReason = event.finishReason;
          stepUsage = event.usage;
          if (stepUsage) {
            addUsage(usage, stepUsage);
          }
          emit({
            type: "model.completed",
            stepId,
            finishReason,
            ...(stepUsage ? { usage: stepUsage } : {}),
          });
        }
      }

      const toolCalls = collectToolCalls(toolCallParts);
      finalText = stepText;
      const assistantMessage: AssistantMessage = {
        role: "assistant",
        content: stepText.length > 0 ? stepText : null,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      };
      messages.push(assistantMessage);

      for (const toolCall of toolCalls) {
        throwIfAborted(input.context.signal);
        const tool = configuration.toolsByName.get(toolCall.name);
        const toolId = tool?.id ?? "tool_unknown";
        let rejected = false;
        if (tool?.policy === "requires_confirmation") {
          emit({
            type: "tool.confirmation.requested",
            stepId,
            toolId,
            toolCall,
          });
          const decision = await confirmations.wait(toolCall, input.context.signal);
          emit({
            type: "tool.confirmation.resolved",
            stepId,
            toolId,
            toolCall,
            decision,
          });
          rejected = decision === "rejected";
        }
        let result: ToolExecutionResult;
        if (rejected) {
          result = toolFailure("tool_rejected", "用户拒绝执行工具", false);
        } else {
          emit({ type: "tool.started", stepId, toolId, toolCall });
          result = await executeTool(
            toolCall,
            configuration.toolsByName,
            input.context,
          );
        }
        emit({ type: "tool.completed", stepId, toolId, toolCall, result });
        messages.push({
          role: "tool",
          toolCallId: toolCall.id,
          content: result.content,
        });
      }

      emit({
        type: "step.completed",
        stepId,
        stepIndex: stepCount,
        toolCallCount: toolCalls.length,
        ...(stepUsage ? { usage: stepUsage } : {}),
      });

      if (toolCalls.length === 0) {
        // 模型输出期间收到强制消息时继续下一 Step，保证已接受的消息不会静默丢失。
        if (hasPendingMessages(input.context) && stepCount < configuration.maxSteps) {
          continue;
        }
        closeRunContext(input.context);
        emit({ type: "run.completed", stepCount, usage: { ...usage } });
        return {
          runId: input.context.runId,
          status: "completed",
          finalText,
          messages,
          stepCount,
          usage,
        };
      }
    }

    closeRunContext(input.context);
    emit({ type: "run.stopped", reason: "max_steps_reached", stepCount });
    return {
      runId: input.context.runId,
      status: "stopped",
      finalText,
      messages,
      stepCount,
      usage,
      stopReason: "max_steps_reached",
    };
  } catch (error) {
    if (input.context.signal.aborted) {
      emit({ type: "run.cancelled", stepCount });
      return {
        runId: input.context.runId,
        status: "cancelled",
        finalText,
        messages,
        stepCount,
        usage,
      };
    }
    const runError = toAgentRunError(error);
    configuration.logger.warn(
      { errorCode: runError.code, runId: input.context.runId, stepCount },
      "Agent Run 失败",
    );
    emit({ type: "run.failed", stepCount, error: runError });
    return {
      runId: input.context.runId,
      status: "failed",
      finalText,
      messages,
      stepCount,
      usage,
      error: runError,
    };
  }
}

function collectToolCalls(parts: ReadonlyMap<number, MutableToolCall>): ToolCall[] {
  return [...parts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([index, part]) => {
      if (!part.id || !part.name) {
        throw new Error(`模型返回了不完整的 Tool Call：${index}`);
      }
      return { id: part.id, name: part.name, arguments: part.arguments };
    });
}

async function executeTool(
  toolCall: ToolCall,
  toolsByName: ReadonlyMap<string, AgentTool>,
  context: AgentRunContext,
): Promise<ToolExecutionResult> {
  const tool = toolsByName.get(toolCall.name);
  if (!tool) {
    return toolFailure("tool_not_found", `找不到工具：${toolCall.name}`, false);
  }
  let input: unknown;
  try {
    input = JSON.parse(toolCall.arguments) as unknown;
  } catch {
    return toolFailure("invalid_tool_arguments", "工具参数不是有效的 JSON", false);
  }
  let output: unknown;
  try {
    output = await tool.execute(input, context);
  } catch (error) {
    if (error instanceof AgentToolError) {
      return toolFailure(error.code, error.message, error.retryable);
    }
    const message = error instanceof Error ? error.message : "工具执行失败";
    return toolFailure("tool_execution_failed", message, true);
  }
  return serializeSuccessfulToolResult(output);
}

function serializeSuccessfulToolResult(output: unknown): ToolExecutionResult {
  return { ok: true, content: serializeToolResult({ ok: true, output }) };
}

function toolFailure(
  code: string,
  message: string,
  retryable: boolean,
): ToolExecutionResult {
  const error = { code, message, retryable };
  return { ok: false, content: serializeToolResult({ ok: false, error }), error };
}

function serializeToolResult(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Tool Result 无法安全序列化");
  }
  return serialized;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ModelError("cancelled", "Agent Run 已取消", false);
  }
}

function addUsage(target: MutableTokenUsage, addition: TokenUsage): void {
  target.inputTokens += addition.inputTokens;
  target.outputTokens += addition.outputTokens;
  target.totalTokens += addition.totalTokens;
}

function toAgentRunError(error: unknown): AgentRunError {
  if (error instanceof ModelError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "agent_runtime_failed",
    message: error instanceof Error ? error.message : "Agent Runtime 运行失败",
    retryable: false,
  };
}
