import type {
  EmbeddingModelProfile,
  GenerationModelProfile,
} from "./types.js";

export const QUERY_EMBEDDING_INSTRUCTION_VERSION =
  "qwen3-embedding-query-v1" as const;

export const CLOSED_BOOK_ANSWER_PROMPT_VERSION =
  "closed-book-answer-v1" as const;
export const CLAIM_RECONCILIATION_PROMPT_VERSION =
  "claim-reconciliation-v1" as const;
export const EVIDENCE_FIRST_ANSWER_PROMPT_VERSION =
  "evidence-first-answer-v2" as const;
export const EVIDENCE_FIRST_VERIFICATION_PROMPT_VERSION =
  "evidence-first-verification-v2" as const;
export const MEMORY_SUMMARY_PROMPT_VERSION =
  "thread-memory-summary-v1" as const;
export const HYBRID_SYNTHESIS_PROMPT_VERSION = "hybrid-synthesis-v5" as const;
export const HYBRID_SYNTHESIS_VERIFICATION_PROMPT_VERSION =
  "hybrid-synthesis-verification-v3" as const;

export const QUERY_EMBEDDING_INSTRUCTION =
  "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ";

export const DEFAULT_EMBEDDING_PROFILE: EmbeddingModelProfile = Object.freeze({
  dimensions: 1_024,
  l2NormTolerance: 0.01,
  model: "qwen3-embedding:0.6b",
});

export const UNCONFIGURED_GENERATION_PROFILE: GenerationModelProfile = Object.freeze({
  contextWindow: 32_768,
  model: "unconfigured",
  temperature: 0.1,
});

export function formatEmbeddingQuery(query: string): string {
  return `${QUERY_EMBEDDING_INSTRUCTION}${query}`;
}
