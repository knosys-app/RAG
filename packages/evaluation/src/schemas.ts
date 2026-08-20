import { createHash } from "node:crypto";

import { z } from "zod";

const identifierSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/);

export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const linesLocatorSchema = z
  .object({
    endLine: z.number().int().positive(),
    startLine: z.number().int().positive(),
    type: z.literal("lines"),
  })
  .strict()
  .refine((locator) => locator.endLine >= locator.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  });

const fragmentLocatorSchema = z
  .object({
    fragment: z.string().min(1).max(2048),
    type: z.literal("fragment"),
  })
  .strict();

const sourceLocatorSchema = z.object({ type: z.literal("source") }).strict();

const pageLocatorSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    type: z.literal("page"),
  })
  .strict();

export const evidenceLocatorSchema = z.discriminatedUnion("type", [
  linesLocatorSchema,
  fragmentLocatorSchema,
  sourceLocatorSchema,
  pageLocatorSchema,
]);

export const evidenceSchema = z
  .object({
    locator: evidenceLocatorSchema,
    quote: z.string().min(1),
    quoteHash: sha256Schema,
    sourceChecksum: sha256Schema,
    sourceId: identifierSchema,
  })
  .strict()
  .superRefine((evidence, context) => {
    if (sha256Text(evidence.quote) !== evidence.quoteHash) {
      context.addIssue({
        code: "custom",
        message: "quoteHash must be the SHA-256 hash of quote",
        path: ["quoteHash"],
      });
    }
  });

export const corpusSourceSchema = z
  .object({
    checksum: sha256Schema,
    mediaType: z.string().min(1).max(128),
    sourceId: identifierSchema,
    text: z.string().min(1),
    title: z.string().min(1).max(512),
  })
  .strict();

export const evaluationCorpusSchema = z
  .object({
    corpusId: identifierSchema,
    schemaVersion: z.literal(1),
    sources: z.array(corpusSourceSchema).min(1),
  })
  .strict()
  .superRefine((corpus, context) => {
    const sourceIds = new Set<string>();
    for (const [index, source] of corpus.sources.entries()) {
      if (sourceIds.has(source.sourceId)) {
        context.addIssue({
          code: "custom",
          message: "sourceId must be unique within a corpus",
          path: ["sources", index, "sourceId"],
        });
      }
      sourceIds.add(source.sourceId);
    }
  });

const answerableExpectationSchema = z
  .object({
    acceptableAnswers: z.array(z.string().min(1)).min(1),
    evidence: z.array(evidenceSchema).min(1),
    type: z.literal("answerable"),
  })
  .strict();

const unanswerableExpectationSchema = z
  .object({
    type: z.literal("unanswerable"),
  })
  .strict();

export const evaluationCaseSchema = z
  .object({
    caseId: identifierSchema,
    expectation: z.discriminatedUnion("type", [
      answerableExpectationSchema,
      unanswerableExpectationSchema,
    ]),
    query: z.string().min(1).max(2048),
    tags: z.array(identifierSchema),
  })
  .strict();

export const evaluationCaseSetSchema = z
  .object({
    caseSetId: identifierSchema,
    corpusId: identifierSchema,
    cases: z.array(evaluationCaseSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((caseSet, context) => {
    const caseIds = new Set<string>();
    for (const [index, evaluationCase] of caseSet.cases.entries()) {
      if (caseIds.has(evaluationCase.caseId)) {
        context.addIssue({
          code: "custom",
          message: "caseId must be unique within a case set",
          path: ["cases", index, "caseId"],
        });
      }
      caseIds.add(evaluationCase.caseId);
    }
  });

const answerObservationSchema = z
  .object({
    citations: z.array(evidenceSchema),
    text: z.string().min(1),
    type: z.literal("answer"),
  })
  .strict();

const abstentionObservationSchema = z
  .object({
    type: z.literal("abstention"),
  })
  .strict();

export const evaluationObservationSchema = z
  .object({
    caseId: identifierSchema,
    response: z.discriminatedUnion("type", [
      answerObservationSchema,
      abstentionObservationSchema,
    ]),
    retrievedEvidence: z.array(evidenceSchema),
  })
  .strict();

export const evaluationRunSchema = z
  .object({
    caseSetId: identifierSchema,
    corpusId: identifierSchema,
    observations: z.array(evaluationObservationSchema).min(1),
    schemaVersion: z.literal(1),
  })
  .strict()
  .superRefine((run, context) => {
    const caseIds = new Set<string>();
    for (const [index, observation] of run.observations.entries()) {
      if (caseIds.has(observation.caseId)) {
        context.addIssue({
          code: "custom",
          message: "each case may have only one observation",
          path: ["observations", index, "caseId"],
        });
      }
      caseIds.add(observation.caseId);
    }
  });

export type Evidence = z.infer<typeof evidenceSchema>;
export type EvidenceLocator = z.infer<typeof evidenceLocatorSchema>;
export type EvaluationCaseSet = z.infer<typeof evaluationCaseSetSchema>;
export type EvaluationCorpus = z.infer<typeof evaluationCorpusSchema>;
export type EvaluationObservation = z.infer<typeof evaluationObservationSchema>;
export type EvaluationRun = z.infer<typeof evaluationRunSchema>;

export function evidenceKey(evidence: Evidence): string {
  let locatorKey: readonly (number | string)[];
  switch (evidence.locator.type) {
    case "lines":
      locatorKey = [
        evidence.locator.type,
        evidence.locator.startLine,
        evidence.locator.endLine,
      ];
      break;
    case "fragment":
      locatorKey = [evidence.locator.type, evidence.locator.fragment];
      break;
    case "source":
      locatorKey = [evidence.locator.type];
      break;
    case "page":
      locatorKey = [evidence.locator.type, evidence.locator.pageNumber];
      break;
  }

  return JSON.stringify([
    evidence.sourceId,
    evidence.sourceChecksum,
    locatorKey,
    evidence.quoteHash,
  ]);
}

export function parseEvaluationData(
  corpusInput: unknown,
  caseSetInput: unknown,
): { corpus: EvaluationCorpus; caseSet: EvaluationCaseSet } {
  const corpus = evaluationCorpusSchema.parse(corpusInput);
  const caseSet = evaluationCaseSetSchema.parse(caseSetInput);
  if (corpus.corpusId !== caseSet.corpusId) {
    throw new Error("The case set corpusId does not match the corpus.");
  }

  const sources = new Map(
    corpus.sources.map((source) => [source.sourceId, source] as const),
  );
  for (const evaluationCase of caseSet.cases) {
    if (evaluationCase.expectation.type === "unanswerable") continue;
    for (const evidence of evaluationCase.expectation.evidence) {
      const source = sources.get(evidence.sourceId);
      if (!source || source.checksum !== evidence.sourceChecksum) {
        throw new Error(
          `Case ${evaluationCase.caseId} references an unknown source identity.`,
        );
      }
      if (!source.text.includes(evidence.quote)) {
        throw new Error(
          `Case ${evaluationCase.caseId} quotes text absent from ${source.sourceId}.`,
        );
      }
      if (evidence.locator.type === "lines") {
        const lines = source.text.split("\n");
        const selectedText = lines
          .slice(evidence.locator.startLine - 1, evidence.locator.endLine)
          .join("\n");
        if (!selectedText.includes(evidence.quote)) {
          throw new Error(
            `Case ${evaluationCase.caseId} quote falls outside its line locator.`,
          );
        }
      }
    }
  }

  return { caseSet, corpus };
}
