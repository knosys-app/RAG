# @knosys-rag/ingestion-eval

Dev-only corpus evaluation for the PDF ingestion path. It runs the real engine
parser (`@knosys-rag/ingestion`) over a corpus of PDFs, runs
[OpenDataLoader PDF](https://github.com/opendataloader-project/opendataloader-pdf)
over the same files as a structured reference extractor, and scores the engine
output against the reference. ADR-0006 requires exactly this corpus evaluation
for the risks it accepted (multi-column reading order, tables); ADR-0008
records why the reference tool itself is never a runtime dependency.

## Prerequisites

- A JDK 11+ on `PATH` (`java -version` must work). On macOS:
  `brew install openjdk`, then follow brew's caveat to symlink it or add
  `/opt/homebrew/opt/openjdk/bin` to `PATH`. Java is required only to build
  the reference cache; it is **never** required by the application.
- The corpus. Defaults to `~/Documents/Knosys RAG Test Library`; point
  `--corpus` anywhere else.

## Usage

```sh
pnpm --filter @knosys-rag/ingestion-eval run eval
# options:
#   --corpus <dir>   corpus root (default: the Knosys RAG Test Library)
#   --filter <text>  only paths containing <text>
#   --limit <n>      first n PDFs only
#   --out <dir>      output directory (default: packages/ingestion-eval/out)
```

Outputs land in `out/` (gitignored): `eval-results.jsonl` (one row per
document), `report.md` (ranked summary), and `odl-cache/` (reference
extractions keyed by content sha256, so reruns only convert new files).
All corpus PDFs are batched into a single JVM invocation; per-file retry only
happens when the batch fails.

## Metrics

- **Text coverage** — token recall of reference body text (headers/footers
  excluded) inside the engine's blocks. Low values mean the engine silently
  dropped content.
- **Reading-order agreement** — Kendall tau over unique reference lines
  matched by first occurrence in the engine text. Low values usually mean
  multi-column layouts read in the wrong order.
- **Header/footer leakage** — fraction of reference-classified header/footer
  lines that still appear in the engine output (the engine's
  `repeatedMargins` heuristic should have removed them).
- **Table cell capture** — fraction of reference table-cell texts present in
  the engine output.
- **Headings** — reference heading count vs engine heading blocks; the engine
  emits only paragraphs for PDFs today, so this measures the headroom of a
  future heading-detection port.

## Caveats

The reference is a comparison signal, not ground truth. OpenDataLoader's
local mode has weak borderless-table fidelity (self-reported TEDS 0.489) and
no OCR, and its heading detection is probabilistic. Investigate low-scoring
documents by hand before treating them as engine bugs.
