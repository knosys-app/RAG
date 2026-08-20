import type {
  GroundedPlan,
  InferenceRequestOptions,
  InsufficientEvidencePlan,
} from "@knosys-rag/inference";

import {
  CitationMarkerValidator,
  CitationValidationError,
  citationsForIds,
} from "./citations.js";
import { assessEvidenceConfidence } from "./confidence.js";
import { selectAnswerContext, toGroundingEvidence } from "./context.js";
import { AnsweringError } from "./errors.js";
import {
  assembleGroundedPlan,
  groundedPlanningQuestion,
  validateGroundedAnswerability,
  validateGroundedPlan,
} from "./plan.js";
import type {
  AnswerRoutingDiagnostics,
  AnswerRunEvent,
  AnswerRunRequest,
  CitationSnapshot,
  GroundedAnswerInput,
  GroundedAnswerOrchestratorOptions,
  GroundedAnswerResult,
} from "./types.js";

const EMPTY_CONTEXT_PLAN: InsufficientEvidencePlan = Object.freeze({
  claims: [],
  reason: "The retrieved evidence is insufficient to answer the question.",
  type: "insufficient-evidence",
});

function assertQuestion(question: string): void {
  if (question.trim().length === 0) {
    throw new AnsweringError("INVALID_REQUEST", "The question must not be empty.");
  }
}

function throwIfAborted(options?: InferenceRequestOptions): void {
  options?.signal?.throwIfAborted();
}

function deterministicResult(
  plan: GroundedPlan,
  context: readonly CitationSnapshot[],
  fallback: CitationValidationError | null,
  routingDiagnostics: AnswerRoutingDiagnostics,
): GroundedAnswerResult {
  const text = assembleGroundedPlan(plan);
  const allowedIds = new Set(context.map((item) => item.id));
  const validator = new CitationMarkerValidator(
    allowedIds,
    plan.type === "answer" || plan.claims.length > 0,
  );

  try {
    const validatedText = validator.push(text);
    const citationIds = validator.finish();
    if (validatedText !== text) {
      throw new AnsweringError(
        "INVALID_PLAN",
        "The deterministic answer could not be validated.",
      );
    }
    return {
      citations: citationsForIds(citationIds, context),
      fallbackReason: fallback?.reason ?? null,
      plan,
      replacesProvisionalText: fallback !== null,
      status:
        fallback !== null
          ? "fallback"
          : plan.type === "answer"
            ? "answer"
            : "insufficient-evidence",
      text,
      routingDiagnostics,
    };
  } catch (error) {
    if (error instanceof AnsweringError) throw error;
    if (error instanceof CitationValidationError) {
      throw new AnsweringError(
        "INVALID_PLAN",
        "The grounded plan contains invalid citation marker text.",
        { reason: error.reason },
      );
    }
    throw error;
  }
}

async function* runAnswer(
  request: AnswerRunRequest,
  dependencies: GroundedAnswerOrchestratorOptions,
  options?: InferenceRequestOptions,
): AsyncGenerator<AnswerRunEvent, void> {
  assertQuestion(request.question);
  throwIfAborted(options);
  const context = selectAnswerContext(request.retrievalResult, dependencies.contextLimits);
  const confidence = assessEvidenceConfidence(
    request.question,
    request.retrievalResult,
    context,
    dependencies.confidenceEnvironment,
  );
  yield { status: "routing", type: "status" };

  let selectedContext = context;
  let routingDiagnostics: AnswerRoutingDiagnostics;
  if (confidence.label === "insufficient") {
    routingDiagnostics = {
      confidence,
      modelAssessment: null,
      route: "deterministic-reject",
      version: 1,
    };
  } else if (confidence.label === "sufficient") {
    routingDiagnostics = {
      confidence,
      modelAssessment: null,
      route: "deterministic-direct",
      version: 1,
    };
  } else {
    const evidence = toGroundingEvidence(context);
    const evidenceIds = new Set(context.map((item) => item.id));
    const startedAt = Date.now();
    const assessment = validateGroundedAnswerability(
      await dependencies.answerabilityProvider.assessGroundedAnswerability(
        { evidence, question: request.question },
        options,
      ),
      evidenceIds,
    );
    throwIfAborted(options);
    const selectedIds = new Set(assessment.evidenceIds);
    selectedContext = context.filter((item) => selectedIds.has(item.id));
    routingDiagnostics = {
      confidence,
      modelAssessment: {
        durationMs: Date.now() - startedAt,
        evidenceIds: selectedContext.map((item) => item.id),
      },
      route: "model-answerability",
      version: 1,
    };
  }
  yield { diagnostics: routingDiagnostics, type: "routing" };

  if (selectedContext.length === 0 || confidence.label === "insufficient") {
    const plan =
      context.length === 0
        ? EMPTY_CONTEXT_PLAN
        : {
            claims: [],
            reason:
              "The supplied evidence does not contain the information needed to answer the question.",
            type: "insufficient-evidence" as const,
          };
    yield {
      result: deterministicResult(plan, [], null, routingDiagnostics),
      type: "result",
    };
    return;
  }

  const evidence = toGroundingEvidence(selectedContext);
  const evidenceIds = new Set(selectedContext.map((item) => item.id));
  yield { status: "planning", type: "status" };
  const rawPlan = await dependencies.planProvider.planGroundedAnswer(
    { evidence, question: groundedPlanningQuestion(request.question) },
    options,
  );
  throwIfAborted(options);
  const plan = validateGroundedPlan(rawPlan, evidenceIds);

  if (plan.type === "insufficient-evidence") {
    throw new AnsweringError(
      "INVALID_PLAN",
      "The answer-only planner returned an insufficient-evidence plan.",
    );
  }

  if (dependencies.delivery === "deterministic") {
    yield {
      result: deterministicResult(plan, selectedContext, null, routingDiagnostics),
      type: "result",
    };
    return;
  }

  const fallbackResult = (error: CitationValidationError): GroundedAnswerResult =>
    deterministicResult(plan, selectedContext, error, routingDiagnostics);
  const validator = new CitationMarkerValidator(evidenceIds);
  let streamedText = "";

  yield { status: "streaming", type: "status" };
  try {
    const stream = dependencies.answerStreamProvider.streamAnswer(
      { evidence, plan, question: request.question },
      options,
    );
    for await (const chunk of stream) {
      throwIfAborted(options);
      const safeText = validator.push(chunk);
      if (safeText.length > 0) {
        streamedText += safeText;
        yield { provisional: true, text: safeText, type: "text" };
        throwIfAborted(options);
      }
    }
    throwIfAborted(options);
    const citationIds = validator.finish();
    yield {
      result: {
        citations: citationsForIds(citationIds, selectedContext),
        fallbackReason: null,
        plan,
        replacesProvisionalText: false,
        status: "answer",
        text: streamedText,
        routingDiagnostics,
      },
      type: "result",
    };
  } catch (error) {
    if (!(error instanceof CitationValidationError)) throw error;
    yield { result: fallbackResult(error), type: "result" };
  }
}

export class GroundedAnswerOrchestrator {
  readonly #options: GroundedAnswerOrchestratorOptions;

  public constructor(options: GroundedAnswerOrchestratorOptions) {
    this.#options = options;
  }

  public run(
    request: AnswerRunRequest,
    options?: InferenceRequestOptions,
  ): AsyncIterable<AnswerRunEvent> {
    return runAnswer(request, this.#options, options);
  }
}

export function answerGroundedQuestion(
  input: GroundedAnswerInput,
  options?: InferenceRequestOptions,
): AsyncIterable<AnswerRunEvent> {
  return runAnswer(
    { question: input.question, retrievalResult: input.retrievalResult },
    {
      answerabilityProvider: input.answerabilityProvider,
      answerStreamProvider: input.answerStreamProvider,
      confidenceEnvironment: input.confidenceEnvironment,
      ...(input.contextLimits === undefined ? {} : { contextLimits: input.contextLimits }),
      planProvider: input.planProvider,
    },
    options,
  );
}
