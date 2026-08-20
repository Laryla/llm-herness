import type { Trace } from "@llm-harness/contracts";
import { useCallback, useEffect, useState } from "react";

import { getTurnTrace } from "../api/conversation-api.js";

/** Trace 独立加载，避免右侧检查器阻塞 Conversation 消息历史。 */
export function useTrace(conversationId: string | null, turnId: string | null) {
  const [trace, setTrace] = useState<Trace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!conversationId || !turnId) { setTrace(null); return; }
    setLoading(true); setError(null);
    try { setTrace(await getTurnTrace(conversationId, turnId)); }
    catch (requestError) { setError(requestError instanceof Error ? requestError.message : "Trace 请求失败"); }
    finally { setLoading(false); }
  }, [conversationId, turnId]);

  useEffect(() => { void reload(); }, [reload]);
  return { error, loading, reload, trace };
}
