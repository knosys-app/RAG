import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { convert } from "@opendataloader/pdf";

export interface CorpusFile {
  readonly path: string;
  readonly sha256: string;
}

export interface ReferencePaths {
  readonly jsonPath: string | null;
  readonly markdownPath: string | null;
}

export async function hashFile(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

function cachedPaths(cacheDir: string, sha256: string): ReferencePaths {
  const jsonPath = join(cacheDir, `${sha256}.json`);
  const markdownPath = join(cacheDir, `${sha256}.md`);
  return {
    jsonPath: existsSync(jsonPath) ? jsonPath : null,
    markdownPath: existsSync(markdownPath) ? markdownPath : null,
  };
}

async function convertBatch(paths: readonly string[], cacheDir: string): Promise<void> {
  await convert([...paths], {
    format: ["json", "markdown"],
    // Header/footer elements must be present in the reference so leakage in
    // the engine output can be measured against them.
    includeHeaderFooter: true,
    outputDir: cacheDir,
    quiet: true,
    tableMethod: "cluster",
  });
}

/**
 * Converts every corpus PDF that is not already cached, staging inputs as
 * `<sha256>.pdf` symlinks so a single batched JVM invocation writes outputs
 * keyed by content hash. Files that fail conversion are reported, not fatal.
 */
export async function ensureReferences(
  files: readonly CorpusFile[],
  cacheDir: string,
): Promise<Map<string, ReferencePaths & { readonly error: string | null }>> {
  await mkdir(cacheDir, { recursive: true });
  const missing = files.filter((file) => {
    const cached = cachedPaths(cacheDir, file.sha256);
    return cached.jsonPath === null || cached.markdownPath === null;
  });

  const errors = new Map<string, string>();
  if (missing.length > 0) {
    const stageDir = await mkdtemp(join(cacheDir, "stage-"));
    try {
      const staged: string[] = [];
      for (const file of missing) {
        const stagedPath = join(stageDir, `${file.sha256}.pdf`);
        if (!existsSync(stagedPath)) await symlink(file.path, stagedPath);
        staged.push(stagedPath);
      }
      try {
        await convertBatch(staged, cacheDir);
      } catch {
        // The batch aborts on the first unprocessable PDF; retry one by one so
        // a single broken document cannot empty the whole reference set.
        for (const file of missing) {
          const cached = cachedPaths(cacheDir, file.sha256);
          if (cached.jsonPath !== null && cached.markdownPath !== null) continue;
          try {
            await convertBatch([join(stageDir, `${file.sha256}.pdf`)], cacheDir);
          } catch (error) {
            errors.set(file.sha256, error instanceof Error ? error.message : String(error));
          }
        }
      }
    } finally {
      await rm(stageDir, { force: true, recursive: true });
    }
  }

  const result = new Map<string, ReferencePaths & { readonly error: string | null }>();
  for (const file of files) {
    result.set(file.sha256, {
      ...cachedPaths(cacheDir, file.sha256),
      error: errors.get(file.sha256) ?? null,
    });
  }
  return result;
}
