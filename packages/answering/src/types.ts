import type {
  AnswerStreamProvider,
  CanonicalLibraryClaim,
  CanonicalModelClaim,
  EvidenceFirstStatement,
  GroundedAnswerabilityProvider,
  GroundedPlan,
  GroundedPlanProvider,
} from "@knosys-rag/inference";
import type {
  RetrievalComponentScore,
  RetrievalResult,
  SourceLocator,
} from "@knosys-rag/retrieval";

import type {
  EvidenceConfidenceAssessment,
  EvidenceConfidenceEnvironment,
} from "./confidence.js";
import type {
  ClassifiedModelClaim,
  RenderedHybridSection,
} from "./hybrid.js";

export interface AnswerProvenanceStage {
  readonly fallbackReason: string | null;
  readonly status: "completed" | "failed" | "skipped";
}

export interface AnswerProvenanceV1 {
  readonly classifications: readonly ClassifiedModelClaim[];
  readonly finalSections: readonly RenderedHybridSection[];
  readonly generationModel: {
    readonly digest: string;
    readonly model: string;
  };
  readonly libraryClaims: readonly CanonicalLibraryClaim[];
  readonly mode: "labeled-hybrid";
  readonly modelClaims: readonly CanonicalModelClaim[];
  readonly promptVersions: {
    readonly closedBook: string;
    readonly contextualization: string | null;
    readonly groundedDerivation: string;
    readonly reconciliation: string;
    readonly synthesis: string;
    readonly verification: string;
  };
  readonly stages: {
    readonly background: AnswerProvenanceStage;
    readonly library: AnswerProvenanceStage;
    readonly reconciliation: AnswerProvenanceStage;
    readonly synthesis: AnswerProvenanceStage;
    readonly verification: AnswerProvenanceStage;
  };
  readonly version: 1;
}

export interface AnswerProvenanceV2 {
  readonly generationModel: {
    readonly digest: string;
    readonly model: string;
  };
  readonly mode: "labeled-hybrid";
  readonly promptVersions: {
    readonly contextualization: string | null;
    readonly evidenceAnswer: string;
    readonly groundedDerivation: string;
    readonly modelDraft: string | null;
    readonly verification: string;
  };
  readonly stages: {
    readonly generation: AnswerProvenanceStage;
    readonly library: AnswerProvenanceStage;
    readonly verification: AnswerProvenanceStage;
  };
  readonly statements: readonly EvidenceFirstStatement[];
  readonly version: 2;
}

// A recalled cross-conversation memory snapshotted into provenance at answer
// time, so a memory statement stays explainable after its source thread is
// renamed or deleted.
export interface RecalledMemoryProvenance {
  readonly content: string;
  readonly id: string;
  readonly threadDate: string;
  readonly threadId: string;
  readonly threadTitle: string;
}

export interface AnswerProvenanceV3 {
  readonly generationModel: {
    readonly digest: string;
    readonly model: string;
  };
  readonly memory: {
    readonly memories: readonly RecalledMemoryProvenance[];
    readonly stage: AnswerProvenanceStage;
  };
  readonly mode: "labeled-hybrid";
  readonly promptVersions: {
    readonly contextualization: string | null;
    readonly evidenceAnswer: string;
    readonly groundedDerivation: string;
    readonly modelDraft: string | null;
    readonly verification: string;
  };
  readonly stages: {
    readonly generation: AnswerProvenanceStage;
    readonly library: AnswerProvenanceStage;
    readonly verification: AnswerProvenanceStage;
  };
  readonly statements: readonly EvidenceFirstStatement[];
  readonly version: 3;
}

export type AnswerProvenance =
  | AnswerProvenanceV1
  | AnswerProvenanceV2
  | AnswerProvenanceV3;

export interface AnswerContextLimits {
  readonly maxCharacters: number;
  readonly maxItems: number;
}

export interface CitationSnapshot {
  readonly chunkId: string;
  readonly components: readonly RetrievalComponentScore[];
  readonly id: string;
  readonly score: number;
  readonly source: SourceLocator;
  readonly text: string;
}

export interface AnswerRunRequest {
  readonly question: string;
  readonly retrievalResult: RetrievalResult;
}

export interface GroundedAnswerOrchestratorOptions {
  readonly answerabilityProvider: GroundedAnswerabilityProvider;
  readonly answerStreamProvider: AnswerStreamProvider;
  readonly confidenceEnvironment: EvidenceConfidenceEnvironment;
  readonly contextLimits?: Partial<AnswerContextLimits>;
  readonly delivery?: "deterministic" | "stream";
  readonly planProvider: GroundedPlanProvider;
}

export interface GroundedAnswerInput extends AnswerRunRequest {
  readonly answerabilityProvider: GroundedAnswerabilityProvider;
  readonly answerStreamProvider: AnswerStreamProvider;
  readonly confidenceEnvironment: EvidenceConfidenceEnvironment;
  readonly contextLimits?: Partial<AnswerContextLimits>;
  readonly planProvider: GroundedPlanProvider;
}

export type AnswerProgressStatus = "planning" | "routing" | "streaming";
export type AnswerResultStatus = "answer" | "fallback" | "insufficient-evidence";
export type AnswerRunStatus = AnswerProgressStatus | AnswerResultStatus;

export type CitationFallbackReason =
  | "malformed-citation"
  | "missing-citation"
  | "unknown-citation";

export interface GroundedAnswerResult {
  readonly citations: readonly CitationSnapshot[];
  readonly fallbackReason: CitationFallbackReason | null;
  readonly plan: GroundedPlan;
  readonly replacesProvisionalText: boolean;
  readonly status: AnswerResultStatus;
  readonly text: string;
  readonly routingDiagnostics: AnswerRoutingDiagnostics;
}

export interface AnswerRoutingDiagnostics {
  readonly confidence: EvidenceConfidenceAssessment;
  readonly modelAssessment: {
    readonly durationMs: number;
    readonly evidenceIds: readonly string[];
  } | null;
  readonly route:
    | "deterministic-direct"
    | "deterministic-reject"
    | "model-answerability";
  readonly version: 1;
}

export interface AnswerStatusEvent {
  readonly status: AnswerProgressStatus;
  readonly type: "status";
}

export interface AnswerTextEvent {
  readonly provisional: true;
  readonly text: string;
  readonly type: "text";
}

export interface AnswerResultEvent {
  readonly result: GroundedAnswerResult;
  readonly type: "result";
}

export interface AnswerRoutingEvent {
  readonly diagnostics: AnswerRoutingDiagnostics;
  readonly type: "routing";
}

export type AnswerRunEvent =
  | AnswerResultEvent
  | AnswerRoutingEvent
  | AnswerStatusEvent
  | AnswerTextEvent;
