export const INFERENCE_ERROR_CODES = [
  "ABORTED",
  "ANSWERABILITY_INVALID",
  "EMBEDDING_CARDINALITY_MISMATCH",
  "EMBEDDING_DIMENSION_MISMATCH",
  "EMBEDDING_NON_FINITE",
  "EMBEDDING_NORM_OUT_OF_RANGE",
  "HTTP_ERROR",
  "INVALID_REQUEST",
  "INVALID_RESPONSE",
  "MODEL_CAPABILITY_MISSING",
  "MODEL_UNAVAILABLE",
  "NETWORK_ERROR",
  "PLAN_INVALID",
  "RESPONSE_TOO_LARGE",
  "STREAM_LINE_TOO_LARGE",
  "TIMEOUT",
] as const;

export type InferenceErrorCode = (typeof INFERENCE_ERROR_CODES)[number];

export interface InferenceErrorOptions {
  readonly cause?: unknown;
  readonly details?: unknown;
  readonly operation?: string;
  readonly status?: number;
}

export class InferenceError extends Error {
  public readonly code: InferenceErrorCode;
  public readonly details: unknown | undefined;
  public readonly operation: string | undefined;
  public readonly provider = "ollama";
  public readonly status: number | undefined;

  public constructor(
    code: InferenceErrorCode,
    message: string,
    options: InferenceErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "InferenceError";
    this.code = code;
    this.details = options.details;
    this.operation = options.operation;
    this.status = options.status;
  }

  public toJSON(): Readonly<Record<string, unknown>> {
    return {
      code: this.code,
      message: this.message,
      name: this.name,
      provider: this.provider,
      ...(this.details === undefined ? {} : { details: this.details }),
      ...(this.operation === undefined ? {} : { operation: this.operation }),
      ...(this.status === undefined ? {} : { status: this.status }),
    };
  }
}
