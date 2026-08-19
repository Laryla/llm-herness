import {
  conversationSchema,
  messageSchema,
  turnSchema,
  type Conversation,
  type CreateConversationRequest,
  type Message,
  type Turn,
} from "@llm-harness/contracts";
import { z } from "zod";

import { requestApi } from "../../../shared/api/client.js";

/** 按 Workspace 读取最近更新优先的 Conversation。 */
export function listConversations(workspaceId: string): Promise<Conversation[]> {
  const query = new URLSearchParams({ workspaceId });
  return requestApi(`/api/v1/conversations?${query.toString()}`, z.array(conversationSchema));
}

/** 创建 Conversation；首条消息只生成临时标题，消息本身由 Turn 接口保存。 */
export function createConversation(input: CreateConversationRequest): Promise<Conversation> {
  return requestApi("/api/v1/conversations", conversationSchema, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** 读取 Conversation 的线性消息历史。 */
export function listMessages(conversationId: string): Promise<Message[]> {
  return requestApi(`/api/v1/conversations/${encodeURIComponent(conversationId)}/messages`, z.array(messageSchema));
}

/** 读取 Conversation 的 Turn 边界与运行状态。 */
export function listTurns(conversationId: string): Promise<Turn[]> {
  return requestApi(`/api/v1/conversations/${encodeURIComponent(conversationId)}/turns`, z.array(turnSchema));
}
