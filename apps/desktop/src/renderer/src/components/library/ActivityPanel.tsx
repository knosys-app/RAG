import type { ImportProgressEvent, RagStatus } from "@knosys-rag/contracts";
import { Check, Database, LoaderCircle } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { importStageLabel } from "@/lib/library-labels";
import { contentFade } from "@/lib/motion";

interface ActivityPanelProps {
  readonly importing: "directory" | "files" | null;
  readonly importProgress: ImportProgressEvent | null;
  readonly ragStatus: RagStatus | null;
  readonly sourceCount: number;
}

export function ActivityPanel({
  importing,
  importProgress,
  ragStatus,
  sourceCount,
}: ActivityPanelProps): ReactNode {
  const semanticCoverage = ragStatus?.embedding.coverage ?? null;
  const semanticReady = semanticCoverage?.ratio === 1;
  const semanticCanRun =
    ragStatus?.runtime.state === "available" && ragStatus.embedding.model.capable;
  const semanticState =
    ragStatus === null
      ? "checking"
      : semanticReady
        ? "ready"
        : semanticCanRun
          ? "working"
          : "paused";
  const semanticPercent = Math.round((semanticCoverage?.ratio ?? 0) * 100);
  const importPosition =
    importProgress?.total && importProgress.stage !== "completed"
      ? Math.min(importProgress.completed + 1, importProgress.total)
      : null;

  if (!importing && sourceCount === 0) return null;

  return (
    <motion.section
      animate="visible"
      aria-label="Library background activity"
      aria-live="polite"
      className="space-y-2"
      initial="hidden"
      variants={contentFade}
    >
      {importing ? (
        <motion.div
          animate="visible"
          className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm"
          initial="hidden"
          variants={contentFade}
        >
          <LoaderCircle
            aria-hidden="true"
            className="shrink-0 animate-spin text-primary"
            size={18}
          />
          <div className="min-w-0 flex-1">
            <strong className="block">
              {importProgress
                ? importStageLabel(importProgress.stage)
                : "Waiting for source selection"}
            </strong>
            <span className="block truncate text-xs text-muted-foreground">
              {importProgress?.currentName ??
                (importProgress?.stage === "discovering"
                  ? "Looking for supported documents in this folder."
                  : "Choose files or a folder in the system dialog.")}
            </span>
            {importProgress?.total !== null && importProgress?.total !== undefined ? (
              <small className="text-xs text-muted-foreground">
                {importProgress.stage === "completed"
                  ? `${importProgress.total} sources checked`
                  : importPosition === null
                    ? `${importProgress.completed} of ${importProgress.total} complete`
                    : `Source ${importPosition} of ${importProgress.total}`}
              </small>
            ) : null}
          </div>
          {importProgress?.total !== null && importProgress?.total !== undefined ? (
            <progress
              aria-label="Source import progress"
              className="w-28"
              max={Math.max(importProgress.total, 1)}
              value={importProgress.completed}
            />
          ) : (
            <progress aria-label="Source discovery in progress" className="w-28" />
          )}
        </motion.div>
      ) : null}
      {sourceCount > 0 && semanticState !== "ready" ? (
        <motion.div
          animate="visible"
          className="flex items-center gap-3 rounded-lg border bg-card p-3 text-sm"
          initial="hidden"
          variants={contentFade}
        >
          <span aria-hidden="true" className="shrink-0 text-primary">
            {semanticState === "working" || semanticState === "checking" ? (
              <LoaderCircle className="animate-spin" size={18} />
            ) : semanticState === "paused" ? (
              <Database size={18} />
            ) : (
              <Check size={18} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block">
              {semanticState === "working"
                ? "Building semantic index"
                : semanticState === "checking"
                  ? "Checking semantic index"
                  : "Semantic indexing paused"}
            </strong>
            <span className="block text-xs text-muted-foreground">
              {semanticCoverage
                ? `${semanticCoverage.currentChunks.toLocaleString()} of ${semanticCoverage.totalChunks.toLocaleString()} chunks embedded (${semanticPercent}%).`
                : semanticState === "checking"
                  ? "Checking local model and index coverage."
                  : "The embedding model is unavailable. Lexical search remains available."}
            </span>
          </div>
          {semanticCoverage ? (
            <progress
              aria-label="Semantic indexing progress"
              className="w-28"
              max={Math.max(semanticCoverage.totalChunks, 1)}
              value={semanticCoverage.currentChunks}
            />
          ) : (
            <progress aria-label="Semantic index status pending" className="w-28" />
          )}
        </motion.div>
      ) : null}
    </motion.section>
  );
}
