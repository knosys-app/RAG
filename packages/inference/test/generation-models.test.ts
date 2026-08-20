import { describe, expect, it } from "vitest";

import {
  compatibleGenerationModels,
  generationModelIncompatibility,
  generationProfileForModel,
  type ModelDescriptor,
} from "../src/index.js";

function model(
  name: string,
  sizeBytes: number,
  overrides: Partial<ModelDescriptor> = {},
): ModelDescriptor {
  return {
    capabilities: ["completion"],
    digest: `sha256:${name.padEnd(64, "0").slice(0, 64)}`,
    family: "test",
    local: true,
    metadataError: null,
    name,
    nativeContextWindow: 16_384,
    parameterSize: null,
    provider: "ollama",
    quantizationLevel: null,
    remoteHost: null,
    remoteModel: null,
    sizeBytes,
    ...overrides,
  };
}

describe("generation model compatibility", () => {
  it("selects compatible models by footprint, name, and digest", () => {
    const larger = model("larger", 20);
    const zed = model("zed", 10);
    const alpha = model("alpha", 10);
    expect(
      compatibleGenerationModels([larger, zed, alpha]).map(({ name }) => name),
    ).toEqual(["alpha", "zed", "larger"]);
  });

  it("rejects remote, non-completion, unknown, and undersized models", () => {
    expect(generationModelIncompatibility(model("remote", 1, { local: false }))).toBe(
      "remote",
    );
    expect(
      generationModelIncompatibility(model("embed", 1, { capabilities: ["embedding"] })),
    ).toBe("missing-completion");
    expect(
      generationModelIncompatibility(model("unknown", 1, { nativeContextWindow: null })),
    ).toBe("unknown-context");
    expect(
      generationModelIncompatibility(model("small-context", 1, { nativeContextWindow: 8_191 })),
    ).toBe("context-too-small");
  });

  it("clamps operational context without changing model identity", () => {
    expect(
      generationProfileForModel(
        model("large-context", 1, { nativeContextWindow: 262_144 }),
      ),
    ).toEqual({ contextWindow: 32_768, model: "large-context", temperature: 0.1 });
  });
});
