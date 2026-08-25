import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import type { NormalizedDocument } from "@knosys-rag/core";
import { parseDocumentBytes } from "@knosys-rag/ingestion";

export interface EngineExtraction {
  readonly document: NormalizedDocument | null;
  readonly error: { readonly code: string; readonly message: string } | null;
}

export async function extractWithEngine(path: string): Promise<EngineExtraction> {
  try {
    const bytes = await readFile(path);
    const document = await parseDocumentBytes(new Uint8Array(bytes), basename(path), "pdf");
    return { document, error: null };
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
        ? error.code
        : "UNKNOWN";
    return {
      document: null,
      error: { code, message: error instanceof Error ? error.message : String(error) },
    };
  }
}
