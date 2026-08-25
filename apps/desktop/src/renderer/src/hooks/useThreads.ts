import type { ChatFolder, ChatThreadSummary } from "@knosys-rag/contracts";
import { startTransition, useCallback, useRef, useState } from "react";

import { describeError } from "@/lib/errors";

export interface UseThreads {
  /** Consumes the one-shot skip flag set when send() created the thread. */
  readonly consumeSkip: (threadId: string) => boolean;
  readonly createFolder: (name: string) => Promise<string | null>;
  readonly folders: readonly ChatFolder[];
  readonly loading: boolean;
  readonly moveThread: (
    threadId: string,
    folderId: string | null,
  ) => Promise<string | null>;
  readonly registerAcceptance: (thread: ChatThreadSummary) => void;
  readonly reload: (selectFirst: boolean) => Promise<string | null>;
  readonly remove: (threadId: string) => Promise<string | null>;
  /** Also removes the folder's threads locally; clears a deleted selection. */
  readonly removeFolder: (folderId: string) => Promise<string | null>;
  readonly rename: (threadId: string, title: string) => Promise<string | null>;
  readonly renameFolder: (folderId: string, name: string) => Promise<string | null>;
  readonly select: (threadId: string | null) => void;
  readonly selectedThreadId: string | null;
  readonly setMemoryExclusion: (
    threadId: string,
    excluded: boolean,
  ) => Promise<string | null>;
  readonly threads: readonly ChatThreadSummary[];
}

export function useThreads(): UseThreads {
  const [threads, setThreads] = useState<readonly ChatThreadSummary[]>([]);
  const [folders, setFolders] = useState<readonly ChatFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedThreadId;
  const skipThreadLoad = useRef<string | null>(null);

  const reload = useCallback(async (selectFirst: boolean): Promise<string | null> => {
    try {
      const [nextThreads, nextFolders] = await Promise.all([
        window.knosys.chat.listThreads(),
        window.knosys.chat.listFolders(),
      ]);
      startTransition(() => {
        setThreads(nextThreads);
        setFolders(nextFolders);
        if (selectFirst) setSelectedThreadId(nextThreads[0]?.id ?? null);
      });
      return null;
    } catch (error) {
      return describeError(error, "Chat history could not be opened.");
    } finally {
      setLoading(false);
    }
  }, []);

  const select = useCallback((threadId: string | null) => {
    setSelectedThreadId(threadId);
  }, []);

  const registerAcceptance = useCallback((thread: ChatThreadSummary) => {
    if (selectedRef.current === null) skipThreadLoad.current = thread.id;
    setSelectedThreadId(thread.id);
    setThreads((current) => [
      thread,
      ...current.filter((candidate) => candidate.id !== thread.id),
    ]);
  }, []);

  const consumeSkip = useCallback((threadId: string): boolean => {
    if (skipThreadLoad.current !== threadId) return false;
    skipThreadLoad.current = null;
    return true;
  }, []);

  const rename = useCallback(
    async (threadId: string, title: string): Promise<string | null> => {
      try {
        const summary = await window.knosys.chat.renameThread(threadId, title);
        setThreads((current) =>
          current.map((candidate) => (candidate.id === threadId ? summary : candidate)),
        );
        return null;
      } catch (error) {
        return describeError(error, "The conversation could not be renamed.");
      }
    },
    [],
  );

  const remove = useCallback(async (threadId: string): Promise<string | null> => {
    try {
      await window.knosys.chat.deleteThread(threadId);
      setThreads((current) => current.filter((candidate) => candidate.id !== threadId));
      if (selectedRef.current === threadId) setSelectedThreadId(null);
      return null;
    } catch (error) {
      return describeError(error, "The conversation could not be deleted.");
    }
  }, []);

  const moveThread = useCallback(
    async (threadId: string, folderId: string | null): Promise<string | null> => {
      try {
        const summary = await window.knosys.chat.moveThread(threadId, folderId);
        setThreads((current) =>
          current.map((candidate) => (candidate.id === threadId ? summary : candidate)),
        );
        return null;
      } catch (error) {
        return describeError(error, "The conversation could not be moved.");
      }
    },
    [],
  );

  const setMemoryExclusion = useCallback(
    async (threadId: string, excluded: boolean): Promise<string | null> => {
      try {
        const summary = await window.knosys.memory.setThreadExclusion(
          threadId,
          excluded,
        );
        setThreads((current) =>
          current.map((candidate) => (candidate.id === threadId ? summary : candidate)),
        );
        return null;
      } catch (error) {
        return describeError(error, "The memory setting could not be changed.");
      }
    },
    [],
  );

  const createFolder = useCallback(async (name: string): Promise<string | null> => {
    try {
      const folder = await window.knosys.chat.createFolder(name);
      setFolders((current) => [...current, folder]);
      return null;
    } catch (error) {
      return describeError(error, "The folder could not be created.");
    }
  }, []);

  const renameFolder = useCallback(
    async (folderId: string, name: string): Promise<string | null> => {
      try {
        const folder = await window.knosys.chat.renameFolder(folderId, name);
        setFolders((current) =>
          current.map((candidate) => (candidate.id === folderId ? folder : candidate)),
        );
        return null;
      } catch (error) {
        return describeError(error, "The folder could not be renamed.");
      }
    },
    [],
  );

  const removeFolder = useCallback(async (folderId: string): Promise<string | null> => {
    try {
      const result = await window.knosys.chat.deleteFolder(folderId);
      const deleted = new Set(result.deletedThreadIds);
      setFolders((current) => current.filter((candidate) => candidate.id !== folderId));
      setThreads((current) => current.filter((candidate) => !deleted.has(candidate.id)));
      if (selectedRef.current !== null && deleted.has(selectedRef.current)) {
        setSelectedThreadId(null);
      }
      return null;
    } catch (error) {
      return describeError(error, "The folder could not be deleted.");
    }
  }, []);

  return {
    consumeSkip,
    createFolder,
    folders,
    loading,
    moveThread,
    registerAcceptance,
    reload,
    remove,
    removeFolder,
    rename,
    renameFolder,
    select,
    selectedThreadId,
    setMemoryExclusion,
    threads,
  };
}
