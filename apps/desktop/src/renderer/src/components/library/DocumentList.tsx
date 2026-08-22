import type { DocumentSummary } from "@knosys-rag/contracts";
import { AlertTriangle, ChevronRight, ClipboardCheck, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import { formatBytes, formatDate } from "@/lib/format";
import { documentStatusLabel } from "@/lib/library-labels";
import { cn } from "@/lib/utils";

interface DocumentListProps {
  readonly documents: readonly DocumentSummary[];
  readonly onDelete: (document: DocumentSummary) => void;
  readonly onReview: (document: DocumentSummary) => void;
}

const STATUS_STYLES: Record<DocumentSummary["status"], string> = {
  failed: "bg-destructive/12 text-destructive",
  processing: "bg-muted text-muted-foreground",
  ready: "bg-primary/10 text-primary",
  "ready-with-warnings": "bg-amber-500/15 text-amber-600 dark:text-amber-400",
};

const REVIEWED_STATUS_STYLE = "bg-muted text-muted-foreground";

function needsReview(document: DocumentSummary): boolean {
  return (
    document.status === "failed" ||
    (document.status === "ready-with-warnings" && document.reviewedAt === null)
  );
}

export function DocumentList({
  documents,
  onDelete,
  onReview,
}: DocumentListProps): ReactNode {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="divide-y rounded-xl border bg-card">
      {documents.map((document) => {
        const expanded = expandedId === document.id;
        const reviewable = needsReview(document);
        const reviewed =
          document.status === "ready-with-warnings" && document.reviewedAt !== null;
        return (
          <div className="group" key={document.id}>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                aria-expanded={expanded}
                aria-pressed={expanded}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
                onClick={() => {
                  setExpandedId((current) => (current === document.id ? null : document.id));
                }}
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 text-muted-foreground transition-transform",
                    expanded && "rotate-90",
                  )}
                  size={15}
                />
                <span className="min-w-0 flex-1">
                  <strong className="block truncate text-sm font-medium">
                    {document.title}
                  </strong>
                  <span className="block truncate text-xs text-muted-foreground">
                    {document.originalName} · {formatBytes(document.sizeBytes)}
                  </span>
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-md px-2 py-0.5 text-xs font-medium",
                    reviewed ? REVIEWED_STATUS_STYLE : STATUS_STYLES[document.status],
                  )}
                >
                  {documentStatusLabel(document)}
                </span>
              </button>
              {reviewable ? (
                <button
                  className="shrink-0 rounded-md border border-amber-500/40 px-2 py-1 text-xs font-medium text-amber-600 transition-colors hover:bg-amber-500/10 dark:text-amber-400"
                  onClick={() => {
                    onReview(document);
                  }}
                  type="button"
                >
                  <span className="flex items-center gap-1">
                    <ClipboardCheck size={13} /> Review
                  </span>
                </button>
              ) : null}
              <button
                aria-label={`Delete ${document.title}`}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-destructive"
                onClick={() => {
                  onDelete(document);
                }}
                type="button"
              >
                <Trash2 size={15} />
              </button>
            </div>
            {expanded ? (
              <div className="space-y-2 px-10 pb-3 text-xs text-muted-foreground">
                <dl className="grid grid-cols-3 gap-2">
                  <div>
                    <dt className="font-medium">Format</dt>
                    <dd>{document.format.toUpperCase()}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Imported</dt>
                    <dd>{formatDate(document.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="font-medium">Diagnostics</dt>
                    <dd>{document.diagnosticCount || "None"}</dd>
                  </div>
                </dl>
                {document.errorMessage ? (
                  <p className="flex items-start gap-1.5 text-destructive" role="alert">
                    <AlertTriangle aria-hidden="true" className="mt-0.5" size={13} />
                    <span>
                      <strong>{document.errorCode ?? "Processing failed"}</strong>{" "}
                      {document.errorMessage}
                    </span>
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
