import { randomUUID } from "node:crypto";

import type {
  DocumentBlock,
  DocumentBlockType,
  DocumentFormat,
  NormalizedDocument,
  SourceLocation,
} from "@knosys-rag/core";
import { parse, type DefaultTreeAdapterMap } from "parse5";

type HtmlNode = DefaultTreeAdapterMap["node"];
type HtmlElement = DefaultTreeAdapterMap["element"];

export interface HtmlParseOptions {
  readonly blockAttributes?: Readonly<Record<string, unknown>>;
  readonly format?: DocumentFormat;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly parserId?: string;
  readonly sourcePath?: string;
}

function fallbackTitle(filename: string): string {
  const withoutExtension = filename.replace(/\.[^.]+$/, "");
  return withoutExtension.replace(/[-_]+/g, " ").trim() || filename;
}

function isHtmlElement(node: HtmlNode): node is HtmlElement {
  return "tagName" in node;
}

function htmlText(node: HtmlNode): string {
  if (node.nodeName === "#text" && "value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(htmlText).join(" ").replace(/\s+/g, " ").trim();
}

function attribute(element: HtmlElement, name: string): string | undefined {
  return element.attrs.find((entry) => entry.name.toLowerCase() === name)?.value;
}

function directText(element: HtmlElement): string {
  return element.childNodes
    .filter((child) => !(isHtmlElement(child) && ["ol", "ul"].includes(child.tagName)))
    .map(htmlText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function descendantElements(element: HtmlElement, tagName: string): HtmlElement[] {
  const matches: HtmlElement[] = [];
  const visit = (node: HtmlNode) => {
    if (isHtmlElement(node) && node.tagName.toLowerCase() === tagName) matches.push(node);
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  element.childNodes.forEach(visit);
  return matches;
}

function tableAttributes(table: HtmlElement): Readonly<Record<string, unknown>> {
  const rowElements = descendantElements(table, "tr");
  const rows = rowElements.map((row) =>
    row.childNodes
      .filter(
        (child): child is HtmlElement =>
          isHtmlElement(child) && ["td", "th"].includes(child.tagName.toLowerCase()),
      )
      .map((cell) => htmlText(cell)),
  );
  const spans = rowElements.map((row) =>
    row.childNodes
      .filter(
        (child): child is HtmlElement =>
          isHtmlElement(child) && ["td", "th"].includes(child.tagName.toLowerCase()),
      )
      .map((cell) => ({
        columnSpan: Number.parseInt(attribute(cell, "colspan") ?? "1", 10),
        rowSpan: Number.parseInt(attribute(cell, "rowspan") ?? "1", 10),
      })),
  );
  const firstRow = rowElements[0];
  const headerRow = firstRow
    ? firstRow.childNodes.some(
        (child) => isHtmlElement(child) && child.tagName.toLowerCase() === "th",
      )
    : false;
  return { headerRow, rows, spans };
}

function tableText(table: HtmlElement): string {
  const attributes = tableAttributes(table);
  const rows = attributes.rows as readonly (readonly string[])[];
  return rows.map((row) => row.join(" | ")).join("\n");
}

export function parseHtmlText(
  text: string,
  filename: string,
  options: HtmlParseOptions = {},
): NormalizedDocument {
  const document = parse(text, { sourceCodeLocationInfo: true });
  const blocks: DocumentBlock[] = [];
  const headingPath: string[] = [];
  let title: string | null = null;

  const addBlock = (
    element: HtmlElement,
    type: DocumentBlockType,
    content: string,
    extraAttributes: Readonly<Record<string, unknown>> = {},
    level?: number,
  ) => {
    if (!content.trim()) return;
    const location = element.sourceCodeLocation;
    const fragment = attribute(element, "id");
    const sourceLocation: SourceLocation | undefined =
      location || options.sourcePath || fragment
        ? {
            ...(location ? { endLine: location.endLine, startLine: location.startLine } : {}),
            ...(fragment ? { fragment } : {}),
            ...(options.sourcePath ? { sourcePath: options.sourcePath } : {}),
          }
        : undefined;
    blocks.push({
      attributes: { ...options.blockAttributes, ...extraAttributes },
      headingPath: headingPath.filter(Boolean),
      id: randomUUID(),
      ...(level === undefined ? {} : { level }),
      ...(sourceLocation === undefined ? {} : { location: sourceLocation }),
      ordinal: blocks.length,
      text: content.trim(),
      type,
    });
  };

  const visit = (
    node: HtmlNode,
    context: { readonly listDepth: number; readonly listOrdered: boolean | null },
  ) => {
    if (isHtmlElement(node)) {
      const tag = node.tagName.toLowerCase();
      if (["script", "style", "noscript", "template", "svg"].includes(tag)) return;

      if (tag === "title") {
        title = htmlText(node) || title;
        return;
      }

      if (tag === "ol" || tag === "ul") {
        node.childNodes.forEach((child) =>
          visit(child, { listDepth: context.listDepth + 1, listOrdered: tag === "ol" }),
        );
        return;
      }

      const headingMatch = /^h([1-6])$/.exec(tag);
      if (headingMatch) {
        const content = htmlText(node);
        const level = Number.parseInt(headingMatch[1] ?? "1", 10);
        if (content) {
          headingPath.splice(level - 1);
          headingPath[level - 1] = content;
          addBlock(node, "heading", content, {}, level);
        }
        return;
      }

      if (tag === "table") {
        addBlock(node, "table", tableText(node), tableAttributes(node));
        return;
      }

      const typeByTag: Partial<Record<string, DocumentBlockType>> = {
        blockquote: "quote",
        code: "code",
        li: "list-item",
        p: "paragraph",
        pre: "code",
      };
      const blockType = typeByTag[tag];
      if (blockType) {
        const content = tag === "li" ? directText(node) : htmlText(node);
        addBlock(
          node,
          blockType,
          content,
          tag === "li"
            ? { depth: context.listDepth, ordered: context.listOrdered ?? false }
            : {},
        );
        if (tag === "li") {
          node.childNodes
            .filter(
              (child): child is HtmlElement =>
                isHtmlElement(child) && ["ol", "ul"].includes(child.tagName.toLowerCase()),
            )
            .forEach((child) => visit(child, context));
        }
        return;
      }
    }

    if ("childNodes" in node) {
      node.childNodes.forEach((child) => visit(child, context));
    }
  };

  visit(document, { listDepth: 0, listOrdered: null });
  const resolvedTitle =
    title ?? blocks.find((block) => block.type === "heading")?.text ?? fallbackTitle(filename);
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
    format: options.format ?? "html",
    language: null,
    metadata: options.metadata ?? {},
    parserId: options.parserId ?? "html-parse5",
    parserVersion: "1.1.0",
    schemaVersion: 2,
    sections: [
      {
        attributes: options.sourcePath ? { sourcePath: options.sourcePath } : {},
        endBlockOrdinal: blocks.length ? blocks.length - 1 : null,
        ordinal: 0,
        startBlockOrdinal: blocks.length ? 0 : null,
      },
    ],
    title: resolvedTitle,
  };
}
