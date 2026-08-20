import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ChatAcceptance, ChatMessage } from "@knosys-rag/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assistantMessage,
  installKnosysApi,
  pendingAssistantMessage,
  RUN_ID,
  threadSummary,
  userMessage,
} from "@/test/fixtures";
import { useChatRun } from "@/hooks/useChatRun";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderChatRun(callbacks?: {
  onAuthoritativeMessage?: (message: ChatMessage) => void;
  onTerminal?: () => void;
}) {
  return renderHook(() =>
    useChatRun({
      onAuthoritativeMessage: callbacks?.onAuthoritativeMessage ?? (() => undefined),
      onTerminal: callbacks?.onTerminal ?? (() => undefined),
    }),
  );
}

describe("useChatRun", () => {
  it("ignores duplicate and out-of-order event sequences", async () => {
    const { emit } = installKnosysApi();
    const { result } = renderChatRun();

    await act(async () => {
      await result.current.send(null, "How should I store seeds?", "labeled-hybrid");
    });
    emit({ kind: "delta", runId: RUN_ID, sequence: 1, text: "A" });
    emit({ kind: "delta", runId: RUN_ID, sequence: 1, text: "duplicate" });
    emit({ kind: "status", runId: RUN_ID, sequence: 3, status: "verifying" });
    emit({ kind: "delta", runId: RUN_ID, sequence: 2, text: "stale" });
    emit({ kind: "delta", runId: RUN_ID, sequence: 4, text: "B" });

    await waitFor(() => {
      expect(result.current.activeRun?.text).toBe("AB");
    });
    expect(result.current.activeRun?.status).toBe("verifying");
  });

  it("buffers events that arrive before chat.send resolves", async () => {
    const { api, emit } = installKnosysApi();
    let resolveSend: (acceptance: ChatAcceptance) => void = () => undefined;
    vi.mocked(api.chat.send).mockImplementation(
      () =>
        new Promise<ChatAcceptance>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { result } = renderChatRun();

    let pending: Promise<ChatAcceptance> | null = null;
    act(() => {
      pending = result.current.send(null, "How should I store seeds?", "labeled-hybrid");
    });
    emit({ kind: "status", runId: RUN_ID, sequence: 0, status: "retrieving" });
    emit({ kind: "delta", runId: RUN_ID, sequence: 1, text: "Early" });
    expect(result.current.activeRun).toBeNull();

    await act(async () => {
      resolveSend({
        accepted: true,
        assistantMessage: pendingAssistantMessage,
        runId: RUN_ID,
        thread: threadSummary,
        userMessage,
      } as ChatAcceptance);
      await pending;
    });
    await waitFor(() => {
      expect(result.current.activeRun?.text).toBe("Early");
    });
    expect(result.current.activeRun?.status).toBe("retrieving");
  });

  it("adopts interrupted runs and replays buffered events", async () => {
    const { emit } = installKnosysApi();
    const { result } = renderChatRun();

    emit({ kind: "delta", runId: RUN_ID, sequence: 5, text: " continued" });
    act(() => {
      result.current.adoptInterruptedRun({
        ...threadSummary,
        messages: [
          userMessage,
          { ...pendingAssistantMessage, content: "Partial", status: "generating" },
        ],
      });
    });
    await waitFor(() => {
      expect(result.current.activeRun?.text).toBe("Partial continued");
    });
    expect(result.current.activeRun?.status).toBe("generating");
  });

  it("treats terminal events as authoritative and notifies callbacks", async () => {
    const onAuthoritativeMessage = vi.fn();
    const onTerminal = vi.fn();
    const { emit } = installKnosysApi();
    const { result } = renderChatRun({ onAuthoritativeMessage, onTerminal });

    await act(async () => {
      await result.current.send(null, "How should I store seeds?", "labeled-hybrid");
    });
    emit({ kind: "delta", runId: RUN_ID, sequence: 0, text: "partial deltas" });
    emit({
      fallback: false,
      insufficient: false,
      kind: "completed",
      message: assistantMessage,
      runId: RUN_ID,
      sequence: 1,
    });

    await waitFor(() => {
      expect(result.current.activeRun).toBeNull();
    });
    expect(onAuthoritativeMessage).toHaveBeenCalledWith(assistantMessage);
    expect(onTerminal).toHaveBeenCalledTimes(1);
    expect(result.current.announcement).toBe("Answer completed.");
  });
});
