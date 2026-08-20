import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type {
  CreateWorkspaceRequest,
  CurrentWorkspace,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceStatus,
} from "@llm-harness/contracts";

import type { PersistenceClient } from "../../infrastructure/database/database.js";

/**
 * Workspace 领域服务。
 *
 * 负责 Workspace 的持久化、路径规范化、可用性检测，以及 Harness Instance
 * 共享的 Current Workspace。这里不操作 Workspace 内的文件；删除 Workspace
 * 只删除注册记录，不删除用户磁盘上的目录。
 */
const SETTINGS_ID = "settings_default";
const DEFAULT_WORKSPACE_ID = "workspace_default";

/** 仅暴露 Workspace 模块需要的结构化日志能力，避免领域服务依赖具体日志库。 */
export interface WorkspaceLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

const silentLogger: WorkspaceLogger = {
  info: () => undefined,
  warn: () => undefined,
};

/** Workspace 业务错误，供 REST 层稳定映射为 4xx Error Envelope。 */
export class WorkspaceServiceError extends Error {
  constructor(
    readonly code: "invalid_path" | "workspace_not_found" | "path_conflict",
    message: string,
  ) {
    super(message);
  }
}

function workspaceId(): string {
  return `workspace_${randomUUID().replaceAll("-", "")}`;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "P2002"
  );
}

async function inspectPath(path: string): Promise<{
  path: string;
  status: WorkspaceStatus;
}> {
  if (!isAbsolute(path)) {
    throw new WorkspaceServiceError("invalid_path", "Workspace 路径必须是绝对路径");
  }

  const normalizedPath = resolve(path);
  try {
    const canonicalPath = await realpath(normalizedPath);
    const pathStat = await stat(canonicalPath);
    if (!pathStat.isDirectory()) {
      throw new WorkspaceServiceError(
        "invalid_path",
        "Workspace 路径必须指向文件夹",
      );
    }
    return { path: canonicalPath, status: "available" };
  } catch (error) {
    if (
      error instanceof WorkspaceServiceError ||
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
    return { path: normalizedPath, status: "unavailable" };
  }
}

/** 将 Prisma 记录转换为跨 Client 共享的 Workspace 契约。 */
function serializeWorkspace(record: {
  id: string;
  name: string;
  path: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}): Workspace {
  return {
    ...record,
    status: record.status as WorkspaceStatus,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function ensureSettings(client: PersistenceClient): Promise<void> {
  await client.harnessSettings.upsert({
    where: { id: SETTINGS_ID },
    create: {
      id: SETTINGS_ID,
      currentToolIds: [],
      maxIterations: 50,
    },
    update: {},
  });
}

/**
 * 启动时注册默认 Workspace，并在尚未选择 Workspace 时将其设为 Current Workspace。
 * 重复执行是幂等的，不会覆盖用户已经做出的 Current Workspace 选择。
 */
export async function initializeWorkspaces(
  client: PersistenceClient,
  defaultWorkspacePath: string,
): Promise<void> {
  const inspected = await inspectPath(defaultWorkspacePath);
  await client.$transaction(async (transaction) => {
    const existingWorkspace = await transaction.workspace.findUnique({
      where: { path: inspected.path },
    });
    const workspace = existingWorkspace
      ? await transaction.workspace.update({
          where: { id: existingWorkspace.id },
          data: { status: inspected.status },
        })
      : await transaction.workspace.create({
          data: {
            id: DEFAULT_WORKSPACE_ID,
            name: "默认工作空间",
            ...inspected,
          },
        });
    const settings = await transaction.harnessSettings.findUnique({
      where: { id: SETTINGS_ID },
    });
    if (!settings) {
      await transaction.harnessSettings.create({
        data: {
          id: SETTINGS_ID,
          currentWorkspaceId: workspace.id,
          currentToolIds: [],
          maxIterations: 50,
        },
      });
    } else if (!settings.currentWorkspaceId) {
      await transaction.harnessSettings.update({
        where: { id: SETTINGS_ID },
        data: { currentWorkspaceId: workspace.id },
      });
    }
  });
}

/** Workspace 用例入口；REST、未来 CLI 和其他 Client 应复用这里的规则。 */
export class WorkspaceService {
  constructor(
    private readonly client: PersistenceClient,
    private readonly logger: WorkspaceLogger = silentLogger,
  ) {}

  /**
   * 按注册时间列出 Workspace。
   * 每次读取都会重新检查磁盘路径，并持久化最新的 available/unavailable 状态。
   */
  async list(): Promise<Workspace[]> {
    const records = await this.client.workspace.findMany({
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });

    return Promise.all(
      records.map(async (record) => {
        const inspected = await inspectPath(record.path);
        const current =
          inspected.status === record.status && inspected.path === record.path
            ? record
            : await this.client.workspace.update({
                where: { id: record.id },
                data: inspected,
              });
        if (current !== record) {
          // 只在可用状态发生变化时记录，避免每次列表查询都产生重复日志。
          const context = {
            workspaceId: record.id,
            previousStatus: record.status,
            status: inspected.status,
          };
          if (inspected.status === "unavailable") {
            this.logger.warn(context, "Workspace 目录不可用");
          } else {
            this.logger.info(context, "Workspace 目录恢复可用");
          }
        }
        return serializeWorkspace(current);
      }),
    );
  }

  /**
   * 注册一个文件夹为 Workspace。
   * 路径必须是绝对路径；已存在目录会解析为真实路径，尚不存在的目录可以注册为 unavailable。
   */
  async create(input: CreateWorkspaceRequest): Promise<Workspace> {
    const inspected = await inspectPath(input.path);
    try {
      const record = await this.client.workspace.create({
        data: { id: workspaceId(), name: input.name.trim(), ...inspected },
      });
      // 注册属于用户主动修改 Harness 状态，需要留下可追踪的审计信息。
      this.logger.info(
        { workspaceId: record.id, status: record.status },
        "Workspace 注册完成",
      );
      return serializeWorkspace(record);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new WorkspaceServiceError(
          "path_conflict",
          "该文件夹已经注册为 Workspace",
        );
      }
      throw error;
    }
  }

  /** 修改 Workspace 名称或重新绑定路径，可用于修复已经移动的目录。 */
  async update(id: string, input: UpdateWorkspaceRequest): Promise<Workspace> {
    const existing = await this.client.workspace.findUnique({ where: { id } });
    if (!existing) {
      throw new WorkspaceServiceError("workspace_not_found", "Workspace 不存在");
    }
    const inspected = input.path ? await inspectPath(input.path) : undefined;
    try {
      const record = await this.client.workspace.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: input.name.trim() }),
          ...inspected,
        },
      });
      this.logger.info(
        {
          changedName: input.name !== undefined,
          changedPath: input.path !== undefined,
          status: record.status,
          workspaceId: record.id,
        },
        "Workspace 更新完成",
      );
      return serializeWorkspace(record);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new WorkspaceServiceError(
          "path_conflict",
          "该文件夹已经注册为 Workspace",
        );
      }
      throw error;
    }
  }

  /**
   * 删除 Workspace 注册记录，不删除磁盘目录。
   * 删除 Current Workspace 时，自动选择最早注册的其他可用 Workspace；没有则清空选择。
   */
  async remove(id: string): Promise<void> {
    await ensureSettings(this.client);
    await this.list();
    const existing = await this.client.workspace.findUnique({ where: { id } });
    if (!existing) {
      throw new WorkspaceServiceError("workspace_not_found", "Workspace 不存在");
    }

    let replacementWorkspaceId: string | null = null;
    await this.client.$transaction(async (transaction) => {
      const settings = await transaction.harnessSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
      if (settings.currentWorkspaceId === id) {
        const replacement = await transaction.workspace.findFirst({
          where: { id: { not: id }, status: "available" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        replacementWorkspaceId = replacement?.id ?? null;
        await transaction.harnessSettings.update({
          where: { id: SETTINGS_ID },
          data: { currentWorkspaceId: replacement?.id ?? null },
        });
      }
      await transaction.workspace.delete({ where: { id } });
    });
    // 记录后备选择，方便诊断为何 Current Workspace 发生变化。
    this.logger.info(
      { replacementWorkspaceId, workspaceId: id },
      "Workspace 注册记录已删除",
    );
  }

  /** 读取整个 Harness Instance 共享的 Current Workspace；尚未选择时返回 null。 */
  async getCurrent(): Promise<CurrentWorkspace | null> {
    await ensureSettings(this.client);
    const settings = await this.client.harnessSettings.findUniqueOrThrow({
      where: { id: SETTINGS_ID },
    });
    return settings.currentWorkspaceId
      ? {
          workspaceId: settings.currentWorkspaceId,
          updatedAt: settings.updatedAt.toISOString(),
        }
      : null;
  }

  /** 将一个可用 Workspace 设为 Current Workspace；不可用路径不能被选中。 */
  async setCurrent(workspaceId: string): Promise<CurrentWorkspace> {
    const workspace = await this.client.workspace.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      throw new WorkspaceServiceError("workspace_not_found", "Workspace 不存在");
    }
    const inspected = await inspectPath(workspace.path);
    if (inspected.status === "unavailable") {
      await this.client.workspace.update({
        where: { id: workspaceId },
        data: inspected,
      });
      throw new WorkspaceServiceError(
        "invalid_path",
        "不可用的 Workspace 不能设为 Current Workspace",
      );
    }
    if (inspected.path !== workspace.path || inspected.status !== workspace.status) {
      await this.client.workspace.update({
        where: { id: workspaceId },
        data: inspected,
      });
    }

    await ensureSettings(this.client);
    const settings = await this.client.harnessSettings.update({
      where: { id: SETTINGS_ID },
      data: { currentWorkspaceId: workspaceId },
    });
    this.logger.info({ workspaceId }, "Current Workspace 切换完成");
    return {
      workspaceId,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }
}
