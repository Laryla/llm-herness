// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { API_VERSION } from "@llm-harness/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "../src/App.js";

describe("LLM Harness Web", () => {
  afterEach(() => vi.restoreAllMocks());

  it("呈现产品壳层和新建对话入口", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const path = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return Promise.resolve(new Response(JSON.stringify({
        apiVersion: API_VERSION,
        data: path.endsWith("current-workspace") ? null : [],
      })));
    });
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "LLM Harness" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
  });
});
