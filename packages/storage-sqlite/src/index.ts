import { createHash, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DOCUMENT_BLOCK_TYPES,
  DOCUMENT_FORMATS,
  DOCUMENT_STATUSES,
  INGESTION_JOB_STATUSES,
  type DocumentChunk,
  type DocumentFormat,
  type DocumentStatus,
  type IngestionJobStatus,
  type NormalizedDocument,
  type ParseDiagnostic,
  type SourceLocation,
} from "@knosys-rag/core";

const CURRENT_SCHEMA_VERSION = 11;
const MAX_EMBEDDING_BATCH_SIZE = 500;
const MAX_RETRIEVAL_RESULTS = 100;
const MAX_MEMORY_SUMMARY_CHARACTERS = 4_000;
export const MAX_ACTIVE_USER_FACTS = 32;
export const MAX_USER_FACT_CHARACTERS = 512;

export const SEMANTIC_INDEX_JOB_STATUSES = [
  "queued",
  "running",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
] as const;

export const CHAT_MESSAGE_STATUSES = [
  "pending",
  "retrieving",
  "planning",
  "generating",
  "completed",
  "insufficient",
  "cancelled",
  "interrupted",
  "failed",
] as const;

export type SemanticIndexJobStatus = (typeof SEMANTIC_INDEX_JOB_STATUSES)[number];
export type ChatMessageStatus = (typeof CHAT_MESSAGE_STATUSES)[number];
export type ChatMessageRole = "assistant" | "user";

export interface EmbeddingProfileIdentity {
  readonly digest: string;
  readonly dimensions: number;
  readonly inputVersion: string;
  readonly model: string;
  readonly provider: string;
}

export interface EmbeddingProfile extends EmbeddingProfileIdentity {
  readonly createdAt: string;
  readonly id: string;
  readonly updatedAt: string;
}

export interface NewSemanticIndexJob {
  readonly embeddingProfileId: string;
  readonly id?: string;
  readonly totalChunks?: number;
}

export interface SemanticIndexJob {
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly embeddingProfileId: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly processedChunks: number;
  readonly startedAt: string | null;
  readonly status: SemanticIndexJobStatus;
  readonly totalChunks: number;
  readonly updatedAt: string;
}

export interface SemanticIndexJobUpdate {
  readonly errorCode?: string | null;
  readonly errorMessage?: string | null;
  readonly processedChunks?: number;
  readonly status: SemanticIndexJobStatus;
  readonly totalChunks?: number;
}

export interface ChunkEmbeddingWorkItem {
  readonly chunkId: string;
  readonly content: string;
  readonly contentHash: string;
  readonly documentId: string;
  readonly headingPath: readonly string[];
  readonly title: string;
}

export interface ChunkEmbeddingInput {
  readonly chunkId: string;
  readonly contentHash: string;
  readonly embedding: Float32Array | readonly number[];
}

export interface EmbeddingCoverage {
  readonly currentChunks: number;
  readonly missingChunks: number;
  readonly ratio: number;
  readonly staleChunks: number;
  readonly totalChunks: number;
}

export interface EmbeddingRebuildState extends EmbeddingCoverage {
  readonly embeddingProfileId: string;
  readonly latestJob: SemanticIndexJob | null;
  readonly needsRebuild: boolean;
}

export interface SourceAnchor {
  readonly blockId: string;
  readonly blockOrdinal: number;
  readonly endLine: number | null;
  readonly pageNumber: number | null;
  readonly sourceFragment: string | null;
  readonly sourcePath: string | null;
  readonly startLine: number | null;
}

export interface PreviousChunkContext {
  readonly content: string;
  readonly start: SourceAnchor;
}

export interface StoredSourceLocator {
  readonly chunkId: string;
  readonly documentId: string;
  readonly end: SourceAnchor;
  readonly start: SourceAnchor;
}

export interface EvidenceResult {
  readonly chunkId: string;
  readonly documentId: string;
  readonly headingPath: readonly string[];
  readonly sourceChecksum: string;
  readonly sourceLocator: StoredSourceLocator;
  readonly text: string;
  readonly title: string;
}

export interface LexicalEvidenceResult extends EvidenceResult {
  readonly rank: number;
  readonly score: number;
}

export interface VectorEvidenceResult extends EvidenceResult {
  readonly distance: number;
  readonly score: number;
}

export interface SourceBlock {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly headingPath: readonly string[];
  readonly id: string;
  readonly ordinal: number;
  readonly pageNumber: number | null;
  readonly sourceFragment: string | null;
  readonly sourcePath: string | null;
  readonly startLine: number | null;
  readonly endLine: number | null;
  readonly text: string;
  readonly type: string;
}

export interface SourceBlockWindowRequest {
  readonly after?: number;
  readonly before?: number;
  readonly chunkId?: string;
  readonly documentId?: string;
  readonly endBlockOrdinal?: number;
  readonly startBlockOrdinal?: number;
}

export interface CitationRetrievalScore {
  readonly component: string;
  readonly rank?: number;
  readonly reciprocalRankScore?: number;
  readonly score: number;
}

export interface ChatCitationInput {
  readonly chunkId: string;
  readonly documentId: string;
  readonly evidenceId: string;
  readonly headingPath: readonly string[];
  readonly id?: string;
  readonly ordinal?: number;
  readonly retrievalComponentScores: readonly CitationRetrievalScore[];
  readonly sourceLocator: object;
  readonly text: string;
  readonly title: string;
}

export interface ChatCitation extends Omit<ChatCitationInput, "id" | "ordinal"> {
  readonly createdAt: string;
  readonly id: string;
  readonly messageId: string;
  readonly ordinal: number;
}

export interface ChatMessage {
  readonly answerProvenance: object | null;
  readonly citations: readonly ChatCitation[];
  readonly content: string;
  readonly createdAt: string;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly model: string | null;
  readonly ordinal: number;
  readonly role: ChatMessageRole;
  readonly routingDiagnostics: object | null;
  readonly runId: string | null;
  readonly status: ChatMessageStatus;
  readonly threadId: string;
  readonly updatedAt: string;
}

export interface ChatThreadSummary {
  readonly createdAt: string;
  readonly folderId: string | null;
  readonly id: string;
  readonly lastMessageAt: string | null;
  readonly lastMessagePreview: string | null;
  readonly memoryExcluded: boolean;
  readonly messageCount: number;
  readonly title: string;
  readonly updatedAt: string;
}

export const USER_FACT_CATEGORIES = ["preference", "profile", "project", "other"] as const;
export type UserFactCategory = (typeof USER_FACT_CATEGORIES)[number];
export type UserFactOrigin = "extracted" | "user";

export interface UserFact {
  readonly category: UserFactCategory;
  readonly createdAt: string;
  readonly fact: string;
  readonly id: string;
  readonly origin: UserFactOrigin;
  readonly sourceThreadId: string | null;
  readonly updatedAt: string;
}

export interface NewExtractedUserFact {
  readonly category: UserFactCategory;
  readonly fact: string;
  readonly sourceThreadId: string | null;
}

export interface ThreadMemoryInput {
  readonly promptVersion: string;
  readonly summarizedMessageCount: number;
  readonly summaryJson: object;
  readonly summaryText: string;
  readonly threadId: string;
  readonly topics: readonly string[];
}

export interface ThreadMemory extends ThreadMemoryInput {
  readonly contentHash: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface MemorySummaryWorkItem {
  readonly completedMessageCount: number;
  readonly threadId: string;
}

export interface MemoryEmbeddingWorkItem {
  readonly contentHash: string;
  readonly summaryText: string;
  readonly threadId: string;
}

export interface MemoryEmbeddingInput {
  readonly contentHash: string;
  readonly embedding: Float32Array | readonly number[];
  readonly threadId: string;
}

export interface MemorySearchResult {
  readonly content: string;
  readonly score: number;
  readonly threadId: string;
  readonly threadTitle: string;
  readonly threadUpdatedAt: string;
}

export interface MemoryStatus {
  readonly excludedThreadCount: number;
  readonly factCount: number;
  readonly staleThreadCount: number;
  readonly summarizedThreadCount: number;
}

export interface ChatFolder {
  readonly createdAt: string;
  readonly id: string;
  readonly name: string;
  readonly updatedAt: string;
}

export interface ChatThread extends ChatThreadSummary {
  readonly messages: readonly ChatMessage[];
}

export interface NewChatRun {
  readonly assistantMessageId?: string;
  readonly model?: string;
  readonly runId?: string;
  readonly threadId?: string;
  readonly threadTitle?: string;
  readonly userContent: string;
  readonly userMessageId?: string;
}

export interface ChatRun {
  readonly assistantMessage: ChatMessage;
  readonly runId: string;
  readonly thread: ChatThreadSummary;
  readonly userMessage: ChatMessage;
}

export interface CompleteChatRunOptions {
  readonly answerProvenance?: object | null;
  readonly citations?: readonly ChatCitationInput[];
  readonly content?: string;
  readonly model?: string;
  readonly routingDiagnostics?: object | null;
  readonly status?: "completed" | "insufficient";
}

export interface UpdateChatRunOptions {
  readonly model?: string;
  readonly status: "pending" | "retrieving" | "planning" | "generating";
}

export interface ChatRunErrorOptions {
  readonly citations?: readonly ChatCitationInput[];
  readonly code?: string;
  readonly content?: string;
  readonly message: string;
}

export interface ChatRunTerminalOptions {
  readonly citations?: readonly ChatCitationInput[];
  readonly content?: string;
}

export interface GenerationModelSelection {
  readonly contextWindow: number;
  readonly digest: string;
  readonly model: string;
  readonly provider: string;
  readonly sizeBytes: number;
}

export interface SelectedModelSettings {
  readonly embeddingProfileId: string | null;
  readonly generationModel: GenerationModelSelection | null;
  readonly generationSelectionMode: "auto" | "manual";
  readonly updatedAt: string;
}

interface FinishChatRunOptions extends ChatRunTerminalOptions {
  readonly answerProvenance?: object | null;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly model?: string;
  readonly routingDiagnostics?: object | null;
}

export interface DocumentSummary {
  readonly createdAt: string;
  readonly diagnosticCount: number;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly format: DocumentFormat;
  readonly id: string;
  readonly originalName: string;
  readonly reviewedAt: string | null;
  readonly sizeBytes: number;
  readonly status: DocumentStatus;
  readonly title: string;
  readonly updatedAt: string;
}

export interface JobSummary {
  readonly createdAt: string;
  readonly documentId: string | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly id: string;
  readonly originalName: string;
  readonly progress: number;
  readonly status: IngestionJobStatus;
  readonly updatedAt: string;
}

export interface SearchResult {
  readonly chunkId: string;
  readonly documentId: string;
  readonly endBlockOrdinal: number;
  readonly endPageNumber: number | null;
  readonly headingPath: readonly string[];
  readonly rank: number;
  readonly snippet: string;
  readonly sourceFragment: string | null;
  readonly sourcePath: string | null;
  readonly startBlockOrdinal: number;
  readonly startPageNumber: number | null;
  readonly title: string;
}

export interface LibrarySnapshot {
  readonly documents: readonly DocumentSummary[];
  readonly jobs: readonly JobSummary[];
}

export interface NewCanonicalDocument {
  readonly checksum: string;
  readonly documentId: string;
  readonly format: DocumentFormat;
  readonly jobId: string;
  readonly managedRelativePath: string;
  readonly mimeType: string;
  readonly originalName: string;
  readonly originalPath: string;
  readonly sizeBytes: number;
}

function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value.replaceAll("'", "''")}'`).join(", ");
}

const MIGRATION_1 = `
  CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE source_blobs (
    checksum TEXT PRIMARY KEY CHECK(length(checksum) = 64),
    managed_relative_path TEXT NOT NULL UNIQUE CHECK(managed_relative_path NOT LIKE '/%'),
    byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE source_origins (
    id TEXT PRIMARY KEY,
    source_checksum TEXT NOT NULL REFERENCES source_blobs(checksum) ON DELETE CASCADE,
    original_name TEXT NOT NULL,
    original_path TEXT NOT NULL,
    imported_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    source_checksum TEXT NOT NULL UNIQUE REFERENCES source_blobs(checksum) ON DELETE RESTRICT,
    title TEXT NOT NULL,
    format TEXT NOT NULL CHECK(format IN (${sqlList(DOCUMENT_FORMATS)})),
    status TEXT NOT NULL CHECK(status IN (${sqlList(DOCUMENT_STATUSES)})),
    parser_id TEXT,
    parser_version TEXT,
    ir_schema_version INTEGER,
    chunker_version TEXT,
    diagnostic_count INTEGER NOT NULL DEFAULT 0 CHECK(diagnostic_count >= 0),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE ingestion_jobs (
    id TEXT PRIMARY KEY,
    document_id TEXT REFERENCES documents(id) ON DELETE SET NULL,
    original_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN (${sqlList(INGESTION_JOB_STATUSES)})),
    progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE parse_diagnostics (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    severity TEXT NOT NULL CHECK(severity IN ('info', 'warning', 'error')),
    code TEXT NOT NULL,
    message TEXT NOT NULL,
    start_line INTEGER,
    end_line INTEGER,
    UNIQUE(document_id, ordinal)
  ) STRICT;

  CREATE TABLE document_blocks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    block_type TEXT NOT NULL CHECK(block_type IN (${sqlList(DOCUMENT_BLOCK_TYPES)})),
    text_content TEXT NOT NULL,
    heading_path_json TEXT NOT NULL,
    level INTEGER,
    start_line INTEGER,
    end_line INTEGER,
    attributes_json TEXT NOT NULL,
    UNIQUE(document_id, ordinal)
  ) STRICT;

  CREATE TABLE chunks (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    content TEXT NOT NULL CHECK(length(content) > 0),
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    heading_path_json TEXT NOT NULL,
    start_block_ordinal INTEGER NOT NULL,
    end_block_ordinal INTEGER NOT NULL,
    approximate_token_count INTEGER NOT NULL CHECK(approximate_token_count > 0),
    UNIQUE(document_id, ordinal)
  ) STRICT;

  CREATE VIRTUAL TABLE chunks_fts USING fts5(
    chunk_public_id UNINDEXED,
    document_id UNINDEXED,
    title,
    heading_path,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE INDEX documents_status_updated_idx ON documents(status, updated_at DESC);
  CREATE INDEX ingestion_jobs_updated_idx ON ingestion_jobs(updated_at DESC);
  CREATE INDEX chunks_document_idx ON chunks(document_id, ordinal);
`;

const MIGRATION_2 = `
  ALTER TABLE documents ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}';
  ALTER TABLE parse_diagnostics ADD COLUMN source_path TEXT;
  ALTER TABLE parse_diagnostics ADD COLUMN source_fragment TEXT;
  ALTER TABLE document_blocks ADD COLUMN source_path TEXT;
  ALTER TABLE document_blocks ADD COLUMN source_fragment TEXT;

  CREATE TABLE document_sections (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    start_block_ordinal INTEGER,
    end_block_ordinal INTEGER,
    attributes_json TEXT NOT NULL,
    UNIQUE(document_id, ordinal)
  ) STRICT;
`;

const MIGRATION_3 = `
  CREATE TABLE embedding_profiles (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL CHECK(length(provider) > 0),
    model TEXT NOT NULL CHECK(length(model) > 0),
    digest TEXT NOT NULL CHECK(length(digest) > 0),
    dimensions INTEGER NOT NULL CHECK(dimensions > 0),
    input_version TEXT NOT NULL CHECK(length(input_version) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(provider, model, digest, dimensions, input_version)
  ) STRICT;

  CREATE TABLE semantic_index_jobs (
    id TEXT PRIMARY KEY,
    embedding_profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK(status IN (${sqlList(SEMANTIC_INDEX_JOB_STATUSES)})),
    total_chunks INTEGER NOT NULL DEFAULT 0 CHECK(total_chunks >= 0),
    processed_chunks INTEGER NOT NULL DEFAULT 0 CHECK(processed_chunks >= 0 AND processed_chunks <= total_chunks),
    error_code TEXT,
    error_message TEXT,
    started_at TEXT,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE chunk_embeddings (
    chunk_id INTEGER NOT NULL REFERENCES chunks(id) ON DELETE CASCADE,
    embedding_profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    embedding BLOB NOT NULL CHECK(length(embedding) > 0 AND length(embedding) % 4 = 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(chunk_id, embedding_profile_id)
  ) STRICT;

  CREATE INDEX semantic_index_jobs_profile_updated_idx
    ON semantic_index_jobs(embedding_profile_id, updated_at DESC);
  CREATE INDEX semantic_index_jobs_status_updated_idx
    ON semantic_index_jobs(status, updated_at DESC);
  CREATE INDEX chunk_embeddings_profile_hash_idx
    ON chunk_embeddings(embedding_profile_id, content_hash);

  CREATE TRIGGER chunk_embeddings_dimensions_insert
  BEFORE INSERT ON chunk_embeddings
  WHEN length(NEW.embedding) != (
    SELECT dimensions * 4 FROM embedding_profiles WHERE id = NEW.embedding_profile_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'embedding dimensions do not match profile');
  END;

  CREATE TRIGGER chunk_embeddings_dimensions_update
  BEFORE UPDATE OF embedding, embedding_profile_id ON chunk_embeddings
  WHEN length(NEW.embedding) != (
    SELECT dimensions * 4 FROM embedding_profiles WHERE id = NEW.embedding_profile_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'embedding dimensions do not match profile');
  END;
`;

const MIGRATION_4 = `
  CREATE TABLE chat_threads (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL CHECK(length(title) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    status TEXT NOT NULL CHECK(status IN (${sqlList(CHAT_MESSAGE_STATUSES)})),
    content TEXT NOT NULL,
    run_id TEXT,
    model TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(thread_id, ordinal)
  ) STRICT;

  CREATE TABLE chat_citations (
    id TEXT PRIMARY KEY,
    message_id TEXT NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    ordinal INTEGER NOT NULL CHECK(ordinal >= 0),
    evidence_id TEXT NOT NULL CHECK(length(evidence_id) > 0),
    document_id TEXT NOT NULL CHECK(length(document_id) > 0),
    chunk_id TEXT NOT NULL CHECK(length(chunk_id) > 0),
    title TEXT NOT NULL,
    text_content TEXT NOT NULL,
    heading_path_json TEXT NOT NULL,
    source_locator_json TEXT NOT NULL,
    retrieval_component_scores_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(message_id, ordinal),
    UNIQUE(message_id, evidence_id)
  ) STRICT;

  CREATE TABLE selected_model_settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    embedding_profile_id TEXT REFERENCES embedding_profiles(id) ON DELETE SET NULL,
    generation_provider TEXT,
    generation_model TEXT,
    generation_digest TEXT,
    updated_at TEXT NOT NULL,
    CHECK(
      (generation_provider IS NULL AND generation_model IS NULL AND generation_digest IS NULL)
      OR
      (generation_provider IS NOT NULL AND generation_model IS NOT NULL AND generation_digest IS NOT NULL)
    )
  ) STRICT;

  CREATE UNIQUE INDEX chat_messages_run_idx
    ON chat_messages(run_id) WHERE run_id IS NOT NULL;
  CREATE INDEX chat_messages_thread_created_idx
    ON chat_messages(thread_id, ordinal);
  CREATE INDEX chat_threads_updated_idx ON chat_threads(updated_at DESC);
  CREATE INDEX chat_citations_message_ordinal_idx
    ON chat_citations(message_id, ordinal);

  CREATE TRIGGER chat_citations_immutable_update
  BEFORE UPDATE ON chat_citations
  BEGIN
    SELECT RAISE(ABORT, 'chat citations are immutable');
  END;

  INSERT INTO selected_model_settings(id, updated_at)
  VALUES (1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
`;

const MIGRATION_5 = `
  ALTER TABLE selected_model_settings
  ADD COLUMN generation_selection_mode TEXT NOT NULL DEFAULT 'auto'
    CHECK(generation_selection_mode IN ('auto', 'manual'));
  ALTER TABLE selected_model_settings
  ADD COLUMN generation_context_window INTEGER;
  ALTER TABLE selected_model_settings
  ADD COLUMN generation_size_bytes INTEGER;

  UPDATE selected_model_settings
  SET generation_selection_mode = CASE
        WHEN generation_model IS NULL THEN 'auto'
        ELSE 'manual'
      END,
      generation_context_window = CASE
        WHEN generation_model IS NULL THEN NULL
        ELSE 32768
      END,
      generation_size_bytes = CASE
        WHEN generation_model IS NULL THEN NULL
        ELSE 0
      END;
`;

const MIGRATION_9 = `
  CREATE TABLE chat_folders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL CHECK(length(name) > 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;
`;

const MIGRATION_11 = `
  CREATE TABLE thread_memories (
    thread_id TEXT PRIMARY KEY REFERENCES chat_threads(id) ON DELETE CASCADE,
    summary_json TEXT NOT NULL,
    summary_text TEXT NOT NULL
      CHECK(length(summary_text) > 0 AND length(summary_text) <= ${MAX_MEMORY_SUMMARY_CHARACTERS}),
    topics_json TEXT NOT NULL,
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    prompt_version TEXT NOT NULL CHECK(length(prompt_version) > 0),
    summarized_message_count INTEGER NOT NULL CHECK(summarized_message_count >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE TABLE memory_embeddings (
    thread_id TEXT NOT NULL REFERENCES thread_memories(thread_id) ON DELETE CASCADE,
    embedding_profile_id TEXT NOT NULL REFERENCES embedding_profiles(id) ON DELETE CASCADE,
    content_hash TEXT NOT NULL CHECK(length(content_hash) = 64),
    embedding BLOB NOT NULL CHECK(length(embedding) > 0 AND length(embedding) % 4 = 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(thread_id, embedding_profile_id)
  ) STRICT;

  CREATE VIRTUAL TABLE memories_fts USING fts5(
    thread_id UNINDEXED,
    title,
    topics,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );

  CREATE TABLE user_facts (
    id TEXT PRIMARY KEY,
    fact TEXT NOT NULL CHECK(length(fact) > 0 AND length(fact) <= ${MAX_USER_FACT_CHARACTERS}),
    normalized_hash TEXT NOT NULL UNIQUE CHECK(length(normalized_hash) = 64),
    category TEXT NOT NULL CHECK(category IN (${sqlList(USER_FACT_CATEGORIES)})),
    origin TEXT NOT NULL CHECK(origin IN ('extracted', 'user')),
    status TEXT NOT NULL CHECK(status IN ('active', 'deleted')),
    source_thread_id TEXT REFERENCES chat_threads(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  ) STRICT;

  CREATE INDEX thread_memories_updated_idx ON thread_memories(updated_at DESC);
  CREATE INDEX memory_embeddings_profile_hash_idx
    ON memory_embeddings(embedding_profile_id, content_hash);
  CREATE INDEX user_facts_status_created_idx ON user_facts(status, created_at);

  CREATE TRIGGER memory_embeddings_dimensions_insert
  BEFORE INSERT ON memory_embeddings
  WHEN length(NEW.embedding) != (
    SELECT dimensions * 4 FROM embedding_profiles WHERE id = NEW.embedding_profile_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'embedding dimensions do not match profile');
  END;

  CREATE TRIGGER memory_embeddings_dimensions_update
  BEFORE UPDATE OF embedding, embedding_profile_id ON memory_embeddings
  WHEN length(NEW.embedding) != (
    SELECT dimensions * 4 FROM embedding_profiles WHERE id = NEW.embedding_profile_id
  )
  BEGIN
    SELECT RAISE(ABORT, 'embedding dimensions do not match profile');
  END;

  CREATE TRIGGER thread_memories_fts_delete
  AFTER DELETE ON thread_memories
  BEGIN
    DELETE FROM memories_fts WHERE thread_id = OLD.thread_id;
  END;
`;

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error("SQLite returned an invalid row.");
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  if (typeof value !== "string") throw new Error("SQLite returned an invalid string.");
  return value;
}

function asNullableString(value: unknown): string | null {
  return value === null ? null : asString(value);
}

function asNumber(value: unknown): number {
  if (typeof value !== "number") throw new Error("SQLite returned an invalid number.");
  return value;
}

function asNullableNumber(value: unknown): number | null {
  return value === null ? null : asNumber(value);
}

function parseJson<T>(value: unknown, description: string): T {
  try {
    return JSON.parse(asString(value)) as T;
  } catch (error) {
    throw new Error(`SQLite returned invalid ${description} JSON.`, { cause: error });
  }
}

function requireObject(value: object | null, description: string): object | null {
  if (value !== null && (Array.isArray(value) || typeof value !== "object")) {
    throw new Error(`${description} must be an object or null.`);
  }
  return value;
}

function parseJsonObject(value: unknown, description: string): object {
  const parsed = parseJson<unknown>(value, description);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`SQLite returned invalid ${description}; expected an object.`);
  }
  return parsed;
}

function requireNonEmpty(value: string, description: string): void {
  if (value.trim().length === 0) throw new Error(`${description} must not be empty.`);
}

function requireSafeNonNegativeInteger(value: number, description: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${description} must be a non-negative safe integer.`);
  }
}

function boundedLimit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Limit must be a positive safe integer.");
  }
  return Math.min(value, maximum);
}

function float32Bytes(
  embedding: Float32Array | readonly number[],
  dimensions: number,
): Uint8Array {
  if (!(embedding instanceof Float32Array) && !Array.isArray(embedding)) {
    throw new Error("Embedding must be a Float32Array or an array of numbers.");
  }
  if (embedding.length !== dimensions) {
    throw new Error(`Embedding has ${embedding.length} dimensions; expected ${dimensions}.`);
  }
  const vector =
    embedding instanceof Float32Array ? new Float32Array(embedding) : new Float32Array(dimensions);
  for (let index = 0; index < embedding.length; index += 1) {
    const value = embedding[index];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Embedding contains a non-finite value at dimension ${index}.`);
    }
    if (!(embedding instanceof Float32Array)) vector[index] = value;
    if (!Number.isFinite(vector[index])) {
      throw new Error(`Embedding cannot be represented as Float32 at dimension ${index}.`);
    }
  }
  return new Uint8Array(vector.buffer, vector.byteOffset, vector.byteLength);
}

function normalizedFactHash(fact: string): string {
  const normalized = fact
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
}

function createFtsQuery(query: string): string | null {
  const terms = query
    .normalize("NFKC")
    .match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu)
    ?.slice(0, 12)
    .map((term) => term.slice(0, 64).replaceAll('"', '""'));
  if (!terms?.length) return null;
  return terms.map((term) => `"${term}"*`).join(" AND ");
}

export class KnosysDatabase {
  readonly #database: DatabaseSync;

  public constructor(path: string, vectorExtensionPath: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.#database = new DatabaseSync(path, {
      allowExtension: true,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      timeout: 5_000,
    });
    this.#database.loadExtension(vectorExtensionPath);
    this.#database.enableLoadExtension(false);
    this.#database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA secure_delete = ON;
      PRAGMA temp_store = MEMORY;
    `);
    this.#migrate();
  }

  public getVectorExtensionVersion(): string {
    const row = asRecord(this.#database.prepare("SELECT vec_version() AS version").get());
    return asString(row.version);
  }

  public close(): void {
    this.#database.close();
  }

  #migrate(): void {
    const hasMigrations = asNumber(
      asRecord(
        this.#database
          .prepare("SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
          .get(),
      ).count,
    );
    const currentVersion = hasMigrations
      ? asNumber(
          asRecord(
            this.#database.prepare("SELECT coalesce(max(version), 0) AS version FROM schema_migrations").get(),
          ).version,
        )
      : 0;
    if (currentVersion > CURRENT_SCHEMA_VERSION) {
      throw new Error(
        `This library uses schema ${currentVersion}, but this app supports ${CURRENT_SCHEMA_VERSION}.`,
      );
    }
    if (currentVersion === 0) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_1);
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(1, new Date().toISOString());
      });
    }
    if (currentVersion < 2) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_2);
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(2, new Date().toISOString());
      });
    }
    if (currentVersion < 3) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_3);
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(3, new Date().toISOString());
      });
    }
    if (currentVersion < 4) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_4);
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(4, new Date().toISOString());
      });
    }
    if (currentVersion < 5) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_5);
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(5, new Date().toISOString());
      });
    }
    if (currentVersion < 6) {
      this.#transaction(() => {
        this.#addColumnIfMissing(
          "parse_diagnostics",
          "page_number",
          "INTEGER CHECK(page_number IS NULL OR page_number > 0)",
        );
        this.#addColumnIfMissing(
          "document_blocks",
          "page_number",
          "INTEGER CHECK(page_number IS NULL OR page_number > 0)",
        );
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(6, new Date().toISOString());
      });
    }
    if (currentVersion < 7) {
      this.#transaction(() => {
        this.#addColumnIfMissing(
          "chat_messages",
          "routing_diagnostics_json",
          "TEXT",
        );
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(7, new Date().toISOString());
      });
    }
    if (currentVersion < 8) {
      this.#transaction(() => {
        this.#addColumnIfMissing("chat_messages", "answer_provenance_json", "TEXT");
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(8, new Date().toISOString());
      });
    }
    if (currentVersion < 9) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_9);
        // Like the other column migrations, tolerate libraries whose chat
        // tables were created by a later fresh-install path.
        this.#addColumnIfMissing(
          "chat_threads",
          "folder_id",
          "TEXT REFERENCES chat_folders(id) ON DELETE CASCADE",
        );
        const hasThreads = this.#database
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'chat_threads'")
          .get();
        if (hasThreads) {
          this.#database.exec(
            `CREATE INDEX IF NOT EXISTS chat_threads_folder_updated_idx
             ON chat_threads(folder_id, updated_at DESC)`,
          );
        }
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(9, new Date().toISOString());
      });
    }
    if (currentVersion < 10) {
      this.#transaction(() => {
        // Records when a reviewer has acknowledged a document's parse warnings.
        // Null means "not yet reviewed"; the value is an ISO timestamp.
        this.#addColumnIfMissing("documents", "reviewed_at", "TEXT");
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(10, new Date().toISOString());
      });
    }
    if (currentVersion < 11) {
      this.#transaction(() => {
        this.#database.exec(MIGRATION_11);
        // Threads excluded from memory never get summarized; excluding an
        // already-summarized thread deletes its stored memory immediately.
        this.#addColumnIfMissing(
          "chat_threads",
          "memory_excluded",
          "INTEGER NOT NULL DEFAULT 0 CHECK(memory_excluded IN (0, 1))",
        );
        this.#database
          .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)")
          .run(11, new Date().toISOString());
      });
    }
  }

  #addColumnIfMissing(table: string, column: string, definition: string): void {
    const tableExists = this.#database
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table);
    if (!tableExists) return;
    const columns = this.#database.prepare(`PRAGMA table_info(${table})`).all();
    if (columns.some((candidate) => asString(asRecord(candidate).name) === column)) return;
    this.#database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  #transaction<T>(operation: () => T): T {
    this.#database.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.#database.exec("COMMIT");
      return result;
    } catch (error) {
      this.#database.exec("ROLLBACK");
      throw error;
    }
  }

  public recoverInterruptedJobs(): number {
    const now = new Date().toISOString();
    const result = this.#database
      .prepare(
        `UPDATE ingestion_jobs
         SET status = 'interrupted', updated_at = ?
         WHERE status IN ('copying', 'parsing', 'chunking', 'indexing')`,
      )
      .run(now);
    return Number(result.changes);
  }

  public createJob(jobId: string, originalName: string): void {
    const now = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT INTO ingestion_jobs(
          id, document_id, original_name, status, progress,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, NULL, ?, 'queued', 0, NULL, NULL, ?, ?)`,
      )
      .run(jobId, originalName, now, now);
  }

  public updateJob(
    jobId: string,
    status: IngestionJobStatus,
    progress: number,
    options: {
      readonly documentId?: string;
      readonly errorCode?: string;
      readonly errorMessage?: string;
    } = {},
  ): void {
    this.#database
      .prepare(
        `UPDATE ingestion_jobs
         SET status = ?, progress = ?, document_id = coalesce(?, document_id),
             error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        status,
        progress,
        options.documentId ?? null,
        options.errorCode ?? null,
        options.errorMessage ?? null,
        new Date().toISOString(),
        jobId,
      );
  }

  public findDocumentByChecksum(checksum: string): DocumentSummary | null {
    const row = this.#database
      .prepare(
        `SELECT d.*, s.byte_size, o.original_name
         FROM documents d
         JOIN source_blobs s ON s.checksum = d.source_checksum
         JOIN source_origins o ON o.id = (
           SELECT id FROM source_origins WHERE source_checksum = d.source_checksum
           ORDER BY imported_at LIMIT 1
         )
         WHERE d.source_checksum = ?`,
      )
      .get(checksum);
    return row ? this.#mapDocument(row) : null;
  }

  public findDocumentById(documentId: string): DocumentSummary | null {
    requireNonEmpty(documentId, "Document ID");
    const row = this.#database
      .prepare(
        `SELECT d.*, s.byte_size, o.original_name
         FROM documents d
         JOIN source_blobs s ON s.checksum = d.source_checksum
         JOIN source_origins o ON o.id = (
           SELECT id FROM source_origins WHERE source_checksum = d.source_checksum
           ORDER BY imported_at LIMIT 1
         )
         WHERE d.id = ?`,
      )
      .get(documentId);
    return row ? this.#mapDocument(row) : null;
  }

  public addSourceOrigin(
    checksum: string,
    originalName: string,
    originalPath: string,
  ): void {
    this.#database
      .prepare(
        "INSERT INTO source_origins(id, source_checksum, original_name, original_path, imported_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(randomUUID(), checksum, originalName, originalPath, new Date().toISOString());
  }

  public createCanonicalDocument(input: NewCanonicalDocument): void {
    const now = new Date().toISOString();
    this.#transaction(() => {
      this.#database
        .prepare(
          `INSERT INTO source_blobs(
            checksum, managed_relative_path, byte_size, mime_type, created_at
          ) VALUES (?, ?, ?, ?, ?)`,
        )
        .run(
          input.checksum,
          input.managedRelativePath,
          input.sizeBytes,
          input.mimeType,
          now,
        );
      this.#database
        .prepare(
          "INSERT INTO source_origins(id, source_checksum, original_name, original_path, imported_at) VALUES (?, ?, ?, ?, ?)",
        )
        .run(randomUUID(), input.checksum, input.originalName, input.originalPath, now);
      this.#database
        .prepare(
          `INSERT INTO documents(
            id, source_checksum, title, format, status, diagnostic_count, created_at, updated_at
          ) VALUES (?, ?, ?, ?, 'processing', 0, ?, ?)`,
        )
        .run(
          input.documentId,
          input.checksum,
          input.originalName,
          input.format,
          now,
          now,
        );
      this.updateJob(input.jobId, "parsing", 0.45, { documentId: input.documentId });
    });
  }

  public completeDocument(
    documentId: string,
    document: NormalizedDocument,
    chunks: readonly DocumentChunk[],
    chunkerVersion: string,
  ): void {
    const status: DocumentStatus = document.diagnostics.some(
      (diagnostic) => diagnostic.severity === "warning",
    )
      ? "ready-with-warnings"
      : "ready";
    this.#transaction(() => {
      this.#database.prepare("DELETE FROM chunks_fts WHERE document_id = ?").run(documentId);
      this.#database.prepare("DELETE FROM chunks WHERE document_id = ?").run(documentId);
      this.#database.prepare("DELETE FROM document_blocks WHERE document_id = ?").run(documentId);
      this.#database.prepare("DELETE FROM document_sections WHERE document_id = ?").run(documentId);
      this.#database.prepare("DELETE FROM parse_diagnostics WHERE document_id = ?").run(documentId);

      const insertBlock = this.#database.prepare(
        `INSERT INTO document_blocks(
          id, document_id, ordinal, block_type, text_content,
          heading_path_json, level, start_line, end_line, attributes_json,
          source_path, source_fragment, page_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const block of document.blocks) {
        insertBlock.run(
          block.id,
          documentId,
          block.ordinal,
          block.type,
          block.text,
          JSON.stringify(block.headingPath),
          block.level ?? null,
          block.location?.startLine ?? null,
          block.location?.endLine ?? null,
          JSON.stringify(block.attributes),
          block.location?.sourcePath ?? null,
          block.location?.fragment ?? null,
          block.location?.pageNumber ?? null,
        );
      }

      const insertSection = this.#database.prepare(
        `INSERT INTO document_sections(
          id, document_id, ordinal, start_block_ordinal, end_block_ordinal,
          attributes_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const section of document.sections) {
        insertSection.run(
          randomUUID(),
          documentId,
          section.ordinal,
          section.startBlockOrdinal,
          section.endBlockOrdinal,
          JSON.stringify(section.attributes),
        );
      }

      const insertDiagnostic = this.#database.prepare(
        `INSERT INTO parse_diagnostics(
          id, document_id, ordinal, severity, code, message, start_line, end_line,
          source_path, source_fragment, page_number
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      document.diagnostics.forEach((diagnostic, ordinal) => {
        insertDiagnostic.run(
          randomUUID(),
          documentId,
          ordinal,
          diagnostic.severity,
          diagnostic.code,
          diagnostic.message,
          diagnostic.location?.startLine ?? null,
          diagnostic.location?.endLine ?? null,
          diagnostic.location?.sourcePath ?? null,
          diagnostic.location?.fragment ?? null,
          diagnostic.location?.pageNumber ?? null,
        );
      });

      const insertChunk = this.#database.prepare(
        `INSERT INTO chunks(
          public_id, document_id, ordinal, content, content_hash,
          heading_path_json, start_block_ordinal, end_block_ordinal,
          approximate_token_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = this.#database.prepare(
        `INSERT INTO chunks_fts(
          rowid, chunk_public_id, document_id, title, heading_path, content
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const chunk of chunks) {
        const result = insertChunk.run(
          chunk.id,
          documentId,
          chunk.ordinal,
          chunk.content,
          chunk.contentHash,
          JSON.stringify(chunk.headingPath),
          chunk.startBlockOrdinal,
          chunk.endBlockOrdinal,
          chunk.approximateTokenCount,
        );
        insertFts.run(
          result.lastInsertRowid,
          chunk.id,
          documentId,
          document.title,
          chunk.headingPath.join(" / "),
          chunk.content,
        );
      }

      this.#database
        .prepare(
          `UPDATE documents
           SET title = ?, status = ?, parser_id = ?, parser_version = ?,
                ir_schema_version = ?, chunker_version = ?, diagnostic_count = ?,
                metadata_json = ?,
                error_code = NULL, error_message = NULL, reviewed_at = NULL,
                updated_at = ?
           WHERE id = ?`,
        )
        .run(
          document.title,
          status,
          document.parserId,
          document.parserVersion,
          document.schemaVersion,
          chunkerVersion,
          document.diagnostics.length,
          JSON.stringify(document.metadata),
          new Date().toISOString(),
          documentId,
        );
    });
  }

  public failDocument(documentId: string, code: string, message: string): void {
    this.#database
      .prepare(
        `UPDATE documents
         SET status = 'failed', error_code = ?, error_message = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(code, message, new Date().toISOString(), documentId);
  }

  public beginDocumentReprocessing(documentId: string): void {
    // Reprocessing re-ingests an already-imported document from its stored
    // managed copy. Any settled document may be reprocessed; excluding
    // 'processing' avoids racing an in-flight import of the same document.
    const result = this.#database
      .prepare(
        `UPDATE documents
         SET status = 'processing', error_code = NULL, error_message = NULL, updated_at = ?
         WHERE id = ? AND status IN ('ready', 'ready-with-warnings', 'failed')`,
      )
      .run(new Date().toISOString(), documentId);
    if (Number(result.changes) !== 1) {
      throw new Error(`Document ${documentId} could not be reprocessed.`);
    }
  }

  public getDocumentSourceLocation(
    documentId: string,
  ): { readonly format: DocumentFormat; readonly managedRelativePath: string; readonly originalName: string } | null {
    requireNonEmpty(documentId, "Document ID");
    const row = this.#database
      .prepare(
        `SELECT d.format AS format,
                s.managed_relative_path AS managed_relative_path,
                o.original_name AS original_name
         FROM documents d
         JOIN source_blobs s ON s.checksum = d.source_checksum
         JOIN source_origins o ON o.id = (
           SELECT id FROM source_origins WHERE source_checksum = d.source_checksum
           ORDER BY imported_at LIMIT 1
         )
         WHERE d.id = ?`,
      )
      .get(documentId);
    if (!row) return null;
    const record = asRecord(row);
    return {
      format: asString(record.format) as DocumentFormat,
      managedRelativePath: asString(record.managed_relative_path),
      originalName: asString(record.original_name),
    };
  }

  public deleteDocument(
    documentId: string,
  ):
    | { readonly deleted: true; readonly managedRelativePath: string }
    | { readonly deleted: false; readonly reason: "import-in-progress" | "not-found" } {
    requireNonEmpty(documentId, "Document ID");
    return this.#transaction(() => {
      const row = this.#database
        .prepare(
          `SELECT d.source_checksum AS source_checksum,
                  s.managed_relative_path AS managed_relative_path
           FROM documents d
           JOIN source_blobs s ON s.checksum = d.source_checksum
           WHERE d.id = ?`,
        )
        .get(documentId);
      if (!row) return { deleted: false, reason: "not-found" } as const;
      const record = asRecord(row);
      const activeJob = this.#database
        .prepare(
          `SELECT 1 FROM ingestion_jobs
           WHERE document_id = ?
             AND status IN ('queued', 'copying', 'parsing', 'chunking', 'indexing')
           LIMIT 1`,
        )
        .get(documentId);
      if (activeJob) return { deleted: false, reason: "import-in-progress" } as const;
      // chunks_fts is a virtual table with no FK support; it is synced manually
      // everywhere else (completeDocument), so it must be cleared explicitly here.
      this.#database.prepare("DELETE FROM chunks_fts WHERE document_id = ?").run(documentId);
      this.#database.prepare("DELETE FROM documents WHERE id = ?").run(documentId);
      // The blob row is RESTRICT-protected by documents.source_checksum, so it can
      // only be removed after the document row; source_origins cascade from it.
      this.#database
        .prepare("DELETE FROM source_blobs WHERE checksum = ?")
        .run(asString(record.source_checksum));
      return {
        deleted: true,
        managedRelativePath: asString(record.managed_relative_path),
      } as const;
    });
  }

  public getDocumentDiagnostics(documentId: string): readonly ParseDiagnostic[] {
    requireNonEmpty(documentId, "Document ID");
    const rows = this.#database
      .prepare(
        `SELECT severity, code, message, start_line, end_line,
                source_path, source_fragment, page_number
         FROM parse_diagnostics
         WHERE document_id = ?
         ORDER BY ordinal ASC`,
      )
      .all(documentId);
    return rows.map((raw) => {
      const row = asRecord(raw);
      const location: {
        -readonly [K in keyof SourceLocation]: SourceLocation[K];
      } = {};
      const startLine = asNullableNumber(row.start_line);
      const endLine = asNullableNumber(row.end_line);
      const pageNumber = asNullableNumber(row.page_number);
      const sourcePath = asNullableString(row.source_path);
      const fragment = asNullableString(row.source_fragment);
      if (startLine !== null) location.startLine = startLine;
      if (endLine !== null) location.endLine = endLine;
      if (pageNumber !== null) location.pageNumber = pageNumber;
      if (sourcePath !== null) location.sourcePath = sourcePath;
      if (fragment !== null) location.fragment = fragment;
      const severity = asString(row.severity) as ParseDiagnostic["severity"];
      return {
        code: asString(row.code),
        message: asString(row.message),
        severity,
        ...(Object.keys(location).length > 0 ? { location } : {}),
      };
    });
  }

  public acknowledgeDocumentReview(documentId: string): void {
    requireNonEmpty(documentId, "Document ID");
    const result = this.#database
      .prepare(
        `UPDATE documents
         SET reviewed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'ready-with-warnings'`,
      )
      .run(new Date().toISOString(), new Date().toISOString(), documentId);
    if (Number(result.changes) !== 1) {
      throw new Error(
        `Document ${documentId} is not in a reviewable warning state.`,
      );
    }
  }

  public getLibrarySnapshot(): LibrarySnapshot {
    const documentRows = this.#database
      .prepare(
        `SELECT d.*, s.byte_size, o.original_name
         FROM documents d
         JOIN source_blobs s ON s.checksum = d.source_checksum
         JOIN source_origins o ON o.id = (
           SELECT id FROM source_origins WHERE source_checksum = d.source_checksum
           ORDER BY imported_at LIMIT 1
         )
         ORDER BY d.updated_at DESC`,
      )
      .all();
    const jobRows = this.#database
      .prepare("SELECT * FROM ingestion_jobs ORDER BY updated_at DESC LIMIT 50")
      .all();
    return {
      documents: documentRows.map((row) => this.#mapDocument(row)),
      jobs: jobRows.map((row) => this.#mapJob(row)),
    };
  }

  public search(query: string, limit = 20): readonly SearchResult[] {
    const ftsQuery = createFtsQuery(query);
    if (!ftsQuery) return [];
    return this.#database
      .prepare(
         `SELECT
            chunks_fts.chunk_public_id, chunks_fts.document_id,
            chunks_fts.title, chunks_fts.heading_path,
            chunks.start_block_ordinal, chunks.end_block_ordinal,
            start_block.source_path, start_block.source_fragment,
            start_block.page_number AS start_page_number,
            end_block.page_number AS end_page_number,
            snippet(chunks_fts, 4, '', '', '…', 28) AS snippet,
            bm25(chunks_fts, 0, 0, 3, 1, 5) AS rank
          FROM chunks_fts
          JOIN chunks ON chunks.public_id = chunks_fts.chunk_public_id
          LEFT JOIN document_blocks start_block
            ON start_block.document_id = chunks.document_id
           AND start_block.ordinal = chunks.start_block_ordinal
          LEFT JOIN document_blocks end_block
            ON end_block.document_id = chunks.document_id
           AND end_block.ordinal = chunks.end_block_ordinal
          WHERE chunks_fts MATCH ?
          ORDER BY rank ASC, chunks_fts.rowid ASC
         LIMIT ?`,
      )
      .all(ftsQuery, Math.min(Math.max(limit, 1), 50))
      .map((raw) => {
        const row = asRecord(raw);
        return {
          chunkId: asString(row.chunk_public_id),
          documentId: asString(row.document_id),
          endBlockOrdinal: asNumber(row.end_block_ordinal),
          endPageNumber: asNullableNumber(row.end_page_number),
          headingPath: asString(row.heading_path)
            .split(" / ")
            .filter(Boolean),
          rank: asNumber(row.rank),
          snippet: asString(row.snippet),
          sourceFragment: asNullableString(row.source_fragment),
          sourcePath: asNullableString(row.source_path),
          startBlockOrdinal: asNumber(row.start_block_ordinal),
          startPageNumber: asNullableNumber(row.start_page_number),
          title: asString(row.title),
        };
      });
  }

  public registerEmbeddingProfile(input: EmbeddingProfileIdentity): EmbeddingProfile {
    requireNonEmpty(input.provider, "Embedding provider");
    requireNonEmpty(input.model, "Embedding model");
    requireNonEmpty(input.digest, "Embedding model digest");
    requireNonEmpty(input.inputVersion, "Embedding input version");
    if (!Number.isSafeInteger(input.dimensions) || input.dimensions < 1) {
      throw new Error("Embedding dimensions must be a positive safe integer.");
    }
    const now = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT INTO embedding_profiles(
          id, provider, model, digest, dimensions, input_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, model, digest, dimensions, input_version)
        DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(
        randomUUID(),
        input.provider,
        input.model,
        input.digest,
        input.dimensions,
        input.inputVersion,
        now,
        now,
      );
    const row = this.#database
      .prepare(
        `SELECT * FROM embedding_profiles
         WHERE provider = ? AND model = ? AND digest = ?
           AND dimensions = ? AND input_version = ?`,
      )
      .get(input.provider, input.model, input.digest, input.dimensions, input.inputVersion);
    if (!row) throw new Error("Embedding profile registration failed.");
    return this.#mapEmbeddingProfile(row);
  }

  public getEmbeddingProfile(profileId: string): EmbeddingProfile | null {
    const row = this.#database
      .prepare("SELECT * FROM embedding_profiles WHERE id = ?")
      .get(profileId);
    return row ? this.#mapEmbeddingProfile(row) : null;
  }

  public createSemanticIndexJob(input: NewSemanticIndexJob): SemanticIndexJob {
    const totalChunks = input.totalChunks ?? this.#readyChunkCount();
    requireSafeNonNegativeInteger(totalChunks, "Total chunks");
    const id = input.id ?? randomUUID();
    const now = new Date().toISOString();
    this.#database
      .prepare(
        `INSERT INTO semantic_index_jobs(
          id, embedding_profile_id, status, total_chunks, processed_chunks,
          error_code, error_message, started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, 'queued', ?, 0, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(id, input.embeddingProfileId, totalChunks, now, now);
    const job = this.getSemanticIndexJob(id);
    if (!job) throw new Error("Semantic index job creation failed.");
    return job;
  }

  public getSemanticIndexJob(jobId: string): SemanticIndexJob | null {
    const row = this.#database
      .prepare("SELECT * FROM semantic_index_jobs WHERE id = ?")
      .get(jobId);
    return row ? this.#mapSemanticIndexJob(row) : null;
  }

  public updateSemanticIndexJob(
    jobId: string,
    update: SemanticIndexJobUpdate,
  ): SemanticIndexJob {
    const existing = this.getSemanticIndexJob(jobId);
    if (!existing) throw new Error(`Semantic index job ${jobId} does not exist.`);
    const totalChunks = update.totalChunks ?? existing.totalChunks;
    const processedChunks = update.processedChunks ?? existing.processedChunks;
    requireSafeNonNegativeInteger(totalChunks, "Total chunks");
    requireSafeNonNegativeInteger(processedChunks, "Processed chunks");
    if (processedChunks > totalChunks) {
      throw new Error("Processed chunks cannot exceed total chunks.");
    }
    const now = new Date().toISOString();
    const terminal = ["completed", "failed", "cancelled"].includes(update.status);
    this.#database
      .prepare(
        `UPDATE semantic_index_jobs
         SET status = ?, total_chunks = ?, processed_chunks = ?,
             error_code = ?, error_message = ?,
             started_at = CASE WHEN ? = 'running' THEN coalesce(started_at, ?) ELSE started_at END,
             completed_at = CASE WHEN ? THEN ? ELSE NULL END,
             updated_at = ?
         WHERE id = ?`,
      )
      .run(
        update.status,
        totalChunks,
        processedChunks,
        update.errorCode ?? null,
        update.errorMessage ?? null,
        update.status,
        now,
        terminal ? 1 : 0,
        now,
        now,
        jobId,
      );
    const job = this.getSemanticIndexJob(jobId);
    if (!job) throw new Error("Semantic index job update failed.");
    return job;
  }

  public recoverInterruptedSemanticIndexJobs(): number {
    const now = new Date().toISOString();
    const result = this.#database
      .prepare(
        `UPDATE semantic_index_jobs
         SET status = 'interrupted', completed_at = NULL, updated_at = ?
         WHERE status = 'running'`,
      )
      .run(now);
    return Number(result.changes);
  }

  public listChunksNeedingEmbedding(
    embeddingProfileId: string,
    limit = 100,
  ): readonly ChunkEmbeddingWorkItem[] {
    this.#requireEmbeddingProfile(embeddingProfileId);
    return this.#database
      .prepare(
        `SELECT c.public_id, c.document_id, c.content, c.content_hash,
                c.heading_path_json, d.title
         FROM chunks c
         JOIN documents d ON d.id = c.document_id
         LEFT JOIN chunk_embeddings ce
           ON ce.chunk_id = c.id AND ce.embedding_profile_id = ?
         WHERE d.status IN ('ready', 'ready-with-warnings')
           AND (ce.chunk_id IS NULL OR ce.content_hash != c.content_hash)
         ORDER BY d.created_at, c.document_id, c.ordinal
         LIMIT ?`,
      )
      .all(embeddingProfileId, boundedLimit(limit, MAX_EMBEDDING_BATCH_SIZE))
      .map((raw) => {
        const row = asRecord(raw);
        return {
          chunkId: asString(row.public_id),
          content: asString(row.content),
          contentHash: asString(row.content_hash),
          documentId: asString(row.document_id),
          headingPath: parseJson<readonly string[]>(row.heading_path_json, "heading path"),
          title: asString(row.title),
        };
      });
  }

  public upsertChunkEmbeddings(
    embeddingProfileId: string,
    embeddings: readonly ChunkEmbeddingInput[],
  ): number {
    if (embeddings.length === 0) return 0;
    if (embeddings.length > MAX_EMBEDDING_BATCH_SIZE) {
      throw new Error(`Embedding batches are limited to ${MAX_EMBEDDING_BATCH_SIZE} chunks.`);
    }
    const profile = this.#requireEmbeddingProfile(embeddingProfileId);
    const chunkIds = new Set<string>();
    const validated = embeddings.map((item) => {
      requireNonEmpty(item.chunkId, "Chunk ID");
      if (item.contentHash.length !== 64) {
        throw new Error(`Chunk ${item.chunkId} has an invalid content hash.`);
      }
      if (chunkIds.has(item.chunkId)) {
        throw new Error(`Chunk ${item.chunkId} appears more than once in the embedding batch.`);
      }
      chunkIds.add(item.chunkId);
      return { ...item, bytes: float32Bytes(item.embedding, profile.dimensions) };
    });
    const now = new Date().toISOString();
    return this.#transaction(() => {
      const insert = this.#database.prepare(
        `INSERT INTO chunk_embeddings(
          chunk_id, embedding_profile_id, content_hash, embedding, created_at, updated_at
        )
        SELECT id, ?, ?, ?, ?, ? FROM chunks
        WHERE public_id = ? AND content_hash = ?
        ON CONFLICT(chunk_id, embedding_profile_id) DO UPDATE SET
          content_hash = excluded.content_hash,
          embedding = excluded.embedding,
          updated_at = excluded.updated_at`,
      );
      const chunkExists = this.#database.prepare(
        "SELECT 1 FROM chunks WHERE public_id = ?",
      );
      let stored = 0;
      for (const item of validated) {
        const result = insert.run(
          embeddingProfileId,
          item.contentHash,
          item.bytes,
          now,
          now,
          item.chunkId,
          item.contentHash,
        );
        if (Number(result.changes) === 1) {
          stored += 1;
          continue;
        }
        // A chunk that vanished between listing and embedding (e.g. its document
        // was deleted) is skipped; a chunk that still exists with a different
        // hash indicates genuine drift and must fail the batch.
        if (chunkExists.get(item.chunkId)) {
          throw new Error(`Chunk ${item.chunkId} no longer has content hash ${item.contentHash}.`);
        }
      }
      return stored;
    });
  }

  public getEmbeddingCoverage(embeddingProfileId: string): EmbeddingCoverage {
    this.#requireEmbeddingProfile(embeddingProfileId);
    const row = asRecord(
      this.#database
        .prepare(
          `SELECT
             count(*) AS total_chunks,
             coalesce(sum(CASE WHEN ce.chunk_id IS NOT NULL AND ce.content_hash = c.content_hash THEN 1 ELSE 0 END), 0) AS current_chunks,
             coalesce(sum(CASE WHEN ce.chunk_id IS NULL THEN 1 ELSE 0 END), 0) AS missing_chunks,
             coalesce(sum(CASE WHEN ce.chunk_id IS NOT NULL AND ce.content_hash != c.content_hash THEN 1 ELSE 0 END), 0) AS stale_chunks
           FROM chunks c
           JOIN documents d ON d.id = c.document_id
           LEFT JOIN chunk_embeddings ce
             ON ce.chunk_id = c.id AND ce.embedding_profile_id = ?
           WHERE d.status IN ('ready', 'ready-with-warnings')`,
        )
        .get(embeddingProfileId),
    );
    const totalChunks = asNumber(row.total_chunks);
    const currentChunks = asNumber(row.current_chunks);
    return {
      currentChunks,
      missingChunks: asNumber(row.missing_chunks),
      ratio: totalChunks === 0 ? 1 : currentChunks / totalChunks,
      staleChunks: asNumber(row.stale_chunks),
      totalChunks,
    };
  }

  public searchVectors(
    embeddingProfileId: string,
    queryEmbedding: Float32Array | readonly number[],
    limit = 20,
  ): readonly VectorEvidenceResult[] {
    const profile = this.#requireEmbeddingProfile(embeddingProfileId);
    const query = float32Bytes(queryEmbedding, profile.dimensions);
    return this.#database
      .prepare(
        `SELECT c.public_id, c.document_id, c.content, c.heading_path_json,
                d.source_checksum, d.title,
                start_block.id AS start_block_id,
                start_block.ordinal AS start_block_ordinal,
                 start_block.start_line AS start_line,
                 start_block.end_line AS start_end_line,
                 start_block.page_number AS start_page_number,
                 start_block.source_path AS start_source_path,
                start_block.source_fragment AS start_source_fragment,
                end_block.id AS end_block_id,
                end_block.ordinal AS end_block_ordinal,
                 end_block.start_line AS end_start_line,
                 end_block.end_line AS end_line,
                 end_block.page_number AS end_page_number,
                 end_block.source_path AS end_source_path,
                end_block.source_fragment AS end_source_fragment,
                vec_distance_cosine(ce.embedding, ?) AS distance
         FROM chunk_embeddings ce
         JOIN chunks c ON c.id = ce.chunk_id AND c.content_hash = ce.content_hash
         JOIN documents d ON d.id = c.document_id
         JOIN document_blocks start_block
           ON start_block.document_id = c.document_id
          AND start_block.ordinal = c.start_block_ordinal
         JOIN document_blocks end_block
           ON end_block.document_id = c.document_id
          AND end_block.ordinal = c.end_block_ordinal
         WHERE ce.embedding_profile_id = ?
           AND d.status IN ('ready', 'ready-with-warnings')
         ORDER BY distance, c.id
         LIMIT ?`,
      )
      .all(query, embeddingProfileId, boundedLimit(limit, MAX_RETRIEVAL_RESULTS))
      .map((raw) => {
        const row = asRecord(raw);
        const distance = asNumber(row.distance);
        return {
          ...this.#mapEvidence(row),
          distance,
          score: 1 - distance,
        };
      });
  }

  public deleteProfileVectors(embeddingProfileId: string): number {
    this.#requireEmbeddingProfile(embeddingProfileId);
    return Number(
      this.#database
        .prepare("DELETE FROM chunk_embeddings WHERE embedding_profile_id = ?")
        .run(embeddingProfileId).changes,
    );
  }

  public getEmbeddingRebuildState(embeddingProfileId: string): EmbeddingRebuildState {
    const coverage = this.getEmbeddingCoverage(embeddingProfileId);
    const row = this.#database
      .prepare(
        `SELECT * FROM semantic_index_jobs
         WHERE embedding_profile_id = ?
         ORDER BY updated_at DESC, id DESC LIMIT 1`,
      )
      .get(embeddingProfileId);
    return {
      ...coverage,
      embeddingProfileId,
      latestJob: row ? this.#mapSemanticIndexJob(row) : null,
      needsRebuild: coverage.currentChunks !== coverage.totalChunks,
    };
  }

  public searchLexicalEvidence(query: string, limit = 20): readonly LexicalEvidenceResult[] {
    const ftsQuery = createFtsQuery(query);
    if (!ftsQuery) return [];
    return this.#database
      .prepare(
        `SELECT c.public_id, c.document_id, c.content, c.heading_path_json,
                d.source_checksum, d.title,
                start_block.id AS start_block_id,
                start_block.ordinal AS start_block_ordinal,
                 start_block.start_line AS start_line,
                 start_block.end_line AS start_end_line,
                 start_block.page_number AS start_page_number,
                 start_block.source_path AS start_source_path,
                start_block.source_fragment AS start_source_fragment,
                end_block.id AS end_block_id,
                end_block.ordinal AS end_block_ordinal,
                 end_block.start_line AS end_start_line,
                 end_block.end_line AS end_line,
                 end_block.page_number AS end_page_number,
                 end_block.source_path AS end_source_path,
                end_block.source_fragment AS end_source_fragment,
                bm25(chunks_fts, 0, 0, 3, 1, 5) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.public_id = chunks_fts.chunk_public_id
         JOIN documents d ON d.id = c.document_id
         JOIN document_blocks start_block
           ON start_block.document_id = c.document_id
          AND start_block.ordinal = c.start_block_ordinal
         JOIN document_blocks end_block
           ON end_block.document_id = c.document_id
          AND end_block.ordinal = c.end_block_ordinal
         WHERE chunks_fts MATCH ?
           AND d.status IN ('ready', 'ready-with-warnings')
         ORDER BY rank, chunks_fts.rowid
         LIMIT ?`,
      )
      .all(ftsQuery, boundedLimit(limit, MAX_RETRIEVAL_RESULTS))
      .map((raw) => {
        const row = asRecord(raw);
        const rank = asNumber(row.rank);
        return { ...this.#mapEvidence(row), rank, score: -rank };
      });
  }

  public getSourceBlockWindow(
    request: SourceBlockWindowRequest,
  ): readonly SourceBlock[];
  public getSourceBlockWindow(
    chunkId: string,
    before?: number,
    after?: number,
  ): readonly SourceBlock[];
  public getSourceBlockWindow(
    requestOrChunkId: SourceBlockWindowRequest | string,
    before = 2,
    after = 2,
  ): readonly SourceBlock[] {
    const request =
      typeof requestOrChunkId === "string"
        ? { after, before, chunkId: requestOrChunkId }
        : requestOrChunkId;
    const beforeCount = request.before ?? 2;
    const afterCount = request.after ?? 2;
    requireSafeNonNegativeInteger(beforeCount, "Blocks before");
    requireSafeNonNegativeInteger(afterCount, "Blocks after");
    if (beforeCount > 50 || afterCount > 50) {
      throw new Error("Source block windows are limited to 50 blocks on each side.");
    }

    let documentId = request.documentId;
    let startBlockOrdinal = request.startBlockOrdinal;
    let endBlockOrdinal = request.endBlockOrdinal;
    if (request.chunkId !== undefined) {
      const chunk = this.#database
        .prepare(
          `SELECT document_id, start_block_ordinal, end_block_ordinal
           FROM chunks WHERE public_id = ?`,
        )
        .get(request.chunkId);
      if (!chunk) return [];
      const row = asRecord(chunk);
      documentId = asString(row.document_id);
      startBlockOrdinal = asNumber(row.start_block_ordinal);
      endBlockOrdinal = asNumber(row.end_block_ordinal);
    }
    if (
      documentId === undefined ||
      startBlockOrdinal === undefined ||
      endBlockOrdinal === undefined
    ) {
      throw new Error("A chunk ID or a document ID with start and end block ordinals is required.");
    }
    requireSafeNonNegativeInteger(startBlockOrdinal, "Start block ordinal");
    requireSafeNonNegativeInteger(endBlockOrdinal, "End block ordinal");
    if (endBlockOrdinal < startBlockOrdinal) {
      throw new Error("End block ordinal cannot precede start block ordinal.");
    }
    return this.#database
      .prepare(
        `SELECT * FROM document_blocks
         WHERE document_id = ? AND ordinal BETWEEN ? AND ?
         ORDER BY ordinal`,
      )
      .all(
        documentId,
        Math.max(0, startBlockOrdinal - beforeCount),
        endBlockOrdinal + afterCount,
      )
      .map((raw) => this.#mapSourceBlock(raw));
  }

  public getPreviousChunkContext(chunkId: string): PreviousChunkContext | null {
    const rows = this.#database
      .prepare(
        `SELECT previous.content,
                 start_block.id AS start_block_id,
                start_block.ordinal AS start_block_ordinal,
                start_block.start_line,
                start_block.end_line,
                start_block.page_number,
                start_block.source_path,
                start_block.source_fragment
         FROM chunks target
         JOIN chunks previous
           ON previous.document_id = target.document_id
           AND previous.ordinal BETWEEN target.ordinal - 2 AND target.ordinal - 1
         JOIN document_blocks start_block
           ON start_block.document_id = previous.document_id
           AND start_block.ordinal = previous.start_block_ordinal
         WHERE target.public_id = ?
         ORDER BY previous.ordinal`,
      )
      .all(chunkId);
    const records = rows.map((row) => asRecord(row));
    const first = records[0];
    if (!first) return null;
    return {
      content: records.map((record) => asString(record.content)).join("\n\n"),
      start: {
        blockId: asString(first.start_block_id),
        blockOrdinal: asNumber(first.start_block_ordinal),
        endLine: asNullableNumber(first.end_line),
        pageNumber: asNullableNumber(first.page_number),
        sourceFragment: asNullableString(first.source_fragment),
        sourcePath: asNullableString(first.source_path),
        startLine: asNullableNumber(first.start_line),
      },
    };
  }

  public createChatRun(input: NewChatRun): ChatRun {
    requireNonEmpty(input.userContent, "User message");
    const threadId = input.threadId ?? randomUUID();
    const userMessageId = input.userMessageId ?? randomUUID();
    const assistantMessageId = input.assistantMessageId ?? randomUUID();
    const runId = input.runId ?? randomUUID();
    const now = new Date().toISOString();
    this.#transaction(() => {
      if (input.threadId === undefined) {
        const title = input.threadTitle?.trim() || input.userContent.trim().slice(0, 80);
        this.#database
          .prepare(
            "INSERT INTO chat_threads(id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
          )
          .run(threadId, title, now, now);
      } else {
        const exists = this.#database
          .prepare("SELECT 1 AS found FROM chat_threads WHERE id = ?")
          .get(threadId);
        if (!exists) throw new Error(`Chat thread ${threadId} does not exist.`);
        this.#database
          .prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?")
          .run(now, threadId);
      }
      const insert = this.#database.prepare(
        `INSERT INTO chat_messages(
          id, thread_id, role, ordinal, status, content, run_id, model,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)`,
      );
      const firstOrdinal = asNumber(
        asRecord(
          this.#database
            .prepare(
              "SELECT coalesce(max(ordinal) + 1, 0) AS ordinal FROM chat_messages WHERE thread_id = ?",
            )
            .get(threadId),
        ).ordinal,
      );
      insert.run(
        userMessageId,
        threadId,
        "user",
        firstOrdinal,
        "completed",
        input.userContent,
        null,
        null,
        now,
        now,
      );
      insert.run(
        assistantMessageId,
        threadId,
        "assistant",
        firstOrdinal + 1,
        "pending",
        "",
        runId,
        input.model ?? null,
        now,
        now,
      );
    });
    const thread = this.#getThreadSummary(threadId);
    const userMessage = this.#getChatMessage(userMessageId);
    const assistantMessage = this.#getChatMessage(assistantMessageId);
    if (!thread || !userMessage || !assistantMessage) {
      throw new Error("Chat run creation failed.");
    }
    return { assistantMessage, runId, thread, userMessage };
  }

  public updateChatRun(runId: string, update: UpdateChatRunOptions): ChatMessage {
    const now = new Date().toISOString();
    const result = this.#database
      .prepare(
        `UPDATE chat_messages
         SET status = ?, model = coalesce(?, model), error_code = NULL,
             error_message = NULL, updated_at = ?
         WHERE run_id = ? AND role = 'assistant'
           AND status IN ('pending', 'retrieving', 'planning', 'generating')`,
      )
      .run(update.status, update.model ?? null, now, runId);
    if (Number(result.changes) !== 1) throw new Error(`Chat run ${runId} is not active.`);
    this.#touchThreadForRun(runId, now);
    return this.#requireChatRunMessage(runId);
  }

  public setChatRoutingDiagnostics(runId: string, diagnostics: object): ChatMessage {
    if (diagnostics === null || Array.isArray(diagnostics)) {
      throw new Error("Chat routing diagnostics must be an object.");
    }
    const now = new Date().toISOString();
    const result = this.#database
      .prepare(
        `UPDATE chat_messages
         SET routing_diagnostics_json = ?, updated_at = ?
         WHERE run_id = ? AND role = 'assistant'
           AND status IN ('pending', 'retrieving', 'planning', 'generating')`,
      )
      .run(JSON.stringify(diagnostics), now, runId);
    if (Number(result.changes) !== 1) throw new Error(`Chat run ${runId} is not active.`);
    this.#touchThreadForRun(runId, now);
    return this.#requireChatRunMessage(runId);
  }

  public appendAssistantContent(runId: string, content: string): ChatMessage {
    if (content.length === 0) return this.#requireChatRunMessage(runId);
    const now = new Date().toISOString();
    const result = this.#database
      .prepare(
        `UPDATE chat_messages
         SET content = content || ?, updated_at = ?
         WHERE run_id = ? AND role = 'assistant'
           AND status IN ('pending', 'retrieving', 'planning', 'generating')`,
      )
      .run(content, now, runId);
    if (Number(result.changes) !== 1) throw new Error(`Chat run ${runId} is not active.`);
    this.#touchThreadForRun(runId, now);
    return this.#requireChatRunMessage(runId);
  }

  public completeChatRun(runId: string, options: CompleteChatRunOptions = {}): ChatMessage {
    const status = options.status ?? "completed";
    return this.#finishChatRun(runId, status, {
      ...(options.answerProvenance === undefined
        ? {}
        : { answerProvenance: requireObject(options.answerProvenance, "Answer provenance") }),
      ...(options.citations === undefined ? {} : { citations: options.citations }),
      ...(options.content === undefined ? {} : { content: options.content }),
      ...(options.model === undefined ? {} : { model: options.model }),
      ...(options.routingDiagnostics === undefined
        ? {}
        : { routingDiagnostics: options.routingDiagnostics }),
    });
  }

  public failChatRun(runId: string, options: ChatRunErrorOptions): ChatMessage {
    requireNonEmpty(options.message, "Chat run error message");
    return this.#finishChatRun(runId, "failed", {
      ...(options.citations === undefined ? {} : { citations: options.citations }),
      ...(options.content === undefined ? {} : { content: options.content }),
      errorCode: options.code ?? "CHAT_RUN_FAILED",
      errorMessage: options.message,
    });
  }

  public cancelChatRun(
    runId: string,
    options: ChatRunTerminalOptions = {},
  ): ChatMessage {
    return this.#finishChatRun(runId, "cancelled", options);
  }

  public recoverInterruptedChatRuns(): number {
    const now = new Date().toISOString();
    return this.#transaction(() => {
      this.#database
        .prepare(
          `UPDATE chat_threads SET updated_at = ?
           WHERE id IN (
             SELECT thread_id FROM chat_messages
             WHERE role = 'assistant'
               AND status IN ('pending', 'retrieving', 'planning', 'generating')
           )`,
        )
        .run(now);
      const result = this.#database
        .prepare(
          `UPDATE chat_messages
           SET status = 'interrupted', error_code = 'APP_INTERRUPTED',
               error_message = 'The app closed before this response completed.', updated_at = ?
           WHERE role = 'assistant'
             AND status IN ('pending', 'retrieving', 'planning', 'generating')`,
        )
        .run(now);
      return Number(result.changes);
    });
  }

  public listChatThreads(limit = 50, offset = 0): readonly ChatThreadSummary[] {
    requireSafeNonNegativeInteger(offset, "Thread offset");
    return this.#database
      .prepare(this.#threadSummarySql("ORDER BY t.updated_at DESC, t.id DESC LIMIT ? OFFSET ?"))
      .all(boundedLimit(limit, 100), offset)
      .map((row) => this.#mapChatThreadSummary(row));
  }

  public getChatThread(threadId: string): ChatThread | null {
    const summary = this.#getThreadSummary(threadId);
    if (!summary) return null;
    const messages = this.#database
      .prepare("SELECT * FROM chat_messages WHERE thread_id = ? ORDER BY ordinal")
      .all(threadId)
      .map((row) => this.#mapChatMessage(row));
    return { ...summary, messages };
  }

  public getChatCitation(citationId: string): ChatCitation | null {
    const row = this.#database
      .prepare("SELECT * FROM chat_citations WHERE id = ?")
      .get(citationId);
    return row ? this.#mapChatCitation(row) : null;
  }

  #requireFolderName(name: string): string {
    const trimmed = name.trim();
    requireNonEmpty(trimmed, "Folder name");
    if (trimmed.length > 120) {
      throw new Error("Folder names are limited to 120 characters.");
    }
    return trimmed;
  }

  public createChatFolder(name: string): ChatFolder {
    const trimmed = this.#requireFolderName(name);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.#database
      .prepare(
        "INSERT INTO chat_folders(id, name, created_at, updated_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, trimmed, now, now);
    return { createdAt: now, id, name: trimmed, updatedAt: now };
  }

  public renameChatFolder(folderId: string, name: string): ChatFolder | null {
    requireNonEmpty(folderId, "Folder ID");
    const trimmed = this.#requireFolderName(name);
    const result = this.#database
      .prepare("UPDATE chat_folders SET name = ?, updated_at = ? WHERE id = ?")
      .run(trimmed, new Date().toISOString(), folderId);
    if (Number(result.changes) === 0) return null;
    const row = this.#database
      .prepare("SELECT * FROM chat_folders WHERE id = ?")
      .get(folderId);
    return row ? this.#mapChatFolder(row) : null;
  }

  public listChatFolders(limit = 100): readonly ChatFolder[] {
    return this.#database
      .prepare("SELECT * FROM chat_folders ORDER BY created_at, rowid LIMIT ?")
      .all(boundedLimit(limit, 100))
      .map((row) => this.#mapChatFolder(row));
  }

  public listChatThreadIdsInFolder(folderId: string): readonly string[] {
    requireNonEmpty(folderId, "Folder ID");
    return this.#database
      .prepare("SELECT id FROM chat_threads WHERE folder_id = ?")
      .all(folderId)
      .map((row) => asString(asRecord(row).id));
  }

  public deleteChatFolder(
    folderId: string,
  ): { readonly deleted: boolean; readonly deletedThreadIds: readonly string[] } {
    requireNonEmpty(folderId, "Folder ID");
    return this.#transaction(() => {
      const deletedThreadIds = this.#database
        .prepare("SELECT id FROM chat_threads WHERE folder_id = ?")
        .all(folderId)
        .map((row) => asString(asRecord(row).id));
      const result = this.#database
        .prepare("DELETE FROM chat_folders WHERE id = ?")
        .run(folderId);
      return {
        deleted: Number(result.changes) > 0,
        deletedThreadIds: Number(result.changes) > 0 ? deletedThreadIds : [],
      };
    });
  }

  public setChatThreadFolder(
    threadId: string,
    folderId: string | null,
  ):
    | { readonly moved: true; readonly summary: ChatThreadSummary }
    | { readonly moved: false; readonly reason: "folder-not-found" | "thread-not-found" } {
    requireNonEmpty(threadId, "Thread ID");
    return this.#transaction(() => {
      if (folderId !== null) {
        const folder = this.#database
          .prepare("SELECT 1 FROM chat_folders WHERE id = ?")
          .get(folderId);
        if (!folder) return { moved: false, reason: "folder-not-found" } as const;
      }
      const result = this.#database
        .prepare("UPDATE chat_threads SET folder_id = ?, updated_at = ? WHERE id = ?")
        .run(folderId, new Date().toISOString(), threadId);
      if (Number(result.changes) === 0) {
        return { moved: false, reason: "thread-not-found" } as const;
      }
      const summary = this.#getThreadSummary(threadId);
      if (summary === null) {
        return { moved: false, reason: "thread-not-found" } as const;
      }
      return { moved: true, summary } as const;
    });
  }

  public deleteChatThread(threadId: string): boolean {
    requireNonEmpty(threadId, "Thread ID");
    const result = this.#database
      .prepare("DELETE FROM chat_threads WHERE id = ?")
      .run(threadId);
    return Number(result.changes) > 0;
  }

  public renameChatThread(threadId: string, title: string): ChatThreadSummary | null {
    requireNonEmpty(threadId, "Thread ID");
    const trimmed = title.trim();
    requireNonEmpty(trimmed, "Thread title");
    if (trimmed.length > 512) {
      throw new Error("Thread titles are limited to 512 characters.");
    }
    return this.#transaction(() => {
      const result = this.#database
        .prepare("UPDATE chat_threads SET title = ?, updated_at = ? WHERE id = ?")
        .run(trimmed, new Date().toISOString(), threadId);
      if (Number(result.changes) === 0) return null;
      // The thread title is part of the memory search index.
      this.#refreshMemoryFts(threadId);
      return this.#getThreadSummary(threadId);
    });
  }

  public getThreadMemory(threadId: string): ThreadMemory | null {
    requireNonEmpty(threadId, "Thread ID");
    const row = this.#database
      .prepare("SELECT * FROM thread_memories WHERE thread_id = ?")
      .get(threadId);
    return row ? this.#mapThreadMemory(row) : null;
  }

  public upsertThreadMemory(input: ThreadMemoryInput): ThreadMemory | null {
    requireNonEmpty(input.threadId, "Thread ID");
    requireNonEmpty(input.promptVersion, "Memory prompt version");
    requireSafeNonNegativeInteger(input.summarizedMessageCount, "Summarized message count");
    const summaryText = input.summaryText.trim();
    requireNonEmpty(summaryText, "Memory summary");
    if (summaryText.length > MAX_MEMORY_SUMMARY_CHARACTERS) {
      throw new Error(
        `Memory summaries are limited to ${MAX_MEMORY_SUMMARY_CHARACTERS} characters.`,
      );
    }
    return this.#transaction(() => {
      const thread = this.#database
        .prepare("SELECT memory_excluded FROM chat_threads WHERE id = ?")
        .get(input.threadId);
      // A thread deleted or excluded while its summary was being generated
      // must not have its memory (re)created.
      if (!thread || asNumber(asRecord(thread).memory_excluded) === 1) return null;
      const now = new Date().toISOString();
      this.#database
        .prepare(
          `INSERT INTO thread_memories(
             thread_id, summary_json, summary_text, topics_json, content_hash,
             prompt_version, summarized_message_count, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(thread_id) DO UPDATE SET
             summary_json = excluded.summary_json,
             summary_text = excluded.summary_text,
             topics_json = excluded.topics_json,
             content_hash = excluded.content_hash,
             prompt_version = excluded.prompt_version,
             summarized_message_count = excluded.summarized_message_count,
             updated_at = excluded.updated_at`,
        )
        .run(
          input.threadId,
          JSON.stringify(input.summaryJson),
          summaryText,
          JSON.stringify(input.topics),
          createHash("sha256").update(summaryText).digest("hex"),
          input.promptVersion,
          input.summarizedMessageCount,
          now,
          now,
        );
      this.#refreshMemoryFts(input.threadId);
      const row = this.#database
        .prepare("SELECT * FROM thread_memories WHERE thread_id = ?")
        .get(input.threadId);
      if (!row) throw new Error("Failed to store the thread memory.");
      return this.#mapThreadMemory(row);
    });
  }

  public listThreadsNeedingMemorySummary(
    promptVersion: string,
    limit = 8,
  ): readonly MemorySummaryWorkItem[] {
    requireNonEmpty(promptVersion, "Memory prompt version");
    return this.#database
      .prepare(
        `SELECT t.id AS thread_id, counts.completed_count
         FROM chat_threads t
         JOIN (
           SELECT thread_id, count(*) AS completed_count
           FROM chat_messages
           WHERE status = 'completed'
           GROUP BY thread_id
         ) counts ON counts.thread_id = t.id
         LEFT JOIN thread_memories tm ON tm.thread_id = t.id
         WHERE t.memory_excluded = 0
           AND EXISTS (
             SELECT 1 FROM chat_messages m
             WHERE m.thread_id = t.id AND m.role = 'assistant' AND m.status = 'completed'
           )
           AND (
             tm.thread_id IS NULL
             OR tm.prompt_version != ?
             OR tm.summarized_message_count < counts.completed_count
           )
         ORDER BY t.updated_at DESC, t.id DESC
         LIMIT ?`,
      )
      .all(promptVersion, boundedLimit(limit, 100))
      .map((raw) => {
        const row = asRecord(raw);
        return {
          completedMessageCount: asNumber(row.completed_count),
          threadId: asString(row.thread_id),
        };
      });
  }

  public listMemoriesNeedingEmbedding(
    embeddingProfileId: string,
    limit = 8,
  ): readonly MemoryEmbeddingWorkItem[] {
    this.#requireEmbeddingProfile(embeddingProfileId);
    return this.#database
      .prepare(
        `SELECT tm.thread_id, tm.summary_text, tm.content_hash
         FROM thread_memories tm
         JOIN chat_threads t ON t.id = tm.thread_id
         LEFT JOIN memory_embeddings me
           ON me.thread_id = tm.thread_id AND me.embedding_profile_id = ?
         WHERE t.memory_excluded = 0
           AND (me.thread_id IS NULL OR me.content_hash != tm.content_hash)
         ORDER BY tm.updated_at, tm.thread_id
         LIMIT ?`,
      )
      .all(embeddingProfileId, boundedLimit(limit, MAX_EMBEDDING_BATCH_SIZE))
      .map((raw) => {
        const row = asRecord(raw);
        return {
          contentHash: asString(row.content_hash),
          summaryText: asString(row.summary_text),
          threadId: asString(row.thread_id),
        };
      });
  }

  public upsertMemoryEmbedding(
    embeddingProfileId: string,
    input: MemoryEmbeddingInput,
  ): boolean {
    requireNonEmpty(input.threadId, "Thread ID");
    if (input.contentHash.length !== 64) {
      throw new Error(`Memory for thread ${input.threadId} has an invalid content hash.`);
    }
    const profile = this.#requireEmbeddingProfile(embeddingProfileId);
    const bytes = float32Bytes(input.embedding, profile.dimensions);
    const now = new Date().toISOString();
    const result = this.#database
      .prepare(
        `INSERT INTO memory_embeddings(
          thread_id, embedding_profile_id, content_hash, embedding, created_at, updated_at
        )
        SELECT thread_id, ?, ?, ?, ?, ? FROM thread_memories
        WHERE thread_id = ? AND content_hash = ?
        ON CONFLICT(thread_id, embedding_profile_id) DO UPDATE SET
          content_hash = excluded.content_hash,
          embedding = excluded.embedding,
          updated_at = excluded.updated_at`,
      )
      .run(
        embeddingProfileId,
        input.contentHash,
        bytes,
        now,
        now,
        input.threadId,
        input.contentHash,
      );
    // A memory deleted or re-summarized between listing and embedding is
    // skipped; the next maintenance pass picks up the fresh content.
    return Number(result.changes) === 1;
  }

  public searchMemoryLexical(
    query: string,
    limit = 20,
    excludeThreadId: string | null = null,
  ): readonly MemorySearchResult[] {
    const ftsQuery = createFtsQuery(query);
    if (!ftsQuery) return [];
    return this.#database
      .prepare(
        `SELECT tm.thread_id, tm.summary_text, t.title, t.updated_at,
                bm25(memories_fts, 0, 3, 2, 5) AS rank
         FROM memories_fts
         JOIN thread_memories tm ON tm.thread_id = memories_fts.thread_id
         JOIN chat_threads t ON t.id = tm.thread_id
         WHERE memories_fts MATCH ?
           AND t.memory_excluded = 0
           AND tm.thread_id != ?
         ORDER BY rank, memories_fts.rowid
         LIMIT ?`,
      )
      .all(ftsQuery, excludeThreadId ?? "", boundedLimit(limit, MAX_RETRIEVAL_RESULTS))
      .map((raw) => {
        const row = asRecord(raw);
        return { ...this.#mapMemorySearchRow(row), score: -asNumber(row.rank) };
      });
  }

  public searchMemoryVectors(
    embeddingProfileId: string,
    queryEmbedding: Float32Array | readonly number[],
    limit = 20,
    excludeThreadId: string | null = null,
  ): readonly MemorySearchResult[] {
    const profile = this.#requireEmbeddingProfile(embeddingProfileId);
    const query = float32Bytes(queryEmbedding, profile.dimensions);
    return this.#database
      .prepare(
        `SELECT tm.thread_id, tm.summary_text, t.title, t.updated_at,
                vec_distance_cosine(me.embedding, ?) AS distance
         FROM memory_embeddings me
         JOIN thread_memories tm
           ON tm.thread_id = me.thread_id AND tm.content_hash = me.content_hash
         JOIN chat_threads t ON t.id = tm.thread_id
         WHERE me.embedding_profile_id = ?
           AND t.memory_excluded = 0
           AND tm.thread_id != ?
         ORDER BY distance, tm.thread_id
         LIMIT ?`,
      )
      .all(
        query,
        embeddingProfileId,
        excludeThreadId ?? "",
        boundedLimit(limit, MAX_RETRIEVAL_RESULTS),
      )
      .map((raw) => {
        const row = asRecord(raw);
        return { ...this.#mapMemorySearchRow(row), score: 1 - asNumber(row.distance) };
      });
  }

  public setThreadMemoryExclusion(
    threadId: string,
    excluded: boolean,
  ): ChatThreadSummary | null {
    requireNonEmpty(threadId, "Thread ID");
    return this.#transaction(() => {
      const result = this.#database
        .prepare("UPDATE chat_threads SET memory_excluded = ?, updated_at = ? WHERE id = ?")
        .run(excluded ? 1 : 0, new Date().toISOString(), threadId);
      if (Number(result.changes) === 0) return null;
      if (excluded) {
        // Privacy scrub: cascades remove embeddings, the trigger removes the
        // FTS row, and secure_delete overwrites the freed pages.
        this.#database
          .prepare("DELETE FROM thread_memories WHERE thread_id = ?")
          .run(threadId);
      }
      return this.#getThreadSummary(threadId);
    });
  }

  public getMemoryStatus(promptVersion: string): MemoryStatus {
    requireNonEmpty(promptVersion, "Memory prompt version");
    const counts = asRecord(
      this.#database
        .prepare(
          `SELECT
             (SELECT count(*) FROM user_facts WHERE status = 'active') AS fact_count,
             (SELECT count(*) FROM thread_memories) AS summarized_count,
             (SELECT count(*) FROM chat_threads WHERE memory_excluded = 1) AS excluded_count`,
        )
        .get(),
    );
    return {
      excludedThreadCount: asNumber(counts.excluded_count),
      factCount: asNumber(counts.fact_count),
      staleThreadCount: this.listThreadsNeedingMemorySummary(promptVersion, 100).length,
      summarizedThreadCount: asNumber(counts.summarized_count),
    };
  }

  public listUserFacts(): readonly UserFact[] {
    return this.#database
      .prepare("SELECT * FROM user_facts WHERE status = 'active' ORDER BY created_at, rowid")
      .all()
      .map((row) => this.#mapUserFact(row));
  }

  public insertExtractedUserFact(input: NewExtractedUserFact): UserFact | null {
    const fact = input.fact.trim();
    requireNonEmpty(fact, "User fact");
    if (fact.length > MAX_USER_FACT_CHARACTERS) {
      throw new Error(`User facts are limited to ${MAX_USER_FACT_CHARACTERS} characters.`);
    }
    if (!USER_FACT_CATEGORIES.includes(input.category)) {
      throw new Error(`Unknown user fact category: ${input.category}.`);
    }
    const hash = normalizedFactHash(fact);
    return this.#transaction(() => {
      // A matching hash on any row — active, tombstoned, or user-edited —
      // blocks re-extraction.
      const existing = this.#database
        .prepare("SELECT 1 FROM user_facts WHERE normalized_hash = ?")
        .get(hash);
      if (existing) return null;
      const activeCount = asNumber(
        asRecord(
          this.#database
            .prepare("SELECT count(*) AS count FROM user_facts WHERE status = 'active'")
            .get(),
        ).count,
      );
      if (activeCount >= MAX_ACTIVE_USER_FACTS) {
        // Evict the oldest extracted fact to make room; facts the user wrote
        // or edited are never evicted. Eviction is a hard delete (not a
        // tombstone) so the fact may legitimately come back later.
        const evictable = this.#database
          .prepare(
            `SELECT id FROM user_facts
             WHERE status = 'active' AND origin = 'extracted'
             ORDER BY created_at, rowid LIMIT 1`,
          )
          .get();
        if (!evictable) return null;
        this.#database
          .prepare("DELETE FROM user_facts WHERE id = ?")
          .run(asString(asRecord(evictable).id));
      }
      const now = new Date().toISOString();
      const id = randomUUID();
      this.#database
        .prepare(
          `INSERT INTO user_facts(
             id, fact, normalized_hash, category, origin, status,
             source_thread_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'extracted', 'active', ?, ?, ?)`,
        )
        .run(id, fact, hash, input.category, input.sourceThreadId, now, now);
      const row = this.#database.prepare("SELECT * FROM user_facts WHERE id = ?").get(id);
      if (!row) throw new Error("Failed to store the user fact.");
      return this.#mapUserFact(row);
    });
  }

  public updateUserFact(factId: string, fact: string): UserFact | null {
    requireNonEmpty(factId, "Fact ID");
    const trimmed = fact.trim();
    requireNonEmpty(trimmed, "User fact");
    if (trimmed.length > MAX_USER_FACT_CHARACTERS) {
      throw new Error(`User facts are limited to ${MAX_USER_FACT_CHARACTERS} characters.`);
    }
    const hash = normalizedFactHash(trimmed);
    return this.#transaction(() => {
      const conflict = this.#database
        .prepare("SELECT 1 FROM user_facts WHERE normalized_hash = ? AND id != ?")
        .get(hash, factId);
      if (conflict) throw new Error("An equivalent memory already exists.");
      const result = this.#database
        .prepare(
          `UPDATE user_facts
           SET fact = ?, normalized_hash = ?, origin = 'user', updated_at = ?
           WHERE id = ? AND status = 'active'`,
        )
        .run(trimmed, hash, new Date().toISOString(), factId);
      if (Number(result.changes) === 0) return null;
      const row = this.#database.prepare("SELECT * FROM user_facts WHERE id = ?").get(factId);
      return row ? this.#mapUserFact(row) : null;
    });
  }

  public deleteUserFact(factId: string): boolean {
    requireNonEmpty(factId, "Fact ID");
    // Tombstone rather than delete so the fact is never re-extracted.
    const result = this.#database
      .prepare(
        `UPDATE user_facts SET status = 'deleted', updated_at = ?
         WHERE id = ? AND status = 'active'`,
      )
      .run(new Date().toISOString(), factId);
    return Number(result.changes) > 0;
  }

  #refreshMemoryFts(threadId: string): void {
    this.#database.prepare("DELETE FROM memories_fts WHERE thread_id = ?").run(threadId);
    const row = this.#database
      .prepare(
        `SELECT tm.summary_text, tm.topics_json, t.title
         FROM thread_memories tm
         JOIN chat_threads t ON t.id = tm.thread_id
         WHERE tm.thread_id = ?`,
      )
      .get(threadId);
    if (!row) return;
    const record = asRecord(row);
    const topics = parseJson<readonly string[]>(record.topics_json, "memory topics");
    this.#database
      .prepare("INSERT INTO memories_fts(thread_id, title, topics, content) VALUES (?, ?, ?, ?)")
      .run(threadId, asString(record.title), topics.join("\n"), asString(record.summary_text));
  }

  #mapThreadMemory(raw: unknown): ThreadMemory {
    const row = asRecord(raw);
    return {
      contentHash: asString(row.content_hash),
      createdAt: asString(row.created_at),
      promptVersion: asString(row.prompt_version),
      summarizedMessageCount: asNumber(row.summarized_message_count),
      summaryJson: parseJsonObject(row.summary_json, "memory summary"),
      summaryText: asString(row.summary_text),
      threadId: asString(row.thread_id),
      topics: parseJson<readonly string[]>(row.topics_json, "memory topics"),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapMemorySearchRow(row: Record<string, unknown>): Omit<MemorySearchResult, "score"> {
    return {
      content: asString(row.summary_text),
      threadId: asString(row.thread_id),
      threadTitle: asString(row.title),
      threadUpdatedAt: asString(row.updated_at),
    };
  }

  #mapUserFact(raw: unknown): UserFact {
    const row = asRecord(raw);
    return {
      category: asString(row.category) as UserFactCategory,
      createdAt: asString(row.created_at),
      fact: asString(row.fact),
      id: asString(row.id),
      origin: asString(row.origin) as UserFactOrigin,
      sourceThreadId: asNullableString(row.source_thread_id),
      updatedAt: asString(row.updated_at),
    };
  }

  public setSelectedEmbeddingProfile(embeddingProfileId: string | null): void {
    if (embeddingProfileId !== null) this.#requireEmbeddingProfile(embeddingProfileId);
    this.#database
      .prepare(
        `UPDATE selected_model_settings
         SET embedding_profile_id = ?, updated_at = ? WHERE id = 1`,
      )
      .run(embeddingProfileId, new Date().toISOString());
  }

  public setGenerationModelSettings(
    mode: "auto" | "manual",
    model: GenerationModelSelection | null,
  ): void {
    if (mode === "manual" && model === null) {
      throw new Error("Manual generation selection requires a model.");
    }
    if (model !== null) {
      requireNonEmpty(model.provider, "Generation provider");
      requireNonEmpty(model.model, "Generation model");
      requireNonEmpty(model.digest, "Generation model digest");
      requireSafeNonNegativeInteger(model.sizeBytes, "Generation model size");
      if (!Number.isSafeInteger(model.contextWindow) || model.contextWindow <= 0) {
        throw new Error("Generation context window must be a positive safe integer.");
      }
    }
    const current = this.getSelectedModelSettings();
    if (
      current.generationSelectionMode === mode &&
      JSON.stringify(current.generationModel) === JSON.stringify(model)
    ) {
      return;
    }
    this.#database
      .prepare(
        `UPDATE selected_model_settings
         SET generation_provider = ?, generation_model = ?, generation_digest = ?,
             generation_selection_mode = ?, generation_context_window = ?,
             generation_size_bytes = ?, updated_at = ?
         WHERE id = 1`,
      )
      .run(
        model?.provider ?? null,
        model?.model ?? null,
        model?.digest ?? null,
        mode,
        model?.contextWindow ?? null,
        model?.sizeBytes ?? null,
        new Date().toISOString(),
      );
  }

  public setSelectedGenerationModel(model: GenerationModelSelection | null): void {
    this.setGenerationModelSettings(model === null ? "auto" : "manual", model);
  }

  public getSelectedModelSettings(): SelectedModelSettings {
    const row = asRecord(
      this.#database.prepare("SELECT * FROM selected_model_settings WHERE id = 1").get(),
    );
    const provider = asNullableString(row.generation_provider);
    const model = asNullableString(row.generation_model);
    const digest = asNullableString(row.generation_digest);
    const contextWindow = asNullableNumber(row.generation_context_window);
    const sizeBytes = asNullableNumber(row.generation_size_bytes);
    return {
      embeddingProfileId: asNullableString(row.embedding_profile_id),
      generationModel:
        provider === null ||
        model === null ||
        digest === null ||
        contextWindow === null ||
        sizeBytes === null
          ? null
          : { contextWindow, digest, model, provider, sizeBytes },
      generationSelectionMode: asString(row.generation_selection_mode) as
        | "auto"
        | "manual",
      updatedAt: asString(row.updated_at),
    };
  }

  #readyChunkCount(): number {
    return asNumber(
      asRecord(
        this.#database
          .prepare(
            `SELECT count(*) AS count FROM chunks c
             JOIN documents d ON d.id = c.document_id
             WHERE d.status IN ('ready', 'ready-with-warnings')`,
          )
          .get(),
      ).count,
    );
  }

  #requireEmbeddingProfile(profileId: string): EmbeddingProfile {
    const profile = this.getEmbeddingProfile(profileId);
    if (!profile) throw new Error(`Embedding profile ${profileId} does not exist.`);
    return profile;
  }

  #mapEmbeddingProfile(raw: unknown): EmbeddingProfile {
    const row = asRecord(raw);
    return {
      createdAt: asString(row.created_at),
      digest: asString(row.digest),
      dimensions: asNumber(row.dimensions),
      id: asString(row.id),
      inputVersion: asString(row.input_version),
      model: asString(row.model),
      provider: asString(row.provider),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapSemanticIndexJob(raw: unknown): SemanticIndexJob {
    const row = asRecord(raw);
    return {
      completedAt: asNullableString(row.completed_at),
      createdAt: asString(row.created_at),
      embeddingProfileId: asString(row.embedding_profile_id),
      errorCode: asNullableString(row.error_code),
      errorMessage: asNullableString(row.error_message),
      id: asString(row.id),
      processedChunks: asNumber(row.processed_chunks),
      startedAt: asNullableString(row.started_at),
      status: asString(row.status) as SemanticIndexJobStatus,
      totalChunks: asNumber(row.total_chunks),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapEvidence(raw: unknown): EvidenceResult {
    const row = asRecord(raw);
    const chunkId = asString(row.public_id);
    const documentId = asString(row.document_id);
    return {
      chunkId,
      documentId,
      headingPath: parseJson<readonly string[]>(row.heading_path_json, "heading path"),
      sourceChecksum: asString(row.source_checksum),
      sourceLocator: {
        chunkId,
        documentId,
        end: {
          blockId: asString(row.end_block_id),
          blockOrdinal: asNumber(row.end_block_ordinal),
          endLine: asNullableNumber(row.end_line),
          pageNumber: asNullableNumber(row.end_page_number),
          sourceFragment: asNullableString(row.end_source_fragment),
          sourcePath: asNullableString(row.end_source_path),
          startLine: asNullableNumber(row.end_start_line),
        },
        start: {
          blockId: asString(row.start_block_id),
          blockOrdinal: asNumber(row.start_block_ordinal),
          endLine: asNullableNumber(row.start_end_line),
          pageNumber: asNullableNumber(row.start_page_number),
          sourceFragment: asNullableString(row.start_source_fragment),
          sourcePath: asNullableString(row.start_source_path),
          startLine: asNullableNumber(row.start_line),
        },
      },
      text: asString(row.content),
      title: asString(row.title),
    };
  }

  #mapSourceBlock(raw: unknown): SourceBlock {
    const row = asRecord(raw);
    return {
      attributes: parseJson<Readonly<Record<string, unknown>>>(
        row.attributes_json,
        "block attributes",
      ),
      endLine: asNullableNumber(row.end_line),
      headingPath: parseJson<readonly string[]>(row.heading_path_json, "heading path"),
      id: asString(row.id),
      ordinal: asNumber(row.ordinal),
      pageNumber: asNullableNumber(row.page_number),
      sourceFragment: asNullableString(row.source_fragment),
      sourcePath: asNullableString(row.source_path),
      startLine: asNullableNumber(row.start_line),
      text: asString(row.text_content),
      type: asString(row.block_type),
    };
  }

  #finishChatRun(
    runId: string,
    status: "cancelled" | "completed" | "failed" | "insufficient",
    options: FinishChatRunOptions,
  ): ChatMessage {
    const now = new Date().toISOString();
    const messageId = this.#transaction(() => {
      const active = this.#database
        .prepare(
          `SELECT id, thread_id FROM chat_messages
           WHERE run_id = ? AND role = 'assistant'
             AND status IN ('pending', 'retrieving', 'planning', 'generating')`,
        )
        .get(runId);
      if (!active) throw new Error(`Chat run ${runId} is not active.`);
      const row = asRecord(active);
      const id = asString(row.id);
      const result = this.#database
        .prepare(
          `UPDATE chat_messages
            SET status = ?, content = coalesce(?, content), model = coalesce(?, model),
                 routing_diagnostics_json = coalesce(?, routing_diagnostics_json),
                 answer_provenance_json = ?, error_code = ?, error_message = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(
          status,
          options.content ?? null,
          options.model ?? null,
          options.routingDiagnostics === undefined
            ? null
            : JSON.stringify(options.routingDiagnostics),
          options.answerProvenance == null
            ? null
            : JSON.stringify(requireObject(options.answerProvenance, "Answer provenance")),
          options.errorCode ?? null,
          options.errorMessage ?? null,
          now,
          id,
        );
      if (Number(result.changes) !== 1) throw new Error(`Chat run ${runId} could not be finished.`);
      this.#insertChatCitations(id, options.citations ?? [], now);
      this.#database
        .prepare("UPDATE chat_threads SET updated_at = ? WHERE id = ?")
        .run(now, asString(row.thread_id));
      return id;
    });
    const message = this.#getChatMessage(messageId);
    if (!message) throw new Error("Completed chat message could not be loaded.");
    return message;
  }

  #insertChatCitations(
    messageId: string,
    citations: readonly ChatCitationInput[],
    now: string,
  ): void {
    const ordinals = new Set<number>();
    const evidenceIds = new Set<string>();
    const insert = this.#database.prepare(
      `INSERT INTO chat_citations(
        id, message_id, ordinal, evidence_id, document_id, chunk_id,
        title, text_content, heading_path_json, source_locator_json,
        retrieval_component_scores_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    citations.forEach((citation, index) => {
      const ordinal = citation.ordinal ?? index;
      requireSafeNonNegativeInteger(ordinal, "Citation ordinal");
      requireNonEmpty(citation.evidenceId, "Citation evidence ID");
      requireNonEmpty(citation.documentId, "Citation document ID");
      requireNonEmpty(citation.chunkId, "Citation chunk ID");
      if (ordinals.has(ordinal)) throw new Error(`Citation ordinal ${ordinal} is duplicated.`);
      if (evidenceIds.has(citation.evidenceId)) {
        throw new Error(`Citation evidence ID ${citation.evidenceId} is duplicated.`);
      }
      for (const component of citation.retrievalComponentScores) {
        requireNonEmpty(component.component, "Citation retrieval component");
        if (!Number.isFinite(component.score)) {
          throw new Error("Citation retrieval scores must be finite.");
        }
        if (component.rank !== undefined) {
          requireSafeNonNegativeInteger(component.rank, "Citation retrieval rank");
        }
        if (
          component.reciprocalRankScore !== undefined &&
          !Number.isFinite(component.reciprocalRankScore)
        ) {
          throw new Error("Citation reciprocal rank scores must be finite.");
        }
      }
      ordinals.add(ordinal);
      evidenceIds.add(citation.evidenceId);
      insert.run(
        citation.id ?? randomUUID(),
        messageId,
        ordinal,
        citation.evidenceId,
        citation.documentId,
        citation.chunkId,
        citation.title,
        citation.text,
        JSON.stringify(citation.headingPath),
        JSON.stringify(citation.sourceLocator),
        JSON.stringify(citation.retrievalComponentScores),
        now,
      );
    });
  }

  #touchThreadForRun(runId: string, now: string): void {
    this.#database
      .prepare(
        `UPDATE chat_threads SET updated_at = ?
         WHERE id = (SELECT thread_id FROM chat_messages WHERE run_id = ?)`,
      )
      .run(now, runId);
  }

  #requireChatRunMessage(runId: string): ChatMessage {
    const row = this.#database
      .prepare("SELECT * FROM chat_messages WHERE run_id = ?")
      .get(runId);
    if (!row) throw new Error(`Chat run ${runId} does not exist.`);
    return this.#mapChatMessage(row);
  }

  #getChatMessage(messageId: string): ChatMessage | null {
    const row = this.#database
      .prepare("SELECT * FROM chat_messages WHERE id = ?")
      .get(messageId);
    return row ? this.#mapChatMessage(row) : null;
  }

  #mapChatMessage(raw: unknown): ChatMessage {
    const row = asRecord(raw);
    const id = asString(row.id);
    const citations = this.#database
      .prepare("SELECT * FROM chat_citations WHERE message_id = ? ORDER BY ordinal")
      .all(id)
      .map((citation) => this.#mapChatCitation(citation));
    return {
      answerProvenance:
        row.answer_provenance_json === null
          ? null
          : parseJsonObject(row.answer_provenance_json, "answer provenance JSON"),
      citations,
      content: asString(row.content),
      createdAt: asString(row.created_at),
      errorCode: asNullableString(row.error_code),
      errorMessage: asNullableString(row.error_message),
      id,
      model: asNullableString(row.model),
      ordinal: asNumber(row.ordinal),
      role: asString(row.role) as ChatMessageRole,
      routingDiagnostics:
        row.routing_diagnostics_json === null
          ? null
          : parseJson<object>(row.routing_diagnostics_json, "chat routing diagnostics"),
      runId: asNullableString(row.run_id),
      status: asString(row.status) as ChatMessageStatus,
      threadId: asString(row.thread_id),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapChatCitation(raw: unknown): ChatCitation {
    const row = asRecord(raw);
    return {
      chunkId: asString(row.chunk_id),
      createdAt: asString(row.created_at),
      documentId: asString(row.document_id),
      evidenceId: asString(row.evidence_id),
      headingPath: parseJson<readonly string[]>(row.heading_path_json, "citation heading path"),
      id: asString(row.id),
      messageId: asString(row.message_id),
      ordinal: asNumber(row.ordinal),
      retrievalComponentScores: parseJson<readonly CitationRetrievalScore[]>(
        row.retrieval_component_scores_json,
        "citation retrieval scores",
      ),
      sourceLocator: parseJson<Readonly<Record<string, unknown>>>(
        row.source_locator_json,
        "citation source locator",
      ),
      text: asString(row.text_content),
      title: asString(row.title),
    };
  }

  #threadSummarySql(suffix: string): string {
    return `SELECT t.*,
              (SELECT count(*) FROM chat_messages m WHERE m.thread_id = t.id) AS message_count,
              (SELECT m.created_at FROM chat_messages m WHERE m.thread_id = t.id
               ORDER BY m.ordinal DESC LIMIT 1) AS last_message_at,
              (SELECT substr(m.content, 1, 160) FROM chat_messages m WHERE m.thread_id = t.id
               ORDER BY m.ordinal DESC LIMIT 1) AS last_message_preview
            FROM chat_threads t ${suffix}`;
  }

  #getThreadSummary(threadId: string): ChatThreadSummary | null {
    const row = this.#database
      .prepare(this.#threadSummarySql("WHERE t.id = ?"))
      .get(threadId);
    return row ? this.#mapChatThreadSummary(row) : null;
  }

  #mapChatThreadSummary(raw: unknown): ChatThreadSummary {
    const row = asRecord(raw);
    return {
      createdAt: asString(row.created_at),
      folderId: asNullableString(row.folder_id),
      id: asString(row.id),
      lastMessageAt: asNullableString(row.last_message_at),
      lastMessagePreview: asNullableString(row.last_message_preview),
      memoryExcluded: asNumber(row.memory_excluded) === 1,
      messageCount: asNumber(row.message_count),
      title: asString(row.title),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapChatFolder(raw: unknown): ChatFolder {
    const row = asRecord(raw);
    return {
      createdAt: asString(row.created_at),
      id: asString(row.id),
      name: asString(row.name),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapDocument(raw: unknown): DocumentSummary {
    const row = asRecord(raw);
    return {
      createdAt: asString(row.created_at),
      diagnosticCount: asNumber(row.diagnostic_count),
      errorCode: asNullableString(row.error_code),
      errorMessage: asNullableString(row.error_message),
      format: asString(row.format) as DocumentFormat,
      id: asString(row.id),
      originalName: asString(row.original_name),
      reviewedAt: asNullableString(row.reviewed_at),
      sizeBytes: asNumber(row.byte_size),
      status: asString(row.status) as DocumentStatus,
      title: asString(row.title),
      updatedAt: asString(row.updated_at),
    };
  }

  #mapJob(raw: unknown): JobSummary {
    const row = asRecord(raw);
    return {
      createdAt: asString(row.created_at),
      documentId: asNullableString(row.document_id),
      errorCode: asNullableString(row.error_code),
      errorMessage: asNullableString(row.error_message),
      id: asString(row.id),
      originalName: asString(row.original_name),
      progress: asNumber(row.progress),
      status: asString(row.status) as IngestionJobStatus,
      updatedAt: asString(row.updated_at),
    };
  }
}
