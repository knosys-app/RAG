import type { ChatMessage, ChatProgressStatus } from "@knosys-rag/contracts";
import { AlertTriangle } from "lucide-react";
import { motion } from "motion/react";
import { memo, type ReactNode } from "react";

import { AnswerContent } from "@/components/chat/AnswerContent";
import { routingLabel } from "@/lib/chat-labels";
import { contentFade } from "@/lib/motion";

interface MessageProps {
  readonly message: ChatMessage;
  readonly onInspectEvidence: (citationId: string) => void;
  readonly onOpenMemoryThread: (threadId: string) => void;
  readonly streamingStatus: ChatProgressStatus | null;
  readonly streamingText: string | null;
}

function statusNotice(message: ChatMessage): ReactNode {
  switch (message.status) {
    case "insufficient":
      return (
        <motion.p
          animate="visible"
          className="mb-1.5 inline-flex rounded-md bg-amber-500/15 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400"
          initial="hidden"
          variants={contentFade}
        >
          Insufficient evidence
        </motion.p>
      );
    case "cancelled":
      return (
        <motion.p
          animate="visible"
          className="mb-1.5 inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          initial="hidden"
          variants={contentFade}
        >
          Stopped
        </motion.p>
      );
    case "interrupted":
      return (
        <motion.p
          animate="visible"
          className="mb-1.5 inline-flex rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
          initial="hidden"
          variants={contentFade}
        >
          Interrupted
        </motion.p>
      );
    default:
      return null;
  }
}

function MessageComponent({
  message,
  onInspectEvidence,
  onOpenMemoryThread,
  streamingStatus,
  streamingText,
}: MessageProps): ReactNode {
  if (message.role === "user") {
    return (
      <motion.article
        animate="visible"
        className="flex justify-end"
        data-role="user"
        initial="hidden"
        variants={contentFade}
      >
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-secondary px-4 py-2.5 text-[0.9375rem] leading-relaxed whitespace-pre-wrap text-secondary-foreground">
          {message.content}
        </div>
      </motion.article>
    );
  }

  const route = routingLabel(message);
  const isTerminal =
    streamingText === null &&
    ["completed", "insufficient", "cancelled", "interrupted", "failed"].includes(
      message.status,
    );

  return (
    <motion.article
      animate="visible"
      data-role="assistant"
      initial="hidden"
      variants={contentFade}
    >
      {streamingText === null ? statusNotice(message) : null}
      {message.status === "failed" ? (
        <div
          className="mb-2 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
          <div>
            <strong>Answer failed.</strong>
            {message.errorMessage ? (
              <p className="text-muted-foreground">{message.errorMessage}</p>
            ) : null}
          </div>
        </div>
      ) : null}
      <AnswerContent
        message={message}
        onInspectEvidence={onInspectEvidence}
        onOpenMemoryThread={onOpenMemoryThread}
        streamingStatus={streamingStatus}
        streamingText={streamingText}
      />
      {message.status !== "failed" && message.errorMessage ? (
        <p className="mt-1.5 text-xs text-muted-foreground">{message.errorMessage}</p>
      ) : null}
      {isTerminal && (message.model !== null || route || message.answerProvenance) ? (
        <motion.div
          animate="visible"
          className="mt-2 flex flex-wrap items-center gap-2 text-[0.7rem] text-muted-foreground"
          initial="hidden"
          variants={contentFade}
        >
          {message.model ? <span>{message.model}</span> : null}
          {route ? <span>{route}</span> : null}
          {message.answerProvenance ? (
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              Hybrid
            </span>
          ) : null}
        </motion.div>
      ) : null}
    </motion.article>
  );
}

export const Message = memo(MessageComponent);
