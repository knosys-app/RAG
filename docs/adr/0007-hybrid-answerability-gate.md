# ADR 0007: Hybrid Evidence Confidence and Answerability Gate

## Status

Accepted

## Context

The live ingested-grounding suite showed that `gemma4:26b` could correctly state
that a requested fact was absent while still selecting the answer branch of a
`oneOf` plan schema and citing every unrelated retrieved item. Prompt-only and
few-shot corrections either had no effect or caused valid questions to be
rejected.

Retrieval exposes raw vector cosine scores, lexical scores, channel ranks, and
RRF scores. RRF is rank-derived and cannot be treated as a relevance probability.
Embedding score distributions also vary by model digest, query instruction,
chunking, retrieval configuration, and corpus.

## Decision

Use three evidence-confidence outcomes before answer planning:

- `insufficient`: return deterministic insufficiency without model inference.
- `sufficient`: continue directly to answer-only planning.
- `uncertain`: ask a dedicated model provider to select supporting evidence IDs.

The reference calibration is bound to the exact Qwen3 embedding model digest,
embedding and query-input versions, retrieval trace version, candidate-pool size,
RRF constant, and chat top-K. It uses a deliberately wide uncertain band. A
fingerprint mismatch, incomplete embedding coverage, degraded retrieval, or
truncated context routes to semantic assessment rather than confident rejection.

The answerability result is a flat schema containing one unique, bounded
`evidenceIds` array. An empty array means the requested information is absent.
There is no `oneOf`, generated confidence value, or prose discriminator. Positive
assessment restricts downstream evidence to the selected IDs. The planner then
uses an answer-only schema, preserving deterministic claim fallback and citation
validation without reintroducing branch-order bias.

Routing diagnostics, calibration identity, measured signals, selected evidence
IDs, model identity, and assessment latency are persisted with the assistant
message and exposed through validated progress events.

## Consequences

- Clearly irrelevant questions avoid generation and cannot emit citations.
- High-confidence reference-profile questions add no model call.
- Ambiguous, contradictory, multi-source, and same-topic missing-attribute cases
  receive semantic answerability review.
- Unknown embedding or retrieval fingerprints remain functional but incur an
  additional local model call.
- Calibration changes require a new policy/calibration identifier and live
  evaluation; thresholds must not be silently reused across model digests.
- The system stores additional bounded diagnostics in schema 7.

## Alternatives Considered

- Prompt-only abstention instructions were rejected because the model continued
  to select the answer branch.
- Few-shot abstention examples were rejected because they caused broad
  over-abstention on answerable evidence.
- A global RRF threshold was rejected because RRF measures rank agreement rather
  than semantic similarity.
- Deterministic gating alone was rejected because same-topic missing attributes,
  paraphrases, conflicts, and multi-source questions require semantic judgment.
- A model pass for every query was rejected because clearly classifiable cases
  should not pay additional latency or compute cost.
