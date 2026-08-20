import type { Transition, Variants } from "motion/react";

/*
 * Shared motion vocabulary so every surface animates with one timing system:
 * quick ease-out entrances for content, faster exits, and a single snappy
 * spring for interactive elements. Module-level constants keep prop identity
 * stable across renders (relevant for memoized components).
 */

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

/** Content entrances: quick fade with a small rise. */
export const contentTransition = {
  duration: 0.18,
  ease: EASE_OUT,
} satisfies Transition;

/** Exits run faster than entrances so departing UI never lingers. */
export const exitTransition = {
  duration: 0.12,
  ease: "easeIn",
} satisfies Transition;

/** Snappy spring for interactive elements (pills, buttons, swatches). */
export const springSnappy = {
  damping: 25,
  stiffness: 400,
  type: "spring",
} satisfies Transition;

/** Fade + 6px rise, used with initial="hidden" animate="visible". */
export const contentFade = {
  hidden: { opacity: 0, y: 6 },
  visible: { opacity: 1, transition: contentTransition, y: 0 },
} satisfies Variants;

/** Orchestrates staggered contentFade children (e.g. empty-state prompts). */
export const staggerContainer = {
  hidden: {},
  visible: { transition: { delayChildren: 0.05, staggerChildren: 0.05 } },
} satisfies Variants;
