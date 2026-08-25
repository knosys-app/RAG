import type { MemoryStatus, UserFact } from "@knosys-rag/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MemoryPanel } from "@/components/settings/MemoryPanel";

afterEach(cleanup);

const PREFERENCE_FACT: UserFact = {
  category: "preference",
  createdAt: "2026-08-20T00:00:00.000Z",
  fact: "Prefers metric units.",
  id: "11111111-1111-4111-8111-111111111111",
  origin: "extracted",
  sourceThreadId: null,
  updatedAt: "2026-08-20T00:00:00.000Z",
};

const PROJECT_FACT: UserFact = {
  ...PREFERENCE_FACT,
  category: "project",
  fact: "Writing a book about heirloom gardening.",
  id: "22222222-2222-4222-8222-222222222222",
};

const STATUS: MemoryStatus = {
  excludedThreadCount: 1,
  factCount: 2,
  staleThreadCount: 0,
  summarizedThreadCount: 4,
};

function installMemoryApi(options: {
  readonly facts?: readonly UserFact[];
  readonly status?: MemoryStatus;
} = {}) {
  const api = {
    memory: {
      deleteFact: vi
        .fn()
        .mockResolvedValue({ deletedFactId: PREFERENCE_FACT.id }),
      getStatus: vi.fn().mockResolvedValue(options.status ?? STATUS),
      listFacts: vi
        .fn()
        .mockResolvedValue(options.facts ?? [PREFERENCE_FACT, PROJECT_FACT]),
      setThreadExclusion: vi.fn(),
      updateFact: vi.fn().mockImplementation((factId: string, fact: string) =>
        Promise.resolve({ ...PREFERENCE_FACT, fact, id: factId, origin: "user" }),
      ),
    },
  };
  Object.defineProperty(window, "knosys", { configurable: true, value: api });
  return api;
}

describe("MemoryPanel", () => {
  it("lists saved facts with category labels and the memory status line", async () => {
    installMemoryApi();
    render(<MemoryPanel />);

    expect(await screen.findByText("Prefers metric units.")).toBeTruthy();
    expect(screen.getByText("Writing a book about heirloom gardening.")).toBeTruthy();
    expect(screen.getByText("Preference")).toBeTruthy();
    expect(screen.getByText("Project")).toBeTruthy();
    expect(
      screen.getByText("4 conversations remembered · 1 excluded"),
    ).toBeTruthy();
  });

  it("shows the empty state when nothing has been saved", async () => {
    installMemoryApi({
      facts: [],
      status: { ...STATUS, factCount: 0 },
    });
    render(<MemoryPanel />);

    expect(await screen.findByText(/Nothing saved yet/)).toBeTruthy();
  });

  it("edits a fact inline and saves it", async () => {
    const api = installMemoryApi();
    render(<MemoryPanel />);
    await screen.findByText("Prefers metric units.");

    fireEvent.click(
      screen.getByRole("button", { name: "Edit memory: Prefers metric units." }),
    );
    const input = screen.getByRole("textbox", {
      name: "Edit memory: Prefers metric units.",
    });
    fireEvent.change(input, { target: { value: "Prefers imperial units." } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(api.memory.updateFact).toHaveBeenCalledWith(
        PREFERENCE_FACT.id,
        "Prefers imperial units.",
      );
    });
    expect(await screen.findByText("Prefers imperial units.")).toBeTruthy();
  });

  it("forgets a fact and removes it from the list", async () => {
    const api = installMemoryApi();
    render(<MemoryPanel />);
    await screen.findByText("Prefers metric units.");

    fireEvent.click(
      screen.getByRole("button", { name: "Forget memory: Prefers metric units." }),
    );
    await waitFor(() => {
      expect(api.memory.deleteFact).toHaveBeenCalledWith(PREFERENCE_FACT.id);
      expect(screen.queryByText("Prefers metric units.")).toBeNull();
    });
    expect(screen.getByText("Writing a book about heirloom gardening.")).toBeTruthy();
  });
});
