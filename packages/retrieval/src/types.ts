export const RETRIEVAL_TRACE_VERSION = 1 as const;

export type RetrievalTraceVersion = typeof RETRIEVAL_TRACE_VERSION;
export type RetrievalMode = "hybrid" | "lexical" | "vector" | "lexical-fallback";
export type RequestedRetrievalMode = Exclude<RetrievalMode, "lexical-fallback">;
export type RetrievalComponent = "lexical" | "vector";

export interface SourceRange {
  readonly endOffset?: number;
  readonly endPageNumber?: number;
  readonly fragment?: string;
  readonly headingPath?: readonly string[];
  readonly pageNumber?: number;
  readonly startOffset?: number;
}

export interface SourceLocator {
  readonly documentId: string;
  readonly sourceId: string;
  readonly sourceName?: string;
  readonly uri?: string;
  readonly range?: SourceRange;
}

export interface RetrievalEvidence {
  readonly chunkId: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly source: SourceLocator;
  readonly text: string;
}

export interface RetrievalPoolCandidate {
  readonly evidence: RetrievalEvidence;
  readonly score: number;
}

export interface RetrievalComponentScore {
  readonly component: RetrievalComponent;
  readonly rank: number;
  readonly reciprocalRankScore: number;
  readonly score: number;
}

export interface RetrievalCandidate {
  readonly chunkId: string;
  readonly components: readonly RetrievalComponentScore[];
  readonly evidence: RetrievalEvidence;
  readonly score: number;
}

export interface LexicalRetrievalRequest {
  readonly limit: number;
  readonly query: string;
}

export interface VectorRetrievalRequest extends LexicalRetrievalRequest {
  readonly embedding: readonly number[];
}

export interface LexicalRetriever {
  retrieve(request: LexicalRetrievalRequest): Promise<readonly RetrievalPoolCandidate[]>;
}

export interface VectorRetriever {
  retrieve(
    request: VectorRetrievalRequest,
  ): Promise<readonly RetrievalPoolCandidate[] | null>;
}

export interface QueryEmbedder {
  embed(query: string): Promise<readonly number[] | null>;
}

export interface RetrievalRequest {
  readonly mode?: RequestedRetrievalMode;
  readonly query: string;
  readonly topK: number;
}

export type RetrievalStageStatus = "failed" | "skipped" | "success" | "unavailable";

export interface RetrievalStageTrace {
  readonly detail?: string;
  readonly durationMs: number;
  readonly resultCount: number;
  readonly status: RetrievalStageStatus;
}

export interface RetrievalTrace {
  readonly candidatePoolSize: number;
  readonly durationMs: number;
  readonly mode: RetrievalMode;
  readonly requestedMode: RequestedRetrievalMode;
  readonly rrfK: number;
  readonly stages: {
    readonly embedding: RetrievalStageTrace;
    readonly fusion: RetrievalStageTrace;
    readonly lexical: RetrievalStageTrace;
    readonly vector: RetrievalStageTrace;
  };
  readonly status: "fallback" | "success";
  readonly topK: number;
  readonly version: RetrievalTraceVersion;
}

export interface RetrievalResult {
  readonly candidates: readonly RetrievalCandidate[];
  readonly trace: RetrievalTrace;
}
