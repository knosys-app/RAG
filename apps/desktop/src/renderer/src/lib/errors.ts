import { KnosysApiError } from "@knosys-rag/contracts";

export { KnosysApiError };

/**
 * Recovers a structured KnosysApiError from anything a `window.knosys` call
 * threw. Falls back to the supplied message for non-error values.
 */
export function describeError(error: unknown, fallback: string): string {
  if (error instanceof Error || typeof error === "string") {
    return KnosysApiError.fromThrown(error).message;
  }
  return fallback;
}

export function errorCode(error: unknown): KnosysApiError["code"] {
  return KnosysApiError.fromThrown(error).code;
}
