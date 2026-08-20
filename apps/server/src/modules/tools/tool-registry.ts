import type { AgentTool } from "@llm-harness/agent-runtime";
import type { BoundTool, Tool, ToolBindingSnapshot } from "@llm-harness/contracts";
import { z } from "zod";

export interface RegisteredTool extends AgentTool {
  readonly outputSchema: z.ZodType;
}

export interface BoundTools {
  readonly tools: readonly AgentTool[];
  readonly snapshot: ToolBindingSnapshot;
}

export class ToolRegistryError extends Error {
  constructor(
    readonly code: "duplicate_tool" | "tool_not_found",
    message: string,
  ) {
    super(message);
    this.name = "ToolRegistryError";
  }
}

/**
 * 进程级静态 Tool Registry。
 * Registry 只负责发现和绑定工具；每个 Turn 仍必须显式提交 toolIds。
 */
export class ToolRegistry {
  private readonly toolsById = new Map<string, RegisteredTool>();
  private readonly toolsByModelName = new Map<string, RegisteredTool>();

  constructor(tools: readonly RegisteredTool[]) {
    for (const tool of tools) {
      if (
        this.toolsById.has(tool.id) ||
        this.toolsByModelName.has(tool.definition.name)
      ) {
        throw new ToolRegistryError(
          "duplicate_tool",
          `Tool ID 或模型函数名重复：${tool.id}`,
        );
      }
      this.toolsById.set(tool.id, tool);
      this.toolsByModelName.set(tool.definition.name, tool);
    }
  }

  /** 返回可供 Web/CLI 展示的稳定工具契约，不暴露 execute 函数。 */
  list(): Tool[] {
    return [...this.toolsById.values()].map((tool) => this.serialize(tool));
  }

  /**
   * 将本次 Turn 选择解析为不可变快照和可执行工具。
   * 后续 Registry 变化不会改变已经创建的 Turn 记录。
   */
  bind(toolIds: readonly string[]): BoundTools {
    const selected = toolIds.map((toolId) => {
      const tool = this.toolsById.get(toolId);
      if (!tool) {
        throw new ToolRegistryError("tool_not_found", `Tool 不存在：${toolId}`);
      }
      return tool;
    });
    const snapshotTools: BoundTool[] = selected.map((tool) => this.serialize(tool));
    return {
      tools: Object.freeze([...selected]),
      snapshot: { tools: snapshotTools },
    };
  }

  private serialize(tool: RegisteredTool): Tool {
    return {
      id: tool.id,
      modelName: tool.definition.name,
      description: tool.definition.description,
      policy: tool.policy,
      inputSchema: tool.definition.inputSchema,
      outputSchema: z.toJSONSchema(tool.outputSchema),
    };
  }
}
