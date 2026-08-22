import type { DocumentReview, DocumentSummary } from "@knosys-rag/contracts";
import {
  AlertTriangle,
  CircleAlert,
  Info,
  LoaderCircle,
  RefreshCw,
  RotateCw,
  Trash2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UseLibrary } from "@/hooks/useLibrary";
import {
  describeDiagnostic,
  describeFailure,
  describeLocation,
  type ReviewIssueCopy,
} from "@/lib/diagnostic-copy";
import { describeError } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface DocumentReviewDialogProps {
  readonly document: DocumentSummary | null;
  readonly library: UseLibrary;
  readonly onClose: () => void;
}

type ReviewIssue = ReviewIssueCopy & { readonly location: string | null };

const SEVERITY_ICON = {
  error: CircleAlert,
  info: Info,
  warning: AlertTriangle,
} as const;

const SEVERITY_TONE = {
  error: "text-destructive",
  info: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
} as const;

function buildIssues(document: DocumentSummary, review: DocumentReview | null): ReviewIssue[] {
  if (document.status === "failed") {
    return [
      {
        ...describeFailure(document.errorCode, document.errorMessage),
        location: null,
      },
    ];
  }
  // Only walk the reviewer through actionable issues. Informational notes
  // (repeated margins removed, some pages image-only) never require action and
  // never flip status to ready-with-warnings, so they would only be filler.
  const diagnostics = (review?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity !== "info");
  if (diagnostics.length === 0) {
    return [
      {
        title: "This document was flagged for review",
        explanation:
          "The importer flagged this document, but no detailed diagnostics were recorded.",
        impact: "It is indexed and searchable; review it before relying on it.",
        recommendedAction: "Keep it if it looks correct, or replace the source.",
        severity: "warning",
        location: null,
      },
    ];
  }
  return diagnostics.map((diagnostic) => ({
    ...describeDiagnostic(diagnostic),
    location: describeLocation(diagnostic),
  }));
}

export function DocumentReviewDialog({
  document,
  library,
  onClose,
}: DocumentReviewDialogProps): ReactNode {
  const [review, setReview] = useState<DocumentReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<
    "acknowledge" | "replace" | "delete" | "reprocess" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const documentId = document?.id ?? null;
  const isFailed = document?.status === "failed";
  // `library` is a fresh object on every parent render; depend only on the
  // memoized method so an unrelated re-render can't reset the wizard's step.
  const { getDocumentReview } = library;

  useEffect(() => {
    if (!documentId) return;
    setReview(null);
    setLoadError(null);
    setStep(0);
    setActionError(null);
    setBusy(null);
    // Failed documents carry their reason on the summary itself; only imported
    // documents have stored parse diagnostics worth fetching.
    if (isFailed) return;
    let active = true;
    setLoading(true);
    getDocumentReview(documentId)
      .then((result) => {
        if (active) setReview(result);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(describeError(error, "The review details could not be loaded."));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [documentId, isFailed, getDocumentReview]);

  if (!document) return null;

  const issues = buildIssues(document, review);
  const canAcknowledge = document.status === "ready-with-warnings";
  // Steps: 0 = intro, 1..issues.length = issue detail, last = resolution.
  const totalSteps = issues.length + 2;
  const resolutionStep = totalSteps - 1;
  const onResolution = step === resolutionStep;
  const onIntro = step === 0;
  const activeIssue = !onIntro && !onResolution ? issues[step - 1] : null;

  const runAction = (
    kind: "acknowledge" | "replace" | "delete" | "reprocess",
    action: () => Promise<string | null>,
  ) => {
    setActionError(null);
    setBusy(kind);
    void action()
      .then((error) => {
        if (error === null) onClose();
        else setActionError(error);
      })
      .finally(() => setBusy(null));
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && busy === null) onClose();
      }}
      open={document !== null}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review “{document.title}”</DialogTitle>
          <DialogDescription>
            {onIntro
              ? isFailed
                ? "This document couldn’t be imported. Here’s what happened and how to fix it."
                : "This document was imported with warnings. Walk through what came up, then decide what to do."
              : `Step ${step + 1} of ${totalSteps}`}
          </DialogDescription>
        </DialogHeader>

        <div
          aria-hidden="true"
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((step + 1) / totalSteps) * 100}%` }}
          />
        </div>

        <div className="min-h-[8rem] py-1 text-sm">
          {loading ? (
            <p className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="animate-spin" size={15} /> Loading review details…
            </p>
          ) : loadError ? (
            <p className="text-destructive" role="alert">
              {loadError}
            </p>
          ) : onIntro ? (
            <div className="space-y-2">
              <p>
                {isFailed
                  ? "Knosys could not extract any searchable text from this file, so it was not added to your library."
                  : `Knosys found ${issues.length} ${issues.length === 1 ? "issue" : "issues"} while importing this ${document.format.toUpperCase()} file.`}
              </p>
              <p className="text-muted-foreground">
                {isFailed
                  ? "The next step explains the cause and your options."
                  : "The document is already searchable — this review helps you confirm the extraction is good enough, or fix it."}
              </p>
            </div>
          ) : activeIssue ? (
            <ReviewIssueCard issue={activeIssue} />
          ) : (
            <div className="space-y-3">
              <p className="font-medium">How would you like to resolve this?</p>
              <ul className="space-y-1.5 text-muted-foreground">
                <li>
                  <strong className="text-foreground">Re-run import</strong> — re-import from
                  the stored copy using the improved importer. Best first try; it often clears
                  the issue and recovers missing text automatically.
                </li>
                {canAcknowledge ? (
                  <li>
                    <strong className="text-foreground">Keep &amp; mark reviewed</strong> —
                    you’ve checked it and the extraction is good enough.
                  </li>
                ) : null}
                <li>
                  <strong className="text-foreground">Replace file…</strong> — swap in a
                  better source (for example, a text-based or OCR-processed edition).
                </li>
                <li>
                  <strong className="text-foreground">Delete</strong> — remove it from the
                  library entirely.
                </li>
              </ul>
              {actionError ? (
                <p className="text-destructive" role="alert">
                  {actionError}
                </p>
              ) : null}
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          <div className="flex gap-2">
            {!onIntro && !loading ? (
              <Button
                disabled={busy !== null}
                onClick={() => setStep((current) => Math.max(0, current - 1))}
                variant="ghost"
              >
                Back
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {onResolution ? (
              <>
                <Button
                  disabled={busy !== null}
                  onClick={() => runAction("delete", () => library.deleteDocument(document.id))}
                  variant="outline"
                >
                  {busy === "delete" ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <Trash2 size={15} />
                  )}
                  Delete
                </Button>
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    runAction("replace", () => library.replaceDocument(document.id))
                  }
                  variant="outline"
                >
                  {busy === "replace" ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  Replace file…
                </Button>
                {canAcknowledge ? (
                  <Button
                    disabled={busy !== null}
                    onClick={() =>
                      runAction("acknowledge", () => library.acknowledgeReview(document.id))
                    }
                    variant="outline"
                  >
                    {busy === "acknowledge" ? (
                      <LoaderCircle className="animate-spin" size={15} />
                    ) : null}
                    Keep &amp; mark reviewed
                  </Button>
                ) : null}
                <Button
                  disabled={busy !== null}
                  onClick={() =>
                    runAction("reprocess", () => library.reprocessDocument(document.id))
                  }
                  variant="default"
                >
                  {busy === "reprocess" ? (
                    <LoaderCircle className="animate-spin" size={15} />
                  ) : (
                    <RotateCw size={15} />
                  )}
                  Re-run import
                </Button>
              </>
            ) : (
              <Button
                disabled={loading || loadError !== null}
                onClick={() => setStep((current) => Math.min(resolutionStep, current + 1))}
              >
                {onIntro ? "Start review" : step === totalSteps - 2 ? "Choose action" : "Next"}
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewIssueCard({ issue }: { readonly issue: ReviewIssue }): ReactNode {
  const Icon = SEVERITY_ICON[issue.severity];
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className={cn("mt-0.5 shrink-0", SEVERITY_TONE[issue.severity])} size={18} />
        <div>
          <h3 className="font-medium leading-tight">{issue.title}</h3>
          {issue.location ? (
            <p className="text-xs text-muted-foreground">{issue.location}</p>
          ) : null}
        </div>
      </div>
      <p>{issue.explanation}</p>
      <div className="space-y-1 rounded-lg bg-muted/50 p-3 text-[0.8125rem]">
        <p>
          <span className="font-medium">What this means: </span>
          <span className="text-muted-foreground">{issue.impact}</span>
        </p>
        <p>
          <span className="font-medium">Suggested fix: </span>
          <span className="text-muted-foreground">{issue.recommendedAction}</span>
        </p>
      </div>
    </div>
  );
}
