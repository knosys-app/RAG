import { describe, expect, it } from "vitest";

import {
  documentFormatFromFilename,
  evaluatePlatformSupport,
  isAvailableSourceFilename,
  isSupportedSourceFilename,
} from "../src/index.js";

describe("source format support", () => {
  it.each(["book.PDF", "notes.md", "page.HTML", "manual.docx"])(
    "accepts %s",
    (filename) => {
      expect(isSupportedSourceFilename(filename)).toBe(true);
    },
  );

  it.each(["photo.png", "sheet.xlsx", "archive.zip", "no-extension"])(
    "rejects %s",
    (filename) => {
      expect(isSupportedSourceFilename(filename)).toBe(false);
    },
  );
});

describe("available ingestion formats", () => {
  it.each(["notes.txt", "guide.md", "article.HTML", "manual.docx", "novel.epub", "book.pdf"])(
    "accepts %s in the current parser slice",
    (filename) => {
      expect(isAvailableSourceFilename(filename)).toBe(true);
    },
  );

  it("maps names to canonical formats", () => {
    expect(documentFormatFromFilename("FIELD.NOTES.MD")).toBe("markdown");
    expect(documentFormatFromFilename("page.htm")).toBe("html");
    expect(documentFormatFromFilename("unknown.bin")).toBeNull();
  });
});

describe("platform support", () => {
  it("accepts the Phase 1 baseline", () => {
    expect(
      evaluatePlatformSupport({
        architecture: "arm64",
        memoryBytes: 16 * 1024 ** 3,
        macosVersion: "15.6.1",
        platform: "darwin",
      }),
    ).toEqual({
      architectureSupported: true,
      macosSupported: true,
      memorySupported: true,
      supported: true,
    });
  });

  it("rejects Intel and under-memory machines", () => {
    expect(
      evaluatePlatformSupport({
        architecture: "x64",
        memoryBytes: 8 * 1024 ** 3,
        macosVersion: "15.0",
        platform: "darwin",
      }).supported,
    ).toBe(false);
  });
});
