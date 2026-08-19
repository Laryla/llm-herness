import type { Conversation, Message, Turn } from "@llm-harness/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { listConversations, listMessages, listTurns } from "../api/conversation-api.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Conversation 请求失败";
}

/** 维护 Current Workspace 下的 Conversation 选择及其消息、Turn 快照。 */
export function useConversations(workspaceId: string | null) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Workspace 是 Conversation 的硬边界，切换时不能短暂展示上一个目录的历史。
    setSelectedId(null);
    setMessages([]);
    setTurns([]);
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
      setMessages([]); setTurns([]); return;
    }
    setLoadingConversation(true); setError(null);
    try {
      const [nextMessages, nextTurns] = await Promise.all([listMessages(selectedId), listTurns(selectedId)]);
      setMessages(nextMessages); setTurns(nextTurns);
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
    setSelectedId(null); setMessages([]); setTurns([]); setError(null);
  }, []);

  return { beginNewConversation, conversations, error, loadingConversation, loadingList, messages, reloadConversation, reloadList, selectedConversation, selectedId, selectConversation: setSelectedId, turns };
}
