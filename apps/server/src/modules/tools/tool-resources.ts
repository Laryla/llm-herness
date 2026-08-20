import { createAgentResourceKey } from "@llm-harness/agent-runtime";

/** 当前 Turn 所属 Workspace 的真实绝对路径，仅由 Server 在创建 Context 时绑定。 */
export const workspacePathResourceKey =
  createAgentResourceKey<string>("workspacePath");
