import type { ChatMessage, ChatProgressStatus } from "@knosys-rag/contracts";

export function progressLabel(status: ChatProgressStatus): string {
  switch (status) {
    case "background":
      return "Generating model background";
    case "retrieving":
      return "Finding library evidence";
    case "routing":
      return "Checking evidence coverage";
    case "planning":
      return "Planning a library-grounded answer";
    case "reconciling":
      return "Reconciling library and model claims";
    case "synthesizing":
      return "Synthesizing one answer";
    case "verifying":
      return "Verifying statements and sources";
    case "generating":
      return "Writing a library-grounded answer";
  }
}

export function routingLabel(message: ChatMessage): string | null {
  switch (message.routingDiagnostics?.route) {
    case "deterministic-direct":
      return "High-confidence evidence";
    case "deterministic-reject":
      return "No supporting evidence";
    case "model-answerability":
      return "Evidence verified";
    default:
      return null;
  }
}
