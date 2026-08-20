import {
  currentModelSelectionSchema,
  modelCatalogEntrySchema,
  modelCatalogSchema,
  modelProfileSchema,
  type CreateModelProfileRequest,
  type CurrentModelSelection,
  type ModelCatalog,
  type ModelCatalogEntry,
  type ModelProfile,
  type ModelSelection,
} from "@llm-harness/contracts";
import { z } from "zod";

import { requestApi } from "../../../shared/api/client.js";

export function listModelProfiles(): Promise<ModelProfile[]> {
  return requestApi("/api/v1/model-profiles", z.array(modelProfileSchema));
}

/** secretValue 只发送给 Server 写入系统密钥库，响应永远只有脱敏引用。 */
export function createModelProfile(input: CreateModelProfileRequest): Promise<ModelProfile> {
  return requestApi("/api/v1/model-profiles", modelProfileSchema, { method: "POST", body: JSON.stringify(input) });
}

export function testModelProfile(profileId: string): Promise<ModelProfile> {
  return requestApi(`/api/v1/model-profiles/${encodeURIComponent(profileId)}/test-connection`, modelProfileSchema, { method: "POST" });
}

export function getModelCatalog(profileId: string): Promise<ModelCatalog> {
  return requestApi(`/api/v1/model-profiles/${encodeURIComponent(profileId)}/models`, modelCatalogSchema);
}

export function refreshModelCatalog(profileId: string): Promise<ModelCatalog> {
  return requestApi(`/api/v1/model-profiles/${encodeURIComponent(profileId)}/models/refresh`, modelCatalogSchema, { method: "POST" });
}

export function addManualModel(profileId: string, modelName: string): Promise<ModelCatalogEntry> {
  return requestApi(`/api/v1/model-profiles/${encodeURIComponent(profileId)}/models`, modelCatalogEntrySchema, { method: "POST", body: JSON.stringify({ modelName }) });
}

export function getCurrentModelSelection(): Promise<CurrentModelSelection> {
  return requestApi("/api/v1/current-model-selection", currentModelSelectionSchema);
}

export function setCurrentModelSelection(selection: ModelSelection | null): Promise<CurrentModelSelection> {
  return requestApi("/api/v1/current-model-selection", currentModelSelectionSchema, { method: "PUT", body: JSON.stringify({ selection }) });
}
