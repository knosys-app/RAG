import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import agricultureCases from "../fixtures/agriculture-cases.v1.json";
import agricultureCorpus from "../fixtures/agriculture-corpus.v1.json";

import { runDeterministicEvaluation } from "./runner.js";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const report = await runDeterministicEvaluation({
  caseSetInput: agricultureCases,
  corpusInput: agricultureCorpus,
  sourceDirectory: join(packageRoot, "fixtures", "sources"),
});

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
