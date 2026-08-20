# Architecture

## Process Boundaries

The implemented ingestion slice contains four trust boundaries:

```text
React renderer
    |
    | frozen, typed preload API
    v
Electron main
    |
    | validated engine messages
    v
Electron utility process
    |
    | application services
    v
Managed sources, SQLite state, parsers, and FTS5
```

The renderer is sandboxed, context-isolated, and has no Node.js integration. Its
fully bundled CommonJS preload exposes only the frozen `window.knosys` API.
Main validates the request schema, main-frame identity, and exact application
scheme host before performing privileged work. Native dialogs remain in main,
and selected filesystem paths never cross into the renderer.

The main process owns host readiness checks and the engine lifecycle. The
utility process owns SQLite, managed file copying, parsing, chunking,
deduplication, recovery, and search. Requests and responses across both process
boundaries are runtime-validated.

The reusable packages are intentionally Electron-independent:

- `@knosys-rag/core` owns product constants and pure domain utilities.
- `@knosys-rag/contracts` owns runtime-validated process contracts.
- `@knosys-rag/ingestion` owns inert document normalization and chunking.
- `@knosys-rag/storage-sqlite` owns migrations, canonical state, and FTS5.
- `@knosys-rag/engine` owns managed imports and library orchestration.
- `@knosys-rag/desktop` is the only package that imports Electron.

## Current Scope

TXT, Markdown, HTML, DOCX, EPUB, and native-text PDF are available. Normalized
IR v2 preserves document metadata, section/chapter/page ranges, table matrices,
and source paths or fragments where available. Hybrid vector/FTS retrieval and
grounded chat run locally when compatible Ollama models are available. OCR,
full source viewers, metadata editing, deletion, backup, updates, and telemetry
remain future slices. These additions must preserve the existing process
boundaries rather than granting the renderer filesystem or SQL access.
