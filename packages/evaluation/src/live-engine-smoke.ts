import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { KnowledgeEngine } from "@knosys-rag/engine";
import {
  OllamaAdapter,
} from "@knosys-rag/inference";
import * as sqliteVec from "sqlite-vec";

const root = await mkdtemp(join(tmpdir(), "knosys-live-smoke-"));
const provider = new OllamaAdapter();
const dataRoot = join(root, "app-data");
let engine = new KnowledgeEngine(dataRoot, sqliteVec.getLoadablePath(), {
  embeddingProvider: provider,
  modelProvider: provider,
});

try {
  const initialStatus = await engine.initializeRag();
  const selectedStatus = initialStatus;
  const sourceRoot = join(import.meta.dirname, "..", "fixtures", "sources");
  const imported = await engine.importPaths([
    join(sourceRoot, "irrigation-guide.txt"),
    join(sourceRoot, "soil-health-notes.md"),
  ]);

  const timeoutAt = Date.now() + 120_000;
  while (engine.getRagStatus().embedding.coverage?.ratio !== 1) {
    if (Date.now() > timeoutAt) throw new Error("Embedding backfill timed out.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const semantic = await engine.retrieve(
    "What improves the structure of earth and limits it from washing away?",
    "hybrid",
    5,
  );
  const exact = await engine.retrieve(
    "tomato irrigation 25 millimetres fruiting",
    "hybrid",
    5,
  );

  const events = await new Promise<Parameters<Parameters<typeof engine.startChat>[1]>[0][]>(
    (resolve, reject) => {
      const received: Parameters<Parameters<typeof engine.startChat>[1]>[0][] = [];
      const timeout = setTimeout(
        () => reject(new Error("Live grounded-answer smoke test timed out.")),
        600_000,
      );
      void engine
        .startChat(
          {
            question:
              "According to the imported notes, how much water should tomatoes receive each week while fruiting?",
          },
          (event) => {
            received.push(event);
            if (["cancelled", "completed", "failed"].includes(event.kind)) {
              clearTimeout(timeout);
              resolve(received);
            }
          },
        )
        .catch((error: unknown) => {
          clearTimeout(timeout);
          reject(error);
        });
    },
  );
  const terminal = events.at(-1);
  if (terminal?.kind !== "completed") {
    throw new Error(
      terminal?.kind === "failed"
        ? `${terminal.message.errorCode}: ${terminal.message.errorMessage}`
        : "Gemma did not complete a grounded answer.",
    );
  }
  const citation = terminal.message.citations[0];
  if (!citation) throw new Error("Gemma completed without a citation snapshot.");
  const citationSnapshot = engine.getCitation(citation.id);
  const threadId = terminal.message.threadId;

  engine.close();
  engine = new KnowledgeEngine(dataRoot, sqliteVec.getLoadablePath(), {
    embeddingProvider: provider,
    modelProvider: provider,
  });
  const reopenedThread = engine.getChatThread(threadId);
  const persistedMessage = reopenedThread.messages.at(-1);

  console.log(
    JSON.stringify(
      {
        embedding: {
          coverage: engine.getRagStatus().embedding.coverage,
          digest: initialStatus.embedding.model.digest,
          dimensions: engine.getRagStatus().embedding.profile?.dimensions,
          installed: initialStatus.embedding.model.installed,
        },
        generation: selectedStatus.generation.selected,
        groundedAnswer: {
          citationCount: terminal.message.citations.length,
          citationText: citationSnapshot.text,
          content: terminal.message.content,
          eventKinds: events.map(({ kind }) => kind),
          persistedAfterReopen:
            persistedMessage?.id === terminal.message.id &&
            persistedMessage.content === terminal.message.content,
          status: terminal.message.status,
        },
        imported: {
          failed: imported.failed,
          imported: imported.imported,
        },
        retrieval: {
          exact: {
            components: exact.candidates[0]?.components.map(({ component }) => component),
            mode: exact.trace.mode,
            text: exact.candidates[0]?.evidence.text,
          },
          semantic: {
            components: semantic.candidates[0]?.components.map(({ component }) => component),
            mode: semantic.trace.mode,
            text: semantic.candidates[0]?.evidence.text,
          },
        },
      },
      null,
      2,
    ),
  );
} finally {
  engine.close();
  await rm(root, { force: true, recursive: true });
}
