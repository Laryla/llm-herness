import Fastify, {
  type FastifyInstance,
  type RouteHandlerMethod,
} from "fastify";
import type OpenAI from "openai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelError, ModelEvent } from "@llm-harness/model-runtime";
import { createOpenAIModel } from "@llm-harness/model-runtime/openai";

let server: FastifyInstance | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

async function startServer(
  handler: RouteHandlerMethod,
): Promise<string> {
  server = Fastify();
  server.post("/v1/chat/completions", handler);
  const address = await server.listen({ host: "127.0.0.1", port: 0 });
  return `${address}/v1`;
}

async function collect(stream: AsyncGenerator<ModelEvent>) {
  const events: ModelEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

function writeEvent(response: NodeJS.WritableStream, payload: unknown): void {
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

describe("OpenAI Model", () => {
  it("通过简单工厂绑定供应商模型名称", () => {
    const model = createOpenAIModel({
      apiKey: "secret",
      baseUrl: "https://example.com/v1/",
      modelId: "gpt-test",
    });

    expect(model.provider).toBe("openai");
    expect(model.modelId).toBe("gpt-test");
  });

  it("拒绝空的模型服务地址", () => {
    expect(() =>
      createOpenAIModel({ apiKey: "secret", baseUrl: "  ", modelId: "model-a" }),
    ).toThrowError("模型服务地址不能为空");
  });

  it("拒绝空的 API Key 和供应商模型名称", () => {
    expect(() =>
      createOpenAIModel({
        apiKey: " ",
        baseUrl: "https://example.com/v1",
        modelId: "model-a",
      }),
    ).toThrowError("API Key不能为空");
    expect(() =>
      createOpenAIModel({
        apiKey: "secret",
        baseUrl: "https://example.com/v1",
        modelId: " ",
      }),
    ).toThrowError("模型名称不能为空");
  });

  it("发送受限请求参数并解析文本、Tool Call 与 Usage 流", async () => {
    let requestBody: Record<string, unknown> | undefined;
    const baseUrl = await startServer(async (request, reply) => {
      requestBody = request.body as Record<string, unknown>;
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      writeEvent(reply.raw, {
        id: "chatcmpl_test",
        object: "chat.completion.chunk",
        created: 1,
        model: "model-a",
        choices: [{ index: 0, delta: { content: "你好" }, finish_reason: null }],
      });
      writeEvent(reply.raw, {
        id: "chatcmpl_test",
        object: "chat.completion.chunk",
        created: 1,
        model: "model-a",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "calculate", arguments: "{\"x\":" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      });
      writeEvent(reply.raw, {
        id: "chatcmpl_test",
        object: "chat.completion.chunk",
        created: 1,
        model: "model-a",
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
        usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
      });
      reply.raw.end("data: [DONE]\n\n");
    });
    const model = createOpenAIModel({
      apiKey: "test-secret",
      baseUrl,
      modelId: "model-a",
    });

    const events = await collect(
      model.stream({
        messages: [
          { role: "user", content: "你好" },
          {
            role: "assistant",
            content: null,
            toolCalls: [
              {
                id: "previous_call",
                name: "calculate",
                arguments: "{\"x\":1}",
              },
            ],
          },
          { role: "tool", toolCallId: "previous_call", content: "1" },
        ],
        parameters: {
          temperature: 0.2,
          topP: 0.9,
          maxTokens: 100,
          stop: ["END"],
        },
        tools: [
          {
            name: "calculate",
            description: "计算",
            inputSchema: { type: "object" },
          },
        ],
      }),
    );

    expect(events).toEqual([
      { type: "text_delta", delta: "你好" },
      {
        type: "tool_call_delta",
        index: 0,
        id: "call_1",
        name: "calculate",
        argumentsDelta: "{\"x\":",
      },
      {
        type: "completed",
        finishReason: "tool_calls",
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
      },
    ]);
    expect(requestBody).toMatchObject({
      model: "model-a",
      stream: true,
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 100,
      stop: ["END"],
    });
    expect(requestBody).not.toHaveProperty("extra_body");
    expect(requestBody?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "tool",
          tool_call_id: "previous_call",
          content: "1",
        }),
      ]),
    );
  });

  it("尚未输出时对限流最多重试两次", async () => {
    let calls = 0;
    const baseUrl = await startServer(async (_request, reply) => {
      calls += 1;
      if (calls < 3) {
        return reply.code(429).send({
          error: { message: "rate limited", type: "rate_limit_error" },
        });
      }
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      writeEvent(reply.raw, {
        id: "chatcmpl_retry",
        object: "chat.completion.chunk",
        created: 1,
        model: "model-a",
        choices: [{ index: 0, delta: { content: "成功" }, finish_reason: "stop" }],
      });
      reply.raw.end("data: [DONE]\n\n");
    });
    const retryDelay = vi.fn(() => Promise.resolve());
    const model = createOpenAIModel(
      { apiKey: "secret", baseUrl, modelId: "model-a" },
      { retryDelay },
    );

    const events = await collect(
      model.stream({
        messages: [{ role: "user", content: "重试" }],
      }),
    );

    expect(calls).toBe(3);
    expect(retryDelay).toHaveBeenCalledTimes(2);
    expect(events[0]).toEqual({ type: "text_delta", delta: "成功" });
  });

  it("认证失败不重试且错误不包含上游正文", async () => {
    let calls = 0;
    const baseUrl = await startServer(async (_request, reply) => {
      calls += 1;
      return reply.code(401).send({
        error: { message: "secret-leak", type: "authentication_error" },
      });
    });
    const model = createOpenAIModel(
      { apiKey: "secret-leak", baseUrl, modelId: "model-a" },
      { retryDelay: () => Promise.resolve() },
    );

    const failure = collect(
      model.stream({
        messages: [{ role: "user", content: "认证" }],
      }),
    );

    await expect(failure).rejects.toMatchObject({
      code: "authentication_failed",
      retryable: false,
      status: 401,
    } satisfies Partial<ModelError>);
    await expect(failure).rejects.not.toThrow("secret-leak");
    expect(calls).toBe(1);
  });

  it("已有输出后流中断不重试", async () => {
    let calls = 0;
    const fakeClient = {
      chat: {
        completions: {
          create: () => {
            calls += 1;
            return (async function* () {
              await Promise.resolve();
              yield {
                choices: [
                  { index: 0, delta: { content: "部分" }, finish_reason: null },
                ],
              };
              throw new Error("connection reset");
            })();
          },
        },
      },
    } as unknown as OpenAI;
    const retryDelay = vi.fn(() => Promise.resolve());
    const model = createOpenAIModel(
      {
        apiKey: "secret",
        baseUrl: "http://unused.local/v1",
        modelId: "model-a",
      },
      { createClient: () => fakeClient, retryDelay },
    );
    const events: ModelEvent[] = [];

    const consume = async () => {
      for await (const event of model.stream({
        messages: [{ role: "user", content: "中断" }],
      })) {
        events.push(event);
      }
    };

    await expect(consume()).rejects.toMatchObject({
      code: "stream_interrupted",
      retryable: false,
    });
    expect(events).toEqual([{ type: "text_delta", delta: "部分" }]);
    expect(calls).toBe(1);
    expect(retryDelay).not.toHaveBeenCalled();
  });
});
