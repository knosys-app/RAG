import { AlertTriangle, LoaderCircle } from "lucide-react";
import type { ReactNode } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { EvidenceState } from "@/hooks/useEvidence";
import { citationPageLabel } from "@/lib/format";

interface EvidenceDialogProps {
  readonly evidence: EvidenceState;
  readonly onClose: () => void;
}

export function EvidenceDialog({ evidence, onClose }: EvidenceDialogProps): ReactNode {
  const open = evidence.state !== "idle";
  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      open={open}
    >
      <DialogContent className="max-h-[80vh] gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader className="border-b pb-3">
          <DialogTitle className="font-display">
            {evidence.state === "ready"
              ? evidence.citation.title
              : evidence.state === "error"
                ? "Evidence unavailable"
                : "Opening evidence"}
          </DialogTitle>
          <DialogDescription>Source evidence</DialogDescription>
        </DialogHeader>
        <div className="overflow-y-auto pt-3">
          {evidence.state === "loading" ? (
            <div
              className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
              Opening exact evidence
            </div>
          ) : null}
          {evidence.state === "error" ? (
            <div
              className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
              role="alert"
            >
              <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
              <div>
                <strong>Evidence unavailable.</strong>
                <p className="text-muted-foreground">{evidence.message}</p>
              </div>
            </div>
          ) : null}
          {evidence.state === "ready" ? (
            <div className="space-y-4">
              {evidence.citation.headingPath.length > 0 ||
              citationPageLabel(evidence.citation) ? (
                <p className="text-xs text-muted-foreground">
                  {[
                    ...evidence.citation.headingPath,
                    citationPageLabel(evidence.citation),
                  ]
                    .filter(Boolean)
                    .join(" / ")}
                </p>
              ) : null}
              <blockquote className="border-l-2 border-primary pl-3 text-sm leading-relaxed">
                {evidence.citation.text}
              </blockquote>
              <div>
                <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  Source context
                </h3>
                <div className="space-y-1.5">
                  {evidence.blocks.map((block) => {
                    const selected =
                      block.ordinal >=
                        evidence.citation.sourceLocator.start.blockOrdinal &&
                      block.ordinal <= evidence.citation.sourceLocator.end.blockOrdinal;
                    return (
                      <div
                        className={
                          selected
                            ? "flex gap-3 rounded-md bg-primary/8 p-2 text-sm ring-1 ring-primary/25"
                            : "flex gap-3 p-2 text-sm text-muted-foreground"
                        }
                        data-evidence={selected}
                        key={block.id}
                      >
                        <span className="shrink-0 font-mono text-[0.65rem] text-muted-foreground">
                          {block.pageNumber
                            ? `p. ${block.pageNumber}`
                            : String(block.ordinal + 1).padStart(2, "0")}
                        </span>
                        <p className="whitespace-pre-wrap">{block.text}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
