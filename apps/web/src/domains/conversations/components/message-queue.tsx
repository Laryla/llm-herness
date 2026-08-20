import type { QueuedMessage } from "@llm-harness/contracts";
import { useState } from "react";

export function MessageQueue({ messages, onDelete, onReorder, onSteer, onUpdate }: {
  messages: QueuedMessage[];
  onDelete: (id: string) => void;
  onReorder: (ids: string[]) => void;
  onSteer: (message: QueuedMessage) => void;
  onUpdate: (id: string, content: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingContent, setEditingContent] = useState("");
  if (messages.length === 0) return null;
  const move = (index: number, offset: number) => {
    const target = index + offset;
    if (target < 0 || target >= messages.length) return;
    const next = [...messages];
    [next[index], next[target]] = [next[target]!, next[index]!];
    onReorder(next.map(({ id }) => id));
  };
  return <section className={`message-queue ${open ? "open" : ""}`}><header><button onClick={() => setOpen((value) => !value)} type="button"><i>⌃</i><b>{messages.length}</b> 待发送消息</button><span>当前 Turn 完成后顺序执行</span></header>{open && <div className="queue-items">{messages.map((message, index) => <article key={message.id}><b className="drag">⋮⋮</b><span>{editingId === message.id ? <input aria-label="编辑排队消息" autoFocus onChange={(event) => setEditingContent(event.target.value)} value={editingContent} /> : <strong>{message.content}</strong>}<small>{message.status === "paused" ? "已暂停" : message.status === "processing" ? "正在创建 Turn" : `队列位置 ${index + 1}`}</small></span><div>{editingId === message.id ? <><button onClick={() => { const content = editingContent.trim(); if (content) onUpdate(message.id, content); setEditingId(null); }} type="button">保存</button><button onClick={() => setEditingId(null)} type="button">取消</button></> : <><button disabled={message.status !== "queued"} onClick={() => onSteer(message)} type="button">立即介入</button><button aria-label="上移" disabled={index === 0 || message.status !== "queued"} onClick={() => move(index, -1)} type="button">↑</button><button aria-label="下移" disabled={index === messages.length - 1 || message.status !== "queued"} onClick={() => move(index, 1)} type="button">↓</button><button onClick={() => { setEditingId(message.id); setEditingContent(message.content); }} type="button">编辑</button><button onClick={() => onDelete(message.id)} type="button">×</button></>}</div></article>)}</div>}</section>;
}
