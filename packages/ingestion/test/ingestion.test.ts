import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";

import { chunkDocument, DocumentParseError, parseDocumentBytes } from "../src/index.js";

const encoder = new TextEncoder();

function createDocxFixture(): Uint8Array {
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Default Extension="xml" ContentType="application/xml"/>
        <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
        <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
        <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
        <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
      </Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
        <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
      </Relationships>`),
    "docProps/core.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title>Structured Word Guide</dc:title><dc:creator>Local Author</dc:creator>
      </cp:coreProperties>`),
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
        <Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
      </Relationships>`),
    "word/styles.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="en-US"/></w:rPr></w:rPrDefault></w:docDefaults>
        <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
      </w:styles>`),
    "word/numbering.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
        <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl></w:abstractNum>
        <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
      </w:numbering>`),
    "word/document.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?>
      <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
        <w:body>
          <w:p w14:paraId="0000A001"><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Word structure</w:t></w:r></w:p>
          <w:p w14:paraId="0000A002"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>First list item</w:t></w:r></w:p>
          <w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>Crop</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Days</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Tomato</w:t></w:r></w:p></w:tc><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>80</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p w14:paraId="0000A003"><w:pPr><w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:cols w:num="2"/></w:sectPr></w:pPr><w:r><w:t>End of first section.</w:t></w:r></w:p>
          <w:p w14:paraId="0000A004"><w:r><w:t>Second section text.</w:t></w:r></w:p>
          <w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>
        </w:body>
      </w:document>`),
  });
}

function createEpubFixture(): Uint8Array {
  return zipSync({
    mimetype: [strToU8("application/epub+zip"), { level: 0 }],
    "META-INF/container.xml": strToU8(`<?xml version="1.0"?>
      <container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    "OEBPS/chapter-two.xhtml": strToU8(`<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Second chapter</title></head><body><h1 id="second">Harvest</h1><p>Store the harvest.</p></body></html>`),
    "OEBPS/package.opf": strToU8(`<?xml version="1.0"?>
      <package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Ordered Garden Book</dc:title><dc:language>en</dc:language><dc:creator>One Author</dc:creator><dc:creator>Two Author</dc:creator></metadata><manifest><item id="two" href="chapter-two.xhtml" media-type="application/xhtml+xml"/><item id="one" href="chapter-one.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`),
    "OEBPS/chapter-one.xhtml": strToU8(`<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><title>First chapter</title></head><body><h1 id="first">Planting</h1><p>Plant in spring.</p><table><tr><th>Crop</th><th>Depth</th></tr><tr><td>Pea</td><td>2 cm</td></tr></table></body></html>`),
  });
}

function createPdfFixture(pageTexts: readonly (string | null)[]): Uint8Array {
  const fontId = 3 + pageTexts.length * 2;
  const infoId = fontId + 1;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pageTexts.length} /Kids [${pageTexts.map((_, index) => `${3 + index * 2} 0 R`).join(" ")}] >>`,
  ];
  pageTexts.forEach((text, index) => {
    const contentId = 4 + index * 2;
    const escaped = text?.replace(/([\\()])/g, "\\$1") ?? "";
    const stream = text ? `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET` : "";
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    );
  });
  objects.push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Title (Garden PDF) /Author (Local Author) >>",
  );

  let output = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(output.length);
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(output);
}

describe("simple document parsers", () => {
  it("normalizes CRLF text into stable paragraphs", async () => {
    const document = await parseDocumentBytes(
      encoder.encode("First paragraph.\r\n\r\nSecond paragraph."),
      "field-notes.txt",
      "text",
    );
    expect(document.title).toBe("field notes");
    expect(document.blocks.map((block) => block.text)).toEqual([
      "First paragraph.",
      "Second paragraph.",
    ]);
    expect(document.blocks[1]?.location).toEqual({ startLine: 3, endLine: 3 });
  });

  it("preserves Markdown hierarchy while omitting active raw HTML", async () => {
    const document = await parseDocumentBytes(
      encoder.encode("# Manual\n\nIntro.\n\n## Safety\n\n- Stop first\n\n<script>alert(1)</script>"),
      "manual.md",
      "markdown",
    );
    expect(document.title).toBe("Manual");
    expect(document.blocks.map((block) => [block.type, block.headingPath])).toEqual([
      ["heading", ["Manual"]],
      ["paragraph", ["Manual"]],
      ["heading", ["Manual", "Safety"]],
      ["list-item", ["Manual", "Safety"]],
    ]);
    expect(document.diagnostics[0]?.code).toBe("MARKDOWN_RAW_HTML_OMITTED");
  });

  it("extracts inert HTML blocks and ignores scripts and styles", async () => {
    const document = await parseDocumentBytes(
      encoder.encode(
        "<html><head><title>Local Guide</title><style>p{color:red}</style></head><body><h1>Start</h1><p onclick='steal()'>Read this.</p><script>steal()</script></body></html>",
      ),
      "guide.html",
      "html",
    );
    expect(document.title).toBe("Local Guide");
    expect(document.blocks.map((block) => block.text)).toEqual(["Start", "Read this."]);
    expect(JSON.stringify(document)).not.toContain("steal");
  });

  it("rejects binary data presented as text", async () => {
    await expect(
      parseDocumentBytes(new Uint8Array([65, 0, 66]), "bad.txt", "text"),
    ).rejects.toThrowError(DocumentParseError);
  });

  it("preserves DOCX headings, lists, tables, sections, and metadata", async () => {
    const document = await parseDocumentBytes(createDocxFixture(), "guide.docx", "docx");
    expect(document.title).toBe("Structured Word Guide");
    expect(document.language).toBe("en-US");
    expect(document.metadata.creators).toEqual(["Local Author"]);
    expect(document.blocks.map((block) => block.type)).toContain("list-item");
    const table = document.blocks.find((block) => block.type === "table");
    expect(table?.attributes.rows).toEqual([
      ["Crop", "Days"],
      ["Tomato", "80"],
    ]);
    expect(document.sections).toHaveLength(2);
    expect(document.sections[0]?.attributes).toMatchObject({
      columnCount: 2,
      orientation: "landscape",
    });
    expect(document.blocks[0]?.location).toMatchObject({
      fragment: "0000A001",
      sourcePath: "word/document.xml",
    });
  });

  it("follows EPUB spine order and preserves chapter anchors and tables", async () => {
    const document = await parseDocumentBytes(createEpubFixture(), "garden.epub", "epub");
    expect(document.title).toBe("Ordered Garden Book");
    expect(document.metadata.creators).toEqual(["One Author", "Two Author"]);
    expect(document.sections.map((section) => section.attributes.sourcePath)).toEqual([
      "OEBPS/chapter-one.xhtml",
      "OEBPS/chapter-two.xhtml",
    ]);
    expect(document.blocks.filter((block) => block.type === "heading").map((block) => block.text)).toEqual([
      "Planting",
      "Harvest",
    ]);
    expect(document.blocks[0]?.location).toMatchObject({
      fragment: "first",
      sourcePath: "OEBPS/chapter-one.xhtml",
    });
    expect(document.blocks.find((block) => block.type === "table")?.attributes.rows).toEqual([
      ["Crop", "Depth"],
      ["Pea", "2 cm"],
    ]);
  });

  it("rejects EPUB entries with zip-bomb compression ratios", async () => {
    const archive = zipSync({
      mimetype: [strToU8("application/epub+zip"), { level: 0 }],
      "bomb.bin": new Uint8Array(2 * 1024 * 1024),
    });
    await expect(parseDocumentBytes(archive, "bomb.epub", "epub")).rejects.toThrow(
      "unsafe compression ratio",
    );
  });

  it("extracts native PDF text with page anchors and mixed-page warnings", async () => {
    const document = await parseDocumentBytes(
      createPdfFixture(["Plant tomatoes in full sun.", null]),
      "garden.pdf",
      "pdf",
    );
    expect(document).toMatchObject({
      format: "pdf",
      metadata: { creators: ["Local Author"], pageCount: 2 },
      parserId: "pdfjs-native-text",
      title: "Garden PDF",
    });
    expect(document.blocks.map((block) => [block.text, block.location?.pageNumber])).toEqual([
      ["Plant tomatoes in full sun.", 1],
    ]);
    expect(document.sections).toHaveLength(2);
    expect(document.diagnostics).toContainEqual(
      expect.objectContaining({ code: "PDF_PAGES_REQUIRE_OCR", severity: "warning" }),
    );
  });

  it("reports OCR-required PDFs instead of silently indexing no text", async () => {
    await expect(
      parseDocumentBytes(createPdfFixture([null]), "scan.pdf", "pdf"),
    ).rejects.toMatchObject({ code: "PDF_OCR_REQUIRED" });
  });
});

describe("structure-aware chunking", () => {
  it("does not cross heading boundaries and remains deterministic in content", async () => {
    const document = await parseDocumentBytes(
      encoder.encode("# One\n\nFirst section.\n\n# Two\n\nSecond section."),
      "sections.md",
      "markdown",
    );
    const first = chunkDocument(document);
    const second = chunkDocument(document);
    expect(first.map((chunk) => chunk.content)).toEqual(
      second.map((chunk) => chunk.content),
    );
    expect(first).toHaveLength(2);
    expect(first[0]?.headingPath).toEqual(["One"]);
    expect(first[1]?.headingPath).toEqual(["Two"]);
  });

  it("hard-splits oversized blocks with bounded chunks", async () => {
    const document = await parseDocumentBytes(
      encoder.encode("word ".repeat(1_000)),
      "large.txt",
      "text",
    );
    const chunks = chunkDocument(document);
    expect(chunks.length).toBeGreaterThan(1);
    expect(Math.max(...chunks.map((chunk) => chunk.content.length))).toBeLessThanOrEqual(1_300);
  });
});
