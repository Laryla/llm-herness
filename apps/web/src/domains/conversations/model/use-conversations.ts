import type { Conversation, Message, QueuedMessage, Turn } from "@llm-harness/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createConversation, listConversations, listMessages, listQueuedMessages, listTurns } from "../api/conversation-api.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Conversation 请求失败";
}

/** 维护 Current Workspace 下的 Conversation 选择及其消息、Turn 快照。 */
export function useConversations(workspaceId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Workspace 是 Conversation 的硬边界，切换时不能短暂展示上一个目录的历史。
    setSelectedId(null);
    setMessages([]);
    setTurns([]);
    setQueuedMessages([]);
  }, [workspaceId]);

  const reloadList = useCallback(async () => {
    if (!workspaceId) {
      setConversations([]); setSelectedId(null); return;
    }
    setLoadingList(true); setError(null);
    try {
      const items = await listConversations(workspaceId);
      setConversations(items);
      setSelectedId((current) => current && items.some(({ id }) => id === current) ? current : (items[0]?.id ?? null));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoadingList(false);
    }
  }, [workspaceId]);

  useEffect(() => { void reloadList(); }, [reloadList]);

  const reloadConversation = useCallback(async () => {
    if (!selectedId) {
      setMessages([]); setTurns([]); setQueuedMessages([]); return;
    }
    setLoadingConversation(true); setError(null);
    try {
      const [nextMessages, nextTurns, nextQueuedMessages] = await Promise.all([listMessages(selectedId), listTurns(selectedId), listQueuedMessages(selectedId)]);
      setMessages(nextMessages); setTurns(nextTurns); setQueuedMessages(nextQueuedMessages);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoadingConversation(false);
    }
  }, [selectedId]);

  useEffect(() => { void reloadConversation(); }, [reloadConversation]);

  const selectedConversation = useMemo(
    () => conversations.find(({ id }) => id === selectedId) ?? null,
    [conversations, selectedId],
  );

  /** 清空选择进入新对话态，真正的记录会在用户首次发送时创建。 */
  const beginNewConversation = useCallback(() => {
    setSelectedId(null); setMessages([]); setTurns([]); setQueuedMessages([]); setError(null);
  }, []);

  /** 首次发送时延迟创建 Conversation，避免用户打开空白页就产生无内容记录。 */
  const ensureConversation = useCallback(async (firstMessage: string) => {
    if (selectedConversation) return selectedConversation;
    if (!workspaceId) throw new Error("请先选择工作空间");
    const created = await createConversation({ workspaceId, firstMessage, instructions: "" });
    setConversations((items) => [created, ...items]);
    setSelectedId(created.id);
    return created;
  }, [selectedConversation, workspaceId]);

  const applyQueuedMessage = useCallback((message: QueuedMessage, deleted: boolean) => {
    setQueuedMessages((items) => (deleted
      ? items.filter(({ id }) => id !== message.id)
      : [...items.filter(({ id }) => id !== message.id), message].sort((left, right) => left.position - right.position)));
  }, []);

  return { applyQueuedMessage, beginNewConversation, conversations, ensureConversation, error, loadingConversation, loadingList, messages, queuedMessages, reloadConversation, reloadList, selectedConversation, selectedId, selectConversation: setSelectedId, turns };
}
