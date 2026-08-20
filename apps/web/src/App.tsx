/* eslint-disable no-irregular-whitespace -- 全角空格用于静态原型中的图标与中文标签间距。 */
import { useState } from "react";

import { SettingsDialog } from "./components/settings-dialog.js";
import { ConversationHistory } from "./domains/conversations/components/conversation-history.js";
import { useConversations } from "./domains/conversations/model/use-conversations.js";
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
  const workspaces = useWorkspaces();
  const conversations = useConversations(workspaces.currentWorkspaceId);
  const models = useModels();
  const runtime = useRuntime((event) => {
    if (event.type === "conversation.title_changed") void conversations.reloadList();
    if (event.type === "current_model_selection.changed") void models.reload();
    if ("conversationId" in event && event.conversationId === conversations.selectedId && (event.type === "turn.created" || event.type === "turn.status_changed")) void conversations.reloadConversation();
  });
  const { theme, toggleTheme } = useTheme();

  async function sendMessage() {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true); setSendError(null);
    try {
      const tools = await getCurrentToolSelection();
      if (!models.currentSelection) throw new Error("请先在设置中选择模型");
      const conversation = await conversations.ensureConversation(content);
      runtime.send({ type: "turn.create", conversationId: conversation.id, content, modelSelection: models.currentSelection, toolSelection: tools.selection, modelParameters: {} });
      setDraft("");
      await conversations.reloadList();
    } catch (error) {
      setSendError(error instanceof Error ? error.message : "消息发送失败");
    } finally {
      setSending(false);
    }
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
      <section className="messages">{conversations.error ? <div className="conversation-state error"><strong>无法读取对话</strong><span>{conversations.error}</span><button onClick={() => void conversations.reloadConversation()}>重试</button></div> : <ConversationHistory loading={conversations.loadingConversation} messages={conversations.messages} turns={conversations.turns} />}</section>
      <footer className="compose-area">{(sendError || runtime.error || models.error) && <div className="compose-error">{sendError ?? runtime.error ?? models.error}</div>}<form className="composer" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}><div className="composer-state"><span><i className={runtime.status} />Runtime {runtime.status === "open" ? "已连接" : "连接中"}</span></div><textarea aria-label="消息内容" disabled={!workspaces.currentWorkspaceId || sending} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} placeholder={workspaces.currentWorkspaceId ? "输入新消息…" : "请先选择工作空间"} value={draft} /><div className="composer-toolbar"><div><button className="round-action" aria-label="添加上下文" type="button">＋</button><div className="model-picker"><button className="input-model" onClick={() => setModelMenuOpen((open) => !open)} type="button"><b>AI</b><span><small>下个 Turn</small>{models.currentSelection?.modelName ?? "选择模型"}</span><i>⌄</i></button>{modelMenuOpen && <div className="model-menu">{models.profiles.flatMap((profile) => profile.id === models.selectedProfileId ? (models.catalog?.entries ?? []).map((entry) => <button className={models.currentSelection?.profileId === entry.profileId && models.currentSelection.modelName === entry.modelName ? "active" : ""} key={entry.id} onClick={() => { void models.selectModel({ profileId: entry.profileId, modelName: entry.modelName }); setModelMenuOpen(false); }} type="button"><span><strong>{entry.modelName}</strong><small>{profile.displayName}</small></span><i>✓</i></button>) : [])}<button className="configure-models" onClick={() => { setSettingsOpen(true); setModelMenuOpen(false); }} type="button">管理模型服务</button></div>}</div></div><div className="send-mode"><span><strong>{sending ? "正在发送" : "创建新 Turn"}</strong><small>Shift Enter 换行</small></span><button className="send" aria-label="发送消息" disabled={!draft.trim() || sending || runtime.status !== "open" || !models.currentSelection} type="submit">↑</button></div></div></form><small className="composer-disclaimer">Enter 发送 · Shift Enter 换行</small></footer>
    </main>
    <aside className="trace"><header><div><strong>Turn 2</strong><small>turn_01J5…A82F</small></div><button onClick={() => setTrace(false)}>×</button></header><section className="summary"><b>●　等待工具确认</b><small>已用时 6.7 秒</small><div><span><small>模型快照</small>gpt-4.1</span><span><small>绑定工具</small>2 个</span><span><small>循环上限</small>50</span></div></section><section className="turn-input"><small>用户输入</small><p>可以，帮我把 Tool Registry 的说明写到 docs/tool-registry.md。</p></section><section className="steps"><small>Step 轨迹</small><div className="current-step"><b className="pulse">●</b><span><strong>Step 1 · 模型调用</strong><i>运行中</i><p>模型返回 1 个 Tool Call</p><small>1,248 输入 · 126 输出 tokens</small><div className="trace-tool"><b>⌘</b><span><strong>write_text_file</strong><small>call_8f21 · 等待确认</small></span></div></span></div><div className="future-step"><b>2</b><span><strong>Step 2</strong><i>尚未开始</i><p>确认并执行工具后，结果会进入下一次模型调用。</p></span></div></section><footer><button>打开完整 JSON Trace　→</button></footer></aside>
    {settingsOpen && <SettingsDialog models={models} onClose={() => setSettingsOpen(false)} workspaces={workspaces} />}
  </div>;
}
