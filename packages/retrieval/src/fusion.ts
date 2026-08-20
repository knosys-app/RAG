import type {
  RetrievalCandidate,
  RetrievalComponent,
  RetrievalComponentScore,
  RetrievalEvidence,
  RetrievalPoolCandidate,
} from "./types.js";

export const DEFAULT_RRF_K = 60;
export const DEFAULT_CANDIDATE_POOL_SIZE = 100;

export interface RetrievalPools {
  readonly lexical: readonly RetrievalPoolCandidate[];
  readonly vector: readonly RetrievalPoolCandidate[];
}

export interface ReciprocalRankFusionOptions {
  readonly candidatePoolSize?: number;
  readonly k?: number;
  readonly limit?: number;
}

interface MutableCandidate {
  readonly chunkId: string;
  readonly components: RetrievalComponentScore[];
  readonly evidence: RetrievalEvidence;
  score: number;
}

function validatePositiveInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer.`);
  }
}

function validatePoolCandidate(candidate: RetrievalPoolCandidate): void {
  if (candidate.evidence.chunkId.length === 0) {
    throw new TypeError("Retrieval evidence chunkId must not be empty.");
  }
  if (!Number.isFinite(candidate.score)) {
    throw new RangeError("Retrieval candidate scores must be finite.");
  }
}

function compareChunkIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export function reciprocalRankFusion(
  pools: RetrievalPools,
  options: ReciprocalRankFusionOptions = {},
): readonly RetrievalCandidate[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const candidatePoolSize = options.candidatePoolSize ?? DEFAULT_CANDIDATE_POOL_SIZE;
  const limit = options.limit;

  if (!Number.isFinite(k) || k <= 0) {
    throw new RangeError("k must be greater than zero.");
  }
  validatePositiveInteger("candidatePoolSize", candidatePoolSize);
  if (limit !== undefined) validatePositiveInteger("limit", limit);

  const fused = new Map<string, MutableCandidate>();
  const components: readonly [
    RetrievalComponent,
    readonly RetrievalPoolCandidate[],
  ][] = [
    ["lexical", pools.lexical],
    ["vector", pools.vector],
  ];

  for (const [component, pool] of components) {
    const seen = new Set<string>();
    let rank = 0;

    for (const poolCandidate of pool) {
      validatePoolCandidate(poolCandidate);
      const { chunkId } = poolCandidate.evidence;
      if (seen.has(chunkId)) continue;
      seen.add(chunkId);
      rank += 1;
      if (rank > candidatePoolSize) break;

      const reciprocalRankScore = 1 / (k + rank);
      const componentScore: RetrievalComponentScore = {
        component,
        rank,
        reciprocalRankScore,
        score: poolCandidate.score,
      };
      const existing = fused.get(chunkId);
      if (existing) {
        existing.score += reciprocalRankScore;
        existing.components.push(componentScore);
      } else {
        fused.set(chunkId, {
          chunkId,
          components: [componentScore],
          evidence: poolCandidate.evidence,
          score: reciprocalRankScore,
        });
      }
    }
  }

  const candidates = [...fused.values()]
    .sort((left, right) => {
      const scoreOrder = right.score - left.score;
      return scoreOrder !== 0 ? scoreOrder : compareChunkIds(left.chunkId, right.chunkId);
    })
    .map<RetrievalCandidate>((candidate) => ({
      chunkId: candidate.chunkId,
      components: candidate.components,
      evidence: candidate.evidence,
      score: candidate.score,
    }));

  return limit === undefined ? candidates : candidates.slice(0, limit);
}
