import { describe, expect, it } from "vitest";

import {
  answerProvenanceSchema,
  appPreferencesSchema,
  answerProvenanceV1Schema,
  answerProvenanceV2Schema,
  answerProvenanceV3Schema,
  chatAcceptanceSchema,
  chatDeleteFolderResultSchema,
  chatDeleteThreadResultSchema,
  chatEventSchema,
  chatEventStreamSchema,
  chatFolderSchema,
  chatGetThreadResultSchema,
  chatMessageSchema,
  chatRenameThreadResultSchema,
  chatSendResultSchema,
  chatThreadSummarySchema,
  documentReviewSchema,
  engineEventEnvelopeSchema,
  engineRequestSchema,
  engineResponseSchema,
  engineResultSchema,
  generationStatusSchema,
  IPC_EVENT_CHANNEL,
  importProgressEventSchema,
  ipcErrorCodeSchema,
  ipcErrorSchema,
  ipcEventSchema,
  ipcRequestSchema,
  ipcResultSchema,
  KnosysApiError,
  libraryDeleteDocumentResultSchema,
  librarySnapshotSchema,
  modelPullEventSchema,
  modelsCancelPullResultSchema,
  modelsPullResultSchema,
  RECOMMENDED_MODELS,
  recommendedModelNameSchema,
  ragGetStatusResultSchema,
  sourceGetWindowResultSchema,
  systemStatusResponseSchema,
} from "../src/index.js";

const REQUEST_ID = "a9da48a8-7aca-4ef1-a7b8-2698b646a944";
const THREAD_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const USER_MESSAGE_ID = "33333333-3333-4333-8333-333333333333";
const ASSISTANT_MESSAGE_ID = "44444444-4444-4444-8444-444444444444";
const CITATION_ID = "55555555-5555-4555-8555-555555555555";
const CHUNK_ID = "66666666-6666-4666-8666-666666666666";
const DOCUMENT_ID = "77777777-7777-4777-8777-777777777777";
const START_BLOCK_ID = "88888888-8888-4888-8888-888888888888";
const END_BLOCK_ID = "99999999-9999-4999-8999-999999999999";
const PROFILE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const JOB_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECOND_CITATION_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const THIRD_CITATION_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const NOW = "2026-08-12T12:00:00.000Z";

const threadSummary = {
  createdAt: NOW,
  folderId: null,
  id: THREAD_ID,
  lastMessageAt: NOW,
  lastMessagePreview: "Store seeds in a cool, dry place.",
  memoryExcluded: false,
  messageCount: 2,
  title: "Seed storage",
  updatedAt: NOW,
};

const FOLDER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const folderSummary = {
  createdAt: NOW,
  id: FOLDER_ID,
  name: "Garden research",
  updatedAt: NOW,
};

const userMessage = {
  answerProvenance: null,
  citations: [],
  content: "How should seeds be stored?",
  createdAt: NOW,
  errorCode: null,
  errorMessage: null,
  id: USER_MESSAGE_ID,
  model: null,
  ordinal: 0,
  role: "user",
  routingDiagnostics: null,
  runId: null,
  status: "completed",
  threadId: THREAD_ID,
  updatedAt: NOW,
};

const sourceLocator = {
  chunkId: CHUNK_ID,
  documentId: DOCUMENT_ID,
  end: {
    blockId: END_BLOCK_ID,
    blockOrdinal: 3,
    endLine: 18,
    sourceFragment: "storage",
    sourcePath: "chapters/seeds.xhtml",
    startLine: 14,
  },
  start: {
    blockId: START_BLOCK_ID,
    blockOrdinal: 2,
    endLine: 13,
    sourceFragment: "storage",
    sourcePath: "chapters/seeds.xhtml",
    startLine: 10,
  },
};

const citation = {
  chunkId: CHUNK_ID,
  createdAt: NOW,
  documentId: DOCUMENT_ID,
  evidenceId: "E1",
  headingPath: ["Seed saving", "Storage"],
  id: CITATION_ID,
  messageId: ASSISTANT_MESSAGE_ID,
  ordinal: 0,
  retrievalComponentScores: [
    { component: "lexical", rank: 1, reciprocalRankScore: 0.016, score: 4.2 },
    { component: "vector", rank: 2, reciprocalRankScore: 0.015, score: 0.88 },
  ],
  sourceLocator,
  text: "Store dry seeds somewhere cool and dark.",
  title: "Seed saving",
};

const secondCitation = {
  ...citation,
  evidenceId: "E2",
  id: SECOND_CITATION_ID,
  ordinal: 1,
};

const pendingAssistantMessage = {
  answerProvenance: null,
  citations: [],
  content: "",
  createdAt: NOW,
  errorCode: null,
  errorMessage: null,
  id: ASSISTANT_MESSAGE_ID,
  model: "qwen3:8b",
  ordinal: 1,
  role: "assistant",
  routingDiagnostics: null,
  runId: RUN_ID,
  status: "pending",
  threadId: THREAD_ID,
  updatedAt: NOW,
};

const routingDiagnostics = {
  confidence: {
    calibrationId: "qwen3-embedding-0.6b-grounding-live-v1",
    fingerprint: "hybrid-answerability-v1:qwen3-embedding:0.6b",
    label: "uncertain",
    policyVersion: "hybrid-answerability-v1",
    reasons: ["wide-uncertain-band"],
    signals: {
      contextTruncated: false,
      lexicalResultCount: 1,
      queryTokenCoverage: 0.5,
      topCandidateInBothPools: true,
      topVectorMargin: 0.2,
      topVectorScore: 0.7,
      vectorResultCount: 5,
    },
    version: 1,
  },
  generationModel: { digest: "a".repeat(64), model: "qwen3:8b" },
  modelAssessment: { durationMs: 20, evidenceIds: ["E1"] },
  route: "model-answerability",
  version: 1,
} as const;

const completedAssistantMessage = {
  ...pendingAssistantMessage,
  citations: [citation],
  content: "Store seeds in a cool, dry place.",
  routingDiagnostics,
  status: "completed",
};

const answerProvenance = {
  classifications: [
    {
      classification: "supported",
      contradictingEvidenceIds: [],
      equivalentLibraryClaimIds: ["L1"],
      modelClaimId: "M1",
      supportingEvidenceIds: ["E1"],
    },
  ],
  finalSections: [
    {
      kind: "library",
      statements: [
        {
          contradictingEvidenceIds: [],
          sectionKind: "library",
          sourceClaimIds: ["L1", "M1"],
          statementId: "S1",
          supportingEvidenceIds: ["E1"],
          text: "Store seeds somewhere cool and dark.",
        },
      ],
      title: "From your library",
    },
  ],
  generationModel: { digest: "a".repeat(64), model: "qwen3:8b" },
  libraryClaims: [
    {
      evidenceIds: ["E1"],
      id: "L1",
      text: "Store seeds somewhere cool and dark.",
    },
  ],
  mode: "labeled-hybrid",
  modelClaims: [{ id: "M1", text: "Store seeds somewhere cool and dark." }],
  promptVersions: {
    closedBook: "closed-book-answer-v1",
    contextualization: null,
    groundedDerivation: "transparent-grounded-derivations-v1",
    reconciliation: "claim-reconciliation-v1",
    synthesis: "hybrid-synthesis-v1",
    verification: "hybrid-synthesis-verification-v1",
  },
  stages: {
    background: { fallbackReason: null, status: "completed" },
    library: { fallbackReason: null, status: "completed" },
    reconciliation: { fallbackReason: null, status: "completed" },
    synthesis: { fallbackReason: null, status: "completed" },
    verification: { fallbackReason: null, status: "completed" },
  },
  version: 1,
} as const;

const answerProvenanceV2 = {
  generationModel: { digest: "a".repeat(64), model: "qwen3:8b" },
  mode: "labeled-hybrid",
  promptVersions: {
    contextualization: null,
    evidenceAnswer: "evidence-answer-v1",
    groundedDerivation: "transparent-grounded-derivations-v2",
    modelDraft: "closed-book-answer-v1",
    verification: "evidence-answer-verification-v1",
  },
  stages: {
    generation: { fallbackReason: null, status: "completed" },
    library: { fallbackReason: null, status: "completed" },
    verification: { fallbackReason: null, status: "completed" },
  },
  statements: [
    {
      evidenceIds: ["E1", "E2"],
      kind: "library",
      statementId: "S1",
      text: "Store seeds somewhere cool and dark.",
    },
    {
      evidenceIds: [],
      kind: "model",
      statementId: "S2",
      text: "A sealed container may also help keep seeds dry.",
    },
  ],
  version: 2,
} as const;

const answerProvenanceV3 = {
  ...answerProvenanceV2,
  memory: {
    memories: [
      {
        content: "Topics: seed saving | Conclusions: dry seeds fully before storage.",
        id: "K1",
        threadDate: "2026-08-10",
        threadId: THREAD_ID,
        threadTitle: "Seed saving",
      },
    ],
    stage: { fallbackReason: null, status: "completed" },
  },
  statements: [
    { ...answerProvenanceV2.statements[0], memoryIds: [] },
    { ...answerProvenanceV2.statements[1], memoryIds: [] },
    {
      evidenceIds: [],
      kind: "memory",
      memoryIds: ["K1"],
      statementId: "S3",
      text: "You previously settled on drying seeds fully before storage.",
    },
  ],
  version: 3,
} as const;

const ragStatus = {
  embedding: {
    coverage: {
      currentChunks: 8,
      missingChunks: 1,
      ratio: 0.8,
      staleChunks: 1,
      totalChunks: 10,
    },
    latestJob: {
      completedAt: null,
      createdAt: NOW,
      embeddingProfileId: PROFILE_ID,
      errorCode: null,
      errorMessage: null,
      id: JOB_ID,
      processedChunks: 8,
      startedAt: NOW,
      status: "running",
      totalChunks: 10,
      updatedAt: NOW,
    },
    model: {
      capabilities: ["embedding"],
      capable: true,
      digest: "sha256:embedding",
      installed: true,
      model: "qwen3-embedding:0.6b",
      provider: "ollama",
    },
    profile: {
      createdAt: NOW,
      digest: "sha256:embedding",
      dimensions: 1024,
      id: PROFILE_ID,
      inputVersion: "chunk-content-v1",
      model: "qwen3-embedding:0.6b",
      provider: "ollama",
      updatedAt: NOW,
    },
  },
  generation: {
    options: [
      {
        capabilities: ["completion", "thinking", "tools"],
        capable: true,
        digest: "sha256:qwen",
        installed: true,
        incompatibilityReason: null,
        model: "qwen3:8b",
        nativeContextWindow: 32768,
        provider: "ollama",
        sizeBytes: 5_000_000_000,
      },
      {
        capabilities: ["completion", "vision"],
        capable: false,
        digest: null,
        installed: false,
        incompatibilityReason: "missing-completion",
        model: "gemma4:26b",
        nativeContextWindow: null,
        provider: "ollama",
        sizeBytes: 0,
      },
    ],
    selectionMode: "manual",
    selected: {
      contextWindow: 32768,
      digest: "sha256:qwen",
      model: "qwen3:8b",
      provider: "ollama",
      sizeBytes: 5_000_000_000,
    },
  },
  runtime: {
    installDetected: true,
    provider: "ollama",
    state: "available",
  },
};

describe("IPC contracts", () => {
  it("accepts a valid system status request", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "system.getStatus",
        params: {},
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown method", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "filesystem.readAnything",
        params: { path: "/" },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed success payloads", () => {
    expect(
      systemStatusResponseSchema.safeParse({
        id: REQUEST_ID,
        ok: true,
        result: { platform: "darwin" },
      }).success,
    ).toBe(false);
  });

  it("rejects renderer supplied import paths", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "library.importFiles",
        params: { paths: ["/private/secret.txt"] },
      }).success,
    ).toBe(false);
  });

  it("allows paths only on the internal engine boundary", () => {
    expect(
      engineRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "engine.importPaths",
        params: { paths: ["/private/selected-by-native-dialog.txt"] },
      }).success,
    ).toBe(true);
  });

  it("validates bounded library snapshots", () => {
    expect(librarySnapshotSchema.safeParse({ documents: [], jobs: [] }).success).toBe(true);
  });

  it.each([
    ["rag.getStatus", {}],
    ["rag.setGenerationModel", { mode: "manual", model: "qwen3:8b" }],
    ["chat.listThreads", {}],
    ["chat.getThread", { threadId: THREAD_ID }],
    ["chat.send", { question: "How should seeds be stored?", threadId: null }],
    ["chat.cancel", { runId: RUN_ID }],
    ["evidence.get", { citationId: CITATION_ID }],
    ["source.getWindow", { after: 2, before: 2, chunkId: CHUNK_ID }],
  ])("accepts the public %s request", (method, params) => {
    expect(ipcRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it("defaults answer mode to labeled hybrid and propagates explicit strict mode", () => {
    expect(
      ipcRequestSchema.parse({
        id: REQUEST_ID,
        method: "chat.send",
        params: { question: "How should seeds be stored?", threadId: null },
      }),
    ).toMatchObject({ params: { mode: "labeled-hybrid" } });
    expect(
      engineRequestSchema.parse({
        id: REQUEST_ID,
        method: "engine.chat.send",
        params: {
          mode: "strict-grounded",
          question: "How should seeds be stored?",
          threadId: THREAD_ID,
        },
      }),
    ).toMatchObject({ params: { mode: "strict-grounded" } });
  });

  it.each([
    ["engine.rag.getStatus", {}],
    ["engine.rag.setGenerationModel", { mode: "manual", model: "gemma4:26b" }],
    ["engine.chat.listThreads", {}],
    ["engine.chat.getThread", { threadId: THREAD_ID }],
    ["engine.chat.send", { question: "How should seeds be stored?", threadId: THREAD_ID }],
    ["engine.chat.cancel", { runId: RUN_ID }],
    ["engine.evidence.get", { citationId: CITATION_ID }],
    ["engine.source.getWindow", { after: 1, before: 3, chunkId: CHUNK_ID }],
  ])("accepts the internal %s request", (method, params) => {
    expect(engineRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it("accepts a complete RAG status and both runtime states", () => {
    expect(ragGetStatusResultSchema.safeParse(ragStatus).success).toBe(true);
    expect(
      ragGetStatusResultSchema.safeParse({
        ...ragStatus,
        runtime: {
          installDetected: true,
          provider: "ollama",
          reason: "not-running",
          state: "unavailable",
        },
      }).success,
    ).toBe(true);
  });

  it("accepts bounded dynamic models and rejects duplicate or malformed options", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "rag.setGenerationModel",
        params: { mode: "manual", model: "llama3:latest" },
      }).success,
    ).toBe(true);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "rag.setGenerationModel",
        params: { mode: "auto" },
      }).success,
    ).toBe(true);
    expect(
      generationStatusSchema.safeParse({
        ...ragStatus.generation,
        options: [ragStatus.generation.options[0], ragStatus.generation.options[0]],
      }).success,
    ).toBe(false);
    expect(
      ragGetStatusResultSchema.safeParse({
        ...ragStatus,
        generation: { ...ragStatus.generation, unexpected: true },
      }).success,
    ).toBe(false);
  });

  it("accepts full thread, chat acceptance, and source window results", () => {
    expect(
      chatGetThreadResultSchema.safeParse({
        ...threadSummary,
        messages: [userMessage, completedAssistantMessage],
      }).success,
    ).toBe(true);
    expect(
      chatSendResultSchema.safeParse({
        accepted: true,
        assistantMessage: pendingAssistantMessage,
        runId: RUN_ID,
        thread: threadSummary,
        userMessage,
      }).success,
    ).toBe(true);
    expect(
      sourceGetWindowResultSchema.safeParse([
        {
          attributes: { depth: 1, ordered: false, rows: [["seed", "temperature"]] },
          endLine: 13,
          pageNumber: null,
          headingPath: ["Seed saving", "Storage"],
          id: START_BLOCK_ID,
          ordinal: 2,
          sourceFragment: "storage",
          sourcePath: "chapters/seeds.xhtml",
          startLine: 10,
          text: "Store seeds in a cool, dry place.",
          type: "paragraph",
        },
      ]).success,
    ).toBe(true);
  });

  it("validates bounded hybrid provenance and exact final citation relationships", () => {
    expect(answerProvenanceV1Schema.safeParse(answerProvenance).success).toBe(true);
    expect(
      chatGetThreadResultSchema.safeParse({
        ...threadSummary,
        messages: [
          userMessage,
          {
            ...completedAssistantMessage,
            answerProvenance,
            content: "## From your library\n\nStore seeds somewhere cool and dark. [E1]",
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      chatGetThreadResultSchema.safeParse({
        ...threadSummary,
        messages: [
          userMessage,
          {
            ...completedAssistantMessage,
            answerProvenance: {
              ...answerProvenance,
              finalSections: [
                {
                  ...answerProvenance.finalSections[0],
                  statements: [
                    {
                      ...answerProvenance.finalSections[0].statements[0],
                      supportingEvidenceIds: [],
                    },
                  ],
                },
              ],
            },
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV1Schema.safeParse({
        ...answerProvenance,
        modelClaims: Array.from({ length: 17 }, (_unused, index) => ({
          id: `M${index + 1}`,
          text: "bounded claim",
        })),
      }).success,
    ).toBe(false);
  });

  it("accepts evidence-first V2 provenance and preserves V1 in the union", () => {
    expect(answerProvenanceV2Schema.safeParse(answerProvenanceV2).success).toBe(true);
    expect(answerProvenanceSchema.safeParse(answerProvenance).success).toBe(true);
    expect(answerProvenanceSchema.safeParse(answerProvenanceV2).success).toBe(true);
    expect(
      chatMessageSchema.safeParse({
        ...completedAssistantMessage,
        answerProvenance: answerProvenanceV2,
        citations: [citation, secondCitation],
      }).success,
    ).toBe(true);
  });

  it("accepts V3 provenance with memory statements resolved from the memory block", () => {
    expect(answerProvenanceV3Schema.safeParse(answerProvenanceV3).success).toBe(true);
    expect(answerProvenanceSchema.safeParse(answerProvenanceV3).success).toBe(true);
    // V2 still parses through the union so stored history keeps loading.
    expect(answerProvenanceSchema.safeParse(answerProvenanceV2).success).toBe(true);
    expect(
      chatMessageSchema.safeParse({
        ...completedAssistantMessage,
        answerProvenance: answerProvenanceV3,
        citations: [citation, secondCitation],
      }).success,
    ).toBe(true);
  });

  it("rejects V3 memory statements whose memories are missing or malformed", () => {
    // A memoryId with no matching entry in memory.memories.
    expect(
      answerProvenanceV3Schema.safeParse({
        ...answerProvenanceV3,
        memory: { ...answerProvenanceV3.memory, memories: [] },
      }).success,
    ).toBe(false);
    // A memory statement citing evidence.
    expect(
      answerProvenanceV3Schema.safeParse({
        ...answerProvenanceV3,
        statements: [
          answerProvenanceV3.statements[0],
          answerProvenanceV3.statements[1],
          { ...answerProvenanceV3.statements[2], evidenceIds: ["E1"] },
        ],
      }).success,
    ).toBe(false);
    // A library statement citing a memory.
    expect(
      answerProvenanceV3Schema.safeParse({
        ...answerProvenanceV3,
        statements: [
          { ...answerProvenanceV3.statements[0], memoryIds: ["K1"] },
          answerProvenanceV3.statements[1],
          answerProvenanceV3.statements[2],
        ],
      }).success,
    ).toBe(false);
    // A memory statement without memory IDs.
    expect(
      answerProvenanceV3Schema.safeParse({
        ...answerProvenanceV3,
        statements: [
          answerProvenanceV3.statements[0],
          answerProvenanceV3.statements[1],
          { ...answerProvenanceV3.statements[2], memoryIds: [] },
        ],
      }).success,
    ).toBe(false);
  });

  it("parses V2 provenance stored before modelDraft existed and defaults it to null", () => {
    const legacy = answerProvenanceV2Schema.safeParse({
      ...answerProvenanceV2,
      promptVersions: {
        contextualization: answerProvenanceV2.promptVersions.contextualization,
        evidenceAnswer: answerProvenanceV2.promptVersions.evidenceAnswer,
        groundedDerivation: answerProvenanceV2.promptVersions.groundedDerivation,
        verification: answerProvenanceV2.promptVersions.verification,
      },
    });
    expect(legacy.success).toBe(true);
    if (legacy.success) expect(legacy.data.promptVersions.modelDraft).toBeNull();
  });

  it("enforces V2 evidence ownership and bounded marker-free statement text", () => {
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          answerProvenanceV2.statements[0],
          { ...answerProvenanceV2.statements[1], evidenceIds: ["E1"] },
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          { ...answerProvenanceV2.statements[0], evidenceIds: [] },
          answerProvenanceV2.statements[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          { ...answerProvenanceV2.statements[0], evidenceIds: ["E1", "E1"] },
          answerProvenanceV2.statements[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          { ...answerProvenanceV2.statements[0], text: "Store seeds near [E1]." },
          answerProvenanceV2.statements[1],
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          { ...answerProvenanceV2.statements[0], text: "x".repeat(8_001) },
          answerProvenanceV2.statements[1],
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects non-consecutive, duplicate, or out-of-order V2 statement IDs", () => {
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          answerProvenanceV2.statements[1],
          answerProvenanceV2.statements[0],
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          answerProvenanceV2.statements[0],
          { ...answerProvenanceV2.statements[1], statementId: "S3" },
        ],
      }).success,
    ).toBe(false);
    expect(
      answerProvenanceV2Schema.safeParse({
        ...answerProvenanceV2,
        statements: [
          answerProvenanceV2.statements[0],
          { ...answerProvenanceV2.statements[1], statementId: "S1" },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires citations to exactly match V1 and V2 referenced evidence IDs", () => {
    const cases = [
      { citations: [citation], provenance: answerProvenance },
      { citations: [citation, secondCitation], provenance: answerProvenanceV2 },
    ];
    for (const { citations, provenance } of cases) {
      expect(
        chatMessageSchema.safeParse({
          ...completedAssistantMessage,
          answerProvenance: provenance,
          citations,
        }).success,
      ).toBe(true);
      expect(
        chatMessageSchema.safeParse({
          ...completedAssistantMessage,
          answerProvenance: provenance,
          citations: citations.slice(0, -1),
        }).success,
      ).toBe(false);
      expect(
        chatMessageSchema.safeParse({
          ...completedAssistantMessage,
          answerProvenance: provenance,
          citations: [
            ...citations,
            { ...citation, evidenceId: "E3", id: THIRD_CITATION_ID },
          ],
        }).success,
      ).toBe(false);
      expect(
        chatMessageSchema.safeParse({
          ...completedAssistantMessage,
          answerProvenance: provenance,
          citations: [...citations, { ...citation, id: THIRD_CITATION_ID }],
        }).success,
      ).toBe(false);
    }
    expect(
      chatMessageSchema.safeParse({
        ...completedAssistantMessage,
        answerProvenance: answerProvenanceV2,
        citations: [secondCitation, citation],
      }).success,
    ).toBe(true);
  });

  it("rejects malformed relationship IDs and unbounded result fields", () => {
    expect(
      chatAcceptanceSchema.safeParse({
        accepted: true,
        assistantMessage: { ...pendingAssistantMessage, runId: REQUEST_ID },
        runId: RUN_ID,
        thread: threadSummary,
        userMessage,
      }).success,
    ).toBe(false);
    expect(
      chatGetThreadResultSchema.safeParse({
        ...threadSummary,
        messages: [{ ...userMessage, content: "x".repeat(100_001) }],
      }).success,
    ).toBe(false);
    expect(
      sourceGetWindowResultSchema.safeParse([
        {
          attributes: { value: undefined },
          endLine: null,
          pageNumber: null,
          headingPath: [],
          id: START_BLOCK_ID,
          ordinal: 0,
          sourceFragment: null,
          sourcePath: null,
          startLine: null,
          text: "source",
          type: "paragraph",
        },
      ]).success,
    ).toBe(false);
  });

  it("accepts valid progress, delta, and authoritative terminal chat events", () => {
    expect(IPC_EVENT_CHANNEL).toBe("knosys-rag:event");
    expect(
      chatEventSchema.safeParse({
        kind: "status",
        runId: RUN_ID,
        sequence: 0,
        status: "retrieving",
      }).success,
    ).toBe(true);
    expect(
      chatEventSchema.safeParse({
        kind: "delta",
        runId: RUN_ID,
        sequence: 1,
        text: "Store seeds",
      }).success,
    ).toBe(true);
    expect(
      chatEventSchema.safeParse({
        diagnostics: routingDiagnostics,
        kind: "routing",
        runId: RUN_ID,
        sequence: 2,
      }).success,
    ).toBe(true);
    expect(
      chatEventSchema.safeParse({
        fallback: false,
        insufficient: false,
        kind: "completed",
        message: completedAssistantMessage,
        runId: RUN_ID,
        sequence: 3,
      }).success,
    ).toBe(true);
  });

  it.each(["background", "reconciling", "synthesizing", "verifying"])(
    "accepts the hybrid %s progress stage on the engine contract",
    (status) => {
      expect(
        chatEventSchema.safeParse({
          kind: "status",
          runId: RUN_ID,
          sequence: 0,
          status,
        }).success,
      ).toBe(true);
    },
  );

  it("accepts bounded import progress across engine and renderer event contracts", () => {
    const progress = {
      completed: 3,
      currentName: "garden.pdf",
      kind: "import-progress",
      operationId: REQUEST_ID,
      stage: "parsing",
      total: 10,
    };
    expect(importProgressEventSchema.safeParse(progress).success).toBe(true);
    expect(ipcEventSchema.safeParse(progress).success).toBe(true);
    expect(
      engineEventEnvelopeSchema.safeParse({ event: progress, type: "import.progress" }).success,
    ).toBe(true);
    expect(
      importProgressEventSchema.safeParse({ ...progress, completed: 11 }).success,
    ).toBe(false);
  });

  it("rejects malformed event IDs, bounds, terminal messages, and extra fields", () => {
    expect(
      chatEventSchema.safeParse({
        kind: "status",
        runId: "not-a-uuid",
        sequence: -1,
        status: "streaming",
      }).success,
    ).toBe(false);
    expect(
      chatEventSchema.safeParse({
        kind: "delta",
        runId: RUN_ID,
        sequence: 1.5,
        text: "",
      }).success,
    ).toBe(false);
    expect(
      chatEventSchema.safeParse({
        fallback: false,
        insufficient: true,
        kind: "completed",
        message: completedAssistantMessage,
        runId: RUN_ID,
        sequence: 2,
      }).success,
    ).toBe(false);
    expect(
      chatEventSchema.safeParse({
        kind: "failed",
        message: { ...completedAssistantMessage, status: "failed" },
        path: "/private/source.txt",
        runId: RUN_ID,
        sequence: 2,
      }).success,
    ).toBe(false);
  });

  it("enforces monotonically increasing sequences for each run", () => {
    const first = { kind: "status", runId: RUN_ID, sequence: 0, status: "retrieving" };
    const second = { kind: "delta", runId: RUN_ID, sequence: 1, text: "answer" };
    expect(chatEventStreamSchema.safeParse([first, second]).success).toBe(true);
    expect(chatEventStreamSchema.safeParse([second, second]).success).toBe(false);
  });

  it("requires UUIDs and enforces question and source-window bounds", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.send",
        params: { question: "x".repeat(4001), threadId: null },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.cancel",
        params: { runId: "run-1" },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "source.getWindow",
        params: { after: 51, before: -1, chunkId: CHUNK_ID },
      }).success,
    ).toBe(false);
  });

  it("keeps filesystem paths isolated to existing privileged engine methods", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.send",
        params: { path: "/private/source.txt", question: "Read this", threadId: null },
      }).success,
    ).toBe(false);
    expect(
      engineRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "engine.chat.send",
        params: { path: "/private/source.txt", question: "Read this", threadId: null },
      }).success,
    ).toBe(false);
    expect(
      engineRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "engine.initialize",
        params: {
          rootPath: "/private/app-data",
          vectorExtensionPath: "/private/sqlite-vec.dylib",
        },
      }).success,
    ).toBe(true);
  });

  it("provides bounded typed errors with retryability on both boundaries", () => {
    expect(
      ipcErrorSchema.parse({ code: "RETRIEVAL_UNAVAILABLE", message: "Try again." }),
    ).toEqual({ code: "RETRIEVAL_UNAVAILABLE", message: "Try again.", retryable: false });
    expect(
      engineResponseSchema.safeParse({
        error: { code: "MODEL_UNAVAILABLE", message: "Ollama stopped.", retryable: true },
        id: REQUEST_ID,
        ok: false,
      }).success,
    ).toBe(true);
  });
});

describe("thread and document management contracts", () => {
  it.each([
    ["chat.deleteThread", { threadId: THREAD_ID }],
    ["chat.renameThread", { threadId: THREAD_ID, title: "Seed storage tips" }],
    ["library.deleteDocument", { documentId: DOCUMENT_ID }],
    ["library.getDocumentReview", { documentId: DOCUMENT_ID }],
    ["library.acknowledgeReview", { documentId: DOCUMENT_ID }],
    ["library.replaceDocument", { documentId: DOCUMENT_ID }],
    ["library.reprocessDocument", { documentId: DOCUMENT_ID }],
  ])("accepts the public %s request", (method, params) => {
    expect(ipcRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it.each([
    ["engine.chat.deleteThread", { threadId: THREAD_ID }],
    ["engine.chat.renameThread", { threadId: THREAD_ID, title: "Seed storage tips" }],
    ["engine.library.deleteDocument", { documentId: DOCUMENT_ID }],
    ["engine.library.getDocumentReview", { documentId: DOCUMENT_ID }],
    ["engine.library.acknowledgeReview", { documentId: DOCUMENT_ID }],
    [
      "engine.library.replaceDocument",
      { documentId: DOCUMENT_ID, path: "/tmp/replacement.pdf" },
    ],
    ["engine.library.reprocessDocument", { documentId: DOCUMENT_ID }],
  ])("accepts the internal %s request", (method, params) => {
    expect(engineRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it("round-trips a document review payload with diagnostics", () => {
    const review = {
      diagnostics: [
        {
          code: "PDF_PAGES_REQUIRE_OCR",
          location: { pageNumber: 3 },
          message: "3 of 40 pages contain no selectable text and were not indexed.",
          severity: "warning" as const,
        },
      ],
      document: {
        createdAt: "2026-08-21T00:00:00.000Z",
        diagnosticCount: 1,
        errorCode: null,
        errorMessage: null,
        format: "pdf" as const,
        id: DOCUMENT_ID,
        originalName: "guide.pdf",
        reviewedAt: null,
        sizeBytes: 4096,
        status: "ready-with-warnings" as const,
        title: "Guide",
        updatedAt: "2026-08-21T00:00:00.000Z",
      },
    };
    const parsed = documentReviewSchema.safeParse(review);
    expect(parsed.success).toBe(true);
    // A required field on the summary is still enforced.
    expect(
      documentReviewSchema.safeParse({
        ...review,
        document: { ...review.document, reviewedAt: undefined },
      }).success,
    ).toBe(false);
  });

  it("rejects malformed thread and document management params", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.deleteThread",
        params: { threadId: "not-a-uuid" },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.deleteThread",
        params: { cascade: true, threadId: THREAD_ID },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.renameThread",
        params: { threadId: THREAD_ID, title: "   " },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.renameThread",
        params: { threadId: THREAD_ID, title: "x".repeat(513) },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "library.deleteDocument",
        params: { documentId: DOCUMENT_ID, path: "/private/anything" },
      }).success,
    ).toBe(false);
  });

  it("accepts the new results on both result unions", () => {
    const deleteThreadResult = { deletedThreadId: THREAD_ID };
    const deleteDocumentResult = {
      deletedDocumentId: DOCUMENT_ID,
      snapshot: { documents: [], jobs: [] },
    };
    expect(chatDeleteThreadResultSchema.safeParse(deleteThreadResult).success).toBe(true);
    expect(chatRenameThreadResultSchema.safeParse(threadSummary).success).toBe(true);
    expect(
      libraryDeleteDocumentResultSchema.safeParse(deleteDocumentResult).success,
    ).toBe(true);
    for (const schema of [ipcResultSchema, engineResultSchema]) {
      expect(schema.safeParse(deleteThreadResult).success).toBe(true);
      expect(schema.safeParse(threadSummary).success).toBe(true);
      expect(schema.safeParse(deleteDocumentResult).success).toBe(true);
    }
    expect(
      chatDeleteThreadResultSchema.safeParse({
        deletedThreadId: THREAD_ID,
        extra: true,
      }).success,
    ).toBe(false);
  });

  it("recognizes the new document error codes and rejects unknown codes", () => {
    expect(ipcErrorCodeSchema.safeParse("DOCUMENT_NOT_FOUND").success).toBe(true);
    expect(ipcErrorCodeSchema.safeParse("DOCUMENT_IMPORT_IN_PROGRESS").success).toBe(true);
    expect(ipcErrorCodeSchema.safeParse("DOCUMENT_EXPLODED").success).toBe(false);
  });
});

describe("preferences contracts", () => {
  it("accepts get and patch requests and rejects unknown keys", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "preferences.get",
        params: {},
      }).success,
    ).toBe(true);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "preferences.set",
        params: { accent: "coral", theme: "dark" },
      }).success,
    ).toBe(true);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "preferences.set",
        params: { collapsedFolders: [FOLDER_ID] },
      }).success,
    ).toBe(true);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "preferences.set",
        params: { accent: "neon" },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "preferences.set",
        params: { telemetry: true },
      }).success,
    ).toBe(false);
  });

  it("accepts nullable preference results on the result union", () => {
    const empty = { accent: null, collapsedFolders: null, theme: null };
    const populated = {
      accent: "blue",
      collapsedFolders: [FOLDER_ID],
      theme: "system",
    };
    expect(appPreferencesSchema.safeParse(empty).success).toBe(true);
    expect(appPreferencesSchema.safeParse(populated).success).toBe(true);
    expect(ipcResultSchema.safeParse(empty).success).toBe(true);
    expect(ipcResultSchema.safeParse(populated).success).toBe(true);
    expect(
      appPreferencesSchema.safeParse({ ...populated, accent: "neon" }).success,
    ).toBe(false);
  });
});

describe("chat folder contracts", () => {
  it.each([
    ["chat.listFolders", {}],
    ["chat.createFolder", { name: "Garden research" }],
    ["chat.renameFolder", { folderId: FOLDER_ID, name: "Garden notes" }],
    ["chat.deleteFolder", { folderId: FOLDER_ID }],
    ["chat.moveThread", { folderId: FOLDER_ID, threadId: THREAD_ID }],
    ["chat.moveThread", { folderId: null, threadId: THREAD_ID }],
  ])("accepts the public %s request", (method, params) => {
    expect(ipcRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it.each([
    ["engine.chat.listFolders", {}],
    ["engine.chat.createFolder", { name: "Garden research" }],
    ["engine.chat.renameFolder", { folderId: FOLDER_ID, name: "Garden notes" }],
    ["engine.chat.deleteFolder", { folderId: FOLDER_ID }],
    ["engine.chat.moveThread", { folderId: null, threadId: THREAD_ID }],
  ])("accepts the internal %s request", (method, params) => {
    expect(engineRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it("rejects malformed folder params", () => {
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.createFolder",
        params: { name: "   " },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.createFolder",
        params: { name: "x".repeat(121) },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.deleteFolder",
        params: { folderId: "not-a-uuid" },
      }).success,
    ).toBe(false);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method: "chat.moveThread",
        params: { threadId: THREAD_ID },
      }).success,
    ).toBe(false);
  });

  it("accepts folder results on both result unions and carries folderId on summaries", () => {
    const deleteResult = {
      deletedFolderId: FOLDER_ID,
      deletedThreadIds: [THREAD_ID],
    };
    expect(chatFolderSchema.safeParse(folderSummary).success).toBe(true);
    expect(chatDeleteFolderResultSchema.safeParse(deleteResult).success).toBe(true);
    for (const schema of [ipcResultSchema, engineResultSchema]) {
      expect(schema.safeParse([folderSummary]).success).toBe(true);
      expect(schema.safeParse(folderSummary).success).toBe(true);
      expect(schema.safeParse(deleteResult).success).toBe(true);
    }
    expect(
      chatThreadSummarySchema.safeParse({ ...threadSummary, folderId: FOLDER_ID }).success,
    ).toBe(true);
    expect(
      chatThreadSummarySchema.safeParse({ ...threadSummary, folderId: "nope" }).success,
    ).toBe(false);
    const { folderId: _unused, ...withoutFolder } = threadSummary;
    expect(chatThreadSummarySchema.safeParse(withoutFolder).success).toBe(false);
    expect(ipcErrorCodeSchema.safeParse("CHAT_FOLDER_NOT_FOUND").success).toBe(true);
  });
});

describe("model pull contracts", () => {
  it("keeps the recommended catalog aligned with the pull allowlist", () => {
    expect(RECOMMENDED_MODELS.map(({ model }) => model)).toEqual(
      recommendedModelNameSchema.options,
    );
    expect(RECOMMENDED_MODELS.map(({ role }) => role)).toEqual([
      "generation-baseline",
      "generation-quality",
      "embedding-required",
    ]);
    for (const entry of RECOMMENDED_MODELS) {
      expect(entry.approxSizeBytes).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
    }
  });

  it.each([
    ["models.pull", { model: "qwen3:8b" }],
    ["models.cancelPull", { model: "qwen3-embedding:0.6b" }],
  ])("accepts the public %s request for catalog models only", (method, params) => {
    expect(ipcRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
    expect(
      ipcRequestSchema.safeParse({
        id: REQUEST_ID,
        method,
        params: { model: "malicious/arbitrary:latest" },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["engine.models.pull", { model: "gemma4:26b" }],
    ["engine.models.cancelPull", { model: "gemma4:26b" }],
  ])("accepts the internal %s request", (method, params) => {
    expect(engineRequestSchema.safeParse({ id: REQUEST_ID, method, params }).success).toBe(true);
  });

  it("accepts pull results on both result unions", () => {
    const pullResult = { accepted: true, model: "qwen3:8b" };
    const cancelResult = { cancelled: true, model: "qwen3:8b" };
    expect(modelsPullResultSchema.safeParse(pullResult).success).toBe(true);
    expect(modelsCancelPullResultSchema.safeParse(cancelResult).success).toBe(true);
    for (const schema of [ipcResultSchema, engineResultSchema]) {
      expect(schema.safeParse(pullResult).success).toBe(true);
      expect(schema.safeParse(cancelResult).success).toBe(true);
    }
    expect(ipcErrorCodeSchema.safeParse("MODEL_PULL_FAILED").success).toBe(true);
  });

  it("validates pull progress events across event contracts", () => {
    const progress = {
      completedBytes: 1_000,
      error: null,
      kind: "model-pull",
      model: "qwen3:8b",
      status: "downloading",
      totalBytes: 5_200_000_000,
    };
    expect(modelPullEventSchema.safeParse(progress).success).toBe(true);
    expect(ipcEventSchema.safeParse(progress).success).toBe(true);
    expect(
      engineEventEnvelopeSchema.safeParse({ event: progress, type: "model.pull" }).success,
    ).toBe(true);
    expect(
      modelPullEventSchema.safeParse({
        ...progress,
        error: "not allowed on non-failed",
      }).success,
    ).toBe(false);
    expect(
      modelPullEventSchema.safeParse({
        ...progress,
        completedBytes: 6_000_000_000,
      }).success,
    ).toBe(false);
    expect(
      modelPullEventSchema.safeParse({
        completedBytes: null,
        error: "Ollama stopped mid-download.",
        kind: "model-pull",
        model: "qwen3:8b",
        status: "failed",
        totalBytes: null,
      }).success,
    ).toBe(true);
    expect(
      modelPullEventSchema.safeParse({ ...progress, model: "arbitrary:latest" }).success,
    ).toBe(false);
  });
});

describe("KnosysApiError", () => {
  it("round-trips a structured error through an opaque Error message", () => {
    const encoded = KnosysApiError.encodeMessage({
      code: "CHAT_THREAD_NOT_FOUND",
      message: "No chat thread matches the requested id.",
      retryable: false,
    });
    const recovered = KnosysApiError.fromThrown(new Error(encoded));
    expect(recovered.code).toBe("CHAT_THREAD_NOT_FOUND");
    expect(recovered.message).toBe("No chat thread matches the requested id.");
    expect(recovered.retryable).toBe(false);
    expect(recovered.name).toBe("KnosysApiError");
  });

  it("preserves retryability through the round trip", () => {
    const recovered = KnosysApiError.fromThrown(
      new Error(
        KnosysApiError.encodeMessage({
          code: "RAG_GENERATION_UNAVAILABLE",
          message: "Ollama is not running.",
          retryable: true,
        }),
      ),
    );
    expect(recovered.code).toBe("RAG_GENERATION_UNAVAILABLE");
    expect(recovered.retryable).toBe(true);
  });

  it("normalizes plain, garbage, and non-error inputs to INTERNAL_ERROR", () => {
    const plain = KnosysApiError.fromThrown(new Error("Something broke."));
    expect(plain.code).toBe("INTERNAL_ERROR");
    expect(plain.message).toBe("Something broke.");
    const garbageJson = KnosysApiError.fromThrown(new Error("{\"code\":\"NOT_REAL\"}"));
    expect(garbageJson.code).toBe("INTERNAL_ERROR");
    const invalidJson = KnosysApiError.fromThrown(new Error("{not json"));
    expect(invalidJson.code).toBe("INTERNAL_ERROR");
    const nonError = KnosysApiError.fromThrown(undefined);
    expect(nonError.code).toBe("INTERNAL_ERROR");
    expect(nonError.message).toBe("An unexpected error occurred.");
    const passthrough = KnosysApiError.fromThrown(
      new KnosysApiError({ code: "EVIDENCE_NOT_FOUND", message: "Gone.", retryable: false }),
    );
    expect(passthrough.code).toBe("EVIDENCE_NOT_FOUND");
  });
});
