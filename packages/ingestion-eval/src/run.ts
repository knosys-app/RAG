import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

import { compareDocuments, outlineFromOdlJson } from "./compare.js";
import { extractWithEngine } from "./extract.js";
import { ensureReferences, hashFile, type CorpusFile } from "./reference.js";
import { renderReport, type DocumentResult } from "./report.js";

const DEFAULT_CORPUS = "/Users/ryan/Documents/Knosys RAG Test Library";

async function listPdfFiles(root: string): Promise<readonly string[]> {
  const found: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".pdf")) found.push(path);
    }
  };
  await walk(root);
  return found.sort();
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    // pnpm forwards script arguments behind a "--" separator, which parseArgs
    // would otherwise treat as end-of-options; strip it so flags still apply.
    args: process.argv.slice(2).filter((arg) => arg !== "--"),
    allowPositionals: true,
    options: {
      corpus: { default: DEFAULT_CORPUS, type: "string" },
      filter: { type: "string" },
      limit: { type: "string" },
      out: { default: join(import.meta.dirname, "..", "out"), type: "string" },
    },
  });
  const corpusDir = resolve(values.corpus);
  const outDir = resolve(values.out);
  const cacheDir = join(outDir, "odl-cache");
  await mkdir(outDir, { recursive: true });

  let pdfPaths = await listPdfFiles(corpusDir);
  if (values.filter !== undefined) {
    const needle = values.filter.toLowerCase();
    pdfPaths = pdfPaths.filter((path) => path.toLowerCase().includes(needle));
  }
  if (values.limit !== undefined) pdfPaths = pdfPaths.slice(0, Number(values.limit));
  if (pdfPaths.length === 0) {
    console.error(`No PDF files found under ${corpusDir}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Evaluating ${pdfPaths.length} PDFs from ${corpusDir}`);

  const files: CorpusFile[] = [];
  for (const path of pdfPaths) files.push({ path, sha256: await hashFile(path) });

  console.log("Ensuring OpenDataLoader reference extractions (first run spawns a JVM)...");
  const references = await ensureReferences(files, cacheDir);

  const results: DocumentResult[] = [];
  for (const file of files) {
    const reference = references.get(file.sha256);
    const relativePath = relative(corpusDir, file.path);
    const engine = await extractWithEngine(file.path);
    let metrics = null;
    if (reference?.jsonPath != null && engine.document !== null) {
      const outline = outlineFromOdlJson(
        JSON.parse(await readFile(reference.jsonPath, "utf8")) as unknown,
      );
      metrics = compareDocuments(outline, engine.document);
    }
    results.push({
      engineDiagnostics:
        engine.document?.diagnostics.map(({ code, severity }) => ({ code, severity })) ?? [],
      engineError: engine.error,
      metrics,
      path: relativePath,
      referenceError: reference?.error ?? (reference?.jsonPath == null ? "no reference output" : null),
      sha256: file.sha256,
    });
    const coverage = metrics?.textCoverage;
    console.log(
      `  ${relativePath}: ${
        engine.error !== null
          ? `engine ${engine.error.code}`
          : `coverage ${coverage === null || coverage === undefined ? "n/a" : coverage.toFixed(3)}`
      }`,
    );
  }

  const generatedAt = new Date().toISOString();
  const jsonlPath = join(outDir, "eval-results.jsonl");
  await writeFile(
    jsonlPath,
    results.map((result) => JSON.stringify(result)).join("\n") + "\n",
    "utf8",
  );
  const reportPath = join(outDir, "report.md");
  await writeFile(reportPath, renderReport(results, generatedAt), "utf8");
  console.log(`\nWrote ${jsonlPath}\nWrote ${reportPath}`);
}

await main();
