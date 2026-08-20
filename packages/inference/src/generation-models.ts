import type { GenerationModelProfile, ModelDescriptor } from "./types.js";

export const MIN_GENERATION_CONTEXT_TOKENS = 8_192;
export const MAX_GENERATION_CONTEXT_TOKENS = 32_768;
export const GENERATION_TEMPERATURE = 0.1;

export type GenerationModelIncompatibilityReason =
  | "context-too-small"
  | "metadata-unavailable"
  | "missing-completion"
  | "remote"
  | "unknown-context";

export function generationModelIncompatibility(
  model: ModelDescriptor,
): GenerationModelIncompatibilityReason | null {
  if (!model.local) return "remote";
  if (model.metadataError !== null) return "metadata-unavailable";
  if (!model.capabilities.includes("completion")) return "missing-completion";
  if (model.nativeContextWindow === null) return "unknown-context";
  if (model.nativeContextWindow < MIN_GENERATION_CONTEXT_TOKENS) {
    return "context-too-small";
  }
  return null;
}

function ordinalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function compareGenerationCompatibility(
  left: ModelDescriptor,
  right: ModelDescriptor,
): number {
  return (
    left.sizeBytes - right.sizeBytes ||
    ordinalCompare(left.name, right.name) ||
    ordinalCompare(left.digest, right.digest) ||
    ordinalCompare(left.provider, right.provider)
  );
}

export function compatibleGenerationModels(
  models: readonly ModelDescriptor[],
): readonly ModelDescriptor[] {
  return models
    .filter((model) => generationModelIncompatibility(model) === null)
    .sort(compareGenerationCompatibility);
}

export function generationProfileForModel(
  model: ModelDescriptor,
): GenerationModelProfile {
  const incompatibility = generationModelIncompatibility(model);
  if (incompatibility !== null || model.nativeContextWindow === null) {
    throw new TypeError(
      `The generation model ${model.name} is incompatible: ${incompatibility ?? "unknown-context"}.`,
    );
  }
  return Object.freeze({
    contextWindow: Math.min(
      model.nativeContextWindow,
      MAX_GENERATION_CONTEXT_TOKENS,
    ),
    model: model.name,
    temperature: GENERATION_TEMPERATURE,
  });
}
