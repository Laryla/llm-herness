import type { FormEvent } from "react";
import { useState } from "react";
import { CheckCircle2, Clock3, LoaderCircle, Pencil, Plus, RefreshCw, Server, XCircle } from "lucide-react";

import type { useModels } from "../model/use-models.js";

type ModelState = ReturnType<typeof useModels>;

/** Model Profile 配置页；密钥输入在提交成功后立即随组件状态清空。 */
export function ModelSettings({ state }: { state: ModelState }) {
  const [formOpen, setFormOpen] = useState(state.profiles.length === 0);
  const [displayName, setDisplayName] = useState("");
  const [baseUrl, setBaseUrl] = useState("https://api.openai.com/v1");
  const [secretValue, setSecretValue] = useState("");
  const [secretMode, setSecretMode] = useState<"local" | "environment">("local");
  const [manualModel, setManualModel] = useState("");
  const [testingProfileId, setTestingProfileId] = useState<string | null>(null);
  const [testModelName, setTestModelName] = useState("");
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const secret = secretValue.length === 0 ? {} : secretMode === "local" ? { secretValue } : { secretEnvironmentVariable: secretValue };
    const saved = editingProfileId
      ? await state.updateProfile(editingProfileId, { displayName, baseUrl, ...secret })
      : await state.createProfile(secretMode === "local" ? { displayName, baseUrl, secretValue } : { displayName, baseUrl, secretEnvironmentVariable: secretValue });
    if (!saved) return;
    closeForm();
  }

  async function submitModel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await state.addModel(manualModel)) setManualModel("");
  }

  async function testConnection(profileId: string) {
    setTestingProfileId(profileId);
    try { await state.testConnection(profileId, testModelName); }
    finally { setTestingProfileId(null); }
  }

  function closeForm() {
    setFormOpen(false); setEditingProfileId(null); setSecretValue(""); setDisplayName(""); setBaseUrl("https://api.openai.com/v1"); setSecretMode("local");
  }

  function openCreateForm() {
    closeForm(); setFormOpen(true);
  }

  function openEditForm(profile: ModelState["profiles"][number]) {
    setEditingProfileId(profile.id); setDisplayName(profile.displayName); setBaseUrl(profile.baseUrl); setSecretMode(profile.secret.source === "environment" ? "environment" : "local"); setSecretValue(""); setFormOpen(true);
  }

  const selectedProfile = state.profiles.find(({ id }) => id === state.selectedProfileId);
  return <section className="settings-content model-settings">
    <div className="settings-heading"><span><strong>模型服务</strong><small>兼容 OpenAI Chat Completions 协议的服务端点</small></span><button onClick={openCreateForm}><Plus />添加服务</button></div>
    {formOpen && <form className="workspace-form model-profile-form" onSubmit={(event) => void submitProfile(event)}><header><strong>{editingProfileId ? "编辑模型服务" : "添加模型服务"}</strong><small>{editingProfileId ? "留空密钥字段将保留现有密钥" : "保存后可测试连接并发现模型"}</small></header><label><span>显示名称</span><input aria-label="模型服务名称" onChange={(event) => setDisplayName(event.target.value)} placeholder="OpenAI" required value={displayName} /></label><label><span>Base URL</span><input aria-label="模型服务地址" onChange={(event) => setBaseUrl(event.target.value)} required type="url" value={baseUrl} /></label><label><span>密钥来源</span><select aria-label="密钥来源" onChange={(event) => { setSecretMode(event.target.value as "local" | "environment"); setSecretValue(""); }} value={secretMode}><option value="local">本地 config.json</option><option value="environment">环境变量</option></select></label><label><span>{secretMode === "local" ? "API Key" : "环境变量名称"}</span><input aria-label="模型服务密钥" autoComplete="new-password" onChange={(event) => setSecretValue(event.target.value)} pattern={secretMode === "environment" ? "[A-Z_][A-Z0-9_]{0,127}" : undefined} placeholder={editingProfileId ? "留空以保留现有密钥" : secretMode === "local" ? "明文保存到本地 config.json" : "例如 OPENAI_API_KEY"} required={!editingProfileId} type={secretMode === "local" ? "password" : "text"} value={secretValue} /></label><small>{secretMode === "local" ? "密钥明文保存在 Harness Home/config.json，仅依赖文件权限保护。" : "Server 只保存环境变量名称，真实值必须在启动 Server 前注入。"}</small><div><button type="button" onClick={closeForm}>取消</button><button className="primary" disabled={state.saving}>{editingProfileId ? "保存修改" : "保存服务"}</button></div></form>}
    {state.error && <div className="workspace-error"><span>{state.error}</span><button onClick={() => void state.reload()}>重试</button></div>}
    <div className="model-layout"><div className="profile-list">{state.loading && <p>正在读取模型服务…</p>}{state.profiles.map((profile) => <button className={profile.id === state.selectedProfileId ? "active" : ""} key={profile.id} onClick={() => state.setSelectedProfileId(profile.id)}><Server /><span><strong>{profile.displayName}</strong><small>{profile.baseUrl}</small></span><i className={profile.connection.status}>{profile.connection.status === "succeeded" ? "已连接" : profile.connection.status === "failed" ? "失败" : "未测试"}</i></button>)}</div>
      {selectedProfile && <div className="model-catalog"><header><span><strong>{selectedProfile.displayName}</strong><small>{selectedProfile.secret.maskedValue}</small></span><div><button aria-label="编辑模型服务" onClick={() => openEditForm(selectedProfile)}><Pencil /></button></div></header><div className="connection-test"><input aria-label="连接测试模型" onChange={(event) => setTestModelName(event.target.value)} placeholder="输入用于测试的模型名称" value={testModelName} /><button disabled={state.saving || testingProfileId !== null || testModelName.trim().length === 0} onClick={() => void testConnection(selectedProfile.id)}>{testingProfileId === selectedProfile.id ? <><LoaderCircle className="spin" />正在测试</> : "测试连接"}</button></div><ConnectionResult connection={selectedProfile.connection} /><div className="catalog-heading"><span>可用模型（可选发现）</span><button aria-label="刷新模型列表" disabled={state.saving} onClick={() => void state.refreshCatalog()}><RefreshCw /></button></div><div className="catalog-list">{state.catalog?.entries.map((entry) => { const current = state.currentSelection?.profileId === entry.profileId && state.currentSelection.modelName === entry.modelName; return <button className={current ? "active" : ""} key={entry.id} onClick={() => { setTestModelName(entry.modelName); void state.selectModel({ profileId: entry.profileId, modelName: entry.modelName }); }}><span><strong>{entry.modelName}</strong><small>{entry.source === "manual" ? "手动" : "发现"}</small></span><i>{current ? "当前模型" : "选择"}</i></button>; })}{state.catalog?.entries.length === 0 && <p>可以直接手动添加模型；不要求供应商提供模型列表接口。</p>}</div><form className="manual-model" onSubmit={(event) => void submitModel(event)}><input aria-label="手动模型名称" onChange={(event) => setManualModel(event.target.value)} placeholder="例如 gpt-4.1" required value={manualModel} /><button disabled={state.saving}>添加</button></form></div>}
    </div>
  </section>;
}

function ConnectionResult({ connection }: { connection: ModelState["profiles"][number]["connection"] }) {
  if (connection.status === "untested") return <div className="connection-result untested"><Clock3 /><span><strong>尚未测试</strong><small>测试会发送一条最小 Chat Completions 请求。</small></span></div>;
  if (connection.status === "succeeded") return <div className="connection-result succeeded"><CheckCircle2 /><span><strong>连接成功 · {connection.latencyMs} ms</strong><small>测试于 {new Date(connection.testedAt).toLocaleString("zh-CN")}</small></span></div>;
  return <div className="connection-result failed"><XCircle /><span><strong>连接失败</strong><small>{connection.error.message}</small></span></div>;
}
