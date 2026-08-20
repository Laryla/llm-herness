import type { FormEvent } from "react";
import { useState } from "react";
import { Folder, Plus } from "lucide-react";

import type { useWorkspaces } from "../model/use-workspaces.js";

type WorkspaceState = ReturnType<typeof useWorkspaces>;

/** 设置页中的工作空间管理视图，负责收集路径，数据写入统一交给工作空间模型。 */
export function WorkspaceSettings({ state }: { state: WorkspaceState }) {
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const created = await state.addWorkspace({ name, path });
    if (!created) return;
    setName(""); setPath(""); setFormOpen(false);
  }

  return <section className="settings-content workspace-settings">
    <div className="settings-heading"><span><strong>已注册工作空间</strong><small>工作空间决定对话归属与工具可访问的文件范围</small></span><button onClick={() => setFormOpen((open) => !open)}><Plus />添加工作空间</button></div>
    {formOpen && <form className="workspace-form" onSubmit={(event) => void submit(event)}><label><span>名称</span><input aria-label="工作空间名称" onChange={(event) => setName(event.target.value)} placeholder="例如：llm-harness" required value={name} /></label><label><span>文件夹绝对路径</span><input aria-label="工作空间路径" onChange={(event) => setPath(event.target.value)} placeholder="/Users/name/workspace/project" required value={path} /></label><small>当前 Web 版由 Server 校验本机路径；注册不会创建、移动或删除文件夹。</small><div><button type="button" onClick={() => setFormOpen(false)}>取消</button><button className="primary" disabled={state.saving} type="submit">{state.saving ? "正在添加…" : "确认添加"}</button></div></form>}
    {state.error && <div className="workspace-error"><span>{state.error}</span><button onClick={() => void state.reload()}>重试</button></div>}
    <div className="workspace-list">{state.loading && <p className="workspace-empty">正在读取工作空间…</p>}{!state.loading && state.workspaces.length === 0 && <p className="workspace-empty">尚未注册工作空间</p>}{state.workspaces.map((workspace) => { const current = workspace.id === state.currentWorkspaceId; return <article key={workspace.id}><b><Folder /></b><span><strong>{workspace.name}{current && <em>当前</em>}</strong><code title={workspace.path}>{workspace.path}</code><small className={workspace.status}>{workspace.status === "available" ? "● 路径可用" : "● 路径不可用"}</small></span><button disabled={current || workspace.status === "unavailable" || state.saving} onClick={() => void state.selectWorkspace(workspace.id)}>{current ? "使用中" : "设为当前"}</button></article>; })}</div>
  </section>;
}
