/// <reference lib="dom" />

import { createHash, randomUUID } from "node:crypto";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
} from "node:fs";
import {
  chmod,
  link,
  lstat,
  open,
  readdir,
  realpath,
  rm,
  stat,
} from "node:fs/promises";
import { basename, extname, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";

import {
  documentFormatFromFilename,
  isAvailableSourceFilename,
  isSupportedSourceFilename,
  type DocumentFormat,
} from "@knosys-rag/core";
import {
  chunkDocument,
  DocumentParseError,
  ingestionVersions,
  parseDocumentBytes,
} from "@knosys-rag/ingestion";
import {
  compatibleGenerationModels,
  DEFAULT_EMBEDDING_PROFILE,
  EVIDENCE_FIRST_ANSWER_PROMPT_VERSION,
  EVIDENCE_FIRST_VERIFICATION_PROMPT_VERSION,
  generationModelIncompatibility,
  generationProfileForModel,
  InferenceError,
  OllamaAdapter,
  QUERY_EMBEDDING_INSTRUCTION_VERSION,
  QUESTION_CONTEXTUALIZATION_VERSION,
  UNCONFIGURED_GENERATION_PROFILE,
  type AnswerStreamProvider,
  type CanonicalLibraryClaim,
  type ClaimReconciliationProvider,
  type ClosedBookAnswerProvider,
  type ConversationMessage,
  type EmbeddingProvider,
  type EvidenceFirstAnswerProvider,
  type EvidenceFirstAnswerResult,
  type EvidenceFirstVerificationProvider,
  type GenerationModelProfile,
  type GroundedAnswerabilityProvider,
  type GroundedPlanProvider,
  type HybridEvidenceId,
  type HybridSynthesisProvider,
  type HybridSynthesisVerificationProvider,
  type InferenceRequestOptions,
  type ModelDescriptor,
  type ModelPullProgress,
  type QuestionContextualizer,
} from "@knosys-rag/inference";
import {
  GROUNDED_DERIVATION_GUIDANCE_VERSION,
  GroundedAnswerOrchestrator,
  canonicalEvidenceFirstStatements,
  renderEvidenceFirstNarrative,
  validateEvidenceFirstAnswer,
  validateEvidenceFirstVerification,
  type AnswerProvenanceStage,
  type AnswerRoutingDiagnostics,
  type AnswerProvenance,
  type AnswerProvenanceV2,
  type EvidenceConfidenceEnvironment,
  type GroundedAnswerResult,
} from "@knosys-rag/answering";
import {
  HybridRetriever,
  RetrievalUnavailableError,
  type RequestedRetrievalMode,
  type RetrievalEvidence,
  type RetrievalPoolCandidate,
  type RetrievalResult,
} from "@knosys-rag/retrieval";
import {
  KnosysDatabase,
  type ChatCitation,
  type ChatCitationInput,
  type ChatMessage,
  type ChatThread,
  type ChatThreadSummary,
  type EmbeddingProfile,
  type EvidenceResult,
  type LibrarySnapshot,
  type SearchResult,
  type SemanticIndexJob,
  type SourceBlock,
  type StoredSourceLocator,
} from "@knosys-rag/storage-sqlite";

const MEBIBYTE = 1024 * 1024;
const MAX_TEXT_IMPORT_BYTES = 32 * MEBIBYTE;
const MAX_STRUCTURED_IMPORT_BYTES = 256 * MEBIBYTE;
const EMBEDDING_BATCH_SIZE = 32;
const DEFAULT_RETRIEVAL_TOP_K = 12;
const MAX_CONVERSATION_HISTORY_CHARACTERS = 8_000;
const MAX_CONVERSATION_HISTORY_MESSAGE_CHARACTERS = 3_000;
const MAX_CONVERSATION_HISTORY_MESSAGES = 8;
const MAX_CONTEXTUALIZED_QUESTION_CHARACTERS = 8_000;
const MODEL_PULL_TIMEOUT_MS = 6 * 60 * 60 * 1_000;
const MODEL_PULL_PROGRESS_STEP_BYTES = 8 * MEBIBYTE;

export const DOCUMENT_EMBEDDING_INPUT_VERSION = "chunk-content-v1" as const;
export type AnswerMode = "labeled-hybrid" | "strict-grounded";

export type EngineOperationErrorCode =
  | "CHAT_CANCELLED"
  | "CHAT_FAILED"
  | "CHAT_FOLDER_NOT_FOUND"
  | "CHAT_RUN_NOT_ACTIVE"
  | "CHAT_RUN_NOT_FOUND"
  | "CHAT_THREAD_NOT_FOUND"
  | "DOCUMENT_IMPORT_IN_PROGRESS"
  | "DOCUMENT_NOT_FOUND"
  | "ENGINE_UNAVAILABLE"
  | "EVIDENCE_NOT_FOUND"
  | "INTERNAL_ERROR"
  | "INVALID_REQUEST"
  | "RAG_EMBEDDING_UNAVAILABLE"
  | "RAG_GENERATION_MODEL_NOT_CAPABLE"
  | "RAG_GENERATION_MODEL_NOT_INSTALLED"
  | "RAG_GENERATION_UNAVAILABLE"
  | "RAG_RUNTIME_UNAVAILABLE"
  | "SOURCE_NOT_FOUND";

export class EngineOperationError extends Error {
  public readonly code: EngineOperationErrorCode;
  public readonly details: unknown;

  public constructor(
    code: EngineOperationErrorCode,
    message: string,
    options: { readonly cause?: unknown; readonly details?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "EngineOperationError";
    this.code = code;
    this.details = options.details;
  }
}

export interface RagInferenceProvider
  extends EmbeddingProvider,
    GroundedAnswerabilityProvider,
    GroundedPlanProvider,
    AnswerStreamProvider,
    QuestionContextualizer,
    EvidenceFirstAnswerProvider,
    EvidenceFirstVerificationProvider,
    ClosedBookAnswerProvider,
    ClaimReconciliationProvider,
    HybridSynthesisProvider,
    HybridSynthesisVerificationProvider {
  describeModel(
    model: string,
    options?: InferenceRequestOptions,
  ): Promise<ModelDescriptor>;
  listModels(options?: InferenceRequestOptions): Promise<readonly ModelDescriptor[]>;
  pullModel(
    model: string,
    options?: InferenceRequestOptions,
  ): AsyncIterable<ModelPullProgress>;
}

export interface RagModelProvider {
  describeModel(
    model: string,
    options?: InferenceRequestOptions,
  ): Promise<ModelDescriptor>;
  listModels(options?: InferenceRequestOptions): Promise<readonly ModelDescriptor[]>;
  pullModel(
    model: string,
    options?: InferenceRequestOptions,
  ): AsyncIterable<ModelPullProgress>;
}

export interface KnowledgeEngineOptions {
  readonly answerabilityProvider?: GroundedAnswerabilityProvider;
  readonly answerStreamProvider?: AnswerStreamProvider;
  readonly claimReconciliationProvider?: ClaimReconciliationProvider;
  readonly closedBookAnswerProvider?: ClosedBookAnswerProvider;
  readonly embeddingProvider?: EmbeddingProvider;
  readonly evidenceFirstAnswerProvider?: EvidenceFirstAnswerProvider;
  readonly evidenceFirstVerificationProvider?: EvidenceFirstVerificationProvider;
  readonly generationProviderFactory?: (
    profile: GenerationModelProfile,
  ) => GroundedAnswerabilityProvider &
    GroundedPlanProvider &
    AnswerStreamProvider &
    QuestionContextualizer &
    EvidenceFirstAnswerProvider &
    EvidenceFirstVerificationProvider &
    ClosedBookAnswerProvider &
    ClaimReconciliationProvider &
    HybridSynthesisProvider &
    HybridSynthesisVerificationProvider;
  readonly hybridSynthesisProvider?: HybridSynthesisProvider;
  readonly hybridSynthesisVerificationProvider?: HybridSynthesisVerificationProvider;
  readonly inferenceProvider?: RagInferenceProvider;
  readonly modelProvider?: RagModelProvider;
  readonly planProvider?: GroundedPlanProvider;
  readonly questionContextualizer?: QuestionContextualizer;
}

export type RagRuntimeUnavailableReason =
  | "not-installed"
  | "not-running"
  | "request-failed"
  | "unexpected-response";

export interface RagRuntimeAvailable {
  readonly installDetected: boolean;
  readonly provider: "ollama";
  readonly state: "available";
}

export interface RagRuntimeUnavailable {
  readonly installDetected: boolean;
  readonly provider: "ollama";
  readonly reason: RagRuntimeUnavailableReason;
  readonly state: "unavailable";
}

export type RagRuntimeStatus = RagRuntimeAvailable | RagRuntimeUnavailable;

export interface RagEmbeddingModelStatus {
  readonly capabilities: ModelDescriptor["capabilities"];
  readonly capable: boolean;
  readonly digest: string | null;
  readonly installed: boolean;
  readonly model: typeof DEFAULT_EMBEDDING_PROFILE.model;
  readonly provider: "ollama";
}

export interface RagEmbeddingProfile {
  readonly createdAt: string;
  readonly digest: string;
  readonly dimensions: number;
  readonly id: string;
  readonly inputVersion: string;
  readonly model: string;
  readonly provider: string;
  readonly updatedAt: string;
}

export interface RagGenerationModelOption {
  readonly capabilities: ModelDescriptor["capabilities"];
  readonly capable: boolean;
  readonly digest: string | null;
  readonly installed: boolean;
  readonly incompatibilityReason: ReturnType<typeof generationModelIncompatibility>;
  readonly model: string;
  readonly nativeContextWindow: number | null;
  readonly provider: "ollama";
  readonly sizeBytes: number;
}

export interface RagGenerationModelSelection {
  readonly contextWindow: number;
  readonly digest: string;
  readonly model: string;
  readonly provider: string;
  readonly sizeBytes: number;
}

export interface RagEmbeddingCoverage {
  readonly currentChunks: number;
  readonly missingChunks: number;
  readonly ratio: number;
  readonly staleChunks: number;
  readonly totalChunks: number;
}

export interface RagSemanticJob {
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly embeddingProfileId: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly processedChunks: number;
  readonly startedAt: string | null;
  readonly status: SemanticIndexJob["status"];
  readonly totalChunks: number;
  readonly updatedAt: string;
}

export interface RagStatus {
  readonly embedding: {
    readonly coverage: RagEmbeddingCoverage | null;
    readonly latestJob: RagSemanticJob | null;
    readonly model: RagEmbeddingModelStatus;
    readonly profile: RagEmbeddingProfile | null;
  };
  readonly generation: {
    readonly options: readonly RagGenerationModelOption[];
    readonly selectionMode: "auto" | "manual";
    readonly selected: RagGenerationModelSelection | null;
  };
  readonly runtime: RagRuntimeStatus;
}

export interface RagRetrievalResult {
  readonly candidates: RetrievalResult["candidates"];
  readonly trace: RetrievalResult["trace"];
}

export interface RagChatCitation {
  readonly chunkId: string;
  readonly createdAt: string;
  readonly documentId: string;
  readonly evidenceId: string;
  readonly headingPath: readonly string[];
  readonly id: string;
  readonly messageId: string;
  readonly ordinal: number;
  readonly retrievalComponentScores: ChatCitation["retrievalComponentScores"];
  readonly sourceLocator: object;
  readonly text: string;
  readonly title: string;
}

export interface RagChatMessage {
  readonly answerProvenance: AnswerProvenance | null;
  readonly citations: readonly RagChatCitation[];
  readonly content: string;
  readonly createdAt: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly model: string | null;
  readonly ordinal: number;
  readonly role: ChatMessage["role"];
  readonly routingDiagnostics: RagAnswerRoutingDiagnostics | null;
  readonly runId: string | null;
  readonly status: ChatMessage["status"];
  readonly threadId: string;
  readonly updatedAt: string;
}

export interface RagAnswerRoutingDiagnostics extends AnswerRoutingDiagnostics {
  readonly generationModel: {
    readonly digest: string;
    readonly model: string;
  };
}

export interface RagChatThreadSummary {
  readonly createdAt: string;
  readonly folderId: string | null;
  readonly id: string;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
  readonly messageCount: number;
  readonly title: string;
  readonly updatedAt: string;
}

export interface RagChatFolder {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface RagChatThread extends RagChatThreadSummary {
  readonly messages: readonly RagChatMessage[];
}

export interface RagSourceBlock {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly endLine: number | null;
  readonly headingPath: readonly string[];
  readonly id: string;
  readonly ordinal: number;
  readonly pageNumber: number | null;
  readonly sourceFragment: string | null;
  readonly sourcePath: string | null;
  readonly startLine: number | null;
  readonly text: string;
  readonly type: string;
}

export interface StartChatInput {
  readonly mode?: AnswerMode;
  readonly question: string;
  readonly threadId?: string;
}

export interface ChatRunAcceptance {
  readonly accepted: true;
  readonly assistantMessage: RagChatMessage;
  readonly runId: string;
  readonly thread: RagChatThreadSummary;
  readonly userMessage: RagChatMessage;
}

interface RagChatEventBase {
  readonly runId: string;
  readonly sequence: number;
}

export interface RagChatStatusEvent extends RagChatEventBase {
  readonly kind: "status";
  readonly status:
    | "background"
    | "generating"
    | "planning"
    | "reconciling"
    | "retrieving"
    | "routing"
    | "synthesizing"
    | "verifying";
}

export interface RagChatRoutingEvent extends RagChatEventBase {
  readonly diagnostics: RagAnswerRoutingDiagnostics;
  readonly kind: "routing";
}

export interface RagChatDeltaEvent extends RagChatEventBase {
  readonly kind: "delta";
  readonly text: string;
}

export interface RagChatCompletedEvent extends RagChatEventBase {
  readonly fallback: boolean;
  readonly insufficient: boolean;
  readonly kind: "completed";
  readonly message: RagChatMessage;
}

export interface RagChatCancelledEvent extends RagChatEventBase {
  readonly kind: "cancelled";
  readonly message: RagChatMessage;
}

export interface RagChatFailedEvent extends RagChatEventBase {
  readonly kind: "failed";
  readonly message: RagChatMessage;
}

export type RagChatEvent =
  | RagChatCancelledEvent
  | RagChatCompletedEvent
  | RagChatDeltaEvent
  | RagChatFailedEvent
  | RagChatRoutingEvent
  | RagChatStatusEvent;

export type RagChatEventEmitter = (event: RagChatEvent) => void;

export type RagModelPullStatus =
  | "starting"
  | "downloading"
  | "verifying"
  | "completed"
  | "cancelled"
  | "failed";

export interface RagModelPullEvent {
  readonly completedBytes: number | null;
  readonly error: string | null;
  readonly kind: "model-pull";
  readonly model: string;
  readonly status: RagModelPullStatus;
  readonly totalBytes: number | null;
}

export type RagModelPullEventEmitter = (event: RagModelPullEvent) => void;

interface ActiveChatRun {
  readonly answerabilityProvider: GroundedAnswerabilityProvider;
  readonly answerStreamProvider: AnswerStreamProvider;
  readonly claimReconciliationProvider: ClaimReconciliationProvider;
  readonly closedBookAnswerProvider: ClosedBookAnswerProvider;
  readonly controller: AbortController;
  readonly emit: RagChatEventEmitter;
  readonly evidenceFirstAnswerProvider: EvidenceFirstAnswerProvider;
  readonly evidenceFirstVerificationProvider: EvidenceFirstVerificationProvider;
  readonly model: string;
  readonly contextWindow: number;
  readonly confidenceEnvironment: EvidenceConfidenceEnvironment;
  readonly conversationHistory: readonly ConversationMessage[];
  readonly modelDigest: string;
  readonly mode: AnswerMode;
  readonly planProvider: GroundedPlanProvider;
  readonly questionContextualizer: QuestionContextualizer;
  readonly hybridSynthesisProvider: HybridSynthesisProvider;
  readonly hybridSynthesisVerificationProvider: HybridSynthesisVerificationProvider;
  readonly runId: string;
  readonly threadId: string;
  routingDiagnostics: RagAnswerRoutingDiagnostics | null;
  sequence: number;
  terminal: boolean;
}

export interface ImportBatchResult {
  readonly duplicates: number;
  readonly failed: number;
  readonly imported: number;
  readonly items: readonly ImportItemResult[];
  readonly reprocessed: number;
  readonly snapshot: LibrarySnapshot;
  readonly unsupported: number;
}

export interface ImportItemResult {
  readonly documentId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly originalName: string;
  readonly status: "duplicate" | "failed" | "imported" | "reprocessed" | "unsupported";
}

export type ImportProgressStage =
  | "discovering"
  | "checking"
  | "copying"
  | "parsing"
  | "chunking"
  | "indexing"
  | "completed";

export interface ImportProgressEvent {
  readonly completed: number;
  readonly currentName: string | null;
  readonly kind: "import-progress";
  readonly operationId: string;
  readonly stage: ImportProgressStage;
  readonly total: number | null;
}

export interface ImportProgressOptions {
  readonly onProgress?: (event: ImportProgressEvent) => void;
  readonly operationId?: string;
}

interface CopiedSource {
  readonly checksum: string;
  readonly originalRealPath: string;
  readonly sizeBytes: number;
  readonly stagingPath: string;
}

class ImportError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "ImportError";
    this.code = code;
  }
}

function mimeTypeForFormat(format: DocumentFormat): string {
  switch (format) {
    case "text":
      return "text/plain";
    case "markdown":
      return "text/markdown";
    case "html":
      return "text/html";
    case "pdf":
      return "application/pdf";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "epub":
      return "application/epub+zip";
  }
}

function errorDetails(error: unknown): { code: string; message: string } {
  if (error instanceof ImportError || error instanceof DocumentParseError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "IMPORT_FAILED", message: error.message };
  }
  return { code: "IMPORT_FAILED", message: "The source could not be imported." };
}

function maximumImportBytes(format: DocumentFormat): number {
  return ["docx", "epub", "pdf"].includes(format)
    ? MAX_STRUCTURED_IMPORT_BYTES
    : MAX_TEXT_IMPORT_BYTES;
}

function operationError(
  error: unknown,
  fallbackCode: EngineOperationErrorCode,
  fallbackMessage: string,
): EngineOperationError {
  if (error instanceof EngineOperationError) return error;
  if (error instanceof InferenceError) {
    const code: EngineOperationErrorCode =
      error.code === "MODEL_UNAVAILABLE"
        ? "RAG_GENERATION_MODEL_NOT_INSTALLED"
        : error.code === "MODEL_CAPABILITY_MISSING"
          ? "RAG_GENERATION_MODEL_NOT_CAPABLE"
          : error.code === "ABORTED"
            ? "CHAT_CANCELLED"
            : fallbackCode;
    return new EngineOperationError(code, error.message, {
      cause: error,
      details: error.details,
    });
  }
  return new EngineOperationError(
    fallbackCode,
    error instanceof Error ? error.message : fallbackMessage,
    { cause: error },
  );
}

function runtimeUnavailable(error: unknown): RagRuntimeUnavailable {
  const reason: RagRuntimeUnavailableReason =
    error instanceof InferenceError && error.code === "INVALID_RESPONSE"
      ? "unexpected-response"
      : error instanceof InferenceError &&
          ["NETWORK_ERROR", "TIMEOUT", "HTTP_ERROR"].includes(error.code)
        ? "not-running"
        : "request-failed";
  return {
    installDetected: false,
    provider: "ollama",
    reason,
    state: "unavailable",
  };
}

function toRetrievalEvidence(evidence: EvidenceResult): RetrievalEvidence {
  const { end, start } = evidence.sourceLocator;
  const fragment = start.sourceFragment ?? end.sourceFragment ?? undefined;
  const uri = start.sourcePath ?? end.sourcePath ?? undefined;
  return {
    chunkId: evidence.chunkId,
    metadata: {
      headingPath: [...evidence.headingPath],
      sourceChecksum: evidence.sourceChecksum,
      sourceLocator: evidence.sourceLocator,
      title: evidence.title,
    },
    source: {
      documentId: evidence.documentId,
      sourceId: evidence.sourceChecksum,
      sourceName: evidence.title,
      ...(uri === undefined ? {} : { uri }),
      range: {
        ...(end.pageNumber === null || end.pageNumber === start.pageNumber
          ? {}
          : { endPageNumber: end.pageNumber }),
        ...(fragment === undefined ? {} : { fragment }),
        headingPath: [...evidence.headingPath],
        ...(start.pageNumber === null ? {} : { pageNumber: start.pageNumber }),
      },
    },
    text: evidence.text,
  };
}

function toPoolCandidate(
  evidence: EvidenceResult & { readonly score: number },
): RetrievalPoolCandidate {
  return { evidence: toRetrievalEvidence(evidence), score: evidence.score };
}

function toChatCitation(citation: ChatCitation): RagChatCitation {
  return {
    ...citation,
    headingPath: [...citation.headingPath],
    retrievalComponentScores: citation.retrievalComponentScores.map((score) => ({
      ...score,
    })),
    sourceLocator: { ...citation.sourceLocator },
  };
}

function toChatMessage(message: ChatMessage): RagChatMessage {
  return {
    ...message,
    answerProvenance:
      message.answerProvenance === null
        ? null
        : (message.answerProvenance as unknown as AnswerProvenance),
    citations: message.citations.map(toChatCitation),
    routingDiagnostics:
      message.routingDiagnostics as RagAnswerRoutingDiagnostics | null,
  };
}

function hasCompletedHybridProvenance(message: ChatMessage): boolean {
  if (message.answerProvenance === null) return false;
  const provenance = message.answerProvenance as Record<string, unknown>;
  return (
    provenance.mode === "labeled-hybrid" &&
    ((provenance.version === 1 && Array.isArray(provenance.finalSections)) ||
      (provenance.version === 2 && Array.isArray(provenance.statements)))
  );
}

function toThreadSummary(thread: ChatThreadSummary): RagChatThreadSummary {
  return { ...thread };
}

function toChatThread(thread: ChatThread): RagChatThread {
  return {
    ...thread,
    messages: thread.messages.map(toChatMessage),
  };
}

function toSourceBlock(block: SourceBlock): RagSourceBlock {
  return {
    ...block,
    attributes: { ...block.attributes },
    headingPath: [...block.headingPath],
  };
}

function toEmbeddingProfile(profile: EmbeddingProfile): RagEmbeddingProfile {
  return { ...profile };
}

function isStoredSourceLocator(value: unknown): value is StoredSourceLocator {
  if (typeof value !== "object" || value === null) return false;
  const locator = value as Partial<StoredSourceLocator>;
  return (
    typeof locator.chunkId === "string" &&
    typeof locator.documentId === "string" &&
    typeof locator.start === "object" &&
    locator.start !== null &&
    typeof locator.end === "object" &&
    locator.end !== null
  );
}

function recentConversationHistory(
  messages: readonly ChatMessage[],
  beforeOrdinal: number,
): readonly ConversationMessage[] {
  const eligible = messages.filter(
    (message) =>
      message.ordinal < beforeOrdinal &&
      message.content.trim().length > 0 &&
      (message.role === "user"
        ? message.status === "completed"
        : message.status === "completed" &&
          (message.citations.length > 0 || hasCompletedHybridProvenance(message))),
  );
  const history: ConversationMessage[] = [];
  let characters = 0;
  for (let index = eligible.length - 1; index >= 0; index -= 1) {
    if (history.length >= MAX_CONVERSATION_HISTORY_MESSAGES) break;
    const message = eligible[index];
    if (message === undefined) continue;
    const remaining = MAX_CONVERSATION_HISTORY_CHARACTERS - characters;
    if (remaining <= 0) break;
    const content = message.content
      .trim()
      .slice(0, Math.min(remaining, MAX_CONVERSATION_HISTORY_MESSAGE_CHARACTERS));
    if (content.length === 0) continue;
    history.unshift({ content, role: message.role });
    characters += content.length;
  }
  return history;
}

function rethrowIfAborted(error: unknown, signal: AbortSignal): void {
  if (signal.aborted) signal.throwIfAborted();
  if (error instanceof InferenceError && error.code === "ABORTED") throw error;
}

function provenanceStage(
  status: "completed" | "failed" | "skipped",
  fallbackReason: string | null = null,
): AnswerProvenanceStage {
  return { fallbackReason, status };
}

export class KnowledgeEngine {
  readonly #activeChatRuns = new Map<string, ActiveChatRun>();
  readonly #activePulls = new Map<string, AbortController>();
  readonly #embeddingProvider: EmbeddingProvider;
  readonly #generationProviderFactory: (
    profile: GenerationModelProfile,
  ) => GroundedAnswerabilityProvider &
    GroundedPlanProvider &
    AnswerStreamProvider &
    QuestionContextualizer &
    EvidenceFirstAnswerProvider &
    EvidenceFirstVerificationProvider &
    ClosedBookAnswerProvider &
    ClaimReconciliationProvider &
    HybridSynthesisProvider &
    HybridSynthesisVerificationProvider;
  readonly #database: KnosysDatabase;
  readonly #libraryRoot: string;
  readonly #modelProvider: RagModelProvider;
  readonly #sourcesRoot: string;
  readonly #temporaryRoot: string;
  #answerStreamProvider: AnswerStreamProvider;
  #answerabilityProvider: GroundedAnswerabilityProvider;
  #claimReconciliationProvider: ClaimReconciliationProvider;
  #backfillController: AbortController | null = null;
  #backfillPromise: Promise<void> | null = null;
  #backfillRequested = false;
  #closed = false;
  #closedBookAnswerProvider: ClosedBookAnswerProvider;
  #embeddingProfile: EmbeddingProfile | null = null;
  #evidenceFirstAnswerProvider: EvidenceFirstAnswerProvider;
  #evidenceFirstVerificationProvider: EvidenceFirstVerificationProvider;
  #installedModels: readonly ModelDescriptor[] = [];
  #planProvider: GroundedPlanProvider;
  #questionContextualizer: QuestionContextualizer;
  #hybridSynthesisProvider: HybridSynthesisProvider;
  #hybridSynthesisVerificationProvider: HybridSynthesisVerificationProvider;
  #runtime: RagRuntimeStatus = {
    installDetected: false,
    provider: "ollama",
    reason: "request-failed",
    state: "unavailable",
  };
  #ragInitialization: Promise<RagStatus> | null = null;

  public constructor(
    rootPath: string,
    vectorExtensionPath: string,
    options: KnowledgeEngineOptions = {},
  ) {
    this.#libraryRoot = resolve(rootPath);
    this.#sourcesRoot = join(this.#libraryRoot, "library", "sources");
    this.#temporaryRoot = join(this.#libraryRoot, "temp", "imports");
    mkdirSync(this.#sourcesRoot, { recursive: true, mode: 0o700 });
    mkdirSync(this.#temporaryRoot, { recursive: true, mode: 0o700 });
    this.#database = new KnosysDatabase(
      join(this.#libraryRoot, "state", "knosys-rag.sqlite"),
      vectorExtensionPath,
    );
    this.#database.recoverInterruptedJobs();
    this.#database.recoverInterruptedSemanticIndexJobs();
    this.#database.recoverInterruptedChatRuns();
    this.#cleanStagingFiles();

    const defaultProvider = options.inferenceProvider ?? new OllamaAdapter();
    this.#embeddingProvider = options.embeddingProvider ?? defaultProvider;
    this.#modelProvider = options.modelProvider ?? defaultProvider;
    this.#answerabilityProvider = options.answerabilityProvider ?? defaultProvider;
    this.#planProvider = options.planProvider ?? defaultProvider;
    this.#answerStreamProvider = options.answerStreamProvider ?? defaultProvider;
    this.#questionContextualizer = options.questionContextualizer ?? defaultProvider;
    this.#evidenceFirstAnswerProvider =
      options.evidenceFirstAnswerProvider ?? defaultProvider;
    this.#evidenceFirstVerificationProvider =
      options.evidenceFirstVerificationProvider ?? defaultProvider;
    this.#closedBookAnswerProvider = options.closedBookAnswerProvider ?? defaultProvider;
    this.#claimReconciliationProvider =
      options.claimReconciliationProvider ?? defaultProvider;
    this.#hybridSynthesisProvider = options.hybridSynthesisProvider ?? defaultProvider;
    this.#hybridSynthesisVerificationProvider =
      options.hybridSynthesisVerificationProvider ?? defaultProvider;
    this.#generationProviderFactory =
      options.generationProviderFactory ??
      ((profile) => {
        if (
          options.inferenceProvider !== undefined ||
          options.answerabilityProvider !== undefined ||
          options.planProvider !== undefined ||
          options.answerStreamProvider !== undefined ||
          options.questionContextualizer !== undefined ||
          options.evidenceFirstAnswerProvider !== undefined ||
          options.evidenceFirstVerificationProvider !== undefined ||
          options.closedBookAnswerProvider !== undefined ||
          options.claimReconciliationProvider !== undefined ||
          options.hybridSynthesisProvider !== undefined ||
          options.hybridSynthesisVerificationProvider !== undefined
        ) {
          const planProvider = options.planProvider ?? defaultProvider;
          const answerabilityProvider = options.answerabilityProvider ?? defaultProvider;
          const answerStreamProvider = options.answerStreamProvider ?? defaultProvider;
          const questionContextualizer = options.questionContextualizer ?? defaultProvider;
          const evidenceFirstAnswerProvider =
            options.evidenceFirstAnswerProvider ?? defaultProvider;
          const evidenceFirstVerificationProvider =
            options.evidenceFirstVerificationProvider ?? defaultProvider;
          const closedBookAnswerProvider =
              options.closedBookAnswerProvider ?? defaultProvider;
          const claimReconciliationProvider =
              options.claimReconciliationProvider ?? defaultProvider;
          const hybridSynthesisProvider =
              options.hybridSynthesisProvider ?? defaultProvider;
          const hybridSynthesisVerificationProvider =
              options.hybridSynthesisVerificationProvider ?? defaultProvider;
          return {
             generationProfile: profile,
            assessGroundedAnswerability: (request, requestOptions) =>
              answerabilityProvider.assessGroundedAnswerability(request, requestOptions),
            planGroundedAnswer: (request, requestOptions) =>
              planProvider.planGroundedAnswer(request, requestOptions),
            contextualizeQuestion: (request, requestOptions) =>
              questionContextualizer.contextualizeQuestion(request, requestOptions),
            generateEvidenceFirstAnswer: (request, requestOptions) =>
              evidenceFirstAnswerProvider.generateEvidenceFirstAnswer(
                request,
                requestOptions,
              ),
            streamEvidenceFirstAnswer: (request, requestOptions) =>
              evidenceFirstAnswerProvider.streamEvidenceFirstAnswer(
                request,
                requestOptions,
              ),
            verifyEvidenceFirstAnswer: (request, requestOptions) =>
              evidenceFirstVerificationProvider.verifyEvidenceFirstAnswer(
                request,
                requestOptions,
              ),
            generateClosedBookAnswer: (request, requestOptions) =>
              closedBookAnswerProvider.generateClosedBookAnswer(request, requestOptions),
            reconcileClaims: (request, requestOptions) =>
              claimReconciliationProvider.reconcileClaims(request, requestOptions),
            synthesizeHybridAnswer: (request, requestOptions) =>
              hybridSynthesisProvider.synthesizeHybridAnswer(request, requestOptions),
            verifyHybridSynthesis: (request, requestOptions) =>
              hybridSynthesisVerificationProvider.verifyHybridSynthesis(
                request,
                requestOptions,
              ),
            streamAnswer: (request, requestOptions) =>
              answerStreamProvider.streamAnswer(request, requestOptions),
          };
        }
        return new OllamaAdapter({
          embeddingProfile: DEFAULT_EMBEDDING_PROFILE,
          generationProfile: profile,
        });
      });

    const settings = this.#database.getSelectedModelSettings();
    if (settings.embeddingProfileId !== null) {
      this.#embeddingProfile = this.#database.getEmbeddingProfile(
        settings.embeddingProfileId,
      );
    }
    if (settings.generationModel !== null) {
      this.#activateGenerationProfile({
        contextWindow: settings.generationModel.contextWindow,
        model: settings.generationModel.model,
        temperature: UNCONFIGURED_GENERATION_PROFILE.temperature,
      });
    }
  }

  public close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#backfillController?.abort();
    for (const controller of this.#activePulls.values()) controller.abort();
    this.#activePulls.clear();
    for (const runId of [...this.#activeChatRuns.keys()]) {
      try {
        this.#cancelActiveChat(runId);
      } catch {
        // A recovered external terminal state must not prevent shutdown.
      }
    }
    this.#database.close();
  }

  public async initializeRag(): Promise<RagStatus> {
    if (this.#ragInitialization !== null) return await this.#ragInitialization;
    const initialization = this.#initializeRag();
    this.#ragInitialization = initialization;
    try {
      return await initialization;
    } finally {
      if (this.#ragInitialization === initialization) this.#ragInitialization = null;
    }
  }

  async #initializeRag(): Promise<RagStatus> {
    this.#assertOpen();
    try {
      this.#installedModels = await this.#modelProvider.listModels();
      this.#runtime = {
        installDetected: true,
        provider: "ollama",
        state: "available",
      };

      const embeddingModel = this.#installedModels.find(
        (model) => model.name === DEFAULT_EMBEDDING_PROFILE.model,
      );
      if (embeddingModel?.capabilities.includes("embedding")) {
        this.#embeddingProfile = this.#database.registerEmbeddingProfile({
          digest: embeddingModel.digest,
          dimensions: DEFAULT_EMBEDDING_PROFILE.dimensions,
          inputVersion: DOCUMENT_EMBEDDING_INPUT_VERSION,
          model: DEFAULT_EMBEDDING_PROFILE.model,
          provider: embeddingModel.provider,
        });
        this.#database.setSelectedEmbeddingProfile(this.#embeddingProfile.id);
      }

      const settings = this.#database.getSelectedModelSettings();
      const compatible = compatibleGenerationModels(this.#installedModels);
      const persistedDescriptor = compatible.find(
        (model) => model.name === settings.generationModel?.model,
      );
      const descriptor =
        settings.generationSelectionMode === "manual" && persistedDescriptor !== undefined
          ? persistedDescriptor
          : compatible[0] ?? null;
      const mode =
        settings.generationSelectionMode === "manual" && persistedDescriptor !== undefined
          ? "manual"
          : "auto";
      if (descriptor === null) {
        this.#database.setGenerationModelSettings(mode, null);
      } else {
        const profile = generationProfileForModel(descriptor);
        this.#activateGenerationProfile(profile);
        this.#database.setGenerationModelSettings(mode, {
          contextWindow: profile.contextWindow,
          digest: descriptor.digest,
          model: descriptor.name,
          provider: descriptor.provider,
          sizeBytes: descriptor.sizeBytes,
        });
      }
    } catch (error) {
      this.#installedModels = [];
      this.#runtime = runtimeUnavailable(error);
    }

    const embeddingModel = this.#installedModels.find(
      (model) => model.name === DEFAULT_EMBEDDING_PROFILE.model,
    );
    if (
      this.#embeddingProfile !== null &&
      embeddingModel?.capabilities.includes("embedding")
    ) {
      this.#startBackfill();
    }
    return this.getRagStatus();
  }

  public getRagStatus(): RagStatus {
    this.#assertOpen();
    const settings = this.#database.getSelectedModelSettings();
    const selectedProfile =
      settings.embeddingProfileId === null
        ? null
        : this.#database.getEmbeddingProfile(settings.embeddingProfileId);
    const embeddingDescriptor = this.#installedModels.find(
      (model) => model.name === DEFAULT_EMBEDDING_PROFILE.model,
    );
    const rebuildState =
      selectedProfile === null
        ? null
        : this.#database.getEmbeddingRebuildState(selectedProfile.id);

    return {
      embedding: {
        coverage:
          rebuildState === null
            ? null
            : {
                currentChunks: rebuildState.currentChunks,
                missingChunks: rebuildState.missingChunks,
                ratio: rebuildState.ratio,
                staleChunks: rebuildState.staleChunks,
                totalChunks: rebuildState.totalChunks,
              },
        latestJob: rebuildState?.latestJob ?? null,
        model: {
          capabilities: embeddingDescriptor?.capabilities ?? [],
          capable: embeddingDescriptor?.capabilities.includes("embedding") ?? false,
          digest: embeddingDescriptor?.digest ?? null,
          installed: embeddingDescriptor !== undefined,
          model: DEFAULT_EMBEDDING_PROFILE.model,
          provider: "ollama",
        },
        profile: selectedProfile === null ? null : toEmbeddingProfile(selectedProfile),
      },
      generation: {
        options: this.#installedModels
          .filter(
            (descriptor) =>
              descriptor.local &&
              (descriptor.capabilities.includes("completion") ||
                descriptor.metadataError !== null),
          )
          .sort((left, right) =>
            left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
          )
          .map((descriptor) => {
          const incompatibilityReason = generationModelIncompatibility(descriptor);
          return {
            capabilities: descriptor.capabilities,
            capable: incompatibilityReason === null,
            digest: descriptor.digest,
            installed: true,
            incompatibilityReason,
            model: descriptor.name,
            nativeContextWindow: descriptor.nativeContextWindow,
            provider: "ollama" as const,
            sizeBytes: descriptor.sizeBytes,
          };
        }),
        selectionMode: settings.generationSelectionMode,
        selected: settings.generationModel,
      },
      runtime: this.#runtime,
    };
  }

  public async setGenerationModel(
    preference: { readonly mode: "auto" } | { readonly mode: "manual"; readonly model: string },
  ): Promise<RagStatus> {
    this.#assertOpen();
    if (preference.mode === "auto") {
      this.#database.setGenerationModelSettings("auto", null);
      return await this.#initializeRag();
    }
    let descriptor: ModelDescriptor;
    try {
      descriptor = await this.#modelProvider.describeModel(preference.model);
    } catch (error) {
      throw operationError(
        error,
        "RAG_GENERATION_MODEL_NOT_INSTALLED",
        `The generation model ${preference.model} is not installed.`,
      );
    }
    const incompatibility = generationModelIncompatibility(descriptor);
    if (incompatibility !== null) {
      throw new EngineOperationError(
        "RAG_GENERATION_MODEL_NOT_CAPABLE",
        `The model ${preference.model} is incompatible: ${incompatibility}.`,
      );
    }
    this.#installedModels = [
      ...this.#installedModels.filter((candidate) => candidate.name !== descriptor.name),
      descriptor,
    ];
    const profile = generationProfileForModel(descriptor);
    this.#activateGenerationProfile(profile);
    this.#database.setGenerationModelSettings("manual", {
      contextWindow: profile.contextWindow,
      digest: descriptor.digest,
      model: descriptor.name,
      provider: descriptor.provider,
      sizeBytes: descriptor.sizeBytes,
    });
    return this.getRagStatus();
  }

  public async retrieve(
    query: string,
    mode: RequestedRetrievalMode = "hybrid",
    topK = DEFAULT_RETRIEVAL_TOP_K,
  ): Promise<RagRetrievalResult> {
    this.#assertOpen();
    return await this.#retrieve(query, mode, topK);
  }

  async #retrieve(
    query: string,
    mode: RequestedRetrievalMode,
    topK: number,
    signal?: AbortSignal,
  ): Promise<RagRetrievalResult> {
    if (
      query.trim().length === 0 ||
      !["hybrid", "lexical", "vector"].includes(mode) ||
      !Number.isSafeInteger(topK) ||
      topK < 1 ||
      topK > 100
    ) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "Retrieval requires a non-empty query and topK between 1 and 100.",
      );
    }

    const retriever = new HybridRetriever({
      lexicalRetriever: {
        retrieve: async (request) =>
          this.#database
            .searchLexicalEvidence(request.query, request.limit)
            .map(toPoolCandidate),
      },
      queryEmbedder: {
        embed: async (embeddingQuery) => {
          if (this.#embeddingProfile === null) return null;
          return await this.#embeddingProvider.embedQuery(
            embeddingQuery,
            signal === undefined ? undefined : { signal },
          );
        },
      },
      vectorRetriever: {
        retrieve: async (request) => {
          if (this.#embeddingProfile === null) return null;
          return this.#database
            .searchVectors(
              this.#embeddingProfile.id,
              request.embedding,
              request.limit,
            )
            .map(toPoolCandidate);
        },
      },
    });
    try {
      return await retriever.retrieve({ mode, query, topK });
    } catch (error) {
      if (error instanceof RetrievalUnavailableError) {
        throw new EngineOperationError("RAG_EMBEDDING_UNAVAILABLE", error.message, {
          cause: error,
          details: { component: error.component },
        });
      }
      throw operationError(error, "INTERNAL_ERROR", "Retrieval failed.");
    }
  }

  public listChatThreads(limit = 50, offset = 0): readonly RagChatThreadSummary[] {
    this.#assertOpen();
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isSafeInteger(offset) ||
      offset < 0
    ) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "Thread pagination requires a limit from 1 to 100 and a nonnegative offset.",
      );
    }
    return this.#database.listChatThreads(limit, offset).map(toThreadSummary);
  }

  public getChatThread(threadId: string): RagChatThread {
    this.#assertOpen();
    if (threadId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A thread ID is required.");
    }
    const thread = this.#database.getChatThread(threadId);
    if (thread === null) {
      throw new EngineOperationError(
        "CHAT_THREAD_NOT_FOUND",
        `Chat thread ${threadId} does not exist.`,
      );
    }
    return toChatThread(thread);
  }

  public deleteChatThread(threadId: string): { readonly deletedThreadId: string } {
    this.#assertOpen();
    if (threadId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A thread ID is required.");
    }
    // Cancel-first: terminal rows are finalized and cancelled events emitted
    // before the cascade removes them, so no pipeline can write afterwards.
    for (const [runId, active] of [...this.#activeChatRuns]) {
      if (active.threadId !== threadId) continue;
      try {
        this.#cancelActiveChat(runId);
      } catch {
        // A recovered external terminal state must not prevent deletion.
      }
    }
    if (!this.#database.deleteChatThread(threadId)) {
      throw new EngineOperationError(
        "CHAT_THREAD_NOT_FOUND",
        `Chat thread ${threadId} does not exist.`,
      );
    }
    return { deletedThreadId: threadId };
  }

  public renameChatThread(threadId: string, title: string): RagChatThreadSummary {
    this.#assertOpen();
    if (threadId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A thread ID is required.");
    }
    const trimmed = title.trim();
    if (trimmed.length === 0 || trimmed.length > 512) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "Thread titles must contain between 1 and 512 characters.",
      );
    }
    const summary = this.#database.renameChatThread(threadId, trimmed);
    if (summary === null) {
      throw new EngineOperationError(
        "CHAT_THREAD_NOT_FOUND",
        `Chat thread ${threadId} does not exist.`,
      );
    }
    return toThreadSummary(summary);
  }

  public listChatFolders(): readonly RagChatFolder[] {
    this.#assertOpen();
    return this.#database.listChatFolders().map((folder) => ({ ...folder }));
  }

  public createChatFolder(name: string): RagChatFolder {
    this.#assertOpen();
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "Folder names must contain between 1 and 120 characters.",
      );
    }
    return { ...this.#database.createChatFolder(trimmed) };
  }

  public renameChatFolder(folderId: string, name: string): RagChatFolder {
    this.#assertOpen();
    if (folderId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A folder ID is required.");
    }
    const trimmed = name.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "Folder names must contain between 1 and 120 characters.",
      );
    }
    const folder = this.#database.renameChatFolder(folderId, trimmed);
    if (folder === null) {
      throw new EngineOperationError(
        "CHAT_FOLDER_NOT_FOUND",
        `Chat folder ${folderId} does not exist.`,
      );
    }
    return { ...folder };
  }

  public deleteChatFolder(folderId: string): {
    readonly deletedFolderId: string;
    readonly deletedThreadIds: readonly string[];
  } {
    this.#assertOpen();
    if (folderId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A folder ID is required.");
    }
    // Cancel-first, like thread deletion: runs on member threads are finalized
    // and their cancelled events emitted before the cascade removes the rows.
    const memberThreadIds = new Set(this.#database.listChatThreadIdsInFolder(folderId));
    for (const [runId, active] of [...this.#activeChatRuns]) {
      if (!memberThreadIds.has(active.threadId)) continue;
      try {
        this.#cancelActiveChat(runId);
      } catch {
        // A recovered external terminal state must not prevent deletion.
      }
    }
    const result = this.#database.deleteChatFolder(folderId);
    if (!result.deleted) {
      throw new EngineOperationError(
        "CHAT_FOLDER_NOT_FOUND",
        `Chat folder ${folderId} does not exist.`,
      );
    }
    return { deletedFolderId: folderId, deletedThreadIds: result.deletedThreadIds };
  }

  public moveChatThread(
    threadId: string,
    folderId: string | null,
  ): RagChatThreadSummary {
    this.#assertOpen();
    if (threadId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A thread ID is required.");
    }
    const result = this.#database.setChatThreadFolder(threadId, folderId);
    if (!result.moved) {
      if (result.reason === "folder-not-found") {
        throw new EngineOperationError(
          "CHAT_FOLDER_NOT_FOUND",
          `Chat folder ${folderId ?? ""} does not exist.`,
        );
      }
      throw new EngineOperationError(
        "CHAT_THREAD_NOT_FOUND",
        `Chat thread ${threadId} does not exist.`,
      );
    }
    return toThreadSummary(result.summary);
  }

  public getCitation(citationId: string): RagChatCitation {
    this.#assertOpen();
    if (citationId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A citation ID is required.");
    }
    const citation = this.#database.getChatCitation(citationId);
    if (citation === null) {
      throw new EngineOperationError(
        "EVIDENCE_NOT_FOUND",
        `Citation ${citationId} does not exist.`,
      );
    }
    return toChatCitation(citation);
  }

  public getSourceWindow(
    chunkId: string,
    before = 2,
    after = 2,
  ): readonly RagSourceBlock[] {
    this.#assertOpen();
    if (
      chunkId.trim().length === 0 ||
      !Number.isSafeInteger(before) ||
      before < 0 ||
      before > 50 ||
      !Number.isSafeInteger(after) ||
      after < 0 ||
      after > 50
    ) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "Source windows require a chunk ID and before/after counts from 0 to 50.",
      );
    }
    const blocks = this.#database.getSourceBlockWindow(chunkId, before, after);
    if (blocks.length === 0) {
      throw new EngineOperationError(
        "SOURCE_NOT_FOUND",
        `Source chunk ${chunkId} does not exist.`,
      );
    }
    return blocks.map(toSourceBlock);
  }

  public async startChat(
    input: StartChatInput,
    emit: RagChatEventEmitter,
  ): Promise<ChatRunAcceptance> {
    this.#assertOpen();
    const question = input.question.trim();
    const mode = input.mode ?? "labeled-hybrid";
    if (question.length === 0 || question.length > 4_000) {
      throw new EngineOperationError(
        "INVALID_REQUEST",
        "The chat question must contain between 1 and 4000 characters.",
      );
    }
    if (mode !== "labeled-hybrid" && mode !== "strict-grounded") {
      throw new EngineOperationError("INVALID_REQUEST", "The answer mode is invalid.");
    }
    const selection = this.#database.getSelectedModelSettings().generationModel;
    const selectedDescriptor = this.#installedModels.find(
      (model) => model.name === selection?.model && model.digest === selection.digest,
    );
    if (
      selection === null ||
      this.#runtime.state !== "available" ||
      selectedDescriptor === undefined ||
      generationModelIncompatibility(selectedDescriptor) !== null
    ) {
      throw new EngineOperationError(
        "RAG_GENERATION_UNAVAILABLE",
        "No compatible local generation model is currently selected.",
      );
    }

    let run;
    try {
      run = this.#database.createChatRun({
        model: selection.model,
        ...(input.threadId === undefined ? {} : { threadId: input.threadId }),
        userContent: question,
      });
    } catch (error) {
      if (input.threadId !== undefined) {
        throw new EngineOperationError(
          "CHAT_THREAD_NOT_FOUND",
          `Chat thread ${input.threadId} does not exist.`,
          { cause: error },
        );
      }
      throw operationError(error, "INTERNAL_ERROR", "The chat run could not be created.");
    }

    const ragStatus = this.getRagStatus();
    const active: ActiveChatRun = {
      answerabilityProvider: this.#answerabilityProvider,
      answerStreamProvider: this.#answerStreamProvider,
      claimReconciliationProvider: this.#claimReconciliationProvider,
      closedBookAnswerProvider: this.#closedBookAnswerProvider,
      controller: new AbortController(),
      emit,
      evidenceFirstAnswerProvider: this.#evidenceFirstAnswerProvider,
      evidenceFirstVerificationProvider: this.#evidenceFirstVerificationProvider,
      contextWindow: selection.contextWindow,
      confidenceEnvironment: {
        documentEmbeddingInputVersion: DOCUMENT_EMBEDDING_INPUT_VERSION,
        embeddingCoverage: ragStatus.embedding.coverage?.ratio ?? null,
        embeddingDigest: ragStatus.embedding.model.digest,
        embeddingModel: ragStatus.embedding.model.model,
        questionContextualizationVersion: null,
        queryEmbeddingInstructionVersion: QUERY_EMBEDDING_INSTRUCTION_VERSION,
      },
      conversationHistory: recentConversationHistory(
        this.#database.getChatThread(run.thread.id)?.messages ?? [],
        run.userMessage.ordinal,
      ),
      model: selection.model,
      modelDigest: selection.digest,
      mode,
      planProvider: this.#planProvider,
      questionContextualizer: this.#questionContextualizer,
      hybridSynthesisProvider: this.#hybridSynthesisProvider,
      hybridSynthesisVerificationProvider: this.#hybridSynthesisVerificationProvider,
      runId: run.runId,
      sequence: 0,
      terminal: false,
      threadId: run.thread.id,
      routingDiagnostics: null,
    };
    this.#activeChatRuns.set(run.runId, active);
    setImmediate(() => void this.#processChat(active, question));
    return {
      accepted: true,
      assistantMessage: toChatMessage(run.assistantMessage),
      runId: run.runId,
      thread: toThreadSummary(run.thread),
      userMessage: toChatMessage(run.userMessage),
    };
  }

  public cancelChat(runId: string): RagChatMessage {
    this.#assertOpen();
    const message = this.#cancelActiveChat(runId);
    if (message === null) {
      throw new EngineOperationError(
        "CHAT_RUN_NOT_FOUND",
        `Active chat run ${runId} does not exist.`,
      );
    }
    return message;
  }

  public startModelPull(
    model: string,
    emit: RagModelPullEventEmitter,
  ): { readonly accepted: true; readonly model: string } {
    this.#assertOpen();
    const trimmed = model.trim();
    if (trimmed.length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A model name is required.");
    }
    // A pull already in flight for the same model is idempotently accepted;
    // its progress events keep flowing to every window.
    if (!this.#activePulls.has(trimmed)) {
      const controller = new AbortController();
      this.#activePulls.set(trimmed, controller);
      emit(this.#pullEvent(trimmed, "starting"));
      void this.#runModelPull(trimmed, controller, emit);
    }
    return { accepted: true, model: trimmed };
  }

  public cancelModelPull(
    model: string,
  ): { readonly cancelled: boolean; readonly model: string } {
    this.#assertOpen();
    const trimmed = model.trim();
    const controller = this.#activePulls.get(trimmed);
    if (controller === undefined) return { cancelled: false, model: trimmed };
    controller.abort();
    return { cancelled: true, model: trimmed };
  }

  #pullEvent(
    model: string,
    status: RagModelPullStatus,
    details: {
      readonly completedBytes?: number | null;
      readonly error?: string | null;
      readonly totalBytes?: number | null;
    } = {},
  ): RagModelPullEvent {
    return {
      completedBytes: details.completedBytes ?? null,
      error: details.error ?? null,
      kind: "model-pull",
      model,
      status,
      totalBytes: details.totalBytes ?? null,
    };
  }

  async #runModelPull(
    model: string,
    controller: AbortController,
    emit: RagModelPullEventEmitter,
  ): Promise<void> {
    let lastStatus: RagModelPullStatus = "starting";
    let lastCompletedBytes = 0;
    try {
      for await (const progress of this.#modelProvider.pullModel(model, {
        signal: controller.signal,
        timeoutMs: MODEL_PULL_TIMEOUT_MS,
      })) {
        controller.signal.throwIfAborted();
        const raw = progress.status.toLowerCase();
        if (raw === "success") continue;
        const status: RagModelPullStatus = raw.startsWith("verifying")
          ? "verifying"
          : "downloading";
        const completed = progress.completedBytes ?? 0;
        // Progress frames arrive far faster than the UI needs; forward only
        // status changes and meaningful byte advances.
        if (
          status === lastStatus &&
          completed - lastCompletedBytes < MODEL_PULL_PROGRESS_STEP_BYTES
        ) {
          continue;
        }
        lastStatus = status;
        lastCompletedBytes = completed;
        emit(
          this.#pullEvent(model, status, {
            completedBytes: progress.completedBytes,
            totalBytes: progress.totalBytes,
          }),
        );
      }
      if (!this.#closed) {
        try {
          this.#installedModels = await this.#modelProvider.listModels();
        } catch {
          // The 5s status poll refreshes installed models on its own.
        }
      }
      emit(this.#pullEvent(model, "completed"));
    } catch (error) {
      if (controller.signal.aborted) {
        emit(this.#pullEvent(model, "cancelled"));
      } else {
        emit(
          this.#pullEvent(model, "failed", {
            error:
              error instanceof Error && error.message.length > 0
                ? error.message
                : "The model download failed.",
          }),
        );
      }
    } finally {
      if (this.#activePulls.get(model) === controller) {
        this.#activePulls.delete(model);
      }
    }
  }

  #activateGenerationProfile(profile: GenerationModelProfile): void {
    const provider = this.#generationProviderFactory(profile);
    this.#answerabilityProvider = provider;
    this.#planProvider = provider;
    this.#answerStreamProvider = provider;
    this.#questionContextualizer = provider;
    this.#evidenceFirstAnswerProvider = provider;
    this.#evidenceFirstVerificationProvider = provider;
    this.#closedBookAnswerProvider = provider;
    this.#claimReconciliationProvider = provider;
    this.#hybridSynthesisProvider = provider;
    this.#hybridSynthesisVerificationProvider = provider;
  }

  #startBackfill(): void {
    if (
      this.#closed ||
      this.#embeddingProfile === null ||
      this.#runtime.state !== "available"
    ) {
      return;
    }
    if (this.#backfillPromise !== null) {
      this.#backfillRequested = true;
      return;
    }
    this.#backfillRequested = false;
    const controller = new AbortController();
    const profile = this.#embeddingProfile;
    this.#backfillController = controller;
    const backfill = this.#runBackfill(profile, controller.signal);
    this.#backfillPromise = backfill;
    const cleanup = () => {
      if (this.#backfillPromise === backfill) {
        this.#backfillController = null;
        this.#backfillPromise = null;
        if (this.#backfillRequested) this.#startBackfill();
      }
    };
    void backfill.then(cleanup, cleanup);
  }

  async #runBackfill(profile: EmbeddingProfile, signal: AbortSignal): Promise<void> {
    const coverage = this.#database.getEmbeddingCoverage(profile.id);
    const remaining = coverage.missingChunks + coverage.staleChunks;
    if (remaining === 0) return;

    const job = this.#database.createSemanticIndexJob({
      embeddingProfileId: profile.id,
      totalChunks: remaining,
    });
    let processedChunks = 0;
    let totalChunks = remaining;
    this.#database.updateSemanticIndexJob(job.id, {
      processedChunks,
      status: "running",
      totalChunks,
    });

    try {
      while (true) {
        signal.throwIfAborted();
        const work = this.#database.listChunksNeedingEmbedding(
          profile.id,
          EMBEDDING_BATCH_SIZE,
        );
        if (work.length === 0) break;
        totalChunks = Math.max(totalChunks, processedChunks + work.length);
        const embeddings = await this.#embeddingProvider.embedDocuments(
          work.map((item) => item.content),
          { signal },
        );
        signal.throwIfAborted();
        if (embeddings.length !== work.length) {
          throw new EngineOperationError(
            "RAG_EMBEDDING_UNAVAILABLE",
            `Expected ${work.length} embeddings but received ${embeddings.length}.`,
          );
        }
        this.#database.upsertChunkEmbeddings(
          profile.id,
          work.map((item, index) => {
            const embedding = embeddings[index];
            if (embedding === undefined) {
              throw new EngineOperationError(
                "RAG_EMBEDDING_UNAVAILABLE",
                `The embedding provider omitted chunk ${item.chunkId}.`,
              );
            }
            return {
              chunkId: item.chunkId,
              contentHash: item.contentHash,
              embedding,
            };
          }),
        );
        processedChunks += work.length;
        const outstanding = this.#database.getEmbeddingCoverage(profile.id);
        totalChunks = Math.max(
          totalChunks,
          processedChunks + outstanding.missingChunks + outstanding.staleChunks,
        );
        this.#database.updateSemanticIndexJob(job.id, {
          processedChunks,
          status: "running",
          totalChunks,
        });
      }
      this.#database.updateSemanticIndexJob(job.id, {
        processedChunks,
        status: "completed",
        totalChunks: processedChunks,
      });
    } catch (error) {
      if (this.#closed) return;
      const details =
        error instanceof EngineOperationError || error instanceof InferenceError
          ? { code: error.code, message: error.message }
          : {
              code: signal.aborted ? "CHAT_CANCELLED" : "RAG_EMBEDDING_UNAVAILABLE",
              message:
                error instanceof Error ? error.message : "Semantic indexing failed.",
            };
      this.#database.updateSemanticIndexJob(job.id, {
        errorCode: details.code,
        errorMessage: details.message,
        processedChunks,
        status: signal.aborted ? "cancelled" : "failed",
        totalChunks,
      });
    }
  }

  async #processChat(active: ActiveChatRun, question: string): Promise<void> {
    try {
      this.#updateAndEmitStatus(active, "retrieving");
      active.controller.signal.throwIfAborted();
      let groundedQuestion = question;
      let questionContextualizationVersion: string | null = null;
      if (active.conversationHistory.length > 0) {
        groundedQuestion = (
          await active.questionContextualizer.contextualizeQuestion(
            { history: active.conversationHistory, question },
            { signal: active.controller.signal },
          )
        ).trim();
        if (
          groundedQuestion.length === 0 ||
          groundedQuestion.length > MAX_CONTEXTUALIZED_QUESTION_CHARACTERS
        ) {
          throw new EngineOperationError(
            "CHAT_FAILED",
            "The conversation context could not be resolved into a valid question.",
          );
        }
        questionContextualizationVersion = QUESTION_CONTEXTUALIZATION_VERSION;
      }
      active.controller.signal.throwIfAborted();
      if (active.mode === "labeled-hybrid") {
        await this.#processHybridChat(
          active,
          question,
          groundedQuestion,
          questionContextualizationVersion,
        );
        return;
      }
      const retrievalResult = this.#withGroundingContext(
        await this.#retrieve(
          groundedQuestion,
          "hybrid",
          DEFAULT_RETRIEVAL_TOP_K,
          active.controller.signal,
        ),
      );
      active.controller.signal.throwIfAborted();

      const orchestrator = new GroundedAnswerOrchestrator({
        answerabilityProvider: active.answerabilityProvider,
        answerStreamProvider: active.answerStreamProvider,
        confidenceEnvironment: {
          ...active.confidenceEnvironment,
          questionContextualizationVersion,
        },
        contextLimits: {
          maxCharacters: Math.max(4_096, (active.contextWindow - 4_096) * 3),
        },
        planProvider: active.planProvider,
      });
      for await (const event of orchestrator.run(
        { question: groundedQuestion, retrievalResult },
        { signal: active.controller.signal },
      )) {
        if (active.terminal) return;
        if (event.type === "status") {
          this.#updateAndEmitStatus(
            active,
            event.status === "routing"
              ? "routing"
              : event.status === "planning"
                ? "planning"
                : "generating",
          );
          continue;
        }
        if (event.type === "text") {
          this.#database.appendAssistantContent(active.runId, event.text);
          this.#emitChat(active, { kind: "delta", text: event.text });
          continue;
        }
        if (event.type === "routing") {
          const diagnostics: RagAnswerRoutingDiagnostics = {
            ...event.diagnostics,
            generationModel: {
              digest: active.modelDigest,
              model: active.model,
            },
          };
          active.routingDiagnostics = diagnostics;
          this.#database.setChatRoutingDiagnostics(active.runId, diagnostics);
          this.#emitChat(active, { diagnostics, kind: "routing" });
          continue;
        }

        const citations = this.#citationInputs(event.result.citations, retrievalResult);
        if (!this.#claimTerminal(active)) return;
        let message: ChatMessage;
        try {
          message = this.#database.completeChatRun(active.runId, {
            citations,
            content: event.result.text,
            model: active.model,
            routingDiagnostics: active.routingDiagnostics,
            status:
              event.result.status === "insufficient-evidence"
                ? "insufficient"
                : "completed",
          });
        } catch (error) {
          active.terminal = false;
          throw error;
        }
        this.#emitChat(active, {
          fallback: event.result.status === "fallback",
          insufficient: event.result.status === "insufficient-evidence",
          kind: "completed",
          message: toChatMessage(message),
        });
        return;
      }
      throw new EngineOperationError(
        "CHAT_FAILED",
        "The answer pipeline ended without a terminal result.",
      );
    } catch (error) {
      if (active.terminal || active.controller.signal.aborted) return;
      if (!this.#claimTerminal(active)) return;
      const details = operationError(error, "CHAT_FAILED", "The chat run failed.");
      const message = this.#database.failChatRun(active.runId, {
        code: details.code,
        message: details.message,
      });
      this.#emitChat(active, {
        kind: "failed",
        message: toChatMessage(message),
      });
    } finally {
      if (this.#activeChatRuns.get(active.runId) === active) {
        this.#activeChatRuns.delete(active.runId);
      }
    }
  }

  async #processHybridChat(
    active: ActiveChatRun,
    originalQuestion: string,
    resolvedQuestion: string,
    questionContextualizationVersion: string | null,
  ): Promise<void> {
    this.#updateAndEmitStatus(active, "retrieving");
    const retrievalResult = this.#withGroundingContext(
      await this.#retrieve(
        resolvedQuestion,
        "hybrid",
        DEFAULT_RETRIEVAL_TOP_K,
        active.controller.signal,
      ),
    );
    active.controller.signal.throwIfAborted();
    const libraryResult = await this.#groundLibraryDeterministically(
      active,
      resolvedQuestion,
      retrievalResult,
      questionContextualizationVersion,
    );
    active.controller.signal.throwIfAborted();
    const libraryClaims: CanonicalLibraryClaim[] = libraryResult.plan.claims.map(
      (claim, index) => ({
        evidenceIds: claim.evidenceIds as readonly HybridEvidenceId[],
        id: `L${index + 1}`,
        text: claim.text,
      }),
    );
    const evidence = libraryResult.citations.map((citation) => ({
      content: citation.text,
      id: citation.id as HybridEvidenceId,
      ...(citation.source.sourceName === undefined
        ? {}
        : { title: citation.source.sourceName }),
    }));
    const evidenceIds = new Set(evidence.map(({ id }) => id));
    let finalStatements = canonicalEvidenceFirstStatements(libraryClaims);
    let generationStage = provenanceStage("skipped", "generation-not-started");
    let verificationStage = provenanceStage("skipped", "generation-not-completed");
    let usedFallback = false;

    this.#updateAndEmitStatus(active, "synthesizing");
    try {
      let generated: EvidenceFirstAnswerResult | null = null;
      let streamedAny = false;
      for await (const event of active.evidenceFirstAnswerProvider.streamEvidenceFirstAnswer(
        {
          evidence,
          libraryAnswer:
            libraryResult.plan.type === "answer"
              ? libraryResult.plan.answer
              : libraryResult.plan.reason,
          originalQuestion,
          resolvedQuestion,
        },
        { signal: active.controller.signal },
      )) {
        active.controller.signal.throwIfAborted();
        if (event.type === "statement") {
          const text = (streamedAny ? "\n\n" : "") + event.statement.text.trim();
          this.#database.appendAssistantContent(active.runId, text);
          this.#emitChat(active, { kind: "delta", text });
          streamedAny = true;
        } else {
          generated = event.result;
        }
      }
      if (generated === null) {
        throw new EngineOperationError(
          "CHAT_FAILED",
          "The evidence-first answer stream ended without a result.",
        );
      }
      active.controller.signal.throwIfAborted();
      const statements = validateEvidenceFirstAnswer(generated, evidenceIds);
      generationStage = provenanceStage("completed");

      this.#updateAndEmitStatus(active, "verifying");
      try {
        const verification =
          await active.evidenceFirstVerificationProvider.verifyEvidenceFirstAnswer(
            { evidence, originalQuestion, resolvedQuestion, statements },
            { signal: active.controller.signal },
          );
        active.controller.signal.throwIfAborted();
        if (validateEvidenceFirstVerification(verification, statements)) {
          finalStatements = statements;
          verificationStage = provenanceStage("completed");
        } else {
          verificationStage = provenanceStage(
            "failed",
            "evidence-first-verification-rejected",
          );
          usedFallback = true;
        }
      } catch (error) {
        rethrowIfAborted(error, active.controller.signal);
        verificationStage = provenanceStage(
          "failed",
          "evidence-first-verification-failed",
        );
        usedFallback = true;
      }
    } catch (error) {
      rethrowIfAborted(error, active.controller.signal);
      generationStage = provenanceStage("failed", "evidence-first-generation-failed");
      verificationStage = provenanceStage("skipped", "generation-failed");
      usedFallback = true;
    }

    active.controller.signal.throwIfAborted();
    const rendered = renderEvidenceFirstNarrative(finalStatements);
    const content = rendered.length > 0 ? rendered : libraryResult.text;
    const provenance: AnswerProvenanceV2 = {
      generationModel: { digest: active.modelDigest, model: active.model },
      mode: "labeled-hybrid",
      promptVersions: {
        contextualization: questionContextualizationVersion,
        evidenceAnswer: EVIDENCE_FIRST_ANSWER_PROMPT_VERSION,
        groundedDerivation: GROUNDED_DERIVATION_GUIDANCE_VERSION,
        verification: EVIDENCE_FIRST_VERIFICATION_PROMPT_VERSION,
      },
      stages: {
        generation: generationStage,
        library: provenanceStage(
          "completed",
          libraryResult.fallbackReason,
        ),
        verification: verificationStage,
      },
      statements: finalStatements,
      version: 2,
    };
    const referencedEvidenceIds = new Set(
      finalStatements.flatMap(({ evidenceIds: statementEvidenceIds }) =>
        statementEvidenceIds,
      ),
    );
    const citations = this.#citationInputs(
      libraryResult.citations.filter((citation) =>
        referencedEvidenceIds.has(citation.id as HybridEvidenceId),
      ),
      retrievalResult,
    );
    const insufficient =
      finalStatements.length === 0 &&
      libraryResult.status === "insufficient-evidence";
    if (!this.#claimTerminal(active)) return;
    let message: ChatMessage;
    try {
      message = this.#database.completeChatRun(active.runId, {
        answerProvenance: provenance,
        citations,
        content,
        model: active.model,
        routingDiagnostics: active.routingDiagnostics,
        status: insufficient ? "insufficient" : "completed",
      });
    } catch (error) {
      active.terminal = false;
      throw error;
    }
    this.#emitChat(active, {
      fallback: usedFallback || libraryResult.status === "fallback",
      insufficient,
      kind: "completed",
      message: toChatMessage(message),
    });
  }

  async #groundLibraryDeterministically(
    active: ActiveChatRun,
    question: string,
    retrievalResult: RetrievalResult,
    questionContextualizationVersion: string | null,
  ): Promise<GroundedAnswerResult> {
    const orchestrator = new GroundedAnswerOrchestrator({
      answerabilityProvider: active.answerabilityProvider,
      answerStreamProvider: active.answerStreamProvider,
      confidenceEnvironment: {
        ...active.confidenceEnvironment,
        questionContextualizationVersion,
      },
      contextLimits: {
        maxCharacters: Math.max(4_096, (active.contextWindow - 4_096) * 3),
      },
      delivery: "deterministic",
      planProvider: active.planProvider,
    });
    for await (const event of orchestrator.run(
      { question, retrievalResult },
      { signal: active.controller.signal },
    )) {
      active.controller.signal.throwIfAborted();
      if (event.type === "status") {
        this.#updateAndEmitStatus(
          active,
          event.status === "routing"
            ? "routing"
            : event.status === "planning"
              ? "planning"
              : "generating",
        );
      } else if (event.type === "routing") {
        const diagnostics: RagAnswerRoutingDiagnostics = {
          ...event.diagnostics,
          generationModel: { digest: active.modelDigest, model: active.model },
        };
        active.routingDiagnostics = diagnostics;
        this.#database.setChatRoutingDiagnostics(active.runId, diagnostics);
        this.#emitChat(active, { diagnostics, kind: "routing" });
      } else if (event.type === "result") {
        return event.result;
      } else {
        throw new EngineOperationError(
          "CHAT_FAILED",
          "Deterministic library grounding emitted provisional text.",
        );
      }
    }
    throw new EngineOperationError(
      "CHAT_FAILED",
      "Library grounding ended without a terminal result.",
    );
  }

  #withGroundingContext(retrieval: RetrievalResult): RetrievalResult {
    return {
      ...retrieval,
      candidates: retrieval.candidates.map((candidate) => {
        const precedingContext = this.#database.getPreviousChunkContext(
          candidate.chunkId,
        );
        if (precedingContext === null) return candidate;
        const sourceLocator = candidate.evidence.metadata?.sourceLocator;
        return {
          ...candidate,
          evidence: {
            ...candidate.evidence,
            metadata: {
              ...candidate.evidence.metadata,
              precedingContext: precedingContext.content,
              ...(isStoredSourceLocator(sourceLocator)
                ? {
                    sourceLocator: {
                      ...sourceLocator,
                      start: precedingContext.start,
                    },
                  }
                : {}),
            },
          },
        };
      }),
    };
  }

  #citationInputs(
    citations: readonly {
      readonly chunkId: string;
      readonly components: RetrievalResult["candidates"][number]["components"];
      readonly id: string;
      readonly text: string;
    }[],
    retrievalResult: RetrievalResult,
  ): readonly ChatCitationInput[] {
    const candidates = new Map(
      retrievalResult.candidates.map((candidate) => [candidate.chunkId, candidate]),
    );
    return citations.map((citation) => {
      const candidate = candidates.get(citation.chunkId);
      const sourceLocator = candidate?.evidence.metadata?.sourceLocator;
      const headingPath = candidate?.evidence.metadata?.headingPath;
      const title = candidate?.evidence.metadata?.title;
      if (
        candidate === undefined ||
        !isStoredSourceLocator(sourceLocator) ||
        !Array.isArray(headingPath) ||
        !headingPath.every((value) => typeof value === "string") ||
        typeof title !== "string"
      ) {
        throw new EngineOperationError(
          "CHAT_FAILED",
          `Citation evidence ${citation.id} has incomplete source metadata.`,
        );
      }
      return {
        chunkId: citation.chunkId,
        documentId: candidate.evidence.source.documentId,
        evidenceId: citation.id,
        headingPath,
        retrievalComponentScores: citation.components.map((component) => ({
          ...component,
        })),
        sourceLocator,
        text: citation.text,
        title,
      };
    });
  }

  #updateAndEmitStatus(
    active: ActiveChatRun,
    status: RagChatStatusEvent["status"],
  ): void {
    if (active.terminal) return;
    this.#database.updateChatRun(active.runId, {
      model: active.model,
      status:
        status === "retrieving"
          ? "retrieving"
          : status === "planning" || status === "routing"
            ? "planning"
            : "generating",
    });
    this.#emitChat(active, { kind: "status", status });
  }

  #emitChat(
    active: ActiveChatRun,
    event:
      | Omit<RagChatCancelledEvent, "runId" | "sequence">
      | Omit<RagChatCompletedEvent, "runId" | "sequence">
      | Omit<RagChatDeltaEvent, "runId" | "sequence">
      | Omit<RagChatFailedEvent, "runId" | "sequence">
      | Omit<RagChatRoutingEvent, "runId" | "sequence">
      | Omit<RagChatStatusEvent, "runId" | "sequence">,
  ): void {
    const sequenced = {
      ...event,
      runId: active.runId,
      sequence: active.sequence,
    } as RagChatEvent;
    active.sequence += 1;
    try {
      active.emit(sequenced);
    } catch {
      // Persistence and inference must not depend on an event consumer.
    }
  }

  #claimTerminal(active: ActiveChatRun): boolean {
    if (active.terminal) return false;
    active.terminal = true;
    return true;
  }

  #cancelActiveChat(runId: string): RagChatMessage | null {
    const active = this.#activeChatRuns.get(runId);
    if (active === undefined || !this.#claimTerminal(active)) return null;
    let message: ChatMessage;
    try {
      message = this.#database.cancelChatRun(runId);
    } catch (error) {
      active.terminal = false;
      throw operationError(
        error,
        "CHAT_RUN_NOT_ACTIVE",
        `Chat run ${runId} is not active.`,
      );
    }
    active.controller.abort();
    const mapped = toChatMessage(message);
    this.#emitChat(active, { kind: "cancelled", message: mapped });
    this.#activeChatRuns.delete(runId);
    return mapped;
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new EngineOperationError("ENGINE_UNAVAILABLE", "The engine is closed.");
    }
  }

  public getSnapshot(): LibrarySnapshot {
    return this.#database.getLibrarySnapshot();
  }

  public async deleteDocument(documentId: string): Promise<{
    readonly deletedDocumentId: string;
    readonly snapshot: LibrarySnapshot;
  }> {
    this.#assertOpen();
    if (documentId.trim().length === 0) {
      throw new EngineOperationError("INVALID_REQUEST", "A document ID is required.");
    }
    const result = this.#database.deleteDocument(documentId);
    if (!result.deleted) {
      if (result.reason === "not-found") {
        throw new EngineOperationError(
          "DOCUMENT_NOT_FOUND",
          `Document ${documentId} does not exist.`,
        );
      }
      throw new EngineOperationError(
        "DOCUMENT_IMPORT_IN_PROGRESS",
        `Document ${documentId} is still being imported and cannot be deleted yet.`,
      );
    }
    const target = resolve(this.#libraryRoot, result.managedRelativePath);
    if (target.startsWith(this.#libraryRoot + sep)) {
      try {
        await rm(target, { force: true });
      } catch {
        // The database is authoritative; an orphaned managed file is harmless
        // and a same-checksum re-import tolerates its presence.
      }
    }
    return { deletedDocumentId: documentId, snapshot: this.getSnapshot() };
  }

  public getVectorExtensionVersion(): string {
    return this.#database.getVectorExtensionVersion();
  }

  public search(query: string, limit = 20): readonly SearchResult[] {
    return this.#database.search(query, limit);
  }

  public async discoverDirectory(directoryPath: string): Promise<readonly string[]> {
    const selected = await lstat(directoryPath);
    if (selected.isSymbolicLink() || !selected.isDirectory()) {
      throw new ImportError(
        "INVALID_IMPORT_DIRECTORY",
        "The selected import location is not a regular directory.",
      );
    }
    const rootRealPath = await realpath(directoryPath);
    const files: string[] = [];

    const visit = async (currentPath: string) => {
      const entries = await readdir(currentPath, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const childPath = join(currentPath, entry.name);
        if (entry.isDirectory()) {
          await visit(childPath);
          continue;
        }
        if (!entry.isFile() || !isSupportedSourceFilename(entry.name)) continue;
        const childRealPath = await realpath(childPath);
        const relativePath = relative(rootRealPath, childRealPath);
        if (relativePath.startsWith("..") || resolve(rootRealPath, relativePath) !== childRealPath) {
          continue;
        }
        files.push(childRealPath);
      }
    };

    await visit(rootRealPath);
    return files;
  }

  public async importPaths(
    paths: readonly string[],
    options: ImportProgressOptions = {},
  ): Promise<ImportBatchResult> {
    let imported = 0;
    let duplicates = 0;
    let failed = 0;
    let unsupported = 0;
    let reprocessed = 0;
    let completed = 0;
    const items: ImportItemResult[] = [];
    const sources = [...new Set(paths)].sort();
    const operationId = options.operationId ?? randomUUID();
    const report = (stage: ImportProgressStage, currentName: string | null) => {
      try {
        options.onProgress?.({
          completed,
          currentName,
          kind: "import-progress",
          operationId,
          stage,
          total: sources.length,
        });
      } catch {
        // Progress reporting must not interrupt an import.
      }
    };

    report("checking", null);

    for (const path of sources) {
      const originalName = basename(path);
      report("checking", originalName);
      let outcome: ImportItemResult;
      if (!isAvailableSourceFilename(path)) {
        outcome = {
          documentId: null,
          errorCode: "PARSER_NOT_AVAILABLE",
          errorMessage: "This file type is planned but not available in this build.",
          originalName,
          status: "unsupported",
        };
      } else {
        outcome = await this.#importPath(path, (stage) => report(stage, originalName));
      }
      items.push(outcome);
      if (outcome.status === "imported" || outcome.status === "reprocessed") {
        if (outcome.status === "imported") imported += 1;
        if (outcome.status === "reprocessed") reprocessed += 1;
        this.#startBackfill();
      }
      if (outcome.status === "duplicate") duplicates += 1;
      if (outcome.status === "failed") failed += 1;
      if (outcome.status === "unsupported") unsupported += 1;
      completed += 1;
    }
    report("completed", null);

    return {
      duplicates,
      failed,
      imported,
      items,
      reprocessed,
      snapshot: this.getSnapshot(),
      unsupported,
    };
  }

  async #importPath(
    path: string,
    onStage: (stage: ImportProgressStage) => void,
  ): Promise<ImportItemResult> {
    const originalName = basename(path);
    const format = documentFormatFromFilename(originalName);
    const jobId = randomUUID();
    this.#database.createJob(jobId, originalName);
    if (!format) {
      this.#database.updateJob(jobId, "failed", 1, {
        errorCode: "PARSER_NOT_AVAILABLE",
        errorMessage: "This file type is planned but not available in this build.",
      });
      return {
        documentId: null,
        errorCode: "PARSER_NOT_AVAILABLE",
        errorMessage: "This file type is planned but not available in this build.",
        originalName,
        status: "failed",
      };
    }

    let documentId: string | null = null;
    let stagingPath: string | null = null;
    let destinationPath: string | null = null;
    let canonicalCreated = false;
    try {
      onStage("copying");
      this.#database.updateJob(jobId, "copying", 0.1);
      const copied = await this.#copyToStaging(path, jobId, format);
      stagingPath = copied.stagingPath;
      const duplicate = this.#database.findDocumentByChecksum(copied.checksum);
      if (duplicate) {
        this.#database.addSourceOrigin(
          copied.checksum,
          originalName,
          copied.originalRealPath,
        );
        if (duplicate.status !== "failed") {
          this.#database.updateJob(jobId, "duplicate", 1, {
            documentId: duplicate.id,
          });
          await rm(copied.stagingPath, { force: true });
          return {
            documentId: duplicate.id,
            errorCode: null,
            errorMessage: null,
            originalName,
            status: "duplicate",
          };
        }

        documentId = duplicate.id;
        this.#database.beginDocumentReprocessing(documentId);
        onStage("parsing");
        this.#database.updateJob(jobId, "parsing", 0.55, { documentId });
        const staged = await open(copied.stagingPath, "r");
        let bytes: Uint8Array;
        try {
          bytes = await staged.readFile();
        } finally {
          await staged.close();
        }
        const document = await parseDocumentBytes(bytes, originalName, format);
        onStage("chunking");
        this.#database.updateJob(jobId, "chunking", 0.75, { documentId });
        const chunks = chunkDocument(document);
        onStage("indexing");
        this.#database.updateJob(jobId, "indexing", 0.9, { documentId });
        this.#database.completeDocument(documentId, document, chunks, ingestionVersions.chunker);
        this.#database.updateJob(jobId, "completed", 1, { documentId });
        await rm(copied.stagingPath, { force: true });
        stagingPath = null;
        return {
          documentId,
          errorCode: null,
          errorMessage: null,
          originalName,
          status: "reprocessed",
        };
      }

      const extension = extname(originalName).toLocaleLowerCase("en-US");
      const managedRelativePath = join(
        "library",
        "sources",
        copied.checksum.slice(0, 2),
        `${copied.checksum}${extension}`,
      );
      destinationPath = join(this.#libraryRoot, managedRelativePath);
      mkdirSync(resolve(destinationPath, ".."), { recursive: true, mode: 0o700 });
      try {
        await link(copied.stagingPath, destinationPath);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
      }
      await chmod(destinationPath, 0o600);
      const destinationDirectory = await open(resolve(destinationPath, ".."), "r");
      try {
        await destinationDirectory.sync();
      } finally {
        await destinationDirectory.close();
      }
      await rm(copied.stagingPath, { force: true });
      stagingPath = null;

      documentId = randomUUID();
      this.#database.createCanonicalDocument({
        checksum: copied.checksum,
        documentId,
        format,
        jobId,
        managedRelativePath,
        mimeType: mimeTypeForFormat(format),
        originalName,
        originalPath: copied.originalRealPath,
        sizeBytes: copied.sizeBytes,
      });
      canonicalCreated = true;

      const managedBytes = await open(destinationPath, "r");
      let bytes: Uint8Array;
      try {
        bytes = await managedBytes.readFile();
      } finally {
        await managedBytes.close();
      }
      onStage("parsing");
      this.#database.updateJob(jobId, "parsing", 0.55, { documentId });
      const document = await parseDocumentBytes(bytes, originalName, format);
      onStage("chunking");
      this.#database.updateJob(jobId, "chunking", 0.75, { documentId });
      const chunks = chunkDocument(document);
      onStage("indexing");
      this.#database.updateJob(jobId, "indexing", 0.9, { documentId });
      this.#database.completeDocument(
        documentId,
        document,
        chunks,
        ingestionVersions.chunker,
      );
      this.#database.updateJob(jobId, "completed", 1, { documentId });
      return {
        documentId,
        errorCode: null,
        errorMessage: null,
        originalName,
        status: "imported",
      };
    } catch (error) {
      const details = errorDetails(error);
      if (documentId) this.#database.failDocument(documentId, details.code, details.message);
      this.#database.updateJob(jobId, "failed", 1, {
        ...(documentId ? { documentId } : {}),
        errorCode: details.code,
        errorMessage: details.message,
      });
      if (stagingPath) await rm(stagingPath, { force: true });
      if (destinationPath && !canonicalCreated) {
        await rm(destinationPath, { force: true });
      }
      return {
        documentId,
        errorCode: details.code,
        errorMessage: details.message,
        originalName,
        status: "failed",
      };
    }
  }

  async #copyToStaging(
    path: string,
    jobId: string,
    format: DocumentFormat,
  ): Promise<CopiedSource> {
    const sourceLstat = await lstat(path);
    if (sourceLstat.isSymbolicLink() || !sourceLstat.isFile()) {
      throw new ImportError(
        "INVALID_SOURCE_FILE",
        "The selected source is not a regular file.",
      );
    }
    const maximumBytes = maximumImportBytes(format);
    if (sourceLstat.size > maximumBytes) {
      throw new ImportError(
        "SOURCE_TOO_LARGE",
        `This ${format.toUpperCase()} source is larger than the current ${maximumBytes / MEBIBYTE} MiB import limit.`,
      );
    }
    const sourceRealPath = await realpath(path);
    const before = await stat(sourceRealPath);
    const stagingPath = join(this.#temporaryRoot, `${jobId}.partial`);
    const hash = createHash("sha256");
    const hashStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(
      createReadStream(sourceRealPath),
      hashStream,
      createWriteStream(stagingPath, { flags: "wx", mode: 0o600 }),
    );
    const stagedHandle = await open(stagingPath, "r+");
    try {
      await stagedHandle.sync();
    } finally {
      await stagedHandle.close();
    }
    const after = await stat(sourceRealPath);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ino !== after.ino
    ) {
      throw new ImportError(
        "SOURCE_CHANGED_DURING_IMPORT",
        "The source changed while it was being copied. Import it again after changes finish.",
      );
    }
    return {
      checksum: hash.digest("hex"),
      originalRealPath: sourceRealPath,
      sizeBytes: after.size,
      stagingPath,
    };
  }

  #cleanStagingFiles(): void {
    if (!existsSync(this.#temporaryRoot)) return;
    for (const entry of readdirSync(this.#temporaryRoot)) {
      if (entry.endsWith(".partial")) {
        rmSync(join(this.#temporaryRoot, entry), { force: true });
      }
    }
  }
}
