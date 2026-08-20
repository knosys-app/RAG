import type {
  AnswerMode,
  ChatAcceptance,
  ChatEvent,
  ChatMessage,
  ChatProgressStatus,
  ChatThread,
} from "@knosys-rag/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { progressLabel } from "@/lib/chat-labels";

export interface ActiveRun {
  readonly assistantMessageId: string;
  readonly runId: string;
  readonly status: ChatProgressStatus;
  readonly text: string;
  readonly threadId: string;
}

export interface UseChatRunOptions {
  /** Receives the authoritative message from terminal events and cancel. */
  readonly onAuthoritativeMessage: (message: ChatMessage) => void;
  /** Fires after a run reaches a terminal state (refresh thread list, focus). */
  readonly onTerminal: () => void;
}

export interface UseChatRun {
  readonly activeRun: ActiveRun | null;
  readonly announcement: string;
  readonly adoptInterruptedRun: (thread: ChatThread) => void;
  readonly cancel: () => Promise<ChatMessage | null>;
  readonly clearActiveRun: () => void;
  readonly send: (
    threadId: string | null,
    question: string,
    mode: AnswerMode,
  ) => Promise<ChatAcceptance>;
}

/**
 * Owns the chat event stream reconciliation: per-run monotonic sequence
 * dedup, buffering of events that arrive before chat.send resolves, and
 * adoption of interrupted runs when a thread is reopened. The authoritative
 * message on terminal events supersedes all accumulated deltas.
 */
export function useChatRun(options: UseChatRunOptions): UseChatRun {
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const acceptedRuns = useRef(new Set<string>());
  const bufferedEvents = useRef(new Map<string, ChatEvent[]>());
  const latestSequence = useRef(new Map<string, number>());
  const activeRunRef = useRef<ActiveRun | null>(null);
  activeRunRef.current = activeRun;
  const callbacks = useRef(options);
  callbacks.current = options;

  const applyChatEvent = useCallback((event: ChatEvent) => {
    if (event.kind === "status") {
      setActiveRun((current) =>
        current?.runId === event.runId ? { ...current, status: event.status } : current,
      );
      setAnnouncement(progressLabel(event.status));
      return;
    }
    if (event.kind === "delta") {
      setActiveRun((current) =>
        current?.runId === event.runId
          ? { ...current, text: `${current.text}${event.text}` }
          : current,
      );
      return;
    }
    if (event.kind === "routing") return;

    callbacks.current.onAuthoritativeMessage(event.message);
    setActiveRun((current) => (current?.runId === event.runId ? null : current));
    acceptedRuns.current.delete(event.runId);
    setAnnouncement(
      event.kind === "completed"
        ? event.insufficient
          ? "Answer completed with insufficient evidence."
          : event.fallback
            ? "Answer completed with a recorded fallback."
            : "Answer completed."
        : event.kind === "cancelled"
          ? "Answer stopped."
          : "Answer failed.",
    );
    callbacks.current.onTerminal();
  }, []);

  useEffect(() => {
    const receiveChatEvent = (event: ChatEvent): void => {
      const previousSequence = latestSequence.current.get(event.runId);
      if (previousSequence !== undefined && event.sequence <= previousSequence) return;
      latestSequence.current.set(event.runId, event.sequence);
      if (!acceptedRuns.current.has(event.runId)) {
        const buffered = bufferedEvents.current.get(event.runId) ?? [];
        bufferedEvents.current.set(event.runId, [...buffered, event]);
        return;
      }
      applyChatEvent(event);
    };
    return window.knosys.chat.onEvent(receiveChatEvent);
  }, [applyChatEvent]);

  const send = useCallback(
    async (
      threadId: string | null,
      question: string,
      mode: AnswerMode,
    ): Promise<ChatAcceptance> => {
      const acceptance = await window.knosys.chat.send(threadId, question, mode);
      acceptedRuns.current.add(acceptance.runId);
      setActiveRun({
        assistantMessageId: acceptance.assistantMessage.id,
        runId: acceptance.runId,
        status: mode === "labeled-hybrid" ? "background" : "retrieving",
        text: "",
        threadId: acceptance.thread.id,
      });
      setAnnouncement(
        mode === "labeled-hybrid"
          ? "Question sent. Generating model background."
          : "Question sent. Finding library evidence.",
      );
      const waiting = bufferedEvents.current.get(acceptance.runId) ?? [];
      bufferedEvents.current.delete(acceptance.runId);
      for (const event of waiting) applyChatEvent(event);
      return acceptance;
    },
    [applyChatEvent],
  );

  const cancel = useCallback(async (): Promise<ChatMessage | null> => {
    const runId = activeRunRef.current?.runId ?? null;
    if (runId === null) return null;
    const message = await window.knosys.chat.cancel(runId);
    callbacks.current.onAuthoritativeMessage(message);
    setActiveRun(null);
    setAnnouncement("Answer stopped.");
    return message;
  }, []);

  const adoptInterruptedRun = useCallback(
    (thread: ChatThread) => {
      const interrupted = thread.messages.findLast(
        (message) =>
          message.role === "assistant" &&
          message.runId !== null &&
          ["pending", "retrieving", "planning", "generating"].includes(message.status),
      );
      if (interrupted?.runId) {
        acceptedRuns.current.add(interrupted.runId);
        setActiveRun({
          assistantMessageId: interrupted.id,
          runId: interrupted.runId,
          status:
            interrupted.status === "planning" ||
            interrupted.status === "generating" ||
            interrupted.status === "retrieving"
              ? interrupted.status
              : "retrieving",
          text: interrupted.content,
          threadId: thread.id,
        });
        const waiting = bufferedEvents.current.get(interrupted.runId) ?? [];
        bufferedEvents.current.delete(interrupted.runId);
        for (const event of waiting) applyChatEvent(event);
      } else {
        setActiveRun(null);
      }
    },
    [applyChatEvent],
  );

  const clearActiveRun = useCallback(() => {
    setActiveRun(null);
  }, []);

  return { activeRun, adoptInterruptedRun, announcement, cancel, clearActiveRun, send };
}
