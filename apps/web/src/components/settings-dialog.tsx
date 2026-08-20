import * as Dialog from "@radix-ui/react-dialog";
import { Bot, Hammer, Settings, SquareStack, X } from "lucide-react";
import { useState } from "react";

import { WorkspaceSettings } from "../domains/workspaces/components/workspace-settings.js";
import type { useWorkspaces } from "../domains/workspaces/model/use-workspaces.js";
import { ModelSettings } from "../domains/models/components/model-settings.js";
import type { useModels } from "../domains/models/model/use-models.js";

type SettingsSection = "models" | "tools" | "workspaces";

/** 应用级设置外壳；各领域只提供自己的设置内容，不感知模态框导航。 */
export function SettingsDialog({ models, onClose, workspaces }: { models: ReturnType<typeof useModels>; onClose: () => void; workspaces: ReturnType<typeof useWorkspaces> }) {
  const [section, setSection] = useState<SettingsSection>("models");
  const title = section === "models" ? "模型服务" : section === "tools" ? "工具注册" : "工作空间";
  return <Dialog.Root onOpenChange={(open) => { if (!open) onClose(); }} open><Dialog.Portal><Dialog.Overlay className="settings-backdrop" /><Dialog.Content className="settings-modal"><aside><header><b>H</b><span><Dialog.Title id="settings-title">设置</Dialog.Title><Dialog.Description>Harness 配置</Dialog.Description></span></header><nav><button className={section === "models" ? "active" : ""} onClick={() => setSection("models")}><Bot />模型服务</button><button className={section === "tools" ? "active" : ""} onClick={() => setSection("tools")}><Hammer />工具注册 <b>2</b></button><button className={section === "workspaces" ? "active" : ""} onClick={() => setSection("workspaces")}><SquareStack />工作空间</button><button disabled><Settings />运行参数</button></nav><footer><small>Harness v0.1.0</small></footer></aside><main><header><div><strong>{title}</strong><small>{section === "models" ? "配置服务并选择下一个 Turn 使用的模型" : section === "tools" ? "管理 Server 启动时加载的工具" : "管理文件夹与当前工作空间"}</small></div><Dialog.Close aria-label="关闭设置"><X /></Dialog.Close></header>{section === "models" ? <ModelSettings state={models} /> : section === "tools" ? <ToolSettings /> : <WorkspaceSettings state={workspaces} />}</main></Dialog.Content></Dialog.Portal></Dialog.Root>;
}

function ToolSettings() {
  return <section className="settings-content"><div className="settings-heading"><span><strong>已注册工具</strong><small>这些工具可以在创建 Turn 时选择绑定</small></span><button>＋ 注册工具</button></div><div className="registered-tools"><article><b>ϟ</b><span><strong>计算器 <em>内置</em></strong><code>calculator</code><small>计算受限的算术表达式，不执行任意代码。</small></span><div><i>自动执行</i><button>•••</button></div></article><article><b>⌘</b><span><strong>写入文件 <em>内置</em></strong><code>write_text_file</code><small>在当前 Workspace 内创建或覆盖 UTF-8 文本文件。</small></span><div><i className="confirm-policy">需要确认</i><button>•••</button></div></article></div><div className="registry-note"><b>i</b><p><strong>V1 使用静态注册</strong><span>工具随 Server 启动加载。用户上传和动态插件将在后续版本提供。</span></p></div></section>;
}
