import type {
  ChatEvent,
  ChatMessage,
  ImportProgressEvent,
  LibrarySnapshot,
  ModelPullEvent,
} from "@knosys-rag/contracts";
import { act } from "@testing-library/react";
import { vi } from "vitest";

export const THREAD_ID = "e41b09c7-91d7-41c8-8242-c0e373bd58b4";
export const USER_MESSAGE_ID = "1d4bb3db-5ca4-40f1-a71f-a3176e8e9a53";
export const ASSISTANT_MESSAGE_ID = "7c8105ba-9017-4019-b0b4-aa01dbf8c322";
export const RUN_ID = "5b7bb9fc-8e22-4ddd-8d25-ff3506f671af";
export const CITATION_ID = "21530cb5-a67a-42fa-a41b-fc32a57bd6e5";
export const CONTRADICTING_CITATION_ID = "fd03e314-a945-48f5-b4df-45d17a5c58a8";
export const CHUNK_ID = "2536fb00-6dfc-464f-af3a-d51c1bb985d7";
export const DOCUMENT_ID = "b2634768-e671-47a7-ac08-127f45f24350";
export const BLOCK_ID = "62d2887c-b59c-45c7-8d5f-3110dc6d92ce";
export const NOW = "2026-08-12T12:00:00.000Z";

export const FOLDER_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

export const folderSummary = {
  createdAt: NOW,
  id: FOLDER_ID,
  name: "Garden research",
  updatedAt: NOW,
};

export const threadSummary = {
  createdAt: NOW,
  folderId: null,
  id: THREAD_ID,
  lastMessageAt: NOW,
  lastMessagePreview: "Keep seeds cool and dry.",
  messageCount: 2,
  title: "Seed storage",
  updatedAt: NOW,
};

export const userMessage = {
  answerProvenance: null,
  citations: [],
  content: "How should I store seeds?",
  createdAt: NOW,
  errorCode: null,
  errorMessage: null,
  id: USER_MESSAGE_ID,
  model: null,
  ordinal: 0,
  role: "user" as const,
  routingDiagnostics: null,
  runId: null,
  status: "completed" as const,
  threadId: THREAD_ID,
  updatedAt: NOW,
};

export const citation = {
  chunkId: CHUNK_ID,
  createdAt: NOW,
  documentId: DOCUMENT_ID,
  evidenceId: "E1",
  headingPath: ["Storage"],
  id: CITATION_ID,
  messageId: ASSISTANT_MESSAGE_ID,
  ordinal: 0,
  retrievalComponentScores: [],
  sourceLocator: {
    chunkId: CHUNK_ID,
    documentId: DOCUMENT_ID,
    end: {
      blockId: BLOCK_ID,
      blockOrdinal: 3,
      endLine: 12,
      pageNumber: 7,
      sourceFragment: null,
      sourcePath: null,
      startLine: 12,
    },
    start: {
      blockId: BLOCK_ID,
      blockOrdinal: 3,
      endLine: 12,
      pageNumber: 7,
      sourceFragment: null,
      sourcePath: null,
      startLine: 12,
    },
  },
  text: "Store seeds in a cool, dry place.",
  title: "Seed handbook",
};

export const assistantMessage = {
  answerProvenance: null,
  citations: [citation],
  content: "Keep seeds cool and dry. [E1]",
  createdAt: NOW,
  errorCode: null,
  errorMessage: null,
  id: ASSISTANT_MESSAGE_ID,
  model: "qwen3:8b",
  ordinal: 1,
  role: "assistant" as const,
  routingDiagnostics: null,
  runId: RUN_ID,
  status: "completed" as const,
  threadId: THREAD_ID,
  updatedAt: NOW,
};

export const contradictingCitation = {
  ...citation,
  evidenceId: "E2",
  id: CONTRADICTING_CITATION_ID,
  ordinal: 1,
  text: "Room-temperature storage produced the best germination rate.",
  title: "Seed trial notes",
};

export const hybridProvenance = {
  classifications: [
    {
      classification: "supported" as const,
      contradictingEvidenceIds: [],
      equivalentLibraryClaimIds: ["L1"],
      modelClaimId: "M1",
      supportingEvidenceIds: ["E1"],
    },
    {
      classification: "mixed" as const,
      contradictingEvidenceIds: ["E2"],
      equivalentLibraryClaimIds: ["L1"],
      modelClaimId: "M2",
      supportingEvidenceIds: ["E1"],
    },
    {
      classification: "unverified" as const,
      contradictingEvidenceIds: [],
      equivalentLibraryClaimIds: [],
      modelClaimId: "M3",
      supportingEvidenceIds: [],
    },
  ],
  finalSections: [
    {
      kind: "library" as const,
      statements: [
        {
          contradictingEvidenceIds: [],
          sectionKind: "library" as const,
          sourceClaimIds: ["L1", "M1"],
          statementId: "S1",
          supportingEvidenceIds: ["E1"],
          text: "Keep seeds cool and dry.",
        },
        {
          contradictingEvidenceIds: [],
          sectionKind: "library" as const,
          sourceClaimIds: ["L2"],
          statementId: "S4",
          supportingEvidenceIds: ["E2"],
          text: "One trial found room-temperature storage performed best.",
        },
      ],
      title: "What your library supports",
    },
    {
      kind: "conflict" as const,
      statements: [
        {
          contradictingEvidenceIds: ["E2"],
          sectionKind: "conflict" as const,
          sourceClaimIds: ["M2"],
          statementId: "S2",
          supportingEvidenceIds: ["E1"],
          text: "The recommended storage temperature differs between sources.",
        },
      ],
      title: "Where the evidence differs",
    },
    {
      kind: "model-background" as const,
      statements: [
        {
          contradictingEvidenceIds: [],
          sectionKind: "model-background" as const,
          sourceClaimIds: ["M3"],
          statementId: "S3",
          supportingEvidenceIds: [],
          text: "Airtight containers are commonly used for seed storage.",
        },
      ],
      title: "Additional model background",
    },
  ],
  generationModel: { digest: "a".repeat(64), model: "qwen3:8b" },
  libraryClaims: [
    { evidenceIds: ["E1"], id: "L1", text: "Keep seeds cool and dry." },
    {
      evidenceIds: ["E2"],
      id: "L2",
      text: "One trial found room-temperature storage performed best.",
    },
  ],
  mode: "labeled-hybrid" as const,
  modelClaims: [
    { id: "M1", text: "Keep seeds cool and dry." },
    { id: "M2", text: "Cool storage is always best." },
    { id: "M3", text: "Airtight containers are commonly used for seed storage." },
  ],
  promptVersions: {
    closedBook: "closed-book-answer-v1",
    contextualization: null,
    groundedDerivation: "transparent-grounded-derivations-v1",
    reconciliation: "claim-reconciliation-v1",
    synthesis: "hybrid-synthesis-v1",
    verification: "hybrid-synthesis-verification-v1",
  },
  stages: {
    background: { fallbackReason: null, status: "completed" as const },
    library: { fallbackReason: null, status: "completed" as const },
    reconciliation: { fallbackReason: null, status: "completed" as const },
    synthesis: { fallbackReason: null, status: "completed" as const },
    verification: {
      fallbackReason: "synthesis-verification-rejected",
      status: "failed" as const,
    },
  },
  version: 1 as const,
};

export const hybridAssistantMessage = {
  ...assistantMessage,
  answerProvenance: hybridProvenance,
  citations: [citation, contradictingCitation],
  content: "This serialized fallback content should not be rendered.",
};

export const evidenceFirstProvenance = {
  generationModel: { digest: "b".repeat(64), model: "qwen3:8b" },
  mode: "labeled-hybrid" as const,
  promptVersions: {
    contextualization: null,
    evidenceAnswer: "evidence-first-answer-v1",
    groundedDerivation: "transparent-grounded-derivations-v1",
    modelDraft: "closed-book-answer-v1",
    verification: "evidence-first-verification-v1",
  },
  stages: {
    generation: { fallbackReason: null, status: "completed" as const },
    library: { fallbackReason: null, status: "completed" as const },
    verification: { fallbackReason: null, status: "completed" as const },
  },
  statements: [
    {
      evidenceIds: ["E1"],
      kind: "library" as const,
      statementId: "S1",
      text: "Keep seeds cool and dry.",
    },
    {
      evidenceIds: [],
      kind: "model" as const,
      statementId: "S2",
      text: "Airtight containers can provide additional protection.",
    },
    {
      evidenceIds: ["E2"],
      kind: "library" as const,
      statementId: "S3",
      text: "One trial found room-temperature storage performed best.",
    },
  ],
  version: 2 as const,
};

export const evidenceFirstAssistantMessage = {
  ...assistantMessage,
  answerProvenance: evidenceFirstProvenance,
  citations: [citation, contradictingCitation],
  content: "This serialized V2 content should not be rendered.",
};

export const offlineRagStatus = {
  embedding: {
    coverage: null,
    latestJob: null,
    model: {
      capabilities: [],
      capable: false,
      digest: null,
      installed: false,
      model: "qwen3-embedding:0.6b" as const,
      provider: "ollama" as const,
    },
    profile: null,
  },
  generation: {
    options: [
      {
        capabilities: [],
        capable: false,
        digest: null,
        installed: false,
        incompatibilityReason: "missing-completion" as const,
        model: "qwen3:8b" as const,
        nativeContextWindow: null,
        provider: "ollama" as const,
        sizeBytes: 0,
      },
      {
        capabilities: [],
        capable: false,
        digest: null,
        installed: false,
        incompatibilityReason: "missing-completion" as const,
        model: "gemma4:26b" as const,
        nativeContextWindow: null,
        provider: "ollama" as const,
        sizeBytes: 0,
      },
    ],
    selectionMode: "auto" as const,
    selected: null,
  },
  runtime: {
    installDetected: true,
    provider: "ollama" as const,
    reason: "not-running" as const,
    state: "unavailable" as const,
  },
};

export const readyRagStatus = {
  ...offlineRagStatus,
  generation: {
    options: [
      {
        capabilities: ["completion" as const],
        capable: true,
        digest: "sha256:qwen",
        installed: true,
        incompatibilityReason: null,
        model: "qwen3:8b" as const,
        nativeContextWindow: 32768,
        provider: "ollama" as const,
        sizeBytes: 6 * 1024 ** 3,
      },
      offlineRagStatus.generation.options[1],
    ],
    selectionMode: "manual" as const,
    selected: {
      contextWindow: 32768,
      digest: "sha256:qwen",
      model: "qwen3:8b" as const,
      provider: "ollama" as const,
      sizeBytes: 6 * 1024 ** 3,
    },
  },
  runtime: {
    installDetected: true,
    provider: "ollama" as const,
    state: "available" as const,
  },
};

export const systemStatus = {
  appVersion: "0.0.1",
  architecture: "arm64",
  macosVersion: "15.6.1",
  memoryBytes: 16 * 1024 ** 3,
  ollama: {
    installDetected: true,
    models: [
      {
        digest: "sha256:model",
        name: "qwen3:14b",
        parameterSize: "14B",
        quantizationLevel: "Q4_K_M",
        sizeBytes: 9 * 1024 ** 3,
      },
    ],
    state: "ready" as const,
  },
  platform: "darwin",
  support: {
    architectureSupported: true,
    macosSupported: true,
    memorySupported: true,
    supported: true,
  },
};

export const emptySnapshot: LibrarySnapshot = { documents: [], jobs: [] };

export const documentSummary = {
  createdAt: "2026-08-11T22:00:00.000Z",
  diagnosticCount: 0,
  errorCode: null,
  errorMessage: null,
  format: "markdown" as const,
  id: DOCUMENT_ID,
  originalName: "tomato-notes.md",
  reviewedAt: null,
  sizeBytes: 1024,
  status: "ready" as const,
  title: "Tomato notes",
  updatedAt: "2026-08-11T22:00:00.000Z",
};

export const sourceBlock = {
  attributes: {},
  endLine: 12,
  headingPath: ["Storage"],
  id: BLOCK_ID,
  ordinal: 3,
  pageNumber: 7,
  sourceFragment: null,
  sourcePath: null,
  startLine: 12,
  text: "Store seeds in a cool, dry place.",
  type: "paragraph",
};

export const pendingAssistantMessage = {
  ...assistantMessage,
  answerProvenance: null,
  citations: [],
  content: "",
  status: "pending" as const,
};

export const emptyPreferences = {
  accent: null,
  collapsedFolders: null,
  theme: null,
};

export interface InstallApiOptions {
  readonly folders?: readonly unknown[];
  readonly importFiles?: () => Promise<unknown>;
  readonly preferences?: unknown;
  readonly ragStatus?: unknown;
  readonly searchResults?: readonly unknown[];
  readonly sendResult?: unknown;
  readonly snapshot?: unknown;
  readonly systemStatus?: unknown;
  readonly thread?: unknown;
  readonly threads?: readonly unknown[];
}

/**
 * Installs a fully stubbed window.knosys for renderer integration tests and
 * returns the mocks plus emit helpers for the two push-event channels.
 */
export function installKnosysApi(options: InstallApiOptions = {}) {
  let chatListener: (event: ChatEvent) => void = () => undefined;
  let progressListener: (event: ImportProgressEvent) => void = () => undefined;
  let pullListener: (event: ModelPullEvent) => void = () => undefined;
  const send = vi.fn().mockResolvedValue(
    options.sendResult ?? {
      accepted: true,
      assistantMessage: pendingAssistantMessage,
      runId: RUN_ID,
      thread: threadSummary,
      userMessage,
    },
  );
  const cancelledAssistant: ChatMessage = {
    ...pendingAssistantMessage,
    status: "cancelled",
  };
  const api = {
    chat: {
      cancel: vi.fn().mockResolvedValue(cancelledAssistant),
      createFolder: vi.fn().mockResolvedValue(folderSummary),
      deleteFolder: vi.fn().mockResolvedValue({
        deletedFolderId: FOLDER_ID,
        deletedThreadIds: [],
      }),
      deleteThread: vi.fn().mockResolvedValue({ deletedThreadId: THREAD_ID }),
      getThread: vi.fn().mockResolvedValue(options.thread),
      listFolders: vi.fn().mockResolvedValue(options.folders ?? []),
      listThreads: vi.fn().mockResolvedValue(options.threads ?? []),
      moveThread: vi.fn(),
      onEvent: vi.fn((nextListener: (event: ChatEvent) => void) => {
        chatListener = nextListener;
        return () => undefined;
      }),
      renameFolder: vi.fn(),
      renameThread: vi.fn(),
      send,
    },
    evidence: {
      get: vi.fn((citationId: string) =>
        Promise.resolve(
          citationId === CONTRADICTING_CITATION_ID ? contradictingCitation : citation,
        ),
      ),
    },
    library: {
      acknowledgeReview: vi.fn().mockResolvedValue(options.snapshot ?? emptySnapshot),
      deleteDocument: vi.fn(),
      getDocumentReview: vi
        .fn()
        .mockResolvedValue({ diagnostics: [], document: documentSummary }),
      getSnapshot: vi.fn().mockResolvedValue(options.snapshot ?? emptySnapshot),
      importDirectory: vi.fn(),
      importFiles: options.importFiles
        ? vi.fn().mockImplementation(options.importFiles)
        : vi.fn(),
      onImportProgress: vi.fn(
        (nextListener: (event: ImportProgressEvent) => void) => {
          progressListener = nextListener;
          return () => undefined;
        },
      ),
      replaceDocument: vi.fn().mockResolvedValue({ batch: null, cancelled: true }),
      reprocessDocument: vi.fn().mockResolvedValue(options.snapshot ?? emptySnapshot),
      search: vi.fn().mockResolvedValue(options.searchResults ?? []),
    },
    preferences: {
      get: vi.fn().mockResolvedValue(options.preferences ?? emptyPreferences),
      set: vi.fn().mockResolvedValue(options.preferences ?? emptyPreferences),
    },
    models: {
      cancelPull: vi.fn().mockResolvedValue({ cancelled: true, model: "qwen3:8b" }),
      onPullEvent: vi.fn((nextListener: (event: ModelPullEvent) => void) => {
        pullListener = nextListener;
        return () => undefined;
      }),
      pull: vi.fn().mockResolvedValue({ accepted: true, model: "qwen3:8b" }),
    },
    rag: {
      getStatus: vi.fn().mockResolvedValue(options.ragStatus ?? readyRagStatus),
      setGenerationModel: vi.fn(),
    },
    source: {
      getWindow: vi.fn().mockResolvedValue([sourceBlock]),
    },
    system: {
      getStatus: vi.fn().mockResolvedValue(options.systemStatus ?? systemStatus),
    },
  };
  Object.defineProperty(window, "knosys", { configurable: true, value: api });
  return {
    api,
    emit(event: ChatEvent) {
      act(() => {
        chatListener(event);
      });
    },
    emitImportProgress(event: ImportProgressEvent) {
      act(() => {
        progressListener(event);
      });
    },
    emitPullEvent(event: ModelPullEvent) {
      act(() => {
        pullListener(event);
      });
    },
    send,
  };
}
