import type { ChatMessage } from "@knosys-rag/contracts";
import { ArrowDown, LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, type ReactNode } from "react";

import { Message } from "@/components/chat/Message";
import type { ActiveRun } from "@/hooks/useChatRun";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { springSnappy } from "@/lib/motion";

interface MessageListProps {
  readonly activeRun: ActiveRun | null;
  readonly emptyState: ReactNode;
  readonly messages: readonly ChatMessage[];
  readonly onInspectEvidence: (citationId: string) => void;
  readonly onOpenMemoryThread: (threadId: string) => void;
  readonly threadLoading: boolean;
}

export function MessageList({
  activeRun,
  emptyState,
  messages,
  onInspectEvidence,
  onOpenMemoryThread,
  threadLoading,
}: MessageListProps): ReactNode {
  const { containerRef, onScroll, pinned, scrollToBottom, scrollToBottomIfPinned } =
    useAutoScroll();
  const streamLength = activeRun?.text.length ?? 0;
  const lastMessageId = messages.at(-1)?.id ?? null;

  useEffect(() => {
    scrollToBottomIfPinned();
  }, [lastMessageId, messages.length, scrollToBottomIfPinned, streamLength]);

  if (threadLoading) {
    return (
      <div
        className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
        role="status"
      >
        <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
        Opening conversation
      </div>
    );
  }

  if (messages.length === 0) {
    return <div className="min-h-0 flex-1">{emptyState}</div>;
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        aria-busy={activeRun !== null}
        aria-label="Conversation transcript"
        className="h-full overflow-y-auto"
        onScroll={onScroll}
        ref={containerRef}
      >
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
          {messages.map((message) => {
            const isStreaming = activeRun?.assistantMessageId === message.id;
            return (
              <Message
                key={message.id}
                message={message}
                onInspectEvidence={onInspectEvidence}
                onOpenMemoryThread={onOpenMemoryThread}
                streamingStatus={isStreaming ? activeRun.status : null}
                streamingText={isStreaming ? activeRun.text : null}
              />
            );
          })}
        </div>
      </div>
      <AnimatePresence>
        {!pinned ? (
          <motion.button
            animate={{ opacity: 1, scale: 1, x: "-50%", y: 0 }}
            aria-label="Jump to latest message"
            className="absolute bottom-4 left-1/2 rounded-full border bg-background/95 p-2 shadow-md transition-colors hover:bg-accent"
            exit={{ opacity: 0, scale: 0.9, x: "-50%", y: 6 }}
            initial={{ opacity: 0, scale: 0.9, x: "-50%", y: 6 }}
            key="jump-latest"
            onClick={() => {
              scrollToBottom("smooth");
            }}
            transition={springSnappy}
            type="button"
            whileTap={{ scale: 0.92 }}
          >
            <ArrowDown size={15} />
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
