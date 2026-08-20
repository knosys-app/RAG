import type {
  DocumentSummary,
  ImportBatchResult,
  ImportProgressEvent,
  SystemStatus,
} from "@knosys-rag/contracts";

export function documentStatusLabel(document: DocumentSummary): string {
  switch (document.status) {
    case "processing":
      return "Processing";
    case "ready":
      return "Ready";
    case "ready-with-warnings":
      return "Review warning";
    case "failed":
      return "Failed";
  }
}

export function importOutcomeLabel(
  status: ImportBatchResult["items"][number]["status"],
): string {
  switch (status) {
    case "imported":
      return "Imported";
    case "reprocessed":
      return "Reprocessed";
    case "duplicate":
      return "Already indexed";
    case "unsupported":
      return "Unsupported";
    case "failed":
      return "Failed";
  }
}

export function importStageLabel(stage: ImportProgressEvent["stage"]): string {
  switch (stage) {
    case "discovering":
      return "Scanning folder";
    case "checking":
      return "Checking source";
    case "copying":
      return "Copying into managed storage";
    case "parsing":
      return "Extracting document text";
    case "chunking":
      return "Preparing searchable passages";
    case "indexing":
      return "Saving the local text index";
    case "completed":
      return "Import complete";
  }
}

export function describeOllama(status: SystemStatus["ollama"]): string {
  if (status.state === "ready") {
    const modelCount = status.models.length;
    return modelCount === 1 ? "1 local model found" : `${modelCount} local models found`;
  }
  switch (status.reason) {
    case "not-installed":
      return "Ollama is not installed";
    case "not-running":
      return "Ollama is installed but not running";
    case "unexpected-response":
      return "Ollama returned an unexpected response";
  }
}
