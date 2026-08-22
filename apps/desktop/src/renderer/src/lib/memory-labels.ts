import type { MemoryStatus, UserFactCategory } from "@knosys-rag/contracts";

export const USER_FACT_CATEGORY_LABELS: Record<UserFactCategory, string> = {
  other: "Other",
  preference: "Preference",
  profile: "About you",
  project: "Project",
};

export function describeMemoryStatus(status: MemoryStatus): string {
  const conversations =
    status.summarizedThreadCount === 1
      ? "1 conversation remembered"
      : `${String(status.summarizedThreadCount)} conversations remembered`;
  const parts = [conversations];
  if (status.staleThreadCount > 0) {
    parts.push(`${String(status.staleThreadCount)} waiting to be summarized`);
  }
  if (status.excludedThreadCount > 0) {
    parts.push(`${String(status.excludedThreadCount)} excluded`);
  }
  return parts.join(" · ");
}
