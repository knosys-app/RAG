import type { ChatCitation } from "@knosys-rag/contracts";
import type { ReactNode } from "react";

import { citationPageLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

interface CitationChipProps {
  readonly citation: ChatCitation;
  readonly index: number;
  readonly onInspect: (citationId: string) => void;
  readonly variant?: "contradicting" | "supporting";
}

export function CitationChip({
  citation,
  index,
  onInspect,
  variant = "supporting",
}: CitationChipProps): ReactNode {
  const pageLabel = citationPageLabel(citation);
  const relationshipLabel =
    variant === "supporting" ? "Evidence" : "Contradicting source";
  return (
    <button
      aria-label={`${relationshipLabel} ${index}: ${citation.title}${pageLabel ? `, ${pageLabel}` : ""}`}
      className={cn(
        "inline-flex h-[1.15rem] min-w-[1.15rem] items-center justify-center rounded-md px-1 align-super font-mono text-[0.65rem] font-semibold transition-colors",
        variant === "supporting"
          ? "bg-primary/12 text-primary hover:bg-primary/25"
          : "bg-destructive/12 text-destructive hover:bg-destructive/25",
      )}
      onClick={() => {
        onInspect(citation.id);
      }}
      title={`${citation.title}${pageLabel ? ` · ${pageLabel}` : ""}`}
      type="button"
    >
      {index}
    </button>
  );
}
