import type { AnswerMode } from "@knosys-rag/contracts";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface ModeToggleProps {
  readonly mode: AnswerMode;
  readonly onModeChange: (mode: AnswerMode) => void;
}

const OPTIONS: readonly { readonly label: string; readonly value: AnswerMode }[] = [
  { label: "Hybrid", value: "labeled-hybrid" },
  { label: "Library only", value: "strict-grounded" },
];

export function ModeToggle({ mode, onModeChange }: ModeToggleProps): ReactNode {
  return (
    <fieldset className="flex rounded-lg bg-muted p-0.5">
      <legend className="sr-only">Answer mode</legend>
      {OPTIONS.map((option) => (
        <label
          className={cn(
            "relative cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            mode === option.value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
          key={option.value}
        >
          {mode === option.value ? (
            <motion.span
              aria-hidden="true"
              className="absolute inset-0 rounded-md bg-background shadow-sm"
              layoutId="answer-mode-pill"
              transition={springSnappy}
            />
          ) : null}
          <input
            aria-describedby="answer-mode-help"
            checked={mode === option.value}
            className="sr-only"
            name="answer-mode"
            onChange={() => {
              onModeChange(option.value);
            }}
            type="radio"
            value={option.value}
          />
          <span className="relative">{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
