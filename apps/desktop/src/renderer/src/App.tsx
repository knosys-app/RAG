import type { AnswerMode, ChatMessage, ChatThread } from "@knosys-rag/contracts";
import { MotionConfig } from "motion/react";
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ChatView } from "@/components/chat/ChatView";
import { AppSidebar, type AppView } from "@/components/layout/AppSidebar";
import { LibraryView } from "@/components/library/LibraryView";
import { SettingsDialog } from "@/components/settings/SettingsDialog";
import { useChatRun } from "@/hooks/useChatRun";
import { useLibrary } from "@/hooks/useLibrary";
import { useRagStatus } from "@/hooks/useRagStatus";
import { useThreads } from "@/hooks/useThreads";
import { describeError } from "@/lib/errors";

function replaceMessage(
  thread: ChatThread | null,
  message: ChatMessage,
): ChatThread | null {
  if (!thread || thread.id !== message.threadId) return thread;
  return {
    ...thread,
    messages: thread.messages.map((candidate) =>
      candidate.id === message.id ? message : candidate,
    ),
    updatedAt: message.updatedAt,
  };
}

export function App(): ReactNode {
  const [view, setView] = useState<AppView>("chat");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [searchFocusRequest, setSearchFocusRequest] = useState(0);
  const [thread, setThread] = useState<ChatThread | null>(null);
  const [threadLoading, setThreadLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingFolderId, setPendingFolderId] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const rag = useRagStatus();
  const { refresh: refreshRag } = rag;
  const onImportCompleted = useCallback(() => {
    void refreshRag();
  }, [refreshRag]);
  const library = useLibrary({ onImportCompleted });
  const threads = useThreads();
  const {
    consumeSkip,
    moveThread,
    registerAcceptance,
    reload: reloadThreads,
    select: selectThread,
    selectedThreadId,
  } = threads;

  const chat = useChatRun({
    onAuthoritativeMessage: (message) => {
      setThread((current) => replaceMessage(current, message));
    },
    onTerminal: () => {
      void reloadThreads(false);
      window.setTimeout(() => composerRef.current?.focus(), 0);
    },
  });
  const { adoptInterruptedRun, cancel: cancelRun, send: sendRun } = chat;

  useEffect(() => {
    void reloadThreads(true);
  }, [reloadThreads]);

  useEffect(() => {
    setLoadError(null);
    if (!selectedThreadId) {
      setThread(null);
      setThreadLoading(false);
      return;
    }
    if (consumeSkip(selectedThreadId)) {
      setThreadLoading(false);
      return;
    }
    let current = true;
    setThreadLoading(true);
    void window.knosys.chat
      .getThread(selectedThreadId)
      .then((nextThread) => {
        if (!current) return;
        startTransition(() => setThread(nextThread));
        adoptInterruptedRun(nextThread);
      })
      .catch((error: unknown) => {
        if (current) {
          setLoadError(describeError(error, "The conversation could not be opened."));
        }
      })
      .finally(() => {
        if (current) setThreadLoading(false);
      });
    return () => {
      current = false;
    };
  }, [adoptInterruptedRun, consumeSkip, selectedThreadId]);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent): void {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setView("library");
        setSearchFocusRequest((current) => current + 1);
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => {
      window.removeEventListener("keydown", focusSearch);
    };
  }, []);

  const sendMessage = useCallback(
    async (question: string, mode: AnswerMode): Promise<string | null> => {
      try {
        const acceptance = await sendRun(selectedThreadId, question, mode);
        registerAcceptance(acceptance.thread);
        setThread((current) => ({
          ...acceptance.thread,
          messages:
            current?.id === acceptance.thread.id
              ? [...current.messages, acceptance.userMessage, acceptance.assistantMessage]
              : [acceptance.userMessage, acceptance.assistantMessage],
        }));
        if (pendingFolderId !== null) {
          setPendingFolderId(null);
          await moveThread(acceptance.thread.id, pendingFolderId);
        }
        return null;
      } catch (error) {
        return describeError(error, "The question could not be sent.");
      }
    },
    [moveThread, pendingFolderId, registerAcceptance, selectedThreadId, sendRun],
  );

  const cancelAnswer = useCallback(async (): Promise<string | null> => {
    try {
      await cancelRun();
      window.setTimeout(() => composerRef.current?.focus(), 0);
      return null;
    } catch (error) {
      return describeError(error, "The answer could not be stopped.");
    }
  }, [cancelRun]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex h-screen overflow-hidden bg-background text-foreground">
        <div
          aria-hidden="true"
          className="app-drag-region fixed inset-x-0 top-0 z-50 h-10"
        />
        <AppSidebar
          activeJobCount={library.activeJobCount}
          activeRunThreadId={chat.activeRun?.threadId ?? null}
          folders={threads.folders}
          onCreateFolder={threads.createFolder}
          onDeleteFolder={async (folderId) => {
            const error = await threads.removeFolder(folderId);
            if (error === null && pendingFolderId === folderId) setPendingFolderId(null);
            return error;
          }}
          onDeleteThread={threads.remove}
          onMoveThread={(threadId, folderId) => {
            void moveThread(threadId, folderId);
          }}
          onNewChat={() => {
            selectThread(null);
            setThread(null);
            setPendingFolderId(null);
            setView("chat");
            window.setTimeout(() => composerRef.current?.focus(), 0);
          }}
          onNewChatInFolder={(folderId) => {
            selectThread(null);
            setThread(null);
            setPendingFolderId(folderId);
            setView("chat");
            window.setTimeout(() => composerRef.current?.focus(), 0);
          }}
          onOpenSettings={() => {
            setSettingsOpen(true);
          }}
          onRenameFolder={threads.renameFolder}
          onRenameThread={threads.rename}
          onSelectThread={(threadId) => {
            selectThread(threadId);
            setPendingFolderId(null);
            setView("chat");
          }}
          onSetThreadMemoryExclusion={(threadId, excluded) => {
            void threads.setMemoryExclusion(threadId, excluded);
          }}
          onViewChange={setView}
          selectedThreadId={selectedThreadId}
          sourceCount={library.sourceCount}
          threads={threads.threads}
          threadsLoading={threads.loading}
          view={view}
        />
        {view === "chat" ? (
          <ChatView
            activeRun={chat.activeRun}
            announcement={chat.announcement}
            composerRef={composerRef}
            loadError={loadError}
            onCancel={cancelAnswer}
            onClearPendingFolder={() => {
              setPendingFolderId(null);
            }}
            onDismissLoadError={() => {
              setLoadError(null);
            }}
            onOpenMemoryThread={(threadId) => {
              // A memory's source thread may have been deleted since the
              // answer was written; the chip is inert in that case.
              if (!threads.threads.some((candidate) => candidate.id === threadId)) return;
              selectThread(threadId);
              setPendingFolderId(null);
              setView("chat");
            }}
            onSend={sendMessage}
            pendingFolderName={
              pendingFolderId === null
                ? null
                : (threads.folders.find(({ id }) => id === pendingFolderId)?.name ?? null)
            }
            rag={rag}
            sourceCount={library.sourceCount}
            thread={thread}
            threadLoading={threadLoading}
          />
        ) : (
          <LibraryView library={library} rag={rag} searchFocusRequest={searchFocusRequest} />
        )}
        <SettingsDialog
          library={library}
          onOpenChange={setSettingsOpen}
          open={settingsOpen}
          rag={rag}
        />
      </div>
    </MotionConfig>
  );
}
