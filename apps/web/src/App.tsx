/* eslint-disable no-irregular-whitespace -- 全角空格用于静态原型中的图标与中文标签间距。 */
import { useEffect, useMemo, useRef, useState } from "react";

import { SettingsDialog } from "./components/settings-dialog.js";
import { ConversationHistory } from "./domains/conversations/components/conversation-history.js";
import type { ToolConfirmation } from "./domains/conversations/components/conversation-history.js";
import { TracePanel } from "./domains/conversations/components/trace-panel.js";
import { useConversations } from "./domains/conversations/model/use-conversations.js";
import { useTrace } from "./domains/conversations/model/use-trace.js";
import { useModels } from "./domains/models/model/use-models.js";
import { getCurrentToolSelection } from "./domains/runtime/api/runtime-settings-api.js";
import { useRuntime } from "./domains/runtime/model/use-runtime.js";
import { useWorkspaces } from "./domains/workspaces/model/use-workspaces.js";
import { useTheme } from "./shared/theme/use-theme.js";

export function App() {
  const [trace, setTrace] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [selectedTraceTurnId, setSelectedTraceTurnId] = useState<string | null>(null);
  const [liveText, setLiveText] = useState<Record<string, string>>({});
  const [confirmations, setConfirmations] = useState<ToolConfirmation[]>([]);
  const activeConversationIdRef = useRef<string | null>(null);
  const workspaces = useWorkspaces();
  const conversations = useConversations(workspaces.currentWorkspaceId);
  const models = useModels();
  const turnTrace = useTrace(conversations.selectedId, selectedTraceTurnId);
  const runtime = useRuntime((event) => {
    if (event.type === "conversation.title_changed") void conversations.reloadList();
    if (event.type === "current_model_selection.changed") void models.reload();
    if (!("conversationId" in event) || event.conversationId !== activeConversationIdRef.current) return;
    if (event.type === "turn.created") { setSelectedTraceTurnId(event.turn.id); void conversations.reloadConversation(); }
    if (event.type === "step.content_delta") setLiveText((value) => ({ ...value, [event.turnId]: `${value[event.turnId] ?? ""}${event.delta}` }));
    if (event.type === "tool.confirmation_requested") setConfirmations((items) => [...items.filter(({ stepId }) => stepId !== event.stepId), event]);
    if (event.type === "step.status_changed" && event.status !== "awaiting_confirmation") setConfirmations((items) => items.filter(({ stepId }) => stepId !== event.stepId));
    if (event.type === "turn.status_changed") {
      void conversations.reloadConversation();
      if (["completed", "failed", "cancelled", "interrupted", "limit_reached"].includes(event.status)) {
        setLiveText((value) => { const next = { ...value }; delete next[event.turnId]; return next; });
        setConfirmations((items) => items.filter(({ turnId }) => turnId !== event.turnId));
      }
    }
    if ("turnId" in event && event.turnId === selectedTraceTurnId && event.type !== "step.content_delta") void turnTrace.reload();
  });
  const { theme, toggleTheme } = useTheme();
  const activeTurn = useMemo(() => [...conversations.turns].reverse().find(({ status }) => ["queued", "running", "awaiting_confirmation"].includes(status)) ?? null, [conversations.turns]);

  useEffect(() => {
    const latest = conversations.turns.at(-1)?.id ?? null;
    if (!selectedTraceTurnId || !conversations.turns.some(({ id }) => id === selectedTraceTurnId)) setSelectedTraceTurnId(latest);
  }, [conversations.turns, selectedTraceTurnId]);

  useEffect(() => { activeConversationIdRef.current = conversations.selectedId; }, [conversations.selectedId]);

  async function sendMessage() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true); setSendError(null);
    try {
      const tools = await getCurrentToolSelection();
      if (!models.currentSelection) throw new Error("请先在设置中选择模型");
      const conversation = await conversations.ensureConversation(content);
      activeConversationIdRef.current = conversation.id;
      runtime.send({ type: "turn.create", conversationId: conversation.id, content, modelSelection: models.currentSelection, toolSelection: tools.selection, modelParameters: {} });
      setDraft("");
      await conversations.reloadList();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "消息发送失败");
    } finally {
      setSending(false);
    }
  }

  function confirmTool(confirmation: ToolConfirmation, accept: boolean) {
    runtime.send({ type: accept ? "tool.confirm" : "tool.reject", conversationId: confirmation.conversationId, turnId: confirmation.turnId, stepId: confirmation.stepId, toolCallId: confirmation.toolCallId });
  }

  function cancelTurn() {
    if (activeTurn && conversations.selectedId) runtime.send({ type: "turn.cancel", conversationId: conversations.selectedId, turnId: activeTurn.id });
  }
  return <div className={`shell ${trace ? "show-trace" : ""} ${theme === "light" ? "light-theme" : ""}`}>
    <aside className="sidebar">
      <header><b className="logo">H</b><h1 aria-label="LLM Harness">Harness</h1><button>•••</button></header>
      <button aria-label="新建对话" className="new" disabled={!workspaces.currentWorkspaceId} onClick={conversations.beginNewConversation}>＋ 新建对话</button>
      <label className="search">⌕ <input aria-label="搜索对话" placeholder="搜索对话" /></label>
      <nav className="workspace-groups">{workspaces.loading && <small>正在读取工作空间…</small>}{!workspaces.loading && workspaces.workspaces.map((workspace) => { const current = workspace.id === workspaces.currentWorkspaceId; const items = current ? conversations.conversations : []; return <section className={`workspace-group ${current ? "current" : ""}`} key={workspace.id}><header><button className="workspace-name" onClick={() => workspace.status === "available" && void workspaces.selectWorkspace(workspace.id)}><i>⌄</i><b>▰</b><span>{workspace.name}</span>{current && <em>当前</em>}<small>{current ? items.length : 0}</small></button><button aria-label={`在 ${workspace.name} 新建对话`} className="workspace-add" onClick={() => { if (!current) void workspaces.selectWorkspace(workspace.id); conversations.beginNewConversation(); }}>＋</button></header>{current && <div className="workspace-conversations">{conversations.loadingList && <p>正在读取对话…</p>}{!conversations.loadingList && items.map((conversation) => <button className={conversation.id === conversations.selectedId ? "active" : ""} key={conversation.id} onClick={() => conversations.selectConversation(conversation.id)}><span>{conversation.title}</span><i>{conversation.titleSource === "temporary" ? "临时" : ""}</i></button>)}{!conversations.loadingList && items.length === 0 && <p>暂无对话</p>}</div>}</section>; })}</nav>
      <footer><button className="manage-workspaces" onClick={() => setSettingsOpen(true)}>▰　管理工作空间</button><button className="theme-toggle" onClick={toggleTheme}><span>{theme === "dark" ? "☼" : "☾"}　{theme === "dark" ? "浅色主题" : "深色主题"}</span><i>{theme === "dark" ? "Light" : "Dark"}</i></button><button className="open-settings" onClick={() => setSettingsOpen(true)}>⚙　设置</button></footer>
    </aside>
    <main>
      <header className="top"><div><strong>{conversations.selectedConversation?.title ?? "新对话"}</strong><small>{conversations.selectedConversation ? "● 已保存" : workspaces.currentWorkspace ? `保存到 ${workspaces.currentWorkspace.name}` : "请先选择工作空间"}</small></div><div><button className="trace-btn" onClick={() => setTrace(!trace)}>ϟ　运行详情</button></div></header>
      <section className="messages">{conversations.error ? <div className="conversation-state error"><strong>无法读取对话</strong><span>{conversations.error}</span><button onClick={() => void conversations.reloadConversation()}>重试</button></div> : <ConversationHistory confirmations={confirmations} liveText={liveText} loading={conversations.loadingConversation} messages={conversations.messages} onConfirmTool={confirmTool} onSelectTrace={(turnId) => { setSelectedTraceTurnId(turnId); setTrace(true); }} selectedTraceTurnId={selectedTraceTurnId} turns={conversations.turns} />}</section>
      <footer className="compose-area">{(sendError || runtime.error || models.error) && <div className="compose-error">{sendError ?? runtime.error ?? models.error}</div>}<form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}><div className="composer-state"><span><i className={activeTurn ? "running" : runtime.status} />{activeTurn ? `Turn ${activeTurn.status}` : `Runtime ${runtime.status === "open" ? "已连接" : "连接中"}`}</span>{activeTurn && <button onClick={cancelTurn} type="button">■ 停止运行</button>}</div><textarea aria-label="消息内容" disabled={!workspaces.currentWorkspaceId || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={workspaces.currentWorkspaceId ? "输入新消息…" : "请先选择工作空间"} value={draft} /><div className="composer-toolbar"><div><button className="round-action" aria-label="添加上下文" type="button">＋</button><div className="model-picker"><button className="input-model" onClick={() => setModelMenuOpen((open) => !open)} type="button"><b>AI</b><span><small>下个 Turn</small>{models.currentSelection?.modelName ?? "选择模型"}</span><i>⌄</i></button>{modelMenuOpen && <div className="model-menu">{models.profiles.flatMap((profile) => profile.id === models.selectedProfileId ? (models.catalog?.entries ?? []).map((entry) => <button className={models.currentSelection?.profileId === entry.profileId && models.currentSelection.modelName === entry.modelName ? "active" : ""} key={entry.id} onClick={() => { void models.selectModel({ profileId: entry.profileId, modelName: entry.modelName }); setModelMenuOpen(false); }} type="button"><span><strong>{entry.modelName}</strong><small>{profile.displayName}</small></span><i>✓</i></button>) : [])}<button className="configure-models" onClick={() => { setSettingsOpen(true); setModelMenuOpen(false); }} type="button">管理模型服务</button></div>}</div></div><div className="send-mode"><span><strong>{activeTurn ? "Turn 运行中" : sending ? "正在发送" : "创建新 Turn"}</strong><small>{activeTurn ? "可停止后继续发送" : "Shift Enter 换行"}</small></span><button className="send" aria-label="发送消息" disabled={!draft.trim() || sending || Boolean(activeTurn) || runtime.status !== "open" || !models.currentSelection} type="submit">↑</button></div></div></form><small className="composer-disclaimer">Enter 发送 · Shift Enter 换行</small></footer>
    </main>
    <TracePanel error={turnTrace.error} loading={turnTrace.loading} onClose={() => setTrace(false)} trace={turnTrace.trace} />
    {settingsOpen && <SettingsDialog models={models} onClose={() => setSettingsOpen(false)} workspaces={workspaces} />}
  </div>;
}
