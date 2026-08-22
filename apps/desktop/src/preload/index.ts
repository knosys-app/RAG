import {
  appPreferencesSchema,
  chatAcceptanceSchema,
  chatCitationSchema,
  chatDeleteFolderResultSchema,
  chatDeleteThreadResultSchema,
  chatEventSchema,
  chatFolderListSchema,
  chatFolderSchema,
  chatMessageSchema,
  chatThreadListSchema,
  chatThreadSchema,
  chatThreadSummarySchema,
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  documentReviewSchema,
  importProgressEventSchema,
  importSelectionResultSchema,
  ipcResponseSchema,
  KnosysApiError,
  libraryDeleteDocumentResultSchema,
  librarySnapshotSchema,
  memoryDeleteFactResultSchema,
  memoryStatusSchema,
  modelPullEventSchema,
  modelsCancelPullResultSchema,
  modelsPullResultSchema,
  ragStatusSchema,
  searchResultSchema,
  sourceBlockWindowSchema,
  systemStatusSchema,
  userFactListSchema,
  userFactSchema,
  type KnosysDesktopApi,
} from "@knosys-rag/contracts";
import { contextBridge, ipcRenderer } from "electron";
import type { z } from "zod";

async function invoke<TSchema extends z.ZodType>(
  method:
    | "chat.cancel"
    | "chat.createFolder"
    | "chat.deleteFolder"
    | "chat.deleteThread"
    | "chat.getThread"
    | "chat.listFolders"
    | "chat.listThreads"
    | "chat.moveThread"
    | "chat.renameFolder"
    | "chat.renameThread"
    | "chat.send"
    | "evidence.get"
    | "library.acknowledgeReview"
    | "library.deleteDocument"
    | "library.getDocumentReview"
    | "library.getSnapshot"
    | "library.importDirectory"
    | "library.importFiles"
    | "library.replaceDocument"
    | "library.reprocessDocument"
    | "library.search"
    | "memory.deleteFact"
    | "memory.getStatus"
    | "memory.listFacts"
    | "memory.setThreadExclusion"
    | "memory.updateFact"
    | "models.cancelPull"
    | "models.pull"
    | "preferences.get"
    | "preferences.set"
    | "rag.getStatus"
    | "rag.setGenerationModel"
    | "source.getWindow"
    | "system.getStatus",
  params: Readonly<Record<string, unknown>>,
  resultSchema: TSchema,
): Promise<z.infer<TSchema>> {
  const response = ipcResponseSchema.parse(
    await ipcRenderer.invoke(IPC_INVOKE_CHANNEL, {
      id: globalThis.crypto.randomUUID(),
      method,
      params,
    }),
  );
  // Errors crossing the sandboxed contextBridge only keep their message, so
  // the structured error is encoded into it for KnosysApiError.fromThrown.
  if (!response.ok) throw new Error(KnosysApiError.encodeMessage(response.error));
  return resultSchema.parse(response.result);
}

const api: KnosysDesktopApi = {
  chat: {
    cancel: (runId) => invoke("chat.cancel", { runId }, chatMessageSchema),
    createFolder: (name) =>
      invoke("chat.createFolder", { name }, chatFolderSchema),
    deleteFolder: (folderId) =>
      invoke("chat.deleteFolder", { folderId }, chatDeleteFolderResultSchema),
    deleteThread: (threadId) =>
      invoke("chat.deleteThread", { threadId }, chatDeleteThreadResultSchema),
    getThread: (threadId) =>
      invoke("chat.getThread", { threadId }, chatThreadSchema),
    listFolders: () => invoke("chat.listFolders", {}, chatFolderListSchema),
    listThreads: () => invoke("chat.listThreads", {}, chatThreadListSchema),
    moveThread: (threadId, folderId) =>
      invoke("chat.moveThread", { folderId, threadId }, chatThreadSummarySchema),
    onEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown) => {
        const event = chatEventSchema.safeParse(rawEvent);
        if (event.success) listener(event.data);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    },
    renameFolder: (folderId, name) =>
      invoke("chat.renameFolder", { folderId, name }, chatFolderSchema),
    renameThread: (threadId, title) =>
      invoke("chat.renameThread", { threadId, title }, chatThreadSummarySchema),
    send: (threadId, question, mode = "labeled-hybrid") =>
      invoke("chat.send", { mode, question, threadId }, chatAcceptanceSchema),
  },
  evidence: {
    get: (citationId) =>
      invoke("evidence.get", { citationId }, chatCitationSchema),
  },
  library: {
    acknowledgeReview: (documentId) =>
      invoke("library.acknowledgeReview", { documentId }, librarySnapshotSchema),
    deleteDocument: (documentId) =>
      invoke(
        "library.deleteDocument",
        { documentId },
        libraryDeleteDocumentResultSchema,
      ),
    getDocumentReview: (documentId) =>
      invoke("library.getDocumentReview", { documentId }, documentReviewSchema),
    getSnapshot: () => invoke("library.getSnapshot", {}, librarySnapshotSchema),
    importDirectory: () =>
      invoke("library.importDirectory", {}, importSelectionResultSchema),
    importFiles: () => invoke("library.importFiles", {}, importSelectionResultSchema),
    replaceDocument: (documentId) =>
      invoke("library.replaceDocument", { documentId }, importSelectionResultSchema),
    reprocessDocument: (documentId) =>
      invoke("library.reprocessDocument", { documentId }, librarySnapshotSchema),
    onImportProgress: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown) => {
        const event = importProgressEventSchema.safeParse(rawEvent);
        if (event.success) listener(event.data);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    },
    search: (query) =>
      invoke("library.search", { query }, searchResultSchema.array()),
  },
  memory: {
    deleteFact: (factId) =>
      invoke("memory.deleteFact", { factId }, memoryDeleteFactResultSchema),
    getStatus: () => invoke("memory.getStatus", {}, memoryStatusSchema),
    listFacts: () => invoke("memory.listFacts", {}, userFactListSchema),
    setThreadExclusion: (threadId, excluded) =>
      invoke(
        "memory.setThreadExclusion",
        { excluded, threadId },
        chatThreadSummarySchema,
      ),
    updateFact: (factId, fact) =>
      invoke("memory.updateFact", { fact, factId }, userFactSchema),
  },
  models: {
    cancelPull: (model) =>
      invoke("models.cancelPull", { model }, modelsCancelPullResultSchema),
    onPullEvent: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, rawEvent: unknown) => {
        const event = modelPullEventSchema.safeParse(rawEvent);
        if (event.success) listener(event.data);
      };
      ipcRenderer.on(IPC_EVENT_CHANNEL, handler);
      return () => ipcRenderer.removeListener(IPC_EVENT_CHANNEL, handler);
    },
    pull: (model) => invoke("models.pull", { model }, modelsPullResultSchema),
  },
  preferences: {
    get: () => invoke("preferences.get", {}, appPreferencesSchema),
    set: (patch) => invoke("preferences.set", patch, appPreferencesSchema),
  },
  rag: {
    getStatus: () => invoke("rag.getStatus", {}, ragStatusSchema),
    setGenerationModel: (preference) =>
      invoke("rag.setGenerationModel", preference, ragStatusSchema),
  },
  source: {
    getWindow: (chunkId, before, after) =>
      invoke(
        "source.getWindow",
        { after, before, chunkId },
        sourceBlockWindowSchema,
      ),
  },
  system: {
    getStatus: () => invoke("system.getStatus", {}, systemStatusSchema),
  },
};

contextBridge.exposeInMainWorld("knosys", Object.freeze(api));
