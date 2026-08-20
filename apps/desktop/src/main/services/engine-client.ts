import { randomUUID } from "node:crypto";
import { join } from "node:path";

import {
  chatAcceptanceSchema,
  chatCitationSchema,
  chatDeleteFolderResultSchema,
  chatDeleteThreadResultSchema,
  chatFolderListSchema,
  chatFolderSchema,
  chatMessageSchema,
  chatThreadListSchema,
  chatThreadSchema,
  chatThreadSummarySchema,
  engineEventEnvelopeSchema,
  engineRequestSchema,
  engineResponseSchema,
  importBatchResultSchema,
  libraryDeleteDocumentResultSchema,
  librarySnapshotSchema,
  modelsCancelPullResultSchema,
  modelsPullResultSchema,
  ragStatusSchema,
  searchResultSchema,
  sourceBlockWindowSchema,
  type ChatAcceptance,
  type ChatCitation,
  type ChatDeleteFolderResult,
  type ChatDeleteThreadResult,
  type ChatFolder,
  type EngineChatEvent,
  type ChatMessage,
  type ChatThread,
  type ChatThreadSummary,
  type AnswerMode,
  type EngineRequest,
  type GenerationModelPreference,
  type ImportBatchResult,
  type ImportProgressEvent,
  type LibraryDeleteDocumentResult,
  type LibrarySnapshot,
  type ModelPullEvent,
  type ModelsCancelPullResult,
  type ModelsPullResult,
  type RagStatus,
  type RecommendedModelName,
  type SearchResult,
  type SourceBlock,
} from "@knosys-rag/contracts";
import {
  app,
  utilityProcess,
  type UtilityProcess,
} from "electron";
import * as sqliteVec from "sqlite-vec";

interface PendingRequest {
  readonly reject: (error: Error) => void;
  readonly resolve: (result: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

const REQUEST_TIMEOUT_MS = 60_000;

export class EngineClientError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "EngineClientError";
  }
}

export class EngineClient {
  readonly #chatEventListeners = new Set<(event: EngineChatEvent) => void>();
  readonly #importProgressListeners = new Set<(event: ImportProgressEvent) => void>();
  readonly #modelPullListeners = new Set<(event: ModelPullEvent) => void>();
  readonly #pending = new Map<string, PendingRequest>();
  #process: UtilityProcess | null = null;
  #starting: Promise<void> | null = null;

  public async start(): Promise<void> {
    if (this.#process) return;
    if (this.#starting) return this.#starting;

    this.#starting = new Promise<void>((resolve, reject) => {
      const process = utilityProcess.fork(
        join(import.meta.dirname, "engine/index.js"),
        [],
        {
          serviceName: "Knosys RAG Engine",
          stdio: "pipe",
        },
      );
      this.#process = process;
      process.stderr?.on("data", (data: Uint8Array) => {
        console.error(`[engine] ${Buffer.from(data).toString("utf8").trim()}`);
      });
      process.on("message", (rawResponse: unknown) => this.#handleResponse(rawResponse));
      process.once("exit", (code) => {
        this.#process = null;
        this.#starting = null;
        this.#rejectPending(
          new Error(`The local engine stopped unexpectedly with code ${code}.`),
        );
      });
      process.once("spawn", () => {
        const vectorExtensionPath = sqliteVec
          .getLoadablePath()
          .replace("app.asar/", "app.asar.unpacked/");
        void this.#request({
          id: randomUUID(),
          method: "engine.initialize",
          params: {
            rootPath: app.getPath("userData"),
            vectorExtensionPath,
          },
        })
          .then(() => resolve())
          .catch(reject);
      });
    }).finally(() => {
      this.#starting = null;
    });

    return this.#starting;
  }

  public stop(): void {
    this.#process?.kill();
    this.#process = null;
    this.#rejectPending(new Error("The local engine stopped."));
  }

  public async getSnapshot(): Promise<LibrarySnapshot> {
    await this.start();
    return librarySnapshotSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.getSnapshot",
        params: {},
      }),
    );
  }

  public async importPaths(paths: readonly string[]): Promise<ImportBatchResult> {
    await this.start();
    return importBatchResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.importPaths",
        params: { paths: [...paths] },
      }),
    );
  }

  public async importDirectory(path: string): Promise<ImportBatchResult> {
    await this.start();
    return importBatchResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.importDirectory",
        params: { path },
      }),
    );
  }

  public async search(query: string): Promise<readonly SearchResult[]> {
    await this.start();
    return searchResultSchema.array().parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.search",
        params: { limit: 20, query },
      }),
    );
  }

  public async getRagStatus(): Promise<RagStatus> {
    await this.start();
    return ragStatusSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.rag.getStatus",
        params: {},
      }),
    );
  }

  public async setGenerationModel(
    preference: GenerationModelPreference,
  ): Promise<RagStatus> {
    await this.start();
    return ragStatusSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.rag.setGenerationModel",
        params: preference,
      }),
    );
  }

  public async listChatThreads(): Promise<readonly ChatThreadSummary[]> {
    await this.start();
    return chatThreadListSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.listThreads",
        params: {},
      }),
    );
  }

  public async getChatThread(threadId: string): Promise<ChatThread> {
    await this.start();
    return chatThreadSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.getThread",
        params: { threadId },
      }),
    );
  }

  public async sendChat(
    threadId: string | null,
    question: string,
    mode: AnswerMode = "labeled-hybrid",
  ): Promise<ChatAcceptance> {
    await this.start();
    return chatAcceptanceSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.send",
        params: { mode, question, threadId },
      }),
    );
  }

  public async cancelChat(runId: string): Promise<ChatMessage> {
    await this.start();
    return chatMessageSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.cancel",
        params: { runId },
      }),
    );
  }

  public async deleteChatThread(threadId: string): Promise<ChatDeleteThreadResult> {
    await this.start();
    return chatDeleteThreadResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.deleteThread",
        params: { threadId },
      }),
    );
  }

  public async renameChatThread(
    threadId: string,
    title: string,
  ): Promise<ChatThreadSummary> {
    await this.start();
    return chatThreadSummarySchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.renameThread",
        params: { threadId, title },
      }),
    );
  }

  public async listChatFolders(): Promise<readonly ChatFolder[]> {
    await this.start();
    return chatFolderListSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.listFolders",
        params: {},
      }),
    );
  }

  public async createChatFolder(name: string): Promise<ChatFolder> {
    await this.start();
    return chatFolderSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.createFolder",
        params: { name },
      }),
    );
  }

  public async renameChatFolder(folderId: string, name: string): Promise<ChatFolder> {
    await this.start();
    return chatFolderSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.renameFolder",
        params: { folderId, name },
      }),
    );
  }

  public async deleteChatFolder(folderId: string): Promise<ChatDeleteFolderResult> {
    await this.start();
    return chatDeleteFolderResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.deleteFolder",
        params: { folderId },
      }),
    );
  }

  public async moveChatThread(
    threadId: string,
    folderId: string | null,
  ): Promise<ChatThreadSummary> {
    await this.start();
    return chatThreadSummarySchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.chat.moveThread",
        params: { folderId, threadId },
      }),
    );
  }

  public async deleteDocument(
    documentId: string,
  ): Promise<LibraryDeleteDocumentResult> {
    await this.start();
    return libraryDeleteDocumentResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.library.deleteDocument",
        params: { documentId },
      }),
    );
  }

  public async getEvidence(citationId: string): Promise<ChatCitation> {
    await this.start();
    return chatCitationSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.evidence.get",
        params: { citationId },
      }),
    );
  }

  public async getSourceWindow(
    chunkId: string,
    before: number,
    after: number,
  ): Promise<readonly SourceBlock[]> {
    await this.start();
    return sourceBlockWindowSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.source.getWindow",
        params: { after, before, chunkId },
      }),
    );
  }

  public async pullModel(model: RecommendedModelName): Promise<ModelsPullResult> {
    await this.start();
    return modelsPullResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.models.pull",
        params: { model },
      }),
    );
  }

  public async cancelPullModel(
    model: RecommendedModelName,
  ): Promise<ModelsCancelPullResult> {
    await this.start();
    return modelsCancelPullResultSchema.parse(
      await this.#request({
        id: randomUUID(),
        method: "engine.models.cancelPull",
        params: { model },
      }),
    );
  }

  public onModelPullEvent(listener: (event: ModelPullEvent) => void): () => void {
    this.#modelPullListeners.add(listener);
    return () => this.#modelPullListeners.delete(listener);
  }

  public onChatEvent(listener: (event: EngineChatEvent) => void): () => void {
    this.#chatEventListeners.add(listener);
    return () => this.#chatEventListeners.delete(listener);
  }

  public onImportProgress(listener: (event: ImportProgressEvent) => void): () => void {
    this.#importProgressListeners.add(listener);
    return () => this.#importProgressListeners.delete(listener);
  }

  #request(request: EngineRequest): Promise<unknown> {
    const parsed = engineRequestSchema.parse(request);
    if (!this.#process) {
      return Promise.reject(new Error("The local engine is unavailable."));
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(parsed.id);
        reject(new Error("The local engine operation timed out."));
      }, REQUEST_TIMEOUT_MS);
      this.#pending.set(parsed.id, { reject, resolve, timeout });
      this.#process?.postMessage(parsed);
    });
  }

  #handleResponse(rawResponse: unknown): void {
    const event = engineEventEnvelopeSchema.safeParse(rawResponse);
    if (event.success) {
      if (event.data.type === "chat.event") {
        for (const listener of this.#chatEventListeners) {
          try {
            listener(event.data.event);
          } catch {
            // One event consumer must not interrupt delivery to the others.
          }
        }
      } else if (event.data.type === "model.pull") {
        for (const listener of this.#modelPullListeners) {
          try {
            listener(event.data.event);
          } catch {
            // One event consumer must not interrupt delivery to the others.
          }
        }
      } else {
        for (const listener of this.#importProgressListeners) {
          try {
            listener(event.data.event);
          } catch {
            // One event consumer must not interrupt delivery to the others.
          }
        }
      }
      return;
    }
    const parsed = engineResponseSchema.safeParse(rawResponse);
    if (!parsed.success) return;
    const pending = this.#pending.get(parsed.data.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.#pending.delete(parsed.data.id);
    if (parsed.data.ok) pending.resolve(parsed.data.result);
    else {
      pending.reject(
        new EngineClientError(
          parsed.data.error.code,
          parsed.data.error.message,
          parsed.data.error.retryable,
        ),
      );
    }
  }

  #rejectPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
