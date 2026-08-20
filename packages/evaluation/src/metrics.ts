import { z } from "zod";

import {
  evidenceKey,
  evaluationCaseSetSchema,
  evaluationRunSchema,
  type Evidence,
} from "./schemas.js";

export interface RetrievalMetrics {
  readonly hitAtK: number;
  readonly mrr: number;
  readonly ndcg: number;
  readonly precisionAtK: number;
  readonly recallAtK: number;
}

export interface CitationMetrics {
  readonly coverage: number;
  readonly validity: number;
}

export interface AbstentionClassification {
  readonly abstained: boolean;
  readonly shouldAbstain: boolean;
}

export interface AnswerAbstentionMetrics {
  readonly f1: number;
  readonly falseNegative: number;
  readonly falsePositive: number;
  readonly precision: number;
  readonly recall: number;
  readonly trueNegative: number;
  readonly truePositive: number;
}

export const evaluationScoreNames = [
  "hitAtK",
  "recallAtK",
  "precisionAtK",
  "mrr",
  "ndcg",
  "citationValidity",
  "citationCoverage",
  "abstentionPrecision",
  "abstentionRecall",
  "abstentionF1",
] as const;

export const evaluationScoreNameSchema = z.enum(evaluationScoreNames);
const unitScoreSchema = z.number().min(0).max(1);

export const evaluationScoresSchema = z
  .object({
    abstentionF1: unitScoreSchema,
    abstentionPrecision: unitScoreSchema,
    abstentionRecall: unitScoreSchema,
    citationCoverage: unitScoreSchema,
    citationValidity: unitScoreSchema,
    hitAtK: unitScoreSchema,
    mrr: unitScoreSchema,
    ndcg: unitScoreSchema,
    precisionAtK: unitScoreSchema,
    recallAtK: unitScoreSchema,
  })
  .strict();

export const answerAbstentionMetricsSchema = z
  .object({
    f1: unitScoreSchema,
    falseNegative: z.number().int().nonnegative(),
    falsePositive: z.number().int().nonnegative(),
    precision: unitScoreSchema,
    recall: unitScoreSchema,
    trueNegative: z.number().int().nonnegative(),
    truePositive: z.number().int().nonnegative(),
  })
  .strict();

export const evaluationSummarySchema = z
  .object({
    abstention: answerAbstentionMetricsSchema,
    answerableCaseCount: z.number().int().nonnegative(),
    caseCount: z.number().int().positive(),
    caseSetId: z.string().min(1),
    corpusId: z.string().min(1),
    k: z.number().int().positive(),
    schemaVersion: z.literal(1),
    scores: evaluationScoresSchema,
  })
  .strict();

export type EvaluationScoreName = (typeof evaluationScoreNames)[number];
export type EvaluationScores = z.infer<typeof evaluationScoresSchema>;
export type EvaluationSummary = z.infer<typeof evaluationSummarySchema>;

function divide(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function uniqueRelevantRanks(
  retrieved: readonly Evidence[],
  relevantKeys: ReadonlySet<string>,
): readonly number[] {
  const seen = new Set<string>();
  const ranks: number[] = [];
  for (const [index, evidence] of retrieved.entries()) {
    const key = evidenceKey(evidence);
    if (relevantKeys.has(key) && !seen.has(key)) ranks.push(index + 1);
    seen.add(key);
  }
  return ranks;
}

export function retrievalMetricsAtK(
  retrieved: readonly Evidence[],
  relevant: readonly Evidence[],
  k: number,
): RetrievalMetrics {
  if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer.");
  const relevantKeys = new Set(relevant.map(evidenceKey));
  if (relevantKeys.size === 0) {
    throw new Error("Retrieval metrics require at least one relevant evidence item.");
  }

  const ranks = uniqueRelevantRanks(retrieved, relevantKeys);
  const ranksAtK = ranks.filter((rank) => rank <= k);
  const discountedGain = ranksAtK.reduce(
    (total, rank) => total + 1 / Math.log2(rank + 1),
    0,
  );
  const idealCount = Math.min(relevantKeys.size, k);
  let idealDiscountedGain = 0;
  for (let rank = 1; rank <= idealCount; rank += 1) {
    idealDiscountedGain += 1 / Math.log2(rank + 1);
  }

  return {
    hitAtK: ranksAtK.length > 0 ? 1 : 0,
    mrr: ranks.length > 0 ? 1 / ranks[0]! : 0,
    ndcg: divide(discountedGain, idealDiscountedGain),
    precisionAtK: ranksAtK.length / k,
    recallAtK: ranksAtK.length / relevantKeys.size,
  };
}

export function citationMetrics(
  citations: readonly Evidence[],
  relevant: readonly Evidence[],
): CitationMetrics {
  const relevantKeys = new Set(relevant.map(evidenceKey));
  const validCitations = citations.filter((citation) =>
    relevantKeys.has(evidenceKey(citation)),
  );
  const coveredEvidence = new Set(validCitations.map(evidenceKey));

  return {
    coverage:
      relevantKeys.size === 0 ? 1 : coveredEvidence.size / relevantKeys.size,
    validity:
      citations.length === 0
        ? relevantKeys.size === 0
          ? 1
          : 0
        : validCitations.length / citations.length,
  };
}

export function answerAbstentionMetrics(
  classifications: readonly AbstentionClassification[],
): AnswerAbstentionMetrics {
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  let trueNegative = 0;
  for (const classification of classifications) {
    if (classification.shouldAbstain && classification.abstained) truePositive += 1;
    if (!classification.shouldAbstain && classification.abstained) falsePositive += 1;
    if (classification.shouldAbstain && !classification.abstained) falseNegative += 1;
    if (!classification.shouldAbstain && !classification.abstained) trueNegative += 1;
  }

  const precision = divide(truePositive, truePositive + falsePositive);
  const recall = divide(truePositive, truePositive + falseNegative);
  return {
    f1: divide(2 * precision * recall, precision + recall),
    falseNegative,
    falsePositive,
    precision,
    recall,
    trueNegative,
    truePositive,
  };
}

export function evaluateRun(
  caseSetInput: unknown,
  runInput: unknown,
  k: number,
): EvaluationSummary {
  if (!Number.isInteger(k) || k < 1) throw new Error("k must be a positive integer.");
  const caseSet = evaluationCaseSetSchema.parse(caseSetInput);
  const run = evaluationRunSchema.parse(runInput);
  if (caseSet.corpusId !== run.corpusId || caseSet.caseSetId !== run.caseSetId) {
    throw new Error("The evaluation run does not match the case set.");
  }

  const observations = new Map(
    run.observations.map((observation) => [observation.caseId, observation] as const),
  );
  const knownCaseIds = new Set(caseSet.cases.map((evaluationCase) => evaluationCase.caseId));
  for (const caseId of observations.keys()) {
    if (!knownCaseIds.has(caseId)) throw new Error(`Unknown observed case: ${caseId}.`);
  }
  if (observations.size !== caseSet.cases.length) {
    throw new Error("The evaluation run must contain exactly one observation per case.");
  }

  const retrievalRows: RetrievalMetrics[] = [];
  const citationRows: CitationMetrics[] = [];
  const classifications: AbstentionClassification[] = [];
  for (const evaluationCase of caseSet.cases) {
    const observation = observations.get(evaluationCase.caseId);
    if (!observation) throw new Error(`Missing observation: ${evaluationCase.caseId}.`);
    const shouldAbstain = evaluationCase.expectation.type === "unanswerable";
    const abstained = observation.response.type === "abstention";
    classifications.push({ abstained, shouldAbstain });

    if (evaluationCase.expectation.type === "answerable") {
      retrievalRows.push(
        retrievalMetricsAtK(
          observation.retrievedEvidence,
          evaluationCase.expectation.evidence,
          k,
        ),
      );
      citationRows.push(
        citationMetrics(
          observation.response.type === "answer" ? observation.response.citations : [],
          evaluationCase.expectation.evidence,
        ),
      );
    }
  }

  const abstention = answerAbstentionMetrics(classifications);
  const mean = <Row>(rows: readonly Row[], select: (row: Row) => number): number =>
    divide(rows.reduce((total, row) => total + select(row), 0), rows.length);
  return evaluationSummarySchema.parse({
    abstention,
    answerableCaseCount: retrievalRows.length,
    caseCount: caseSet.cases.length,
    caseSetId: caseSet.caseSetId,
    corpusId: caseSet.corpusId,
    k,
    schemaVersion: 1,
    scores: {
      abstentionF1: abstention.f1,
      abstentionPrecision: abstention.precision,
      abstentionRecall: abstention.recall,
      citationCoverage: mean(citationRows, (row) => row.coverage),
      citationValidity: mean(citationRows, (row) => row.validity),
      hitAtK: mean(retrievalRows, (row) => row.hitAtK),
      mrr: mean(retrievalRows, (row) => row.mrr),
      ndcg: mean(retrievalRows, (row) => row.ndcg),
      precisionAtK: mean(retrievalRows, (row) => row.precisionAtK),
      recallAtK: mean(retrievalRows, (row) => row.recallAtK),
    },
  });
}
