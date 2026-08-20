import type {
  GroundedAnswerabilityResult,
  GroundedClaim,
  GroundedPlan,
} from "@knosys-rag/inference";

import { AnsweringError } from "./errors.js";

export const GROUNDED_DERIVATION_GUIDANCE_VERSION =
  "transparent-grounded-derivations-v1" as const;

export function groundedPlanningQuestion(question: string): string {
  return `${question.trim()}\n\nApplication grounding guidance (${GROUNDED_DERIVATION_GUIDANCE_VERSION}): You may transparently derive arithmetic or dates from quantities, dates, and conditions stated by the user together with cited evidence. State the calculation and assumptions in the grounded claim, and cite every evidence item used. Do not introduce unstated inputs.`;
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stripEvidenceMarkers(text: string, evidenceIds: readonly string[]): string {
  return evidenceIds
    .reduce(
      (cleaned, id) =>
        cleaned.replaceAll(`[${id}]`, "").replaceAll(`(${id})`, ""),
      text,
    )
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function validateClaims(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
  requireClaims: boolean,
): readonly GroundedClaim[] {
  if (!Array.isArray(value) || (requireClaims && value.length === 0)) {
    throw new AnsweringError(
      "INVALID_PLAN",
      requireClaims
        ? "An answer plan must contain at least one claim."
        : "Plan claims must be an array.",
    );
  }

  const claims: GroundedClaim[] = [];
  const unknownIds = new Set<string>();
  for (const claim of value) {
    if (typeof claim !== "object" || claim === null) {
      throw new AnsweringError("INVALID_PLAN", "Every plan claim must be an object.");
    }
    const record = claim as Record<string, unknown>;
    if (!nonEmptyString(record.text)) {
      throw new AnsweringError("INVALID_PLAN", "Every plan claim must contain text.");
    }
    if (!Array.isArray(record.evidenceIds) || record.evidenceIds.length === 0) {
      throw new AnsweringError(
        "INVALID_PLAN",
        "Every plan claim must cite at least one evidence ID.",
      );
    }

    const claimIds: string[] = [];
    for (const id of record.evidenceIds) {
      if (typeof id !== "string" || id.length === 0) {
        throw new AnsweringError("INVALID_PLAN", "Claim evidence IDs must be strings.");
      }
      if (!evidenceIds.has(id)) unknownIds.add(id);
      if (!claimIds.includes(id)) claimIds.push(id);
    }
    const text = stripEvidenceMarkers(record.text.trim(), claimIds);
    if (text.length === 0) {
      throw new AnsweringError(
        "INVALID_PLAN",
        "A plan claim cannot contain only evidence markers.",
      );
    }
    claims.push({ evidenceIds: claimIds, text });
  }

  if (unknownIds.size > 0) {
    throw new AnsweringError(
      "INVALID_PLAN",
      "The grounded plan references evidence that was not provided.",
      { evidenceIds: [...unknownIds] },
    );
  }
  return claims;
}

export function validateGroundedPlan(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): GroundedPlan {
  if (typeof value !== "object" || value === null) {
    throw new AnsweringError("INVALID_PLAN", "The grounded plan must be an object.");
  }

  const plan = value as Record<string, unknown>;
  if (plan.type === "answer") {
    if (!nonEmptyString(plan.answer)) {
      throw new AnsweringError("INVALID_PLAN", "An answer plan must contain an answer.");
    }
    const answer = stripEvidenceMarkers(plan.answer.trim(), [...evidenceIds]);
    if (answer.length === 0) {
      throw new AnsweringError(
        "INVALID_PLAN",
        "An answer plan cannot contain only evidence markers.",
      );
    }
    return {
      answer,
      claims: validateClaims(plan.claims, evidenceIds, true),
      type: "answer",
    };
  }

  if (plan.type === "insufficient-evidence") {
    if (!nonEmptyString(plan.reason)) {
      throw new AnsweringError(
        "INVALID_PLAN",
        "An insufficient-evidence plan must contain a reason.",
      );
    }
    return {
      claims: validateClaims(plan.claims, evidenceIds, false),
      reason: plan.reason.trim(),
      type: "insufficient-evidence",
    };
  }

  throw new AnsweringError(
    "INVALID_PLAN",
    "The grounded plan type must be answer or insufficient-evidence.",
  );
}

export function validateGroundedAnswerability(
  value: unknown,
  evidenceIds: ReadonlySet<string>,
): GroundedAnswerabilityResult {
  if (typeof value !== "object" || value === null) {
    throw new AnsweringError(
      "INVALID_ANSWERABILITY",
      "The answerability result must be an object.",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).length !== 1 ||
    !Array.isArray(record.evidenceIds) ||
    record.evidenceIds.length > evidenceIds.size
  ) {
    throw new AnsweringError(
      "INVALID_ANSWERABILITY",
      "The answerability result must contain one bounded evidenceIds array.",
    );
  }
  const selected = record.evidenceIds;
  if (!selected.every((id) => typeof id === "string" && id.length > 0)) {
    throw new AnsweringError(
      "INVALID_ANSWERABILITY",
      "Answerability evidence IDs must be non-empty strings.",
    );
  }
  const unique = new Set(selected as string[]);
  if (unique.size !== selected.length) {
    throw new AnsweringError(
      "INVALID_ANSWERABILITY",
      "Answerability evidence IDs must be unique.",
    );
  }
  const unknownIds = (selected as string[]).filter((id) => !evidenceIds.has(id));
  if (unknownIds.length > 0) {
    throw new AnsweringError(
      "INVALID_ANSWERABILITY",
      "The answerability result references evidence that was not provided.",
      { evidenceIds: unknownIds },
    );
  }
  return { evidenceIds: selected as string[] };
}

function assembleClaims(claims: readonly GroundedClaim[]): readonly string[] {
  return claims.map((claim) => {
    const markers = claim.evidenceIds.map((id) => `[${id}]`).join(" ");
    return `${claim.text.trim()} ${markers}`;
  });
}

export function assembleGroundedPlan(plan: GroundedPlan): string {
  const claims = assembleClaims(plan.claims);
  if (plan.type === "answer") return claims.join("\n\n");
  return [plan.reason.trim(), ...claims].join("\n\n");
}
