import type { ComparisonMetrics } from "./compare.js";

export interface DocumentResult {
  readonly engineDiagnostics: readonly { readonly code: string; readonly severity: string }[];
  readonly engineError: { readonly code: string; readonly message: string } | null;
  readonly metrics: ComparisonMetrics | null;
  readonly path: string;
  readonly referenceError: string | null;
  readonly sha256: string;
}

function formatRatio(value: number | null): string {
  return value === null ? "n/a" : value.toFixed(3);
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (high === undefined) return null;
  return sorted.length % 2 === 0 && low !== undefined ? (low + high) / 2 : high;
}

function metricValues(
  results: readonly DocumentResult[],
  select: (metrics: ComparisonMetrics) => number | null,
): readonly number[] {
  return results
    .map((result) => (result.metrics === null ? null : select(result.metrics)))
    .filter((value): value is number => value !== null);
}

export function renderReport(results: readonly DocumentResult[], generatedAt: string): string {
  const compared = results.filter((result) => result.metrics !== null);
  const engineFailures = results.filter((result) => result.engineError !== null);
  const referenceFailures = results.filter((result) => result.referenceError !== null);

  const lines: string[] = [
    "# PDF ingestion corpus evaluation",
    "",
    `Generated ${generatedAt}. Reference extractions produced by OpenDataLoader PDF`,
    "(local mode, cluster table method, headers/footers included). The reference is",
    "a comparison signal, not ground truth: its own table fidelity is limited in",
    "local mode, so treat low scores as pointers for manual review.",
    "",
    "## Summary",
    "",
    `- Documents compared: ${compared.length} of ${results.length}`,
    `- Engine parse failures: ${engineFailures.length}`,
    `- Reference conversion failures: ${referenceFailures.length}`,
    "",
    "| Metric | Mean | Median |",
    "| --- | --- | --- |",
  ];
  const summaryRows: readonly [string, (metrics: ComparisonMetrics) => number | null][] = [
    ["Text coverage (ODL body tokens found)", (metrics) => metrics.textCoverage],
    ["Reading-order agreement (Kendall tau)", (metrics) => metrics.readingOrderTau],
    ["Header/footer leakage", (metrics) => metrics.headerFooterLeakage],
    ["Table cell capture", (metrics) => metrics.tableCellCapture],
  ];
  for (const [label, select] of summaryRows) {
    const values = metricValues(compared, select);
    lines.push(`| ${label} | ${formatRatio(mean(values))} | ${formatRatio(median(values))} |`);
  }

  const totalOdlHeadings = compared.reduce(
    (total, result) => total + (result.metrics?.odlHeadingCount ?? 0),
    0,
  );
  const totalKnosysHeadings = compared.reduce(
    (total, result) => total + (result.metrics?.knosysHeadingBlocks ?? 0),
    0,
  );
  lines.push(
    "",
    `Headings: the reference identifies ${totalOdlHeadings} headings across the corpus;`,
    `the engine currently emits ${totalKnosysHeadings} heading blocks (PDF blocks are all`,
    "paragraphs today). This measures the headroom of a future heading-detection port.",
    "",
  );

  const rank = (
    title: string,
    select: (metrics: ComparisonMetrics) => number | null,
    ascending: boolean,
  ) => {
    const rows = compared
      .map((result) => ({ result, value: result.metrics === null ? null : select(result.metrics) }))
      .filter((row): row is { result: DocumentResult; value: number } => row.value !== null)
      .sort((a, b) => (ascending ? a.value - b.value : b.value - a.value))
      .slice(0, 10);
    if (rows.length === 0) return;
    lines.push(`## ${title}`, "", "| Document | Score |", "| --- | --- |");
    for (const row of rows) {
      lines.push(`| ${row.result.path} | ${formatRatio(row.value)} |`);
    }
    lines.push("");
  };
  rank("Lowest text coverage", (metrics) => metrics.textCoverage, true);
  rank("Lowest reading-order agreement", (metrics) => metrics.readingOrderTau, true);
  rank("Highest header/footer leakage", (metrics) => metrics.headerFooterLeakage, false);
  rank("Lowest table cell capture", (metrics) => metrics.tableCellCapture, true);

  if (engineFailures.length > 0) {
    lines.push("## Engine parse failures", "");
    for (const failure of engineFailures) {
      lines.push(`- ${failure.path}: ${failure.engineError?.code ?? "UNKNOWN"}`);
    }
    lines.push("");
  }
  if (referenceFailures.length > 0) {
    lines.push("## Reference conversion failures", "");
    for (const failure of referenceFailures) {
      lines.push(`- ${failure.path}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
