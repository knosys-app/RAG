import type { DocumentReview } from "@knosys-rag/contracts";

type Diagnostic = DocumentReview["diagnostics"][number];

export interface ReviewIssueCopy {
  /** Short, human-readable headline for the issue. */
  readonly title: string;
  /** What happened, in plain language. */
  readonly explanation: string;
  /** What it means for searching this document. */
  readonly impact: string;
  /** The suggested way to resolve it. */
  readonly recommendedAction: string;
  readonly severity: "info" | "warning" | "error";
}

// Parser diagnostics that promote a document to "ready-with-warnings". The
// document is already imported and searchable; these explain what may be
// missing or imperfect so the reviewer can decide whether to keep it.
const DIAGNOSTIC_COPY: Record<string, Omit<ReviewIssueCopy, "severity">> = {
  EMPTY_DOCUMENT: {
    title: "No searchable text found",
    explanation:
      "The file was read successfully, but no indexable text could be extracted from it.",
    impact:
      "This document will not contribute anything to answers — there is nothing to search.",
    recommendedAction:
      "Replace it with a text-based edition, or delete it if it isn't needed.",
  },
  PDF_PAGES_REQUIRE_OCR: {
    title: "Some pages are scanned images",
    explanation:
      "Part of this PDF is made of scanned images with no selectable text, so those pages could not be read.",
    impact:
      "The text on the scanned pages is not searchable. The rest of the document is indexed normally.",
    recommendedAction:
      "If the scanned pages matter, replace this file with a text-based or OCR-processed edition. Knosys does not run OCR itself.",
  },
  PDF_LOW_TEXT_DENSITY: {
    title: "Very little text on many pages",
    explanation:
      "Many pages contained almost no extractable text, which often means the PDF is mostly images or was exported oddly.",
    impact:
      "Coverage of this document may be thin, so it might not surface when you expect it to.",
    recommendedAction:
      "Review the source quality; replace it with a cleaner text edition if the content is important.",
  },
  PDF_SUSPICIOUS_CHARACTERS: {
    title: "Unusual characters in the text",
    explanation:
      "The extracted text contains an unusual number of control or replacement characters, which can indicate a broken font or encoding.",
    impact:
      "Some passages may be garbled, which can reduce search quality for those sections.",
    recommendedAction:
      "Spot-check the content; replace the source if key passages look corrupted.",
  },
  PDF_LOW_QUALITY_TEXT: {
    title: "Text may be garbled",
    explanation:
      "A significant share of lines look garbled, which usually points to a font or encoding problem in the source PDF.",
    impact:
      "Affected passages may not match searches accurately.",
    recommendedAction:
      "Review the source; replace it with a higher-quality edition if the content matters.",
  },
  PDF_REPEATED_MARGINS_OMITTED: {
    title: "Repeated headers/footers removed",
    explanation:
      "Repeated running headers or footers were detected and left out of the indexed text.",
    impact:
      "This is normal cleanup and generally improves search quality. No content of substance was lost.",
    recommendedAction: "No action needed — you can keep this document as-is.",
  },
  DOCX_PARSER_WARNING: {
    title: "Word document parser warning",
    explanation:
      "The Word document was read, but the parser reported a warning about part of its structure.",
    impact:
      "Most of the document is indexed, but a small part may be missing or reformatted.",
    recommendedAction:
      "Skim the imported content; keep it if it looks complete, or replace the source otherwise.",
  },
  EPUB_SPINE_ITEM_OMITTED: {
    title: "Part of the e-book was skipped",
    explanation:
      "One or more sections of this EPUB used an unsupported media type and were skipped.",
    impact:
      "Those sections are not searchable; the remaining chapters are indexed normally.",
    recommendedAction:
      "Keep the document if the main text came through, or replace it with a standard EPUB.",
  },
  MARKDOWN_RAW_HTML_OMITTED: {
    title: "Embedded HTML was dropped",
    explanation:
      "Raw HTML embedded inside this Markdown file was omitted from the indexed text.",
    impact:
      "Any content that lived only inside the raw HTML is not searchable.",
    recommendedAction:
      "Keep it if the Markdown text is sufficient, or replace the source with a plain-text edition.",
  },
};

// Terminal parse errors that leave a document "failed" — it was not imported.
const FAILURE_COPY: Record<string, Omit<ReviewIssueCopy, "severity">> = {
  PDF_OCR_REQUIRED: {
    title: "This PDF is entirely scanned images",
    explanation:
      "Every page is a scanned image with no selectable text, so nothing could be extracted.",
    impact: "The document could not be imported and is not searchable.",
    recommendedAction:
      "Replace it with a text-based or OCR-processed edition. Knosys does not run OCR itself.",
  },
  PDF_NO_INDEXABLE_TEXT: {
    title: "No indexable text in this PDF",
    explanation: "The PDF was opened but yielded no usable text to index.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Replace it with a text-based edition, or delete it if it isn't needed.",
  },
  PDF_PASSWORD_REQUIRED: {
    title: "This PDF is password-protected",
    explanation: "The file is encrypted and cannot be opened without its password.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Remove the password in your PDF reader, then replace the source with the unlocked file.",
  },
  PDF_FILE_TOO_LARGE: {
    title: "PDF is too large to import",
    explanation: "The file exceeds the maximum size Knosys will process.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Split it into smaller parts or compress it, then replace the source.",
  },
  PDF_TOO_MANY_PAGES: {
    title: "PDF has too many pages",
    explanation: "The document exceeds the maximum page count Knosys will process.",
    impact: "The document could not be imported.",
    recommendedAction: "Split it into smaller parts, then replace the source.",
  },
  PDF_PARSE_TIMEOUT: {
    title: "PDF took too long to read",
    explanation: "Reading the PDF exceeded the time limit and was stopped.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Try replacing it with a simpler or smaller edition of the same document.",
  },
  PDF_PARSE_FAILED: {
    title: "This PDF could not be read",
    explanation: "The PDF appears to be malformed or corrupted.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Re-export or repair the PDF, then replace the source; or delete it.",
  },
  INVALID_UTF8: {
    title: "Text encoding not recognized",
    explanation:
      "The text file is not valid UTF-8, so it could not be decoded safely.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Re-save the file as UTF-8, then replace the source.",
  },
  BINARY_TEXT_REJECTED: {
    title: "File looks binary, not text",
    explanation:
      "The file was offered as text but appears to contain binary data.",
    impact: "The document could not be imported.",
    recommendedAction:
      "Import it in its real format (PDF, DOCX, EPUB, HTML), or delete it.",
  },
  TEXT_FILE_TOO_LARGE: {
    title: "Text file is too large",
    explanation: "The file exceeds the maximum size Knosys will process.",
    impact: "The document could not be imported.",
    recommendedAction: "Split it into smaller files, then replace the source.",
  },
};

function fallbackDiagnostic(diagnostic: Diagnostic): ReviewIssueCopy {
  return {
    title: "Parser notice",
    explanation:
      diagnostic.message ||
      "The parser reported a notice about this document while importing it.",
    impact:
      diagnostic.severity === "warning"
        ? "Part of this document may be missing or imperfect."
        : "This is informational and generally needs no action.",
    recommendedAction:
      diagnostic.severity === "warning"
        ? "Review the content; replace the source if something important is missing."
        : "No action needed — you can keep this document as-is.",
    severity: diagnostic.severity,
  };
}

/** Plain-language copy for a single parse diagnostic on an imported document. */
export function describeDiagnostic(diagnostic: Diagnostic): ReviewIssueCopy {
  const known = DIAGNOSTIC_COPY[diagnostic.code];
  if (known) return { ...known, severity: diagnostic.severity };
  return fallbackDiagnostic(diagnostic);
}

/** Plain-language copy for the terminal error on a failed document. */
export function describeFailure(
  errorCode: string | null,
  errorMessage: string | null,
): ReviewIssueCopy {
  const known = errorCode ? FAILURE_COPY[errorCode] : undefined;
  if (known) return { ...known, severity: "error" };
  return {
    title: "This document could not be imported",
    explanation:
      errorMessage ||
      "The file could not be read during import. It may be corrupted or in an unexpected format.",
    impact: "The document is not searchable.",
    recommendedAction:
      "Replace it with a corrected source, or delete it if it isn't needed.",
    severity: "error",
  };
}

/** Human-readable location suffix (page/line) for a diagnostic, if any. */
export function describeLocation(diagnostic: Diagnostic): string | null {
  const location = diagnostic.location;
  if (!location) return null;
  if (typeof location.pageNumber === "number") {
    return `Page ${location.pageNumber}`;
  }
  if (typeof location.startLine === "number") {
    return typeof location.endLine === "number" && location.endLine !== location.startLine
      ? `Lines ${location.startLine}–${location.endLine}`
      : `Line ${location.startLine}`;
  }
  return null;
}
