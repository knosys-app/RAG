import type { ChatCitation, SourceBlock } from "@knosys-rag/contracts";
import { useCallback, useRef, useState } from "react";

import { describeError } from "@/lib/errors";

export type EvidenceState =
  | { readonly state: "idle" }
  | { readonly state: "loading" }
  | {
      readonly state: "ready";
      readonly citation: ChatCitation;
      readonly blocks: readonly SourceBlock[];
    }
  | { readonly state: "error"; readonly message: string };

export interface UseEvidence {
  readonly close: () => void;
  readonly evidence: EvidenceState;
  readonly inspect: (citationId: string) => Promise<void>;
  readonly open: boolean;
}

export function useEvidence(): UseEvidence {
  const [evidence, setEvidence] = useState<EvidenceState>({ state: "idle" });
  const request = useRef(0);

  const inspect = useCallback(async (citationId: string) => {
    const requestId = request.current + 1;
    request.current = requestId;
    setEvidence({ state: "loading" });
    try {
      const citation = await window.knosys.evidence.get(citationId);
      const blocks = await window.knosys.source.getWindow(citation.chunkId, 2, 2);
      if (request.current === requestId) {
        setEvidence({ blocks, citation, state: "ready" });
      }
    } catch (error) {
      if (request.current === requestId) {
        setEvidence({
          message: describeError(error, "The evidence could not be opened."),
          state: "error",
        });
      }
    }
  }, []);

  const close = useCallback(() => {
    request.current += 1;
    setEvidence({ state: "idle" });
  }, []);

  return { close, evidence, inspect, open: evidence.state !== "idle" };
}
