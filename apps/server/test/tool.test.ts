import { mkdtemp, readFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAgentRunContext } from "@llm-harness/agent-runtime";
import { describe, expect, it } from "vitest";

import {
  calculatorTool,
  createBuiltinTools,
  writeTextFileTool,
} from "../src/modules/tools/builtin-tools.js";
import { ToolRegistry } from "../src/modules/tools/tool-registry.js";
import { workspacePathResourceKey } from "../src/modules/tools/tool-resources.js";
import { bindAgentResource } from "@llm-harness/agent-runtime";

describe("静态 Tool Registry", () => {
  it("按 Turn 选择生成工具定义快照", () => {
    const registry = new ToolRegistry(createBuiltinTools());
    const bound = registry.bind(["tool_calculator"]);

    expect(bound.tools).toEqual([calculatorTool]);
    expect(bound.snapshot.tools).toEqual([
      expect.objectContaining({
        id: "tool_calculator",
        modelName: "calculator",
        policy: "automatic",
      }),
    ]);
    expect(() => registry.bind(["tool_missing"])).toThrow("Tool 不存在");
  });

  it("计算器只计算受限算术表达式", async () => {
    const context = createAgentRunContext({ runId: "run_calculator" });
    await expect(
      calculatorTool.execute({ expression: "2 * (3 + 4)" }, context),
    ).resolves.toEqual({ value: 14 });
    await expect(
      calculatorTool.execute({ expression: "process.exit()" }, context),
    ).rejects.toMatchObject({ code: "invalid_expression" });
  });

  it("文件工具只能写入绑定的 Workspace", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "llm-harness-workspace-"));
    const outside = await mkdtemp(join(tmpdir(), "llm-harness-outside-"));
    await symlink(outside, join(workspace, "outside-link"));
    const context = createAgentRunContext({
      runId: "run_file",
      resources: [bindAgentResource(workspacePathResourceKey, workspace)],
    });

    await expect(
      writeTextFileTool.execute(
        { path: "docs/result.txt", content: "你好" },
        context,
      ),
    ).resolves.toMatchObject({ path: "docs/result.txt", bytes: 6 });
    await expect(readFile(join(workspace, "docs/result.txt"), "utf8")).resolves.toBe("你好");
    await expect(
      writeTextFileTool.execute(
        { path: "outside-link/escape.txt", content: "禁止" },
        context,
      ),
    ).rejects.toMatchObject({ code: "path_outside_workspace" });
  });
});
