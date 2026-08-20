import type { ReactNode } from "react";

import type { UseRagStatus } from "@/hooks/useRagStatus";
import { formatModelSize } from "@/lib/format";

interface ModelPickerProps {
  readonly onError: (message: string | null) => void;
  readonly rag: UseRagStatus;
}

export function ModelPicker({ onError, rag }: ModelPickerProps): ReactNode {
  const { changingModel, installedOptions, ragState, selectedModel, selectedOption } =
    rag;
  return (
    <label className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <span className="sr-only">Generation model</span>
      <select
        aria-label="Generation model"
        className="max-w-56 truncate rounded-md border-0 bg-transparent py-1 pr-5 pl-1 text-xs text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        disabled={
          changingModel || ragState.state !== "ready" || installedOptions.length === 0
        }
        onChange={(event) => {
          void rag
            .setGenerationModel(
              event.target.value === "auto"
                ? { mode: "auto" }
                : { mode: "manual", model: event.target.value },
            )
            .then(onError);
        }}
        value={
          rag.status?.generation.selectionMode === "auto"
            ? "auto"
            : selectedOption?.installed
              ? selectedOption.model
              : ""
        }
      >
        <option disabled value="">
          Select an installed model
        </option>
        <option value="auto">
          Automatic{selectedModel ? ` (${selectedModel.model})` : ""}
        </option>
        {installedOptions.map((option) => (
          <option disabled={!option.capable} key={option.model} value={option.model}>
            {option.model} · {formatModelSize(option.sizeBytes)} ·{" "}
            {option.nativeContextWindow
              ? `${Math.round(option.nativeContextWindow / 1024)}K context`
              : "unknown context"}
            {option.capable ? "" : " (incompatible)"}
          </option>
        ))}
      </select>
    </label>
  );
}
