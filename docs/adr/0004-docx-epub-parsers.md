# ADR-0004: DOCX and EPUB Parsers

- Status: Accepted
- Date: 2026-08-12

## Context

DOCX and EPUB must preserve source hierarchy, tables, metadata, and citation
anchors without rendering untrusted document content or allowing uncontrolled
archive expansion.

## Decision

Use exact-pinned `@stll/folio-core` for DOCX parsing. Adapt its typed document
model directly into normalized IR rather than round-tripping through HTML or
Markdown. Disable media, font, header/footer, and note extraction for ingestion,
and enforce app-specific ZIP limits. Preserve outline headings, computed list
markers, table cell matrices and spans, sections, core metadata, and Word
paragraph IDs.

Use exact-pinned `yauzl` and `fast-xml-parser` for EPUB. Preflight the central
directory before inflation, reject unsafe paths, duplicate names, encryption,
unsupported compression, oversized entries, excessive aggregate size, and
unsafe compression ratios. Follow the OPF spine exactly, then normalize each
XHTML chapter inertly through parse5. Preserve chapter paths, element IDs,
metadata, spine order, hierarchy, and table matrices.

Permit standards-compliant doctypes only in spine XHTML, where parse5 treats
them as inert syntax. Container and package XML continue to reject doctypes and
entity declarations. Bound each archive entry at 256 MiB, aggregate expansion
at 1 GiB, and extracted spine markup at 64 MiB, while retaining entry-count,
compression-ratio, path, encryption, and per-read markup limits.

Normalized IR schema 2 adds document metadata, section ranges, and source path
or fragment locations. SQLite schema 2 persists those fields, and search results
return the source anchor of their starting block.

## Consequences

- DOCX and EPUB parsing is asynchronous and remains inside the utility process.
- DOCX relies on a young `0.x` parser, so the exact version and adapter fixtures
  must be reviewed before upgrades.
- Folio currently has a moderate transitive Valibot advisory in template
  condition code that is not invoked by this parser path; dependency audits must
  continue to track it.
- EPUB support intentionally omits unsupported non-HTML spine resources with a
  diagnostic rather than flattening them silently.
- PDF parsing is governed separately by ADR-0006.
