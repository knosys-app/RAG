import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  accentPreferenceSchema,
  themePreferenceSchema,
  type AppPreferences,
  type AppPreferencesPatch,
} from "@knosys-rag/contracts";
import { app } from "electron";
import { z } from "zod";

/**
 * Renderer preferences live in a userData JSON file rather than localStorage:
 * the dev server (http://localhost:*) and the packaged app (app://bundle) are
 * different web origins, so origin-scoped storage silently loses preferences
 * whenever the origin changes.
 */
const storedPreferencesSchema = z
  .object({
    accent: accentPreferenceSchema.optional(),
    collapsedFolders: z.array(z.string().min(1).max(128)).max(500).optional(),
    theme: themePreferenceSchema.optional(),
  })
  .strict();

type StoredPreferences = z.infer<typeof storedPreferencesSchema>;

let cache: StoredPreferences | null = null;

function preferencesFile(): string {
  return join(app.getPath("userData"), "preferences.json");
}

async function load(): Promise<StoredPreferences> {
  if (cache !== null) return cache;
  try {
    const raw: unknown = JSON.parse(await readFile(preferencesFile(), "utf8"));
    const parsed = storedPreferencesSchema.safeParse(raw);
    cache = parsed.success ? parsed.data : {};
  } catch {
    cache = {};
  }
  return cache;
}

function toResult(stored: StoredPreferences): AppPreferences {
  return {
    accent: stored.accent ?? null,
    collapsedFolders: stored.collapsedFolders ?? null,
    theme: stored.theme ?? null,
  };
}

export async function getPreferences(): Promise<AppPreferences> {
  return toResult(await load());
}

export async function setPreferences(
  patch: AppPreferencesPatch,
): Promise<AppPreferences> {
  const current = await load();
  const next: StoredPreferences = { ...current };
  if (patch.accent !== undefined) next.accent = patch.accent;
  if (patch.collapsedFolders !== undefined) {
    next.collapsedFolders = [...patch.collapsedFolders];
  }
  if (patch.theme !== undefined) next.theme = patch.theme;
  cache = next;
  const target = preferencesFile();
  const temporary = `${target}.tmp`;
  await writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
  await rename(temporary, target);
  return toResult(next);
}
