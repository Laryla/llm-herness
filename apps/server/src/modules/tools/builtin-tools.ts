import { mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { AgentToolError, defineTool } from "@llm-harness/agent-runtime";
import { z } from "zod";

import { workspacePathResourceKey } from "./tool-resources.js";

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

/** 只允许 Workspace 内的相对路径，并阻止通过已有符号链接逃逸目录。 */
async function resolveWorkspaceFile(root: string, inputPath: string): Promise<string> {
  if (isAbsolute(inputPath)) {
    throw new AgentToolError("invalid_path", "文件路径必须是 Workspace 内的相对路径");
  }
  const canonicalRoot = await realpath(root);
  const target = resolve(canonicalRoot, inputPath);
  if (!isInside(canonicalRoot, target)) {
    throw new AgentToolError("path_outside_workspace", "文件路径不能超出 Workspace");
  }

  // 找到最近的已存在父目录并解析真实路径，避免符号链接指向 Workspace 外部。
  let ancestor = dirname(target);
  while (true) {
    try {
      const canonicalAncestor = await realpath(ancestor);
      if (!isInside(canonicalRoot, canonicalAncestor)) {
        throw new AgentToolError("path_outside_workspace", "文件路径不能经过外部符号链接");
      }
      break;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new AgentToolError("invalid_workspace", "无法解析 Workspace 目录");
      }
      ancestor = parent;
    }
  }
  return target;
}

export const writeTextFileTool = defineTool({
  id: "tool_write_text_file",
  name: "write_text_file",
  description: "在当前 Workspace 内创建或覆盖 UTF-8 文本文件。",
  policy: "requires_confirmation",
  inputSchema: z.object({
    path: z.string().min(1).describe("相对于 Workspace 的文件路径"),
    content: z.string().describe("要写入的完整文本内容"),
  }),
  outputSchema: z.object({ path: z.string(), bytes: z.number().int().nonnegative() }),
  async execute(input, context) {
    const workspacePath = context.getResource(workspacePathResourceKey);
    if (!workspacePath) {
      throw new AgentToolError("workspace_not_bound", "当前 Run 未绑定 Workspace");
    }
    const target = await resolveWorkspaceFile(workspacePath, input.path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, input.content, "utf8");
    return { path: input.path, bytes: Buffer.byteLength(input.content, "utf8") };
  },
});

export const calculatorTool = defineTool({
  id: "tool_calculator",
  name: "calculator",
  description: "计算只包含数字、括号和 + - * / 运算符的算术表达式。",
  policy: "automatic",
  inputSchema: z.object({ expression: z.string().min(1).max(1_000) }),
  outputSchema: z.object({ value: z.number().finite() }),
  execute({ expression }) {
    return { value: evaluateExpression(expression) };
  },
});

/** 小型递归下降解析器；不使用 eval，避免表达式执行任意代码。 */
function evaluateExpression(source: string): number {
  let index = 0;
  const skip = () => {
    while (/\s/.test(source[index] ?? "")) index += 1;
  };
  const parseNumber = (): number => {
    skip();
    const match = source.slice(index).match(/^(?:\d+(?:\.\d*)?|\.\d+)/);
    if (!match) throw new AgentToolError("invalid_expression", "算术表达式无效");
    index += match[0].length;
    return Number(match[0]);
  };
  const parseFactor = (): number => {
    skip();
    if (source[index] === "+" || source[index] === "-") {
      const sign = source[index++];
      const value = parseFactor();
      return sign === "-" ? -value : value;
    }
    if (source[index] !== "(") return parseNumber();
    index += 1;
    const value = parseExpression();
    skip();
    if (source[index++] !== ")") {
      throw new AgentToolError("invalid_expression", "算术表达式缺少右括号");
    }
    return value;
  };
  const parseTerm = (): number => {
    let value = parseFactor();
    while (true) {
      skip();
      const operator = source[index];
      if (operator !== "*" && operator !== "/") return value;
      index += 1;
      const right = parseFactor();
      value = operator === "*" ? value * right : value / right;
    }
  };
  function parseExpression(): number {
    let value = parseTerm();
    while (true) {
      skip();
      const operator = source[index];
      if (operator !== "+" && operator !== "-") return value;
      index += 1;
      const right = parseTerm();
      value = operator === "+" ? value + right : value - right;
    }
  }
  const value = parseExpression();
  skip();
  if (index !== source.length || !Number.isFinite(value)) {
    throw new AgentToolError("invalid_expression", "算术表达式无效或结果不是有限数");
  }
  return value;
}

export function createBuiltinTools() {
  return [calculatorTool, writeTextFileTool] as const;
}
