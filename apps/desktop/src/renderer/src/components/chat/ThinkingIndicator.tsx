import type { ChatProgressStatus } from "@knosys-rag/contracts";
import { LoaderCircle } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";

import { progressLabel } from "@/lib/chat-labels";

export function ThinkingIndicator({
  status,
}: {
  readonly status: ChatProgressStatus;
}): ReactNode {
  const label = progressLabel(status);
  return (
    <p className="flex items-center gap-2 text-sm text-muted-foreground">
      <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -3 }}
          initial={{ opacity: 0, y: 3 }}
          key={label}
          transition={{ duration: 0.12, ease: "easeOut" }}
        >
          {label}
        </motion.span>
      </AnimatePresence>
    </p>
  );
}
