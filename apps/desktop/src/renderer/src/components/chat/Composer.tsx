import type { AnswerMode } from "@knosys-rag/contracts";
import { ArrowUp, CircleStop } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode, RefObject } from "react";

import { ModeToggle } from "@/components/chat/ModeToggle";

interface ComposerProps {
  readonly busy: boolean;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
  readonly draft: string;
  readonly generationReady: boolean;
  readonly mode: AnswerMode;
  readonly modelPicker: ReactNode;
  readonly onDraftChange: (draft: string) => void;
  readonly onModeChange: (mode: AnswerMode) => void;
  readonly onSend: () => void;
  readonly onStop: () => void;
  readonly sourceCount: number;
}

export function Composer({
  busy,
  composerRef,
  draft,
  generationReady,
  mode,
  modelPicker,
  onDraftChange,
  onModeChange,
  onSend,
  onStop,
  sourceCount,
}: ComposerProps): ReactNode {
  const sourceRequired = mode === "strict-grounded";
  const sourceRequirementMet = !sourceRequired || sourceCount > 0;
  const canSend = sourceRequirementMet && generationReady && !busy;

  const placeholder = !generationReady
    ? "Start Ollama and install a compatible generation model"
    : sourceRequired && sourceCount === 0
      ? "Import a source to use Library only"
      : mode === "labeled-hybrid" && sourceCount === 0
        ? "Ask a question; model knowledge will be labeled inline"
        : mode === "labeled-hybrid"
          ? "Ask a question to compare library and model knowledge"
          : "Ask a specific question about your sources";

  const helpText = !generationReady
    ? "History remains available while local generation is offline."
    : sourceRequired && sourceCount === 0
      ? "Library only requires at least one indexed source."
      : mode === "labeled-hybrid" && sourceCount === 0
        ? "No library sources yet. Hybrid can use model knowledge labeled inline."
        : mode === "labeled-hybrid"
          ? "Hybrid combines library and model knowledge with statement-level provenance."
          : "Library only answers from indexed sources.";

  return (
    <form
      className="mx-auto w-full max-w-3xl px-4 pb-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSend();
      }}
    >
      <div className="rounded-2xl border bg-card shadow-sm transition-colors focus-within:border-ring">
        <label className="sr-only" htmlFor="chat-question">
          Question
        </label>
        <textarea
          className="max-h-52 w-full resize-none bg-transparent px-4 pt-3.5 pb-1 text-[0.9375rem] leading-relaxed outline-none placeholder:text-muted-foreground disabled:opacity-60"
          disabled={!generationReady || !sourceRequirementMet}
          id="chat-question"
          maxLength={4000}
          onChange={(event) => {
            onDraftChange(event.target.value);
            const element = event.currentTarget;
            element.style.height = "auto";
            element.style.height = `${Math.min(element.scrollHeight, 208)}px`;
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (event.nativeEvent.isComposing || event.shiftKey) return;
            event.preventDefault();
            onSend();
          }}
          placeholder={placeholder}
          ref={composerRef}
          rows={2}
          value={draft}
        />
        <div className="flex items-center justify-between gap-2 px-2.5 pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <ModeToggle mode={mode} onModeChange={onModeChange} />
            {modelPicker}
          </div>
          <AnimatePresence initial={false} mode="wait">
            {busy ? (
              <motion.button
                animate={{ opacity: 1, scale: 1 }}
                aria-label="Stop generating answer"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground transition-colors hover:bg-destructive hover:text-destructive-foreground"
                exit={{ opacity: 0, scale: 0.8 }}
                initial={{ opacity: 0, scale: 0.8 }}
                key="stop"
                onClick={onStop}
                transition={{ duration: 0.1, ease: "easeOut" }}
                type="button"
                whileTap={{ scale: 0.92 }}
              >
                <CircleStop size={17} />
              </motion.button>
            ) : (
              <motion.button
                animate={{ opacity: 1, scale: 1 }}
                aria-label="Send question"
                className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-colors disabled:opacity-40"
                disabled={!canSend || !draft.trim()}
                exit={{ opacity: 0, scale: 0.8 }}
                initial={{ opacity: 0, scale: 0.8 }}
                key="send"
                transition={{ duration: 0.1, ease: "easeOut" }}
                type="submit"
                whileTap={{ scale: 0.92 }}
              >
                <ArrowUp size={17} />
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
      <p className="mt-1.5 px-1 text-xs text-muted-foreground" id="answer-mode-help">
        {helpText}
      </p>
    </form>
  );
}
