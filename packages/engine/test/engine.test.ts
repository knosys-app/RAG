/// <reference lib="dom" />

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it, vi } from "vitest";
import * as sqliteVec from "sqlite-vec";

import {
  DEFAULT_EMBEDDING_PROFILE,
  InferenceError,
  UNCONFIGURED_GENERATION_PROFILE,
  type AnswerStreamRequest,
  type ClaimReconciliationRequest,
  type ClosedBookAnswerRequest,
  type EvidenceFirstAnswerRequest,
  type EvidenceFirstAnswerStreamEvent,
  type EvidenceFirstStatement,
  type EvidenceFirstVerificationRequest,
  type GroundedPlanRequest,
  type HybridSynthesisRequest,
  type InferenceRequestOptions,
  type ModelDescriptor,
  type ModelPullProgress,
  type QuestionContextualizationRequest,
  type SynthesisVerificationRequest,
} from "@knosys-rag/inference";
import { KnosysDatabase } from "@knosys-rag/storage-sqlite";

import {
  KnowledgeEngine,
  type AnswerMode,
  type EngineOperationError,
  type ImportProgressEvent,
  type RagChatEvent,
  type RagInferenceProvider,
  type RagModelPullEvent,
} from "../src/index.js";

const vectorExtensionPath = sqliteVec.getLoadablePath();
const embeddingDigest = "sha256:" + "1".repeat(64);
const qwenDigest = "sha256:" + "2".repeat(64);
const gemmaDigest = "sha256:" + "3".repeat(64);

function createPdfFixture(text: string): Uint8Array {
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${text.replace(/([\\()])/g, "\\$1")}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Count 1 /Kids [3 0 R] >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

function unitVector(dimension: number): readonly number[] {
  const vector = Array<number>(DEFAULT_EMBEDDING_PROFILE.dimensions).fill(0);
  vector[dimension] = 1;
  return vector;
}

function descriptor(
  name: string,
  digest: string,
  capability: "completion" | "embedding",
): ModelDescriptor {
  return {
    capabilities: [capability],
    digest,
    family: "test",
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

class FakeInferenceProvider implements RagInferenceProvider {
  public readonly answerabilityRequests: GroundedPlanRequest[] = [];
  public readonly contextualizationRequests: QuestionContextualizationRequest[] = [];
  public readonly closedBookRequests: ClosedBookAnswerRequest[] = [];
  public readonly documentBatchSizes: number[] = [];
  public readonly embeddingProfile = DEFAULT_EMBEDDING_PROFILE;
  public readonly evidenceFirstAnswerRequests: EvidenceFirstAnswerRequest[] = [];
  public readonly evidenceFirstVerificationRequests: EvidenceFirstVerificationRequest[] = [];
  public readonly generationProfile = UNCONFIGURED_GENERATION_PROFILE;
  public readonly planRequests: GroundedPlanRequest[] = [];
  public readonly queryEmbeddingRequests: string[] = [];
  public readonly streamRequests: AnswerStreamRequest[] = [];
  public readonly reconciliationRequests: ClaimReconciliationRequest[] = [];
  public readonly synthesisRequests: HybridSynthesisRequest[] = [];
  public readonly verificationRequests: SynthesisVerificationRequest[] = [];
  public contextualizedQuestion: string | null = null;
  public closedBookGate: Promise<void> | null = null;
  public failDocumentEmbedding = false;
  public failModelListing = false;
  public failQueryEmbedding = false;
  public failClosedBook = false;
  public failEvidenceFirstGeneration = false;
  public failEvidenceFirstVerification = false;
  public failReconciliation = false;
  public failSynthesis = false;
  public failVerification = false;
  public evidenceFirstGenerationBlocks = false;
  public evidenceFirstStreamBlocksAfterFirstStatement = false;
  public failPull = false;
  public pullBlocksAfterFirstFrame = false;
  public readonly pullRequests: string[] = [];
  public includeModelKnowledge = false;
  public reconciliationBlocks = false;
  public reconciliationKind: "supported" | "contradicted" | "mixed" | "unverified" =
    "supported";
  public readonly operationLog: string[] = [];
  public streamBlocks = false;
  public streamWithoutCitation = false;
  public verificationAcceptable = true;
  public verificationFaithful = true;

  readonly #models = [
    descriptor(DEFAULT_EMBEDDING_PROFILE.model, embeddingDigest, "embedding"),
    descriptor("qwen3:8b", qwenDigest, "completion"),
    descriptor("gemma4:26b", gemmaDigest, "completion"),
  ];

  public async listModels(): Promise<readonly ModelDescriptor[]> {
    if (this.failModelListing) {
      throw new InferenceError("NETWORK_ERROR", "Ollama is not running.");
    }
    return this.#models;
  }

  public async describeModel(model: string): Promise<ModelDescriptor> {
    const found = this.#models.find((candidate) => candidate.name === model);
    if (found === undefined) {
      throw new InferenceError("MODEL_UNAVAILABLE", `${model} is not installed.`);
    }
    return found;
  }

  public async *pullModel(
    model: string,
    options?: InferenceRequestOptions,
  ): AsyncGenerator<ModelPullProgress> {
    this.pullRequests.push(model);
    yield { completedBytes: null, status: "pulling manifest", totalBytes: null };
    if (this.pullBlocksAfterFirstFrame) {
      await new Promise<void>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        });
      });
    }
    if (this.failPull) {
      throw new InferenceError("NETWORK_ERROR", "The Ollama request failed.");
    }
    yield { completedBytes: 100_000_000, status: "pulling abc123", totalBytes: 640_000_000 };
    yield { completedBytes: 640_000_000, status: "pulling abc123", totalBytes: 640_000_000 };
    yield { completedBytes: null, status: "verifying sha256 digest", totalBytes: null };
    yield { completedBytes: null, status: "success", totalBytes: null };
  }

  public async embedDocuments(
    documents: readonly string[],
    options?: InferenceRequestOptions,
  ): Promise<readonly (readonly number[])[]> {
    options?.signal?.throwIfAborted();
    this.documentBatchSizes.push(documents.length);
    if (this.failDocumentEmbedding) {
      throw new InferenceError("NETWORK_ERROR", "Embedding failed.");
    }
    return documents.map((content) =>
      unitVector(content.toLocaleLowerCase("en-US").includes("tomato") ? 0 : 1),
    );
  }

  public async embedQuery(
    query: string,
    options?: InferenceRequestOptions,
  ): Promise<readonly number[]> {
    options?.signal?.throwIfAborted();
    if (this.failQueryEmbedding) {
      throw new InferenceError("NETWORK_ERROR", "Query embedding failed.");
    }
    this.queryEmbeddingRequests.push(query);
    this.operationLog.push("retrieval");
    const normalized = query.toLocaleLowerCase("en-US");
    return unitVector(
      normalized.includes("solanum") || normalized.includes("tomato") ? 0 : 1,
    );
  }

  public async contextualizeQuestion(request: QuestionContextualizationRequest) {
    this.contextualizationRequests.push(request);
    return this.contextualizedQuestion ?? request.question;
  }

  public async planGroundedAnswer(request: GroundedPlanRequest) {
    this.planRequests.push(request);
    this.operationLog.push("planning");
    return {
      answer: "Keep tomato leaves dry.",
      claims: [{ evidenceIds: ["E1"], text: "Keep tomato leaves dry." }],
      type: "answer" as const,
    };
  }

  public async assessGroundedAnswerability(request: GroundedPlanRequest) {
    this.answerabilityRequests.push(request);
    return {
      evidenceIds: request.question.includes("unanswerable") ? [] : ["E1"],
    };
  }

  public async generateEvidenceFirstAnswer(
    request: EvidenceFirstAnswerRequest,
    options?: InferenceRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    this.evidenceFirstAnswerRequests.push(request);
    this.operationLog.push("evidence-generation");
    if (this.evidenceFirstGenerationBlocks) {
      await new Promise<void>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        });
      });
    }
    if (this.failEvidenceFirstGeneration) {
      throw new Error("Evidence-first generation failed.");
    }
    const statements: EvidenceFirstStatement[] = request.evidence.length === 0
      ? []
      : [{
          evidenceIds: [request.evidence[0]!.id],
          kind: "library" as const,
          statementId: "S1" as const,
          text: "Keep tomato leaves dry.",
        }];
    if (request.evidence.length === 0 || this.includeModelKnowledge) {
      statements.push({
        evidenceIds: [],
        kind: "model",
        statementId: `S${statements.length + 1}` as `S${number}`,
        text: "Keep tomato leaves dry.",
      });
    }
    return { statements, version: 1 as const };
  }

  public async *streamEvidenceFirstAnswer(
    request: EvidenceFirstAnswerRequest,
    options?: InferenceRequestOptions,
  ): AsyncGenerator<EvidenceFirstAnswerStreamEvent> {
    if (this.evidenceFirstStreamBlocksAfterFirstStatement) {
      this.evidenceFirstAnswerRequests.push(request);
      this.operationLog.push("evidence-generation");
      yield {
        statement: {
          evidenceIds: [request.evidence[0]!.id],
          kind: "library" as const,
          statementId: "S1" as const,
          text: "Keep tomato leaves dry.",
        },
        type: "statement",
      };
      await new Promise<void>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        });
      });
      return;
    }
    const result = await this.generateEvidenceFirstAnswer(request, options);
    for (const statement of result.statements) {
      options?.signal?.throwIfAborted();
      yield { statement, type: "statement" };
    }
    yield { result, type: "result" };
  }

  public async verifyEvidenceFirstAnswer(
    request: EvidenceFirstVerificationRequest,
    options?: InferenceRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    this.evidenceFirstVerificationRequests.push(request);
    this.operationLog.push("evidence-verification");
    if (this.failEvidenceFirstVerification) {
      throw new Error("Evidence-first verification failed.");
    }
    return {
      assessments: request.statements.map(({ statementId }) => ({
        acceptable: this.verificationAcceptable,
        statementId,
      })),
      version: 1 as const,
    };
  }

  public async generateClosedBookAnswer(
    request: ClosedBookAnswerRequest,
    options?: InferenceRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    this.closedBookRequests.push(request);
    this.operationLog.push("background-start");
    if (this.closedBookGate !== null) await this.closedBookGate;
    options?.signal?.throwIfAborted();
    if (this.failClosedBook) throw new Error("Closed-book generation failed.");
    this.operationLog.push("background-end");
    return {
      answer: "Keep tomato leaves dry.",
      claims: [{ text: "Keep tomato leaves dry." }],
      version: 1 as const,
    };
  }

  public async reconcileClaims(
    request: ClaimReconciliationRequest,
    options?: InferenceRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    this.reconciliationRequests.push(request);
    this.operationLog.push("reconciliation");
    if (this.reconciliationBlocks) {
      await new Promise<void>((_resolve, reject) => {
        if (options?.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
          once: true,
        });
      });
    }
    if (this.failReconciliation) throw new Error("Reconciliation failed.");
    const evidenceId = request.evidence[0]?.id;
    const libraryClaimId = request.libraryClaims[0]?.id;
    return {
      assessments: request.modelClaims.map(({ id }) => ({
        contradictingEvidenceIds:
          evidenceId !== undefined &&
          (this.reconciliationKind === "contradicted" ||
            this.reconciliationKind === "mixed")
            ? [evidenceId]
            : [],
        equivalentLibraryClaimIds:
          libraryClaimId === undefined ? [] : [libraryClaimId],
        modelClaimId: id,
        supportingEvidenceIds:
          evidenceId !== undefined &&
          (this.reconciliationKind === "supported" || this.reconciliationKind === "mixed")
            ? [evidenceId]
            : [],
      })),
      version: 1 as const,
    };
  }

  public async synthesizeHybridAnswer(
    request: HybridSynthesisRequest,
    options?: InferenceRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    this.synthesisRequests.push(request);
    this.operationLog.push("synthesis");
    if (this.failSynthesis) throw new Error("Synthesis failed.");
    const statements = request.modelClaims.map((claim, index) => {
        const assessment = request.reconciliation.assessments.find(
          ({ modelClaimId }) => modelClaimId === claim.id,
        );
        const supported = (assessment?.supportingEvidenceIds.length ?? 0) > 0;
        const contradicted = (assessment?.contradictingEvidenceIds.length ?? 0) > 0;
        return {
          sectionKind: supported
            ? contradicted
              ? ("conflict" as const)
              : ("library" as const)
            : contradicted
              ? ("conflict" as const)
              : ("model-background" as const),
          sourceClaimIds: [claim.id, ...(assessment?.equivalentLibraryClaimIds ?? [])],
          statementId: `S${index + 1}` as `S${number}`,
          text: claim.text,
        };
      });
    const represented = new Set(statements.flatMap(({ sourceClaimIds }) => sourceClaimIds));
    for (const claim of request.libraryClaims) {
      if (represented.has(claim.id)) continue;
      statements.push({
        sectionKind: "library",
        sourceClaimIds: [claim.id],
        statementId: `S${statements.length + 1}` as `S${number}`,
        text: claim.text,
      });
    }
    return {
      statements,
      version: 1 as const,
    };
  }

  public async verifyHybridSynthesis(
    request: SynthesisVerificationRequest,
    options?: InferenceRequestOptions,
  ) {
    options?.signal?.throwIfAborted();
    this.verificationRequests.push(request);
    this.operationLog.push("verification");
    if (this.failVerification) throw new Error("Verification failed.");
    return {
      assessments: request.statements.map(({ statementId }) => ({
        faithful: this.verificationFaithful,
        statementId,
      })),
      version: 1 as const,
    };
  }

  public streamAnswer(
    request: AnswerStreamRequest,
    options?: InferenceRequestOptions,
  ): AsyncIterable<string> {
    this.streamRequests.push(request);
    const blocks = this.streamBlocks;
    const withoutCitation = this.streamWithoutCitation;
    return (async function* () {
      if (blocks) {
        yield "Partial answer ";
        await new Promise<void>((_resolve, reject) => {
          if (options?.signal?.aborted) {
            reject(options.signal.reason);
            return;
          }
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        });
        return;
      }
      yield withoutCitation
        ? "Unsupported provisional prose."
        : "Keep tomato leaves dry [E1].";
    })();
  }
}

class MutableModelProvider extends FakeInferenceProvider {
  public models: readonly ModelDescriptor[] = [];

  public override async listModels(): Promise<readonly ModelDescriptor[]> {
    return this.models;
  }

  public override async describeModel(modelName: string): Promise<ModelDescriptor> {
    const found = this.models.find((candidate) => candidate.name === modelName);
    if (!found) throw new InferenceError("MODEL_UNAVAILABLE", `${modelName} is absent.`);
    return found;
  }
}

async function waitForBackfill(engine: KnowledgeEngine): Promise<void> {
  await vi.waitFor(
    () => {
      expect(engine.getRagStatus().embedding.coverage?.ratio).toBe(1);
      expect(engine.getRagStatus().embedding.latestJob?.status).toBe("completed");
    },
    { interval: 10, timeout: 5_000 },
  );
}

function terminalEvent(
  engine: KnowledgeEngine,
  question: string,
  threadId?: string,
  mode: AnswerMode | null = "strict-grounded",
): Promise<{ readonly events: readonly RagChatEvent[]; readonly runId: string }> {
  const events: RagChatEvent[] = [];
  return new Promise((resolve, reject) => {
    void engine
      .startChat({
        ...(mode === null ? {} : { mode }),
        question,
        ...(threadId === undefined ? {} : { threadId }),
      }, (event) => {
        events.push(event);
        if (["cancelled", "completed", "failed"].includes(event.kind)) {
          resolve({ events, runId: event.runId });
        }
      })
      .catch(reject);
  });
}

describe("managed library ingestion", () => {
  it("copies, indexes, and deduplicates an imported source", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-engine-"));
    const source = join(root, "outside-notes.md");
    await writeFile(source, "# Tomato notes\n\nKeep leaves dry when watering.", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());

    const progress: ImportProgressEvent[] = [];
    const first = await engine.importPaths([source], {
      onProgress: (event) => progress.push(event),
      operationId: "a9da48a8-7aca-4ef1-a7b8-2698b646a944",
    });
    expect(first).toMatchObject({ imported: 1, duplicates: 0, failed: 0 });
    expect(progress.map((event) => event.stage)).toEqual([
      "checking",
      "checking",
      "copying",
      "parsing",
      "chunking",
      "indexing",
      "completed",
    ]);
    expect(progress.at(-1)).toMatchObject({ completed: 1, currentName: null, total: 1 });
    expect(first.snapshot.documents[0]).toMatchObject({
      status: "ready",
      title: "Tomato notes",
    });
    expect(engine.search("leaves watering")[0]?.title).toBe("Tomato notes");

    const second = await engine.importPaths([source]);
    expect(second).toMatchObject({ imported: 0, duplicates: 1, failed: 0 });
    expect(second.snapshot.documents).toHaveLength(1);

    const managedPath = join(
      root,
      "app-data",
      "library",
      "sources",
      second.snapshot.documents[0] ? "d0" : "missing",
    );
    expect(managedPath).toContain("library/sources");
    engine.close();
  });

  it("exposes parse diagnostics for a document imported with warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-review-"));
    const source = join(root, "with-html.md");
    await writeFile(source, "# Heading\n\nReal paragraph text.\n\n<div>raw</div>\n", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const batch = await engine.importPaths([source]);
    const document = batch.snapshot.documents[0];
    expect(document).toMatchObject({ reviewedAt: null, status: "ready-with-warnings" });
    expect(document?.diagnosticCount).toBeGreaterThan(0);

    const review = engine.getDocumentReview(document!.id);
    expect(review.document.id).toBe(document!.id);
    expect(review.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "MARKDOWN_RAW_HTML_OMITTED",
    );
    expect(review.diagnostics[0]?.severity).toBe("warning");
    engine.close();
    await rm(root, { recursive: true });
  });

  it("marks a warning document reviewed without re-importing it", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-ack-"));
    const source = join(root, "with-html.md");
    await writeFile(source, "# Heading\n\nReal text.\n\n<div>raw</div>\n", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const batch = await engine.importPaths([source]);
    const documentId = batch.snapshot.documents[0]!.id;

    const snapshot = engine.acknowledgeDocumentReview(documentId);
    const reviewed = snapshot.documents.find((doc) => doc.id === documentId);
    expect(reviewed?.status).toBe("ready-with-warnings");
    expect(reviewed?.reviewedAt).not.toBeNull();
    // The document stays searchable after acknowledgement.
    expect(engine.search("Real text")).toHaveLength(1);
    engine.close();
    await rm(root, { recursive: true });
  });

  it("refuses to acknowledge a document that has no warnings", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-ack-clean-"));
    const source = join(root, "clean.md");
    await writeFile(source, "# Clean\n\nJust plain text.", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const batch = await engine.importPaths([source]);
    const documentId = batch.snapshot.documents[0]!.id;
    expect(batch.snapshot.documents[0]?.status).toBe("ready");
    expect(() => engine.acknowledgeDocumentReview(documentId)).toThrow();
    engine.close();
    await rm(root, { recursive: true });
  });

  it("replaces a flagged document's source with a clean import", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-replace-"));
    const flagged = join(root, "with-html.md");
    await writeFile(flagged, "# Heading\n\nReal text.\n\n<div>raw</div>\n", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const first = await engine.importPaths([flagged]);
    const originalId = first.snapshot.documents[0]!.id;

    const clean = join(root, "clean.md");
    await writeFile(clean, "# Clean\n\nJust plain text here.", "utf8");
    const result = await engine.replaceDocument(originalId, clean);
    expect(result).toMatchObject({ imported: 1 });
    expect(result.snapshot.documents).toHaveLength(1);
    const replacement = result.snapshot.documents[0];
    expect(replacement?.status).toBe("ready");
    expect(replacement?.id).not.toBe(originalId);
    // The original document is gone.
    expect(() => engine.getDocumentReview(originalId)).toThrow();
    engine.close();
    await rm(root, { recursive: true });
  });

  it("rejects a replacement file whose type is unsupported", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-replace-bad-"));
    const source = join(root, "notes.md");
    await writeFile(source, "# Notes\n\nText.", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const batch = await engine.importPaths([source]);
    const documentId = batch.snapshot.documents[0]!.id;
    await expect(
      engine.replaceDocument(documentId, join(root, "image.png")),
    ).rejects.toThrow();
    // The original document is preserved because the guard runs before deletion.
    expect(engine.getSnapshot().documents).toHaveLength(1);
    engine.close();
    await rm(root, { recursive: true });
  });

  it("reprocesses an imported document from its managed copy", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-reprocess-"));
    const source = join(root, "with-html.md");
    await writeFile(source, "# Heading\n\nReal text about frumenty.\n\n<div>raw</div>\n", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const batch = await engine.importPaths([source]);
    const documentId = batch.snapshot.documents[0]!.id;
    expect(batch.snapshot.documents[0]?.status).toBe("ready-with-warnings");
    engine.acknowledgeDocumentReview(documentId);
    expect(engine.getSnapshot().documents[0]?.reviewedAt).not.toBeNull();

    // Remove the ORIGINAL file to prove reprocess reads the managed copy.
    await rm(source, { force: true });
    const snapshot = await engine.reprocessDocument(documentId);
    const reprocessed = snapshot.documents.find((doc) => doc.id === documentId);
    expect(reprocessed?.id).toBe(documentId);
    // A fresh assessment clears any prior acknowledgement.
    expect(reprocessed?.reviewedAt).toBeNull();
    expect(engine.search("frumenty")).toHaveLength(1);
    engine.close();
    await rm(root, { recursive: true });
  });

  it("rejects reprocessing a document that does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-reprocess-missing-"));
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    await expect(
      engine.reprocessDocument("00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow();
    engine.close();
    await rm(root, { recursive: true });
  });

  it("discovers supported files without following symlinks", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-discovery-"));
    await writeFile(join(root, "one.txt"), "One", "utf8");
    await writeFile(join(root, "skip.pdf"), "not a pdf", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    const discovered = await engine.discoverDirectory(root);
    expect(discovered.map((path) => path.endsWith("one.txt"))).toContain(true);
    expect(discovered.some((path) => path.endsWith("skip.pdf"))).toBe(true);
    engine.close();
  });

  it("keeps the managed source usable after the original changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-immutable-"));
    const source = join(root, "source.txt");
    await writeFile(source, "Immutable source text.", "utf8");
    const engine = new KnowledgeEngine(join(root, "app-data"), sqliteVec.getLoadablePath());
    await engine.importPaths([source]);
    await writeFile(source, "Changed external text.", "utf8");
    expect(engine.search("Immutable")).toHaveLength(1);
    expect(engine.search("Changed external")).toHaveLength(0);
    expect(await readFile(source, "utf8")).toBe("Changed external text.");
    engine.close();
  });

  it("indexes native PDF text and returns page-aware search results", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-pdf-"));
    const source = join(root, "garden.pdf");
    await writeFile(source, createPdfFixture("Plant tomatoes in full sun."));
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath);

    const imported = await engine.importPaths([source]);
    expect(imported).toMatchObject({
      failed: 0,
      imported: 1,
      items: [{ originalName: "garden.pdf", status: "imported" }],
    });
    expect(engine.search("tomatoes full sun")[0]).toMatchObject({
      endPageNumber: 1,
      startPageNumber: 1,
      title: "garden",
    });
    engine.close();
  });

  it("reprocesses a failed canonical document with the same checksum", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-reprocess-"));
    const dataRoot = join(root, "app-data");
    const source = join(root, "recovered.txt");
    const content = "Recovered source content.";
    await writeFile(source, content, "utf8");
    const checksum = createHash("sha256").update(content).digest("hex");
    const database = new KnosysDatabase(
      join(dataRoot, "state", "knosys-rag.sqlite"),
      vectorExtensionPath,
    );
    const documentId = "21aa57d5-bd8e-48fd-a298-e76db44ed429";
    const jobId = "95e6918f-b508-4720-ac7f-e0ea979c47e4";
    database.createJob(jobId, "recovered.txt");
    database.createCanonicalDocument({
      checksum,
      documentId,
      format: "text",
      jobId,
      managedRelativePath: `sources/${checksum.slice(0, 2)}/${checksum}.txt`,
      mimeType: "text/plain",
      originalName: "recovered.txt",
      originalPath: source,
      sizeBytes: content.length,
    });
    database.failDocument(documentId, "OLD_PARSER_FAILURE", "The previous parser failed.");
    database.updateJob(jobId, "failed", 1, {
      documentId,
      errorCode: "OLD_PARSER_FAILURE",
      errorMessage: "The previous parser failed.",
    });
    database.close();

    const engine = new KnowledgeEngine(dataRoot, vectorExtensionPath);
    const result = await engine.importPaths([source]);
    expect(result).toMatchObject({
      failed: 0,
      imported: 0,
      items: [{ documentId, status: "reprocessed" }],
      reprocessed: 1,
    });
    expect(result.snapshot.documents).toHaveLength(1);
    expect(result.snapshot.documents[0]).toMatchObject({ id: documentId, status: "ready" });
    engine.close();
  });
});

describe("production RAG orchestration", () => {
  it("re-evaluates automatic choices but preserves compatible manual choices", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-model-selection-"));
    const provider = new MutableModelProvider();
    const embedding = descriptor(DEFAULT_EMBEDDING_PROFILE.model, embeddingDigest, "embedding");
    const smaller = { ...descriptor("small-local", qwenDigest, "completion"), sizeBytes: 10 };
    const larger = { ...descriptor("large-local", gemmaDigest, "completion"), sizeBytes: 20 };
    provider.models = [larger, embedding, smaller];
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });

    expect((await engine.initializeRag()).generation).toMatchObject({
      selectionMode: "auto",
      selected: { model: "small-local" },
    });
    expect(
      (await engine.setGenerationModel({ mode: "manual", model: "large-local" })).generation,
    ).toMatchObject({ selectionMode: "manual", selected: { model: "large-local" } });
    provider.models = [
      embedding,
      { ...smaller, sizeBytes: 1 },
      { ...larger, digest: `sha256:${"4".repeat(64)}` },
    ];
    expect((await engine.initializeRag()).generation).toMatchObject({
      selectionMode: "manual",
      selected: { digest: `sha256:${"4".repeat(64)}`, model: "large-local" },
    });
    provider.models = [embedding, smaller];
    expect((await engine.initializeRag()).generation).toMatchObject({
      selectionMode: "auto",
      selected: { model: "small-local" },
    });
    engine.close();
  });

  it("initializes models and backfills durable embeddings in batches of at most 32", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-backfill-"));
    const dataRoot = join(root, "app-data");
    const sources: string[] = [];
    for (let index = 0; index < 33; index += 1) {
      const source = join(root, `note-${index}.txt`);
      await writeFile(source, `Tomato note ${index}: keep leaves dry.`, "utf8");
      sources.push(source);
    }
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: provider,
    });
    const imported = await engine.importPaths(sources);
    expect(imported.imported).toBe(33);
    expect(imported.snapshot.documents.every((document) => document.status === "ready")).toBe(
      true,
    );

    const status = await engine.initializeRag();
    expect(status.runtime.state).toBe("available");
    expect(status.embedding.model).toMatchObject({
      capable: true,
      digest: embeddingDigest,
      installed: true,
      model: "qwen3-embedding:0.6b",
    });
    expect(status.generation.selected).toMatchObject({
      digest: gemmaDigest,
      model: "gemma4:26b",
    });
    expect(status.generation.selectionMode).toBe("auto");
    await waitForBackfill(engine);
    expect(Math.max(...provider.documentBatchSizes)).toBeLessThanOrEqual(32);
    expect(engine.getRagStatus().embedding.latestJob).toMatchObject({
      processedChunks: 33,
      status: "completed",
      totalChunks: 33,
    });

    const extraSource = join(root, "note-33.txt");
    await writeFile(extraSource, "Tomato note 33: water the soil.", "utf8");
    await engine.importPaths([extraSource]);
    await waitForBackfill(engine);
    expect(engine.getRagStatus().embedding.coverage).toMatchObject({
      currentChunks: 34,
      totalChunks: 34,
    });
    expect(engine.getRagStatus().embedding.latestJob).toMatchObject({
      processedChunks: 1,
      status: "completed",
    });
    expect((await engine.setGenerationModel({ mode: "manual", model: "qwen3:8b" })).generation.selected).toMatchObject({
      digest: qwenDigest,
      model: "qwen3:8b",
    });
    await expect(engine.setGenerationModel({ mode: "manual", model: "unapproved:latest" })).rejects.toMatchObject({
      code: "RAG_GENERATION_MODEL_NOT_INSTALLED",
    });

    engine.close();
    const reopenedProvider = new FakeInferenceProvider();
    const reopened = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: reopenedProvider,
    });
    await reopened.initializeRag();
    expect(reopened.getRagStatus().embedding.coverage?.currentChunks).toBe(34);
    expect(reopened.getRagStatus().generation.selected).toMatchObject({
      digest: qwenDigest,
      model: "qwen3:8b",
    });
    expect(reopenedProvider.documentBatchSizes).toEqual([]);
    reopened.close();
  });

  it("rescues semantic evidence and falls back to lexical retrieval", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-retrieval-"));
    const source = join(root, "garden.txt");
    await writeFile(source, "Tomato foliage should stay dry during watering.", "utf8");
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const semantic = await engine.retrieve("solanum lycopersicum care", "hybrid", 4);
    expect(semantic.candidates[0]?.evidence.text).toContain("Tomato foliage");
    expect(semantic.candidates[0]?.components).toEqual([
      expect.objectContaining({ component: "vector" }),
    ]);

    provider.failQueryEmbedding = true;
    const fallback = await engine.retrieve("Tomato foliage", "hybrid", 4);
    expect(fallback.trace.mode).toBe("lexical-fallback");
    expect(fallback.candidates[0]?.evidence.text).toContain("Tomato foliage");
    engine.close();
  });

  it("keeps lexical documents ready and initializeRag nonfatal when inference is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-offline-"));
    const source = join(root, "offline.txt");
    await writeFile(source, "Offline lexical evidence remains available.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.failModelListing = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);

    const status = await engine.initializeRag();
    expect(status.runtime).toMatchObject({ reason: "not-running", state: "unavailable" });
    expect(engine.getSnapshot().documents[0]?.status).toBe("ready");
    const result = await engine.retrieve("Offline lexical", "hybrid", 2);
    expect(result.trace.mode).toBe("lexical-fallback");
    expect(result.candidates).toHaveLength(1);
    engine.close();
  });

  it("persists typed semantic failures without changing lexical readiness", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-backfill-failure-"));
    const source = join(root, "failure.txt");
    await writeFile(source, "Tomato evidence remains searchable.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.failDocumentEmbedding = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();

    await vi.waitFor(() => {
      expect(engine.getRagStatus().embedding.latestJob).toMatchObject({
        errorCode: "NETWORK_ERROR",
        status: "failed",
      });
    });
    expect(engine.getSnapshot().documents[0]?.status).toBe("ready");
    expect(engine.search("Tomato evidence")).toHaveLength(1);
    engine.close();
  });

  it("persists authoritative grounded answers and immutable citation snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-chat-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.streamWithoutCitation = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const { events, runId } = await terminalEvent(engine, "How should tomato plants be watered?");
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_event, index) => index),
    );
    expect(events.filter((event) => event.kind === "status").map((event) => event.status)).toEqual([
      "retrieving",
      "routing",
      "planning",
      "generating",
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        diagnostics: expect.objectContaining({ route: "model-answerability" }),
        kind: "routing",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ kind: "delta", text: "Unsupported provisional prose." }),
    );
    const completed = events.find((event) => event.kind === "completed");
    expect(completed).toMatchObject({ fallback: true, insufficient: false });
    if (completed?.kind !== "completed") throw new Error("Expected a completed chat event.");
    expect(completed.message).toMatchObject({
      content: "Keep tomato leaves dry. [E1]",
      routingDiagnostics: { route: "model-answerability" },
      runId,
      status: "completed",
    });
    expect(completed.message.citations).toHaveLength(1);
    expect(provider.closedBookRequests).toEqual([]);
    expect(provider.reconciliationRequests).toEqual([]);
    expect(provider.synthesisRequests).toEqual([]);
    expect(provider.verificationRequests).toEqual([]);

    const citation = engine.getCitation(completed.message.citations[0]!.id);
    expect(citation.text).toContain("Keep tomato leaves dry");
    expect(engine.getSourceWindow(citation.chunkId).some((block) => block.text.includes("tomato"))).toBe(
      true,
    );
    expect(engine.getChatThread(completed.message.threadId).messages.at(-1)).toMatchObject({
      citations: [{ text: citation.text }],
      content: "Keep tomato leaves dry. [E1]",
    });

    await writeFile(source, "The external source changed.", "utf8");
    expect(engine.getCitation(citation.id).text).toBe(citation.text);
    engine.close();
  });

  it("resolves a contextual follow-up before retrieval and preserves its original wording", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-chat-context-"));
    const source = join(root, "pumpkins.txt");
    await writeFile(
      source,
      "Jack-O-Lantern pumpkins direct-sown in early June mature in 90 to 110 days.",
      "utf8",
    );
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const first = await terminalEvent(
      engine,
      "I direct-sowed a Jack-O-Lantern pumpkin in early June. Is it on track?",
    );
    const firstCompleted = first.events.find((event) => event.kind === "completed");
    if (firstCompleted?.kind !== "completed") {
      throw new Error("Expected a completed chat event.");
    }
    expect(provider.contextualizationRequests).toHaveLength(0);

    provider.answerabilityRequests.length = 0;
    provider.planRequests.length = 0;
    provider.queryEmbeddingRequests.length = 0;
    provider.streamRequests.length = 0;
    provider.contextualizedQuestion =
      "When should I harvest fruit from the Jack-O-Lantern pumpkin direct-sown in early June?";
    const originalFollowUp = "Could you estimate when I should be able to harvest the fruit?";
    const second = await terminalEvent(
      engine,
      originalFollowUp,
      firstCompleted.message.threadId,
    );
    const secondCompleted = second.events.find((event) => event.kind === "completed");
    if (secondCompleted?.kind !== "completed") {
      throw new Error("Expected a completed chat event.");
    }

    expect(provider.contextualizationRequests).toEqual([
      {
        history: [
          {
            content:
              "I direct-sowed a Jack-O-Lantern pumpkin in early June. Is it on track?",
            role: "user",
          },
          { content: "Keep tomato leaves dry [E1].", role: "assistant" },
        ],
        question: originalFollowUp,
      },
    ]);
    expect(provider.queryEmbeddingRequests).toContain(provider.contextualizedQuestion);
    expect(provider.answerabilityRequests.at(-1)?.question).toBe(
      provider.contextualizedQuestion,
    );
    expect(provider.planRequests.at(-1)?.question).toContain(provider.contextualizedQuestion);
    expect(provider.planRequests.at(-1)?.question).toContain(
      "transparent-grounded-derivations-v1",
    );
    expect(provider.streamRequests.at(-1)?.question).toBe(provider.contextualizedQuestion);
    expect(secondCompleted.message.citations[0]?.title).toBe("pumpkins");
    expect(secondCompleted.message.routingDiagnostics).toMatchObject({
      confidence: { reasons: ["calibration-mismatch"] },
      route: "model-answerability",
    });
    expect(
      secondCompleted.message.routingDiagnostics?.confidence.fingerprint,
    ).toContain("context-standalone-question-v1");
    const storedFollowUp = engine
      .getChatThread(firstCompleted.message.threadId)
      .messages.find((message) => message.ordinal === 2);
    expect(storedFollowUp).toMatchObject({ content: originalFollowUp, role: "user" });
    engine.close();
  });

  it("defaults to retrieval-first verified hybrid and persists V2 provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-hybrid-default-"));
    const dataRoot = join(root, "app-data");
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const { events } = await terminalEvent(
      engine,
      "How should tomato plants be watered?",
      undefined,
      null,
    );
    expect(provider.operationLog.indexOf("retrieval")).toBeLessThan(
      provider.operationLog.indexOf("planning"),
    );
    expect(provider.operationLog.indexOf("planning")).toBeLessThan(
      provider.operationLog.indexOf("evidence-generation"),
    );
    expect(provider.operationLog.indexOf("evidence-generation")).toBeLessThan(
      provider.operationLog.indexOf("evidence-verification"),
    );
    // Hybrid now drafts the model's own answer (for synthesis + as the
    // never-refuse fallback), so the closed-book generator is invoked once.
    expect(provider.closedBookRequests).toEqual([
      { question: "How should tomato plants be watered?" },
    ]);
    expect(provider.reconciliationRequests).toEqual([]);
    expect(provider.synthesisRequests).toEqual([]);
    expect(provider.streamRequests).toEqual([]);
    expect(events.filter((event) => event.kind === "status").map((event) => event.status)).toEqual([
      "retrieving",
      "retrieving",
      "routing",
      "planning",
      "synthesizing",
      "verifying",
    ]);
    const completed = events.find((event) => event.kind === "completed");
    if (completed?.kind !== "completed") throw new Error("Expected hybrid completion.");
    expect(completed).toMatchObject({ fallback: false, insufficient: false });
    const deltas = events.filter((event) => event.kind === "delta");
    expect(deltas.length).toBeGreaterThan(0);
    expect(deltas.map((event) => event.text).join("")).toBe(completed.message.content);
    const synthesizing = events.find(
      (event) => event.kind === "status" && event.status === "synthesizing",
    );
    expect(deltas.every((event) => event.sequence > (synthesizing?.sequence ?? Infinity))).toBe(
      true,
    );
    expect(completed.message).toMatchObject({
      answerProvenance: {
        mode: "labeled-hybrid",
        promptVersions: { modelDraft: "closed-book-answer-v1" },
        stages: {
          generation: { status: "completed" },
          verification: { status: "completed" },
        },
        statements: [
          {
            evidenceIds: ["E1"],
            kind: "library",
            statementId: "S1",
            text: "Keep tomato leaves dry.",
          },
        ],
        version: 2,
      },
      citations: [{ evidenceId: "E1" }],
      content: "Keep tomato leaves dry.",
      status: "completed",
    });
    expect(provider.evidenceFirstAnswerRequests[0]).toMatchObject({
      originalQuestion: "How should tomato plants be watered?",
      resolvedQuestion: "How should tomato plants be watered?",
      libraryAnswer: "Keep tomato leaves dry.",
      evidence: [{ id: "E1" }],
    });
    const threadId = completed.message.threadId;
    engine.close();

    const reopened = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: new FakeInferenceProvider(),
    });
    expect(reopened.getChatThread(threadId).messages.at(-1)?.answerProvenance).toMatchObject({
      mode: "labeled-hybrid",
      version: 2,
    });
    reopened.close();
  });

  it("allows labeled model knowledge when evidence is insufficient and reuses it safely", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-hybrid-background-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Tomato notes.", "utf8");
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const first = await terminalEvent(engine, "unanswerable tomato question", undefined, null);
    const completed = first.events.find((event) => event.kind === "completed");
    if (completed?.kind !== "completed") throw new Error("Expected hybrid completion.");
    expect(completed).toMatchObject({ insufficient: false });
    expect(completed.message).toMatchObject({
      answerProvenance: {
        statements: [
          {
            evidenceIds: [],
            kind: "model",
            statementId: "S1",
          },
        ],
        version: 2,
      },
      citations: [],
      content: "Keep tomato leaves dry.",
      status: "completed",
    });

    provider.contextualizedQuestion = "How should tomato leaves be treated?";
    await terminalEvent(
      engine,
      "What about those leaves?",
      completed.message.threadId,
      "strict-grounded",
    );
    expect(provider.contextualizationRequests.at(-1)?.history).toContainEqual({
      content: "Keep tomato leaves dry.",
      role: "assistant",
    });
    engine.close();
  });

  it("answers from the model draft instead of refusing when the library is silent and verification fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-hybrid-silent-fallback-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Tomato notes.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.verificationAcceptable = false;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const { events } = await terminalEvent(
      engine,
      "unanswerable tomato question",
      undefined,
      null,
    );
    const completed = events.find((event) => event.kind === "completed");
    if (completed?.kind !== "completed") throw new Error("Expected hybrid completion.");
    // The library covers nothing and verification rejects the drafted
    // statements, yet Hybrid still returns the model's own answer (labeled),
    // never the canned "does not contain" refusal.
    expect(completed).toMatchObject({ fallback: true, insufficient: false });
    expect(completed.message.content).toBe("Keep tomato leaves dry.");
    expect(completed.message.content).not.toContain("does not contain");
    expect(completed.message).toMatchObject({
      answerProvenance: {
        stages: { verification: { status: "failed" } },
        statements: [{ evidenceIds: [], kind: "model", statementId: "S1" }],
        version: 2,
      },
      citations: [],
      status: "completed",
    });
    expect(provider.closedBookRequests).toEqual([
      { question: "unanswerable tomato question" },
    ]);
    engine.close();
  });

  it.each(["generation", "verification"] as const)(
    "deterministically renders canonical claims when %s fails",
    async (failedStage) => {
      const root = await mkdtemp(join(tmpdir(), `knosys-rag-hybrid-${failedStage}-fallback-`));
      const source = join(root, "tomatoes.txt");
      await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
      const provider = new FakeInferenceProvider();
      if (failedStage === "generation") provider.failEvidenceFirstGeneration = true;
      else provider.verificationAcceptable = false;
      const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
        inferenceProvider: provider,
      });
      await engine.importPaths([source]);
      await engine.initializeRag();
      await waitForBackfill(engine);

      const { events } = await terminalEvent(
        engine,
        "How should tomatoes be watered?",
        undefined,
        null,
      );
      const completed = events.find((event) => event.kind === "completed");
      if (completed?.kind !== "completed") throw new Error("Expected hybrid completion.");
      expect(completed).toMatchObject({ fallback: true });
      expect(completed.message.content).toBe("Keep tomato leaves dry.");
      expect(completed.message.citations).toHaveLength(1);
      const provenance = completed.message.answerProvenance;
      if (provenance?.version !== 2) throw new Error("Expected V2 provenance.");
      expect(provenance.stages[failedStage].status).toBe("failed");
      expect(provenance.statements).toEqual([
        {
          evidenceIds: ["E1"],
          kind: "library",
          statementId: "S1",
          text: "Keep tomato leaves dry.",
        },
      ]);
      engine.close();
    },
  );

  it("cancels evidence-first generation without entering a fallback stage", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-hybrid-cancel-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.evidenceFirstGenerationBlocks = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);
    const events: RagChatEvent[] = [];
    const acceptance = await engine.startChat(
      { question: "How should tomatoes be watered?" },
      (event) => events.push(event),
    );
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "status", status: "synthesizing" }),
      ),
    );
    engine.cancelChat(acceptance.runId);
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
    expect(events.some((event) => event.kind === "completed" || event.kind === "failed")).toBe(
      false,
    );
    expect(provider.evidenceFirstVerificationRequests).toEqual([]);
    engine.close();
  });

  it("streams hybrid statement deltas and keeps partial content when cancelled", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-hybrid-stream-cancel-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.evidenceFirstStreamBlocksAfterFirstStatement = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);
    const events: RagChatEvent[] = [];
    const acceptance = await engine.startChat(
      { question: "How should tomatoes be watered?" },
      (event) => events.push(event),
    );
    await vi.waitFor(() => {
      expect(events.some((event) => event.kind === "delta")).toBe(true);
    });
    const cancelled = engine.cancelChat(acceptance.runId);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.content).toBe("Keep tomato leaves dry.");
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
    expect(
      events.some((event) => event.kind === "completed" || event.kind === "failed"),
    ).toBe(false);
    expect(provider.evidenceFirstVerificationRequests).toEqual([]);
    engine.close();
  });

  it("deletes a chat thread after cancelling its active run", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-thread-delete-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.evidenceFirstGenerationBlocks = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);
    const events: RagChatEvent[] = [];
    const acceptance = await engine.startChat(
      { question: "How should tomatoes be watered?" },
      (event) => events.push(event),
    );
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "status", status: "synthesizing" }),
      ),
    );
    const result = engine.deleteChatThread(acceptance.thread.id);
    expect(result).toEqual({ deletedThreadId: acceptance.thread.id });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
    expect(() => engine.getChatThread(acceptance.thread.id)).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_THREAD_NOT_FOUND",
      }),
    );
    expect(
      engine.listChatThreads().some((thread) => thread.id === acceptance.thread.id),
    ).toBe(false);
    expect(() => engine.deleteChatThread(acceptance.thread.id)).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_THREAD_NOT_FOUND",
      }),
    );
    engine.close();
  });

  it("renames chat threads and validates titles", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-thread-rename-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);
    const { events } = await terminalEvent(
      engine,
      "How should tomato plants be watered?",
      undefined,
      null,
    );
    const completed = events.find((event) => event.kind === "completed");
    if (completed?.kind !== "completed") throw new Error("Expected hybrid completion.");
    const threadId = completed.message.threadId;

    const renamed = engine.renameChatThread(threadId, "  Watering guide  ");
    expect(renamed.title).toBe("Watering guide");
    expect(renamed.id).toBe(threadId);
    expect(engine.listChatThreads()[0]?.title).toBe("Watering guide");
    expect(() => engine.renameChatThread(threadId, "   ")).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({ code: "INVALID_REQUEST" }),
    );
    expect(() => engine.renameChatThread(threadId, "x".repeat(513))).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({ code: "INVALID_REQUEST" }),
    );
    expect(() =>
      engine.renameChatThread("00000000-0000-4000-8000-000000000000", "Title"),
    ).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_THREAD_NOT_FOUND",
      }),
    );
    engine.close();
  });

  it("manages chat folders and moves threads between them", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-folders-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const folder = engine.createChatFolder("  Garden research  ");
    expect(folder.name).toBe("Garden research");
    expect(engine.listChatFolders()).toEqual([folder]);
    expect(engine.renameChatFolder(folder.id, "Garden notes").name).toBe("Garden notes");
    expect(() => engine.createChatFolder("   ")).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({ code: "INVALID_REQUEST" }),
    );
    expect(() =>
      engine.renameChatFolder("00000000-0000-4000-8000-000000000000", "Title"),
    ).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_FOLDER_NOT_FOUND",
      }),
    );

    const { events } = await terminalEvent(
      engine,
      "How should tomato plants be watered?",
      undefined,
      null,
    );
    const completed = events.find((event) => event.kind === "completed");
    if (completed?.kind !== "completed") throw new Error("Expected completion.");
    const threadId = completed.message.threadId;
    expect(engine.getChatThread(threadId).folderId).toBeNull();

    const moved = engine.moveChatThread(threadId, folder.id);
    expect(moved).toMatchObject({ folderId: folder.id, id: threadId });
    expect(engine.moveChatThread(threadId, null).folderId).toBeNull();
    expect(() =>
      engine.moveChatThread(threadId, "00000000-0000-4000-8000-000000000000"),
    ).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_FOLDER_NOT_FOUND",
      }),
    );
    expect(() =>
      engine.moveChatThread("00000000-0000-4000-8000-000000000000", folder.id),
    ).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_THREAD_NOT_FOUND",
      }),
    );
    engine.close();
  });

  it("deletes a folder after cancelling active runs on its threads", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-folder-delete-"));
    const source = join(root, "tomatoes.txt");
    await writeFile(source, "Keep tomato leaves dry when watering.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.evidenceFirstGenerationBlocks = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const folder = engine.createChatFolder("Garden research");
    const events: RagChatEvent[] = [];
    const acceptance = await engine.startChat(
      { question: "How should tomatoes be watered?" },
      (event) => events.push(event),
    );
    await vi.waitFor(() =>
      expect(events).toContainEqual(
        expect.objectContaining({ kind: "status", status: "synthesizing" }),
      ),
    );
    engine.moveChatThread(acceptance.thread.id, folder.id);

    const result = engine.deleteChatFolder(folder.id);
    expect(result).toEqual({
      deletedFolderId: folder.id,
      deletedThreadIds: [acceptance.thread.id],
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
    expect(() => engine.getChatThread(acceptance.thread.id)).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_THREAD_NOT_FOUND",
      }),
    );
    expect(engine.listChatFolders()).toEqual([]);
    expect(() => engine.deleteChatFolder(folder.id)).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({
        code: "CHAT_FOLDER_NOT_FOUND",
      }),
    );
    engine.close();
  });

  it("deletes documents, removes managed files, and orphans citations gracefully", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-document-delete-"));
    const dataRoot = join(root, "app-data");
    const content = "Keep tomato leaves dry when watering.";
    const source = join(root, "tomatoes.txt");
    await writeFile(source, content, "utf8");
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);
    const { events } = await terminalEvent(
      engine,
      "How should tomato plants be watered?",
      undefined,
      null,
    );
    const completed = events.find((event) => event.kind === "completed");
    if (completed?.kind !== "completed") throw new Error("Expected hybrid completion.");
    const citation = completed.message.citations[0];
    if (citation === undefined) throw new Error("Expected a citation.");
    const documentId = engine.getSnapshot().documents[0]!.id;
    const checksum = createHash("sha256").update(content).digest("hex");
    const managedPath = join(
      dataRoot,
      "library",
      "sources",
      checksum.slice(0, 2),
      `${checksum}.txt`,
    );
    expect(existsSync(managedPath)).toBe(true);

    const result = await engine.deleteDocument(documentId);
    expect(result.deletedDocumentId).toBe(documentId);
    expect(result.snapshot.documents).toEqual([]);
    expect(existsSync(managedPath)).toBe(false);
    expect(engine.search("tomato")).toEqual([]);
    expect(engine.getCitation(citation.id).text).toBe(citation.text);
    expect(() => engine.getSourceWindow(citation.chunkId)).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({ code: "SOURCE_NOT_FOUND" }),
    );
    await expect(engine.deleteDocument(documentId)).rejects.toMatchObject({
      code: "DOCUMENT_NOT_FOUND",
    });

    const reimported = await engine.importPaths([source]);
    expect(reimported.imported).toBe(1);
    expect(engine.getSnapshot().documents).toHaveLength(1);
    engine.close();
  });

  it("pulls a model with throttled progress events and refreshes the catalog", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-model-pull-"));
    const provider = new FakeInferenceProvider();
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.initializeRag();
    const events: RagModelPullEvent[] = [];
    const acceptance = engine.startModelPull("qwen3:8b", (event) => events.push(event));
    expect(acceptance).toEqual({ accepted: true, model: "qwen3:8b" });
    expect(events[0]).toMatchObject({ kind: "model-pull", status: "starting" });

    await vi.waitFor(() => {
      expect(events.at(-1)).toMatchObject({ status: "completed" });
    });
    expect(provider.pullRequests).toEqual(["qwen3:8b"]);
    const statuses = events.map(({ status }) => status);
    expect(statuses[0]).toBe("starting");
    expect(statuses).toContain("downloading");
    expect(statuses).toContain("verifying");
    expect(statuses.at(-1)).toBe("completed");
    const downloading = events.filter(({ status }) => status === "downloading");
    expect(downloading.at(-1)).toMatchObject({
      completedBytes: 640_000_000,
      totalBytes: 640_000_000,
    });
    expect(engine.cancelModelPull("qwen3:8b")).toEqual({
      cancelled: false,
      model: "qwen3:8b",
    });
    engine.close();
  });

  it("deduplicates concurrent pulls and cancels an active pull", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-model-pull-cancel-"));
    const provider = new FakeInferenceProvider();
    provider.pullBlocksAfterFirstFrame = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.initializeRag();
    const events: RagModelPullEvent[] = [];
    engine.startModelPull("qwen3:8b", (event) => events.push(event));
    engine.startModelPull("qwen3:8b", (event) => events.push(event));
    expect(provider.pullRequests).toEqual(["qwen3:8b"]);
    expect(events.filter(({ status }) => status === "starting")).toHaveLength(1);

    expect(engine.cancelModelPull("qwen3:8b")).toEqual({
      cancelled: true,
      model: "qwen3:8b",
    });
    await vi.waitFor(() => {
      expect(events.at(-1)).toMatchObject({ status: "cancelled" });
    });
    expect(events.some(({ status }) => status === "completed")).toBe(false);
    engine.close();
  });

  it("reports a failed pull with the provider error message", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-model-pull-fail-"));
    const provider = new FakeInferenceProvider();
    provider.failPull = true;
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.initializeRag();
    const events: RagModelPullEvent[] = [];
    engine.startModelPull("qwen3:8b", (event) => events.push(event));
    await vi.waitFor(() => {
      expect(events.at(-1)).toMatchObject({ status: "failed" });
    });
    expect(events.at(-1)?.error).toContain("Ollama request failed");
    // A failed pull frees the slot for a retry.
    engine.startModelPull("qwen3:8b", (event) => events.push(event));
    expect(provider.pullRequests).toEqual(["qwen3:8b", "qwen3:8b"]);
    engine.close();
  });

  it("persists insufficient evidence without invoking answer streaming", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-insufficient-"));
    const source = join(root, "notes.txt");
    await writeFile(source, "Tomato notes.", "utf8");
    const provider = new FakeInferenceProvider();
    const stream = vi.spyOn(provider, "streamAnswer");
    const engine = new KnowledgeEngine(join(root, "app-data"), vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const { events } = await terminalEvent(engine, "unanswerable tomato question");
    const completed = events.find((event) => event.kind === "completed");
    expect(completed).toMatchObject({ insufficient: true });
    if (completed?.kind !== "completed") throw new Error("Expected a completed chat event.");
    expect(completed.message).toMatchObject({
      content: "The supplied evidence does not contain the information needed to answer the question.",
      status: "insufficient",
    });
    expect(stream).not.toHaveBeenCalled();
    engine.close();
  });

  it("cancels once and recovers interrupted semantic jobs and chat runs on startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-rag-recovery-"));
    const dataRoot = join(root, "app-data");
    const source = join(root, "cancel.txt");
    await writeFile(source, "Keep tomato leaves dry.", "utf8");
    const provider = new FakeInferenceProvider();
    provider.streamBlocks = true;
    const engine = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: provider,
    });
    await engine.importPaths([source]);
    await engine.initializeRag();
    await waitForBackfill(engine);

    const events: RagChatEvent[] = [];
    const acceptance = await engine.startChat(
      { mode: "strict-grounded", question: "How should tomatoes be watered?" },
      (event) => events.push(event),
    );
    await vi.waitFor(() => {
      expect(events.some((event) => event.kind === "delta")).toBe(true);
    });
    const cancelled = engine.cancelChat(acceptance.runId);
    expect(cancelled.status).toBe("cancelled");
    expect(() => engine.cancelChat(acceptance.runId)).toThrowError(
      expect.objectContaining<Partial<EngineOperationError>>({ code: "CHAT_RUN_NOT_FOUND" }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(events.filter((event) => event.kind === "cancelled")).toHaveLength(1);
    expect(events.filter((event) => ["completed", "failed"].includes(event.kind))).toHaveLength(0);
    engine.close();

    const database = new KnosysDatabase(
      join(dataRoot, "state", "knosys-rag.sqlite"),
      vectorExtensionPath,
    );
    const profile = database.registerEmbeddingProfile({
      digest: "sha256:" + "9".repeat(64),
      dimensions: 1,
      inputVersion: "recovery-test-v1",
      model: "recovery-embedding",
      provider: "test",
    });
    const semanticJob = database.createSemanticIndexJob({ embeddingProfileId: profile.id });
    database.updateSemanticIndexJob(semanticJob.id, { status: "running" });
    const chatRun = database.createChatRun({ userContent: "Interrupted question" });
    database.updateChatRun(chatRun.runId, { status: "retrieving" });
    database.close();

    const recovered = new KnowledgeEngine(dataRoot, vectorExtensionPath, {
      inferenceProvider: new FakeInferenceProvider(),
    });
    const check = new KnosysDatabase(
      join(dataRoot, "state", "knosys-rag.sqlite"),
      vectorExtensionPath,
    );
    expect(check.getSemanticIndexJob(semanticJob.id)?.status).toBe("interrupted");
    expect(check.getChatThread(chatRun.thread.id)?.messages.at(-1)).toMatchObject({
      errorCode: "APP_INTERRUPTED",
      status: "interrupted",
    });
    check.close();
    recovered.close();
  });
});
