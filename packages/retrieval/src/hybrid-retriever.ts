import {
  DEFAULT_CANDIDATE_POOL_SIZE,
  DEFAULT_RRF_K,
  reciprocalRankFusion,
  type RetrievalPools,
} from "./fusion.js";
import {
  RETRIEVAL_TRACE_VERSION,
  type LexicalRetriever,
  type QueryEmbedder,
  type RequestedRetrievalMode,
  type RetrievalPoolCandidate,
  type RetrievalRequest,
  type RetrievalResult,
  type RetrievalStageTrace,
  type RetrievalTrace,
  type VectorRetriever,
} from "./types.js";

export interface HybridRetrieverOptions {
  readonly candidatePoolSize?: number;
  readonly lexicalRetriever: LexicalRetriever;
  readonly now?: () => number;
  readonly queryEmbedder?: QueryEmbedder;
  readonly rrfK?: number;
  readonly vectorRetriever?: VectorRetriever;
}

type UnavailableComponent = "embedding" | "vector";

interface SuccessfulMeasurement<T> {
  readonly durationMs: number;
  readonly ok: true;
  readonly value: T;
}

interface FailedMeasurement {
  readonly durationMs: number;
  readonly error: unknown;
  readonly ok: false;
}

type Measurement<T> = FailedMeasurement | SuccessfulMeasurement<T>;

interface VectorPipelineResult {
  readonly candidates: readonly RetrievalPoolCandidate[] | null;
  readonly embedding: RetrievalStageTrace;
  readonly vector: RetrievalStageTrace;
}

const SKIPPED_STAGE: RetrievalStageTrace = {
  durationMs: 0,
  resultCount: 0,
  status: "skipped",
};

export class RetrievalUnavailableError extends Error {
  public readonly component: UnavailableComponent;

  public constructor(component: UnavailableComponent, message: string) {
    super(message);
    this.name = "RetrievalUnavailableError";
    this.component = component;
  }
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, now() - startedAt);
}

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown retrieval failure.";
}

function failedStage(measurement: FailedMeasurement): RetrievalStageTrace {
  return {
    detail: errorDetail(measurement.error),
    durationMs: measurement.durationMs,
    resultCount: 0,
    status: "failed",
  };
}

export class HybridRetriever {
  readonly #candidatePoolSize: number;
  readonly #lexicalRetriever: LexicalRetriever;
  readonly #now: () => number;
  readonly #queryEmbedder: QueryEmbedder | undefined;
  readonly #rrfK: number;
  readonly #vectorRetriever: VectorRetriever | undefined;

  public constructor(options: HybridRetrieverOptions) {
    this.#candidatePoolSize = options.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE;
    this.#lexicalRetriever = options.lexicalRetriever;
    this.#now = options.now ?? Date.now;
    this.#queryEmbedder = options.queryEmbedder;
    this.#rrfK = options.rrfK ?? DEFAULT_RRF_K;
    this.#vectorRetriever = options.vectorRetriever;

    validatePositiveInteger("candidatePoolSize", this.#candidatePoolSize);
    if (!Number.isFinite(this.#rrfK) || this.#rrfK <= 0) {
      throw new RangeError("rrfK must be greater than zero.");
    }
  }

  public async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
    this.#validateRequest(request);
    const requestedMode = request.mode ?? "hybrid";
    const startedAt = this.#now();

    switch (requestedMode) {
      case "lexical":
        return this.#retrieveLexical(request, startedAt);
      case "vector":
        return this.#retrieveVector(request, startedAt);
      case "hybrid":
        return this.#retrieveHybrid(request, startedAt);
    }
  }

  async #measure<T>(operation: () => Promise<T>): Promise<Measurement<T>> {
    const startedAt = this.#now();
    try {
      const value = await operation();
      return {
        durationMs: elapsed(this.#now, startedAt),
        ok: true,
        value,
      };
    } catch (error) {
      return {
        durationMs: elapsed(this.#now, startedAt),
        error,
        ok: false,
      };
    }
  }

  async #retrieveLexical(
    request: RetrievalRequest,
    startedAt: number,
  ): Promise<RetrievalResult> {
    const lexical = await this.#measure(() =>
      this.#lexicalRetriever.retrieve({
        limit: this.#candidatePoolSize,
        query: request.query,
      }),
    );
    if (!lexical.ok) throw lexical.error;

    return this.#complete({
      embedding: SKIPPED_STAGE,
      lexical: {
        durationMs: lexical.durationMs,
        resultCount: lexical.value.length,
        status: "success",
      },
      mode: "lexical",
      pools: { lexical: lexical.value, vector: [] },
      request,
      requestedMode: "lexical",
      startedAt,
      status: "success",
      vector: SKIPPED_STAGE,
    });
  }

  async #retrieveVector(
    request: RetrievalRequest,
    startedAt: number,
  ): Promise<RetrievalResult> {
    if (!this.#queryEmbedder) {
      throw new RetrievalUnavailableError("embedding", "Query embedding is unavailable.");
    }
    if (!this.#vectorRetriever) {
      throw new RetrievalUnavailableError("vector", "Vector retrieval is unavailable.");
    }

    const pipeline = await this.#runVectorPipeline(request.query);
    if (pipeline.embedding.status === "failed") {
      throw new RetrievalUnavailableError(
        "embedding",
        pipeline.embedding.detail ?? "Query embedding failed.",
      );
    }
    if (pipeline.embedding.status === "unavailable") {
      throw new RetrievalUnavailableError("embedding", "Query embedding is unavailable.");
    }
    if (pipeline.vector.status === "failed") {
      throw new RetrievalUnavailableError(
        "vector",
        pipeline.vector.detail ?? "Vector retrieval failed.",
      );
    }
    if (pipeline.vector.status === "unavailable" || pipeline.candidates === null) {
      throw new RetrievalUnavailableError("vector", "Vector retrieval is unavailable.");
    }

    return this.#complete({
      embedding: pipeline.embedding,
      lexical: SKIPPED_STAGE,
      mode: "vector",
      pools: { lexical: [], vector: pipeline.candidates },
      request,
      requestedMode: "vector",
      startedAt,
      status: "success",
      vector: pipeline.vector,
    });
  }

  async #retrieveHybrid(
    request: RetrievalRequest,
    startedAt: number,
  ): Promise<RetrievalResult> {
    const lexicalPromise = this.#measure(() =>
      this.#lexicalRetriever.retrieve({
        limit: this.#candidatePoolSize,
        query: request.query,
      }),
    );
    const vectorPromise = this.#runVectorPipeline(request.query);
    const [lexical, pipeline] = await Promise.all([lexicalPromise, vectorPromise]);
    if (!lexical.ok) throw lexical.error;

    const fallback = pipeline.candidates === null;
    return this.#complete({
      embedding: pipeline.embedding,
      lexical: {
        durationMs: lexical.durationMs,
        resultCount: lexical.value.length,
        status: "success",
      },
      mode: fallback ? "lexical-fallback" : "hybrid",
      pools: {
        lexical: lexical.value,
        vector: pipeline.candidates ?? [],
      },
      request,
      requestedMode: "hybrid",
      startedAt,
      status: fallback ? "fallback" : "success",
      vector: pipeline.vector,
    });
  }

  async #runVectorPipeline(query: string): Promise<VectorPipelineResult> {
    if (!this.#queryEmbedder) {
      return {
        candidates: null,
        embedding: {
          detail: "Query embedding is unavailable.",
          durationMs: 0,
          resultCount: 0,
          status: "unavailable",
        },
        vector: SKIPPED_STAGE,
      };
    }
    if (!this.#vectorRetriever) {
      return {
        candidates: null,
        embedding: SKIPPED_STAGE,
        vector: {
          detail: "Vector retrieval is unavailable.",
          durationMs: 0,
          resultCount: 0,
          status: "unavailable",
        },
      };
    }

    const embedding = await this.#measure(() => this.#queryEmbedder!.embed(query));
    if (!embedding.ok) {
      return {
        candidates: null,
        embedding: failedStage(embedding),
        vector: SKIPPED_STAGE,
      };
    }
    if (embedding.value === null) {
      return {
        candidates: null,
        embedding: {
          detail: "Query embedding is unavailable.",
          durationMs: embedding.durationMs,
          resultCount: 0,
          status: "unavailable",
        },
        vector: SKIPPED_STAGE,
      };
    }

    const embeddingStage: RetrievalStageTrace = {
      durationMs: embedding.durationMs,
      resultCount: embedding.value.length,
      status: "success",
    };
    const embeddingVector = embedding.value;
    const vector = await this.#measure(() =>
      this.#vectorRetriever!.retrieve({
        embedding: embeddingVector,
        limit: this.#candidatePoolSize,
        query,
      }),
    );
    if (!vector.ok) {
      return {
        candidates: null,
        embedding: embeddingStage,
        vector: failedStage(vector),
      };
    }
    if (vector.value === null) {
      return {
        candidates: null,
        embedding: embeddingStage,
        vector: {
          detail: "Vector retrieval is unavailable.",
          durationMs: vector.durationMs,
          resultCount: 0,
          status: "unavailable",
        },
      };
    }

    return {
      candidates: vector.value,
      embedding: embeddingStage,
      vector: {
        durationMs: vector.durationMs,
        resultCount: vector.value.length,
        status: "success",
      },
    };
  }

  #complete(input: {
    readonly embedding: RetrievalStageTrace;
    readonly lexical: RetrievalStageTrace;
    readonly mode: RetrievalTrace["mode"];
    readonly pools: RetrievalPools;
    readonly request: RetrievalRequest;
    readonly requestedMode: RequestedRetrievalMode;
    readonly startedAt: number;
    readonly status: RetrievalTrace["status"];
    readonly vector: RetrievalStageTrace;
  }): RetrievalResult {
    const fusionStartedAt = this.#now();
    const candidates = reciprocalRankFusion(input.pools, {
      candidatePoolSize: this.#candidatePoolSize,
      k: this.#rrfK,
      limit: input.request.topK,
    });
    const fusion: RetrievalStageTrace = {
      durationMs: elapsed(this.#now, fusionStartedAt),
      resultCount: candidates.length,
      status: "success",
    };

    return {
      candidates,
      trace: {
        candidatePoolSize: this.#candidatePoolSize,
        durationMs: elapsed(this.#now, input.startedAt),
        mode: input.mode,
        requestedMode: input.requestedMode,
        rrfK: this.#rrfK,
        stages: {
          embedding: input.embedding,
          fusion,
          lexical: input.lexical,
          vector: input.vector,
        },
        status: input.status,
        topK: input.request.topK,
        version: RETRIEVAL_TRACE_VERSION,
      },
    };
  }

  #validateRequest(request: RetrievalRequest): void {
    if (typeof request.query !== "string" || request.query.trim().length === 0) {
      throw new TypeError("query must not be empty.");
    }
    validatePositiveInteger("topK", request.topK);
    if (request.topK > this.#candidatePoolSize) {
      throw new RangeError("topK must not exceed candidatePoolSize.");
    }
    if (
      request.mode !== undefined &&
      request.mode !== "hybrid" &&
      request.mode !== "lexical" &&
      request.mode !== "vector"
    ) {
      throw new RangeError("mode must be hybrid, lexical, or vector.");
    }
  }
}
