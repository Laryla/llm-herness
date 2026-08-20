import type { FormEvent } from "react";
import { useState } from "react";
import { CheckCircle2, Clock3, LoaderCircle, Pencil, Plus, Server, XCircle } from "lucide-react";

import type { useModels } from "../model/use-models.js";

type ModelState = ReturnType<typeof useModels>;

/** 单层模型配置页：连接、模型名称、测试与选择都归属于同一条配置。 */
export function ModelSettings({ state }: { state: ModelState }) {
  const [formOpen, setFormOpen] = useState(state.profiles.length === 0);
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [modelName, setModelName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [secretValue, setSecretValue] = useState("");
  const [secretMode, setSecretMode] = useState<"local" | "environment">("local");
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ status: "succeeded" | "failed"; message: string } | null>(null);

  function closeForm() {
    setFormOpen(false); setEditingProfileId(null); setDisplayName(""); setModelName(""); setBaseUrl("https://api.openai.com/v1"); setSecretMode("local"); setSecretValue("");
  }
  function openEdit(profile: ModelState["profiles"][number]) {
    setEditingProfileId(profile.id); setDisplayName(profile.displayName); setModelName(profile.modelName); setBaseUrl(profile.baseUrl); setSecretMode(profile.secret.source === "environment" ? "environment" : "local"); setSecretValue(""); setFormOpen(true);
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = secretValue.length === 0 ? {} : secretMode === "local" ? { secretValue } : { secretEnvironmentVariable: secretValue };
    const saved = editingProfileId
      ? await state.updateProfile(editingProfileId, { displayName, modelName, baseUrl, ...secret })
      : await state.createProfile(secretMode === "local" ? { displayName, modelName, baseUrl, secretValue } : { displayName, modelName, baseUrl, secretEnvironmentVariable: secretValue });
    if (saved) closeForm();
  }
  async function testConnection(profileId: string) {
    setTestingProfileId(profileId); setNotice(null);
    try {
      const tested = await state.testConnection(profileId);
      if (tested?.connection.status === "succeeded") setNotice({ status: "succeeded", message: `已使用 ${tested.modelName} 完成测试` });
      else if (tested?.connection.status === "failed") setNotice({ status: "failed", message: tested.connection.error.message });
    } finally { setTestingProfileId(null); }
  }

  const selected = state.profiles.find(({ id }) => id === state.selectedProfileId);
  return <section className="settings-content model-settings">
    <div className="settings-heading"><span><strong>模型配置</strong><small>一条配置直接对应一个可调用模型</small></span><button onClick={() => { closeForm(); setFormOpen(true); }}><Plus />添加模型</button></div>
    {formOpen && <form className="workspace-form model-profile-form" onSubmit={(event) => void submit(event)}><header><strong>{editingProfileId ? "编辑模型配置" : "添加模型配置"}</strong><small>保存后即可测试并用于下一个 Turn</small></header><label><span>配置名称</span><input aria-label="模型配置名称" onChange={(event) => setDisplayName(event.target.value)} placeholder="GPT 5.6" required value={displayName} /></label><label><span>模型名称</span><input aria-label="供应商模型名称" onChange={(event) => setModelName(event.target.value)} placeholder="gpt-5.6" required value={modelName} /></label><label><span>Base URL</span><input aria-label="模型服务地址" onChange={(event) => setBaseUrl(event.target.value)} required type="url" value={baseUrl} /></label><label><span>密钥来源</span><select aria-label="密钥来源" onChange={(event) => { setSecretMode(event.target.value as "local" | "environment"); setSecretValue(""); }} value={secretMode}><option value="local">本地 config.json</option><option value="environment">环境变量</option></select></label><label><span>{secretMode === "local" ? "API Key" : "环境变量名称"}</span><input aria-label="模型服务密钥" autoComplete="new-password" onChange={(event) => setSecretValue(event.target.value)} placeholder={editingProfileId ? "留空以保留现有密钥" : "输入密钥"} required={!editingProfileId} type={secretMode === "local" ? "password" : "text"} value={secretValue} /></label><div><button type="button" onClick={closeForm}>取消</button><button className="primary" disabled={state.saving}>{editingProfileId ? "保存修改" : "保存模型"}</button></div></form>}
    {state.error && <div className="workspace-error"><span>{state.error}</span><button onClick={() => void state.reload()}>重试</button></div>}
    {notice && <div aria-live="assertive" className={`connection-toast ${notice.status}`} role="status"><strong>{notice.status === "succeeded" ? "连接测试成功" : "连接测试失败"}</strong><span>{notice.message}</span><button aria-label="关闭连接测试提示" onClick={() => setNotice(null)}>×</button></div>}
    <div className="model-layout"><div className="profile-list">{state.loading && <p>正在读取模型配置…</p>}{state.profiles.map((profile) => <button className={profile.id === state.selectedProfileId ? "active" : ""} key={profile.id} onClick={() => state.setSelectedProfileId(profile.id)}><Server /><span><strong>{profile.displayName}</strong><small>{profile.modelName}</small></span><i className={profile.connection.status}>{profile.connection.status === "succeeded" ? "已连接" : profile.connection.status === "failed" ? "失败" : "未测试"}</i></button>)}</div>
      {selected && <div className="model-catalog"><header><span><strong>{selected.displayName}</strong><small>{selected.modelName}</small></span><div><button aria-label="编辑模型配置" onClick={() => openEdit(selected)}><Pencil /></button><button disabled={state.saving || testingProfileId !== null} onClick={() => void testConnection(selected.id)}>{testingProfileId === selected.id ? <><LoaderCircle className="spin" />正在测试</> : "测试连接"}</button></div></header><ConnectionResult connection={selected.connection} /><div className="single-model-action"><span><small>下个 Turn 使用</small><strong>{selected.modelName}</strong></span><button disabled={state.saving || state.currentSelection?.profileId === selected.id} onClick={() => void state.selectModel({ profileId: selected.id, modelName: selected.modelName })}>{state.currentSelection?.profileId === selected.id ? "当前模型" : "设为当前"}</button></div></div>}
    </div>
  </section>;
}

function ConnectionResult({ connection }: { connection: ModelState["profiles"][number]["connection"] }) {
  if (connection.status === "untested") return <div className="connection-result untested"><Clock3 /><span><strong>尚未测试</strong><small>测试会发送一条最小 Chat Completions 请求。</small></span></div>;
  if (connection.status === "succeeded") return <div className="connection-result succeeded"><CheckCircle2 /><span><strong>连接成功 · {connection.latencyMs} ms</strong><small>测试于 {new Date(connection.testedAt).toLocaleString("zh-CN")}</small></span></div>;
  return <div className="connection-result failed"><XCircle /><span><strong>连接失败</strong><small>{connection.error.message}</small></span></div>;
}
