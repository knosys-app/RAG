import { randomUUID } from "node:crypto";

import type { DocumentBlock, NormalizedDocument, ParseDiagnostic } from "@knosys-rag/core";

const MEBIBYTE = 1024 * 1024;
const MAX_PDF_BYTES = 256 * MEBIBYTE;
const MAX_PAGES = 10_000;
const MAX_TEXT_ITEMS = 2_000_000;
const MAX_EXTRACTED_CHARACTERS = 64 * MEBIBYTE;
const PARSE_TIMEOUT_MS = 120_000;
const PDFJS_VERSION = "6.2.108";

type PdfTextItem = {
  readonly hasEOL: boolean;
  readonly height: number;
  readonly str: string;
  readonly transform: readonly unknown[];
};

type ExtractedPdfPage = {
  readonly lines: readonly string[];
  readonly pageNumber: number;
};

export class PdfParseError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "PdfParseError";
    this.code = code;
  }
}

function fallbackTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || filename;
}

function isPdfTextItem(value: unknown): value is PdfTextItem {
  if (typeof value !== "object" || value === null) return false;
  return "str" in value && typeof value.str === "string";
}

function isUnsafeControlCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127;
}

function cleanText(value: string): string {
  return [...value].filter((character) => !isUnsafeControlCharacter(character)).join("").replace(/\s+/g, " ");
}

function itemY(item: PdfTextItem): number | null {
  const value = item.transform[5];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function appendText(line: string, text: string): string {
  const cleaned = cleanText(text);
  if (!cleaned) return line;
  if (!line) return cleaned.trim();
  if (/\s$/.test(line) || /^\s|^[,.;:!?%)\]}]/.test(cleaned) || /[([{]$/.test(line)) {
    return `${line}${cleaned}`.trim();
  }
  return `${line} ${cleaned}`;
}

function textLines(items: readonly unknown[]): {
  readonly controlCharacters: number;
  readonly lines: readonly string[];
  readonly replacementCharacters: number;
} {
  const lines: string[] = [];
  let controlCharacters = 0;
  let line = "";
  let previous: PdfTextItem | null = null;
  let replacementCharacters = 0;

  const flush = () => {
    const value = line.trim();
    if (value) lines.push(value);
    line = "";
  };

  for (const value of items) {
    if (!isPdfTextItem(value)) continue;
    controlCharacters += [...value.str].filter(isUnsafeControlCharacter).length;
    replacementCharacters += value.str.match(/\uFFFD/g)?.length ?? 0;
    const currentY = itemY(value);
    const previousY = previous === null ? null : itemY(previous);
    const changedLine =
      previous !== null &&
      previousY !== null &&
      currentY !== null &&
      Math.abs(previousY - currentY) > Math.max(3, Math.min(previous.height, value.height) * 0.6);
    if (changedLine) flush();
    line = appendText(line, value.str);
    if (value.hasEOL) flush();
    previous = value;
  }
  flush();
  return { controlCharacters, lines, replacementCharacters };
}

function normalizedMarginLine(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
}

function repeatedMargins(pages: readonly ExtractedPdfPage[]): {
  readonly footers: ReadonlySet<string>;
  readonly headers: ReadonlySet<string>;
} {
  const textPages = pages.filter((page) => page.lines.length > 0);
  if (textPages.length < 3) return { footers: new Set(), headers: new Set() };
  const threshold = Math.max(3, Math.ceil(textPages.length / 2));
  const count = (values: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return new Set(
      [...counts.entries()]
        .filter(([value, occurrences]) => value.length > 0 && occurrences >= threshold)
        .map(([value]) => value),
    );
  };
  return {
    footers: count(textPages.map((page) => normalizedMarginLine(page.lines.at(-1) ?? ""))),
    headers: count(textPages.map((page) => normalizedMarginLine(page.lines[0] ?? ""))),
  };
}

function extractionDiagnostics(options: {
  readonly controlCharacters: number;
  readonly extractedCharacters: number;
  readonly omittedMarginLines: number;
  readonly pages: readonly ExtractedPdfPage[];
  readonly pagesWithoutText: number;
  readonly replacementCharacters: number;
}): readonly ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  if (options.pagesWithoutText > 0) {
    diagnostics.push({
      code: "PDF_PAGES_REQUIRE_OCR",
      message: `${options.pagesWithoutText} of ${options.pages.length} pages contain no selectable text and were not indexed.`,
      severity: "warning",
    });
  }
  if (options.omittedMarginLines > 0) {
    diagnostics.push({
      code: "PDF_REPEATED_MARGINS_OMITTED",
      message: `${options.omittedMarginLines} repeated header or footer lines were omitted from the index.`,
      severity: "info",
    });
  }

  const textPages = options.pages.filter((page) => page.lines.length > 0);
  const lowDensityPages = textPages.filter(
    (page) => page.lines.reduce((total, line) => total + line.length, 0) < 40,
  ).length;
  if (textPages.length >= 3 && lowDensityPages / textPages.length >= 0.5) {
    diagnostics.push({
      code: "PDF_LOW_TEXT_DENSITY",
      message: `${lowDensityPages} of ${textPages.length} text pages contain very little selectable text. Review the extraction before relying on it.`,
      severity: "warning",
    });
  }

  const suspiciousCharacterCount = options.controlCharacters + options.replacementCharacters;
  if (
    suspiciousCharacterCount >= 10 &&
    suspiciousCharacterCount / Math.max(options.extractedCharacters, 1) >= 0.005
  ) {
    diagnostics.push({
      code: "PDF_SUSPICIOUS_CHARACTERS",
      message: "The extracted text contains an unusual number of invalid or control characters.",
      severity: "warning",
    });
  }

  const lines = textPages.flatMap((page) => page.lines);
  const garbledLines = lines.filter((line) => {
    if (line.length < 12) return false;
    const readableCharacters = line.match(/[\p{L}\p{N}\s.,;:!?()'"%/-]/gu)?.length ?? 0;
    return readableCharacters / line.length < 0.6;
  }).length;
  if (garbledLines >= 5 && garbledLines / Math.max(lines.length, 1) >= 0.1) {
    diagnostics.push({
      code: "PDF_LOW_QUALITY_TEXT",
      message: `${garbledLines} extracted lines appear garbled. Review the source before relying on indexed passages.`,
      severity: "warning",
    });
  }
  return diagnostics;
}

function stringProperty(value: unknown, key: string): string | null {
  if (typeof value !== "object" || value === null || !(key in value)) return null;
  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" && property.trim() ? property.trim() : null;
}

function assertPdfHeader(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new PdfParseError(
      "PDF_FILE_TOO_LARGE",
      "This PDF is larger than the current 256 MiB parser limit.",
    );
  }
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, Math.min(bytes.byteLength, 1024)));
  if (!header.includes("%PDF-")) {
    throw new PdfParseError("PDF_INVALID_HEADER", "The selected file does not contain a PDF header.");
  }
}

async function loadPdfJs() {
  if (!("DOMMatrix" in globalThis) || !("Path2D" in globalThis)) {
    const canvas = await import("@napi-rs/canvas");
    if (!("DOMMatrix" in globalThis)) {
      Object.defineProperty(globalThis, "DOMMatrix", { value: canvas.DOMMatrix });
    }
    if (!("Path2D" in globalThis)) {
      Object.defineProperty(globalThis, "Path2D", { value: canvas.Path2D });
    }
  }
  const pdfJs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfJs.GlobalWorkerOptions.workerSrc = import.meta.resolve(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
  );
  return pdfJs;
}

export async function parsePdfBytes(
  bytes: Uint8Array,
  filename: string,
): Promise<NormalizedDocument> {
  assertPdfHeader(bytes);
  const { getDocument, VerbosityLevel } = await loadPdfJs();
  const loadingTask = getDocument({
    data: Uint8Array.from(bytes),
    disableFontFace: true,
    enableXfa: false,
    isImageDecoderSupported: false,
    isOffscreenCanvasSupported: false,
    maxImageSize: 16 * MEBIBYTE,
    stopAtErrors: true,
    useSystemFonts: false,
    useWasm: false,
    useWorkerFetch: false,
    verbosity: VerbosityLevel.ERRORS,
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    void loadingTask.destroy();
  }, PARSE_TIMEOUT_MS);

  try {
    const pdf = await loadingTask.promise;
    if (pdf.numPages > MAX_PAGES) {
      throw new PdfParseError(
        "PDF_TOO_MANY_PAGES",
        `This PDF has ${pdf.numPages.toLocaleString()} pages, exceeding the ${MAX_PAGES.toLocaleString()}-page limit.`,
      );
    }

    const pages: ExtractedPdfPage[] = [];
    let controlCharacters = 0;
    let extractedCharacters = 0;
    let replacementCharacters = 0;
    let textItemCount = 0;
    let pagesWithoutText = 0;

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      try {
        const textContent = await page.getTextContent();
        textItemCount += textContent.items.length;
        if (textItemCount > MAX_TEXT_ITEMS) {
          throw new PdfParseError(
            "PDF_TEXT_TOO_COMPLEX",
            "The PDF contains too many individual text elements to index safely.",
          );
        }
        const extracted = textLines(textContent.items);
        controlCharacters += extracted.controlCharacters;
        replacementCharacters += extracted.replacementCharacters;
        extractedCharacters += extracted.lines.reduce((total, line) => total + line.length, 0);
        if (extractedCharacters > MAX_EXTRACTED_CHARACTERS) {
          throw new PdfParseError(
            "PDF_TEXT_TOO_LARGE",
            "The PDF expands beyond the 64 MiB extracted-text limit.",
          );
        }
        pages.push({ lines: extracted.lines, pageNumber });
      } finally {
        page.cleanup();
      }

      if (pages.at(-1)?.lines.length === 0) pagesWithoutText += 1;
    }

    if (pagesWithoutText === pages.length) {
      throw new PdfParseError(
        "PDF_OCR_REQUIRED",
        "This PDF has no selectable text. OCR is required before it can be indexed.",
      );
    }

    const margins = repeatedMargins(pages);
    const blocks: DocumentBlock[] = [];
    const sections: NormalizedDocument["sections"][number][] = [];
    let omittedMarginLines = 0;
    for (const page of pages) {
      const startBlockOrdinal = blocks.length;
      page.lines.forEach((text, index) => {
        const normalized = normalizedMarginLine(text);
        const repeatedHeader = index === 0 && margins.headers.has(normalized);
        const repeatedFooter = index === page.lines.length - 1 && margins.footers.has(normalized);
        if (repeatedHeader || repeatedFooter) {
          omittedMarginLines += 1;
          return;
        }
        blocks.push({
          attributes: {},
          headingPath: [],
          id: randomUUID(),
          location: { pageNumber: page.pageNumber },
          ordinal: blocks.length,
          text,
          type: "paragraph",
        });
      });
      sections.push({
        attributes: { pageNumber: page.pageNumber },
        endBlockOrdinal: blocks.length === startBlockOrdinal ? null : blocks.length - 1,
        ordinal: sections.length,
        startBlockOrdinal: blocks.length === startBlockOrdinal ? null : startBlockOrdinal,
      });
    }

    if (blocks.length === 0) {
      throw new PdfParseError(
        "PDF_NO_INDEXABLE_TEXT",
        "The PDF contains selectable text, but none remained after extraction cleanup.",
      );
    }

    const metadataResult = await pdf.getMetadata().catch(() => null);
    const title = stringProperty(metadataResult?.info, "Title") ?? fallbackTitle(filename);
    const author = stringProperty(metadataResult?.info, "Author");
    const diagnostics = extractionDiagnostics({
      controlCharacters,
      extractedCharacters,
      omittedMarginLines,
      pages,
      pagesWithoutText,
      replacementCharacters,
    });

    return {
      blocks,
      diagnostics,
      format: "pdf",
      language: null,
      metadata: {
        ...(author === null ? {} : { creators: [author] }),
        pageCount: pdf.numPages,
      },
      parserId: "pdfjs-native-text",
      parserVersion: PDFJS_VERSION,
      schemaVersion: 2,
      sections,
      title,
    };
  } catch (error) {
    if (error instanceof PdfParseError) throw error;
    if (timedOut) {
      throw new PdfParseError(
        "PDF_PARSE_TIMEOUT",
        "PDF extraction exceeded the two-minute processing limit.",
      );
    }
    if (error instanceof Error && error.name === "PasswordException") {
      throw new PdfParseError(
        "PDF_PASSWORD_REQUIRED",
        "This PDF is password protected and cannot be indexed without a password.",
      );
    }
    throw new PdfParseError(
      "PDF_PARSE_FAILED",
      error instanceof Error ? error.message : "The PDF document could not be parsed.",
    );
  } finally {
    clearTimeout(timeout);
    await loadingTask.destroy();
  }
}
