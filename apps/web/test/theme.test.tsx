// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useTheme } from "../src/shared/theme/use-theme.js";

describe("界面主题", () => {
  beforeEach(() => window.localStorage.clear());

  it("切换主题后同步持久化到浏览器", () => {
    const { result } = renderHook(() => useTheme());
    const initial = result.current.theme;

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe(initial === "dark" ? "light" : "dark");
    expect(window.localStorage.getItem("llm-harness.theme")).toBe(
      result.current.theme,
    );
    expect(document.documentElement.dataset.theme).toBe(result.current.theme);
  });
});
