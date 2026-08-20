# ADR-0002: Local Runtime Readiness

- Status: Accepted
- Date: 2026-08-11

## Context

Phase 1 uses a separately installed Ollama runtime and must explain absent,
stopped, malformed, and ready states without exposing Ollama directly to the
renderer.

## Decision

Main checks known macOS installation locations and queries only
`http://127.0.0.1:11434/api/tags` with a 1.5 second timeout. The response is
validated and reduced to a local model summary before crossing IPC. Remote and
cloud records are excluded from local readiness and generation selection.

The renderer receives no generic HTTP client and no arbitrary Ollama endpoint.
Model pulls and generation will receive separate typed operations later.

## Consequences

- A custom Ollama installation path may initially report as not installed if
  its server is stopped.
- A running loopback server is authoritative and reports ready regardless of
  where Ollama was installed.
- Remote and cloud model records are never accepted by local model-selection
  flows.
