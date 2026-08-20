import type { Message, ServerEvent, Turn } from "@llm-harness/contracts";

import { MarkdownContent } from "./markdown-content.js";

export type ToolConfirmation = Extract<ServerEvent, { type: "tool.confirmation_requested" }>;

const statusLabels: Record<Turn["status"], string> = {
  awaiting_confirmation: "等待确认",
  cancelled: "已取消",
  completed: "已完成",
  failed: "失败",
  interrupted: "已中断",
  limit_reached: "达到循环上限",
  queued: "排队中",
  running: "运行中",
};

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

/** 按持久化的 Turn 边界展示消息，不从消息顺序猜测一次运行的范围。 */
export function ConversationHistory({ confirmations, liveText, loading, messages, onConfirmTool, onSelectTrace, selectedTraceTurnId, turns }: { confirmations: ToolConfirmation[]; liveText: Readonly<Record<string, string>>; loading: boolean; messages: Message[]; onConfirmTool: (confirmation: ToolConfirmation, accept: boolean) => void; onSelectTrace: (turnId: string) => void; selectedTraceTurnId: string | null; turns: Turn[] }) {
  if (loading) return <div className="conversation-state">正在读取消息历史…</div>;
  if (turns.length === 0) return <div className="conversation-state"><strong>开始一次新的对话</strong><span>选择模型并输入消息，发送后会创建第一个 Turn。</span></div>;

  return <div className="column real-history">{turns.map((turn, index) => {
    const turnMessages = messages.filter((message) => message.turnId === turn.id && message.role !== "tool");
    const pending = confirmations.filter((confirmation) => confirmation.turnId === turn.id);
    const streamingContent = liveText[turn.id];
    return <section className={`turn-block ${turn.status}`} key={turn.id}><header className="turn-header"><span>Turn {index + 1}</span><small>{statusLabels[turn.status]}</small><button className={selectedTraceTurnId === turn.id ? "active" : ""} onClick={() => onSelectTrace(turn.id)}>查看 Trace</button></header>{turnMessages.map((message) => <article key={message.id}><b className={`avatar ${message.role === "assistant" ? "bot" : ""}`}>{message.role === "assistant" ? "✦" : "你"}</b><div><header><strong>{message.role === "assistant" ? "Harness" : "你"}</strong><small>{formatTime(message.createdAt)}</small></header>{message.role === "assistant" ? <MarkdownContent content={message.content} /> : <p className="user-message-content">{message.content}</p>}</div></article>)}{streamingContent && <article className="streaming-message"><b className="avatar bot">✦</b><div><header><strong>Harness</strong><small className="running">● 生成中</small></header><MarkdownContent content={streamingContent} /><i className="cursor" /></div></article>}{pending.map((confirmation) => <article className="confirmation-message" key={confirmation.stepId}><b className="avatar bot">⌘</b><div><header><strong>工具确认</strong><small>{confirmation.toolId}</small></header><div className="inline-tool"><dl><div><dt>工具</dt><dd>{confirmation.toolId}</dd></div><div><dt>参数</dt><dd>{JSON.stringify(confirmation.arguments)}</dd></div></dl><footer><span>确认后工具结果会进入下一次模型调用</span><div><button onClick={() => onConfirmTool(confirmation, false)}>拒绝</button><button className="confirm" onClick={() => onConfirmTool(confirmation, true)}>确认执行</button></div></footer></div></div></article>)}</section>;
  })}</div>;
}
