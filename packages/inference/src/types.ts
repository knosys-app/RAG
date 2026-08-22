export type ModelCapability =
  | "completion"
  | "embedding"
  | "insert"
  | "thinking"
  | "tools"
  | "vision";

export interface ModelDescriptor {
  readonly capabilities: readonly ModelCapability[];
  readonly digest: string;
  readonly family: string | null;
  readonly local: boolean;
  readonly metadataError: string | null;
  readonly name: string;
  readonly nativeContextWindow: number | null;
  readonly parameterSize: string | null;
  readonly provider: string;
  readonly quantizationLevel: string | null;
  readonly remoteHost: string | null;
  readonly remoteModel: string | null;
  readonly sizeBytes: number;
}

export interface EmbeddingModelProfile {
  readonly dimensions: number;
  readonly l2NormTolerance: number;
  readonly model: string;
}

export interface GenerationModelProfile {
  readonly contextWindow: number;
  readonly model: string;
  readonly temperature: number;
}

export interface InferenceRequestOptions {
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface ConversationMessage {
  readonly content: string;
  readonly role: "assistant" | "user";
}

export interface QuestionContextualizationRequest {
  readonly history: readonly ConversationMessage[];
  readonly question: string;
}

export interface GroundingEvidence {
  readonly content: string;
  readonly id: string;
  readonly title?: string;
}

export interface GroundedAnswerabilityResult {
  readonly evidenceIds: readonly string[];
}

export interface GroundedClaim {
  readonly evidenceIds: readonly string[];
  readonly text: string;
}

export interface GroundedAnswerPlan {
  readonly answer: string;
  readonly claims: readonly GroundedClaim[];
  readonly type: "answer";
}

export interface InsufficientEvidencePlan {
  readonly claims: readonly GroundedClaim[];
  readonly reason: string;
  readonly type: "insufficient-evidence";
}

export type GroundedPlan = GroundedAnswerPlan | InsufficientEvidencePlan;

export interface GroundedPlanRequest {
  readonly evidence: readonly GroundingEvidence[];
  readonly question: string;
}

export interface AnswerStreamRequest extends GroundedPlanRequest {
  readonly plan: GroundedPlan;
}

export type ModelClaimId = `M${number}`;
export type LibraryClaimId = `L${number}`;
export type HybridEvidenceId = `E${number}`;
export type HybridStatementId = `S${number}`;

export interface ClosedBookAnswerRequest {
  readonly question: string;
}

export interface ClosedBookClaim {
  readonly text: string;
}

export interface ClosedBookAnswerResult {
  readonly answer: string;
  readonly claims: readonly ClosedBookClaim[];
  readonly version: 1;
}

export interface CanonicalModelClaim {
  readonly id: ModelClaimId;
  readonly text: string;
}

export interface CanonicalLibraryClaim {
  readonly evidenceIds: readonly HybridEvidenceId[];
  readonly id: LibraryClaimId;
  readonly text: string;
}

export interface ReconciliationEvidence {
  readonly content: string;
  readonly id: HybridEvidenceId;
  readonly title?: string;
}

export interface EvidenceFirstStatement {
  readonly evidenceIds: readonly HybridEvidenceId[];
  readonly kind: "library" | "model";
  readonly statementId: HybridStatementId;
  readonly text: string;
}

export interface EvidenceFirstAnswerRequest {
  readonly evidence: readonly ReconciliationEvidence[];
  readonly libraryAnswer: string;
  // The model's own closed-book answer, synthesized in as labeled model
  // statements for anything the library evidence does not cover. Optional so
  // callers that only want grounded output can omit it.
  readonly modelDraft?: string;
  readonly originalQuestion: string;
  readonly resolvedQuestion: string;
}

export interface EvidenceFirstAnswerResult {
  readonly statements: readonly EvidenceFirstStatement[];
  readonly version: 1;
}

export type EvidenceFirstAnswerStreamEvent =
  | { readonly statement: EvidenceFirstStatement; readonly type: "statement" }
  | { readonly result: EvidenceFirstAnswerResult; readonly type: "result" };

export interface ModelPullProgress {
  readonly completedBytes: number | null;
  readonly status: string;
  readonly totalBytes: number | null;
}

export interface EvidenceFirstVerificationAssessment {
  readonly acceptable: boolean;
  readonly statementId: HybridStatementId;
}

export interface EvidenceFirstVerificationRequest {
  readonly evidence: readonly ReconciliationEvidence[];
  readonly originalQuestion: string;
  readonly resolvedQuestion: string;
  readonly statements: readonly EvidenceFirstStatement[];
}

export interface EvidenceFirstVerificationResult {
  readonly assessments: readonly EvidenceFirstVerificationAssessment[];
  readonly version: 1;
}

export interface ClaimReconciliationAssessment {
  readonly contradictingEvidenceIds: readonly HybridEvidenceId[];
  readonly equivalentLibraryClaimIds: readonly LibraryClaimId[];
  readonly modelClaimId: ModelClaimId;
  readonly supportingEvidenceIds: readonly HybridEvidenceId[];
}

export interface ClaimReconciliationResult {
  readonly assessments: readonly ClaimReconciliationAssessment[];
  readonly version: 1;
}

export interface ClaimReconciliationRequest {
  readonly evidence: readonly ReconciliationEvidence[];
  readonly libraryClaims: readonly CanonicalLibraryClaim[];
  readonly modelClaims: readonly CanonicalModelClaim[];
  readonly question: string;
}

export type HybridSynthesisSectionKind =
  | "library"
  | "conflict"
  | "model-background";

export interface HybridSynthesisStatement {
  readonly sectionKind: HybridSynthesisSectionKind;
  readonly sourceClaimIds: readonly (LibraryClaimId | ModelClaimId)[];
  readonly statementId: HybridStatementId;
  readonly text: string;
}

export interface HybridSynthesisResult {
  readonly statements: readonly HybridSynthesisStatement[];
  readonly version: 1;
}

export interface HybridSynthesisRequest {
  readonly closedBookAnswer: string;
  readonly libraryAnswer: string;
  readonly libraryClaims: readonly CanonicalLibraryClaim[];
  readonly modelClaims: readonly CanonicalModelClaim[];
  readonly question: string;
  readonly reconciliation: ClaimReconciliationResult;
}

export interface SynthesisVerificationAssessment {
  readonly faithful: boolean;
  readonly statementId: HybridStatementId;
}

export interface SynthesisVerificationResult {
  readonly assessments: readonly SynthesisVerificationAssessment[];
  readonly version: 1;
}

export interface SynthesisVerificationRequest {
  readonly evidence: readonly ReconciliationEvidence[];
  readonly libraryClaims: readonly CanonicalLibraryClaim[];
  readonly modelClaims: readonly CanonicalModelClaim[];
  readonly reconciliation: ClaimReconciliationResult;
  readonly statements: readonly HybridSynthesisStatement[];
}

export interface EmbeddingProvider {
  readonly embeddingProfile: EmbeddingModelProfile;
  embedDocuments(
    documents: readonly string[],
    options?: InferenceRequestOptions,
  ): Promise<readonly (readonly number[])[]>;
  embedQuery(
    query: string,
    options?: InferenceRequestOptions,
  ): Promise<readonly number[]>;
}

export interface QuestionContextualizer {
  readonly generationProfile: GenerationModelProfile;
  contextualizeQuestion(
    request: QuestionContextualizationRequest,
    options?: InferenceRequestOptions,
  ): Promise<string>;
}

export interface GroundedPlanProvider {
  readonly generationProfile: GenerationModelProfile;
  planGroundedAnswer(
    request: GroundedPlanRequest,
    options?: InferenceRequestOptions,
  ): Promise<GroundedAnswerPlan>;
}

export interface GroundedAnswerabilityProvider {
  readonly generationProfile: GenerationModelProfile;
  assessGroundedAnswerability(
    request: GroundedPlanRequest,
    options?: InferenceRequestOptions,
  ): Promise<GroundedAnswerabilityResult>;
}

export interface AnswerStreamProvider {
  readonly generationProfile: GenerationModelProfile;
  streamAnswer(
    request: AnswerStreamRequest,
    options?: InferenceRequestOptions,
  ): AsyncIterable<string>;
}

export interface ClosedBookAnswerProvider {
  readonly generationProfile: GenerationModelProfile;
  generateClosedBookAnswer(
    request: ClosedBookAnswerRequest,
    options?: InferenceRequestOptions,
  ): Promise<ClosedBookAnswerResult>;
}

export interface ClaimReconciliationProvider {
  readonly generationProfile: GenerationModelProfile;
  reconcileClaims(
    request: ClaimReconciliationRequest,
    options?: InferenceRequestOptions,
  ): Promise<ClaimReconciliationResult>;
}

export interface EvidenceFirstAnswerProvider {
  readonly generationProfile: GenerationModelProfile;
  generateEvidenceFirstAnswer(
    request: EvidenceFirstAnswerRequest,
    options?: InferenceRequestOptions,
  ): Promise<EvidenceFirstAnswerResult>;
  streamEvidenceFirstAnswer(
    request: EvidenceFirstAnswerRequest,
    options?: InferenceRequestOptions,
  ): AsyncIterable<EvidenceFirstAnswerStreamEvent>;
}

export interface EvidenceFirstVerificationProvider {
  readonly generationProfile: GenerationModelProfile;
  verifyEvidenceFirstAnswer(
    request: EvidenceFirstVerificationRequest,
    options?: InferenceRequestOptions,
  ): Promise<EvidenceFirstVerificationResult>;
}

export interface HybridSynthesisProvider {
  readonly generationProfile: GenerationModelProfile;
  synthesizeHybridAnswer(
    request: HybridSynthesisRequest,
    options?: InferenceRequestOptions,
  ): Promise<HybridSynthesisResult>;
}

export interface HybridSynthesisVerificationProvider {
  readonly generationProfile: GenerationModelProfile;
  verifyHybridSynthesis(
    request: SynthesisVerificationRequest,
    options?: InferenceRequestOptions,
  ): Promise<SynthesisVerificationResult>;
}
