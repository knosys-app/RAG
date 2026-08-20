import type { AnswerMode, ChatThread } from "@knosys-rag/contracts";
import { AlertTriangle, Folder, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useState, type ReactNode, type RefObject } from "react";

import { Composer } from "@/components/chat/Composer";
import { EmptyState } from "@/components/chat/EmptyState";
import { EvidenceDialog } from "@/components/chat/EvidenceDialog";
import { MessageList } from "@/components/chat/MessageList";
import { ModelPicker } from "@/components/chat/ModelPicker";
import type { ActiveRun } from "@/hooks/useChatRun";
import { useEvidence } from "@/hooks/useEvidence";
import type { UseRagStatus } from "@/hooks/useRagStatus";
import { contentTransition, exitTransition } from "@/lib/motion";

interface ChatViewProps {
  readonly activeRun: ActiveRun | null;
  readonly announcement: string;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly loadError: string | null;
  /** Both resolve to an error message, or null on success. */
  readonly onCancel: () => Promise<string | null>;
  readonly onClearPendingFolder: () => void;
  readonly onDismissLoadError: () => void;
  readonly onSend: (question: string, mode: AnswerMode) => Promise<string | null>;
  readonly pendingFolderName: string | null;
  readonly rag: UseRagStatus;
  readonly sourceCount: number;
  readonly thread: ChatThread | null;
  readonly threadLoading: boolean;
}

export function ChatView({
  activeRun,
  announcement,
  composerRef,
  loadError,
  onCancel,
  onClearPendingFolder,
  onDismissLoadError,
  onSend,
  pendingFolderName,
  rag,
  sourceCount,
  thread,
  threadLoading,
}: ChatViewProps): ReactNode {
  const [draft, setDraft] = useState("");
  const [answerMode, setAnswerMode] = useState<AnswerMode>("labeled-hybrid");
  const [operationError, setOperationError] = useState<string | null>(null);
  const { close, evidence, inspect } = useEvidence();
  const shownError = operationError ?? loadError;
  // Stable identity keeps memoized messages (and their DOM, including the
  // evidence-chip focus target) intact across evidence-dialog state changes.
  const handleInspectEvidence = useCallback(
    (citationId: string) => {
      void inspect(citationId);
    },
    [inspect],
  );

  const sendMessage = (): void => {
    const question = draft.trim();
    if (!question || activeRun) return;
    setOperationError(null);
    void onSend(question, answerMode).then((error) => {
      if (error === null) setDraft("");
      else setOperationError(error);
    });
  };

  const stopAnswer = (): void => {
    void onCancel().then((error) => {
      if (error !== null) setOperationError(error);
    });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <AnimatePresence initial={false}>
        {shownError ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="app-no-drag mx-auto mt-12 flex w-full max-w-3xl items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            exit={{ opacity: 0, transition: exitTransition }}
            initial={{ opacity: 0, y: -6 }}
            key="chat-error"
            role="alert"
            transition={contentTransition}
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <div className="flex-1">
              <strong>Chat operation failed.</strong>
              <p className="text-muted-foreground">{shownError}</p>
            </div>
            <button
              aria-label="Dismiss error"
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              onClick={() => {
                setOperationError(null);
                onDismissLoadError();
              }}
              type="button"
            >
              <X size={14} />
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <MessageList
        activeRun={activeRun}
        emptyState={
          <EmptyState
            onPickPrompt={(prompt) => {
              setDraft(prompt);
              composerRef.current?.focus();
            }}
          />
        }
        messages={thread?.messages ?? []}
        onInspectEvidence={handleInspectEvidence}
        threadLoading={threadLoading}
      />
      <AnimatePresence initial={false}>
        {pendingFolderName !== null && thread === null ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="mx-auto w-full max-w-3xl px-4 pb-1"
            exit={{ opacity: 0, scale: 0.97, transition: exitTransition }}
            initial={{ opacity: 0, y: 4 }}
            key="filing-pill"
            transition={contentTransition}
          >
            <span className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
              <Folder aria-hidden="true" size={12} />
              Filing into {pendingFolderName}
              <button
                aria-label="Do not file the next chat into a folder"
                className="rounded p-0.5 hover:bg-primary/15"
                onClick={onClearPendingFolder}
                type="button"
              >
                <X size={11} />
              </button>
            </span>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <Composer
        busy={activeRun !== null}
        composerRef={composerRef}
        draft={draft}
        generationReady={rag.generationReady}
        mode={answerMode}
        modelPicker={<ModelPicker onError={setOperationError} rag={rag} />}
        onDraftChange={setDraft}
        onModeChange={setAnswerMode}
        onSend={sendMessage}
        onStop={stopAnswer}
        sourceCount={sourceCount}
      />
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <EvidenceDialog evidence={evidence} onClose={close} />
    </div>
  );
}
