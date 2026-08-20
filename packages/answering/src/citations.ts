import type { CitationFallbackReason, CitationSnapshot } from "./types.js";

export class CitationValidationError extends Error {
  public readonly evidenceId: string | null;
  public readonly reason: CitationFallbackReason;

  public constructor(
    reason: CitationFallbackReason,
    message: string,
    evidenceId: string | null = null,
  ) {
    super(message);
    this.name = "CitationValidationError";
    this.reason = reason;
    this.evidenceId = evidenceId;
  }
}

export class CitationMarkerValidator {
  readonly #allowedIds: ReadonlySet<string>;
  readonly #citationIds: string[] = [];
  readonly #requireCitation: boolean;
  #pending = "";

  public constructor(allowedIds: ReadonlySet<string>, requireCitation = true) {
    this.#allowedIds = allowedIds;
    this.#requireCitation = requireCitation;
  }

  public get citationIds(): readonly string[] {
    return this.#citationIds;
  }

  public push(chunk: string): string {
    this.#pending += chunk;
    let safe = "";

    while (this.#pending.length > 0) {
      const opening = this.#pending.indexOf("[");
      if (opening === -1) {
        safe += this.#pending;
        this.#pending = "";
        break;
      }

      safe += this.#pending.slice(0, opening);
      this.#pending = this.#pending.slice(opening);
      if (this.#pending.length === 1) break;
      if (this.#pending[1] !== "E") {
        safe += "[";
        this.#pending = this.#pending.slice(1);
        continue;
      }

      const closing = this.#pending.indexOf("]", 2);
      if (closing === -1) {
        if (/^\[E\d*$/.test(this.#pending)) break;
        throw new CitationValidationError(
          "malformed-citation",
          `Malformed citation marker: ${this.#pending}`,
        );
      }

      const marker = this.#pending.slice(0, closing + 1);
      const match = /^\[(E[1-9]\d*)\]$/.exec(marker);
      if (match === null) {
        throw new CitationValidationError(
          "malformed-citation",
          `Malformed citation marker: ${marker}`,
        );
      }

      const evidenceId = match[1];
      if (evidenceId === undefined) {
        throw new CitationValidationError(
          "malformed-citation",
          `Malformed citation marker: ${marker}`,
        );
      }
      if (!this.#allowedIds.has(evidenceId)) {
        throw new CitationValidationError(
          "unknown-citation",
          `Unknown citation marker: ${marker}`,
          evidenceId,
        );
      }
      if (!this.#citationIds.includes(evidenceId)) this.#citationIds.push(evidenceId);
      safe += marker;
      this.#pending = this.#pending.slice(closing + 1);
    }

    return safe;
  }

  public finish(): readonly string[] {
    if (this.#pending.length > 0) {
      throw new CitationValidationError(
        "malformed-citation",
        `Incomplete citation marker: ${this.#pending}`,
      );
    }
    if (this.#requireCitation && this.#citationIds.length === 0) {
      throw new CitationValidationError(
        "missing-citation",
        "The streamed answer did not contain a citation marker.",
      );
    }
    return this.#citationIds;
  }
}

export function citationsForIds(
  ids: readonly string[],
  context: readonly CitationSnapshot[],
): readonly CitationSnapshot[] {
  const byId = new Map(context.map((item) => [item.id, item]));
  return ids.map((id) => {
    const citation = byId.get(id);
    if (citation === undefined) {
      throw new CitationValidationError(
        "unknown-citation",
        `Unknown citation marker: [${id}]`,
        id,
      );
    }
    return citation;
  });
}
