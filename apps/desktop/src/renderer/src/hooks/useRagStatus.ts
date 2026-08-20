import type {
  GenerationModelOption,
  GenerationModelPreference,
  GenerationModelSelection,
  RagStatus,
} from "@knosys-rag/contracts";
import { useCallback, useEffect, useState } from "react";

import { describeError } from "@/lib/errors";

export type RagLoadState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly status: RagStatus }
  | { readonly state: "error"; readonly message: string };

export interface UseRagStatus {
  readonly changingModel: boolean;
  readonly generationReady: boolean;
  readonly installedOptions: readonly GenerationModelOption[];
  readonly loading: boolean;
  readonly ragState: RagLoadState;
  readonly refresh: () => Promise<void>;
  readonly selectedModel: GenerationModelSelection | null;
  readonly selectedOption: GenerationModelOption | undefined;
  /** Resolves to an error message, or null on success. */
  readonly setGenerationModel: (
    preference: GenerationModelPreference,
  ) => Promise<string | null>;
  readonly status: RagStatus | null;
}

export function useRagStatus(): UseRagStatus {
  const [ragState, setRagState] = useState<RagLoadState>({ state: "loading" });
  const [changingModel, setChangingModel] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const status = await window.knosys.rag.getStatus();
      setRagState({ state: "ready", status });
    } catch (error) {
      setRagState({
        message: describeError(error, "Model readiness is unavailable."),
        state: "error",
      });
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);

  const setGenerationModel = useCallback(
    async (preference: GenerationModelPreference): Promise<string | null> => {
      setChangingModel(true);
      try {
        const status = await window.knosys.rag.setGenerationModel(preference);
        setRagState({ state: "ready", status });
        return null;
      } catch (error) {
        return describeError(error, "The generation model could not be selected.");
      } finally {
        setChangingModel(false);
      }
    },
    [],
  );

  const status = ragState.state === "ready" ? ragState.status : null;
  const selectedModel = status?.generation.selected ?? null;
  const selectedOption = status?.generation.options.find(
    (option) => option.model === selectedModel?.model,
  );
  const installedOptions =
    status?.generation.options.filter((option) => option.installed) ?? [];
  const generationReady =
    status?.runtime.state === "available" &&
    selectedModel !== null &&
    selectedOption?.installed === true &&
    selectedOption.capable;

  return {
    changingModel,
    generationReady,
    installedOptions,
    loading: ragState.state === "loading",
    ragState,
    refresh,
    selectedModel,
    selectedOption,
    setGenerationModel,
    status,
  };
}
