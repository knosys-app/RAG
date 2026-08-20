import { z } from "zod";

import {
  evaluationScoreNames,
  evaluationScoreNameSchema,
  evaluationSummarySchema,
  type EvaluationScoreName,
  type EvaluationSummary,
} from "./metrics.js";

const toleranceSchema = z.number().finite().nonnegative();

export const regressionTolerancesSchema = z
  .object({
    default: toleranceSchema.optional(),
    metrics: z.partialRecord(evaluationScoreNameSchema, toleranceSchema).optional(),
  })
  .strict();

export const regressionSchema = z
  .object({
    baseline: z.number(),
    current: z.number(),
    drop: z.number().positive(),
    metric: evaluationScoreNameSchema,
    tolerance: toleranceSchema,
  })
  .strict();

export const baselineComparisonSchema = z
  .object({
    passed: z.boolean(),
    regressions: z.array(regressionSchema),
  })
  .strict();

export type RegressionTolerances = z.input<typeof regressionTolerancesSchema>;
export type BaselineComparison = z.infer<typeof baselineComparisonSchema>;

function contextKey(summary: EvaluationSummary): string {
  return JSON.stringify([
    summary.corpusId,
    summary.caseSetId,
    summary.k,
    summary.caseCount,
    summary.answerableCaseCount,
  ]);
}

export function compareBaseline(
  currentInput: unknown,
  baselineInput: unknown,
  tolerancesInput: RegressionTolerances = {},
): BaselineComparison {
  const current = evaluationSummarySchema.parse(currentInput);
  const baseline = evaluationSummarySchema.parse(baselineInput);
  const tolerances = regressionTolerancesSchema.parse(tolerancesInput);
  if (contextKey(current) !== contextKey(baseline)) {
    throw new Error("Current and baseline summaries describe different evaluations.");
  }

  const regressions: {
    baseline: number;
    current: number;
    drop: number;
    metric: EvaluationScoreName;
    tolerance: number;
  }[] = [];
  for (const metric of evaluationScoreNames) {
    const tolerance = tolerances.metrics?.[metric] ?? tolerances.default ?? 0;
    const drop = baseline.scores[metric] - current.scores[metric];
    const floatingPointMargin = Number.EPSILON * 8;
    if (drop > tolerance + floatingPointMargin) {
      regressions.push({
        baseline: baseline.scores[metric],
        current: current.scores[metric],
        drop,
        metric,
        tolerance,
      });
    }
  }

  return baselineComparisonSchema.parse({
    passed: regressions.length === 0,
    regressions,
  });
}
