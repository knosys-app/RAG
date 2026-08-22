import type {
  CanonicalLibraryClaim,
  CanonicalModelClaim,
  ClaimReconciliationAssessment,
  ClaimReconciliationResult,
  EvidenceFirstAnswerResult,
  EvidenceFirstStatement,
  EvidenceFirstVerificationResult,
  HybridEvidenceId,
  HybridStatementId,
  HybridSynthesisResult,
  HybridSynthesisSectionKind,
  HybridSynthesisStatement,
  LibraryClaimId,
  ModelClaimId,
  SynthesisVerificationResult,
} from "@knosys-rag/inference";

import { AnsweringError } from "./errors.js";

export type ModelClaimClassification =
  | "supported"
  | "contradicted"
  | "mixed"
  | "unverified";

export interface ClassifiedModelClaim extends ClaimReconciliationAssessment {
  readonly classification: ModelClaimClassification;
}

export interface HybridEvidenceRelations {
  readonly contradictingEvidenceIds: readonly HybridEvidenceId[];
  readonly supportingEvidenceIds: readonly HybridEvidenceId[];
}

export interface VerifiedHybridStatement extends HybridEvidenceRelations {
  readonly sectionKind: HybridSynthesisSectionKind;
  readonly sourceClaimIds: readonly (LibraryClaimId | ModelClaimId)[];
  readonly statementId: HybridStatementId;
  readonly text: string;
}

export interface RenderedHybridSection {
  readonly kind: HybridSynthesisSectionKind;
  readonly statements: readonly VerifiedHybridStatement[];
  readonly title: string;
}

const SECTION_ORDER: readonly HybridSynthesisSectionKind[] = [
  "library",
  "conflict",
  "model-background",
];

const SECTION_TITLES: Readonly<Record<HybridSynthesisSectionKind, string>> = {
  conflict: "Conflicts",
  library: "From your library",
  "model-background": "Model background (unverified)",
};
const PROVENANCE_MARKER_PATTERN =
  /\[[^\]\r\n]{1,256}\]|\u3010[^\u3011\r\n]{1,256}\u3011|\b(?:E|L|M|S)[1-9]\d*\b/;

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function classify(assessment: ClaimReconciliationAssessment): ModelClaimClassification {
  const supported = assessment.supportingEvidenceIds.length > 0;
  const contradicted = assessment.contradictingEvidenceIds.length > 0;
  if (supported && contradicted) return "mixed";
  if (supported) return "supported";
  if (contradicted) return "contradicted";
  return "unverified";
}

function invalidHybrid(message: string, details?: unknown): never {
  throw new AnsweringError("INVALID_PLAN", message, details);
}

function assertUniqueCatalog<T extends { readonly id: string }>(
  catalog: readonly T[],
  description: string,
): void {
  if (new Set(catalog.map(({ id }) => id)).size !== catalog.length) {
    invalidHybrid(`${description} IDs must be unique.`);
  }
}

function assertMarkerFreeText(text: string, description: string): void {
  if (
    text.trim().length === 0 ||
    text.length > 8_000 ||
    PROVENANCE_MARKER_PATTERN.test(text)
  ) {
    invalidHybrid(`${description} must contain bounded marker-free text.`);
  }
}

export function validateHybridCatalog(
  modelClaims: readonly CanonicalModelClaim[],
  libraryClaims: readonly CanonicalLibraryClaim[],
  evidenceIds: ReadonlySet<HybridEvidenceId>,
): void {
  assertUniqueCatalog(modelClaims, "Model claim");
  assertUniqueCatalog(libraryClaims, "Library claim");
  for (const claim of modelClaims) assertMarkerFreeText(claim.text, "Model claim");
  for (const claim of libraryClaims) {
    assertMarkerFreeText(claim.text, "Library claim");
    if (
      claim.evidenceIds.length === 0 ||
      new Set(claim.evidenceIds).size !== claim.evidenceIds.length ||
      claim.evidenceIds.some((id) => !evidenceIds.has(id))
    ) {
      invalidHybrid("A library claim has invalid evidence relationships.");
    }
  }
}

export function conservativeReconciliation(
  modelClaims: readonly CanonicalModelClaim[],
): ClaimReconciliationResult {
  return {
    assessments: modelClaims.map(({ id }) => ({
      contradictingEvidenceIds: [],
      equivalentLibraryClaimIds: [],
      modelClaimId: id,
      supportingEvidenceIds: [],
    })),
    version: 1,
  };
}

export function validateClaimReconciliation(
  value: ClaimReconciliationResult,
  modelClaims: readonly CanonicalModelClaim[],
  libraryClaims: readonly CanonicalLibraryClaim[],
  evidenceIds: ReadonlySet<HybridEvidenceId>,
): readonly ClassifiedModelClaim[] {
  validateHybridCatalog(modelClaims, libraryClaims, evidenceIds);
  const modelIds = new Set(modelClaims.map(({ id }) => id));
  const libraryIds = new Set(libraryClaims.map(({ id }) => id));
  const assessments = value.assessments;
  if (
    value.version !== 1 ||
    assessments.length !== modelClaims.length ||
    new Set(assessments.map(({ modelClaimId }) => modelClaimId)).size !==
      assessments.length
  ) {
    invalidHybrid("Reconciliation must assess every model claim exactly once.");
  }

  return assessments.map((assessment) => {
    const supporting = assessment.supportingEvidenceIds;
    const contradicting = assessment.contradictingEvidenceIds;
    if (!modelIds.has(assessment.modelClaimId)) {
      invalidHybrid("Reconciliation references an unknown model claim.", assessment.modelClaimId);
    }
    if (
      new Set(supporting).size !== supporting.length ||
      new Set(contradicting).size !== contradicting.length ||
      new Set(assessment.equivalentLibraryClaimIds).size !==
        assessment.equivalentLibraryClaimIds.length
    ) {
      invalidHybrid("Reconciliation relationships must be unique.");
    }
    if (
      supporting.some((id) => !evidenceIds.has(id)) ||
      contradicting.some((id) => !evidenceIds.has(id)) ||
      assessment.equivalentLibraryClaimIds.some((id) => !libraryIds.has(id))
    ) {
      invalidHybrid("Reconciliation references evidence or claims outside the catalog.");
    }
    if (supporting.some((id) => contradicting.includes(id))) {
      invalidHybrid("Evidence cannot both support and contradict one model claim.");
    }
    return { ...assessment, classification: classify(assessment) };
  });
}

function validateStatementLane(
  statement: HybridSynthesisStatement,
  modelIds: ReadonlySet<ModelClaimId>,
  libraryIds: ReadonlySet<LibraryClaimId>,
  classifications: ReadonlyMap<ModelClaimId, ModelClaimClassification>,
): void {
  if (statement.sourceClaimIds.length === 0) {
    invalidHybrid("Every synthesis statement must declare a source claim.");
  }
  const sourceIds = new Set(statement.sourceClaimIds);
  if (sourceIds.size !== statement.sourceClaimIds.length) {
    invalidHybrid("Synthesis source claim IDs must be unique.");
  }
  const modelSources = statement.sourceClaimIds.filter(
    (id): id is ModelClaimId => id.startsWith("M"),
  );
  const librarySources = statement.sourceClaimIds.filter(
    (id): id is LibraryClaimId => id.startsWith("L"),
  );
  if (
    modelSources.some((id) => !modelIds.has(id)) ||
    librarySources.some((id) => !libraryIds.has(id))
  ) {
    invalidHybrid("A synthesis statement references an unknown source claim.");
  }
  const modelClasses = modelSources.map((id) => classifications.get(id));
  const eligible =
    statement.sectionKind === "library"
      ? modelClasses.every((value) => value === "supported")
      : statement.sectionKind === "conflict"
        ? modelSources.length > 0 &&
          modelClasses.every((value) => value === "contradicted" || value === "mixed")
        : librarySources.length === 0 &&
          modelSources.length > 0 &&
          modelClasses.every((value) => value === "unverified");
  if (!eligible) {
    invalidHybrid("A synthesis statement is not eligible for its provenance lane.", {
      statementId: statement.statementId,
    });
  }
}

export function validateHybridSynthesis(
  value: HybridSynthesisResult,
  modelClaims: readonly CanonicalModelClaim[],
  libraryClaims: readonly CanonicalLibraryClaim[],
  classifications: readonly ClassifiedModelClaim[],
): readonly HybridSynthesisStatement[] {
  if (value.version !== 1 || value.statements.length === 0) {
    invalidHybrid("Hybrid synthesis must contain at least one statement.");
  }
  const statementIds = new Set(value.statements.map(({ statementId }) => statementId));
  if (statementIds.size !== value.statements.length) {
    invalidHybrid("Hybrid synthesis statement IDs must be unique.");
  }
  if (
    value.statements.some(
      ({ statementId }, index) => statementId !== `S${index + 1}`,
    )
  ) {
    invalidHybrid("Hybrid synthesis statement IDs must be consecutive in narrative order.");
  }
  const modelIds = new Set(modelClaims.map(({ id }) => id));
  const libraryIds = new Set(libraryClaims.map(({ id }) => id));
  const classes = new Map(
    classifications.map(({ classification, modelClaimId }) => [
      modelClaimId,
      classification,
    ]),
  );
  for (const statement of value.statements) {
    assertMarkerFreeText(statement.text, "Synthesis statement");
    validateStatementLane(statement, modelIds, libraryIds, classes);
  }
  const representedClaimIds = new Set(
    value.statements.flatMap(({ sourceClaimIds }) => sourceClaimIds),
  );
  const missingClaimIds = [...modelIds, ...libraryIds].filter(
    (id) => !representedClaimIds.has(id),
  );
  if (missingClaimIds.length > 0) {
    invalidHybrid("Hybrid synthesis must represent every canonical claim.", {
      missingClaimIds,
    });
  }
  return value.statements;
}

export function validateSynthesisVerification(
  value: SynthesisVerificationResult,
  statements: readonly HybridSynthesisStatement[],
): boolean {
  const statementIds = new Set(statements.map(({ statementId }) => statementId));
  const assessmentIds = new Set(value.assessments.map(({ statementId }) => statementId));
  if (
    value.version !== 1 ||
    value.assessments.length !== statements.length ||
    assessmentIds.size !== value.assessments.length ||
    [...statementIds].some((id) => !assessmentIds.has(id)) ||
    [...assessmentIds].some((id) => !statementIds.has(id))
  ) {
    invalidHybrid("Synthesis verification must assess every statement exactly once.");
  }
  return value.assessments.every(({ faithful }) => faithful);
}

export function attachEvidenceRelations(
  statements: readonly HybridSynthesisStatement[],
  libraryClaims: readonly CanonicalLibraryClaim[],
  classifications: readonly ClassifiedModelClaim[],
): readonly VerifiedHybridStatement[] {
  const libraryById = new Map(libraryClaims.map((claim) => [claim.id, claim]));
  const modelById = new Map(classifications.map((claim) => [claim.modelClaimId, claim]));
  return statements.map((statement) => {
    const supporting: HybridEvidenceId[] = [];
    const contradicting: HybridEvidenceId[] = [];
    for (const sourceId of statement.sourceClaimIds) {
      if (sourceId.startsWith("L")) {
        supporting.push(...(libraryById.get(sourceId as LibraryClaimId)?.evidenceIds ?? []));
      } else {
        const assessment = modelById.get(sourceId as ModelClaimId);
        if (assessment !== undefined) {
          supporting.push(...assessment.supportingEvidenceIds);
          contradicting.push(...assessment.contradictingEvidenceIds);
        }
      }
    }
    return {
      ...statement,
      contradictingEvidenceIds: unique(contradicting),
      supportingEvidenceIds: unique(supporting),
    };
  });
}

export function canonicalHybridStatements(
  modelClaims: readonly CanonicalModelClaim[],
  libraryClaims: readonly CanonicalLibraryClaim[],
  classifications: readonly ClassifiedModelClaim[],
): readonly VerifiedHybridStatement[] {
  const statements: HybridSynthesisStatement[] = [];
  for (const claim of libraryClaims) {
    statements.push({
      sectionKind: "library",
      sourceClaimIds: [claim.id],
      statementId: `S${statements.length + 1}`,
      text: claim.text,
    });
  }
  const classificationById = new Map(
    classifications.map((assessment) => [assessment.modelClaimId, assessment]),
  );
  for (const claim of modelClaims) {
    const assessment = classificationById.get(claim.id);
    if (assessment === undefined) continue;
    statements.push({
      sectionKind:
        assessment.classification === "supported"
          ? "library"
          : assessment.classification === "unverified"
            ? "model-background"
            : "conflict",
      sourceClaimIds: [claim.id],
      statementId: `S${statements.length + 1}`,
      text: claim.text,
    });
  }
  return attachEvidenceRelations(statements, libraryClaims, classifications);
}

export function sectionHybridStatements(
  statements: readonly VerifiedHybridStatement[],
): readonly RenderedHybridSection[] {
  return SECTION_ORDER.flatMap((kind) => {
    const matching = statements.filter((statement) => statement.sectionKind === kind);
    return matching.length === 0
      ? []
      : [{ kind, statements: matching, title: SECTION_TITLES[kind] }];
  });
}

function markers(ids: readonly HybridEvidenceId[]): string {
  return ids.map((id) => `[${id}]`).join(" ");
}

export function renderHybridNarrative(
  statements: readonly VerifiedHybridStatement[],
): string {
  return statements
    .map((statement) => {
      const supporting = markers(statement.supportingEvidenceIds);
      const contradicting = markers(statement.contradictingEvidenceIds);
      if (statement.sectionKind === "conflict") {
        return [
          statement.text.trim(),
          "Conflicts with your library.",
          ...(supporting.length === 0 ? [] : [`Supporting evidence: ${supporting}`]),
          ...(contradicting.length === 0
            ? []
            : [`Contradicting evidence: ${contradicting}`]),
        ].join("\n");
      }
      if (statement.sectionKind === "model-background") {
        return [
          statement.text.trim(),
          "Model knowledge (not verified by your library).",
        ].join("\n");
      }
      return supporting.length === 0
        ? statement.text.trim()
        : `${statement.text.trim()} ${supporting}`;
    })
    .join("\n\n");
}

export function validateEvidenceFirstAnswer(
  value: EvidenceFirstAnswerResult,
  evidenceIds: ReadonlySet<HybridEvidenceId>,
  memoryIds: ReadonlySet<string> = new Set(),
): readonly EvidenceFirstStatement[] {
  if (value.version !== 1 || value.statements.length === 0) {
    invalidHybrid("Evidence-first generation must contain at least one statement.");
  }
  for (const [index, statement] of value.statements.entries()) {
    assertMarkerFreeText(statement.text, "Evidence-first statement");
    if (statement.statementId !== `S${index + 1}`) {
      invalidHybrid("Evidence-first statement IDs must be consecutive in narrative order.");
    }
    if (new Set(statement.evidenceIds).size !== statement.evidenceIds.length) {
      invalidHybrid("Evidence-first statement evidence IDs must be unique.");
    }
    if (statement.evidenceIds.some((id) => !evidenceIds.has(id))) {
      invalidHybrid("An evidence-first statement references unknown evidence.");
    }
    if (new Set(statement.memoryIds).size !== statement.memoryIds.length) {
      invalidHybrid("Evidence-first statement memory IDs must be unique.");
    }
    if (statement.memoryIds.some((id) => !memoryIds.has(id))) {
      invalidHybrid("An evidence-first statement references an unknown memory.");
    }
    if (
      (statement.kind === "library" &&
        (statement.evidenceIds.length === 0 || statement.memoryIds.length > 0)) ||
      (statement.kind === "model" &&
        (statement.evidenceIds.length > 0 || statement.memoryIds.length > 0)) ||
      (statement.kind === "memory" &&
        (statement.memoryIds.length === 0 || statement.evidenceIds.length > 0))
    ) {
      invalidHybrid("An evidence-first statement has an invalid provenance kind.");
    }
  }
  return value.statements;
}

export function validateEvidenceFirstVerification(
  value: EvidenceFirstVerificationResult,
  statements: readonly EvidenceFirstStatement[],
): boolean {
  const statementIds = statements.map(({ statementId }) => statementId);
  const assessmentIds = value.assessments.map(({ statementId }) => statementId);
  if (
    value.version !== 1 ||
    assessmentIds.length !== statementIds.length ||
    new Set(assessmentIds).size !== assessmentIds.length ||
    statementIds.some((id) => !assessmentIds.includes(id)) ||
    assessmentIds.some((id) => !statementIds.includes(id))
  ) {
    invalidHybrid("Evidence-first verification must assess every statement exactly once.");
  }
  return value.assessments.every(({ acceptable }) => acceptable);
}

export function canonicalEvidenceFirstStatements(
  libraryClaims: readonly CanonicalLibraryClaim[],
): readonly EvidenceFirstStatement[] {
  return libraryClaims.map((claim, index) => ({
    evidenceIds: claim.evidenceIds,
    kind: "library",
    memoryIds: [],
    statementId: `S${index + 1}`,
    text: claim.text,
  }));
}

export function renderEvidenceFirstNarrative(
  statements: readonly EvidenceFirstStatement[],
): string {
  return statements.map(({ text }) => text.trim()).join("\n\n");
}

// Turn the model's own closed-book claims into labeled model statements. Used
// as the hybrid fallback so a library-silent question still yields the model's
// answer (clearly marked as model knowledge) instead of a bare refusal.
export function modelStatementsFromClaims(
  claims: readonly { readonly text: string }[],
): readonly EvidenceFirstStatement[] {
  return claims
    .map((claim) => claim.text.trim())
    .filter((text) => text.length > 0)
    .map((text, index) => ({
      evidenceIds: [],
      kind: "model",
      memoryIds: [],
      statementId: `S${index + 1}`,
      text,
    }));
}
