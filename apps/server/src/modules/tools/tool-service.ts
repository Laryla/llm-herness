import type { CurrentToolSelection, ToolSelection } from "@llm-harness/contracts";

import type { PersistenceClient } from "../../infrastructure/database/database.js";
import { ToolRegistryError } from "./tool-registry.js";
import type { ToolRegistry } from "./tool-registry.js";

const SETTINGS_ID = "settings_default";

/** Tool Catalog 与跨 Client 当前勾选状态的应用服务。 */
export class ToolService {
  constructor(
    private readonly client: PersistenceClient,
    private readonly registry: ToolRegistry,
  ) {}

  list() {
    return this.registry.list();
  }

  async getCurrent(): Promise<CurrentToolSelection> {
    const settings = await this.ensureSettings();
    const toolIds = Array.isArray(settings.currentToolIds)
      ? settings.currentToolIds.filter((value): value is string => typeof value === "string")
      : [];
    return {
      selection: { toolIds },
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  async setCurrent(selection: ToolSelection): Promise<CurrentToolSelection> {
    // bind 同时完成不存在 ID 和重复模型函数名检查；这里不创建 Turn。
    this.registry.bind(selection.toolIds);
    await this.ensureSettings();
    const settings = await this.client.harnessSettings.update({
      where: { id: SETTINGS_ID },
      data: { currentToolIds: selection.toolIds },
    });
    return {
      selection,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private ensureSettings() {
    return this.client.harnessSettings.upsert({
      where: { id: SETTINGS_ID },
      create: { id: SETTINGS_ID, currentToolIds: [], maxIterations: 50 },
      update: {},
    });
  }
}

export { ToolRegistryError };
