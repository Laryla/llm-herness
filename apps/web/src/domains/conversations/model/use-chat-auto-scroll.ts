import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";

const BOTTOM_THRESHOLD_PX = 80;

/**
 * 仅在用户仍贴近底部时跟随新内容。
 * 用户向上查看历史后保持当前位置；切换 Conversation 时重新定位到底部。
 */
export function useChatAutoScroll(
  conversationId: string | null,
  contentVersion: unknown,
): RefObject<HTMLElement | null> {
  const containerRef = useRef<HTMLElement>(null);
  const shouldStickToBottomRef = useRef(true);
  const previousConversationIdRef = useRef<string | null>(conversationId);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const updateStickiness = () => {
      const distanceToBottom = container.scrollHeight - container.clientHeight - container.scrollTop;
      shouldStickToBottomRef.current = distanceToBottom <= BOTTOM_THRESHOLD_PX;
    };
    container.addEventListener("scroll", updateStickiness, { passive: true });
    return () => container.removeEventListener("scroll", updateStickiness);
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const conversationChanged = previousConversationIdRef.current !== conversationId;
    if (conversationChanged) {
      previousConversationIdRef.current = conversationId;
      shouldStickToBottomRef.current = true;
    }
    if (shouldStickToBottomRef.current) container.scrollTop = container.scrollHeight;
  }, [contentVersion, conversationId]);

  return containerRef;
}
