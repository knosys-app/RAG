import { randomUUID } from "node:crypto";

import {
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  importSelectionResultSchema,
  ipcErrorCodeSchema,
  ipcEventSchema,
  ipcRequestSchema,
  ipcResponseSchema,
  type IpcError,
  type IpcResponse,
} from "@knosys-rag/contracts";
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type IpcMainInvokeEvent,
} from "electron";

import {
  EngineClientError,
  type EngineClient,
} from "./services/engine-client.js";
import { getPreferences, setPreferences } from "./services/preferences.js";
import { getSystemStatus } from "./services/system-status.js";
import { isTrustedRendererUrl } from "./trusted-renderer.js";

const AVAILABLE_FILE_FILTER = {
  extensions: ["txt", "md", "markdown", "html", "htm", "docx", "epub", "pdf"],
  name: "Available sources",
};

function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const senderFrame = event.senderFrame;
  if (!senderFrame || senderFrame !== event.sender.mainFrame) {
    return false;
  }

  return isTrustedRendererUrl(senderFrame.url, process.env.ELECTRON_RENDERER_URL);
}

function errorResponse(
  id: string,
  code: IpcError["code"],
  message: string,
  retryable = false,
): IpcResponse {
  return ipcResponseSchema.parse({
    error: { code, message, retryable },
    id,
    ok: false,
  });
}

export function registerIpcHandlers(engine: EngineClient): void {
  const broadcastEvent = (event: unknown) => {
    const parsed = ipcEventSchema.parse(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (
        !window.isDestroyed() &&
        isTrustedRendererUrl(
          window.webContents.getURL(),
          process.env.ELECTRON_RENDERER_URL,
        )
      ) {
        window.webContents.send(IPC_EVENT_CHANNEL, parsed);
      }
    }
  };
  engine.onChatEvent(broadcastEvent);
  engine.onImportProgress(broadcastEvent);
  engine.onModelPullEvent(broadcastEvent);

  ipcMain.handle(
    IPC_INVOKE_CHANNEL,
    async (event, rawRequest: unknown): Promise<IpcResponse> => {
      const fallbackId = randomUUID();

      if (!isTrustedSender(event)) {
        return errorResponse(
          fallbackId,
          "UNTRUSTED_SENDER",
          "The request did not originate from the application renderer.",
        );
      }

      const parsed = ipcRequestSchema.safeParse(rawRequest);
      if (!parsed.success) {
        return errorResponse(
          fallbackId,
          "INVALID_REQUEST",
          "The desktop request did not match the application contract.",
        );
      }

      try {
        switch (parsed.data.method) {
          case "system.getStatus":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await getSystemStatus(),
            });
          case "preferences.get":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await getPreferences(),
            });
          case "preferences.set":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await setPreferences(parsed.data.params),
            });
          case "library.getSnapshot":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getSnapshot(),
            });
          case "library.importFiles": {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) {
              return errorResponse(
                parsed.data.id,
                "UNTRUSTED_SENDER",
                "The import request is not attached to an application window.",
              );
            }
            const selection = await dialog.showOpenDialog(window, {
              filters: [AVAILABLE_FILE_FILTER],
              message: "Choose local sources to copy into Knosys RAG",
              properties: ["openFile", "multiSelections"],
              title: "Import sources",
            });
            const result = selection.canceled
              ? { batch: null, cancelled: true }
              : {
                  batch: await engine.importPaths(selection.filePaths),
                  cancelled: false,
                };
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: importSelectionResultSchema.parse(result),
            });
          }
          case "library.importDirectory": {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) {
              return errorResponse(
                parsed.data.id,
                "UNTRUSTED_SENDER",
                "The import request is not attached to an application window.",
              );
            }
            const selection = await dialog.showOpenDialog(window, {
              message: "Choose a folder to scan for available sources",
              properties: ["openDirectory"],
              title: "Import a source folder",
            });
            const selectedPath = selection.filePaths[0];
            const result = selection.canceled || !selectedPath
              ? { batch: null, cancelled: true }
              : {
                  batch: await engine.importDirectory(selectedPath),
                  cancelled: false,
                };
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: importSelectionResultSchema.parse(result),
            });
          }
          case "library.search":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.search(parsed.data.params.query),
            });
          case "library.deleteDocument":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.deleteDocument(parsed.data.params.documentId),
            });
          case "library.getDocumentReview":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getDocumentReview(parsed.data.params.documentId),
            });
          case "library.acknowledgeReview":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.acknowledgeReview(parsed.data.params.documentId),
            });
          case "library.reprocessDocument":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.reprocessDocument(parsed.data.params.documentId),
            });
          case "library.replaceDocument": {
            const window = BrowserWindow.fromWebContents(event.sender);
            if (!window) {
              return errorResponse(
                parsed.data.id,
                "UNTRUSTED_SENDER",
                "The import request is not attached to an application window.",
              );
            }
            const selection = await dialog.showOpenDialog(window, {
              filters: [AVAILABLE_FILE_FILTER],
              message: "Choose a replacement source to import",
              properties: ["openFile"],
              title: "Replace source",
            });
            const replacementPath = selection.filePaths[0];
            const result = selection.canceled || !replacementPath
              ? { batch: null, cancelled: true }
              : {
                  batch: await engine.replaceDocument(
                    parsed.data.params.documentId,
                    replacementPath,
                  ),
                  cancelled: false,
                };
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: importSelectionResultSchema.parse(result),
            });
          }
          case "rag.getStatus":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getRagStatus(),
            });
          case "rag.setGenerationModel":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.setGenerationModel(parsed.data.params),
            });
          case "chat.listThreads":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.listChatThreads(),
            });
          case "chat.getThread":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getChatThread(parsed.data.params.threadId),
            });
          case "chat.send":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.sendChat(
                parsed.data.params.threadId,
                parsed.data.params.question,
                parsed.data.params.mode,
              ),
            });
          case "chat.cancel":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.cancelChat(parsed.data.params.runId),
            });
          case "chat.deleteThread":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.deleteChatThread(parsed.data.params.threadId),
            });
          case "chat.renameThread":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.renameChatThread(
                parsed.data.params.threadId,
                parsed.data.params.title,
              ),
            });
          case "memory.setThreadExclusion":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.setThreadMemoryExclusion(
                parsed.data.params.threadId,
                parsed.data.params.excluded,
              ),
            });
          case "memory.listFacts":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.listUserFacts(),
            });
          case "memory.updateFact":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.updateUserFact(
                parsed.data.params.factId,
                parsed.data.params.fact,
              ),
            });
          case "memory.deleteFact":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.deleteUserFact(parsed.data.params.factId),
            });
          case "memory.getStatus":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getMemoryStatus(),
            });
          case "chat.listFolders":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.listChatFolders(),
            });
          case "chat.createFolder":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.createChatFolder(parsed.data.params.name),
            });
          case "chat.renameFolder":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.renameChatFolder(
                parsed.data.params.folderId,
                parsed.data.params.name,
              ),
            });
          case "chat.deleteFolder":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.deleteChatFolder(parsed.data.params.folderId),
            });
          case "chat.moveThread":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.moveChatThread(
                parsed.data.params.threadId,
                parsed.data.params.folderId,
              ),
            });
          case "models.pull":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.pullModel(parsed.data.params.model),
            });
          case "models.cancelPull":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.cancelPullModel(parsed.data.params.model),
            });
          case "evidence.get":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getEvidence(parsed.data.params.citationId),
            });
          case "source.getWindow":
            return ipcResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.getSourceWindow(
                parsed.data.params.chunkId,
                parsed.data.params.before,
                parsed.data.params.after,
              ),
            });
        }
      } catch (error) {
        if (error instanceof EngineClientError) {
          const code = ipcErrorCodeSchema.safeParse(error.code);
          return errorResponse(
            parsed.data.id,
            code.success ? code.data : "INTERNAL_ERROR",
            error.message,
            error.retryable,
          );
        }
        return errorResponse(
          parsed.data.id,
          "INTERNAL_ERROR",
          error instanceof Error
            ? error.message
            : "Knosys RAG could not complete the local operation.",
        );
      }
    },
  );
}
