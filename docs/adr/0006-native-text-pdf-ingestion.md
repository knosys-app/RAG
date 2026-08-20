# ADR-0006: Native-Text PDF Ingestion

- Status: Accepted
- Date: 2026-08-14

## Context

PDF ingestion must preserve page-level provenance, reject empty or obviously
poor extraction, run without network access, and remain compatible with the
Electron utility process and packaged application. Scanned and mixed PDFs need
an explicit OCR boundary even though an OCR engine is outside this milestone.

The evaluation considered `pdfjs-dist`, `unpdf`, `pdf-parse`, MuPDF, Poppler,
and PDFium bindings. Native wrappers add signing, architecture, or subprocess
distribution costs. The JavaScript wrappers either obscure page-level control
or depend on PDF.js while adding another compatibility layer.

## Decision

Use exact-pinned `pdfjs-dist@6.2.108`, the patched release available at the time
of implementation. Import the legacy ESM build and pass document bytes directly;
never pass source URLs. Electron utility processes are not detected as Node by
PDF.js, so bootstrap its required `DOMMatrix` and `Path2D` primitives from
exact-pinned `@napi-rs/canvas@1.0.6` before loading PDF.js. Disable XFA, worker
fetching, WebAssembly, system fonts, font-face loading, offscreen canvas, and
image decoding. Resolve the packaged PDF.js worker locally for its in-process
fallback; no remote worker URL is permitted. Bound source size at 256 MiB, pages
at 10,000, text items at 2,000,000, extracted text at 64 MiB, images at 16
megapixels, and parsing at two minutes.

Create page-local normalized blocks and sections. SQLite schema 6 stores nullable
page numbers on blocks and diagnostics. Search, retrieval evidence, immutable
citation snapshots, source windows, and renderer labels carry page starts and
ends without exposing filesystem paths.

Use PDF.js native text order rather than fabricating table structure from
positioned glyphs. Detect and omit confidently repeated first/last-page lines.
Flag pages without text, low text density, suspicious characters, and garbled
output. This keeps low-quality extraction visible and leaves room for a future
layout-aware adapter without changing citation anchors.

Treat a PDF with no selectable text as `PDF_OCR_REQUIRED`. Mixed PDFs remain
indexable as `ready-with-warnings` and report `PDF_PAGES_REQUIRE_OCR`. No OCR
engine runs in this milestone. Failed canonical documents can be explicitly
reprocessed after parser improvements even when their checksum is unchanged.

## Consequences

- Native-text PDFs remain local and execute in the existing utility-process
  trust boundary.
- PDF.js remains an external packaged Node dependency so its supported Node
  compatibility initialization is not removed by bundling.
- Complex tables and multi-column reading order remain dependent on PDF.js text
  ordering and must be covered by corpus evaluation.
- Password-protected PDFs require a future password workflow.
- Image-only pages are not indexed until an offline OCR provider is implemented.
- The qualification corpus of 10 PDFs imports successfully with page-aware
  search; quality warnings remain visible instead of being treated as success.
