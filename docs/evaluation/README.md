# Evaluation Foundation

`@knosys-rag/evaluation` owns JSON-compatible evaluation data contracts, pure
scoring utilities, and explicit adapters that run controlled fixtures through the
production engine. The reusable schemas and metrics remain independent of
production response shapes.

## Data Contracts

The corpus, case set, run, and summary schemas carry `schemaVersion: 1`. Zod
objects are strict so format changes require an intentional version change.

Corpus sources have a stable `sourceId` and lowercase SHA-256 `checksum`. The
checksum identifies the source bytes; it is not inferred from the corpus's
evaluation text. Gold evidence repeats that pair and adds:

- A discriminated locator: one-indexed inclusive `lines`, `fragment`, whole
  `source`, or schema-ready `page`.
- An exact `quote`.
- `quoteHash`, the lowercase SHA-256 of the UTF-8 quote.

`evidenceKey` canonically combines source ID, source checksum, locator, and quote
hash. Object property order therefore cannot change relevance identity.
`parseEvaluationData` performs cross-file checks for matching corpus IDs, known
source identities, quotes present in source text, and line ranges containing
their quotes.

Case expectations are discriminated as `answerable` or `unanswerable`.
Answerable cases retain acceptable answer strings for future answer-quality
scoring and require one or more gold evidence records. Run observations are an
evaluation boundary format, not a claim about current production output.

The small fixtures in `packages/evaluation/fixtures` are materialized as physical
TXT and Markdown files and cover:

- Exact numeric retrieval: a weekly tomato irrigation rate.
- Semantic paraphrase: the soil effects of keeping living roots.
- Unanswerable behavior: a pesticide harvest interval absent from the corpus.

## Metrics

`retrievalMetricsAtK` uses exact `evidenceKey` matches and binary relevance:

- Hit@K is one when any unique gold evidence appears in the first K results.
- Recall@K is unique gold evidence retrieved by K divided by all gold evidence.
- Precision@K is unique gold evidence retrieved by K divided by K. Missing result
  slots therefore do not receive credit.
- MRR is the reciprocal rank of the first unique gold evidence over the complete
  supplied ranking.
- nDCG uses binary gain through K and the ideal ordering for the available gold
  evidence.

Citation validity is the fraction of emitted citations that exactly match gold
evidence. Citation coverage is the fraction of unique gold evidence cited.
`evaluateRun` macro-averages retrieval and citation scores over answerable cases.

Abstention is the positive class for answer behavior. The summary includes true
positive, false positive, false negative, and true negative counts plus
abstention precision, recall, and F1. A zero denominator produces zero.

## Baselines

`compareBaseline(current, baseline, tolerances)` compares summaries only when
corpus ID, case set ID, K, and case counts match. A regression is a baseline score
minus current score greater than its nonnegative tolerance. Tolerances support a
default and per-metric overrides. Metrics are always checked in a fixed order,
and summaries contain no timestamps or generated IDs, so identical inputs
produce identical comparison JSON.

## Deterministic Production-Path Evaluation

`pnpm eval:deterministic` creates an isolated library, imports the physical
fixtures through `KnowledgeEngine`, waits for durable embeddings, and runs the
production lexical, vector, and hybrid retrieval paths. Its deterministic hashed
token embedder is CI-safe and does not call Ollama. The command prints a validated
JSON report and exits nonzero when any currently measurable gate fails:

- Hybrid exact/numeric Hit@5 equals 1.00.
- Hybrid macro Recall@5 is at least 0.90.
- Hybrid Recall@5 is no worse than the stronger lexical or vector result.
- Hybrid nDCG@10 is no worse than the stronger lexical or vector result.

This runner is the initial production-path baseline, not the completed milestone
corpus. Real-model answer quality, claim support, parser breadth, and the planned
20-30 document / 80+ case corpus remain separate expansion work.

## Live Ollama Smoke Test

`pnpm eval:live` is an explicit local/reference-hardware check. It requires a
running Ollama service with `qwen3-embedding:0.6b` and at least one compatible
local completion model installed. The
command creates an isolated temporary library and verifies:

- Model capability and digest discovery.
- Durable 1024-dimensional embedding backfill.
- Exact and semantic hybrid retrieval through SQLite and `sqlite-vec`.
- Gemma structured planning and streamed cited generation.
- Immutable citation lookup and chat persistence after reopening the engine.

The temporary library is deleted after the run. This command is intentionally
excluded from normal CI and does not modify the user's application library.

## Live Ingested-Grounding Evaluation

`pnpm eval:grounding:live` creates isolated synthetic corpora with facts that a
model cannot know beforehand. It verifies exact and paraphrase retrieval,
three-run canary repeatability, citation snapshots, absent-answer and empty-library
abstention, contradictory-source disclosure, multi-source synthesis, prompt
injection resistance, counterfactual corpus sensitivity, and persistence after
reopening. The report records the selected model and digest and exits nonzero if
any case fails. This suite uses the real local models and is excluded from CI.

The suite also verifies hybrid answer routing: calibrated high-confidence cases
must bypass semantic answerability, calibrated low-confidence cases must reject
without inference or citations, and same-topic missing attributes must use the
flat evidence-ID answerability assessor. Retrieval reports include raw component
scores so reference thresholds remain auditable.

## Commands

From the repository root:

```sh
pnpm eval:ci
pnpm eval:deterministic
pnpm eval:grounding:live
pnpm eval:live
```

`eval:ci` runs typechecking, unit/integration tests, and the deterministic report.
Package-level commands are `pnpm --filter @knosys-rag/evaluation test`,
`pnpm --filter @knosys-rag/evaluation typecheck`, and
`pnpm --filter @knosys-rag/evaluation evaluate`.
