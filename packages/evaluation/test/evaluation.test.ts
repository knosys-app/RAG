import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import agricultureCases from "../fixtures/agriculture-cases.v1.json";
import agricultureCorpus from "../fixtures/agriculture-corpus.v1.json";
import {
  answerAbstentionMetrics,
  citationMetrics,
  compareBaseline,
  evaluateRun,
  evidenceKey,
  evidenceLocatorSchema,
  evidenceSchema,
  parseEvaluationData,
  retrievalMetricsAtK,
  runDeterministicEvaluation,
  type EvaluationSummary,
} from "../src/index.js";

function fixtureData() {
  return parseEvaluationData(agricultureCorpus, agricultureCases);
}

describe("evaluation schemas", () => {
  it("parses the JSON-compatible synthetic agriculture data", () => {
    const data = fixtureData();

    expect(data.caseSet.cases.map((evaluationCase) => evaluationCase.tags[0])).toEqual([
      "exact-numeric",
      "semantic-paraphrase",
      "unanswerable",
    ]);
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("supports source, line, fragment, and page locators", () => {
    expect(
      [
        { type: "source" },
        { type: "lines", startLine: 2, endLine: 3 },
        { type: "fragment", fragment: "#soil" },
        { type: "page", pageNumber: 4 },
      ].every((locator) => evidenceLocatorSchema.safeParse(locator).success),
    ).toBe(true);
  });

  it("rejects stale quote hashes and source identities", () => {
    const data = fixtureData();
    const firstCase = data.caseSet.cases[0]!;
    if (firstCase.expectation.type !== "answerable") throw new Error("Invalid fixture.");
    const evidence = firstCase.expectation.evidence[0]!;

    expect(
      evidenceSchema.safeParse({ ...evidence, quoteHash: "0".repeat(64) }).success,
    ).toBe(false);
    expect(() =>
      parseEvaluationData(data.corpus, {
        ...data.caseSet,
        cases: data.caseSet.cases.map((evaluationCase, index) =>
          index === 0 && evaluationCase.expectation.type === "answerable"
            ? {
                ...evaluationCase,
                expectation: {
                  ...evaluationCase.expectation,
                  evidence: evaluationCase.expectation.evidence.map((item) => ({
                    ...item,
                    sourceChecksum: "f".repeat(64),
                  })),
                },
              }
            : evaluationCase,
        ),
      }),
    ).toThrow("unknown source identity");
  });

  it("builds stable evidence keys independent of object property order", () => {
    const firstCase = fixtureData().caseSet.cases[0]!;
    if (firstCase.expectation.type !== "answerable") throw new Error("Invalid fixture.");
    const evidence = firstCase.expectation.evidence[0]!;
    const reordered = {
      quoteHash: evidence.quoteHash,
      locator: evidence.locator,
      sourceChecksum: evidence.sourceChecksum,
      quote: evidence.quote,
      sourceId: evidence.sourceId,
    };

    expect(evidenceKey(evidence)).toBe(evidenceKey(reordered));
  });
});

describe("evaluation metrics", () => {
  it("computes Hit@K, Recall@K, Precision@K, MRR, and nDCG", () => {
    const cases = fixtureData().caseSet.cases;
    const exact = cases[0]!;
    const semantic = cases[1]!;
    if (
      exact.expectation.type !== "answerable" ||
      semantic.expectation.type !== "answerable"
    ) {
      throw new Error("Invalid fixture.");
    }
    const metrics = retrievalMetricsAtK(
      [semantic.expectation.evidence[0]!, exact.expectation.evidence[0]!],
      exact.expectation.evidence,
      2,
    );

    expect(metrics.hitAtK).toBe(1);
    expect(metrics.recallAtK).toBe(1);
    expect(metrics.precisionAtK).toBe(0.5);
    expect(metrics.mrr).toBe(0.5);
    expect(metrics.ndcg).toBeCloseTo(1 / Math.log2(3));
  });

  it("computes citation validity and evidence coverage", () => {
    const cases = fixtureData().caseSet.cases;
    const exact = cases[0]!;
    const semantic = cases[1]!;
    if (
      exact.expectation.type !== "answerable" ||
      semantic.expectation.type !== "answerable"
    ) {
      throw new Error("Invalid fixture.");
    }

    expect(
      citationMetrics(
        [exact.expectation.evidence[0]!, semantic.expectation.evidence[0]!],
        exact.expectation.evidence,
      ),
    ).toEqual({ coverage: 1, validity: 0.5 });
    expect(citationMetrics([], exact.expectation.evidence)).toEqual({
      coverage: 0,
      validity: 0,
    });
  });

  it("computes abstention confusion counts and F1", () => {
    expect(
      answerAbstentionMetrics([
        { shouldAbstain: true, abstained: true },
        { shouldAbstain: true, abstained: false },
        { shouldAbstain: false, abstained: true },
        { shouldAbstain: false, abstained: false },
      ]),
    ).toEqual({
      f1: 0.5,
      falseNegative: 1,
      falsePositive: 1,
      precision: 0.5,
      recall: 0.5,
      trueNegative: 1,
      truePositive: 1,
    });
  });

  it("aggregates a complete adapter-owned run", () => {
    const caseSet = fixtureData().caseSet;
    const answerableCases = caseSet.cases.filter(
      (evaluationCase) => evaluationCase.expectation.type === "answerable",
    );
    const summary = evaluateRun(
      caseSet,
      {
        schemaVersion: 1,
        caseSetId: caseSet.caseSetId,
        corpusId: caseSet.corpusId,
        observations: caseSet.cases.map((evaluationCase) => {
          if (evaluationCase.expectation.type === "unanswerable") {
            return {
              caseId: evaluationCase.caseId,
              retrievedEvidence: [],
              response: { type: "abstention" },
            };
          }
          return {
            caseId: evaluationCase.caseId,
            retrievedEvidence: evaluationCase.expectation.evidence,
            response: {
              type: "answer",
              text: evaluationCase.expectation.acceptableAnswers[0],
              citations: evaluationCase.expectation.evidence,
            },
          };
        }),
      },
      1,
    );

    expect(summary.answerableCaseCount).toBe(answerableCases.length);
    expect(Object.values(summary.scores).every((score) => score === 1)).toBe(true);
    expect(summary.abstention).toMatchObject({
      f1: 1,
      trueNegative: 2,
      truePositive: 1,
    });
  });
});

describe("baseline comparison", () => {
  it("applies deterministic default and per-metric regression tolerances", () => {
    const data = fixtureData();
    const perfect = evaluateRun(
      data.caseSet,
      {
        schemaVersion: 1,
        caseSetId: data.caseSet.caseSetId,
        corpusId: data.caseSet.corpusId,
        observations: data.caseSet.cases.map((evaluationCase) =>
          evaluationCase.expectation.type === "answerable"
            ? {
                caseId: evaluationCase.caseId,
                retrievedEvidence: evaluationCase.expectation.evidence,
                response: {
                  type: "answer",
                  text: evaluationCase.expectation.acceptableAnswers[0],
                  citations: evaluationCase.expectation.evidence,
                },
              }
            : {
                caseId: evaluationCase.caseId,
                retrievedEvidence: [],
                response: { type: "abstention" },
              },
        ),
      },
      1,
    );
    const current: EvaluationSummary = {
      ...perfect,
      scores: {
        ...perfect.scores,
        precisionAtK: 0.8,
        recallAtK: 0.94,
      },
    };
    const tolerances = {
      metrics: { precisionAtK: 0.2 },
      default: 0.05,
    } as const;

    const comparison = compareBaseline(current, perfect, tolerances);
    expect(comparison.passed).toBe(false);
    expect(comparison.regressions.map((regression) => regression.metric)).toEqual([
      "recallAtK",
    ]);
    expect(compareBaseline(current, perfect, tolerances)).toEqual(comparison);
  });
});

describe("production-path deterministic evaluation", () => {
  it("imports physical fixtures and passes lexical, vector, and hybrid gates", async () => {
    const packageRoot = fileURLToPath(new URL("..", import.meta.url));
    const report = await runDeterministicEvaluation({
      caseSetInput: agricultureCases,
      corpusInput: agricultureCorpus,
      sourceDirectory: join(packageRoot, "fixtures", "sources"),
    });

    expect(report.modes.map(({ mode }) => mode)).toEqual([
      "lexical",
      "vector",
      "hybrid",
    ]);
    expect(report.passed).toBe(true);
    expect(report.gates.every(({ passed }) => passed)).toBe(true);
    expect(report.modes.every(({ cases }) => cases.length === 3)).toBe(true);
    expect(
      report.modes.every(({ cases }) => cases.some(({ answerable }) => !answerable)),
    ).toBe(true);
    expect(report.modes.find(({ mode }) => mode === "hybrid")?.metrics).toMatchObject({
      exactNumericHitAt5: 1,
      recallAt5: 1,
    });
  });
});
