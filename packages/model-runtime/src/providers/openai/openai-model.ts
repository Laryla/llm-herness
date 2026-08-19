import OpenAI from "openai";

import { ModelError } from "../../errors.js";
import type { ModelMessage } from "../../messages.js";
import type {
  LanguageModel,
  ModelEvent,
  ModelRequest,
} from "../../model.js";

export interface OpenAIModelOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  /** 供应商实际识别的模型名称，不是 Harness 数据库记录 ID。 */
  readonly modelId: string;
}

export interface ModelLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

type ClientFactory = (options: ConstructorParameters<typeof OpenAI>[0]) => OpenAI;
type RetryDelay = (attempt: number) => Promise<void>;

/** 高级依赖注入入口，主要用于宿主接入日志以及确定性测试。 */
export interface OpenAIModelDependencies {
  readonly logger?: ModelLogger;
  readonly createClient?: ClientFactory;
  readonly retryDelay?: RetryDelay;
}

const silentLogger: ModelLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** 创建一个绑定连接配置和供应商模型名称的 OpenAI Chat Completions 模型。 */
export function createOpenAIModel(
  options: OpenAIModelOptions,
  dependencies: OpenAIModelDependencies = {},
): LanguageModel {
  const normalizedOptions: OpenAIModelOptions = {
    apiKey: requireValue(options.apiKey, "API Key"),
    baseUrl: normalizeBaseUrl(options.baseUrl),
    modelId: requireValue(options.modelId, "模型名称"),
  };
  const logger = dependencies.logger ?? silentLogger;
  const createClient = dependencies.createClient ?? ((config) => new OpenAI(config));
  const retryDelay =
    dependencies.retryDelay ??
    ((attempt) => new Promise((resolve) => setTimeout(resolve, attempt * 200)));

  return {
    provider: "openai",
    modelId: normalizedOptions.modelId,
    stream: (request) =>
      streamOpenAIModel(
        normalizedOptions,
        request,
        logger,
        createClient,
        retryDelay,
      ),
  };
}

/** 调用 Chat Completions，并将 SDK Chunk 转换成稳定的模型事件。 */
async function* streamOpenAIModel(
  options: OpenAIModelOptions,
  request: ModelRequest,
  logger: ModelLogger,
  createClient: ClientFactory,
  retryDelay: RetryDelay,
): AsyncGenerator<ModelEvent> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    let emittedOutput = false;
    try {
      logger.info(
        { attempt, modelId: options.modelId, provider: "openai" },
        "开始调用模型",
      );
      const client = createClient({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        maxRetries: 0,
        timeout: 30_000,
      });
      const stream = await client.chat.completions.create(
        {
          model: options.modelId,
          messages: request.messages.map(toOpenAIMessage),
          stream: true,
          stream_options: { include_usage: true },
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function" as const,
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema,
                  },
                })),
              }
            : {}),
          ...(request.parameters?.temperature === undefined
            ? {}
            : { temperature: request.parameters.temperature }),
          ...(request.parameters?.topP === undefined
            ? {}
            : { top_p: request.parameters.topP }),
          ...(request.parameters?.maxTokens === undefined
            ? {}
            : { max_tokens: request.parameters.maxTokens }),
          ...(request.parameters?.stop === undefined
            ? {}
            : { stop: [...request.parameters.stop] }),
        },
        { signal: request.signal },
      );

      let finishReason: string | null = null;
      let usage: Extract<ModelEvent, { type: "completed" }>["usage"];
      for await (const chunk of stream) {
        const choice = chunk.choices[0];
        if (choice?.finish_reason !== undefined) {
          finishReason = choice.finish_reason;
        }
        const content = choice?.delta.content;
        if (content) {
          emittedOutput = true;
          yield { type: "text_delta", delta: content };
        }
        for (const toolCall of choice?.delta.tool_calls ?? []) {
          emittedOutput = true;
          yield {
            type: "tool_call_delta",
            index: toolCall.index,
            ...(toolCall.id ? { id: toolCall.id } : {}),
            ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
            ...(toolCall.function?.arguments
              ? { argumentsDelta: toolCall.function.arguments }
              : {}),
          };
        }
        if (chunk.usage) {
          usage = {
            inputTokens: chunk.usage.prompt_tokens,
            outputTokens: chunk.usage.completion_tokens,
            totalTokens: chunk.usage.total_tokens,
          };
        }
      }
      logger.info(
        { attempt, finishReason, modelId: options.modelId, provider: "openai" },
        "模型流完成",
      );
      yield { type: "completed", finishReason, ...(usage ? { usage } : {}) };
      return;
    } catch (error) {
      if (request.signal?.aborted) {
        throw new ModelError("cancelled", "模型调用已取消", false);
      }
      const mapped = mapOpenAIError(error, emittedOutput);
      const canRetry = mapped.retryable && !emittedOutput && attempt < 3;
      logger.warn(
        {
          attempt,
          errorCode: mapped.code,
          modelId: options.modelId,
          provider: "openai",
          retrying: canRetry,
          status: mapped.status,
        },
        "模型调用失败",
      );
      if (!canRetry) {
        throw mapped;
      }
      await retryDelay(attempt);
    }
  }
}

function toOpenAIMessage(
  message: ModelMessage,
): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  switch (message.role) {
    case "system":
      return { role: "system", content: message.content };
    case "user":
      return { role: "user", content: message.content };
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        content: message.content,
      };
  }
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (normalized.length === 0) {
    throw new ModelError("invalid_request", "模型服务地址不能为空", false);
  }
  return normalized;
}

function requireValue(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ModelError("invalid_request", `${fieldName}不能为空`, false);
  }
  return normalized;
}

/** 将未知的 SDK/网络错误转换成不包含响应正文和密钥的稳定错误。 */
function mapOpenAIError(error: unknown, emittedOutput: boolean): ModelError {
  if (emittedOutput) {
    return new ModelError("stream_interrupted", "模型流在输出过程中中断", false);
  }
  const status = getErrorStatus(error);
  if (status === 401 || status === 403) {
    return new ModelError("authentication_failed", "模型服务认证失败", false, status);
  }
  if (status === 404) {
    return new ModelError("model_not_found", "模型不存在", false, status);
  }
  if (status === 400 || status === 422) {
    return new ModelError("invalid_request", "模型请求参数无效", false, status);
  }
  if (status === 429) {
    return new ModelError("rate_limited", "模型服务限流", true, status);
  }
  return new ModelError(
    "upstream_unavailable",
    "模型服务暂时不可用",
    true,
    status,
  );
}

function getErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return undefined;
  }
  return typeof error.status === "number" ? error.status : undefined;
}
