import { createHash, randomUUID } from "node:crypto";

import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentChunk,
  DocumentFormat,
  NormalizedDocument,
  ParseDiagnostic,
  SourceLocation,
} from "@knosys-rag/core";
import type { Root, RootContent } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toString } from "mdast-util-to-string";
import { parseHtmlText } from "./html.js";
import { parseDocxBytes } from "./docx.js";
import { parseEpubBytes } from "./epub.js";
import { parsePdfBytes, PdfParseError } from "./pdf.js";

const DOCUMENT_SCHEMA_VERSION = 2;
const PARSER_VERSION = "1.1.0";
const CHUNKER_VERSION = "structure-v1";
const MAX_TEXT_BYTES = 32 * 1024 * 1024;
const TARGET_CHUNK_CHARACTERS = 1_000;
const HARD_CHUNK_CHARACTERS = 1_300;
const CHUNK_OVERLAP_CHARACTERS = 120;

export class DocumentParseError extends Error {
  public readonly code: string;

  public constructor(code: string, message: string) {
    super(message);
    this.name = "DocumentParseError";
    this.code = code;
  }
}

function decodeUtf8(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_TEXT_BYTES) {
    throw new DocumentParseError(
      "TEXT_FILE_TOO_LARGE",
      "This text document is larger than the current 32 MB parser limit.",
    );
  }
  if (bytes.includes(0)) {
    throw new DocumentParseError(
      "BINARY_TEXT_REJECTED",
      "The selected text document contains binary NUL bytes.",
    );
  }

  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n?/g, "\n");
  } catch {
    throw new DocumentParseError(
      "INVALID_UTF8",
      "The selected document is not valid UTF-8 text.",
    );
  }
}

function locationFromLines(startLine?: number, endLine?: number): SourceLocation | undefined {
  if (startLine === undefined && endLine === undefined) return undefined;
  return {
    ...(endLine === undefined ? {} : { endLine }),
    ...(startLine === undefined ? {} : { startLine }),
  };
}

function createBlock(
  ordinal: number,
  type: DocumentBlockType,
  text: string,
  headingPath: readonly string[],
  options: {
    readonly attributes?: Readonly<Record<string, unknown>>;
    readonly level?: number;
    readonly location?: SourceLocation;
  } = {},
): DocumentBlock {
  return {
    attributes: options.attributes ?? {},
    headingPath: [...headingPath],
    id: randomUUID(),
    ...(options.level === undefined ? {} : { level: options.level }),
    ...(options.location === undefined ? {} : { location: options.location }),
    ordinal,
    text: text.trim(),
    type,
  };
}

function fallbackTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || filename;
}

function parseText(text: string, filename: string): NormalizedDocument {
  const blocks: DocumentBlock[] = [];
  const lines = text.split("\n");
  let paragraphStart = 0;
  let paragraph: string[] = [];

  const flushParagraph = (endLine: number) => {
    const content = paragraph.join("\n").trim();
    if (content) {
      const location = locationFromLines(paragraphStart + 1, endLine);
      blocks.push(
        createBlock(blocks.length, "paragraph", content, [], {
          ...(location === undefined ? {} : { location }),
        }),
      );
    }
    paragraph = [];
  };

  lines.forEach((line, index) => {
    if (!line.trim()) {
      flushParagraph(index);
      paragraphStart = index + 1;
      return;
    }
    if (paragraph.length === 0) paragraphStart = index;
    paragraph.push(line);
  });
  flushParagraph(lines.length);

  return {
    blocks,
    diagnostics: blocks.length
      ? []
      : [
          {
            code: "EMPTY_DOCUMENT",
            message: "The document contains no indexable text.",
            severity: "warning",
          },
        ],
    format: "text",
    language: null,
    metadata: {},
    parserId: "text",
    parserVersion: PARSER_VERSION,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    sections: [
      {
        attributes: {},
        endBlockOrdinal: blocks.length ? blocks.length - 1 : null,
        ordinal: 0,
        startBlockOrdinal: blocks.length ? 0 : null,
      },
    ],
    title: fallbackTitle(filename),
  };
}

function parseMarkdown(text: string, filename: string): NormalizedDocument {
  const tree: Root = fromMarkdown(text);
  const blocks: DocumentBlock[] = [];
  const diagnostics: ParseDiagnostic[] = [];
  const headingPath: string[] = [];

  const addNode = (node: RootContent, forcedType?: DocumentBlockType) => {
    const content = toString(node).trim();
    if (!content) return;
    const location = locationFromLines(
      node.position?.start.line,
      node.position?.end.line,
    );

    if (node.type === "heading") {
      headingPath.splice(node.depth - 1);
      headingPath[node.depth - 1] = content;
      blocks.push(
        createBlock(blocks.length, "heading", content, headingPath, {
          level: node.depth,
          ...(location === undefined ? {} : { location }),
        }),
      );
      return;
    }

    let type = forcedType ?? "paragraph";
    if (node.type === "code") type = "code";
    if (node.type === "blockquote") type = "quote";
    blocks.push(
      createBlock(blocks.length, type, content, headingPath, {
        attributes:
          node.type === "code" && node.lang ? { language: node.lang } : {},
        ...(location === undefined ? {} : { location }),
      }),
    );
  };

  for (const node of tree.children) {
    if (node.type === "html") {
      const location = locationFromLines(
        node.position?.start.line,
        node.position?.end.line,
      );
      diagnostics.push({
        code: "MARKDOWN_RAW_HTML_OMITTED",
        message: "Raw HTML was omitted from the normalized document.",
        severity: "warning",
        ...(location === undefined ? {} : { location }),
      });
      continue;
    }
    if (node.type === "thematicBreak") continue;
    if (node.type === "list") {
      node.children.forEach((item) => addNode(item, "list-item"));
      continue;
    }
    addNode(node);
  }

  const firstHeading = blocks.find((block) => block.type === "heading");
  return {
    blocks,
    diagnostics,
    format: "markdown",
    language: null,
    metadata: {},
    parserId: "markdown-mdast",
    parserVersion: PARSER_VERSION,
    schemaVersion: DOCUMENT_SCHEMA_VERSION,
    sections: [
      {
        attributes: {},
        endBlockOrdinal: blocks.length ? blocks.length - 1 : null,
        ordinal: 0,
        startBlockOrdinal: blocks.length ? 0 : null,
      },
    ],
    title: firstHeading?.text ?? fallbackTitle(filename),
  };
}

export async function parseDocumentBytes(
  bytes: Uint8Array,
  filename: string,
  format: DocumentFormat,
): Promise<NormalizedDocument> {
  switch (format) {
    case "text":
      return parseText(decodeUtf8(bytes), filename);
    case "markdown":
      return parseMarkdown(decodeUtf8(bytes), filename);
    case "html":
      return parseHtmlText(decodeUtf8(bytes), filename);
    case "docx":
      try {
        return await parseDocxBytes(bytes, filename);
      } catch (error) {
        throw new DocumentParseError(
          "DOCX_PARSE_FAILED",
          error instanceof Error ? error.message : "The DOCX document could not be parsed.",
        );
      }
    case "epub":
      try {
        return await parseEpubBytes(bytes, filename);
      } catch (error) {
        throw new DocumentParseError(
          "EPUB_PARSE_FAILED",
          error instanceof Error ? error.message : "The EPUB document could not be parsed.",
        );
      }
    case "pdf":
      try {
        return await parsePdfBytes(bytes, filename);
      } catch (error) {
        throw new DocumentParseError(
          error instanceof PdfParseError ? error.code : "PDF_PARSE_FAILED",
          error instanceof Error ? error.message : "The PDF document could not be parsed.",
        );
      }
    default:
      throw new DocumentParseError(
        "PARSER_NOT_AVAILABLE",
        `The ${String(format).toUpperCase()} parser is not available in this build.`,
      );
  }
}

function splitOversizedBlock(text: string): string[] {
  if (text.length <= HARD_CHUNK_CHARACTERS) return [text];
  const parts: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + TARGET_CHUNK_CHARACTERS, text.length);
    if (end < text.length) {
      const boundary = text.lastIndexOf(" ", end);
      if (boundary > cursor + TARGET_CHUNK_CHARACTERS / 2) end = boundary;
    }
    parts.push(text.slice(cursor, end).trim());
    if (end >= text.length) break;
    cursor = Math.max(end - CHUNK_OVERLAP_CHARACTERS, cursor + 1);
  }
  return parts.filter(Boolean);
}

export function chunkDocument(document: NormalizedDocument): readonly DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let currentContent: string[] = [];
  let currentStart = 0;
  let currentEnd = 0;
  let currentHeadingPath: readonly string[] = [];

  const emit = () => {
    const content = currentContent.join("\n\n").trim();
    if (!content) return;
    chunks.push({
      approximateTokenCount: Math.ceil(content.length / 4),
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      endBlockOrdinal: currentEnd,
      headingPath: [...currentHeadingPath],
      id: randomUUID(),
      ordinal: chunks.length,
      startBlockOrdinal: currentStart,
    });
    currentContent = [];
  };

  for (const block of document.blocks) {
    const parts = splitOversizedBlock(block.text);
    for (const part of parts) {
      const headingChanged =
        currentContent.length > 0 &&
        JSON.stringify(block.headingPath) !== JSON.stringify(currentHeadingPath);
      const wouldOverflow =
        currentContent.join("\n\n").length + part.length + 2 >
        TARGET_CHUNK_CHARACTERS;
      if (headingChanged || wouldOverflow) emit();
      if (currentContent.length === 0) {
        currentStart = block.ordinal;
        currentHeadingPath = block.headingPath;
      }
      currentContent.push(part);
      currentEnd = block.ordinal;
      if (part.length >= TARGET_CHUNK_CHARACTERS) emit();
    }
  }
  emit();
  return chunks;
}

export const ingestionVersions = {
  chunker: CHUNKER_VERSION,
  irSchema: DOCUMENT_SCHEMA_VERSION,
  parser: PARSER_VERSION,
} as const;
