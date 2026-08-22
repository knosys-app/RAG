import type {
  AnswerProvenance,
  AnswerProvenanceV1,
  ChatCitation,
  ChatMessage,
} from "@knosys-rag/contracts";

export type AnswerBlockKind = "conflict" | "library" | "memory" | "model" | "plain";

// A recalled conversation memory backing a memory statement, resolved from
// the provenance snapshot (so it survives source-thread deletion).
export interface AnswerMemoryRef {
  readonly content: string;
  readonly id: string;
  readonly threadDate: string;
  readonly threadId: string;
  readonly threadTitle: string;
}

export interface AnswerBlock {
  readonly citations: readonly ChatCitation[];
  readonly contradicting: readonly ChatCitation[];
  readonly key: string;
  readonly kind: AnswerBlockKind;
  readonly memories: readonly AnswerMemoryRef[];
  readonly text: string;
}

interface ProvenanceStage {
  readonly fallbackReason: string | null;
  readonly status: "completed" | "failed" | "skipped";
}

export interface FallbackStage {
  readonly label: string;
  readonly name: string;
  readonly stage: ProvenanceStage;
}

export interface AnswerModel {
  readonly blocks: readonly AnswerBlock[];
  readonly fallbackStages: readonly FallbackStage[];
  readonly hasMemory: boolean;
  readonly hasModelKnowledge: boolean;
  readonly hasProvenance: boolean;
}

function orderedProvenanceStatements(provenance: AnswerProvenanceV1) {
  return provenance.finalSections
    .flatMap(({ statements }) => statements)
    .sort(
      (left, right) =>
        Number(left.statementId.slice(1)) - Number(right.statementId.slice(1)),
    );
}

function provenanceStageLabel(name: string): string {
  switch (name) {
    case "background":
      return "Background";
    case "memory":
      return "Memory";
    case "library":
      return "Library";
    case "reconciliation":
      return "Reconciliation";
    case "synthesis":
      return "Synthesis";
    case "generation":
      return "Generation";
    case "verification":
      return "Verification";
    default:
      return name;
  }
}

export function fallbackProvenanceStages(
  provenance: AnswerProvenance,
): readonly FallbackStage[] {
  const names =
    provenance.version === 1
      ? (["background", "library", "reconciliation", "synthesis", "verification"] as const)
      : (["library", "generation", "verification"] as const);
  const stages: FallbackStage[] = names.flatMap((name) => {
    const stage =
      provenance.version === 1
        ? provenance.stages[name as keyof AnswerProvenanceV1["stages"]]
        : provenance.stages[name as "generation" | "library" | "verification"];
    return stage.status === "completed" && stage.fallbackReason === null
      ? []
      : [{ label: provenanceStageLabel(name), name, stage }];
  });
  // A skipped memory stage (no relevant memories) is the normal case and not
  // worth surfacing; only a failed recall is.
  if (provenance.version === 3 && provenance.memory.stage.status === "failed") {
    stages.push({
      label: provenanceStageLabel("memory"),
      name: "memory",
      stage: provenance.memory.stage,
    });
  }
  return stages;
}

export function describeFallbackStage(entry: FallbackStage): string {
  const reason = entry.stage.fallbackReason;
  return `${entry.label} ${entry.stage.status}${
    reason ? `, fallback reason: ${reason.replaceAll("-", " ")}` : ""
  }`;
}

export function normalizeAnswer(message: ChatMessage): AnswerModel {
  const provenance = message.answerProvenance;
  const citationsByEvidenceId = new Map(
    message.citations.map((citation) => [citation.evidenceId, citation]),
  );
  const resolve = (evidenceIds: readonly string[]): readonly ChatCitation[] =>
    evidenceIds
      .map((evidenceId) => citationsByEvidenceId.get(evidenceId))
      .filter((citation): citation is ChatCitation => citation !== undefined);

  if (provenance?.version === 2 || provenance?.version === 3) {
    const memoriesById = new Map(
      provenance.version === 3
        ? provenance.memory.memories.map((memory) => [memory.id, memory])
        : [],
    );
    return {
      blocks: provenance.statements.map((statement) => ({
        citations: resolve(statement.evidenceIds),
        contradicting: [],
        key: statement.statementId,
        kind: statement.kind,
        memories:
          "memoryIds" in statement
            ? statement.memoryIds
                .map((memoryId) => memoriesById.get(memoryId))
                .filter((memory): memory is AnswerMemoryRef => memory !== undefined)
            : [],
        text: statement.text,
      })),
      fallbackStages: fallbackProvenanceStages(provenance),
      hasMemory:
        provenance.version === 3 &&
        provenance.statements.some(({ kind }) => kind === "memory"),
      hasModelKnowledge: provenance.statements.some(({ kind }) => kind === "model"),
      hasProvenance: true,
    };
  }

  if (provenance) {
    const statements = orderedProvenanceStatements(provenance);
    return {
      blocks: statements.map((statement) => ({
        citations:
          statement.sectionKind === "model-background"
            ? []
            : resolve(statement.supportingEvidenceIds),
        contradicting:
          statement.sectionKind === "model-background"
            ? []
            : resolve(statement.contradictingEvidenceIds),
        key: statement.statementId,
        kind:
          statement.sectionKind === "model-background"
            ? "model"
            : statement.sectionKind === "conflict"
              ? "conflict"
              : "library",
        memories: [],
        text: statement.text,
      })),
      fallbackStages: fallbackProvenanceStages(provenance),
      hasMemory: false,
      hasModelKnowledge: statements.some(
        ({ sectionKind }) => sectionKind === "model-background",
      ),
      hasProvenance: true,
    };
  }

  return {
    blocks:
      message.content.length > 0
        ? [
            {
              citations: message.citations,
              contradicting: [],
              key: message.id,
              kind: "plain",
              memories: [],
              text: message.content,
            },
          ]
        : [],
    fallbackStages: [],
    hasMemory: false,
    hasModelKnowledge: false,
    hasProvenance: false,
  };
}

const EVIDENCE_MARKER_PATTERN = /\[(E[1-9]\d*)\]/g;
export const EVIDENCE_LINK_PREFIX = "#evidence:";

/**
 * Rewrites literal [E1]-style markers in strict-grounded content into
 * markdown links (`[1](#evidence:<citationId>)`) so the markdown renderer can
 * turn them into citation chips. Unmatched markers stay as literal text.
 */
export function linkEvidenceMarkers(
  content: string,
  citations: readonly ChatCitation[],
): { readonly linked: string; readonly matchedCitationIds: ReadonlySet<string> } {
  const byEvidenceId = new Map(
    citations.map((citation) => [citation.evidenceId, citation]),
  );
  const matchedCitationIds = new Set<string>();
  const linked = content.replace(
    EVIDENCE_MARKER_PATTERN,
    (full, evidenceId: string) => {
      const citation = byEvidenceId.get(evidenceId);
      if (!citation) return full;
      matchedCitationIds.add(citation.id);
      const ordinal = citations.indexOf(citation) + 1;
      return `[${String(ordinal)}](${EVIDENCE_LINK_PREFIX}${citation.id})`;
    },
  );
  return { linked, matchedCitationIds };
}
