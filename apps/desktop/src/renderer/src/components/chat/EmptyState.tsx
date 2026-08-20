import { Sparkles } from "lucide-react";
import { motion } from "motion/react";
import type { ReactNode } from "react";

import { contentFade, springSnappy, staggerContainer } from "@/lib/motion";

const STARTER_PROMPTS = [
  "Summarize the key ideas across my library",
  "What do my sources say about this topic?",
  "Compare how two of my sources treat the same subject",
] as const;

export function EmptyState({
  onPickPrompt,
}: {
  readonly onPickPrompt: (prompt: string) => void;
}): ReactNode {
  return (
    <motion.div
      animate="visible"
      className="flex h-full flex-col items-center justify-center gap-5 px-6 text-center"
      initial="hidden"
      variants={staggerContainer}
    >
      <motion.span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
        variants={contentFade}
      >
        <Sparkles size={24} strokeWidth={1.5} />
      </motion.span>
      <motion.div className="space-y-1.5" variants={contentFade}>
        <h2 className="font-display text-xl font-semibold">Ask with your library</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          Hybrid writes one narrative with statement-level sources and labeled model
          knowledge. Library only stays constrained to your indexed sources.
        </p>
      </motion.div>
      <div className="flex flex-col items-stretch gap-2">
        {STARTER_PROMPTS.map((prompt) => (
          <motion.button
            className="rounded-xl border px-4 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            key={prompt}
            onClick={() => {
              onPickPrompt(prompt);
            }}
            type="button"
            variants={contentFade}
            whileTap={{ scale: 0.97, transition: springSnappy }}
          >
            {prompt}
          </motion.button>
        ))}
      </div>
    </motion.div>
  );
}
