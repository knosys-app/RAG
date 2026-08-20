import type { GroundingEvidence } from "@knosys-rag/inference";
import type { RetrievalResult, SourceLocator } from "@knosys-rag/retrieval";

import { AnsweringError } from "./errors.js";
import type { AnswerContextLimits, CitationSnapshot } from "./types.js";

export const DEFAULT_ANSWER_CONTEXT_LIMITS: AnswerContextLimits = Object.freeze({
  maxCharacters: 64_000,
  maxItems: 32,
});

const MAX_PRECEDING_CONTEXT_CHARACTERS = 4_000;

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new AnsweringError("INVALID_REQUEST", `${name} must be a positive integer.`);
  }
  return value;
}

function resolveLimits(limits?: Partial<AnswerContextLimits>): AnswerContextLimits {
  return {
    maxCharacters: positiveInteger(
      limits?.maxCharacters ?? DEFAULT_ANSWER_CONTEXT_LIMITS.maxCharacters,
      "maxCharacters",
    ),
    maxItems: positiveInteger(
      limits?.maxItems ?? DEFAULT_ANSWER_CONTEXT_LIMITS.maxItems,
      "maxItems",
    ),
  };
}

function copySource(source: SourceLocator): SourceLocator {
  const range = source.range;
  return {
    ...source,
    ...(range === undefined
      ? {}
      : {
          range: {
            ...range,
            ...(range.headingPath === undefined
              ? {}
              : { headingPath: [...range.headingPath] }),
          },
        }),
  };
}

export function selectAnswerContext(
  retrievalResult: RetrievalResult,
  limits?: Partial<AnswerContextLimits>,
): readonly CitationSnapshot[] {
  const resolved = resolveLimits(limits);
  const selected: CitationSnapshot[] = [];
  let remainingCharacters = resolved.maxCharacters;

  for (const candidate of retrievalResult.candidates) {
    if (selected.length === resolved.maxItems || remainingCharacters === 0) break;
    if (candidate.evidence.text.length === 0) continue;

    const text = candidate.evidence.text.slice(0, remainingCharacters);
    const rawPrecedingContext = candidate.evidence.metadata?.precedingContext;
    const precedingContext =
      typeof rawPrecedingContext === "string"
        ? rawPrecedingContext.slice(-MAX_PRECEDING_CONTEXT_CHARACTERS)
        : "";
    const contextLabel = "Preceding source context (for structure only):\n";
    const evidenceLabel = "\n\nRetrieved evidence:\n";
    const availablePrefixCharacters = Math.max(
      0,
      remainingCharacters - text.length - contextLabel.length - evidenceLabel.length,
    );
    const boundedPrefix = precedingContext.slice(-availablePrefixCharacters);
    const groundingText = boundedPrefix
      ? `${contextLabel}${boundedPrefix}${evidenceLabel}${text}`
      : text;
    selected.push({
      chunkId: candidate.chunkId,
      components: candidate.components.map((component) => ({ ...component })),
      id: `E${selected.length + 1}`,
      score: candidate.score,
      source: copySource(candidate.evidence.source),
      text: groundingText,
    });
    remainingCharacters -= groundingText.length;
  }

  return selected;
}

export function toGroundingEvidence(
  context: readonly CitationSnapshot[],
): readonly GroundingEvidence[] {
  return context.map((item) => ({
    content: item.text,
    id: item.id,
    ...(item.source.sourceName === undefined ? {} : { title: item.source.sourceName }),
  }));
}
