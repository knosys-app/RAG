import { act, cleanup, renderHook } from "@testing-library/react";
import React, { type ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ThemeProvider, useTheme } from "@/hooks/useTheme";

function wrapper({ children }: { readonly children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("useTheme", () => {
  it("defaults to the system preference and applies the resolved class", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.preference).toBe("system");
    expect(result.current.resolved).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("persists an explicit preference and toggles the dark class", () => {
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => {
      result.current.setPreference("dark");
    });
    expect(result.current.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("knosys.theme")).toBe("dark");

    cleanup();
    const { result: reloaded } = renderHook(() => useTheme(), { wrapper });
    expect(reloaded.current.preference).toBe("dark");
    expect(reloaded.current.resolved).toBe("dark");
  });
});
