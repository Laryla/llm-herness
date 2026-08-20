import type { CreateModelProfileRequest, ModelProfile, ModelSelection, UpdateModelProfileRequest } from "@llm-harness/contracts";
import { useCallback, useEffect, useState } from "react";

import { createModelProfile, getCurrentModelSelection, listModelProfiles, setCurrentModelSelection, testModelProfile, updateModelProfile } from "../api/model-api.js";

function message(error: unknown) { return error instanceof Error ? error.message : "模型配置请求失败"; }
function selectionOf(profile: ModelProfile): ModelSelection { return { profileId: profile.id, modelName: profile.modelName }; }

/** 单层模型配置状态：一条 Profile 同时包含连接信息和供应商模型名称。 */
export function useModels() {
  const [profiles, setProfiles] = useState<ModelProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [currentSelection, setCurrentSelectionState] = useState<ModelSelection | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [items, current] = await Promise.all([listModelProfiles(), getCurrentModelSelection()]);
      let selection = current.selection;
      if (!selection && items[0]) selection = (await setCurrentModelSelection(selectionOf(items[0]))).selection;
      setProfiles(items); setCurrentSelectionState(selection);
      setSelectedProfileId((id) => id && items.some((profile) => profile.id === id) ? id : (selection?.profileId ?? items[0]?.id ?? null));
    } catch (requestError) { setError(message(requestError)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  async function mutate<T>(operation: () => Promise<T>): Promise<T | null> {
    setSaving(true); setError(null);
    try { return await operation(); }
    catch (requestError) { setError(message(requestError)); return null; }
    finally { setSaving(false); }
  }

  const createProfile = useCallback(async (input: CreateModelProfileRequest) => {
    const result = await mutate(async () => {
      const profile = await createModelProfile(input);
      const current = await setCurrentModelSelection(selectionOf(profile));
      return { current, profile };
    });
    if (!result) return null;
    setProfiles((items) => [...items, result.profile]); setSelectedProfileId(result.profile.id); setCurrentSelectionState(result.current.selection);
    return result.profile;
  }, []);
  const testConnection = useCallback(async (profileId: string) => {
    const updated = await mutate(() => testModelProfile(profileId));
    if (updated) setProfiles((items) => items.map((profile) => profile.id === updated.id ? updated : profile));
    return updated;
  }, []);
  const updateProfile = useCallback(async (profileId: string, input: UpdateModelProfileRequest) => {
    const updated = await mutate(() => updateModelProfile(profileId, input));
    if (!updated) return null;
    setProfiles((items) => items.map((profile) => profile.id === updated.id ? updated : profile));
    if (currentSelection?.profileId === updated.id) {
      const current = await setCurrentModelSelection(selectionOf(updated)); setCurrentSelectionState(current.selection);
    }
    return updated;
  }, [currentSelection]);
  const selectModel = useCallback(async (selection: ModelSelection) => {
    const current = await mutate(() => setCurrentModelSelection(selection));
    if (current) setCurrentSelectionState(current.selection);
    return current !== null;
  }, []);

  return { createProfile, currentSelection, error, loading, profiles, reload, saving, selectModel, selectedProfileId, setSelectedProfileId, testConnection, updateProfile };
}
