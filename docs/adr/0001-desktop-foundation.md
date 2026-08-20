# ADR-0001: Desktop Foundation

- Status: Accepted
- Date: 2026-08-11

## Context

Knosys RAG needs a consumer desktop shell while preserving an
Electron-independent knowledge engine. Imported documents are untrusted, and
the product will eventually coordinate CPU-heavy parsing, OCR, embedding, and
local generation.

## Decision

Use a pnpm workspace with a strict dependency direction:

```text
desktop -> contracts -> core
```

The React renderer runs with `sandbox`, `contextIsolation`, and no Node.js
integration. A narrow preload API invokes one IPC channel. Shared Zod schemas
validate requests and responses, while main validates sender origin before
performing privileged work.

Production renderer assets are served through `app://bundle`; the application
does not use `file://`. Navigation and new windows are denied by default.

Node 24.2 is the pinned development runtime. The source remains compatible with
the project's Node 22.12 minimum.

## Consequences

- Renderer features require an explicit shared contract and main-side handler.
- Core code cannot import Electron.
- Heavy ingestion work still needs an engine utility process before import is
  enabled.
- Current packaged builds can be Developer ID signed, but public release still
  requires notarization credentials and a reviewed minimal entitlement file.
