export const PRODUCT_NAME = "Knosys RAG";
export const MINIMUM_MEMORY_BYTES = 16 * 1024 ** 3;
export const MINIMUM_MACOS_MAJOR_VERSION = 15;

export const SUPPORTED_SOURCE_EXTENSIONS = [
  ".docx",
  ".epub",
  ".htm",
  ".html",
  ".markdown",
  ".md",
  ".pdf",
  ".txt",
] as const;

export const AVAILABLE_SOURCE_EXTENSIONS = [
  ".docx",
  ".epub",
  ".htm",
  ".html",
  ".markdown",
  ".md",
  ".pdf",
  ".txt",
] as const;

export const DOCUMENT_FORMATS = [
  "docx",
  "epub",
  "html",
  "markdown",
  "pdf",
  "text",
] as const;

export const DOCUMENT_STATUSES = [
  "processing",
  "ready",
  "ready-with-warnings",
  "failed",
] as const;

export const INGESTION_JOB_STATUSES = [
  "queued",
  "copying",
  "parsing",
  "chunking",
  "indexing",
  "completed",
  "duplicate",
  "interrupted",
  "failed",
  "cancelled",
] as const;

export const DOCUMENT_BLOCK_TYPES = [
  "heading",
  "paragraph",
  "list-item",
  "quote",
  "code",
  "table",
] as const;

export type SupportedSourceExtension =
  (typeof SUPPORTED_SOURCE_EXTENSIONS)[number];
export type AvailableSourceExtension =
  (typeof AVAILABLE_SOURCE_EXTENSIONS)[number];
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type IngestionJobStatus = (typeof INGESTION_JOB_STATUSES)[number];
export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

export interface SourceLocation {
  readonly endLine?: number;
  readonly fragment?: string;
  readonly pageNumber?: number;
  readonly sourcePath?: string;
  readonly startLine?: number;
}

export interface ParseDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity: "info" | "warning" | "error";
  readonly location?: SourceLocation;
}

export interface DocumentBlock {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly headingPath: readonly string[];
  readonly id: string;
  readonly level?: number;
  readonly location?: SourceLocation;
  readonly ordinal: number;
  readonly text: string;
  readonly type: DocumentBlockType;
}

export interface DocumentSection {
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly endBlockOrdinal: number | null;
  readonly ordinal: number;
  readonly startBlockOrdinal: number | null;
}

export interface NormalizedDocument {
  readonly blocks: readonly DocumentBlock[];
  readonly diagnostics: readonly ParseDiagnostic[];
  readonly format: DocumentFormat;
  readonly language: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly parserId: string;
  readonly parserVersion: string;
  readonly schemaVersion: 2;
  readonly sections: readonly DocumentSection[];
  readonly title: string;
}

export interface DocumentChunk {
  readonly approximateTokenCount: number;
  readonly content: string;
  readonly contentHash: string;
  readonly endBlockOrdinal: number;
  readonly headingPath: readonly string[];
  readonly id: string;
  readonly ordinal: number;
  readonly startBlockOrdinal: number;
}

export interface PlatformFacts {
  readonly architecture: string;
  readonly memoryBytes: number;
  readonly macosVersion: string;
  readonly platform: NodeJS.Platform;
}

export interface PlatformSupport {
  readonly architectureSupported: boolean;
  readonly macosSupported: boolean;
  readonly memorySupported: boolean;
  readonly supported: boolean;
}

export function isSupportedSourceFilename(filename: string): boolean {
  const normalized = filename.toLocaleLowerCase("en-US");
  return SUPPORTED_SOURCE_EXTENSIONS.some((extension) =>
    normalized.endsWith(extension),
  );
}

export function isAvailableSourceFilename(filename: string): boolean {
  const normalized = filename.toLocaleLowerCase("en-US");
  return AVAILABLE_SOURCE_EXTENSIONS.some((extension) =>
    normalized.endsWith(extension),
  );
}

export function documentFormatFromFilename(
  filename: string,
): DocumentFormat | null {
  const normalized = filename.toLocaleLowerCase("en-US");
  if (normalized.endsWith(".txt")) return "text";
  if (normalized.endsWith(".md") || normalized.endsWith(".markdown")) {
    return "markdown";
  }
  if (normalized.endsWith(".html") || normalized.endsWith(".htm")) {
    return "html";
  }
  if (normalized.endsWith(".docx")) return "docx";
  if (normalized.endsWith(".epub")) return "epub";
  if (normalized.endsWith(".pdf")) return "pdf";
  return null;
}

export function evaluatePlatformSupport(facts: PlatformFacts): PlatformSupport {
  const macosMajor = Number.parseInt(facts.macosVersion.split(".")[0] ?? "0", 10);
  const architectureSupported = facts.architecture === "arm64";
  const macosSupported =
    facts.platform === "darwin" && macosMajor >= MINIMUM_MACOS_MAJOR_VERSION;
  const memorySupported = facts.memoryBytes >= MINIMUM_MEMORY_BYTES;

  return {
    architectureSupported,
    macosSupported,
    memorySupported,
    supported: architectureSupported && macosSupported && memorySupported,
  };
}
