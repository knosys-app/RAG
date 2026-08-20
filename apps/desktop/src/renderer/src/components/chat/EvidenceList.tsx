import type { ChatCitation } from "@knosys-rag/contracts";
import { ChevronRight, Quote } from "lucide-react";
import type { ReactNode } from "react";

import type { AnswerBlock } from "@/lib/answer-model";
import { citationPageLabel } from "@/lib/format";

interface EvidenceListProps {
  readonly blocks: readonly AnswerBlock[];
  readonly citations: readonly ChatCitation[];
  readonly hasModelKnowledge: boolean;
  readonly id: string;
  readonly onInspect: (citationId: string) => void;
}

export function EvidenceList({
  blocks,
  citations,
  hasModelKnowledge,
  id,
  onInspect,
}: EvidenceListProps): ReactNode {
  return (
    <div
      aria-label="Evidence used by this answer"
      className="mt-2 space-y-3 rounded-lg border bg-card/60 p-3"
      id={id}
    >
      {citations.map((citation, index) => {
        const pageLabel = citationPageLabel(citation);
        const supported = blocks.filter((block) =>
          block.citations.some((candidate) => candidate.id === citation.id),
        );
        return (
          <div className="space-y-1.5" key={citation.id}>
            <button
              aria-label={`Open evidence ${index + 1}: ${citation.title}`}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
              onClick={() => {
                onInspect(citation.id);
              }}
              type="button"
            >
              <Quote aria-hidden="true" size={13} />
              <span>
                Evidence {index + 1}: {citation.title}
                {pageLabel ? ` · ${pageLabel}` : ""}
              </span>
              <ChevronRight aria-hidden="true" size={13} />
            </button>
            <blockquote className="border-l-2 border-border pl-3 text-xs text-muted-foreground">
              {citation.text}
            </blockquote>
            {supported.length > 0 ? (
              <div className="pl-3 text-xs">
                <small className="font-medium tracking-wide text-muted-foreground uppercase">
                  Supports
                </small>
                {supported.map((block) => (
                  <p className="mt-0.5 text-muted-foreground" key={block.key}>
                    {block.text}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
      {hasModelKnowledge ? (
        <div className="space-y-1.5 border-t pt-3">
          <p className="text-xs">
            <strong>Model knowledge</strong>
            <span className="ml-2 text-muted-foreground">
              Not supported by the library
            </span>
          </p>
          <div className="pl-3 text-xs">
            {blocks
              .filter(({ kind }) => kind === "model")
              .map((block) => (
                <p className="mt-0.5 text-muted-foreground" key={block.key}>
                  {block.text}
                </p>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
