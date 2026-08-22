import {
  engineEventEnvelopeSchema,
  engineRequestSchema,
  engineResponseSchema,
  type EngineResponse,
  type ImportProgressEvent,
} from "@knosys-rag/contracts";
import { EngineOperationError, KnowledgeEngine } from "@knosys-rag/engine";

let engine: KnowledgeEngine | null = null;

function errorResponse(id: string, code: string, message: string): EngineResponse {
  // Never let an over-long message (e.g. a verbose ZodError) overflow the
  // response schema's 2048-char cap and turn a handled failure into an
  // unhandled rejection that crashes the engine process.
  const trimmed = message.trim();
  const bounded =
    trimmed.length > 2048 ? `${trimmed.slice(0, 2045)}...` : trimmed;
  return engineResponseSchema.parse({
    error: { code, message: bounded || "The local engine operation failed." },
    id,
    ok: false,
  });
}

function postImportProgress(event: ImportProgressEvent): void {
  process.parentPort.postMessage(
    engineEventEnvelopeSchema.parse({ event, type: "import.progress" }),
  );
}

process.parentPort.on("message", (event) => {
  void (async () => {
    const parsed = engineRequestSchema.safeParse(event.data);
    if (!parsed.success) return;

    try {
      switch (parsed.data.method) {
        case "engine.initialize": {
          engine?.close();
          engine = new KnowledgeEngine(
            parsed.data.params.rootPath,
            parsed.data.params.vectorExtensionPath,
          );
          console.error(
            `[startup] sqlite-vec ${engine.getVectorExtensionVersion()} loaded`,
          );
          await engine.initializeRag();
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: { initialized: true },
            }),
          );
          return;
        }
        case "engine.getSnapshot": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.getSnapshot(),
            }),
          );
          return;
        }
        case "engine.importPaths": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
               id: parsed.data.id,
               ok: true,
               result: await engine.importPaths(parsed.data.params.paths, {
                 onProgress: postImportProgress,
                 operationId: parsed.data.id,
               }),
            }),
          );
          return;
        }
         case "engine.importDirectory": {
           if (!engine) throw new Error("The local library is not initialized.");
           postImportProgress({
             completed: 0,
             currentName: null,
             kind: "import-progress",
             operationId: parsed.data.id,
             stage: "discovering",
             total: null,
           });
           const paths = await engine.discoverDirectory(parsed.data.params.path);
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
               result: await engine.importPaths(paths, {
                 onProgress: postImportProgress,
                 operationId: parsed.data.id,
               }),
            }),
          );
          return;
        }
        case "engine.search": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.search(
                parsed.data.params.query,
                parsed.data.params.limit,
              ),
            }),
          );
          return;
        }
        case "engine.rag.getStatus": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.initializeRag(),
            }),
          );
          return;
        }
        case "engine.rag.setGenerationModel": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.setGenerationModel(parsed.data.params),
            }),
          );
          return;
        }
        case "engine.chat.listThreads": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.listChatThreads(),
            }),
          );
          return;
        }
        case "engine.chat.getThread": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.getChatThread(parsed.data.params.threadId),
            }),
          );
          return;
        }
        case "engine.chat.send": {
          if (!engine) throw new Error("The local library is not initialized.");
          const result = await engine.startChat(
            {
              mode: parsed.data.params.mode,
              question: parsed.data.params.question,
              ...(parsed.data.params.threadId === null
                ? {}
                : { threadId: parsed.data.params.threadId }),
            },
            (chatEvent) => {
              process.parentPort.postMessage(
                engineEventEnvelopeSchema.parse({
                  event: chatEvent,
                  type: "chat.event",
                }),
              );
            },
          );
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result,
            }),
          );
          return;
        }
        case "engine.chat.cancel": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.cancelChat(parsed.data.params.runId),
            }),
          );
          return;
        }
        case "engine.chat.deleteThread": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.deleteChatThread(parsed.data.params.threadId),
            }),
          );
          return;
        }
        case "engine.chat.renameThread": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.renameChatThread(
                parsed.data.params.threadId,
                parsed.data.params.title,
              ),
            }),
          );
          return;
        }
        case "engine.memory.setThreadExclusion": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.setThreadMemoryExclusion(
                parsed.data.params.threadId,
                parsed.data.params.excluded,
              ),
            }),
          );
          return;
        }
        case "engine.chat.listFolders": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.listChatFolders(),
            }),
          );
          return;
        }
        case "engine.chat.createFolder": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.createChatFolder(parsed.data.params.name),
            }),
          );
          return;
        }
        case "engine.chat.renameFolder": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.renameChatFolder(
                parsed.data.params.folderId,
                parsed.data.params.name,
              ),
            }),
          );
          return;
        }
        case "engine.chat.deleteFolder": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.deleteChatFolder(parsed.data.params.folderId),
            }),
          );
          return;
        }
        case "engine.chat.moveThread": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.moveChatThread(
                parsed.data.params.threadId,
                parsed.data.params.folderId,
              ),
            }),
          );
          return;
        }
        case "engine.library.deleteDocument": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.deleteDocument(parsed.data.params.documentId),
            }),
          );
          return;
        }
        case "engine.library.getDocumentReview": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.getDocumentReview(parsed.data.params.documentId),
            }),
          );
          return;
        }
        case "engine.library.acknowledgeReview": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.acknowledgeDocumentReview(parsed.data.params.documentId),
            }),
          );
          return;
        }
        case "engine.library.replaceDocument": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.replaceDocument(
                parsed.data.params.documentId,
                parsed.data.params.path,
                { onProgress: postImportProgress, operationId: parsed.data.id },
              ),
            }),
          );
          return;
        }
        case "engine.library.reprocessDocument": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: await engine.reprocessDocument(parsed.data.params.documentId, {
                onProgress: postImportProgress,
                operationId: parsed.data.id,
              }),
            }),
          );
          return;
        }
        case "engine.models.pull": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.startModelPull(parsed.data.params.model, (pullEvent) => {
                process.parentPort.postMessage(
                  engineEventEnvelopeSchema.parse({
                    event: pullEvent,
                    type: "model.pull",
                  }),
                );
              }),
            }),
          );
          return;
        }
        case "engine.models.cancelPull": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.cancelModelPull(parsed.data.params.model),
            }),
          );
          return;
        }
        case "engine.evidence.get": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.getCitation(parsed.data.params.citationId),
            }),
          );
          return;
        }
        case "engine.source.getWindow": {
          if (!engine) throw new Error("The local library is not initialized.");
          process.parentPort.postMessage(
            engineResponseSchema.parse({
              id: parsed.data.id,
              ok: true,
              result: engine.getSourceWindow(
                parsed.data.params.chunkId,
                parsed.data.params.before,
                parsed.data.params.after,
              ),
            }),
          );
          return;
        }
      }
    } catch (error) {
      process.parentPort.postMessage(
        errorResponse(
          parsed.data.id,
          error instanceof EngineOperationError
            ? error.code
            : "ENGINE_OPERATION_FAILED",
          error instanceof Error ? error.message : "The local engine operation failed.",
        ),
      );
    }
  })();
});

process.on("exit", () => engine?.close());
