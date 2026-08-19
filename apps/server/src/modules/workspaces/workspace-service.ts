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

const SETTINGS_ID = "settings_default";
const DEFAULT_WORKSPACE_ID = "workspace_default";

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

export class WorkspaceService {
  constructor(private readonly client: PersistenceClient) {}

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
        return serializeWorkspace(current);
      }),
    );
  }

  async create(input: CreateWorkspaceRequest): Promise<Workspace> {
    const inspected = await inspectPath(input.path);
    try {
      const record = await this.client.workspace.create({
        data: { id: workspaceId(), name: input.name.trim(), ...inspected },
      });
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

  async remove(id: string): Promise<void> {
    await ensureSettings(this.client);
    await this.list();
    const existing = await this.client.workspace.findUnique({ where: { id } });
    if (!existing) {
      throw new WorkspaceServiceError("workspace_not_found", "Workspace 不存在");
    }

    await this.client.$transaction(async (transaction) => {
      const settings = await transaction.harnessSettings.findUniqueOrThrow({
        where: { id: SETTINGS_ID },
      });
      if (settings.currentWorkspaceId === id) {
        const replacement = await transaction.workspace.findFirst({
          where: { id: { not: id }, status: "available" },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        });
        await transaction.harnessSettings.update({
          where: { id: SETTINGS_ID },
          data: { currentWorkspaceId: replacement?.id ?? null },
        });
      }
      await transaction.workspace.delete({ where: { id } });
    });
  }

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
    return {
      workspaceId,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }
}
