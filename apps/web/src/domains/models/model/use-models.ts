import type { CreateModelProfileRequest, ModelCatalog, ModelProfile, ModelSelection, UpdateModelProfileRequest } from "@llm-harness/contracts";
import { useCallback, useEffect, useState } from "react";

import { addManualModel, createModelProfile, getCurrentModelSelection, getModelCatalog, listModelProfiles, refreshModelCatalog, setCurrentModelSelection, testModelProfile, updateModelProfile } from "../api/model-api.js";

function message(error: unknown) { return error instanceof Error ? error.message : "模型配置请求失败"; }

/** 统一管理设置页和输入框共享的 Profile、Catalog 与当前模型选择。 */
export function useModels() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [currentSelection, setCurrentSelectionState] = useState<ModelSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [items, current] = await Promise.all([listModelProfiles(), getCurrentModelSelection()]);
      setProfiles(items); setCurrentSelectionState(current.selection);
      setSelectedProfileId((id) => id && items.some((profile) => profile.id === id) ? id : (current.selection?.profileId ?? items[0]?.id ?? null));
    } catch (requestError) { setError(message(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const reloadCatalog = useCallback(async () => {
    if (!selectedProfileId) { setCatalog(null); return; }
    try { setCatalog(await getModelCatalog(selectedProfileId)); }
    catch (requestError) { setError(message(requestError)); }
  }, [selectedProfileId]);
  useEffect(() => { void reloadCatalog(); }, [reloadCatalog]);

  async function mutate<T>(operation: () => Promise<T>): Promise<T | null> {
    setSaving(true); setError(null);
    try { return await operation(); }
    catch (requestError) { setError(message(requestError)); return null; }
    finally { setSaving(false); }
  }

  const createProfile = useCallback(async (input: CreateModelProfileRequest) => {
    const created = await mutate(() => createModelProfile(input));
    if (created) { setProfiles((items) => [...items, created]); setSelectedProfileId(created.id); }
    return created;
  }, []);
  const testConnection = useCallback(async (profileId: string) => {
    const updated = await mutate(() => testModelProfile(profileId));
    if (updated) setProfiles((items) => items.map((profile) => profile.id === updated.id ? updated : profile));
    return updated;
  }, []);
  const updateProfile = useCallback(async (profileId: string, input: UpdateModelProfileRequest) => {
    const updated = await mutate(() => updateModelProfile(profileId, input));
    if (updated) setProfiles((items) => items.map((profile) => profile.id === updated.id ? updated : profile));
    return updated;
  }, []);
  const refreshCatalog = useCallback(async () => {
    if (!selectedProfileId) return;
    const next = await mutate(() => refreshModelCatalog(selectedProfileId));
    if (next) setCatalog(next);
  }, [selectedProfileId]);
  const addModel = useCallback(async (modelName: string) => {
    if (!selectedProfileId) return null;
    const entry = await mutate(() => addManualModel(selectedProfileId, modelName));
    if (entry) setCatalog((value) => value ? { ...value, entries: [...value.entries, entry] } : value);
    return entry;
  }, [selectedProfileId]);
  const selectModel = useCallback(async (selection: ModelSelection) => {
    const current = await mutate(() => setCurrentModelSelection(selection));
    if (current) setCurrentSelectionState(current.selection);
    return current !== null;
  }, []);

  return { addModel, catalog, createProfile, currentSelection, error, loading, profiles, refreshCatalog, reload, saving, selectModel, selectedProfileId, setSelectedProfileId, testConnection, updateProfile };
}
