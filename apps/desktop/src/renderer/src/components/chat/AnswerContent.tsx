import type { ChatMessage, ChatProgressStatus } from "@knosys-rag/contracts";
import { BookOpenText, ChevronRight, History, Quote } from "lucide-react";
import { motion } from "motion/react";
import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { Components } from "react-markdown";

import { CitationChip } from "@/components/chat/CitationChip";
import { EvidenceList } from "@/components/chat/EvidenceList";
import { Markdown } from "@/components/chat/Markdown";
import { ThinkingIndicator } from "@/components/chat/ThinkingIndicator";
import {
  describeFallbackStage,
  EVIDENCE_LINK_PREFIX,
  linkEvidenceMarkers,
  normalizeAnswer,
  type AnswerBlock,
} from "@/lib/answer-model";
import { citationPageLabel } from "@/lib/format";
import { contentTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface AnswerContentProps {
  readonly message: ChatMessage;
  readonly onInspectEvidence: (citationId: string) => void;
  readonly onOpenMemoryThread: (threadId: string) => void;
  readonly streamingStatus: ChatProgressStatus | null;
  readonly streamingText: string | null;
}

// Statement text renders with inline paragraphs so citation chips and
// model/conflict markers flow directly after the last word instead of
// dropping to their own line.
const INLINE_PARAGRAPH_COMPONENTS: Components = {
  p: ({
    children,
    node: _node,
    ...props
  }: ComponentPropsWithoutRef<"p"> & { readonly node?: unknown }) => (
    <span {...props}>{children}</span>
  ),
};

function BlockMarkers({
  block,
  message,
  onInspectEvidence,
  onOpenMemoryThread,
}: {
  readonly block: AnswerBlock;
  readonly message: ChatMessage;
  readonly onInspectEvidence: (citationId: string) => void;
  readonly onOpenMemoryThread: (threadId: string) => void;
}): ReactNode {
  const chipIndex = (citationId: string): number =>
    message.citations.findIndex((candidate) => candidate.id === citationId) + 1;
  if (
    block.citations.length === 0 &&
    block.contradicting.length === 0 &&
    block.memories.length === 0 &&
    block.kind !== "model" &&
    block.kind !== "conflict"
  ) {
    return null;
  }
  return (
    <span
      aria-label="Sources for this statement"
      className="ml-1.5 inline-flex flex-wrap items-center gap-1 align-baseline"
    >
      {block.citations.map((citation) => (
        <CitationChip
          citation={citation}
          index={chipIndex(citation.id)}
          key={`supporting-${citation.id}`}
          onInspect={onInspectEvidence}
        />
      ))}
      {block.contradicting.map((citation) => (
        <CitationChip
          citation={citation}
          index={chipIndex(citation.id)}
          key={`contradicting-${citation.id}`}
          onInspect={onInspectEvidence}
          variant="contradicting"
        />
      ))}
      {block.memories.map((memory) => (
        <button
          aria-label={`From a past chat: ${memory.threadTitle}, ${memory.threadDate}`}
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 align-super text-[0.65rem] font-medium text-primary hover:bg-primary/20"
          key={memory.id}
          onClick={() => {
            onOpenMemoryThread(memory.threadId);
          }}
          title={`From a past chat — ${memory.threadTitle} · ${memory.threadDate}`}
          type="button"
        >
          <History aria-hidden="true" size={11} />
          {memory.threadTitle}
        </button>
      ))}
      {block.kind === "model" ? (
        <span
          aria-label="Model knowledge, not verified by your library"
          className="rounded-md bg-muted px-1.5 py-0.5 align-super text-[0.65rem] font-medium text-muted-foreground"
          title="Model knowledge, not verified by your library"
        >
          model
        </span>
      ) : null}
      {block.kind === "conflict" ? (
        <span
          aria-label="Conflicts with your library"
          className="rounded-md bg-destructive/12 px-1.5 py-0.5 align-super text-[0.65rem] font-medium text-destructive"
          title="Conflicts with your library"
        >
          conflict
        </span>
      ) : null}
    </span>
  );
}

export function AnswerContent({
  message,
  onInspectEvidence,
  onOpenMemoryThread,
  streamingStatus,
  streamingText,
}: AnswerContentProps): ReactNode {
  const [evidenceExpanded, setEvidenceExpanded] = useState(false);

  if (streamingText !== null) {
    if (streamingText.length === 0) {
      return <ThinkingIndicator status={streamingStatus ?? "retrieving"} />;
    }
    return (
      <motion.div
        animate={{ opacity: 1 }}
        className="space-y-2"
        initial={{ opacity: 0 }}
        key="streaming"
        transition={contentTransition}
      >
        <Markdown>{streamingText}</Markdown>
        <span
          aria-hidden="true"
          className="inline-block size-2 animate-pulse rounded-full bg-primary"
        />
      </motion.div>
    );
  }

  const model = normalizeAnswer(message);

  if (model.blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">{message.status}</p>;
  }

  const footer =
    model.hasProvenance &&
    (message.citations.length > 0 ||
      model.hasMemory ||
      model.hasModelKnowledge ||
      model.fallbackStages.length > 0) ? (
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {message.citations.length > 0 ? (
          <button
            aria-controls={`evidence-index-${message.id}`}
            aria-expanded={evidenceExpanded}
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={() => {
              setEvidenceExpanded((current) => !current);
            }}
            type="button"
          >
            <BookOpenText aria-hidden="true" size={13} />
            Evidence used ({message.citations.length})
            <ChevronRight
              aria-hidden="true"
              className={cn("transition-transform", evidenceExpanded && "rotate-90")}
              size={13}
            />
          </button>
        ) : null}
        {model.hasMemory ? (
          <span
            className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-1 text-primary"
            title="Parts of this answer come from your past conversations"
          >
            <History aria-hidden="true" size={12} />
            Memory used
          </span>
        ) : null}
        {model.hasModelKnowledge ? (
          <span className="rounded-md bg-muted px-2 py-1">Includes model knowledge</span>
        ) : null}
        {model.fallbackStages.length > 0 ? (
          <span
            aria-label={model.fallbackStages.map(describeFallbackStage).join("; ")}
            className="rounded-md bg-amber-500/15 px-2 py-1 text-amber-600 dark:text-amber-400"
            title={
              model.fallbackStages
                .map(({ stage }) => stage.fallbackReason)
                .filter((reason) => reason !== null)
                .join(", ") || undefined
            }
          >
            Grounded fallback
          </span>
        ) : null}
      </div>
    ) : null;

  if (model.hasProvenance) {
    return (
      <motion.div
        animate={{ opacity: 1 }}
        data-version={message.answerProvenance?.version}
        initial={{ opacity: 0 }}
        key="answer"
        transition={contentTransition}
      >
        <div aria-label="Unified hybrid answer" className="space-y-2.5">
          {model.blocks.map((block) => (
            <div data-kind={block.kind} data-statement-id={block.key} key={block.key}>
              <Markdown className="inline" components={INLINE_PARAGRAPH_COMPONENTS}>
                {block.text}
              </Markdown>
              <BlockMarkers
                block={block}
                message={message}
                onInspectEvidence={onInspectEvidence}
                onOpenMemoryThread={onOpenMemoryThread}
              />
            </div>
          ))}
        </div>
        {footer}
        {evidenceExpanded ? (
          <EvidenceList
            blocks={model.blocks}
            citations={message.citations}
            hasModelKnowledge={model.hasModelKnowledge}
            id={`evidence-index-${message.id}`}
            onInspect={onInspectEvidence}
          />
        ) : null}
      </motion.div>
    );
  }

  const block = model.blocks[0];
  if (!block) return null;
  const { linked, matchedCitationIds } = linkEvidenceMarkers(
    block.text,
    block.citations,
  );
  const citationById = new Map(
    block.citations.map((citation) => [citation.id, citation]),
  );
  const evidenceComponents: Components = {
    a: ({
      children,
      href,
      node: _node,
      ...props
    }: ComponentPropsWithoutRef<"a"> & { readonly node?: unknown }) => {
      if (href?.startsWith(EVIDENCE_LINK_PREFIX)) {
        const citation = citationById.get(href.slice(EVIDENCE_LINK_PREFIX.length));
        if (citation) {
          return (
            <CitationChip
              citation={citation}
              index={block.citations.indexOf(citation) + 1}
              onInspect={onInspectEvidence}
            />
          );
        }
      }
      return (
        <a href={href} rel="noreferrer" target="_blank" {...props}>
          {children}
        </a>
      );
    },
  };

  return (
    <motion.div
      animate={{ opacity: 1 }}
      initial={{ opacity: 0 }}
      key="evidence"
      transition={contentTransition}
    >
      <Markdown components={evidenceComponents}>{linked}</Markdown>
      {block.citations.length > 0 && matchedCitationIds.size === 0 ? (
        <div aria-label="Answer sources" className="mt-3 flex flex-col items-start gap-1">
          {block.citations.map((citation, index) => {
            const pageLabel = citationPageLabel(citation);
            return (
              <button
                className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                key={citation.id}
                onClick={() => {
                  onInspectEvidence(citation.id);
                }}
                type="button"
              >
                <Quote aria-hidden="true" size={13} />
                <span>
                  Source {index + 1}: {citation.title}
                  {pageLabel ? ` · ${pageLabel}` : ""}
                </span>
                <ChevronRight aria-hidden="true" size={13} />
              </button>
            );
          })}
        </div>
      ) : null}
    </motion.div>
  );
}
