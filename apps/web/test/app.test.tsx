// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "../src/App.js";

describe("LLM Harness Web", () => {
  it("呈现产品壳层和新建对话入口", () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { level: 1, name: "LLM Harness" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建对话" })).toBeTruthy();
  });
});
