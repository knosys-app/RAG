# Knosys RAG

Knosys RAG is a local-first macOS knowledge library. It imports user-owned
documents, retrieves evidence locally, and produces grounded answers with
verifiable citations.

The current implementation provides a secure Electron shell, local runtime
readiness checks, a utility-process knowledge engine, and a persistent managed
library. TXT, Markdown, HTML, DOCX, EPUB, and native-text PDF sources can be
copied, parsed, chunked, deduplicated, and searched locally with SQLite FTS5.
PDF citations retain page ranges; scanned PDFs report that OCR is required
rather than silently indexing empty output.

## Requirements

- macOS 15 or newer
- Apple Silicon
- Node.js 22.13 or newer (Node 24.2 is pinned for development)
- pnpm 10.22
- 16 GB RAM minimum
- Ollama for local model inference

## Commands

```bash
asdf exec corepack pnpm install
asdf exec corepack pnpm dev
asdf exec corepack pnpm validate
asdf exec corepack pnpm --filter @knosys-rag/desktop package
```

The authoritative product and implementation roadmap is
[`docs/master-plan.md`](docs/master-plan.md).

## Packages

- `apps/desktop`: Electron main, preload, and React renderer
- `packages/contracts`: validated IPC and process-boundary contracts
- `packages/core`: Electron-independent domain constants and utilities
- `packages/ingestion`: document normalization and structure-aware chunking
- `packages/storage-sqlite`: canonical state, migrations, and FTS5 search
- `packages/engine`: managed imports, deduplication, and library orchestration

Reusable packages must never import Electron. The renderer receives neither
filesystem paths nor direct database, Node.js, or Ollama access.
