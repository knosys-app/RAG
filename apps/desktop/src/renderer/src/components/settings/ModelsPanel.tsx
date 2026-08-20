import {
  RECOMMENDED_MODELS,
  type ModelPullEvent,
  type RecommendedModel,
} from "@knosys-rag/contracts";
import { AlertTriangle, Check, Download, LoaderCircle, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useModelPulls } from "@/hooks/useModelPulls";
import type { UseRagStatus } from "@/hooks/useRagStatus";
import { formatModelSize } from "@/lib/format";
import {
  contextWindowLabel,
  incompatibilityLabel,
  pullStatusLabel,
  recommendedRoleLabel,
} from "@/lib/model-labels";
import { cn } from "@/lib/utils";

function PullProgress({
  event,
  onCancel,
}: {
  readonly event: ModelPullEvent;
  readonly onCancel: () => void;
}): ReactNode {
  const percent =
    event.completedBytes !== null && event.totalBytes !== null && event.totalBytes > 0
      ? Math.round((event.completedBytes / event.totalBytes) * 100)
      : null;
  return (
    <div className="flex w-40 items-center gap-2">
      <div className="min-w-0 flex-1">
        <p className="mb-1 truncate text-[0.7rem] text-muted-foreground">
          {pullStatusLabel(event.status)}
          {percent !== null ? ` · ${percent}%` : ""}
        </p>
        <Progress value={percent ?? undefined} />
      </div>
      <button
        aria-label={`Cancel downloading ${event.model}`}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive"
        onClick={onCancel}
        type="button"
      >
        <X size={14} />
      </button>
    </div>
  );
}

function RecommendedRow({
  entry,
  installed,
  installedDetail,
  onError,
  pullEvent,
  pulls,
  runtimeAvailable,
}: {
  readonly entry: RecommendedModel;
  readonly installed: boolean;
  readonly installedDetail: string | null;
  readonly onError: (message: string | null) => void;
  readonly pullEvent: ModelPullEvent | undefined;
  readonly pulls: ReturnType<typeof useModelPulls>;
  readonly runtimeAvailable: boolean;
}): ReactNode {
  const pulling =
    pullEvent !== undefined &&
    ["starting", "downloading", "verifying"].includes(pullEvent.status);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <strong className="font-mono text-sm font-medium">{entry.model}</strong>
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[0.65rem] font-medium",
              entry.role === "embedding-required"
                ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                : "bg-muted text-muted-foreground",
            )}
          >
            {recommendedRoleLabel(entry.role)}
          </span>
        </span>
        <span className="block text-xs text-muted-foreground">
          {entry.description} · about {formatModelSize(entry.approxSizeBytes)}
        </span>
        {pullEvent?.status === "failed" && pullEvent.error ? (
          <span className="mt-0.5 flex items-start gap-1 text-xs text-destructive">
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={11} />
            {pullEvent.error}
          </span>
        ) : null}
      </span>
      <AnimatePresence initial={false} mode="wait">
        {installed ? (
          <motion.span
            animate={{ opacity: 1 }}
            className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="installed"
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            <Check aria-hidden="true" size={12} />
            Installed
            {installedDetail ? (
              <span className="font-normal text-muted-foreground">
                · {installedDetail}
              </span>
            ) : null}
          </motion.span>
        ) : pulling ? (
          <motion.div
            animate={{ opacity: 1 }}
            className="shrink-0"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="pulling"
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            <PullProgress
              event={pullEvent}
              onCancel={() => {
                void pulls.cancel(entry.model).then(onError);
              }}
            />
          </motion.div>
        ) : (
          <motion.div
            animate={{ opacity: 1 }}
            className="shrink-0"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="download"
            transition={{ duration: 0.12, ease: "easeOut" }}
          >
            <Button
              aria-label={`Download ${entry.model}`}
              disabled={!runtimeAvailable}
              onClick={() => {
                onError(null);
                void pulls.pull(entry.model).then(onError);
              }}
              size="sm"
              title={runtimeAvailable ? undefined : "Start Ollama to download models"}
              variant="outline"
            >
              <Download size={14} /> Download
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
}

export function ModelsPanel({ rag }: { readonly rag: UseRagStatus }): ReactNode {
  const [error, setError] = useState<string | null>(null);
  const pulls = useModelPulls({
    onCompleted: () => {
      void rag.refresh();
    },
  });
  const status = rag.status;
  const runtimeAvailable = status?.runtime.state === "available";
  const options = status?.generation.options ?? [];
  const embedding = status?.embedding;
  const coverage = embedding?.coverage ?? null;
  const selectionValue =
    status?.generation.selectionMode === "auto"
      ? "auto"
      : rag.selectedOption?.installed
        ? rag.selectedOption.model
        : "";

  const isInstalled = (entry: RecommendedModel): boolean =>
    entry.role === "embedding-required"
      ? embedding?.model.installed === true
      : options.some((option) => option.model === entry.model && option.installed);

  const selectModel = (value: string): void => {
    setError(null);
    void rag
      .setGenerationModel(
        value === "auto" ? { mode: "auto" } : { mode: "manual", model: value },
      )
      .then(setError);
  };

  return (
    <div className="space-y-5">
      {error ? (
        <div
          className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
          role="alert"
        >
          <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
          <p>{error}</p>
        </div>
      ) : null}

      <section className="space-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Generation model
        </h3>
        {options.length === 0 ? (
          <p className="py-1 text-sm text-muted-foreground">
            {runtimeAvailable
              ? "No local generation models were found. Download a recommended model below."
              : "Start Ollama to see the local generation models on this Mac."}
          </p>
        ) : (
          <fieldset
            className="divide-y rounded-lg border"
            disabled={rag.changingModel || rag.ragState.state !== "ready"}
          >
            <legend className="sr-only">Generation model selection</legend>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 has-disabled:cursor-not-allowed">
              <input
                checked={selectionValue === "auto"}
                className="accent-[var(--primary)]"
                name="generation-model-choice"
                onChange={() => {
                  selectModel("auto");
                }}
                type="radio"
                value="auto"
              />
              <span className="min-w-0 flex-1">
                <strong className="block text-sm font-medium">Automatic</strong>
                <span className="block text-xs text-muted-foreground">
                  Smallest compatible installed model
                  {rag.selectedModel && status?.generation.selectionMode === "auto"
                    ? ` — currently ${rag.selectedModel.model}`
                    : ""}
                </span>
              </span>
            </label>
            {options.map((option) => (
              <label
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5",
                  option.capable
                    ? "cursor-pointer"
                    : "cursor-not-allowed opacity-60",
                )}
                key={option.model}
              >
                <input
                  checked={selectionValue === option.model}
                  className="accent-[var(--primary)]"
                  disabled={!option.capable}
                  name="generation-model-choice"
                  onChange={() => {
                    selectModel(option.model);
                  }}
                  type="radio"
                  value={option.model}
                />
                <span className="min-w-0 flex-1">
                  <strong className="block font-mono text-sm font-medium">
                    {option.model}
                  </strong>
                  <span className="block text-xs text-muted-foreground">
                    {formatModelSize(option.sizeBytes)} ·{" "}
                    {contextWindowLabel(option.nativeContextWindow)}
                  </span>
                  {option.incompatibilityReason ? (
                    <span className="block text-xs text-destructive">
                      Incompatible: {incompatibilityLabel(option.incompatibilityReason)}
                    </span>
                  ) : null}
                </span>
                {rag.changingModel && selectionValue === option.model ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="shrink-0 animate-spin text-muted-foreground"
                    size={14}
                  />
                ) : null}
              </label>
            ))}
          </fieldset>
        )}
        <p className="text-xs text-muted-foreground">
          The selected model is used for new answers only.
        </p>
      </section>

      <section className="space-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Recommended models
        </h3>
        <ul className="divide-y">
          {RECOMMENDED_MODELS.map((entry) => (
            <RecommendedRow
              entry={entry}
              installed={isInstalled(entry)}
              installedDetail={
                entry.role === "embedding-required" && coverage
                  ? `${Math.round(coverage.ratio * 100)}% embedded`
                  : null
              }
              key={entry.model}
              onError={setError}
              pullEvent={pulls.pulls.get(entry.model)}
              pulls={pulls}
              runtimeAvailable={runtimeAvailable}
            />
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Downloads come from the Ollama library and stay on this Mac. Any other
          compatible model installed through Ollama also appears above.
        </p>
      </section>
    </div>
  );
}
