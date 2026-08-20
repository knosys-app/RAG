import { describe, expect, it, vi } from "vitest";

import {
  HybridRetriever,
  RETRIEVAL_TRACE_VERSION,
  RetrievalUnavailableError,
  reciprocalRankFusion,
  type LexicalRetriever,
  type QueryEmbedder,
  type RetrievalEvidence,
  type RetrievalPoolCandidate,
  type VectorRetriever,
} from "../src/index.js";

function evidence(chunkId: string, text = chunkId): RetrievalEvidence {
  return {
    chunkId,
    metadata: { retained: true },
    source: {
      documentId: `document-${chunkId}`,
      sourceId: `source-${chunkId}`,
      sourceName: `${chunkId}.md`,
    },
    text,
  };
}

function candidate(chunkId: string, score: number, text?: string): RetrievalPoolCandidate {
  return { evidence: evidence(chunkId, text), score };
}

function lexicalRetriever(
  candidates: readonly RetrievalPoolCandidate[],
): LexicalRetriever {
  return { retrieve: vi.fn(async () => candidates) };
}

function queryEmbedder(embedding: readonly number[] | null = [0.1, 0.2]): QueryEmbedder {
  return { embed: vi.fn(async () => embedding) };
}

function vectorRetriever(
  candidates: readonly RetrievalPoolCandidate[] | null,
): VectorRetriever {
  return { retrieve: vi.fn(async () => candidates) };
}

describe("reciprocal rank fusion", () => {
  it("deduplicates chunks, combines component ranks, and preserves full evidence", () => {
    const sharedEvidence = evidence("shared", "The complete retained chunk.");
    const result = reciprocalRankFusion({
      lexical: [
        { evidence: sharedEvidence, score: 99 },
        { evidence: sharedEvidence, score: 98 },
      ],
      vector: [candidate("vector-first", 0.95), { evidence: sharedEvidence, score: 0.9 }],
    });

    const shared = result.find((item) => item.chunkId === "shared");
    expect(shared?.evidence).toBe(sharedEvidence);
    expect(shared?.components).toEqual([
      { component: "lexical", rank: 1, reciprocalRankScore: 1 / 61, score: 99 },
      { component: "vector", rank: 2, reciprocalRankScore: 1 / 62, score: 0.9 },
    ]);
    expect(shared?.score).toBeCloseTo(1 / 61 + 1 / 62);
    expect(result.filter((item) => item.chunkId === "shared")).toHaveLength(1);
  });

  it("uses chunk ID as a deterministic tie-break", () => {
    const pools = {
      lexical: [candidate("b-chunk", 20)],
      vector: [candidate("a-chunk", 0.8)],
    };

    expect(reciprocalRankFusion(pools).map((item) => item.chunkId)).toEqual([
      "a-chunk",
      "b-chunk",
    ]);
    expect(reciprocalRankFusion(pools).map((item) => item.chunkId)).toEqual([
      "a-chunk",
      "b-chunk",
    ]);
  });

  it("caps each independent candidate pool", () => {
    const result = reciprocalRankFusion(
      {
        lexical: [candidate("lexical-1", 3), candidate("lexical-2", 2)],
        vector: [candidate("vector-1", 0.9), candidate("vector-2", 0.8)],
      },
      { candidatePoolSize: 1 },
    );

    expect(result.map((item) => item.chunkId).sort()).toEqual(["lexical-1", "vector-1"]);
  });
});

describe("HybridRetriever", () => {
  it("preserves exact-name lexical evidence in hybrid retrieval", async () => {
    const exact = candidate("exact", 100, "Project Starling exact-name notes");
    const semantic = candidate("semantic", 0.99, "A bird migration project");
    const lexical = lexicalRetriever([exact]);
    const vector = vectorRetriever([semantic]);
    const retriever = new HybridRetriever({
      lexicalRetriever: lexical,
      queryEmbedder: queryEmbedder(),
      vectorRetriever: vector,
    });

    const result = await retriever.retrieve({
      mode: "hybrid",
      query: "Project Starling",
      topK: 2,
    });

    expect(result.candidates.map((item) => item.evidence.text)).toContain(
      "Project Starling exact-name notes",
    );
    expect(lexical.retrieve).toHaveBeenCalledWith({ limit: 100, query: "Project Starling" });
    expect(result.trace).toMatchObject({
      mode: "hybrid",
      requestedMode: "hybrid",
      status: "success",
      version: RETRIEVAL_TRACE_VERSION,
    });
    expect(result.trace.stages.lexical.status).toBe("success");
    expect(result.trace.stages.embedding.status).toBe("success");
    expect(result.trace.stages.vector.status).toBe("success");
  });

  it("rescues semantically relevant vector evidence", async () => {
    const retriever = new HybridRetriever({
      lexicalRetriever: lexicalRetriever([candidate("literal", 12, "Literal token match")]),
      queryEmbedder: queryEmbedder(),
      vectorRetriever: vectorRetriever([
        candidate("semantic", 0.98, "Conceptually relevant without shared words"),
      ]),
    });

    const result = await retriever.retrieve({ query: "different terminology", topK: 2 });

    expect(result.candidates.map((item) => item.chunkId)).toContain("semantic");
    expect(result.candidates.find((item) => item.chunkId === "semantic")?.components).toEqual([
      expect.objectContaining({ component: "vector", rank: 1, score: 0.98 }),
    ]);
  });

  it.each([
    {
      name: "embedding",
      queryEmbedder: queryEmbedder(null),
      vectorRetriever: vectorRetriever([candidate("unused", 1)]),
    },
    {
      name: "vector",
      queryEmbedder: queryEmbedder(),
      vectorRetriever: vectorRetriever(null),
    },
  ])("falls back to lexical retrieval when $name is unavailable", async (dependencies) => {
    const retriever = new HybridRetriever({
      lexicalRetriever: lexicalRetriever([candidate("lexical", 20)]),
      queryEmbedder: dependencies.queryEmbedder,
      vectorRetriever: dependencies.vectorRetriever,
    });

    const result = await retriever.retrieve({ query: "available words", topK: 1 });

    expect(result.candidates.map((item) => item.chunkId)).toEqual(["lexical"]);
    expect(result.trace).toMatchObject({
      mode: "lexical-fallback",
      requestedMode: "hybrid",
      status: "fallback",
    });
  });

  it("fails rather than falling back in explicit vector mode", async () => {
    const vectorError = new Error("Vector index is offline.");
    const vector: VectorRetriever = {
      retrieve: vi.fn(async () => {
        throw vectorError;
      }),
    };
    const retriever = new HybridRetriever({
      lexicalRetriever: lexicalRetriever([candidate("lexical", 20)]),
      queryEmbedder: queryEmbedder(),
      vectorRetriever: vector,
    });

    let caught: unknown;
    try {
      await retriever.retrieve({ mode: "vector", query: "semantic query", topK: 1 });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RetrievalUnavailableError);
    expect(caught).toMatchObject({
      component: "vector",
      message: "Vector index is offline.",
    });
  });

  it("runs only lexical retrieval in explicit lexical mode", async () => {
    const embedder = queryEmbedder();
    const vector = vectorRetriever([candidate("vector", 1)]);
    const retriever = new HybridRetriever({
      lexicalRetriever: lexicalRetriever([candidate("lexical", 20)]),
      queryEmbedder: embedder,
      vectorRetriever: vector,
    });

    const result = await retriever.retrieve({ mode: "lexical", query: "name", topK: 1 });

    expect(result.candidates.map((item) => item.chunkId)).toEqual(["lexical"]);
    expect(embedder.embed).not.toHaveBeenCalled();
    expect(vector.retrieve).not.toHaveBeenCalled();
    expect(result.trace.stages.embedding.status).toBe("skipped");
    expect(result.trace.stages.vector.status).toBe("skipped");
  });

  it.each([
    { query: "", topK: 1 },
    { query: "   ", topK: 1 },
    { query: "valid", topK: 0 },
    { query: "valid", topK: 1.5 },
  ])("validates query and topK for %#", async (request) => {
    const retriever = new HybridRetriever({ lexicalRetriever: lexicalRetriever([]) });

    await expect(retriever.retrieve(request)).rejects.toThrow();
  });
});
