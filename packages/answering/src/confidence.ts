import type { RetrievalResult } from "@knosys-rag/retrieval";

import type { CitationSnapshot } from "./types.js";

export const EVIDENCE_CONFIDENCE_POLICY_VERSION = "hybrid-answerability-v1" as const;
export const EVIDENCE_CONFIDENCE_VERSION = 1 as const;

const REFERENCE_EMBEDDING_DIGEST =
  "ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d";

const STOP_WORDS = new Set([
  "according",
  "and",
  "are",
  "at",
  "be",
  "does",
  "exact",
  "fictional",
  "for",
  "from",
  "give",
  "how",
  "imported",
  "in",
  "is",
  "it",
  "of",
  "please",
  "should",
  "source",
  "sources",
  "state",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
]);

export type EvidenceConfidenceLabel = "insufficient" | "sufficient" | "uncertain";

export type EvidenceConfidenceReason =
  | "calibration-mismatch"
  | "context-truncated"
  | "empty-context"
  | "high-reference-confidence"
  | "incomplete-embedding-coverage"
  | "low-reference-confidence"
  | "retrieval-degraded"
  | "wide-uncertain-band";

export interface EvidenceConfidenceEnvironment {
  readonly documentEmbeddingInputVersion: string;
  readonly embeddingCoverage: number | null;
  readonly embeddingDigest: string | null;
  readonly embeddingModel: string | null;
  readonly questionContextualizationVersion: string | null;
  readonly queryEmbeddingInstructionVersion: string;
}

export interface EvidenceConfidenceSignals {
  readonly contextTruncated: boolean;
  readonly lexicalResultCount: number;
  readonly queryTokenCoverage: number;
  readonly topCandidateInBothPools: boolean;
  readonly topVectorMargin: number | null;
  readonly topVectorScore: number | null;
  readonly vectorResultCount: number;
}

export interface EvidenceConfidenceAssessment {
  readonly calibrationId: string | null;
  readonly fingerprint: string;
  readonly label: EvidenceConfidenceLabel;
  readonly policyVersion: typeof EVIDENCE_CONFIDENCE_POLICY_VERSION;
  readonly reasons: readonly EvidenceConfidenceReason[];
  readonly signals: EvidenceConfidenceSignals;
  readonly version: typeof EVIDENCE_CONFIDENCE_VERSION;
}

interface ReferenceCalibration {
  readonly calibrationId: string;
  readonly candidatePoolSize: number;
  readonly documentEmbeddingInputVersion: string;
  readonly embeddingDigest: string;
  readonly embeddingModel: string;
  readonly insufficientMaxVectorScore: number;
  readonly queryEmbeddingInstructionVersion: string;
  readonly rrfK: number;
  readonly sufficientMinQueryCoverage: number;
  readonly sufficientMinVectorMargin: number;
  readonly sufficientMinVectorScore: number;
  readonly topK: number;
}

const REFERENCE_CALIBRATION: ReferenceCalibration = Object.freeze({
  calibrationId: "qwen3-embedding-0.6b-grounding-live-v1",
  candidatePoolSize: 100,
  documentEmbeddingInputVersion: "chunk-content-v1",
  embeddingDigest: REFERENCE_EMBEDDING_DIGEST,
  embeddingModel: "qwen3-embedding:0.6b",
  insufficientMaxVectorScore: 0.4,
  queryEmbeddingInstructionVersion: "qwen3-embedding-query-v1",
  rrfK: 60,
  sufficientMinQueryCoverage: 0.55,
  sufficientMinVectorMargin: 0.15,
  sufficientMinVectorScore: 0.65,
  topK: 12,
});

function normalizedDigest(value: string | null): string | null {
  return value?.replace(/^sha256:/i, "").toLocaleLowerCase("en-US") ?? null;
}

function tokens(value: string): readonly string[] {
  const matches = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu);
  return [
    ...new Set(
      (matches ?? []).filter((token) => token.length >= 3 && !STOP_WORDS.has(token)),
    ),
  ];
}

function fingerprint(
  retrieval: RetrievalResult,
  environment: EvidenceConfidenceEnvironment,
): string {
  return [
    EVIDENCE_CONFIDENCE_POLICY_VERSION,
    environment.embeddingModel ?? "none",
    normalizedDigest(environment.embeddingDigest) ?? "none",
    environment.documentEmbeddingInputVersion,
    environment.queryEmbeddingInstructionVersion,
    `trace-${retrieval.trace.version}`,
    `pool-${retrieval.trace.candidatePoolSize}`,
    `rrf-${retrieval.trace.rrfK}`,
    `top-${retrieval.trace.topK}`,
    ...(environment.questionContextualizationVersion === null
      ? []
      : [`context-${environment.questionContextualizationVersion}`]),
  ].join(":");
}

function matchesReferenceCalibration(
  retrieval: RetrievalResult,
  environment: EvidenceConfidenceEnvironment,
): boolean {
  return (
    environment.embeddingModel === REFERENCE_CALIBRATION.embeddingModel &&
    normalizedDigest(environment.embeddingDigest) ===
      REFERENCE_CALIBRATION.embeddingDigest &&
    environment.documentEmbeddingInputVersion ===
      REFERENCE_CALIBRATION.documentEmbeddingInputVersion &&
    environment.queryEmbeddingInstructionVersion ===
      REFERENCE_CALIBRATION.queryEmbeddingInstructionVersion &&
    // A multi-turn follow-up is retrieved from a rewritten standalone question;
    // its retrieval signals are still valid, so calibrate on them rather than
    // forcing every contextualized turn onto the uncertain route.
    retrieval.trace.version === 1 &&
    retrieval.trace.candidatePoolSize === REFERENCE_CALIBRATION.candidatePoolSize &&
    retrieval.trace.rrfK === REFERENCE_CALIBRATION.rrfK &&
    retrieval.trace.topK === REFERENCE_CALIBRATION.topK
  );
}

function confidenceSignals(
  question: string,
  retrieval: RetrievalResult,
  context: readonly CitationSnapshot[],
): EvidenceConfidenceSignals {
  const vectorCandidates = retrieval.candidates
    .flatMap((candidate) => {
      const vector = candidate.components.find((component) => component.component === "vector");
      return vector === undefined ? [] : [{ candidate, score: vector.score }];
    })
    .sort((left, right) => right.score - left.score);
  const top = vectorCandidates[0];
  const second = vectorCandidates[1];
  const topContext =
    top === undefined
      ? undefined
      : context.find((item) => item.chunkId === top.candidate.chunkId);
  const queryTokens = tokens(question);
  const evidenceTokens = new Set(
    tokens(
      topContext === undefined
        ? ""
        : `${topContext.source.sourceName ?? ""} ${topContext.text}`,
    ),
  );
  const coveredTokens = queryTokens.filter((token) => evidenceTokens.has(token)).length;
  const contextTruncated = context.some((item) => {
    const candidate = retrieval.candidates.find(
      (retrieved) => retrieved.chunkId === item.chunkId,
    );
    return candidate !== undefined && item.text.length < candidate.evidence.text.length;
  });

  return {
    contextTruncated,
    lexicalResultCount: retrieval.trace.stages.lexical.resultCount,
    queryTokenCoverage:
      queryTokens.length === 0 ? 0 : coveredTokens / queryTokens.length,
    topCandidateInBothPools:
      top?.candidate.components.some((component) => component.component === "lexical") ??
      false,
    topVectorMargin:
      top === undefined || second === undefined ? null : top.score - second.score,
    topVectorScore: top?.score ?? null,
    vectorResultCount: retrieval.trace.stages.vector.resultCount,
  };
}

export function assessEvidenceConfidence(
  question: string,
  retrieval: RetrievalResult,
  context: readonly CitationSnapshot[],
  environment: EvidenceConfidenceEnvironment,
): EvidenceConfidenceAssessment {
  const signals = confidenceSignals(question, retrieval, context);
  const base = {
    fingerprint: fingerprint(retrieval, environment),
    policyVersion: EVIDENCE_CONFIDENCE_POLICY_VERSION,
    signals,
    version: EVIDENCE_CONFIDENCE_VERSION,
  } as const;

  if (context.length === 0) {
    return {
      ...base,
      calibrationId: null,
      label: "insufficient",
      reasons: ["empty-context"],
    };
  }
  if (!matchesReferenceCalibration(retrieval, environment)) {
    return {
      ...base,
      calibrationId: null,
      label: "uncertain",
      reasons: ["calibration-mismatch"],
    };
  }
  const calibrationId = REFERENCE_CALIBRATION.calibrationId;
  if (environment.embeddingCoverage !== 1) {
    return {
      ...base,
      calibrationId,
      label: "uncertain",
      reasons: ["incomplete-embedding-coverage"],
    };
  }
  if (
    retrieval.trace.status !== "success" ||
    retrieval.trace.stages.embedding.status !== "success" ||
    retrieval.trace.stages.vector.status !== "success"
  ) {
    return {
      ...base,
      calibrationId,
      label: "uncertain",
      reasons: ["retrieval-degraded"],
    };
  }
  if (signals.contextTruncated) {
    return {
      ...base,
      calibrationId,
      label: "uncertain",
      reasons: ["context-truncated"],
    };
  }
  if (
    signals.lexicalResultCount === 0 &&
    signals.topVectorScore !== null &&
    signals.topVectorScore < REFERENCE_CALIBRATION.insufficientMaxVectorScore
  ) {
    return {
      ...base,
      calibrationId,
      label: "insufficient",
      reasons: ["low-reference-confidence"],
    };
  }
  if (
    signals.topVectorScore !== null &&
    signals.topVectorScore >= REFERENCE_CALIBRATION.sufficientMinVectorScore &&
    signals.topVectorMargin !== null &&
    signals.topVectorMargin >= REFERENCE_CALIBRATION.sufficientMinVectorMargin &&
    signals.queryTokenCoverage >= REFERENCE_CALIBRATION.sufficientMinQueryCoverage
  ) {
    return {
      ...base,
      calibrationId,
      label: "sufficient",
      reasons: ["high-reference-confidence"],
    };
  }
  return {
    ...base,
    calibrationId,
    label: "uncertain",
    reasons: ["wide-uncertain-band"],
  };
}
