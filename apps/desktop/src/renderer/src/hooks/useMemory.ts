import type { MemoryStatus, UserFact } from "@knosys-rag/contracts";
import { useCallback, useState } from "react";

import { describeError } from "@/lib/errors";

export interface UseMemory {
  /** Both mutators resolve to an error message, or null on success. */
  readonly deleteFact: (factId: string) => Promise<string | null>;
  readonly error: string | null;
  readonly facts: readonly UserFact[];
  readonly loading: boolean;
  readonly reload: () => Promise<void>;
  readonly status: MemoryStatus | null;
  readonly updateFact: (factId: string, fact: string) => Promise<string | null>;
}

export function useMemory(): UseMemory {
  const [facts, setFacts] = useState<readonly UserFact[]>([]);
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const [nextFacts, nextStatus] = await Promise.all([
        window.knosys.memory.listFacts(),
        window.knosys.memory.getStatus(),
      ]);
      setFacts(nextFacts);
      setStatus(nextStatus);
      setError(null);
    } catch (caught) {
      setError(describeError(caught, "Memory could not be loaded."));
    } finally {
      setLoading(false);
    }
  }, []);

  const updateFact = useCallback(
    async (factId: string, fact: string): Promise<string | null> => {
      try {
        const updated = await window.knosys.memory.updateFact(factId, fact);
        setFacts((current) =>
          current.map((candidate) => (candidate.id === factId ? updated : candidate)),
        );
        return null;
      } catch (caught) {
        return describeError(caught, "The memory could not be updated.");
      }
    },
    [],
  );

  const deleteFact = useCallback(async (factId: string): Promise<string | null> => {
    try {
      await window.knosys.memory.deleteFact(factId);
      setFacts((current) => current.filter((candidate) => candidate.id !== factId));
      setStatus((current) =>
        current === null
          ? null
          : { ...current, factCount: Math.max(0, current.factCount - 1) },
      );
      return null;
    } catch (caught) {
      return describeError(caught, "The memory could not be deleted.");
    }
  }, []);

  return { deleteFact, error, facts, loading, reload, status, updateFact };
}
