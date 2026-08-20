import type { ModelPullEvent, RecommendedModelName } from "@knosys-rag/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { describeError } from "@/lib/errors";

export interface UseModelPulls {
  /** Resolves to an error message, or null on success. */
  readonly cancel: (model: RecommendedModelName) => Promise<string | null>;
  readonly pull: (model: RecommendedModelName) => Promise<string | null>;
  /** Latest event per model; terminal events stay until the next pull. */
  readonly pulls: ReadonlyMap<string, ModelPullEvent>;
}

export function useModelPulls(options?: {
  readonly onCompleted?: () => void;
}): UseModelPulls {
  const [pulls, setPulls] = useState<ReadonlyMap<string, ModelPullEvent>>(new Map());
  const onCompleted = useRef(options?.onCompleted);
  onCompleted.current = options?.onCompleted;

  useEffect(
    () =>
      window.knosys.models.onPullEvent((event) => {
        setPulls((current) => {
          const next = new Map(current);
          next.set(event.model, event);
          return next;
        });
        if (event.status === "completed") onCompleted.current?.();
      }),
    [],
  );

  const pull = useCallback(
    async (model: RecommendedModelName): Promise<string | null> => {
      try {
        await window.knosys.models.pull(model);
        return null;
      } catch (error) {
        return describeError(error, "The model download could not be started.");
      }
    },
    [],
  );

  const cancel = useCallback(
    async (model: RecommendedModelName): Promise<string | null> => {
      try {
        await window.knosys.models.cancelPull(model);
        return null;
      } catch (error) {
        return describeError(error, "The model download could not be cancelled.");
      }
    },
    [],
  );

  return { cancel, pull, pulls };
}
