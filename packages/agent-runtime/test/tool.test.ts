import {
  createAgent,
  createAgentRunContext,
  defineTool,
  type AgentEvent,
} from "@llm-harness/agent-runtime";
import type { AgentToolError } from "@llm-harness/agent-runtime";
import type { LanguageModel, ModelEvent } from "@llm-harness/model-runtime";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

async function* toolThenText(call: number): AsyncGenerator<ModelEvent> {
  await Promise.resolve();
  if (call === 1) {
    yield {
      type: "tool_call_delta",
      index: 0,
      id: "call_confirm",
      name: "write_value",
      argumentsDelta: '{"value":"ok"}',
    };
    yield { type: "completed", finishReason: "tool_calls" };
    return;
  }
  yield { type: "text_delta", delta: "完成" };
  yield { type: "completed", finishReason: "stop" };
}

describe("Tool 定义与确认", () => {
  it("defineTool 默认要求确认，并校验输入与输出", async () => {
    const tool = defineTool({
      id: "tool_echo",
      name: "echo",
      description: "回显",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute: ({ value }) => ({ value }),
    });
    const context = createAgentRunContext({ runId: "run_define" });

    expect(tool.policy).toBe("requires_confirmation");
    await expect(tool.execute({ value: "ok" }, context)).resolves.toEqual({ value: "ok" });
    await expect(tool.execute({ value: 1 }, context)).rejects.toMatchObject({
      code: "invalid_tool_arguments",
    } satisfies Partial<AgentToolError>);
  });

  it("要求确认的工具在确认前不会执行", async () => {
    let call = 0;
    const model: LanguageModel = {
      provider: "test",
      modelId: "test",
      stream: () => toolThenText(++call),
    };
    const execute = vi.fn(() => ({ value: "ok" }));
    const tool = defineTool({
      id: "tool_write_value",
      name: "write_value",
      description: "写值",
      inputSchema: z.object({ value: z.string() }),
      outputSchema: z.object({ value: z.string() }),
      execute,
    });
    const run = createAgent({ model, tools: [tool] }).run({
      context: createAgentRunContext({ runId: "run_confirm" }),
      messages: [{ role: "user", content: "开始" }],
    });
    const events: AgentEvent[] = [];
    const consume = (async () => {
      for await (const event of run.events) {
        events.push(event);
        if (event.type === "tool.confirmation.requested") {
          expect(execute).not.toHaveBeenCalled();
          expect(run.confirmTool(event.toolCall.id)).toBe(true);
        }
      }
    })();

    await expect(run.result).resolves.toMatchObject({ status: "completed" });
    await consume;
    expect(execute).toHaveBeenCalledOnce();
    expect(events.map(({ type }) => type)).toContain("tool.confirmation.resolved");
  });
});
