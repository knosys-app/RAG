import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OllamaStatus } from "@knosys-rag/contracts";
import { z } from "zod";

const OLLAMA_TAGS_URL = "http://127.0.0.1:11434/api/tags";
const OLLAMA_TIMEOUT_MS = 1_500;

const tagsResponseSchema = z.object({
  models: z.array(
    z.object({
      details: z
        .object({
          parameter_size: z.string().optional(),
          quantization_level: z.string().optional(),
        })
        .optional(),
      digest: z.string().min(1),
      name: z.string().min(1),
      remote_host: z.string().min(1).optional(),
      remote_model: z.string().min(1).optional(),
      size: z.number().int().nonnegative(),
    }),
  ),
});

const candidateInstallPaths = [
  "/Applications/Ollama.app",
  join(homedir(), "Applications", "Ollama.app"),
  "/opt/homebrew/bin/ollama",
  "/usr/local/bin/ollama",
];

async function isOllamaInstalled(): Promise<boolean> {
  const results = await Promise.all(
    candidateInstallPaths.map(async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    }),
  );

  return results.some(Boolean);
}

export async function getOllamaStatus(): Promise<OllamaStatus> {
  const installDetected = await isOllamaInstalled();

  try {
    const response = await fetch(OLLAMA_TAGS_URL, {
      method: "GET",
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        installDetected,
        reason: "unexpected-response",
        state: "unavailable",
      };
    }

    const parsed = tagsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      return {
        installDetected,
        reason: "unexpected-response",
        state: "unavailable",
      };
    }

    return {
      installDetected: true,
      models: parsed.data.models
        .filter(
          (model) =>
            model.remote_host === undefined && model.remote_model === undefined,
        )
        .map((model) => ({
        digest: model.digest,
        name: model.name,
        parameterSize: model.details?.parameter_size ?? null,
        quantizationLevel: model.details?.quantization_level ?? null,
        sizeBytes: model.size,
        })),
      state: "ready",
    };
  } catch {
    return {
      installDetected,
      reason: installDetected ? "not-running" : "not-installed",
      state: "unavailable",
    };
  }
}
