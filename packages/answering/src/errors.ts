export type AnsweringErrorCode =
  | "INVALID_ANSWERABILITY"
  | "INVALID_PLAN"
  | "INVALID_REQUEST";

export class AnsweringError extends Error {
  public readonly code: AnsweringErrorCode;
  public readonly details: unknown;

  public constructor(code: AnsweringErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AnsweringError";
    this.code = code;
    this.details = details;
  }
}
