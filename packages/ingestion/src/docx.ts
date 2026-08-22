import { randomUUID } from "node:crypto";

import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentSection,
  NormalizedDocument,
  ParseDiagnostic,
} from "@knosys-rag/core";
import { parseDocx } from "@stll/folio-core/docx/parser";
import type {
  BlockContent,
  Document as FolioDocument,
  Paragraph,
  ParagraphContent,
  Run,
  RunContent,
  SectionProperties,
  Table,
} from "@stll/folio-core/types/document";

const MEBIBYTE = 1024 * 1024;

// Footnote/endnote shape from folio's package (only the fields we index). Real
// notes carry block content; separator/continuation notes (ids -1/0) do not.
interface FolioNote {
  readonly content: readonly BlockContent[];
  readonly noteType?: string;
}

function fallbackTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || filename;
}

function runText(run: Run): string {
  return run.content.map(runContentText).join("");
}

function runContentText(content: RunContent): string {
  switch (content.type) {
    case "text":
      return content.text;
    case "tab":
      return "\t";
    case "break":
      return "\n";
    case "symbol":
      return content.char;
    case "softHyphen":
      return "\u00ad";
    case "noBreakHyphen":
      return "\u2011";
    case "shape":
      return content.shape.textBody?.content.map(blockText).join(" ") ?? "";
    default:
      return "";
  }
}

function paragraphContentText(content: ParagraphContent): string {
  switch (content.type) {
    case "run":
      return runText(content);
    case "hyperlink":
      return content.children.map((child) => (child.type === "run" ? runText(child) : "")).join("");
    case "simpleField":
      return content.content.map((child) =>
        child.type === "run"
          ? runText(child)
          : child.children.map((nested) => (nested.type === "run" ? runText(nested) : "")).join(""),
      ).join("");
    case "complexField":
      return content.fieldResult.map(runText).join("");
    case "inlineSdt":
      return content.content.map(paragraphContentText).join("");
    case "insertion":
    case "moveTo":
      return content.content.map((child) =>
        child.type === "run"
          ? runText(child)
          : child.children.map((nested) => (nested.type === "run" ? runText(nested) : "")).join(""),
      ).join("");
    case "mathEquation":
      return content.plainText ?? "";
    default:
      return "";
  }
}

function paragraphText(paragraph: Paragraph): string {
  return paragraph.content.map(paragraphContentText).join("").replace(/[ \t]+\n/g, "\n").trim();
}

function tableRows(table: Table): readonly (readonly string[])[] {
  return table.rows.map((row) =>
    row.cells.map((cell) => cell.content.map(blockText).join("\n").trim()),
  );
}

function blockText(block: BlockContent): string {
  switch (block.type) {
    case "paragraph":
      return paragraphText(block);
    case "table":
      return tableRows(block).map((row) => row.join(" | ")).join("\n");
    case "blockSdt":
      return block.content.map(blockText).join("\n");
  }
}

function sectionAttributes(properties: SectionProperties): Readonly<Record<string, unknown>> {
  return {
    ...(properties.columnCount === undefined ? {} : { columnCount: properties.columnCount }),
    ...(properties.orientation === undefined ? {} : { orientation: properties.orientation }),
    ...(properties.pageHeight === undefined ? {} : { pageHeight: properties.pageHeight }),
    ...(properties.pageWidth === undefined ? {} : { pageWidth: properties.pageWidth }),
    ...(properties.sectionStart === undefined ? {} : { sectionStart: properties.sectionStart }),
  };
}

function metadataFromDocument(document: FolioDocument): Readonly<Record<string, unknown>> {
  const properties = document.package.properties;
  if (!properties) return {};
  return {
    ...(properties.created ? { created: properties.created.toISOString() } : {}),
    ...(properties.creator ? { creators: [properties.creator] } : {}),
    ...(properties.description ? { description: properties.description } : {}),
    ...(properties.keywords ? { keywords: properties.keywords } : {}),
    ...(properties.lastModifiedBy ? { lastModifiedBy: properties.lastModifiedBy } : {}),
    ...(properties.modified ? { modified: properties.modified.toISOString() } : {}),
    ...(properties.revision === undefined ? {} : { revision: properties.revision }),
    ...(properties.subject ? { subject: properties.subject } : {}),
    ...(properties.title ? { title: properties.title } : {}),
  };
}

function paragraphLevel(document: FolioDocument, paragraph: Paragraph): number | null {
  const outlineLevel = paragraph.formatting?.outlineLevel;
  if (outlineLevel !== undefined && outlineLevel >= 0 && outlineLevel <= 5) {
    return outlineLevel + 1;
  }
  const styleId = paragraph.formatting?.styleId;
  if (!styleId) return null;
  const style = document.package.styles?.styles.find((entry) => entry.styleId === styleId);
  const styleOutline = style?.pPr?.outlineLevel;
  if (styleOutline !== undefined && styleOutline >= 0 && styleOutline <= 5) {
    return styleOutline + 1;
  }
  const headingMatch = /^heading\s*([1-6])$/i.exec(style?.name ?? styleId);
  return headingMatch ? Number.parseInt(headingMatch[1] ?? "1", 10) : null;
}

export async function parseDocxBytes(
  bytes: Uint8Array,
  filename: string,
): Promise<NormalizedDocument> {
  let parsed: FolioDocument;
  try {
    parsed = await parseDocx(Uint8Array.from(bytes).buffer, {
      detectVariables: false,
      parseHeadersFooters: false,
      // Parse footnotes/endnotes so their references resolve (avoiding false
      // "missing note" validation warnings) and their text can be indexed.
      // Headers/footers stay off: their references are filtered below, and their
      // text is repeated boilerplate not worth indexing.
      parseNotes: true,
      preloadFonts: false,
      unzipLimits: {
        allowedMediaMimeTypes: [],
        maxFiles: 2_000,
        maxFontBytes: 0,
        maxInputBytes: 32 * MEBIBYTE,
        maxMediaBytes: 0,
        maxTotalUncompressedBytes: 96 * MEBIBYTE,
        maxXmlBytes: 64 * MEBIBYTE,
      },
    });
  } catch (error) {
    throw new Error(
      `The DOCX document could not be parsed: ${error instanceof Error ? error.message : "Unknown parser failure."}`,
      { cause: error },
    );
  }

  const blocks: DocumentBlock[] = [];
  const sections: DocumentSection[] = [];
  const headingPath: string[] = [];
  let sectionOrdinal = 0;
  let sectionStart = 0;
  // Which package part the blocks being emitted come from. The body is
  // word/document.xml; footnote/endnote passes switch this for provenance.
  let currentSourcePath = "word/document.xml";

  const addBlock = (
    type: DocumentBlockType,
    text: string,
    attributes: Readonly<Record<string, unknown>>,
    options: { readonly fragment?: string; readonly level?: number } = {},
  ) => {
    if (!text.trim()) return;
    blocks.push({
      attributes: { sectionOrdinal, ...attributes },
      headingPath: headingPath.filter(Boolean),
      id: randomUUID(),
      ...(options.level === undefined ? {} : { level: options.level }),
      location: {
        fragment: options.fragment ?? `block-${blocks.length}`,
        sourcePath: currentSourcePath,
      },
      ordinal: blocks.length,
      text: text.trim(),
      type,
    });
  };

  const closeSection = (properties: SectionProperties = {}) => {
    sections.push({
      attributes: sectionAttributes(properties),
      endBlockOrdinal: blocks.length > sectionStart ? blocks.length - 1 : null,
      ordinal: sectionOrdinal,
      startBlockOrdinal: blocks.length > sectionStart ? sectionStart : null,
    });
    sectionOrdinal += 1;
    sectionStart = blocks.length;
  };

  const visit = (content: readonly BlockContent[]) => {
    for (const block of content) {
      if (block.type === "blockSdt") {
        visit(block.content);
        continue;
      }
      if (block.type === "table") {
        const rows = tableRows(block);
        addBlock(
          "table",
          rows.map((row) => row.join(" | ")).join("\n"),
          {
            columnWidths: block.columnWidths ?? [],
            headerRow: block.rows[0]?.formatting?.header ?? false,
            rows,
            spans: block.rows.map((row) =>
              row.cells.map((cell) => ({
                columnSpan: cell.formatting?.gridSpan ?? 1,
                verticalMerge: cell.formatting?.vMerge ?? null,
              })),
            ),
          },
        );
        continue;
      }

      const text = paragraphText(block);
      const level = paragraphLevel(parsed, block);
      if (level !== null && text) {
        headingPath.splice(level - 1);
        headingPath[level - 1] = text;
        addBlock("heading", text, { styleId: block.formatting?.styleId ?? null }, {
          ...(block.paraId ? { fragment: block.paraId } : {}),
          level,
        });
      } else if (block.listRendering && text) {
        addBlock(
          "list-item",
          text,
          {
            depth: block.listRendering.level + 1,
            marker: block.listRendering.marker,
            numberFormat: block.listRendering.numFmt ?? null,
            ordered: !block.listRendering.isBullet,
          },
          block.paraId ? { fragment: block.paraId } : {},
        );
      } else {
        addBlock(
          "paragraph",
          text,
          { styleId: block.formatting?.styleId ?? null },
          block.paraId ? { fragment: block.paraId } : {},
        );
      }

      if (block.sectionProperties) closeSection(block.sectionProperties);
    }
  };

  visit(parsed.package.document.content);
  if (sections.length === 0 || sectionStart < blocks.length) {
    closeSection(parsed.package.document.finalSectionProperties);
  }

  // Footnotes/endnotes carry real content (citations, asides) that the body
  // only references. Index them as a trailing section so they are searchable.
  // Folio already excludes the separator/continuation notes (ids -1/0).
  const notePackage = parsed.package as {
    readonly endnotes?: readonly FolioNote[];
    readonly footnotes?: readonly FolioNote[];
  };
  const noteGroups: readonly { readonly label: string; readonly notes: readonly FolioNote[]; readonly sourcePath: string }[] = [
    { label: "Footnotes", notes: notePackage.footnotes ?? [], sourcePath: "word/footnotes.xml" },
    { label: "Endnotes", notes: notePackage.endnotes ?? [], sourcePath: "word/endnotes.xml" },
  ];
  for (const group of noteGroups) {
    const contentNotes = group.notes.filter(
      (note) =>
        note.noteType !== "separator" &&
        note.noteType !== "continuationSeparator" &&
        note.content.length > 0,
    );
    if (contentNotes.length === 0) continue;
    currentSourcePath = group.sourcePath;
    headingPath.length = 0;
    const notesStart = blocks.length;
    headingPath[0] = group.label;
    addBlock("heading", group.label, {}, { level: 1 });
    for (const note of contentNotes) visit(note.content);
    if (blocks.length > notesStart) closeSection();
  }
  currentSourcePath = "word/document.xml";

  const diagnostics: ParseDiagnostic[] = (parsed.warnings ?? [])
    // Drop the false "missing header/footer" validation warnings that folio
    // raises only because we intentionally do not parse those parts.
    .filter((message) => !/missing (?:header|footer)\b/i.test(message))
    .map((message) => ({
      code: "DOCX_PARSER_WARNING" as const,
      message,
      severity: "warning" as const,
    }));
  if (!blocks.length) {
    diagnostics.push({
      code: "EMPTY_DOCUMENT",
      message: "The document contains no indexable text.",
      severity: "warning",
    });
  }
  const metadata = metadataFromDocument(parsed);
  const title =
    (typeof metadata.title === "string" ? metadata.title : null) ??
    blocks.find((block) => block.type === "heading")?.text ??
    fallbackTitle(filename);
  const language = parsed.package.styles?.docDefaults?.rPr?.language?.val ?? null;

  return {
    blocks,
    diagnostics,
    format: "docx",
    language,
    metadata,
    parserId: "docx-folio",
    parserVersion: "folio-0.17.0-adapter-1",
    schemaVersion: 2,
    sections,
    title,
  };
}
