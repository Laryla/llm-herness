// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import type { ModelProfile } from "@llm-harness/contracts";
import { describe, expect, it, vi } from "vitest";

import { ModelSettings } from "../src/domains/models/components/model-settings.js";
import type { useModels } from "../src/domains/models/model/use-models.js";

const failedProfile: ModelProfile = {
  id: "profile_test",
  displayName: "本地模型",
  baseUrl: "http://127.0.0.1:8000/v1",
  secret: { source: "local", reference: "profile_test", maskedValue: "••••test" },
  connection: {
    status: "failed",
    testedAt: "2026-08-20T00:00:00.000Z",
    error: { code: "model_connection_failed", message: "模型服务返回 HTTP 401", retryable: false },
  },
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

function modelState(testConnection = vi.fn().mockResolvedValue(failedProfile)) {
  return {
    addModel: vi.fn(), catalog: { profileId: failedProfile.id, entries: [], refreshedAt: null }, createProfile: vi.fn(), currentSelection: null,
    error: null, loading: false, profiles: [failedProfile], refreshCatalog: vi.fn(), reload: vi.fn(), saving: false, selectModel: vi.fn(),
    selectedProfileId: failedProfile.id, setSelectedProfileId: vi.fn(), testConnection,
  } as unknown as ReturnType<typeof useModels>;
}

describe("模型连接测试", () => {
  it("展示后端保存的失败原因并允许重新测试", () => {
    const testConnection = vi.fn().mockResolvedValue(failedProfile);
    render(<ModelSettings state={modelState(testConnection)} />);

    expect(screen.getByText("模型服务返回 HTTP 401")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "测试连接" }));
    expect(testConnection).toHaveBeenCalledWith(failedProfile.id);
  });
});
