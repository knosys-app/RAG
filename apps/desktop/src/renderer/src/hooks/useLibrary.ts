import type {
  DocumentReview,
  ImportBatchResult,
  ImportProgressEvent,
  ImportSelectionResult,
  LibrarySnapshot,
} from "@knosys-rag/contracts";
import { startTransition, useCallback, useEffect, useState } from "react";

import { describeError } from "@/lib/errors";

export type LibraryLoadState =
  | { readonly state: "loading" }
  | { readonly state: "ready"; readonly snapshot: LibrarySnapshot }
  | { readonly state: "error"; readonly message: string };

const EMPTY_LIBRARY: LibrarySnapshot = { documents: [], jobs: [] };

function resultMessage(result: ImportSelectionResult): string | null {
  if (result.cancelled || !result.batch) return null;
  const parts = [
    result.batch.imported ? `${result.batch.imported} imported` : null,
    result.batch.reprocessed ? `${result.batch.reprocessed} reprocessed` : null,
    result.batch.duplicates ? `${result.batch.duplicates} duplicate` : null,
    result.batch.failed ? `${result.batch.failed} failed` : null,
    result.batch.unsupported ? `${result.batch.unsupported} unsupported` : null,
  ].filter(Boolean);
  return parts.join(" · ") || "No available sources were found.";
}

export interface UseLibrary {
  /** Resolves to an error message, or null on success. */
  readonly acknowledgeReview: (documentId: string) => Promise<string | null>;
  readonly activeJobCount: number;
  readonly clearOperationError: () => void;
  /** Resolves to an error message, or null on success. */
  readonly deleteDocument: (documentId: string) => Promise<string | null>;
  /** Fetches a document's parse diagnostics for the review wizard. */
  readonly getDocumentReview: (documentId: string) => Promise<DocumentReview>;
  readonly importing: "directory" | "files" | null;
  readonly importOutcomes: ImportBatchResult["items"];
  readonly importProgress: ImportProgressEvent | null;
  readonly importSources: (kind: "directory" | "files") => Promise<void>;
  readonly libraryState: LibraryLoadState;
  readonly operationError: string | null;
  readonly operationMessage: string | null;
  readonly reload: () => Promise<void>;
  /**
   * Opens a native picker to choose a replacement source, deletes the original,
   * and imports the replacement. Resolves to an error message, or null on
   * success or cancellation.
   */
  readonly replaceDocument: (documentId: string) => Promise<string | null>;
  /**
   * Re-ingests an already-imported document from its stored managed copy.
   * Resolves to an error message, or null on success.
   */
  readonly reprocessDocument: (documentId: string) => Promise<string | null>;
  readonly snapshot: LibrarySnapshot;
  readonly sourceCount: number;
}

export function useLibrary(options?: {
  readonly onImportCompleted?: () => void;
}): UseLibrary {
  const [libraryState, setLibraryState] = useState<LibraryLoadState>({
    state: "loading",
  });
  const [importing, setImporting] = useState<"directory" | "files" | null>(null);
  const [operationMessage, setOperationMessage] = useState<string | null>(null);
  const [importOutcomes, setImportOutcomes] = useState<ImportBatchResult["items"]>([]);
  const [importProgress, setImportProgress] = useState<ImportProgressEvent | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const onImportCompleted = options?.onImportCompleted;

  const reload = useCallback(async () => {
    try {
      const snapshot = await window.knosys.library.getSnapshot();
      startTransition(() => {
        setLibraryState({ snapshot, state: "ready" });
      });
    } catch (error) {
      setLibraryState({
        message: describeError(error, "The local library could not be opened."),
        state: "error",
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => window.knosys.library.onImportProgress(setImportProgress), []);

  const importSources = useCallback(
    async (kind: "directory" | "files") => {
      setImporting(kind);
      setOperationError(null);
      setOperationMessage(null);
      setImportOutcomes([]);
      setImportProgress(null);
      try {
        const result =
          kind === "files"
            ? await window.knosys.library.importFiles()
            : await window.knosys.library.importDirectory();
        const message = resultMessage(result);
        if (message) setOperationMessage(message);
        if (result.batch) {
          setImportOutcomes(result.batch.items);
          setLibraryState({ snapshot: result.batch.snapshot, state: "ready" });
          onImportCompleted?.();
        }
      } catch (error) {
        setOperationError(
          describeError(error, "The selected sources could not be imported."),
        );
        await reload();
      } finally {
        setImporting(null);
        setImportProgress(null);
      }
    },
    [onImportCompleted, reload],
  );

  const deleteDocument = useCallback(
    async (documentId: string): Promise<string | null> => {
      try {
        const result = await window.knosys.library.deleteDocument(documentId);
        setLibraryState({ snapshot: result.snapshot, state: "ready" });
        return null;
      } catch (error) {
        return describeError(error, "The source could not be deleted.");
      }
    },
    [],
  );

  const getDocumentReview = useCallback(
    (documentId: string): Promise<DocumentReview> =>
      window.knosys.library.getDocumentReview(documentId),
    [],
  );

  const acknowledgeReview = useCallback(
    async (documentId: string): Promise<string | null> => {
      try {
        const snapshot = await window.knosys.library.acknowledgeReview(documentId);
        setLibraryState({ snapshot, state: "ready" });
        return null;
      } catch (error) {
        return describeError(error, "The review could not be completed.");
      }
    },
    [],
  );

  const replaceDocument = useCallback(
    async (documentId: string): Promise<string | null> => {
      setOperationError(null);
      setOperationMessage(null);
      setImportOutcomes([]);
      setImportProgress(null);
      try {
        const result = await window.knosys.library.replaceDocument(documentId);
        if (result.cancelled || !result.batch) return null;
        const message = resultMessage(result);
        if (message) setOperationMessage(message);
        setImportOutcomes(result.batch.items);
        setLibraryState({ snapshot: result.batch.snapshot, state: "ready" });
        onImportCompleted?.();
        return null;
      } catch (error) {
        const message = describeError(
          error,
          "The source could not be replaced.",
        );
        setOperationError(message);
        await reload();
        return message;
      } finally {
        setImportProgress(null);
      }
    },
    [onImportCompleted, reload],
  );

  const reprocessDocument = useCallback(
    async (documentId: string): Promise<string | null> => {
      try {
        const snapshot = await window.knosys.library.reprocessDocument(documentId);
        setLibraryState({ snapshot, state: "ready" });
        return null;
      } catch (error) {
        return describeError(error, "The document could not be reprocessed.");
      }
    },
    [],
  );

  const clearOperationError = useCallback(() => {
    setOperationError(null);
  }, []);

  const snapshot = libraryState.state === "ready" ? libraryState.snapshot : EMPTY_LIBRARY;
  const activeJobCount = snapshot.jobs.filter((job) =>
    ["queued", "copying", "parsing", "chunking", "indexing"].includes(job.status),
  ).length;

  return {
    acknowledgeReview,
    activeJobCount,
    clearOperationError,
    deleteDocument,
    getDocumentReview,
    importing,
    importOutcomes,
    importProgress,
    importSources,
    libraryState,
    operationError,
    operationMessage,
    reload,
    replaceDocument,
    reprocessDocument,
    snapshot,
    sourceCount: snapshot.documents.length,
  };
}
