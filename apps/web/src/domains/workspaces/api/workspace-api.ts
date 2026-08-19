import {
  currentWorkspaceSchema,
  type CreateWorkspaceRequest,
  type CurrentWorkspace,
  type Workspace,
  workspaceSchema,
} from "@llm-harness/contracts";
import { z } from "zod";

import { requestApi } from "../../../shared/api/client.js";

const workspaceListSchema = z.array(workspaceSchema);
const nullableCurrentWorkspaceSchema = currentWorkspaceSchema.nullable();

/** 读取 Server 已注册的全部工作空间。 */
export function listWorkspaces(): Promise<Workspace[]> {
  return requestApi("/api/v1/workspaces", workspaceListSchema);
}

/** 读取 Web、CLI 等客户端共用的当前工作空间。 */
export function getCurrentWorkspace(): Promise<CurrentWorkspace | null> {
  return requestApi("/api/v1/current-workspace", nullableCurrentWorkspaceSchema);
}

/** 将一个本机绝对路径注册为工作空间；Server 不会创建或修改该目录。 */
export function createWorkspace(input: CreateWorkspaceRequest): Promise<Workspace> {
  return requestApi("/api/v1/workspaces", workspaceSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 切换全局当前工作空间，只影响之后的浏览和新建对话。 */
export function setCurrentWorkspace(workspaceId: string): Promise<CurrentWorkspace> {
  return requestApi("/api/v1/current-workspace", currentWorkspaceSchema, {
    method: "PUT",
    body: JSON.stringify({ workspaceId }),
  });
}
