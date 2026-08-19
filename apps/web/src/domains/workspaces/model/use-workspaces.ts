import type { CreateWorkspaceRequest, Workspace } from "@llm-harness/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createWorkspace, getCurrentWorkspace, listWorkspaces, setCurrentWorkspace } from "../api/workspace-api.js";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "工作空间请求失败";
}

/** 集中管理工作空间列表与 Current Workspace，避免侧边栏和设置页各自维护副本。 */
export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [items, current] = await Promise.all([listWorkspaces(), getCurrentWorkspace()]);
      setWorkspaces(items);
      setCurrentWorkspaceId(current?.workspaceId ?? null);
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const addWorkspace = useCallback(async (input: CreateWorkspaceRequest) => {
    setSaving(true);
    setError(null);
    try {
      const created = await createWorkspace(input);
      setWorkspaces((items) => [...items, created]);
      return created;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return null;
    } finally {
      setSaving(false);
    }
  }, []);

  const selectWorkspace = useCallback(async (workspaceId: string) => {
    setSaving(true);
    setError(null);
    try {
      const current = await setCurrentWorkspace(workspaceId);
      setCurrentWorkspaceId(current.workspaceId);
      return true;
    } catch (requestError) {
      setError(errorMessage(requestError));
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const currentWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === currentWorkspaceId) ?? null,
    [currentWorkspaceId, workspaces],
  );

  return { addWorkspace, currentWorkspace, currentWorkspaceId, error, loading, reload, saving, selectWorkspace, workspaces };
}
