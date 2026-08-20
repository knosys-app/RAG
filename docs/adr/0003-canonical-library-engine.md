# ADR-0003: Canonical Library Engine

- Status: Accepted
- Date: 2026-08-12

## Context

Imports perform filesystem access, parsing, chunking, and SQLite writes. These
operations must remain off the renderer and survive application restarts while
preserving immutable source evidence.

## Decision

Run the knowledge engine in an Electron utility process. Main owns its lifecycle
and communicates through runtime-validated request and response contracts.

Copy supported sources into app-managed storage before parsing, identify
canonical documents by SHA-256 checksum, and store relative managed paths in
SQLite. Keep ingestion jobs durable, recover interrupted jobs on startup, and
index normalized chunks with the SQLite FTS5 implementation shipped by
Electron's `node:sqlite` runtime.

TXT, Markdown, HTML, DOCX, and EPUB are available. PDF remains unavailable until
its parser evaluation establishes page-preserving extraction quality and an OCR
fallback boundary.

ADR-0006 subsequently satisfies this boundary and admits native-text PDFs.

## Consequences

- The renderer receives summaries and search results, never source paths or SQL
  access.
- Duplicate content records an additional origin and job without creating a
  second canonical document.
- Imported evidence remains usable if the original file changes or disappears.
- Utility-process and packaged-runtime behavior require explicit verification in
  addition to package-level unit tests.
