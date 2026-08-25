# ADR-0008: PDF Content-Safety Filters and Corpus Evaluation

- Status: Accepted
- Date: 2026-08-24

## Context

ADR-0006 accepted two open risks for native-text PDF ingestion: multi-column
reading order and table structure depend on PDF.js text ordering and "must be
covered by corpus evaluation," and no defense existed against content hidden
inside a PDF (off-page, sub-point, or hidden-layer text) reaching the
searchable index — a poisoning vector for retrieval-grounded answers.

OpenDataLoader PDF (Apache-2.0, Hancom/veraPDF) was evaluated as a candidate.
It emits rich structured extraction (heading levels, tables with spans,
reading order via XY-Cut++, header/footer classification, per-element page and
bounding box) and ships default-on content-safety filters. It is, however, a
Java engine: every invocation — including via its Python and Node wrappers —
spawns a JVM and requires JDK 11+ on PATH. Embedding it would reintroduce the
subprocess-distribution, signing, and trust-boundary costs ADR-0006 rejected
for MuPDF/Poppler/PDFium.

## Decision

Do not integrate OpenDataLoader PDF at runtime. Use it two ways instead:

1. **Dev-only corpus evaluation** (`packages/ingestion-eval`): runs the real
   `parsePdfBytes` and OpenDataLoader (batched, one JVM call, content-hash
   cache) over a PDF corpus and scores text coverage, reading-order agreement
   (Kendall tau), header/footer leakage, and table-cell capture against the
   reference. The package is private, never shipped, and Java is a documented
   dev prerequisite only. The reference is a comparison signal, not ground
   truth (its local-mode table fidelity is weak).

2. **Port its content-safety heuristics** into `parsePdfBytes`, re-derived
   from the upstream semantics (`FilterConfig`/`TextProcessor`,
   threshold: bounding-box height ≤ 1 pt):
   - Sub-point text carrying content is dropped and counted
     (`PDF_TINY_TEXT_OMITTED`, info). Whitespace-only items are exempt so
     `hasEOL` line breaks survive.
   - Fully off-page text is dropped and counted (`PDF_OFFPAGE_TEXT_OMITTED`,
     info). Discovery: pdfjs-dist 6.2.108 already culls off-page glyph runs
     inside `getTextContent` (per-glyph viewBox check), so this filter is a
     backstop that protects against a future PDF.js upgrade changing that
     undocumented behavior.
   - Optional-content (layer) text cannot be attributed to a specific layer
     through the PDF.js text API — `getTextContent` marked-content markers
     carry only the "OC" tag, not the group — so layer text is counted, never
     dropped, and surfaced as `PDF_OPTIONAL_CONTENT_TEXT`: a warning when the
     document declares layers hidden by default, info otherwise. Extraction
     now requests `includeMarkedContent`; marker items are structural and do
     not count toward the text-item limit.
   - The upstream low-contrast hidden-text filter is deliberately not ported:
     it requires per-page rendering, and it is off by default upstream for
     the same cost reason.

## Consequences

- Baseline corpus run (92 PDFs, zero failures either side): text coverage
  0.993 mean / 0.997 median, reading-order tau 0.827 mean, header/footer
  leakage 0.545 mean, table-cell capture 0.739 mean. The filters changed no
  document's coverage; one corpus document legitimately triggers the
  tiny-text diagnostic.
- The evaluation quantifies the deferred work ADR-0006 anticipated: the
  reference finds 7,587 headings where PDF blocks are all paragraphs today,
  reading order degrades to tau 0.2–0.6 on multi-column layouts, and
  `repeatedMargins` misses roughly half of reference-classified
  headers/footers. Heading detection, XY-Cut reading order, and stronger
  margin detection are follow-ups to be justified by these numbers, keeping
  citation anchors stable as ADR-0006 requires.
- Heuristics were re-derived from upstream behavior, not translated code; no
  attribution obligations attach beyond this record.
- The application still never spawns subprocesses or requires Java; hidden
  low-contrast text remains undetected, visible only through corpus review.
