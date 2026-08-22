import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import { KnowledgeEngine, type RagInferenceProvider } from "@knosys-rag/engine";
import {
  DEFAULT_EMBEDDING_PROFILE,
  UNCONFIGURED_GENERATION_PROFILE,
  type AnswerStreamRequest,
  type ClaimReconciliationRequest,
  type ClosedBookAnswerRequest,
  type ThreadSummaryRequest,
  type EvidenceFirstAnswerRequest,
  type EvidenceFirstAnswerStreamEvent,
  type EvidenceFirstVerificationRequest,
  type ModelPullProgress,
  type GroundedPlanRequest,
  type HybridSynthesisRequest,
  type InferenceRequestOptions,
  type ModelDescriptor,
  type QuestionContextualizationRequest,
  type SynthesisVerificationRequest,
} from "@knosys-rag/inference";
import type {
  RequestedRetrievalMode,
  RetrievalCandidate,
} from "@knosys-rag/retrieval";
import * as sqliteVec from "sqlite-vec";
import { z } from "zod";

import { retrievalMetricsAtK } from "./metrics.js";
import {
  evidenceSchema,
  parseEvaluationData,
  sha256Schema,
  type Evidence,
  type EvaluationCorpus,
} from "./schemas.js";

const retrievalModes = ["lexical", "vector", "hybrid"] as const;
const DIMENSIONS = DEFAULT_EMBEDDING_PROFILE.dimensions;
const TOP_K = 10;

const modeMetricsSchema = z
  .object({
    exactNumericHitAt5: z.number().min(0).max(1),
    hitAt5: z.number().min(0).max(1),
    mrr: z.number().min(0).max(1),
    ndcgAt10: z.number().min(0).max(1),
    recallAt5: z.number().min(0).max(1),
  })
  .strict();

const retrievalCaseResultSchema = z
  .object({
    answerable: z.boolean(),
    candidates: z
      .array(
        z
          .object({
            fusedScore: z.number(),
            lexicalScore: z.number().nullable(),
            sourceId: z.string().min(1),
            vectorScore: z.number().nullable(),
          })
          .strict(),
      )
      .max(TOP_K),
    caseId: z.string().min(1),
    relevantEvidenceCount: z.number().int().nonnegative(),
    retrieved: z.array(evidenceSchema).max(TOP_K),
    traceMode: z.enum(["hybrid", "lexical", "vector", "lexical-fallback"]),
  })
  .strict();

const modeReportSchema = z
  .object({
    cases: z.array(retrievalCaseResultSchema),
    metrics: modeMetricsSchema,
    mode: z.enum(retrievalModes),
  })
  .strict();

const gateSchema = z
  .object({
    actual: z.number(),
    gate: z.string().min(1),
    passed: z.boolean(),
  })
  .strict();

export const deterministicEvaluationReportSchema = z
  .object({
    caseSetId: z.string().min(1),
    corpusId: z.string().min(1),
    embedding: z
      .object({
        dimensions: z.number().int().positive(),
        digest: z.string().min(1),
        model: z.string().min(1),
        provider: z.literal("deterministic"),
      })
      .strict(),
    gates: z.array(gateSchema),
    modes: z.array(modeReportSchema).length(retrievalModes.length),
    passed: z.boolean(),
    schemaVersion: z.literal(1),
    sourceChecksums: z.record(z.string().min(1), sha256Schema),
  })
  .strict();

export type DeterministicEvaluationReport = z.infer<
  typeof deterministicEvaluationReportSchema
>;

function hashIndex(value: string): number {
  return createHash("sha256").update(value, "utf8").digest().readUInt32BE(0) % DIMENSIONS;
}

function embedText(value: string): readonly number[] {
  const vector = new Float32Array(DIMENSIONS);
  const terms = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .match(/[\p{L}\p{N}]+/gu) ?? [];
  for (const term of terms) vector[hashIndex(term)]! += 1;
  const magnitude = Math.sqrt(vector.reduce((sum, component) => sum + component ** 2, 0));
  if (magnitude === 0) vector[0] = 1;
  else for (let index = 0; index < vector.length; index += 1) vector[index]! /= magnitude;
  return [...vector];
}

function descriptor(
  name: string,
  digest: string,
  capability: "completion" | "embedding",
): ModelDescriptor {
  return {
    capabilities: [capability],
    digest,
    family: "deterministic-evaluation",
    local: true,
    metadataError: null,
    name,
    nativeContextWindow: 32_768,
    parameterSize: null,
    provider: "ollama",
    quantizationLevel: null,
    remoteHost: null,
    remoteModel: null,
    sizeBytes: 1,
  };
}

class DeterministicEvaluationProvider implements RagInferenceProvider {
  public readonly embeddingProfile = DEFAULT_EMBEDDING_PROFILE;
  public readonly generationProfile = UNCONFIGURED_GENERATION_PROFILE;
  readonly #embeddingDigest = `sha256:${"e".repeat(64)}`;
  readonly #generationDigest = `sha256:${"a".repeat(64)}`;

  public async listModels(): Promise<readonly ModelDescriptor[]> {
    return [
      descriptor(this.embeddingProfile.model, this.#embeddingDigest, "embedding"),
      descriptor(this.generationProfile.model, this.#generationDigest, "completion"),
    ];
  }

  public async describeModel(model: string): Promise<ModelDescriptor> {
    const found = (await this.listModels()).find((candidate) => candidate.name === model);
    if (!found) throw new Error(`Model ${model} is not available in deterministic evaluation.`);
    return found;
  }

  public async embedDocuments(
    documents: readonly string[],
    options?: InferenceRequestOptions,
  ): Promise<readonly (readonly number[])[]> {
    options?.signal?.throwIfAborted();
    return documents.map(embedText);
  }

  public async embedQuery(
    query: string,
    options?: InferenceRequestOptions,
  ): Promise<readonly number[]> {
    options?.signal?.throwIfAborted();
    return embedText(query);
  }

  public async planGroundedAnswer(_request: GroundedPlanRequest) {
    return {
      answer: "Deterministic evaluation answer.",
      claims: [{ evidenceIds: ["E1"], text: "Deterministic evaluation answer." }],
      type: "answer" as const,
    };
  }

  public async contextualizeQuestion(request: QuestionContextualizationRequest) {
    return request.question;
  }

  public async assessGroundedAnswerability(_request: GroundedPlanRequest) {
    return { evidenceIds: [] };
  }

  public async generateEvidenceFirstAnswer(request: EvidenceFirstAnswerRequest) {
    return {
      statements: request.evidence.length === 0
        ? [
            {
              evidenceIds: [],
              kind: "model" as const,
              memoryIds: [],
              statementId: "S1" as const,
              text: "Deterministic evaluation background.",
            },
          ]
        : [
            {
              evidenceIds: [request.evidence[0]!.id],
              kind: "library" as const,
              memoryIds: [],
              statementId: "S1" as const,
              text: request.libraryAnswer,
            },
          ],
      version: 1 as const,
    };
  }

  public async *pullModel(
    _model: string,
    options?: InferenceRequestOptions,
  ): AsyncGenerator<ModelPullProgress> {
    options?.signal?.throwIfAborted();
    yield { completedBytes: null, status: "success", totalBytes: null };
  }

  public async *streamEvidenceFirstAnswer(
    request: EvidenceFirstAnswerRequest,
    options?: InferenceRequestOptions,
  ): AsyncGenerator<EvidenceFirstAnswerStreamEvent> {
    options?.signal?.throwIfAborted();
    const result = await this.generateEvidenceFirstAnswer(request);
    for (const statement of result.statements) {
      yield { statement, type: "statement" };
    }
    yield { result, type: "result" };
  }

  public async verifyEvidenceFirstAnswer(request: EvidenceFirstVerificationRequest) {
    return {
      assessments: request.statements.map(({ statementId }) => ({
        acceptable: true,
        statementId,
      })),
      version: 1 as const,
    };
  }

  public async generateClosedBookAnswer(_request: ClosedBookAnswerRequest) {
    return {
      answer: "Deterministic evaluation background.",
      claims: [{ text: "Deterministic evaluation background." }],
      version: 1 as const,
    };
  }

  public async summarizeThread(request: ThreadSummaryRequest) {
    return {
      conclusions: [],
      keyQuestions: [],
      topics: [request.threadTitle],
      userFacts: [],
      version: 1 as const,
    };
  }

  public async reconcileClaims(request: ClaimReconciliationRequest) {
    return {
      assessments: request.modelClaims.map(({ id }) => ({
        contradictingEvidenceIds: [],
        equivalentLibraryClaimIds: [],
        modelClaimId: id,
        supportingEvidenceIds: [],
      })),
      version: 1 as const,
    };
  }

  public async synthesizeHybridAnswer(request: HybridSynthesisRequest) {
    return {
      statements: request.modelClaims.map((claim, index) => ({
        sectionKind: "model-background" as const,
        sourceClaimIds: [claim.id],
        statementId: `S${index + 1}` as const,
        text: claim.text,
      })),
      version: 1 as const,
    };
  }

  public async verifyHybridSynthesis(request: SynthesisVerificationRequest) {
    return {
      assessments: request.statements.map(({ statementId }) => ({
        faithful: true,
        statementId,
      })),
      version: 1 as const,
    };
  }

  public streamAnswer(
    _request: AnswerStreamRequest,
    _options?: InferenceRequestOptions,
  ): AsyncIterable<string> {
    return (async function* () {})();
  }
}

function sourceIdByChecksum(corpus: EvaluationCorpus): ReadonlyMap<string, string> {
  return new Map(corpus.sources.map((source) => [source.checksum, source.sourceId]));
}

function evidenceForCandidate(
  candidate: RetrievalCandidate,
  goldEvidence: readonly Evidence[],
  sourceIds: ReadonlyMap<string, string>,
): Evidence | null {
  const checksum = candidate.evidence.metadata?.sourceChecksum;
  if (typeof checksum !== "string") return null;
  const sourceId = sourceIds.get(checksum);
  if (!sourceId) return null;
  const gold = goldEvidence.find(
      (evidence) =>
        evidence.sourceId === sourceId &&
        evidence.sourceChecksum === checksum &&
        candidate.evidence.text.includes(evidence.quote),
    );
  if (gold) return gold;
  return evidenceSchema.parse({
    locator: { type: "source" },
    quote: candidate.evidence.text,
    quoteHash: createHash("sha256")
      .update(candidate.evidence.text, "utf8")
      .digest("hex"),
    sourceChecksum: checksum,
    sourceId,
  });
}

function mean(values: readonly number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

async function waitForEmbeddings(engine: KnowledgeEngine): Promise<void> {
  const timeoutAt = Date.now() + 5_000;
  while (Date.now() < timeoutAt) {
    const coverage = engine.getRagStatus().embedding.coverage;
    if (coverage?.ratio === 1) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Deterministic fixture embeddings did not finish within five seconds.");
}

function gate(gateName: string, actual: number, passed: boolean) {
  return { actual, gate: gateName, passed };
}

export async function runDeterministicEvaluation(options: {
  readonly caseSetInput: unknown;
  readonly corpusInput: unknown;
  readonly sourceDirectory: string;
}): Promise<DeterministicEvaluationReport> {
  const { caseSet, corpus } = parseEvaluationData(
    options.corpusInput,
    options.caseSetInput,
  );
  const sourcePaths = corpus.sources.map((source) =>
    join(options.sourceDirectory, `${source.sourceId}${source.mediaType === "text/markdown" ? ".md" : ".txt"}`),
  );
  const checksums = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (sourcePath) => [
        basename(sourcePath).replace(/\.[^.]+$/, ""),
        createHash("sha256").update(await readFile(sourcePath)).digest("hex"),
      ]),
    ),
  );
  for (const source of corpus.sources) {
    if (checksums[source.sourceId] !== source.checksum) {
      throw new Error(`Fixture ${source.sourceId} does not match its corpus checksum.`);
    }
  }

  const root = await mkdtemp(join(tmpdir(), "knosys-evaluation-"));
  const provider = new DeterministicEvaluationProvider();
  const engine = new KnowledgeEngine(root, sqliteVec.getLoadablePath(), {
    embeddingProvider: provider,
    modelProvider: provider,
  });
  try {
    await engine.initializeRag();
    const imported = await engine.importPaths(sourcePaths);
    if (imported.imported !== sourcePaths.length || imported.failed !== 0) {
      throw new Error("The production engine did not import every evaluation fixture.");
    }
    await waitForEmbeddings(engine);

    const sourceIds = sourceIdByChecksum(corpus);
    const reports = [];
    for (const mode of retrievalModes) {
      const caseRows = [];
      const metricsRows: {
        readonly exactNumeric: boolean;
        readonly hitAt5: number;
        readonly mrr: number;
        readonly ndcgAt10: number;
        readonly recallAt5: number;
      }[] = [];
      for (const evaluationCase of caseSet.cases) {
        const answerable = evaluationCase.expectation.type === "answerable";
        const goldEvidence: readonly Evidence[] =
          evaluationCase.expectation.type === "answerable"
            ? evaluationCase.expectation.evidence
            : [];
        const retrieval = await engine.retrieve(
          evaluationCase.query,
          mode satisfies RequestedRetrievalMode,
          TOP_K,
        );
        const retrieved = retrieval.candidates
          .map((candidate) =>
            evidenceForCandidate(
              candidate,
              goldEvidence,
              sourceIds,
            ),
          )
          .filter((evidence): evidence is Evidence => evidence !== null);
        if (answerable) {
          const atFive = retrievalMetricsAtK(retrieved, goldEvidence, 5);
          const atTen = retrievalMetricsAtK(retrieved, goldEvidence, 10);
          metricsRows.push({
            exactNumeric: evaluationCase.tags.includes("exact-numeric"),
            hitAt5: atFive.hitAtK,
            mrr: atTen.mrr,
            ndcgAt10: atTen.ndcg,
            recallAt5: atFive.recallAtK,
          });
        }
        caseRows.push({
          answerable,
          candidates: retrieval.candidates.map((candidate) => ({
            fusedScore: candidate.score,
            lexicalScore:
              candidate.components.find((component) => component.component === "lexical")
                ?.score ?? null,
            sourceId:
              typeof candidate.evidence.metadata?.sourceChecksum === "string"
                ? sourceIds.get(candidate.evidence.metadata.sourceChecksum) ?? "unknown"
                : "unknown",
            vectorScore:
              candidate.components.find((component) => component.component === "vector")
                ?.score ?? null,
          })),
          caseId: evaluationCase.caseId,
          relevantEvidenceCount: goldEvidence.length,
          retrieved,
          traceMode: retrieval.trace.mode,
        });
      }
      reports.push({
        cases: caseRows,
        metrics: {
          exactNumericHitAt5: mean(
            metricsRows.filter((row) => row.exactNumeric).map((row) => row.hitAt5),
          ),
          hitAt5: mean(metricsRows.map((row) => row.hitAt5)),
          mrr: mean(metricsRows.map((row) => row.mrr)),
          ndcgAt10: mean(metricsRows.map((row) => row.ndcgAt10)),
          recallAt5: mean(metricsRows.map((row) => row.recallAt5)),
        },
        mode,
      });
    }

    const hybrid = reports.find((report) => report.mode === "hybrid")!;
    const lexical = reports.find((report) => report.mode === "lexical")!;
    const vector = reports.find((report) => report.mode === "vector")!;
    const gates = [
      gate(
        "hybrid exact-numeric Hit@5 = 1.00",
        hybrid.metrics.exactNumericHitAt5,
        hybrid.metrics.exactNumericHitAt5 === 1,
      ),
      gate(
        "hybrid macro Recall@5 >= 0.90",
        hybrid.metrics.recallAt5,
        hybrid.metrics.recallAt5 >= 0.9,
      ),
      gate(
        "hybrid Recall@5 >= stronger component",
        hybrid.metrics.recallAt5,
        hybrid.metrics.recallAt5 >=
          Math.max(lexical.metrics.recallAt5, vector.metrics.recallAt5),
      ),
      gate(
        "hybrid nDCG@10 >= stronger component",
        hybrid.metrics.ndcgAt10,
        hybrid.metrics.ndcgAt10 >=
          Math.max(lexical.metrics.ndcgAt10, vector.metrics.ndcgAt10),
      ),
    ];
    return deterministicEvaluationReportSchema.parse({
      caseSetId: caseSet.caseSetId,
      corpusId: corpus.corpusId,
      embedding: {
        dimensions: DIMENSIONS,
        digest: `sha256:${"e".repeat(64)}`,
        model: "deterministic-hashed-tokens-v1",
        provider: "deterministic",
      },
      gates,
      modes: reports,
      passed: gates.every((result) => result.passed),
      schemaVersion: 1,
      sourceChecksums: checksums,
    });
  } finally {
    engine.close();
    await rm(root, { force: true, recursive: true });
  }
}
