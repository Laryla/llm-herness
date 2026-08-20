import { API_VERSION, serverEventSchema, type ClientCommand, type ServerEvent } from "@llm-harness/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

type WithoutEnvelope<T> = T extends ClientCommand ? Omit<T, "apiVersion" | "commandId"> : never;
type RuntimeCommand = WithoutEnvelope<ClientCommand>;
type RuntimeStatus = "connecting" | "open" | "closed" | "error";

function runtimeUrl(): string {
  const url = new URL("/api/v1/runtime", window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
}

function commandId(): string {
  return `command_${crypto.randomUUID().replaceAll("-", "")}`;
}

/** 维持单个 Runtime WebSocket，并通过 sequence 订阅可恢复的 Server Event。 */
export function useRuntime(onEvent: (event: ServerEvent) => void) {
  const socketRef = useRef<WebSocket | null>(null);
  const onEventRef = useRef(onEvent);
  const lastSequenceRef = useRef(0);
  const [status, setStatus] = useState<RuntimeStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  onEventRef.current = onEvent;

  useEffect(() => {
    const socket = new WebSocket(runtimeUrl());
    socketRef.current = socket;
    setStatus("connecting");
    socket.addEventListener("open", () => {
      setStatus("open");
      socket.send(JSON.stringify({ apiVersion: API_VERSION, commandId: commandId(), type: "runtime.subscribe", afterSequence: lastSequenceRef.current }));
    });
    socket.addEventListener("message", (message) => {
      let payload: unknown;
      try { payload = JSON.parse(String(message.data)) as unknown; } catch { setError("Runtime 返回了无效 JSON"); return; }
      const parsed = serverEventSchema.safeParse(payload);
      if (!parsed.success) {
        const runtimeError = typeof payload === "object" && payload !== null && "error" in payload ? payload.error : null;
        setError(typeof runtimeError === "object" && runtimeError !== null && "message" in runtimeError && typeof runtimeError.message === "string" ? runtimeError.message : "Runtime 事件不符合契约");
        return;
      }
      lastSequenceRef.current = Math.max(lastSequenceRef.current, parsed.data.sequence);
      onEventRef.current(parsed.data);
    });
    socket.addEventListener("error", () => { setStatus("error"); setError("无法连接 Harness Runtime"); });
    socket.addEventListener("close", () => setStatus("closed"));
    return () => { socketRef.current = null; socket.close(); };
  }, []);

  const send = useCallback((command: RuntimeCommand) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error("Runtime 尚未连接，请稍后重试");
    socket.send(JSON.stringify({ ...command, apiVersion: API_VERSION, commandId: commandId() }));
  }, []);

  return { error, send, status };
}
