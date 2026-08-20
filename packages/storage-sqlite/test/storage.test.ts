import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import * as sqliteVec from "sqlite-vec";
import { describe, expect, it } from "vitest";

import { chunkDocument, ingestionVersions, parseDocumentBytes } from "@knosys-rag/ingestion";

import { KnosysDatabase } from "../src/index.js";

const encoder = new TextEncoder();
const vectorExtensionPath = sqliteVec.getLoadablePath();

async function seedReadyDocument(
  database: KnosysDatabase,
  options: {
    readonly checksum?: string;
    readonly content?: string;
    readonly documentId?: string;
    readonly jobId?: string;
    readonly originalName?: string;
  } = {},
) {
  const jobId = options.jobId ?? "95e6918f-b508-4720-ac7f-e0ea979c47e4";
  const documentId = options.documentId ?? "21aa57d5-bd8e-48fd-a298-e76db44ed429";
  const checksum = options.checksum ?? "a".repeat(64);
  const originalName = options.originalName ?? "guide.md";
  database.createJob(jobId, originalName);
  database.createCanonicalDocument({
    checksum,
    documentId,
    format: "markdown",
    jobId,
    managedRelativePath: `sources/${checksum.slice(0, 2)}/${checksum}.md`,
    mimeType: "text/markdown",
    originalName,
    originalPath: `/private/${originalName}`,
    sizeBytes: 128,
  });
  const document = await parseDocumentBytes(
    encoder.encode(
      options.content ?? "# Seed saving\n\nStore dry seeds in a cool, dark place.",
    ),
    originalName,
    "markdown",
  );
  database.completeDocument(
    documentId,
    document,
    chunkDocument(document),
    ingestionVersions.chunker,
  );
  database.updateJob(jobId, "completed", 1, { documentId });
  return { documentId, jobId };
}

const embeddingProfileInput = {
  digest: "sha256:" + "1".repeat(64),
  dimensions: 3,
  inputVersion: "document-v1",
  model: "test-embedding",
  provider: "test",
} as const;

describe("canonical SQLite storage", () => {
  it("loads sqlite-vec and performs exact cosine search", () => {
    const database = new DatabaseSync(":memory:", { allowExtension: true });
    sqliteVec.load(database);
    database.enableLoadExtension(false);
    database.exec("CREATE VIRTUAL TABLE vectors USING vec0(embedding float[3] distance_metric=cosine)");
    const insert = database.prepare("INSERT INTO vectors(rowid, embedding) VALUES (?, ?)");
    insert.run(1n, new Uint8Array(new Float32Array([1, 0, 0]).buffer));
    insert.run(2n, new Uint8Array(new Float32Array([0, 1, 0]).buffer));
    const matches = database
      .prepare(
        `SELECT rowid, distance
         FROM vectors
         WHERE embedding MATCH ? AND k = 2
         ORDER BY distance`,
      )
      .all(new Uint8Array(new Float32Array([0.9, 0.1, 0]).buffer));
    expect(matches[0]).toMatchObject({ rowid: 1 });
    expect(matches[1]).toMatchObject({ rowid: 2 });
    database.close();
  });

  it("migrates, stores normalized state, and retrieves FTS results", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    expect(database.getVectorExtensionVersion()).toBe("v0.1.9");
    await seedReadyDocument(database);
    const snapshot = database.getLibrarySnapshot();
    expect(snapshot.documents).toHaveLength(1);
    expect(snapshot.documents[0]?.status).toBe("ready");
    expect(snapshot.jobs[0]?.status).toBe("completed");
    expect(database.search("cool dark seeds")[0]).toMatchObject({
      endBlockOrdinal: expect.any(Number),
      sourceFragment: null,
      sourcePath: null,
      startBlockOrdinal: expect.any(Number),
      title: "Seed saving",
    });
    expect(database.search('" OR * malformed')).toEqual([]);
    database.close();
  });

  it("detects exact duplicates by source checksum", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const { documentId } = await seedReadyDocument(database);
    expect(database.findDocumentByChecksum("a".repeat(64))?.id).toBe(documentId);
    database.close();
  });

  it("recovers active jobs as interrupted without auto-resuming", () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    database.createJob("e7e2468c-6387-4522-915b-0d84289c67ba", "notes.txt");
    database.updateJob("e7e2468c-6387-4522-915b-0d84289c67ba", "copying", 0.2);
    expect(database.recoverInterruptedJobs()).toBe(1);
    expect(database.getLibrarySnapshot().jobs[0]?.status).toBe("interrupted");
    database.close();
  });

  it("creates schema 9 with folders and nullable answer provenance on a fresh library", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-fresh-"));
    const sourcePath = join(root, "state.sqlite");
    const database = new KnosysDatabase(sourcePath, vectorExtensionPath);
    database.close();

    const raw = new DatabaseSync(sourcePath);
    const migration = raw
      .prepare("SELECT max(version) AS version FROM schema_migrations")
      .get() as { version: number };
    const tables = raw
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (
           'embedding_profiles', 'semantic_index_jobs', 'chunk_embeddings',
           'chat_threads', 'chat_messages', 'chat_citations', 'selected_model_settings',
           'chat_folders'
         )
         ORDER BY name`,
      )
      .all();
    const chatColumns = raw.prepare("PRAGMA table_info(chat_messages)").all() as {
      name: string;
    }[];
    const threadColumns = raw.prepare("PRAGMA table_info(chat_threads)").all() as {
      name: string;
    }[];
    expect(migration.version).toBe(9);
    expect(chatColumns.map(({ name }) => name)).toContain("answer_provenance_json");
    expect(threadColumns.map(({ name }) => name)).toContain("folder_id");
    expect(tables).toHaveLength(8);
    raw.close();
    await rm(root, { recursive: true });
  });

  it("migrates an existing schema-2 library to the current schema without losing documents", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-migration-"));
    const sourcePath = join(root, "state.sqlite");
    const database = new KnosysDatabase(sourcePath, vectorExtensionPath);
    await seedReadyDocument(database);
    database.close();

    const downgrade = new DatabaseSync(sourcePath);
    downgrade.exec(`
      DROP TRIGGER chat_citations_immutable_update;
      DROP TABLE selected_model_settings;
      DROP TABLE chat_citations;
      DROP TABLE chat_messages;
      DROP TABLE chat_threads;
      DROP TABLE chat_folders;
      DROP TRIGGER chunk_embeddings_dimensions_update;
      DROP TRIGGER chunk_embeddings_dimensions_insert;
      DROP TABLE chunk_embeddings;
      DROP TABLE semantic_index_jobs;
      DROP TABLE embedding_profiles;
      DELETE FROM schema_migrations WHERE version > 2;
    `);
    downgrade.close();

    const migrated = new KnosysDatabase(sourcePath, vectorExtensionPath);
    expect(migrated.getLibrarySnapshot().documents[0]?.title).toBe("Seed saving");
    expect(migrated.search("cool dark seeds")[0]?.sourcePath).toBeNull();
    expect(migrated.registerEmbeddingProfile(embeddingProfileInput).dimensions).toBe(3);
    migrated.close();
    await rm(root, { recursive: true });
  });

  it("migrates schema 7 chat messages to nullable schema 8 provenance", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-provenance-migration-"));
    const sourcePath = join(root, "state.sqlite");
    const initial = new KnosysDatabase(sourcePath, vectorExtensionPath);
    const run = initial.createChatRun({ userContent: "Legacy question" });
    initial.completeChatRun(run.runId, { content: "Legacy answer" });
    initial.close();

    const schema7 = new DatabaseSync(sourcePath);
    schema7.exec(`
      DROP INDEX chat_threads_folder_updated_idx;
      ALTER TABLE chat_threads DROP COLUMN folder_id;
      DROP TABLE chat_folders;
      ALTER TABLE chat_messages DROP COLUMN answer_provenance_json;
      DELETE FROM schema_migrations WHERE version >= 8;
    `);
    schema7.close();

    const migrated = new KnosysDatabase(sourcePath, vectorExtensionPath);
    expect(migrated.getChatThread(run.thread.id)?.messages.at(-1)).toMatchObject({
      answerProvenance: null,
      content: "Legacy answer",
    });
    expect(migrated.getChatThread(run.thread.id)?.folderId).toBeNull();
    migrated.close();
    const check = new DatabaseSync(sourcePath);
    expect(
      (check.prepare("SELECT max(version) AS version FROM schema_migrations").get() as {
        version: number;
      }).version,
    ).toBe(9);
    check.close();
    await rm(root, { recursive: true });
  });

  it("migrates schema-4 generation selections as manual preferences", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-selection-migration-"));
    const sourcePath = join(root, "state.sqlite");
    const raw = new DatabaseSync(sourcePath);
    raw.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO schema_migrations(version, applied_at)
      VALUES (1, '2026-01-01T00:00:00.000Z'),
             (2, '2026-01-01T00:00:00.000Z'),
             (3, '2026-01-01T00:00:00.000Z'),
             (4, '2026-01-01T00:00:00.000Z');
      CREATE TABLE selected_model_settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        embedding_profile_id TEXT,
        generation_provider TEXT,
        generation_model TEXT,
        generation_digest TEXT,
        updated_at TEXT NOT NULL
      ) STRICT;
      INSERT INTO selected_model_settings(
        id, generation_provider, generation_model, generation_digest, updated_at
      ) VALUES (
        1, 'ollama', 'legacy-local:latest', '${"a".repeat(64)}',
        '2026-01-01T00:00:00.000Z'
      );
    `);
    raw.close();

    const migrated = new KnosysDatabase(sourcePath, vectorExtensionPath);
    expect(migrated.getSelectedModelSettings()).toMatchObject({
      generationModel: {
        contextWindow: 32768,
        digest: "a".repeat(64),
        model: "legacy-local:latest",
        provider: "ollama",
        sizeBytes: 0,
      },
      generationSelectionMode: "manual",
    });
    migrated.close();
    await rm(root, { recursive: true });
  });

  it("registers profiles idempotently and recovers semantic indexing jobs", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    await seedReadyDocument(database);
    const profile = database.registerEmbeddingProfile(embeddingProfileInput);
    expect(database.registerEmbeddingProfile(embeddingProfileInput).id).toBe(profile.id);
    expect(database.getEmbeddingProfile(profile.id)).toMatchObject(embeddingProfileInput);

    const job = database.createSemanticIndexJob({ embeddingProfileId: profile.id });
    expect(job).toMatchObject({ status: "queued", totalChunks: 1 });
    database.updateSemanticIndexJob(job.id, {
      processedChunks: 0,
      status: "running",
    });
    expect(database.recoverInterruptedSemanticIndexJobs()).toBe(1);
    expect(database.getSemanticIndexJob(job.id)?.status).toBe("interrupted");
    database.close();
  });

  it("validates vectors, ignores stale hashes and other models, and returns nearest chunks", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-vectors-"));
    const sourcePath = join(root, "state.sqlite");
    const database = new KnosysDatabase(sourcePath, vectorExtensionPath);
    await seedReadyDocument(database);
    await seedReadyDocument(database, {
      checksum: "b".repeat(64),
      content: "# Irrigation\n\nWater seedlings gently in the morning.",
      documentId: "31aa57d5-bd8e-48fd-a298-e76db44ed429",
      jobId: "85e6918f-b508-4720-ac7f-e0ea979c47e4",
      originalName: "irrigation.md",
    });
    const profile = database.registerEmbeddingProfile(embeddingProfileInput);
    const otherProfile = database.registerEmbeddingProfile({
      ...embeddingProfileInput,
      digest: "sha256:" + "2".repeat(64),
    });
    const chunks = database.listChunksNeedingEmbedding(profile.id, 5);
    const seedChunk = chunks.find((chunk) => chunk.content.includes("dry seeds"));
    const irrigationChunk = chunks.find((chunk) => chunk.content.includes("seedlings"));
    expect(chunks).toHaveLength(2);
    if (!seedChunk || !irrigationChunk) throw new Error("Expected embedding work items.");

    expect(() =>
      database.upsertChunkEmbeddings(profile.id, [
        {
          chunkId: seedChunk.chunkId,
          contentHash: seedChunk.contentHash,
          embedding: [1, 0],
        },
      ]),
    ).toThrow(/dimensions/);
    expect(() =>
      database.upsertChunkEmbeddings(profile.id, [
        {
          chunkId: seedChunk.chunkId,
          contentHash: seedChunk.contentHash,
          embedding: [1, Number.NaN, 0],
        },
      ]),
    ).toThrow(/non-finite/);
    expect(() =>
      database.upsertChunkEmbeddings(profile.id, [
        {
          chunkId: seedChunk.chunkId,
          contentHash: "c".repeat(64),
          embedding: [1, 0, 0],
        },
      ]),
    ).toThrow(/no longer has content hash/);

    expect(
      database.upsertChunkEmbeddings(profile.id, [
        {
          chunkId: seedChunk.chunkId,
          contentHash: seedChunk.contentHash,
          embedding: [1, 0, 0],
        },
        {
          chunkId: irrigationChunk.chunkId,
          contentHash: irrigationChunk.contentHash,
          embedding: [0, 1, 0],
        },
      ]),
    ).toBe(2);
    expect(database.getEmbeddingCoverage(profile.id)).toMatchObject({
      currentChunks: 2,
      missingChunks: 0,
      ratio: 1,
      staleChunks: 0,
      totalChunks: 2,
    });
    expect(database.searchVectors(profile.id, [0.9, 0.1, 0], 5).map((item) => item.chunkId)).toEqual([
      seedChunk.chunkId,
      irrigationChunk.chunkId,
    ]);
    expect(database.searchVectors(profile.id, [0.9, 0.1, 0], 5)[0]).toMatchObject({
      chunkId: seedChunk.chunkId,
      score: expect.any(Number),
      text: seedChunk.content,
    });
    expect(database.searchVectors(otherProfile.id, [1, 0, 0], 5)).toEqual([]);
    expect(database.listChunksNeedingEmbedding(otherProfile.id, 5)).toHaveLength(2);
    database.close();

    const raw = new DatabaseSync(sourcePath);
    raw.prepare("UPDATE chunks SET content_hash = ? WHERE public_id = ?").run(
      "d".repeat(64),
      seedChunk.chunkId,
    );
    raw.close();
    const reopened = new KnosysDatabase(sourcePath, vectorExtensionPath);
    expect(reopened.searchVectors(profile.id, [1, 0, 0], 5).map((item) => item.chunkId)).toEqual([
      irrigationChunk.chunkId,
    ]);
    expect(reopened.getEmbeddingCoverage(profile.id)).toMatchObject({
      currentChunks: 1,
      missingChunks: 0,
      staleChunks: 1,
      totalChunks: 2,
    });
    expect(reopened.listChunksNeedingEmbedding(profile.id, 5).map((item) => item.chunkId)).toEqual([
      seedChunk.chunkId,
    ]);
    expect(reopened.deleteProfileVectors(profile.id)).toBe(2);
    expect(reopened.getEmbeddingRebuildState(profile.id).needsRebuild).toBe(true);
    reopened.close();
    await rm(root, { recursive: true });
  });

  it("retrieves full lexical evidence with complete anchors and source windows", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    await seedReadyDocument(database);
    const [evidence] = database.searchLexicalEvidence("cool dark seeds", 5);
    expect(evidence).toMatchObject({
      sourceChecksum: "a".repeat(64),
      sourceLocator: {
        end: {
          blockId: expect.any(String),
          blockOrdinal: expect.any(Number),
          endLine: expect.any(Number),
          sourceFragment: null,
          sourcePath: null,
          startLine: expect.any(Number),
        },
        start: {
          blockId: expect.any(String),
          blockOrdinal: expect.any(Number),
          endLine: expect.any(Number),
          sourceFragment: null,
          sourcePath: null,
          startLine: expect.any(Number),
        },
      },
      text: expect.stringContaining("Store dry seeds"),
      title: "Seed saving",
    });
    if (!evidence) throw new Error("Expected lexical evidence.");
    const window = database.getSourceBlockWindow(evidence.chunkId, 1, 1);
    expect(window.map((block) => block.ordinal)).toEqual(
      [...window.map((block) => block.ordinal)].sort((left, right) => left - right),
    );
    expect(window.some((block) => block.text.includes("Store dry seeds"))).toBe(true);
    database.close();
  });

  it("retrieves preceding chunk structure for grounded table interpretation", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const tableHeader = `Vegetable | Days to maturity | Cultivar | Planting date ${"table-header ".repeat(60).trim()}`;
    const interveningRows = `California planting schedule ${"middle-row ".repeat(70).trim()}`;
    const retrievedRow = `Blue Lake bush beans mature in 50 to 60 days. ${"target-detail ".repeat(20).trim()}`;
    await seedReadyDocument(database, {
      content: `# Planting chart\n\n${tableHeader}\n\n${interveningRows}\n\n${retrievedRow}`,
    });
    const [evidence] = database.searchLexicalEvidence("Blue Lake bush beans", 1);
    if (!evidence) throw new Error("Expected Blue Lake evidence.");

    expect(database.getPreviousChunkContext(evidence.chunkId)).toEqual({
      content: `Planting chart\n\n${tableHeader}\n\n${interveningRows}`,
      start: {
        blockId: expect.any(String),
        blockOrdinal: 0,
        endLine: 1,
        pageNumber: null,
        sourceFragment: null,
        sourcePath: null,
        startLine: 1,
      },
    });
    database.close();
  });

  it("persists chats, immutable citation snapshots, recovery, and thread ordering", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const { documentId } = await seedReadyDocument(database);
    const [evidence] = database.searchLexicalEvidence("cool dark seeds", 1);
    if (!evidence) throw new Error("Expected citation evidence.");

    const run = database.createChatRun({
      model: "test-generation",
      threadTitle: "Seed storage",
      userContent: "How should seeds be stored?",
    });
    database.updateChatRun(run.runId, { status: "retrieving" });
    const routingDiagnostics = {
      route: "model-answerability",
      version: 1,
    };
    database.setChatRoutingDiagnostics(run.runId, routingDiagnostics);
    database.updateChatRun(run.runId, { status: "generating" });
    database.appendAssistantContent(run.runId, "Store seeds ");
    database.appendAssistantContent(run.runId, "somewhere cool and dark.");
    const completed = database.completeChatRun(run.runId, {
      citations: [
        {
          chunkId: evidence.chunkId,
          documentId: evidence.documentId,
          evidenceId: "E1",
          headingPath: evidence.headingPath,
          id: "citation-1",
          retrievalComponentScores: [
            { component: "lexical", rank: 1, score: evidence.score },
          ],
          sourceLocator: evidence.sourceLocator,
          text: evidence.text,
          title: evidence.title,
        },
      ],
      status: "completed",
    });
    expect(completed).toMatchObject({
      citations: [{ evidenceId: "E1", text: evidence.text }],
      content: "Store seeds somewhere cool and dark.",
      routingDiagnostics,
      status: "completed",
    });

    const next = database.createChatRun({
      threadId: run.thread.id,
      userContent: "Anything else?",
    });
    expect(database.recoverInterruptedChatRuns()).toBe(1);
    expect(database.getChatThread(run.thread.id)?.messages).toHaveLength(4);
    expect(database.getChatThread(run.thread.id)?.messages[3]).toMatchObject({
      runId: next.runId,
      status: "interrupted",
    });
    expect(database.listChatThreads()[0]).toMatchObject({
      id: run.thread.id,
      messageCount: 4,
    });
    expect(database.getChatCitation("citation-1")).toMatchObject({
      sourceLocator: evidence.sourceLocator,
      text: evidence.text,
    });
    const changedDocument = await parseDocumentBytes(
      encoder.encode("# Seed saving\n\nThis source has changed."),
      "guide.md",
      "markdown",
    );
    database.completeDocument(
      documentId,
      changedDocument,
      chunkDocument(changedDocument),
      ingestionVersions.chunker,
    );
    expect(database.getChatCitation("citation-1")).toMatchObject({
      sourceLocator: evidence.sourceLocator,
      text: evidence.text,
    });
    expect(() => database.appendAssistantContent(run.runId, "late content")).toThrow(
      /not active/,
    );
    database.close();
  });

  it("persists answer provenance across restart and rejects malformed stored JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-provenance-"));
    const sourcePath = join(root, "state.sqlite");
    const provenance = { mode: "labeled-hybrid", version: 1 };
    const database = new KnosysDatabase(sourcePath, vectorExtensionPath);
    const run = database.createChatRun({ userContent: "Hybrid question" });
    const completed = database.completeChatRun(run.runId, {
      answerProvenance: provenance,
      content: "Hybrid answer",
    });
    expect(completed.answerProvenance).toEqual(provenance);
    database.close();

    const reopened = new KnosysDatabase(sourcePath, vectorExtensionPath);
    expect(reopened.getChatThread(run.thread.id)?.messages.at(-1)?.answerProvenance).toEqual(
      provenance,
    );
    reopened.close();

    const corrupt = new DatabaseSync(sourcePath);
    corrupt
      .prepare("UPDATE chat_messages SET answer_provenance_json = '[]' WHERE run_id = ?")
      .run(run.runId);
    corrupt.close();
    const malformed = new KnosysDatabase(sourcePath, vectorExtensionPath);
    expect(() => malformed.getChatThread(run.thread.id)).toThrow(/expected an object/);
    malformed.close();
    await rm(root, { recursive: true });
  });

  it("persists selected embedding and generation model identities", () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const profile = database.registerEmbeddingProfile(embeddingProfileInput);
    database.setSelectedEmbeddingProfile(profile.id);
    database.setSelectedGenerationModel({
      contextWindow: 16_384,
      digest: "sha256:" + "3".repeat(64),
      model: "test-generation",
      provider: "test",
      sizeBytes: 1_024,
    });
    expect(database.getSelectedModelSettings()).toMatchObject({
      embeddingProfileId: profile.id,
      generationModel: {
        contextWindow: 16_384,
        digest: "sha256:" + "3".repeat(64),
        model: "test-generation",
        provider: "test",
        sizeBytes: 1_024,
      },
      generationSelectionMode: "manual",
    });
    database.close();
  });

  it("deletes chat threads with cascading messages and citations", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-thread-delete-"));
    const sourcePath = join(root, "state.sqlite");
    const database = new KnosysDatabase(sourcePath, vectorExtensionPath);
    await seedReadyDocument(database);
    const [evidence] = database.searchLexicalEvidence("cool dark seeds", 1);
    if (!evidence) throw new Error("Expected citation evidence.");
    const run = database.createChatRun({ userContent: "How should seeds be stored?" });
    database.completeChatRun(run.runId, {
      citations: [
        {
          chunkId: evidence.chunkId,
          documentId: evidence.documentId,
          evidenceId: "E1",
          headingPath: evidence.headingPath,
          id: "citation-1",
          retrievalComponentScores: [
            { component: "lexical", rank: 1, score: evidence.score },
          ],
          sourceLocator: evidence.sourceLocator,
          text: evidence.text,
          title: evidence.title,
        },
      ],
      content: "Store seeds somewhere cool and dark.",
      status: "completed",
    });
    expect(database.deleteChatThread(run.thread.id)).toBe(true);
    expect(database.getChatThread(run.thread.id)).toBeNull();
    expect(database.deleteChatThread(run.thread.id)).toBe(false);
    database.close();

    const raw = new DatabaseSync(sourcePath);
    const countRows = (table: string): number =>
      Number(
        (raw.prepare(`SELECT count(*) AS count FROM ${table}`).get() as Record<
          string,
          unknown
        >).count,
      );
    expect(countRows("chat_threads")).toBe(0);
    expect(countRows("chat_messages")).toBe(0);
    expect(countRows("chat_citations")).toBe(0);
    raw.close();
    await rm(root, { recursive: true });
  });

  it("renames chat threads and rejects invalid titles", () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const run = database.createChatRun({ userContent: "Original question" });
    const renamed = database.renameChatThread(run.thread.id, "  Renamed thread  ");
    expect(renamed).toMatchObject({ id: run.thread.id, title: "Renamed thread" });
    expect(
      database.renameChatThread("4c25f126-56de-4c4f-8bd0-af6a71b7ce75", "Title"),
    ).toBeNull();
    expect(() => database.renameChatThread(run.thread.id, "   ")).toThrow(/title/i);
    expect(() => database.renameChatThread(run.thread.id, "x".repeat(513))).toThrow(/512/);
    database.close();
  });

  it("deletes documents with full cascades while preserving citation snapshots", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const { documentId } = await seedReadyDocument(database);
    const profile = database.registerEmbeddingProfile(embeddingProfileInput);
    const [work] = database.listChunksNeedingEmbedding(profile.id, 1);
    if (!work) throw new Error("Expected a chunk needing embedding.");
    expect(
      database.upsertChunkEmbeddings(profile.id, [
        { chunkId: work.chunkId, contentHash: work.contentHash, embedding: [1, 0, 0] },
      ]),
    ).toBe(1);
    const [evidence] = database.searchLexicalEvidence("cool dark seeds", 1);
    if (!evidence) throw new Error("Expected citation evidence.");
    const run = database.createChatRun({ userContent: "How should seeds be stored?" });
    database.completeChatRun(run.runId, {
      citations: [
        {
          chunkId: evidence.chunkId,
          documentId: evidence.documentId,
          evidenceId: "E1",
          headingPath: evidence.headingPath,
          id: "citation-1",
          retrievalComponentScores: [
            { component: "lexical", rank: 1, score: evidence.score },
          ],
          sourceLocator: evidence.sourceLocator,
          text: evidence.text,
          title: evidence.title,
        },
      ],
      content: "Store seeds somewhere cool and dark.",
      status: "completed",
    });

    const checksum = "a".repeat(64);
    expect(database.deleteDocument(documentId)).toEqual({
      deleted: true,
      managedRelativePath: `sources/${checksum.slice(0, 2)}/${checksum}.md`,
    });
    expect(database.getLibrarySnapshot().documents).toEqual([]);
    expect(database.getLibrarySnapshot().jobs[0]).toMatchObject({ documentId: null });
    expect(database.search("cool dark seeds")).toEqual([]);
    expect(database.getSourceBlockWindow(evidence.chunkId, 2, 2)).toEqual([]);
    expect(database.getChatCitation("citation-1")).toMatchObject({
      sourceLocator: evidence.sourceLocator,
      text: evidence.text,
    });
    expect(database.findDocumentByChecksum(checksum)).toBeNull();
    expect(database.deleteDocument(documentId)).toEqual({
      deleted: false,
      reason: "not-found",
    });

    await seedReadyDocument(database, {
      documentId: "5be0788d-6bfb-4f5f-9070-52b62db917b6",
      jobId: "0e1f0f0a-40e4-45b7-a56d-4a013a94914d",
    });
    expect(database.getLibrarySnapshot().documents).toHaveLength(1);
    expect(database.search("cool dark seeds")).toHaveLength(1);
    database.close();
  });

  it("refuses to delete documents with an active import job", () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const jobId = "e5c7a55a-6b39-4a56-8bbd-9c34e229c1b3";
    const documentId = "9e0e5eb4-15ac-45e5-a9a6-4881a25a54ca";
    database.createJob(jobId, "pending.md");
    database.createCanonicalDocument({
      checksum: "b".repeat(64),
      documentId,
      format: "markdown",
      jobId,
      managedRelativePath: `sources/bb/${"b".repeat(64)}.md`,
      mimeType: "text/markdown",
      originalName: "pending.md",
      originalPath: "/private/pending.md",
      sizeBytes: 64,
    });
    database.updateJob(jobId, "parsing", 0.5, { documentId });
    expect(database.deleteDocument(documentId)).toEqual({
      deleted: false,
      reason: "import-in-progress",
    });
    database.close();
  });

  it("creates, renames, lists, and validates chat folders", () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const first = database.createChatFolder("  Garden research  ");
    expect(first.name).toBe("Garden research");
    const second = database.createChatFolder("Recipes");
    expect(database.listChatFolders().map(({ id }) => id)).toEqual([first.id, second.id]);

    const renamed = database.renameChatFolder(first.id, "Garden notes");
    expect(renamed).toMatchObject({ id: first.id, name: "Garden notes" });
    expect(
      database.renameChatFolder("f3a85d54-24a3-4f3a-9e4a-a95c17b7f6dd", "Nope"),
    ).toBeNull();
    expect(() => database.createChatFolder("   ")).toThrow(/name/i);
    expect(() => database.createChatFolder("x".repeat(121))).toThrow(/120/);
    database.close();
  });

  it("moves threads between folders and reports missing targets", () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const folder = database.createChatFolder("Garden research");
    const run = database.createChatRun({ userContent: "How do pumpkins grow?" });
    expect(database.getChatThread(run.thread.id)?.folderId).toBeNull();

    const moved = database.setChatThreadFolder(run.thread.id, folder.id);
    if (!moved.moved) throw new Error("Expected the thread to move.");
    expect(moved.summary).toMatchObject({ folderId: folder.id, id: run.thread.id });
    expect(database.listChatThreadIdsInFolder(folder.id)).toEqual([run.thread.id]);

    const unfiled = database.setChatThreadFolder(run.thread.id, null);
    if (!unfiled.moved) throw new Error("Expected the thread to unfile.");
    expect(unfiled.summary.folderId).toBeNull();

    expect(
      database.setChatThreadFolder(run.thread.id, "f3a85d54-24a3-4f3a-9e4a-a95c17b7f6dd"),
    ).toEqual({ moved: false, reason: "folder-not-found" });
    expect(
      database.setChatThreadFolder("f3a85d54-24a3-4f3a-9e4a-a95c17b7f6dd", folder.id),
    ).toEqual({ moved: false, reason: "thread-not-found" });
    database.close();
  });

  it("deletes a folder and cascades its threads, messages, and citations", async () => {
    const root = await mkdtemp(join(tmpdir(), "knosys-storage-folder-delete-"));
    const sourcePath = join(root, "state.sqlite");
    const database = new KnosysDatabase(sourcePath, vectorExtensionPath);
    await seedReadyDocument(database);
    const [evidence] = database.searchLexicalEvidence("cool dark seeds", 1);
    if (!evidence) throw new Error("Expected citation evidence.");
    const folder = database.createChatFolder("Garden research");
    const inside = database.createChatRun({ userContent: "Inside the folder" });
    database.completeChatRun(inside.runId, {
      citations: [
        {
          chunkId: evidence.chunkId,
          documentId: evidence.documentId,
          evidenceId: "E1",
          headingPath: evidence.headingPath,
          id: "folder-citation-1",
          retrievalComponentScores: [
            { component: "lexical", rank: 1, score: evidence.score },
          ],
          sourceLocator: evidence.sourceLocator,
          text: evidence.text,
          title: evidence.title,
        },
      ],
      content: "Folder answer.",
      status: "completed",
    });
    database.setChatThreadFolder(inside.thread.id, folder.id);
    const outside = database.createChatRun({ userContent: "Outside the folder" });

    const result = database.deleteChatFolder(folder.id);
    expect(result).toEqual({ deleted: true, deletedThreadIds: [inside.thread.id] });
    expect(database.getChatThread(inside.thread.id)).toBeNull();
    expect(database.getChatThread(outside.thread.id)).not.toBeNull();
    expect(database.deleteChatFolder(folder.id)).toEqual({
      deleted: false,
      deletedThreadIds: [],
    });
    database.close();

    const raw = new DatabaseSync(sourcePath);
    const countRows = (table: string, threadId: string): number =>
      Number(
        (raw
          .prepare(
            table === "chat_citations"
              ? `SELECT count(*) AS count FROM chat_citations c
                 JOIN chat_messages m ON m.id = c.message_id WHERE m.thread_id = ?`
              : `SELECT count(*) AS count FROM ${table} WHERE thread_id = ?`,
          )
          .get(threadId) as Record<string, unknown>).count,
      );
    expect(countRows("chat_messages", inside.thread.id)).toBe(0);
    expect(countRows("chat_citations", inside.thread.id)).toBe(0);
    raw.close();
    await rm(root, { recursive: true });
  });

  it("skips vanished chunks in embedding batches but rejects hash drift", async () => {
    const database = new KnosysDatabase(":memory:", vectorExtensionPath);
    const { documentId } = await seedReadyDocument(database);
    const profile = database.registerEmbeddingProfile(embeddingProfileInput);
    const [work] = database.listChunksNeedingEmbedding(profile.id, 1);
    if (!work) throw new Error("Expected a chunk needing embedding.");
    expect(() =>
      database.upsertChunkEmbeddings(profile.id, [
        { chunkId: work.chunkId, contentHash: "f".repeat(64), embedding: [1, 0, 0] },
      ]),
    ).toThrow(/no longer has content hash/);
    expect(database.deleteDocument(documentId)).toMatchObject({ deleted: true });
    expect(
      database.upsertChunkEmbeddings(profile.id, [
        { chunkId: work.chunkId, contentHash: work.contentHash, embedding: [1, 0, 0] },
      ]),
    ).toBe(0);
    database.close();
  });
});
