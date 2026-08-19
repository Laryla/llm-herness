/* eslint-disable no-irregular-whitespace -- 全角空格用于静态原型中的图标与中文标签间距。 */
import { useState } from "react";

import { SettingsDialog } from "./components/settings-dialog.js";
import { ConversationHistory } from "./domains/conversations/components/conversation-history.js";
import { useConversations } from "./domains/conversations/model/use-conversations.js";
import { useWorkspaces } from "./domains/workspaces/model/use-workspaces.js";
import { useTheme } from "./shared/theme/use-theme.js";

export function App() {
  const [trace, setTrace] = useState(true);
  const [queueOpen, setQueueOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const workspaces = useWorkspaces();
  const conversations = useConversations(workspaces.currentWorkspaceId);
  const { theme, toggleTheme } = useTheme();
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
      <footer className="compose-area"><section className={`message-queue ${queueOpen ? "open" : ""}`}><header><button onClick={() => setQueueOpen(!queueOpen)}><i>⌃</i><strong>等待发送</strong><b>2</b></button><span>当前 Turn 结束后按顺序执行</span><button>全部清除</button></header>{queueOpen && <div className="queue-items"><article><b className="drag">⠿</b><span><small>下一条 · Turn 3</small><strong>再补充数据库中的工具快照结构。</strong></span><div><button>转为强制</button><button aria-label="删除第一条等待消息">×</button></div></article><article><b className="drag">⠿</b><span><small>随后 · Turn 4</small><strong>最后为这个模块补充一份使用文档。</strong></span><div><button>转为强制</button><button aria-label="删除第二条等待消息">×</button></div></article></div>}</section><div className="composer"><div className="composer-state"><span><i />Turn 运行中</span><button>■ 停止运行</button></div><textarea aria-label="消息内容" placeholder="输入新消息…" /><div className="composer-toolbar"><div><button className="round-action" aria-label="添加上下文">＋</button><button className="input-model"><b>AI</b><span><small>下个 Turn</small>gpt-4.1</span><i>⌄</i></button></div><div className="send-mode"><span><strong>加入等待队列</strong><small>也可发送为强制消息</small></span><button className="send" aria-label="加入等待队列">↑</button></div></div></div><small className="composer-disclaimer">Enter 加入队列 · ⌘ Enter 强制发送</small></footer>
    </main>
    <aside className="trace"><header><div><strong>Turn 2</strong><small>turn_01J5…A82F</small></div><button onClick={() => setTrace(false)}>×</button></header><section className="summary"><b>●　等待工具确认</b><small>已用时 6.7 秒</small><div><span><small>模型快照</small>gpt-4.1</span><span><small>绑定工具</small>2 个</span><span><small>循环上限</small>50</span></div></section><section className="turn-input"><small>用户输入</small><p>可以，帮我把 Tool Registry 的说明写到 docs/tool-registry.md。</p></section><section className="steps"><small>Step 轨迹</small><div className="current-step"><b className="pulse">●</b><span><strong>Step 1 · 模型调用</strong><i>运行中</i><p>模型返回 1 个 Tool Call</p><small>1,248 输入 · 126 输出 tokens</small><div className="trace-tool"><b>⌘</b><span><strong>write_text_file</strong><small>call_8f21 · 等待确认</small></span></div></span></div><div className="future-step"><b>2</b><span><strong>Step 2</strong><i>尚未开始</i><p>确认并执行工具后，结果会进入下一次模型调用。</p></span></div></section><footer><button>打开完整 JSON Trace　→</button></footer></aside>
    {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} workspaces={workspaces} />}
  </div>;
}
