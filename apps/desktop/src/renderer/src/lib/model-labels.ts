import type {
  GenerationModelOption,
  ModelPullStatus,
  RecommendedModelRole,
} from "@knosys-rag/contracts";

export function incompatibilityLabel(
  reason: NonNullable<GenerationModelOption["incompatibilityReason"]>,
): string {
  switch (reason) {
    case "context-too-small":
      return "Context window is under the required 8K tokens";
    case "metadata-unavailable":
      return "Model metadata could not be read";
    case "missing-completion":
      return "Not a text-generation model";
    case "unknown-context":
      return "Context window could not be determined";
  }
}

export function recommendedRoleLabel(role: RecommendedModelRole): string {
  switch (role) {
    case "generation-baseline":
      return "Baseline";
    case "generation-quality":
      return "Quality";
    case "embedding-required":
      return "Required";
  }
}

export function pullStatusLabel(status: ModelPullStatus): string {
  switch (status) {
    case "starting":
      return "Starting download";
    case "downloading":
      return "Downloading";
    case "verifying":
      return "Verifying";
    case "completed":
      return "Downloaded";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return "Download failed";
  }
}

export function contextWindowLabel(nativeContextWindow: number | null): string {
  return nativeContextWindow
    ? `${Math.round(nativeContextWindow / 1024)}K context`
    : "unknown context";
}
