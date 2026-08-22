import type { UserFact } from "@knosys-rag/contracts";
import { Check, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMemory } from "@/hooks/useMemory";
import { describeMemoryStatus, USER_FACT_CATEGORY_LABELS } from "@/lib/memory-labels";

function FactRow({
  fact,
  onDelete,
  onUpdate,
}: {
  readonly fact: UserFact;
  readonly onDelete: () => Promise<string | null>;
  readonly onUpdate: (text: string) => Promise<string | null>;
}): ReactNode {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fact.fact);
  const [rowError, setRowError] = useState<string | null>(null);

  const commit = (): void => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed.length === 0 || trimmed === fact.fact) {
      setDraft(fact.fact);
      return;
    }
    void onUpdate(trimmed).then((error) => {
      setRowError(error);
      if (error !== null) setDraft(fact.fact);
    });
  };

  return (
    <li className="rounded-lg border p-2.5">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.65rem] font-medium text-muted-foreground">
          {USER_FACT_CATEGORY_LABELS[fact.category]}
        </span>
        {editing ? (
          <div className="flex flex-1 items-center gap-1.5">
            <Input
              aria-label={`Edit memory: ${fact.fact}`}
              autoFocus
              className="h-8 flex-1"
              maxLength={512}
              onChange={(event) => {
                setDraft(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                }
                if (event.key === "Escape") {
                  setDraft(fact.fact);
                  setEditing(false);
                }
              }}
              value={draft}
            />
            <Button aria-label="Save memory" onClick={commit} size="icon" variant="ghost">
              <Check size={14} />
            </Button>
            <Button
              aria-label="Cancel editing"
              onClick={() => {
                setDraft(fact.fact);
                setEditing(false);
              }}
              size="icon"
              variant="ghost"
            >
              <X size={14} />
            </Button>
          </div>
        ) : (
          <>
            <p className="flex-1 text-sm leading-snug">{fact.fact}</p>
            <Button
              aria-label={`Edit memory: ${fact.fact}`}
              onClick={() => {
                setRowError(null);
                setDraft(fact.fact);
                setEditing(true);
              }}
              size="icon"
              variant="ghost"
            >
              <Pencil size={13} />
            </Button>
            <Button
              aria-label={`Forget memory: ${fact.fact}`}
              onClick={() => {
                void onDelete().then(setRowError);
              }}
              size="icon"
              variant="ghost"
            >
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>
      {rowError !== null ? (
        <p className="mt-1.5 text-xs text-destructive" role="alert">
          {rowError}
        </p>
      ) : null}
    </li>
  );
}

export function MemoryPanel(): ReactNode {
  const memory = useMemory();
  const { reload } = memory;

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Memory
        </h3>
        <p className="text-sm text-muted-foreground">
          Knosys remembers your conversations locally: finished chats are
          summarized in the background so later questions can refer back to
          them, and facts you share about yourself are kept here. Nothing
          leaves this Mac.
        </p>
        {memory.status !== null ? (
          <p className="text-xs text-muted-foreground">
            {describeMemoryStatus(memory.status)}
          </p>
        ) : null}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Things Knosys knows about you
        </h3>
        {memory.error !== null ? (
          <p className="text-sm text-destructive" role="alert">
            {memory.error}
          </p>
        ) : null}
        {memory.loading ? (
          <div
            className="flex items-center gap-2 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
            Loading memories
          </div>
        ) : memory.facts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing saved yet — facts you share in chats, like preferences or
            ongoing projects, will appear here. A deleted memory is never
            re-learned.
          </p>
        ) : (
          <ul aria-label="Saved memories" className="space-y-2">
            {memory.facts.map((fact) => (
              <FactRow
                fact={fact}
                key={fact.id}
                onDelete={() => memory.deleteFact(fact.id)}
                onUpdate={(text) => memory.updateFact(fact.id, text)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
