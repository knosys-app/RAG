import { randomUUID } from "node:crypto";
import { posix } from "node:path";

import type {
  DocumentBlock,
  DocumentSection,
  NormalizedDocument,
  ParseDiagnostic,
} from "@knosys-rag/core";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import type { Entry, ZipFile } from "yauzl";
import { fromBufferPromise } from "yauzl";

import { parseHtmlText } from "./html.js";

const MEBIBYTE = 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 10_000;
const MAX_ENTRY_BYTES = 256 * MEBIBYTE;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * MEBIBYTE;
const MAX_MARKUP_BYTES = 8 * MEBIBYTE;
const MAX_SPINE_MARKUP_BYTES = 64 * MEBIBYTE;
const MAX_COMPRESSION_RATIO = 200;

interface ManifestItem {
  readonly href: string;
  readonly id: string;
  readonly mediaType: string;
  readonly properties: string;
}

interface SpineItem {
  readonly idref: string;
  readonly linear: boolean;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  isArray: (tagName) =>
    ["creator", "date", "identifier", "item", "itemref", "rootfile", "subject"].includes(
      tagName,
    ),
  parseAttributeValue: false,
  parseTagValue: false,
  processEntities: false,
  removeNSPrefix: true,
  trimValues: true,
});

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): readonly unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  const text = asRecord(value)["#text"];
  return typeof text === "string" ? text.trim() || null : null;
}

function attribute(value: unknown, name: string): string | null {
  const resolved = asRecord(value)[`@_${name}`];
  return typeof resolved === "string" ? resolved.trim() || null : null;
}

function decodeXml(
  bytes: Uint8Array,
  label: string,
  options: { readonly allowDoctype?: boolean } = {},
): string {
  if (bytes.byteLength > MAX_MARKUP_BYTES) {
    throw new Error(`${label} exceeds the 8 MB markup limit.`);
  }
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
    if (!options.allowDoctype && /<!DOCTYPE/i.test(text)) {
      throw new Error(`${label} contains a prohibited doctype.`);
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.message.includes("prohibited doctype")) throw error;
    throw new Error(`${label} is not valid UTF-8 XML or XHTML.`);
  }
}

function resolveArchivePath(basePath: string, href: string): string {
  const withoutFragment = href.split("#", 1)[0]?.split("?", 1)[0] ?? "";
  let decoded: string;
  try {
    decoded = decodeURIComponent(withoutFragment);
  } catch {
    throw new Error(`EPUB path contains invalid percent encoding: ${href}`);
  }
  if (!decoded || decoded.includes("\\") || decoded.includes("\0") || /^\w+:/.test(decoded)) {
    throw new Error(`EPUB path is unsafe: ${href}`);
  }
  const resolved = posix.normalize(posix.join(posix.dirname(basePath), decoded));
  if (resolved.startsWith("../") || resolved === ".." || posix.isAbsolute(resolved)) {
    throw new Error(`EPUB path escapes the archive: ${href}`);
  }
  return resolved;
}

async function readEntry(
  archive: ZipFile,
  entry: Entry,
  maximumBytes: number,
): Promise<Uint8Array> {
  if (entry.uncompressedSize > maximumBytes) {
    throw new Error(`${entry.fileName} exceeds its extraction limit.`);
  }
  const stream = await archive.openReadStreamPromise(entry);
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += buffer.byteLength;
    if (total > maximumBytes) {
      stream.destroy();
      throw new Error(`${entry.fileName} exceeds its extraction limit.`);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, total);
}

function parseXml(text: string, label: string): Record<string, unknown> {
  const validation = XMLValidator.validate(text);
  if (validation !== true) {
    throw new Error(`${label} is malformed XML: ${validation.err.msg}`);
  }
  try {
    return asRecord(xmlParser.parse(text));
  } catch (error) {
    throw new Error(
      `${label} is malformed XML: ${error instanceof Error ? error.message : "Unknown XML error."}`,
    );
  }
}

function metadataValues(metadata: Record<string, unknown>, name: string): readonly string[] {
  return asArray(metadata[name]).map(stringValue).filter((value): value is string => value !== null);
}

function packageMetadata(metadata: Record<string, unknown>): Readonly<Record<string, unknown>> {
  const creators = metadataValues(metadata, "creator");
  const dates = metadataValues(metadata, "date");
  const identifiers = metadataValues(metadata, "identifier");
  const subjects = metadataValues(metadata, "subject");
  const title = stringValue(metadata.title);
  const language = stringValue(metadata.language);
  return {
    ...(creators.length ? { creators } : {}),
    ...(dates.length ? { dates } : {}),
    ...(stringValue(metadata.description) ? { description: stringValue(metadata.description) } : {}),
    ...(identifiers.length ? { identifiers } : {}),
    ...(language ? { language } : {}),
    ...(stringValue(metadata.publisher) ? { publisher: stringValue(metadata.publisher) } : {}),
    ...(stringValue(metadata.rights) ? { rights: stringValue(metadata.rights) } : {}),
    ...(subjects.length ? { subjects } : {}),
    ...(title ? { title } : {}),
  };
}

function fallbackTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || filename;
}

export async function parseEpubBytes(
  bytes: Uint8Array,
  filename: string,
): Promise<NormalizedDocument> {
  let archive: ZipFile;
  try {
    archive = await fromBufferPromise(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      autoClose: false,
      decodeStrings: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
  } catch (error) {
    throw new Error(
      `The EPUB archive is malformed: ${error instanceof Error ? error.message : "Unknown ZIP error."}`,
    );
  }

  const entries: Entry[] = [];
  const entriesByPath = new Map<string, Entry>();
  const canonicalNames = new Set<string>();
  let totalUncompressedBytes = 0;
  try {
    if (archive.entryCount > MAX_ARCHIVE_ENTRIES) {
      throw new Error("The EPUB archive contains too many entries.");
    }
    for await (const entry of archive.eachEntry()) {
      if (entry.fileName.endsWith("/")) continue;
      if (entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error(`The EPUB entry cannot be decoded: ${entry.fileName}`);
      }
      const canonicalName = entry.fileName.normalize("NFKC").toLocaleLowerCase("en-US");
      if (canonicalNames.has(canonicalName)) {
        throw new Error(`The EPUB archive contains a duplicate path: ${entry.fileName}`);
      }
      canonicalNames.add(canonicalName);
      totalUncompressedBytes += entry.uncompressedSize;
      if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
        throw new Error(`The EPUB entry is too large: ${entry.fileName}`);
      }
      if (totalUncompressedBytes > MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new Error("The EPUB archive expands beyond the 1 GiB limit.");
      }
      if (
        entry.uncompressedSize >= MEBIBYTE &&
        entry.uncompressedSize / Math.max(entry.compressedSize, 1) > MAX_COMPRESSION_RATIO
      ) {
        throw new Error(`The EPUB entry has an unsafe compression ratio: ${entry.fileName}`);
      }
      entries.push(entry);
      entriesByPath.set(entry.fileName, entry);
    }

    const mimetype = entries[0];
    if (!mimetype || mimetype.fileName !== "mimetype" || mimetype.compressionMethod !== 0) {
      throw new Error("The EPUB mimetype entry must be first and uncompressed.");
    }
    const mimetypeText = new TextDecoder().decode(await readEntry(archive, mimetype, 64)).trim();
    if (mimetypeText !== "application/epub+zip") {
      throw new Error("The EPUB mimetype entry is invalid.");
    }

    const containerEntry = entriesByPath.get("META-INF/container.xml");
    if (!containerEntry) throw new Error("The EPUB container descriptor is missing.");
    const container = parseXml(
      decodeXml(await readEntry(archive, containerEntry, MAX_MARKUP_BYTES), "container.xml"),
      "container.xml",
    );
    const rootfiles = asArray(asRecord(asRecord(container.container).rootfiles).rootfile);
    const rootfile = rootfiles.find(
      (value) => attribute(value, "media-type") === "application/oebps-package+xml",
    ) ?? rootfiles[0];
    const packagePath = rootfile ? attribute(rootfile, "full-path") : null;
    if (!packagePath || !entriesByPath.has(packagePath)) {
      throw new Error("The EPUB package document is missing.");
    }

    const packageEntry = entriesByPath.get(packagePath);
    if (!packageEntry) throw new Error("The EPUB package document is missing.");
    const packageXml = parseXml(
      decodeXml(await readEntry(archive, packageEntry, MAX_MARKUP_BYTES), packagePath),
      packagePath,
    );
    const packageDocument = asRecord(packageXml.package);
    const metadataNode = asRecord(packageDocument.metadata);
    const metadata = packageMetadata(metadataNode);
    const manifestItems = asArray(asRecord(packageDocument.manifest).item)
      .map((value): ManifestItem | null => {
        const id = attribute(value, "id");
        const href = attribute(value, "href");
        const mediaType = attribute(value, "media-type");
        return id && href && mediaType
          ? { href, id, mediaType, properties: attribute(value, "properties") ?? "" }
          : null;
      })
      .filter((value): value is ManifestItem => value !== null);
    const manifest = new Map(manifestItems.map((item) => [item.id, item]));
    const spineItems = asArray(asRecord(packageDocument.spine).itemref)
      .map((value): SpineItem | null => {
        const idref = attribute(value, "idref");
        return idref ? { idref, linear: attribute(value, "linear") !== "no" } : null;
      })
      .filter((value): value is SpineItem => value !== null);
    if (!spineItems.length) throw new Error("The EPUB spine is empty.");

    const blocks: DocumentBlock[] = [];
    const sections: DocumentSection[] = [];
    const diagnostics: ParseDiagnostic[] = [];
    let totalSpineBytes = 0;
    for (const [spineIndex, spineItem] of spineItems.entries()) {
      const item = manifest.get(spineItem.idref);
      if (!item) throw new Error(`The EPUB spine references a missing item: ${spineItem.idref}`);
      if (!["application/xhtml+xml", "text/html"].includes(item.mediaType)) {
        diagnostics.push({
          code: "EPUB_SPINE_ITEM_OMITTED",
          message: `Spine item ${item.href} uses unsupported media type ${item.mediaType}.`,
          severity: "warning",
        });
        continue;
      }
      const chapterPath = resolveArchivePath(packagePath, item.href);
      const chapterEntry = entriesByPath.get(chapterPath);
      if (!chapterEntry) throw new Error(`The EPUB chapter is missing: ${chapterPath}`);
      totalSpineBytes += chapterEntry.uncompressedSize;
      if (totalSpineBytes > MAX_SPINE_MARKUP_BYTES) {
        throw new Error("The EPUB spine expands beyond the 32 MB markup limit.");
      }
      const chapterText = decodeXml(
        await readEntry(archive, chapterEntry, MAX_MARKUP_BYTES),
        chapterPath,
        { allowDoctype: true },
      );
      const chapter = parseHtmlText(chapterText, posix.basename(chapterPath), {
        blockAttributes: {
          linear: spineItem.linear,
          manifestId: item.id,
          mediaType: item.mediaType,
          spineIndex,
        },
        format: "epub",
        parserId: "epub-xhtml-parse5",
        sourcePath: chapterPath,
      });
      const startBlockOrdinal = blocks.length;
      const hasHeading = chapter.blocks.some((block) => block.type === "heading");
      if (!hasHeading && chapter.title) {
        blocks.push({
          attributes: {
            linear: spineItem.linear,
            manifestId: item.id,
            mediaType: item.mediaType,
            spineIndex,
            synthetic: true,
          },
          headingPath: [chapter.title],
          id: randomUUID(),
          level: 1,
          location: { sourcePath: chapterPath },
          ordinal: blocks.length,
          text: chapter.title,
          type: "heading",
        });
      }
      for (const block of chapter.blocks) {
        const chapterHeading = hasHeading ? block.headingPath : [chapter.title, ...block.headingPath];
        blocks.push({
          ...block,
          headingPath: chapterHeading.filter(Boolean),
          ordinal: blocks.length,
        });
      }
      diagnostics.push(...chapter.diagnostics.map((diagnostic) => ({
        ...diagnostic,
        location: { ...diagnostic.location, sourcePath: chapterPath },
      })));
      sections.push({
        attributes: {
          label: chapter.title,
          linear: spineItem.linear,
          manifestId: item.id,
          mediaType: item.mediaType,
          sourcePath: chapterPath,
          spineIndex,
        },
        endBlockOrdinal: blocks.length > startBlockOrdinal ? blocks.length - 1 : null,
        ordinal: sections.length,
        startBlockOrdinal: blocks.length > startBlockOrdinal ? startBlockOrdinal : null,
      });
    }

    if (!blocks.length) {
      diagnostics.push({
        code: "EMPTY_DOCUMENT",
        message: "The document contains no indexable text.",
        severity: "warning",
      });
    }
    const title =
      (typeof metadata.title === "string" ? metadata.title : null) ??
      blocks.find((block) => block.type === "heading")?.text ??
      fallbackTitle(filename);
    return {
      blocks,
      diagnostics,
      format: "epub",
      language: typeof metadata.language === "string" ? metadata.language : null,
      metadata,
      parserId: "epub-yauzl",
      parserVersion: "yauzl-3.4.0-adapter-2",
      schemaVersion: 2,
      sections,
      title,
    };
  } finally {
    archive.close();
  }
}
