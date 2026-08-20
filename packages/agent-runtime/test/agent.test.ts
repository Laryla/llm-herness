import {
  createAgent,
  createAgentRunContext,
  type AgentEvent,
  type AgentTool,
} from "@llm-harness/agent-runtime";
import type {
  LanguageModel,
  ModelEvent,
  ModelRequest,
} from "@llm-harness/model-runtime";
import { describe, expect, it, vi } from "vitest";

function scriptedModel(
  run: (request: ModelRequest, call: number) => AsyncGenerator<ModelEvent>,
): LanguageModel & { readonly requests: ModelRequest[] } {
  const requests: ModelRequest[] = [];
  return {
    provider: "test",
    modelId: "test-model",
    requests,
    stream(request) {
      requests.push(request);
      return run(request, requests.length);
    },
  };
}

async function collectEvents(events: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) {
    collected.push(event);
  }
  return collected;
}

async function* textResponse(text: string): AsyncGenerator<ModelEvent> {
  await Promise.resolve();
  yield { type: "text_delta", delta: text };
  yield {
    type: "completed",
    finishReason: "stop",
    usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
  };
}

async function* toolResponse(
  calls: readonly { id: string; name: string; arguments: string }[],
): AsyncGenerator<ModelEvent> {
  await Promise.resolve();
  for (const [index, call] of calls.entries()) {
    yield {
      type: "tool_call_delta",
      index,
      id: call.id,
      name: call.name,
      argumentsDelta: call.arguments,
    };
  }
  yield { type: "completed", finishReason: "tool_calls" };
}

describe("Agent Runtime", () => {
  it("注入 System Message，并输出 Step 事件和最终结果", async () => {
    const model = scriptedModel(() => textResponse("完成"));
    const agent = createAgent({
      model,
      systemMessage: { role: "system", content: "系统指令" },
      idGenerator: () => "step_1",
    });
    const context = createAgentRunContext({ runId: "run_1" });

    const run = agent.run({
      context,
      messages: [{ role: "user", content: "开始" }],
    });
    const eventsPromise = collectEvents(run.events);
    const result = await run.result;
    const events = await eventsPromise;

    expect(model.requests[0]?.messages).toEqual([
      { role: "system", content: "系统指令" },
      { role: "user", content: "开始" },
    ]);
    expect(result).toMatchObject({
      status: "completed",
      finalText: "完成",
      stepCount: 1,
      usage: { inputTokens: 2, outputTokens: 1, totalTokens: 3 },
    });
    expect(events.map(({ type }) => type)).toEqual([
      "run.started",
      "step.started",
      "model.text.delta",
      "model.completed",
      "step.completed",
      "run.completed",
    ]);
    expect(events.map(({ sequence }) => sequence)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("按模型返回顺序执行多个工具，并把结果交给下一次模型调用", async () => {
    const executionOrder: string[] = [];
    const tools: AgentTool[] = ["first", "second"].map((name) => ({
      id: `tool_${name}`,
      policy: "automatic",
      definition: { name, description: name, inputSchema: { type: "object" } },
      execute: vi.fn((input) => {
        executionOrder.push(name);
        return Promise.resolve({ input, name });
      }),
    }));
    const model = scriptedModel((_request, call) =>
      call === 1
        ? toolResponse([
            { id: "call_1", name: "first", arguments: "{\"value\":1}" },
            { id: "call_2", name: "second", arguments: "{\"value\":2}" },
          ])
        : textResponse("工具完成"),
    );
    let nextId = 0;
    const agent = createAgent({
      model,
      tools,
      idGenerator: () => `step_${++nextId}`,
    });
    const run = agent.run({
      context: createAgentRunContext({ runId: "run_tools" }),
      messages: [{ role: "user", content: "执行工具" }],
    });

    const result = await run.result;

    expect(result.status).toBe("completed");
    expect(result.stepCount).toBe(2);
    expect(executionOrder).toEqual(["first", "second"]);
    expect(model.requests[1]?.messages.slice(-2)).toEqual([
      expect.objectContaining({ role: "tool", toolCallId: "call_1" }),
      expect.objectContaining({ role: "tool", toolCallId: "call_2" }),
    ]);
  });

  it("把工具失败转换成 Tool Result，而不是终止 Run", async () => {
    const tool: AgentTool = {
      id: "tool_fail",
      policy: "automatic",
      definition: { name: "fail", description: "失败工具", inputSchema: {} },
      execute: () => Promise.reject(new Error("执行失败")),
    };
    const model = scriptedModel((_request, call) =>
      call === 1
        ? toolResponse([{ id: "call_fail", name: "fail", arguments: "{}" }])
        : textResponse("已处理失败"),
    );
    const agent = createAgent({ model, tools: [tool] });
    const run = agent.run({
      context: createAgentRunContext({ runId: "run_failure" }),
      messages: [{ role: "user", content: "执行" }],
    });

    const result = await run.result;
    const toolMessage = model.requests[1]?.messages.at(-1);

    expect(result.status).toBe("completed");
    expect(toolMessage).toMatchObject({ role: "tool", toolCallId: "call_fail" });
    expect(toolMessage?.content).toContain("tool_execution_failed");
  });

  it("在下一次模型调用前应用运行中插入的强制消息", async () => {
    let releaseTool: (() => void) | undefined;
    let markToolStarted: (() => void) | undefined;
    const toolStarted = new Promise<void>((resolve) => {
      markToolStarted = resolve;
    });
    const tool: AgentTool = {
      id: "tool_wait",
      policy: "automatic",
      definition: { name: "wait", description: "等待", inputSchema: {} },
      async execute() {
        markToolStarted?.();
        await new Promise<void>((resolve) => {
          releaseTool = resolve;
        });
        return "ok";
      },
    };
    const model = scriptedModel((_request, call) =>
      call === 1
        ? toolResponse([{ id: "call_wait", name: "wait", arguments: "{}" }])
        : textResponse("已收到补充"),
    );
    const context = createAgentRunContext({ runId: "run_steering" });
    const run = createAgent({ model, tools: [tool] }).run({
      context,
      messages: [{ role: "user", content: "开始" }],
    });
    const eventsPromise = collectEvents(run.events);

    await toolStarted;
    expect(context.enqueueMessage({ id: "message_2", content: "补充要求" })).toEqual({
      accepted: true,
      messageId: "message_2",
    });
    releaseTool?.();
    const result = await run.result;
    const events = await eventsPromise;

    expect(result.status).toBe("completed");
    expect(model.requests[1]?.messages).toContainEqual({
      role: "user",
      content: "补充要求",
    });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "message.applied",
        messageId: "message_2",
      }),
    );
    expect(context.enqueueMessage({ content: "过晚消息" })).toEqual({
      accepted: false,
      reason: "run_closed",
    });
  });

  it("达到最大模型调用次数时受控停止", async () => {
    const model = scriptedModel(() =>
      toolResponse([{ id: "call_repeat", name: "repeat", arguments: "{}" }]),
    );
    const tool: AgentTool = {
      id: "tool_repeat",
      policy: "automatic",
      definition: { name: "repeat", description: "重复", inputSchema: {} },
      execute: () => Promise.resolve("继续"),
    };
    const run = createAgent({ model, tools: [tool], maxSteps: 2 }).run({
      context: createAgentRunContext({ runId: "run_limit" }),
      messages: [{ role: "user", content: "循环" }],
    });

    await expect(run.result).resolves.toMatchObject({
      status: "stopped",
      stopReason: "max_steps_reached",
      stepCount: 2,
    });
    expect(model.requests).toHaveLength(2);
  });

  it("模型输出期间接受的强制消息会触发下一个 Step", async () => {
    let releaseFirstResponse: (() => void) | undefined;
    let markFirstResponseStarted: (() => void) | undefined;
    const firstResponseStarted = new Promise<void>((resolve) => {
      markFirstResponseStarted = resolve;
    });
    const model = scriptedModel((_request, call) => {
      if (call > 1) {
        return textResponse("更新后的答案");
      }
      return (async function* () {
        markFirstResponseStarted?.();
        await new Promise<void>((resolve) => {
          releaseFirstResponse = resolve;
        });
        yield { type: "text_delta", delta: "原答案" } as const;
        yield { type: "completed", finishReason: "stop" } as const;
      })();
    });
    const context = createAgentRunContext({ runId: "run_late_steering" });
    const run = createAgent({ model }).run({
      context,
      messages: [{ role: "user", content: "开始" }],
    });

    await firstResponseStarted;
    expect(context.enqueueMessage({ content: "修改要求" }).accepted).toBe(true);
    releaseFirstResponse?.();
    const result = await run.result;

    expect(result).toMatchObject({
      status: "completed",
      finalText: "更新后的答案",
      stepCount: 2,
    });
    expect(model.requests[1]?.messages).toContainEqual({
      role: "user",
      content: "修改要求",
    });
  });
});
