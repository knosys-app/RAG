# ADR-0005: Automatic Generation Model Selection

- Status: Accepted
- Date: 2026-08-13

## Context

Knosys can use any locally installed Ollama model that is compatible with its
grounded-answer pipeline. A fixed model-name default would favor one model family
and would not adapt when users add, remove, or update local models.

## Decision

The application distinguishes automatic and manual generation-model selection.
Automatic mode considers only local Ollama artifacts that report completion and
an unambiguous native context window of at least 8,192 tokens. Remote and cloud
records are excluded. Compatible models are ranked by artifact size, then model
name, digest, and provider using ordinal comparisons. The operational context is
clamped to 32,768 tokens.

Automatic mode is reconciled after successful inventory refreshes. A compatible
manual selection is preserved, including across digest updates. Removal or
incompatibility of a manual model returns the application to automatic mode.
Transient runtime failures preserve the stored preference but prevent new runs.
Active runs retain their original bound provider and profile.

Existing non-null selections migrate as manual because prior storage cannot
distinguish an old automatic default from an explicit user choice. Null selections
migrate as automatic.

## Consequences

- Selection is model-neutral and deterministic.
- Artifact size is a compatibility proxy, not an answer-quality score.
- Models with missing context metadata fail closed.
- The renderer receives only validated local inventory metadata and cannot choose
  remote endpoints.
