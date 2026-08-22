import { z } from "zod";

export const IPC_INVOKE_CHANNEL = "knosys-rag:invoke";
export const IPC_EVENT_CHANNEL = "knosys-rag:event";

const documentFormatSchema = z.enum([
  "docx",
  "epub",
  "html",
  "markdown",
  "pdf",
  "text",
]);

const documentStatusSchema = z.enum([
  "processing",
  "ready",
  "ready-with-warnings",
  "failed",
]);

const ingestionJobStatusSchema = z.enum([
  "queued",
  "copying",
  "parsing",
  "chunking",
  "indexing",
  "completed",
  "duplicate",
  "interrupted",
  "failed",
  "cancelled",
]);

export const ollamaModelSchema = z.object({
  digest: z.string().min(1),
  name: z.string().min(1),
  parameterSize: z.string().nullable(),
  quantizationLevel: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative(),
});

export const ollamaStatusSchema = z.discriminatedUnion("state", [
  z.object({
    installDetected: z.boolean(),
    state: z.literal("ready"),
    models: z.array(ollamaModelSchema),
  }),
  z.object({
    installDetected: z.boolean(),
    state: z.literal("unavailable"),
    reason: z.enum(["not-installed", "not-running", "unexpected-response"]),
  }),
]);

export const systemStatusSchema = z.object({
  appVersion: z.string().min(1),
  architecture: z.string().min(1),
  macosVersion: z.string().min(1),
  memoryBytes: z.number().int().positive(),
  ollama: ollamaStatusSchema,
  platform: z.string().min(1),
  support: z.object({
    architectureSupported: z.boolean(),
    macosSupported: z.boolean(),
    memorySupported: z.boolean(),
    supported: z.boolean(),
  }),
});

export const documentSummarySchema = z.object({
  createdAt: z.iso.datetime(),
  diagnosticCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  format: documentFormatSchema,
  id: z.uuid(),
  originalName: z.string().min(1),
  reviewedAt: z.iso.datetime().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: documentStatusSchema,
  title: z.string().min(1),
  updatedAt: z.iso.datetime(),
});

export const jobSummarySchema = z.object({
  createdAt: z.iso.datetime(),
  documentId: z.uuid().nullable(),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  id: z.uuid(),
  originalName: z.string().min(1),
  progress: z.number().min(0).max(1),
  status: ingestionJobStatusSchema,
  updatedAt: z.iso.datetime(),
});

export const librarySnapshotSchema = z.object({
  documents: z.array(documentSummarySchema),
  jobs: z.array(jobSummarySchema),
});

export const sourceLocationSchema = z
  .object({
    endLine: z.number().int().nonnegative(),
    fragment: z.string().min(1),
    pageNumber: z.number().int().positive(),
    sourcePath: z.string().min(1),
    startLine: z.number().int().nonnegative(),
  })
  .partial();

export const parseDiagnosticSchema = z.object({
  code: z.string().min(1),
  location: sourceLocationSchema.optional(),
  message: z.string().min(1),
  severity: z.enum(["info", "warning", "error"]),
});

export const documentReviewSchema = z.object({
  diagnostics: z.array(parseDiagnosticSchema),
  document: documentSummarySchema,
});

export const searchResultSchema = z.object({
  chunkId: z.uuid(),
  documentId: z.uuid(),
  endBlockOrdinal: z.number().int().nonnegative(),
  endPageNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  headingPath: z.array(z.string()),
  rank: z.number(),
  snippet: z.string(),
  sourceFragment: z.string().nullable(),
  sourcePath: z.string().nullable(),
  startBlockOrdinal: z.number().int().nonnegative(),
  startPageNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  title: z.string().min(1),
});

export const importBatchResultSchema = z.object({
  duplicates: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      documentId: z.uuid().nullable(),
      errorCode: z.string().min(1).max(128).nullable(),
      errorMessage: z.string().min(1).max(2048).nullable(),
      originalName: z.string().min(1).max(512),
      status: z.enum(["duplicate", "failed", "imported", "reprocessed", "unsupported"]),
    }).strict(),
  ).max(10_000),
  reprocessed: z.number().int().nonnegative(),
  snapshot: librarySnapshotSchema,
  unsupported: z.number().int().nonnegative(),
});

export const importSelectionResultSchema = z.object({
  batch: importBatchResultSchema.nullable(),
  cancelled: z.boolean(),
});

export const importProgressStageSchema = z.enum([
  "discovering",
  "checking",
  "copying",
  "parsing",
  "chunking",
  "indexing",
  "completed",
]);

export const importProgressEventSchema = z
  .object({
    completed: z.number().int().nonnegative().max(10_000),
    currentName: z.string().min(1).max(512).nullable(),
    kind: z.literal("import-progress"),
    operationId: z.uuid(),
    stage: importProgressStageSchema,
    total: z.number().int().nonnegative().max(10_000).nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.total !== null && event.completed > event.total) {
      context.addIssue({
        code: "custom",
        message: "Completed imports cannot exceed the batch total.",
        path: ["completed"],
      });
    }
  });

export const recommendedModelNameSchema = z.enum([
  "qwen3:8b",
  "gemma4:26b",
  "qwen3-embedding:0.6b",
]);

export const recommendedModelRoleSchema = z.enum([
  "generation-baseline",
  "generation-quality",
  "embedding-required",
]);

/**
 * The curated model set from docs/master-plan.md §45.1. Pull requests are
 * validated against these names, so the catalog doubles as the allowlist for
 * in-app downloads.
 */
export const RECOMMENDED_MODELS = [
  {
    approxSizeBytes: 5_200_000_000,
    description: "Baseline generation model, sized for 16 GB Macs.",
    model: "qwen3:8b",
    role: "generation-baseline",
  },
  {
    approxSizeBytes: 16_000_000_000,
    description: "Higher-quality generation profile for higher-memory Macs.",
    model: "gemma4:26b",
    role: "generation-quality",
  },
  {
    approxSizeBytes: 640_000_000,
    description: "Required embedding model for semantic search and grounded chat.",
    model: "qwen3-embedding:0.6b",
    role: "embedding-required",
  },
] as const satisfies readonly {
  readonly approxSizeBytes: number;
  readonly description: string;
  readonly model: z.infer<typeof recommendedModelNameSchema>;
  readonly role: z.infer<typeof recommendedModelRoleSchema>;
}[];

export const modelPullStatusSchema = z.enum([
  "starting",
  "downloading",
  "verifying",
  "completed",
  "cancelled",
  "failed",
]);

export const modelPullEventSchema = z
  .object({
    completedBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    error: z.string().min(1).max(2048).nullable(),
    kind: z.literal("model-pull"),
    model: recommendedModelNameSchema,
    status: modelPullStatusSchema,
    totalBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict()
  .superRefine((event, context) => {
    if (event.error !== null && event.status !== "failed") {
      context.addIssue({
        code: "custom",
        message: "Only failed pull events may carry an error message.",
        path: ["error"],
      });
    }
    if (
      event.completedBytes !== null &&
      event.totalBytes !== null &&
      event.completedBytes > event.totalBytes
    ) {
      context.addIssue({
        code: "custom",
        message: "Completed bytes cannot exceed the total.",
        path: ["completedBytes"],
      });
    }
  });

const boundedIdentifierSchema = z.string().trim().min(1).max(128);
const boundedMessageSchema = z.string().max(100_000);
const boundedNonnegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const boundedPathSchema = z.string().min(1).max(4096);
const headingPathSchema = z
  .array(z.string().min(1).max(512))
  .max(64);

export const answerModeSchema = z.enum(["labeled-hybrid", "strict-grounded"]);

export const themePreferenceSchema = z.enum(["system", "light", "dark"]);
export const accentPreferenceSchema = z.enum([
  "violet",
  "coral",
  "blue",
  "green",
  "rose",
]);
const collapsedFoldersSchema = z.array(z.string().min(1).max(128)).max(500);

/** Null means the preference has never been set explicitly. */
export const appPreferencesSchema = z
  .object({
    accent: accentPreferenceSchema.nullable(),
    collapsedFolders: collapsedFoldersSchema.nullable(),
    theme: themePreferenceSchema.nullable(),
  })
  .strict();

export const appPreferencesPatchSchema = z
  .object({
    accent: accentPreferenceSchema.optional(),
    collapsedFolders: collapsedFoldersSchema.optional(),
    theme: themePreferenceSchema.optional(),
  })
  .strict();

type BoundedJsonValue =
  | boolean
  | number
  | string
  | null
  | BoundedJsonValue[]
  | { [key: string]: BoundedJsonValue };

const boundedJsonValueSchema: z.ZodType<BoundedJsonValue> = z.lazy(() =>
  z.union([
    z.boolean(),
    z.number(),
    z.string().max(4096),
    z.null(),
    z.array(boundedJsonValueSchema).max(256),
    z
      .record(z.string().min(1).max(128), boundedJsonValueSchema)
      .refine((value) => Object.keys(value).length <= 128, {
        message: "Objects are limited to 128 properties.",
      }),
  ]),
);

export const ragRuntimeUnavailableReasonSchema = z.enum([
  "not-installed",
  "not-running",
  "unexpected-response",
  "request-failed",
]);

export const ragRuntimeAvailableSchema = z
  .object({
    installDetected: z.boolean(),
    provider: z.literal("ollama"),
    state: z.literal("available"),
  })
  .strict();

export const ragRuntimeUnavailableSchema = z
  .object({
    installDetected: z.boolean(),
    provider: z.literal("ollama"),
    reason: ragRuntimeUnavailableReasonSchema,
    state: z.literal("unavailable"),
  })
  .strict();

export const ragRuntimeStatusSchema = z.discriminatedUnion("state", [
  ragRuntimeAvailableSchema,
  ragRuntimeUnavailableSchema,
]);

export const modelCapabilitySchema = z.enum([
  "completion",
  "embedding",
  "insert",
  "thinking",
  "tools",
  "vision",
]);

export const embeddingModelNameSchema = z.literal("qwen3-embedding:0.6b");

export const embeddingModelSchema = z
  .object({
    capabilities: z.array(modelCapabilitySchema).max(6),
    capable: z.boolean(),
    digest: z.string().min(1).max(256).nullable(),
    installed: z.boolean(),
    model: embeddingModelNameSchema,
    provider: z.literal("ollama"),
  })
  .strict();

export const embeddingProfileSchema = z
  .object({
    createdAt: z.iso.datetime(),
    digest: z.string().min(1).max(256),
    dimensions: z.number().int().min(1).max(65_536),
    id: z.uuid(),
    inputVersion: boundedIdentifierSchema,
    model: embeddingModelNameSchema,
    provider: z.literal("ollama"),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const embeddingCoverageSchema = z
  .object({
    currentChunks: boundedNonnegativeIntegerSchema,
    missingChunks: boundedNonnegativeIntegerSchema,
    ratio: z.number().min(0).max(1),
    staleChunks: boundedNonnegativeIntegerSchema,
    totalChunks: boundedNonnegativeIntegerSchema,
  })
  .strict();

export const semanticIndexJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "interrupted",
  "failed",
  "cancelled",
]);

export const semanticIndexJobSchema = z
  .object({
    completedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    embeddingProfileId: z.uuid(),
    errorCode: boundedIdentifierSchema.nullable(),
    errorMessage: z.string().min(1).max(2048).nullable(),
    id: z.uuid(),
    processedChunks: boundedNonnegativeIntegerSchema,
    startedAt: z.iso.datetime().nullable(),
    status: semanticIndexJobStatusSchema,
    totalChunks: boundedNonnegativeIntegerSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const latestSemanticJobSchema = semanticIndexJobSchema.nullable();

export const generationModelSchema = z.string().trim().min(1).max(256);
export const generationSelectionModeSchema = z.enum(["auto", "manual"]);
export const generationModelIncompatibilitySchema = z.enum([
  "context-too-small",
  "metadata-unavailable",
  "missing-completion",
  "unknown-context",
]);

export const generationModelSelectionSchema = z
  .object({
    contextWindow: z.number().int().positive().max(1_048_576),
    digest: z.string().min(1).max(256),
    model: generationModelSchema,
    provider: z.literal("ollama"),
    sizeBytes: boundedNonnegativeIntegerSchema,
  })
  .strict();

export const generationModelOptionSchema = z
  .object({
    capabilities: z.array(modelCapabilitySchema).max(6),
    capable: z.boolean(),
    digest: z.string().min(1).max(256).nullable(),
    installed: z.boolean(),
    incompatibilityReason: generationModelIncompatibilitySchema.nullable(),
    model: generationModelSchema,
    nativeContextWindow: z.number().int().positive().max(1_048_576).nullable(),
    provider: z.literal("ollama"),
    sizeBytes: boundedNonnegativeIntegerSchema,
  })
  .strict();

export const generationStatusSchema = z
  .object({
    options: z
      .array(generationModelOptionSchema)
      .max(100)
      .refine((options) => new Set(options.map(({ model }) => model)).size === options.length, {
        message: "Generation options must have unique model names.",
      }),
    selectionMode: generationSelectionModeSchema,
    selected: generationModelSelectionSchema.nullable(),
  })
  .strict();

export const ragEmbeddingStatusSchema = z
  .object({
    coverage: embeddingCoverageSchema.nullable(),
    latestJob: latestSemanticJobSchema,
    model: embeddingModelSchema,
    profile: embeddingProfileSchema.nullable(),
  })
  .strict();

export const ragStatusSchema = z
  .object({
    embedding: ragEmbeddingStatusSchema,
    generation: generationStatusSchema,
    runtime: ragRuntimeStatusSchema,
  })
  .strict();

export const sourceAnchorSchema = z
  .object({
    blockId: z.uuid(),
    blockOrdinal: boundedNonnegativeIntegerSchema,
    endLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    pageNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().default(null),
    sourceFragment: z.string().max(2048).nullable(),
    sourcePath: boundedPathSchema.nullable(),
    startLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  })
  .strict();

export const sourceLocatorSchema = z
  .object({
    chunkId: z.uuid(),
    documentId: z.uuid(),
    end: sourceAnchorSchema,
    start: sourceAnchorSchema,
  })
  .strict();

export const citationComponentScoreSchema = z
  .object({
    component: z.enum(["lexical", "vector"]),
    rank: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    reciprocalRankScore: z.number().nonnegative().optional(),
    score: z.number(),
  })
  .strict();

export const chatCitationSchema = z
  .object({
    chunkId: z.uuid(),
    createdAt: z.iso.datetime(),
    documentId: z.uuid(),
    evidenceId: boundedIdentifierSchema,
    headingPath: headingPathSchema,
    id: z.uuid(),
    messageId: z.uuid(),
    ordinal: boundedNonnegativeIntegerSchema,
    retrievalComponentScores: z.array(citationComponentScoreSchema).max(4),
    sourceLocator: sourceLocatorSchema,
    text: z.string().min(1).max(250_000),
    title: z.string().min(1).max(512),
  })
  .strict();

export const chatMessageRoleSchema = z.enum(["assistant", "user"]);

export const chatMessageStatusSchema = z.enum([
  "pending",
  "retrieving",
  "planning",
  "generating",
  "completed",
  "insufficient",
  "cancelled",
  "interrupted",
  "failed",
]);

const modelClaimIdSchema = z.string().regex(/^M[1-9]\d*$/).max(32);
const libraryClaimIdSchema = z.string().regex(/^L[1-9]\d*$/).max(32);
const hybridEvidenceIdSchema = z.string().regex(/^E[1-9]\d*$/).max(32);
const hybridStatementIdSchema = z.string().regex(/^S[1-9]\d*$/).max(32);
const sourceClaimIdSchema = z.union([modelClaimIdSchema, libraryClaimIdSchema]);
const provenanceMarkerPattern =
  /\[[^\]\r\n]{1,256}\]|\u3010[^\u3011\r\n]{1,256}\u3011|\b(?:E|L|M|S)[1-9]\d*\b/;
const boundedClaimTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(8_000)
  .refine((text) => !provenanceMarkerPattern.test(text), {
    message: "Citation and provenance markers are not allowed in claim text.",
  });
const uniqueIds = <T extends string>(ids: readonly T[]): boolean =>
  new Set(ids).size === ids.length;
const sameIds = (left: readonly string[], right: readonly string[]): boolean =>
  uniqueIds(left) &&
  uniqueIds(right) &&
  left.length === right.length &&
  left.every((id) => right.includes(id));

const canonicalModelClaimSchema = z
  .object({ id: modelClaimIdSchema, text: boundedClaimTextSchema })
  .strict();
const canonicalLibraryClaimSchema = z
  .object({
    evidenceIds: z.array(hybridEvidenceIdSchema).min(1).max(128).refine(uniqueIds),
    id: libraryClaimIdSchema,
    text: boundedClaimTextSchema,
  })
  .strict();
const reconciledClassificationSchema = z
  .object({
    classification: z.enum(["supported", "contradicted", "mixed", "unverified"]),
    contradictingEvidenceIds: z
      .array(hybridEvidenceIdSchema)
      .max(128)
      .refine(uniqueIds),
    equivalentLibraryClaimIds: z
      .array(libraryClaimIdSchema)
      .max(128)
      .refine(uniqueIds),
    modelClaimId: modelClaimIdSchema,
    supportingEvidenceIds: z.array(hybridEvidenceIdSchema).max(128).refine(uniqueIds),
  })
  .strict();
const hybridSectionKindSchema = z.enum(["library", "conflict", "model-background"]);
const renderedHybridStatementSchema = z
  .object({
    contradictingEvidenceIds: z
      .array(hybridEvidenceIdSchema)
      .max(128)
      .refine(uniqueIds),
    sectionKind: hybridSectionKindSchema,
    sourceClaimIds: z.array(sourceClaimIdSchema).min(1).max(144).refine(uniqueIds),
    statementId: hybridStatementIdSchema,
    supportingEvidenceIds: z.array(hybridEvidenceIdSchema).max(128).refine(uniqueIds),
    text: boundedClaimTextSchema,
  })
  .strict();
const renderedHybridSectionSchema = z
  .object({
    kind: hybridSectionKindSchema,
    statements: z.array(renderedHybridStatementSchema).min(1).max(64),
    title: z.string().trim().min(1).max(128),
  })
  .strict();
const provenanceStageSchema = z
  .object({
    fallbackReason: z.string().trim().min(1).max(256).nullable(),
    status: z.enum(["completed", "failed", "skipped"]),
  })
  .strict();
const provenanceGenerationModelSchema = z
  .object({
    digest: z.string().min(1).max(256),
    model: generationModelSchema,
  })
  .strict();

export const answerProvenanceV1Schema = z
  .object({
    classifications: z.array(reconciledClassificationSchema).max(16),
    finalSections: z.array(renderedHybridSectionSchema).max(3),
    generationModel: provenanceGenerationModelSchema,
    libraryClaims: z.array(canonicalLibraryClaimSchema).max(128),
    mode: z.literal("labeled-hybrid"),
    modelClaims: z.array(canonicalModelClaimSchema).max(16),
    promptVersions: z
      .object({
        closedBook: boundedIdentifierSchema,
        contextualization: boundedIdentifierSchema.nullable(),
        groundedDerivation: boundedIdentifierSchema,
        reconciliation: boundedIdentifierSchema,
        synthesis: boundedIdentifierSchema,
        verification: boundedIdentifierSchema,
      })
      .strict(),
    stages: z
      .object({
        background: provenanceStageSchema,
        library: provenanceStageSchema,
        reconciliation: provenanceStageSchema,
        synthesis: provenanceStageSchema,
        verification: provenanceStageSchema,
      })
      .strict(),
    version: z.literal(1),
  })
  .strict()
  .superRefine((provenance, context) => {
    const modelIds = provenance.modelClaims.map(({ id }) => id);
    const libraryIds = provenance.libraryClaims.map(({ id }) => id);
    const evidenceIds = provenance.libraryClaims.flatMap(({ evidenceIds: ids }) => ids);
    const classificationIds = provenance.classifications.map(
      ({ modelClaimId }) => modelClaimId,
    );
    if (!uniqueIds(modelIds)) {
      context.addIssue({ code: "custom", message: "Model claim IDs must be unique.", path: ["modelClaims"] });
    }
    if (!uniqueIds(libraryIds)) {
      context.addIssue({ code: "custom", message: "Library claim IDs must be unique.", path: ["libraryClaims"] });
    }
    if (!uniqueIds(classificationIds) || !sameIds(classificationIds, modelIds)) {
      context.addIssue({
        code: "custom",
        message: "Every model claim must have exactly one classification.",
        path: ["classifications"],
      });
    }
    const modelIdSet = new Set(modelIds);
    const libraryIdSet = new Set(libraryIds);
    const evidenceIdSet = new Set(evidenceIds);
    const classifications = new Map(
      provenance.classifications.map((classification) => [
        classification.modelClaimId,
        classification,
      ]),
    );
    provenance.classifications.forEach((classification, index) => {
      const supported = classification.supportingEvidenceIds.length > 0;
      const contradicted = classification.contradictingEvidenceIds.length > 0;
      const expected = supported
        ? contradicted
          ? "mixed"
          : "supported"
        : contradicted
          ? "contradicted"
          : "unverified";
      if (classification.classification !== expected) {
        context.addIssue({
          code: "custom",
          message: "The classification must match its evidence relationships.",
          path: ["classifications", index, "classification"],
        });
      }
      if (
        classification.supportingEvidenceIds.some((id) => !evidenceIdSet.has(id)) ||
        classification.contradictingEvidenceIds.some((id) => !evidenceIdSet.has(id)) ||
        classification.equivalentLibraryClaimIds.some((id) => !libraryIdSet.has(id)) ||
        classification.supportingEvidenceIds.some((id) =>
          classification.contradictingEvidenceIds.includes(id),
        )
      ) {
        context.addIssue({
          code: "custom",
          message: "A classification references an invalid claim or evidence relationship.",
          path: ["classifications", index],
        });
      }
    });
    const sectionKinds = provenance.finalSections.map(({ kind }) => kind);
    if (!uniqueIds(sectionKinds)) {
      context.addIssue({ code: "custom", message: "Final section kinds must be unique.", path: ["finalSections"] });
    }
    const statementIds = provenance.finalSections.flatMap(({ statements }) =>
      statements.map(({ statementId }) => statementId),
    );
    if (!uniqueIds(statementIds)) {
      context.addIssue({ code: "custom", message: "Final statement IDs must be unique.", path: ["finalSections"] });
    }
    const representedClaimIds = new Set(
      provenance.finalSections.flatMap(({ statements }) =>
        statements.flatMap(({ sourceClaimIds }) => sourceClaimIds),
      ),
    );
    if (
      [...modelIds, ...libraryIds].some((id) => !representedClaimIds.has(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Final statements must represent every canonical claim.",
        path: ["finalSections"],
      });
    }
    provenance.finalSections.forEach((section, sectionIndex) => {
      section.statements.forEach((statement, statementIndex) => {
        const path = ["finalSections", sectionIndex, "statements", statementIndex];
        const modelSources = statement.sourceClaimIds.filter((id) => id.startsWith("M"));
        const librarySources = statement.sourceClaimIds.filter((id) => id.startsWith("L"));
        const unknownSource = modelSources.some((id) => !modelIdSet.has(id)) ||
          librarySources.some((id) => !libraryIdSet.has(id));
        const modelClasses = modelSources.map(
          (id) => classifications.get(id)?.classification,
        );
        const laneEligible =
          section.kind === "library"
            ? modelClasses.every((value) => value === "supported")
            : section.kind === "conflict"
              ? modelSources.length > 0 &&
                modelClasses.every(
                  (value) => value === "contradicted" || value === "mixed",
                )
              : librarySources.length === 0 &&
                modelSources.length > 0 &&
                modelClasses.every((value) => value === "unverified");
        const expectedSupporting = statement.sourceClaimIds.flatMap((id) =>
          id.startsWith("L")
            ? provenance.libraryClaims.find((claim) => claim.id === id)?.evidenceIds ?? []
            : classifications.get(id)?.supportingEvidenceIds ?? [],
        );
        const expectedContradicting = modelSources.flatMap(
          (id) => classifications.get(id)?.contradictingEvidenceIds ?? [],
        );
        if (
          statement.sectionKind !== section.kind ||
          unknownSource ||
          !laneEligible ||
          !sameIds(statement.supportingEvidenceIds, [...new Set(expectedSupporting)]) ||
          !sameIds(statement.contradictingEvidenceIds, [...new Set(expectedContradicting)])
        ) {
          context.addIssue({
            code: "custom",
            message: "A final statement has an invalid lane or evidence relationship.",
            path,
          });
        }
      });
    });
  });

export const answerRoutingDiagnosticsSchema = z
  .object({
    confidence: z
      .object({
        calibrationId: boundedIdentifierSchema.nullable(),
        fingerprint: z.string().min(1).max(2048),
        label: z.enum(["insufficient", "sufficient", "uncertain"]),
        policyVersion: z.literal("hybrid-answerability-v1"),
        reasons: z
          .array(
            z.enum([
              "calibration-mismatch",
              "context-truncated",
              "empty-context",
              "high-reference-confidence",
              "incomplete-embedding-coverage",
              "low-reference-confidence",
              "retrieval-degraded",
              "wide-uncertain-band",
            ]),
          )
          .min(1)
          .max(8),
        signals: z
          .object({
            contextTruncated: z.boolean(),
            lexicalResultCount: boundedNonnegativeIntegerSchema,
            queryTokenCoverage: z.number().min(0).max(1),
            topCandidateInBothPools: z.boolean(),
            topVectorMargin: z.number().nullable(),
            topVectorScore: z.number().nullable(),
            vectorResultCount: boundedNonnegativeIntegerSchema,
          })
          .strict(),
        version: z.literal(1),
      })
      .strict(),
    generationModel: z
      .object({
        digest: z.string().min(1).max(256),
        model: generationModelSchema,
      })
      .strict(),
    modelAssessment: z
      .object({
        durationMs: boundedNonnegativeIntegerSchema,
        evidenceIds: z
          .array(boundedIdentifierSchema)
          .max(128)
          .refine((ids) => new Set(ids).size === ids.length, {
            message: "Answerability evidence IDs must be unique.",
          }),
      })
      .strict()
      .nullable(),
    route: z.enum([
      "deterministic-direct",
      "deterministic-reject",
      "model-answerability",
    ]),
    version: z.literal(1),
  })
  .strict()
  .superRefine((diagnostics, context) => {
    if (
      (diagnostics.route === "model-answerability") !==
      (diagnostics.modelAssessment !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "Only model-answerability routes may contain a model assessment.",
        path: ["modelAssessment"],
      });
    }
  });

const answerProvenanceV2StatementSchema = z.discriminatedUnion("kind", [
  z
    .object({
      evidenceIds: z.array(hybridEvidenceIdSchema).min(1).max(128).refine(uniqueIds),
      kind: z.literal("library"),
      statementId: hybridStatementIdSchema,
      text: boundedClaimTextSchema,
    })
    .strict(),
  z
    .object({
      evidenceIds: z.array(hybridEvidenceIdSchema).length(0),
      kind: z.literal("model"),
      statementId: hybridStatementIdSchema,
      text: boundedClaimTextSchema,
    })
    .strict(),
]);

export const answerProvenanceV2Schema = z
  .object({
    generationModel: provenanceGenerationModelSchema,
    mode: z.literal("labeled-hybrid"),
    promptVersions: z
      .object({
        contextualization: boundedIdentifierSchema.nullable(),
        evidenceAnswer: boundedIdentifierSchema,
        groundedDerivation: boundedIdentifierSchema,
        // The closed-book prompt used to draft the model's own answer, when one
        // was synthesized in; null when only grounded library text was used.
        // Defaulted so provenance stored before this field existed still parses.
        modelDraft: boundedIdentifierSchema.nullable().default(null),
        verification: boundedIdentifierSchema,
      })
      .strict(),
    stages: z
      .object({
        generation: provenanceStageSchema,
        library: provenanceStageSchema,
        verification: provenanceStageSchema,
      })
      .strict(),
    statements: z.array(answerProvenanceV2StatementSchema).max(144),
    version: z.literal(2),
  })
  .strict()
  .superRefine((provenance, context) => {
    provenance.statements.forEach((statement, index) => {
      if (statement.statementId !== `S${index + 1}`) {
        context.addIssue({
          code: "custom",
          message: "Statement IDs must be unique and consecutive in array order.",
          path: ["statements", index, "statementId"],
        });
      }
    });
  });

export const answerProvenanceSchema = z.discriminatedUnion("version", [
  answerProvenanceV1Schema,
  answerProvenanceV2Schema,
]);

export const chatMessageSchema = z
  .object({
    answerProvenance: answerProvenanceSchema.nullable(),
    citations: z.array(chatCitationSchema).max(100),
    content: boundedMessageSchema,
    createdAt: z.iso.datetime(),
    errorCode: boundedIdentifierSchema.nullable(),
    errorMessage: z.string().min(1).max(2048).nullable(),
    id: z.uuid(),
    model: z.string().min(1).max(128).nullable(),
    ordinal: boundedNonnegativeIntegerSchema,
    role: chatMessageRoleSchema,
    routingDiagnostics: answerRoutingDiagnosticsSchema.nullable(),
    runId: z.uuid().nullable(),
    status: chatMessageStatusSchema,
    threadId: z.uuid(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.answerProvenance === null) return;
    if (message.role !== "assistant" || !["completed", "insufficient"].includes(message.status)) {
      context.addIssue({
        code: "custom",
        message: "Only completed assistant messages may contain answer provenance.",
        path: ["answerProvenance"],
      });
    }
    const referencedEvidenceIds = message.answerProvenance.version === 1
      ? [
          ...new Set(
            message.answerProvenance.finalSections.flatMap(({ statements }) =>
              statements.flatMap((statement) => [
                ...statement.supportingEvidenceIds,
                ...statement.contradictingEvidenceIds,
              ]),
            ),
          ),
        ]
      : [
          ...new Set(
            message.answerProvenance.statements.flatMap(({ evidenceIds }) => evidenceIds),
          ),
        ];
    const citationEvidenceIds = message.citations.map(({ evidenceId }) => evidenceId);
    if (!sameIds(citationEvidenceIds, referencedEvidenceIds)) {
      context.addIssue({
        code: "custom",
        message: "Citations must exactly match evidence referenced by provenance statements.",
        path: ["citations"],
      });
    }
  });

export const chatFolderNameSchema = z.string().trim().min(1).max(120);

export const chatFolderSchema = z
  .object({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
    name: chatFolderNameSchema,
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const chatFolderListSchema = z.array(chatFolderSchema).max(100);

export const chatThreadSummarySchema = z
  .object({
    createdAt: z.iso.datetime(),
    folderId: z.uuid().nullable(),
    id: z.uuid(),
    lastMessageAt: z.iso.datetime().nullable(),
    lastMessagePreview: z.string().max(512).nullable(),
    memoryExcluded: z.boolean(),
    messageCount: boundedNonnegativeIntegerSchema,
    title: z.string().min(1).max(512),
    updatedAt: z.iso.datetime(),
  })
  .strict();

export const chatThreadSchema = chatThreadSummarySchema
  .extend({
    messages: z.array(chatMessageSchema).max(10_000),
  })
  .strict()
  .superRefine((thread, context) => {
    thread.messages.forEach((message, messageIndex) => {
      if (message.threadId !== thread.id) {
        context.addIssue({
          code: "custom",
          message: "Every message must belong to the thread.",
          path: ["messages", messageIndex, "threadId"],
        });
      }
      message.citations.forEach((citation, citationIndex) => {
        if (citation.messageId !== message.id) {
          context.addIssue({
            code: "custom",
            message: "Every citation must belong to its message.",
            path: ["messages", messageIndex, "citations", citationIndex, "messageId"],
          });
        }
      });
    });
  });

export const chatThreadListSchema = z.array(chatThreadSummarySchema).max(100);

export const sourceBlockSchema = z
  .object({
    attributes: z
      .record(z.string().min(1).max(128), boundedJsonValueSchema)
      .refine((value) => Object.keys(value).length <= 128, {
        message: "Source block attributes are limited to 128 properties.",
      }),
    endLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    headingPath: headingPathSchema,
    id: z.uuid(),
    ordinal: boundedNonnegativeIntegerSchema,
    pageNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    sourceFragment: z.string().max(2048).nullable(),
    sourcePath: boundedPathSchema.nullable(),
    startLine: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
    text: z.string().max(250_000),
    type: boundedIdentifierSchema,
  })
  .strict();

export const sourceBlockWindowSchema = z.array(sourceBlockSchema).max(256);

const acceptedAssistantMessageSchema = chatMessageSchema.safeExtend({
  role: z.literal("assistant"),
  status: z.enum(["pending", "retrieving", "planning", "generating"]),
});

const acceptedUserMessageSchema = chatMessageSchema.safeExtend({
  role: z.literal("user"),
  routingDiagnostics: z.null(),
  runId: z.null(),
  status: z.literal("completed"),
});

export const chatAcceptanceSchema = z
  .object({
    accepted: z.literal(true),
    assistantMessage: acceptedAssistantMessageSchema,
    runId: z.uuid(),
    thread: chatThreadSummarySchema,
    userMessage: acceptedUserMessageSchema,
  })
  .strict()
  .superRefine((acceptance, context) => {
    if (acceptance.assistantMessage.runId !== acceptance.runId) {
      context.addIssue({
        code: "custom",
        message: "The assistant message must belong to the accepted run.",
        path: ["assistantMessage", "runId"],
      });
    }
    for (const messageName of ["assistantMessage", "userMessage"] as const) {
      if (acceptance[messageName].threadId !== acceptance.thread.id) {
        context.addIssue({
          code: "custom",
          message: "Accepted messages must belong to the accepted thread.",
          path: [messageName, "threadId"],
        });
      }
    }
  });

export const chatProgressStatusSchema = z.enum([
  "background",
  "retrieving",
  "routing",
  "planning",
  "generating",
  "reconciling",
  "synthesizing",
  "verifying",
]);

export const chatEventSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

export const chatStatusEventSchema = z
  .object({
    kind: z.literal("status"),
    runId: z.uuid(),
    sequence: chatEventSequenceSchema,
    status: chatProgressStatusSchema,
  })
  .strict();

export const chatDeltaEventSchema = z
  .object({
    kind: z.literal("delta"),
    runId: z.uuid(),
    sequence: chatEventSequenceSchema,
    text: z.string().min(1).max(16_384),
  })
  .strict();

export const chatRoutingEventSchema = z
  .object({
    diagnostics: answerRoutingDiagnosticsSchema,
    kind: z.literal("routing"),
    runId: z.uuid(),
    sequence: chatEventSequenceSchema,
  })
  .strict();

const completedChatMessageSchema = chatMessageSchema.safeExtend({
  role: z.literal("assistant"),
  status: z.enum(["completed", "insufficient"]),
});

const cancelledChatMessageSchema = chatMessageSchema.safeExtend({
  role: z.literal("assistant"),
  status: z.literal("cancelled"),
});

const failedChatMessageSchema = chatMessageSchema.safeExtend({
  role: z.literal("assistant"),
  status: z.literal("failed"),
});

export const chatCompletedEventSchema = z
  .object({
    fallback: z.boolean(),
    insufficient: z.boolean(),
    kind: z.literal("completed"),
    message: completedChatMessageSchema,
    runId: z.uuid(),
    sequence: chatEventSequenceSchema,
  })
  .strict();

export const chatCancelledEventSchema = z
  .object({
    kind: z.literal("cancelled"),
    message: cancelledChatMessageSchema,
    runId: z.uuid(),
    sequence: chatEventSequenceSchema,
  })
  .strict();

export const chatFailedEventSchema = z
  .object({
    kind: z.literal("failed"),
    message: failedChatMessageSchema,
    runId: z.uuid(),
    sequence: chatEventSequenceSchema,
  })
  .strict();

export const chatEventSchema = z.discriminatedUnion("kind", [
  chatStatusEventSchema,
  chatRoutingEventSchema,
  chatDeltaEventSchema,
  chatCompletedEventSchema,
  chatCancelledEventSchema,
  chatFailedEventSchema,
]).superRefine((event, context) => {
  if (
    (event.kind === "completed" ||
      event.kind === "cancelled" ||
      event.kind === "failed") &&
    event.message.runId !== event.runId
  ) {
    context.addIssue({
      code: "custom",
      message: "The authoritative message must belong to the event run.",
      path: ["message", "runId"],
    });
  }
  if (
    event.kind === "completed" &&
    event.insufficient !== (event.message.status === "insufficient")
  ) {
    context.addIssue({
      code: "custom",
      message: "The insufficient flag must match the authoritative message status.",
      path: ["insufficient"],
    });
  }
});

export const chatEventStreamSchema = z
  .array(chatEventSchema)
  .max(10_000)
  .superRefine((events, context) => {
    const latestSequenceByRun = new Map<string, number>();
    events.forEach((event, index) => {
      const latestSequence = latestSequenceByRun.get(event.runId);
      if (latestSequence !== undefined && event.sequence <= latestSequence) {
        context.addIssue({
          code: "custom",
          message: "Chat event sequences must increase monotonically for each run.",
          path: [index, "sequence"],
        });
      }
      latestSequenceByRun.set(event.runId, event.sequence);
    });
  });

export const ipcEventSchema = z.union([
  chatEventSchema,
  importProgressEventSchema,
  modelPullEventSchema,
]);

export const engineChatEventEnvelopeSchema = z
  .object({
    event: chatEventSchema,
    type: z.literal("chat.event"),
  })
  .strict();

export const engineImportProgressEventEnvelopeSchema = z
  .object({
    event: importProgressEventSchema,
    type: z.literal("import.progress"),
  })
  .strict();

export const engineModelPullEventEnvelopeSchema = z
  .object({
    event: modelPullEventSchema,
    type: z.literal("model.pull"),
  })
  .strict();

export const engineEventEnvelopeSchema = z.discriminatedUnion("type", [
  engineChatEventEnvelopeSchema,
  engineImportProgressEventEnvelopeSchema,
  engineModelPullEventEnvelopeSchema,
]);

export const ragGetStatusResultSchema = ragStatusSchema;
export const ragSetGenerationModelResultSchema = ragStatusSchema;
export const chatListThreadsResultSchema = chatThreadListSchema;
export const chatGetThreadResultSchema = chatThreadSchema;
export const chatSendResultSchema = chatAcceptanceSchema;
export const chatCancelResultSchema = cancelledChatMessageSchema;
export const chatDeleteThreadResultSchema = z
  .object({ deletedThreadId: z.uuid() })
  .strict();
export const chatRenameThreadResultSchema = chatThreadSummarySchema;
export const chatListFoldersResultSchema = chatFolderListSchema;
export const chatCreateFolderResultSchema = chatFolderSchema;
export const chatRenameFolderResultSchema = chatFolderSchema;
export const chatDeleteFolderResultSchema = z
  .object({
    deletedFolderId: z.uuid(),
    deletedThreadIds: z.array(z.uuid()).max(10_000),
  })
  .strict();
export const chatMoveThreadResultSchema = chatThreadSummarySchema;
export const memorySetThreadExclusionResultSchema = chatThreadSummarySchema;
export const libraryDeleteDocumentResultSchema = z
  .object({
    deletedDocumentId: z.uuid(),
    snapshot: librarySnapshotSchema,
  })
  .strict();
export const libraryGetDocumentReviewResultSchema = documentReviewSchema;
export const libraryAcknowledgeReviewResultSchema = librarySnapshotSchema;
export const libraryReplaceDocumentResultSchema = importSelectionResultSchema;
export const modelsPullResultSchema = z
  .object({
    accepted: z.literal(true),
    model: recommendedModelNameSchema,
  })
  .strict();
export const modelsCancelPullResultSchema = z
  .object({
    cancelled: z.boolean(),
    model: recommendedModelNameSchema,
  })
  .strict();
export const evidenceGetResultSchema = chatCitationSchema;
export const sourceGetWindowResultSchema = sourceBlockWindowSchema;

export const engineRagGetStatusResultSchema = ragGetStatusResultSchema;
export const engineRagSetGenerationModelResultSchema = ragSetGenerationModelResultSchema;
export const engineChatListThreadsResultSchema = chatListThreadsResultSchema;
export const engineChatGetThreadResultSchema = chatGetThreadResultSchema;
export const engineChatSendResultSchema = chatSendResultSchema;
export const engineChatCancelResultSchema = chatCancelResultSchema;
export const engineChatDeleteThreadResultSchema = chatDeleteThreadResultSchema;
export const engineChatRenameThreadResultSchema = chatRenameThreadResultSchema;
export const engineLibraryDeleteDocumentResultSchema = libraryDeleteDocumentResultSchema;
export const engineModelsPullResultSchema = modelsPullResultSchema;
export const engineModelsCancelPullResultSchema = modelsCancelPullResultSchema;
export const engineEvidenceGetResultSchema = evidenceGetResultSchema;
export const engineSourceGetWindowResultSchema = sourceGetWindowResultSchema;

export const systemStatusRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("system.getStatus"),
  params: z.object({}).strict(),
});

export const preferencesGetRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("preferences.get"),
    params: z.object({}).strict(),
  })
  .strict();

export const preferencesSetRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("preferences.set"),
    params: appPreferencesPatchSchema,
  })
  .strict();

export const librarySnapshotRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("library.getSnapshot"),
  params: z.object({}).strict(),
});

export const libraryImportFilesRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("library.importFiles"),
  params: z.object({}).strict(),
});

export const libraryImportDirectoryRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("library.importDirectory"),
  params: z.object({}).strict(),
});

export const librarySearchRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("library.search"),
  params: z.object({
    query: z.string().trim().min(1).max(256),
  }).strict(),
});

export const libraryDeleteDocumentRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("library.deleteDocument"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const libraryGetDocumentReviewRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("library.getDocumentReview"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const libraryAcknowledgeReviewRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("library.acknowledgeReview"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const libraryReplaceDocumentRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("library.replaceDocument"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const libraryReprocessDocumentRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("library.reprocessDocument"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const ragGetStatusRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("rag.getStatus"),
    params: z.object({}).strict(),
  })
  .strict();

export const ragSetGenerationModelRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("rag.setGenerationModel"),
    params: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("auto") }).strict(),
      z.object({ mode: z.literal("manual"), model: generationModelSchema }).strict(),
    ]),
  })
  .strict();

export const chatListThreadsRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.listThreads"),
    params: z.object({}).strict(),
  })
  .strict();

export const chatGetThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.getThread"),
    params: z
      .object({
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const chatSendRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.send"),
    params: z
      .object({
        mode: answerModeSchema.default("labeled-hybrid"),
        question: z.string().trim().min(1).max(4000),
        threadId: z.uuid().nullable(),
      })
      .strict(),
  })
  .strict();

export const chatCancelRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.cancel"),
    params: z
      .object({
        runId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const chatDeleteThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.deleteThread"),
    params: z
      .object({
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const chatThreadTitleSchema = z.string().trim().min(1).max(512);

export const chatRenameThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.renameThread"),
    params: z
      .object({
        threadId: z.uuid(),
        title: chatThreadTitleSchema,
      })
      .strict(),
  })
  .strict();

export const memorySetThreadExclusionRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("memory.setThreadExclusion"),
    params: z
      .object({
        excluded: z.boolean(),
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const chatListFoldersRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.listFolders"),
    params: z.object({}).strict(),
  })
  .strict();

export const chatCreateFolderRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.createFolder"),
    params: z
      .object({
        name: chatFolderNameSchema,
      })
      .strict(),
  })
  .strict();

export const chatRenameFolderRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.renameFolder"),
    params: z
      .object({
        folderId: z.uuid(),
        name: chatFolderNameSchema,
      })
      .strict(),
  })
  .strict();

export const chatDeleteFolderRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.deleteFolder"),
    params: z
      .object({
        folderId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const chatMoveThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("chat.moveThread"),
    params: z
      .object({
        folderId: z.uuid().nullable(),
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const modelsPullRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("models.pull"),
    params: z
      .object({
        model: recommendedModelNameSchema,
      })
      .strict(),
  })
  .strict();

export const modelsCancelPullRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("models.cancelPull"),
    params: z
      .object({
        model: recommendedModelNameSchema,
      })
      .strict(),
  })
  .strict();

export const evidenceGetRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("evidence.get"),
    params: z
      .object({
        citationId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const sourceGetWindowRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("source.getWindow"),
    params: z
      .object({
        after: z.number().int().min(0).max(50),
        before: z.number().int().min(0).max(50),
        chunkId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const ipcRequestSchema = z.discriminatedUnion("method", [
  systemStatusRequestSchema,
  preferencesGetRequestSchema,
  preferencesSetRequestSchema,
  librarySnapshotRequestSchema,
  libraryImportFilesRequestSchema,
  libraryImportDirectoryRequestSchema,
  librarySearchRequestSchema,
  libraryDeleteDocumentRequestSchema,
  libraryGetDocumentReviewRequestSchema,
  libraryAcknowledgeReviewRequestSchema,
  libraryReplaceDocumentRequestSchema,
  libraryReprocessDocumentRequestSchema,
  ragGetStatusRequestSchema,
  ragSetGenerationModelRequestSchema,
  chatListThreadsRequestSchema,
  chatGetThreadRequestSchema,
  chatSendRequestSchema,
  chatCancelRequestSchema,
  chatDeleteThreadRequestSchema,
  chatRenameThreadRequestSchema,
  memorySetThreadExclusionRequestSchema,
  chatListFoldersRequestSchema,
  chatCreateFolderRequestSchema,
  chatRenameFolderRequestSchema,
  chatDeleteFolderRequestSchema,
  chatMoveThreadRequestSchema,
  modelsPullRequestSchema,
  modelsCancelPullRequestSchema,
  evidenceGetRequestSchema,
  sourceGetWindowRequestSchema,
]);

export const ipcErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "INTERNAL_ERROR",
  "UNTRUSTED_SENDER",
  "ENGINE_UNAVAILABLE",
  "INVALID_ARGUMENT",
  "RAG_RUNTIME_UNAVAILABLE",
  "RAG_EMBEDDING_UNAVAILABLE",
  "RAG_GENERATION_UNAVAILABLE",
  "RAG_GENERATION_MODEL_NOT_INSTALLED",
  "RAG_GENERATION_MODEL_NOT_CAPABLE",
  "CHAT_THREAD_NOT_FOUND",
  "CHAT_FOLDER_NOT_FOUND",
  "CHAT_RUN_NOT_FOUND",
  "CHAT_RUN_NOT_ACTIVE",
  "CHAT_CANCELLED",
  "CHAT_FAILED",
  "EVIDENCE_NOT_FOUND",
  "SOURCE_NOT_FOUND",
  "RUNTIME_UNAVAILABLE",
  "RAG_NOT_INITIALIZED",
  "EMBEDDING_FAILED",
  "RETRIEVAL_UNAVAILABLE",
  "GENERATION_UNAVAILABLE",
  "INFERENCE_FAILED",
  "MODEL_NOT_APPROVED",
  "MODEL_UNAVAILABLE",
  "MODEL_CAPABILITY_MISSING",
  "OPERATION_CANCELLED",
  "CHAT_RUN_FAILED",
  "DOCUMENT_NOT_FOUND",
  "DOCUMENT_IMPORT_IN_PROGRESS",
  "MODEL_PULL_FAILED",
]);

export const ipcErrorSchema = z.object({
  code: ipcErrorCodeSchema,
  message: z.string().min(1).max(2048),
  retryable: z.boolean().default(false),
});

export const ipcResultSchema = z.union([
  systemStatusSchema,
  appPreferencesSchema,
  librarySnapshotSchema,
  importSelectionResultSchema,
  z.array(searchResultSchema),
  libraryDeleteDocumentResultSchema,
  documentReviewSchema,
  ragGetStatusResultSchema,
  ragSetGenerationModelResultSchema,
  chatListThreadsResultSchema,
  chatGetThreadResultSchema,
  chatSendResultSchema,
  chatCancelResultSchema,
  chatDeleteThreadResultSchema,
  chatRenameThreadResultSchema,
  chatListFoldersResultSchema,
  chatCreateFolderResultSchema,
  chatDeleteFolderResultSchema,
  modelsPullResultSchema,
  modelsCancelPullResultSchema,
  evidenceGetResultSchema,
  sourceGetWindowResultSchema,
]);

export const ipcResponseSchema = z.discriminatedUnion("ok", [
  z.object({
    id: z.uuid(),
    ok: z.literal(true),
    result: ipcResultSchema,
  }),
  z.object({
    error: ipcErrorSchema,
    id: z.uuid(),
    ok: z.literal(false),
  }),
]);

export const systemStatusResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.uuid(), ok: z.literal(true), result: systemStatusSchema }),
  z.object({ error: ipcErrorSchema, id: z.uuid(), ok: z.literal(false) }),
]);

const engineInitializeRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("engine.initialize"),
  params: z.object({
    rootPath: z.string().min(1).max(4096),
    vectorExtensionPath: z.string().min(1).max(4096),
  }).strict(),
});

const engineSnapshotRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("engine.getSnapshot"),
  params: z.object({}).strict(),
});

const engineImportPathsRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("engine.importPaths"),
  params: z.object({
    paths: z.array(z.string().min(1).max(4096)).max(10_000),
  }).strict(),
});

const engineImportDirectoryRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("engine.importDirectory"),
  params: z.object({ path: z.string().min(1).max(4096) }).strict(),
});

const engineSearchRequestSchema = z.object({
  id: z.uuid(),
  method: z.literal("engine.search"),
  params: z.object({
    limit: z.number().int().min(1).max(50),
    query: z.string().trim().min(1).max(256),
  }).strict(),
});

export const engineRagGetStatusRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.rag.getStatus"),
    params: z.object({}).strict(),
  })
  .strict();

export const engineRagSetGenerationModelRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.rag.setGenerationModel"),
    params: z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("auto") }).strict(),
      z.object({ mode: z.literal("manual"), model: generationModelSchema }).strict(),
    ]),
  })
  .strict();

export const engineChatListThreadsRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.listThreads"),
    params: z.object({}).strict(),
  })
  .strict();

export const engineChatGetThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.getThread"),
    params: z
      .object({
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineChatSendRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.send"),
    params: z
      .object({
        mode: answerModeSchema.default("labeled-hybrid"),
        question: z.string().trim().min(1).max(4000),
        threadId: z.uuid().nullable(),
      })
      .strict(),
  })
  .strict();

export const engineChatCancelRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.cancel"),
    params: z
      .object({
        runId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineChatDeleteThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.deleteThread"),
    params: z
      .object({
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineChatRenameThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.renameThread"),
    params: z
      .object({
        threadId: z.uuid(),
        title: chatThreadTitleSchema,
      })
      .strict(),
  })
  .strict();

export const engineMemorySetThreadExclusionRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.memory.setThreadExclusion"),
    params: z
      .object({
        excluded: z.boolean(),
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineLibraryDeleteDocumentRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.library.deleteDocument"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineLibraryGetDocumentReviewRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.library.getDocumentReview"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineLibraryAcknowledgeReviewRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.library.acknowledgeReview"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineLibraryReplaceDocumentRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.library.replaceDocument"),
    params: z
      .object({
        documentId: z.uuid(),
        path: z.string().min(1),
      })
      .strict(),
  })
  .strict();

export const engineLibraryReprocessDocumentRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.library.reprocessDocument"),
    params: z
      .object({
        documentId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineChatListFoldersRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.listFolders"),
    params: z.object({}).strict(),
  })
  .strict();

export const engineChatCreateFolderRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.createFolder"),
    params: z
      .object({
        name: chatFolderNameSchema,
      })
      .strict(),
  })
  .strict();

export const engineChatRenameFolderRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.renameFolder"),
    params: z
      .object({
        folderId: z.uuid(),
        name: chatFolderNameSchema,
      })
      .strict(),
  })
  .strict();

export const engineChatDeleteFolderRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.deleteFolder"),
    params: z
      .object({
        folderId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineChatMoveThreadRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.chat.moveThread"),
    params: z
      .object({
        folderId: z.uuid().nullable(),
        threadId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineModelsPullRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.models.pull"),
    params: z
      .object({
        model: recommendedModelNameSchema,
      })
      .strict(),
  })
  .strict();

export const engineModelsCancelPullRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.models.cancelPull"),
    params: z
      .object({
        model: recommendedModelNameSchema,
      })
      .strict(),
  })
  .strict();

export const engineEvidenceGetRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.evidence.get"),
    params: z
      .object({
        citationId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineSourceGetWindowRequestSchema = z
  .object({
    id: z.uuid(),
    method: z.literal("engine.source.getWindow"),
    params: z
      .object({
        after: z.number().int().min(0).max(50),
        before: z.number().int().min(0).max(50),
        chunkId: z.uuid(),
      })
      .strict(),
  })
  .strict();

export const engineRequestSchema = z.discriminatedUnion("method", [
  engineInitializeRequestSchema,
  engineSnapshotRequestSchema,
  engineImportPathsRequestSchema,
  engineImportDirectoryRequestSchema,
  engineSearchRequestSchema,
  engineLibraryDeleteDocumentRequestSchema,
  engineLibraryGetDocumentReviewRequestSchema,
  engineLibraryAcknowledgeReviewRequestSchema,
  engineLibraryReplaceDocumentRequestSchema,
  engineLibraryReprocessDocumentRequestSchema,
  engineRagGetStatusRequestSchema,
  engineRagSetGenerationModelRequestSchema,
  engineChatListThreadsRequestSchema,
  engineChatGetThreadRequestSchema,
  engineChatSendRequestSchema,
  engineChatCancelRequestSchema,
  engineChatDeleteThreadRequestSchema,
  engineChatRenameThreadRequestSchema,
  engineMemorySetThreadExclusionRequestSchema,
  engineChatListFoldersRequestSchema,
  engineChatCreateFolderRequestSchema,
  engineChatRenameFolderRequestSchema,
  engineChatDeleteFolderRequestSchema,
  engineChatMoveThreadRequestSchema,
  engineModelsPullRequestSchema,
  engineModelsCancelPullRequestSchema,
  engineEvidenceGetRequestSchema,
  engineSourceGetWindowRequestSchema,
]);

export const engineResultSchema = z.union([
  z.object({ initialized: z.literal(true) }),
  librarySnapshotSchema,
  importBatchResultSchema,
  z.array(searchResultSchema),
  libraryDeleteDocumentResultSchema,
  documentReviewSchema,
  ragGetStatusResultSchema,
  ragSetGenerationModelResultSchema,
  chatListThreadsResultSchema,
  chatGetThreadResultSchema,
  chatSendResultSchema,
  chatCancelResultSchema,
  chatDeleteThreadResultSchema,
  chatRenameThreadResultSchema,
  chatListFoldersResultSchema,
  chatCreateFolderResultSchema,
  chatDeleteFolderResultSchema,
  modelsPullResultSchema,
  modelsCancelPullResultSchema,
  evidenceGetResultSchema,
  sourceGetWindowResultSchema,
]);

export const engineResponseSchema = z.discriminatedUnion("ok", [
  z.object({ id: z.uuid(), ok: z.literal(true), result: engineResultSchema }),
  z.object({
    error: z.object({
      code: z.string().min(1).max(128),
      message: z.string().min(1).max(2048),
      retryable: z.boolean().default(false),
    }),
    id: z.uuid(),
    ok: z.literal(false),
  }),
]);

export type ChatAcceptance = z.infer<typeof chatAcceptanceSchema>;
export type AccentPreference = z.infer<typeof accentPreferenceSchema>;
export type AnswerMode = z.infer<typeof answerModeSchema>;
export type AppPreferences = z.infer<typeof appPreferencesSchema>;
export type AppPreferencesPatch = z.infer<typeof appPreferencesPatchSchema>;
export type ThemePreference = z.infer<typeof themePreferenceSchema>;
export type AnswerProvenance = z.infer<typeof answerProvenanceSchema>;
export type AnswerProvenanceV1 = z.infer<typeof answerProvenanceV1Schema>;
export type AnswerProvenanceV2 = z.infer<typeof answerProvenanceV2Schema>;
export type ChatCancelRequest = z.infer<typeof chatCancelRequestSchema>;
export type ChatCancelResult = z.infer<typeof chatCancelResultSchema>;
export type ChatCancelledEvent = z.infer<typeof chatCancelledEventSchema>;
export type ChatCitation = z.infer<typeof chatCitationSchema>;
export type ChatCompletedEvent = z.infer<typeof chatCompletedEventSchema>;
export type ChatDeleteThreadRequest = z.infer<typeof chatDeleteThreadRequestSchema>;
export type ChatDeleteThreadResult = z.infer<typeof chatDeleteThreadResultSchema>;
export type ChatDeltaEvent = z.infer<typeof chatDeltaEventSchema>;
export type ChatFolder = z.infer<typeof chatFolderSchema>;
export type ChatDeleteFolderResult = z.infer<typeof chatDeleteFolderResultSchema>;
export type EngineChatEvent = z.infer<typeof chatEventSchema>;
export type ChatProgressStatus = z.infer<typeof chatProgressStatusSchema>;
export type EngineChatProgressStatus = z.infer<typeof chatProgressStatusSchema>;
export type ChatEvent = EngineChatEvent extends infer Event
  ? Event extends { readonly kind: "status" }
    ? Omit<Event, "status"> & { readonly status: ChatProgressStatus }
    : Event
  : never;
export type ChatFailedEvent = z.infer<typeof chatFailedEventSchema>;
export type ChatGetThreadRequest = z.infer<typeof chatGetThreadRequestSchema>;
export type ChatGetThreadResult = z.infer<typeof chatGetThreadResultSchema>;
export type ChatListThreadsRequest = z.infer<typeof chatListThreadsRequestSchema>;
export type ChatListThreadsResult = z.infer<typeof chatListThreadsResultSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatMessageRole = z.infer<typeof chatMessageRoleSchema>;
export type ChatMessageStatus = z.infer<typeof chatMessageStatusSchema>;
export type ChatRenameThreadRequest = z.infer<typeof chatRenameThreadRequestSchema>;
export type ChatRenameThreadResult = z.infer<typeof chatRenameThreadResultSchema>;
export type MemorySetThreadExclusionRequest = z.infer<
  typeof memorySetThreadExclusionRequestSchema
>;
export type MemorySetThreadExclusionResult = z.infer<
  typeof memorySetThreadExclusionResultSchema
>;
export type ChatRoutingEvent = z.infer<typeof chatRoutingEventSchema>;
export type AnswerRoutingDiagnostics = z.infer<typeof answerRoutingDiagnosticsSchema>;
export type ChatSendRequest = z.infer<typeof chatSendRequestSchema>;
export type ChatSendResult = z.infer<typeof chatSendResultSchema>;
export type ChatStatusEvent = z.infer<typeof chatStatusEventSchema>;
export type ChatThread = z.infer<typeof chatThreadSchema>;
export type ChatThreadSummary = z.infer<typeof chatThreadSummarySchema>;
export type CitationComponentScore = z.infer<typeof citationComponentScoreSchema>;
export type DocumentSummary = z.infer<typeof documentSummarySchema>;
export type DocumentReview = z.infer<typeof documentReviewSchema>;
export type ContractParseDiagnostic = z.infer<typeof parseDiagnosticSchema>;
export type ContractSourceLocation = z.infer<typeof sourceLocationSchema>;
export type EmbeddingCoverage = z.infer<typeof embeddingCoverageSchema>;
export type EmbeddingModel = z.infer<typeof embeddingModelSchema>;
export type EmbeddingModelName = z.infer<typeof embeddingModelNameSchema>;
export type EmbeddingProfile = z.infer<typeof embeddingProfileSchema>;
export type EngineChatCancelRequest = z.infer<typeof engineChatCancelRequestSchema>;
export type EngineChatDeleteThreadRequest = z.infer<
  typeof engineChatDeleteThreadRequestSchema
>;
export type EngineChatRenameThreadRequest = z.infer<
  typeof engineChatRenameThreadRequestSchema
>;
export type EngineLibraryDeleteDocumentRequest = z.infer<
  typeof engineLibraryDeleteDocumentRequestSchema
>;
export type EngineChatEventEnvelope = z.infer<
  typeof engineChatEventEnvelopeSchema
>;
export type EngineChatGetThreadRequest = z.infer<
  typeof engineChatGetThreadRequestSchema
>;
export type EngineChatListThreadsRequest = z.infer<
  typeof engineChatListThreadsRequestSchema
>;
export type EngineChatSendRequest = z.infer<typeof engineChatSendRequestSchema>;
export type EngineEventEnvelope = z.infer<typeof engineEventEnvelopeSchema>;
export type EngineEvidenceGetRequest = z.infer<typeof engineEvidenceGetRequestSchema>;
export type EngineRagGetStatusRequest = z.infer<
  typeof engineRagGetStatusRequestSchema
>;
export type EngineRagSetGenerationModelRequest = z.infer<
  typeof engineRagSetGenerationModelRequestSchema
>;
export type EngineRequest = z.infer<typeof engineRequestSchema>;
export type EngineResponse = z.infer<typeof engineResponseSchema>;
export type EngineSourceGetWindowRequest = z.infer<
  typeof engineSourceGetWindowRequestSchema
>;
export type EvidenceGetRequest = z.infer<typeof evidenceGetRequestSchema>;
export type EvidenceGetResult = z.infer<typeof evidenceGetResultSchema>;
export type GenerationModel = z.infer<typeof generationModelSchema>;
export type GenerationModelPreference =
  | { readonly mode: "auto" }
  | { readonly mode: "manual"; readonly model: GenerationModel };
export type GenerationModelOption = z.infer<typeof generationModelOptionSchema>;
export type GenerationModelSelection = z.infer<typeof generationModelSelectionSchema>;
export type GenerationStatus = z.infer<typeof generationStatusSchema>;
export type ImportBatchResult = z.infer<typeof importBatchResultSchema>;
export type ImportProgressEvent = z.infer<typeof importProgressEventSchema>;
export type ImportProgressStage = z.infer<typeof importProgressStageSchema>;
export type ImportSelectionResult = z.infer<typeof importSelectionResultSchema>;
export type IpcError = z.infer<typeof ipcErrorSchema>;
export type IpcErrorCode = z.infer<typeof ipcErrorCodeSchema>;
export type IpcEvent = z.infer<typeof ipcEventSchema>;
export type IpcRequest = z.infer<typeof ipcRequestSchema>;
export type IpcResponse = z.infer<typeof ipcResponseSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
export type LibraryDeleteDocumentRequest = z.infer<
  typeof libraryDeleteDocumentRequestSchema
>;
export type LibraryDeleteDocumentResult = z.infer<
  typeof libraryDeleteDocumentResultSchema
>;
export type LibrarySnapshot = z.infer<typeof librarySnapshotSchema>;
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;
export type ModelPullEvent = z.infer<typeof modelPullEventSchema>;
export type ModelPullStatus = z.infer<typeof modelPullStatusSchema>;
export type ModelsCancelPullResult = z.infer<typeof modelsCancelPullResultSchema>;
export type ModelsPullResult = z.infer<typeof modelsPullResultSchema>;
export type RecommendedModel = (typeof RECOMMENDED_MODELS)[number];
export type RecommendedModelName = z.infer<typeof recommendedModelNameSchema>;
export type RecommendedModelRole = z.infer<typeof recommendedModelRoleSchema>;
export type OllamaStatus = z.infer<typeof ollamaStatusSchema>;
export type RagEmbeddingStatus = z.infer<typeof ragEmbeddingStatusSchema>;
export type RagGetStatusRequest = z.infer<typeof ragGetStatusRequestSchema>;
export type RagGetStatusResult = z.infer<typeof ragGetStatusResultSchema>;
export type RagRuntimeAvailable = z.infer<typeof ragRuntimeAvailableSchema>;
export type RagRuntimeStatus = z.infer<typeof ragRuntimeStatusSchema>;
export type RagRuntimeUnavailable = z.infer<typeof ragRuntimeUnavailableSchema>;
export type RagRuntimeUnavailableReason = z.infer<
  typeof ragRuntimeUnavailableReasonSchema
>;
export type RagSetGenerationModelResult = z.infer<
  typeof ragSetGenerationModelResultSchema
>;
export type RagSetGenerationModelRequest = z.infer<
  typeof ragSetGenerationModelRequestSchema
>;
export type RagStatus = z.infer<typeof ragStatusSchema>;
export type SearchResult = z.infer<typeof searchResultSchema>;
export type SemanticIndexJob = z.infer<typeof semanticIndexJobSchema>;
export type SemanticIndexJobStatus = z.infer<typeof semanticIndexJobStatusSchema>;
export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;
export type SourceBlock = z.infer<typeof sourceBlockSchema>;
export type SourceBlockWindow = z.infer<typeof sourceBlockWindowSchema>;
export type SourceGetWindowRequest = z.infer<typeof sourceGetWindowRequestSchema>;
export type SourceGetWindowResult = z.infer<typeof sourceGetWindowResultSchema>;
export type SourceLocator = z.infer<typeof sourceLocatorSchema>;
export type SystemStatus = z.infer<typeof systemStatusSchema>;
export type SystemStatusResponse = z.infer<typeof systemStatusResponseSchema>;

export interface KnosysDesktopApi {
  readonly chat: {
    cancel(runId: string): Promise<ChatMessage>;
    createFolder(name: string): Promise<ChatFolder>;
    deleteFolder(folderId: string): Promise<ChatDeleteFolderResult>;
    deleteThread(threadId: string): Promise<ChatDeleteThreadResult>;
    getThread(threadId: string): Promise<ChatThread>;
    listFolders(): Promise<readonly ChatFolder[]>;
    listThreads(): Promise<readonly ChatThreadSummary[]>;
    moveThread(threadId: string, folderId: string | null): Promise<ChatThreadSummary>;
    onEvent(listener: (event: ChatEvent) => void): () => void;
    renameFolder(folderId: string, name: string): Promise<ChatFolder>;
    renameThread(threadId: string, title: string): Promise<ChatThreadSummary>;
    send(
      threadId: string | null,
      question: string,
      mode?: AnswerMode,
    ): Promise<ChatAcceptance>;
  };
  readonly evidence: {
    get(citationId: string): Promise<ChatCitation>;
  };
  readonly library: {
    acknowledgeReview(documentId: string): Promise<LibrarySnapshot>;
    deleteDocument(documentId: string): Promise<LibraryDeleteDocumentResult>;
    getDocumentReview(documentId: string): Promise<DocumentReview>;
    getSnapshot(): Promise<LibrarySnapshot>;
    importDirectory(): Promise<ImportSelectionResult>;
    importFiles(): Promise<ImportSelectionResult>;
    onImportProgress(listener: (event: ImportProgressEvent) => void): () => void;
    replaceDocument(documentId: string): Promise<ImportSelectionResult>;
    reprocessDocument(documentId: string): Promise<LibrarySnapshot>;
    search(query: string): Promise<readonly SearchResult[]>;
  };
  readonly memory: {
    setThreadExclusion(threadId: string, excluded: boolean): Promise<ChatThreadSummary>;
  };
  readonly models: {
    cancelPull(model: RecommendedModelName): Promise<ModelsCancelPullResult>;
    onPullEvent(listener: (event: ModelPullEvent) => void): () => void;
    pull(model: RecommendedModelName): Promise<ModelsPullResult>;
  };
  readonly preferences: {
    get(): Promise<AppPreferences>;
    set(patch: AppPreferencesPatch): Promise<AppPreferences>;
  };
  readonly rag: {
    getStatus(): Promise<RagStatus>;
    setGenerationModel(preference: GenerationModelPreference): Promise<RagStatus>;
  };
  readonly source: {
    getWindow(
      chunkId: string,
      before: number,
      after: number,
    ): Promise<readonly SourceBlock[]>;
  };
  readonly system: {
    getStatus(): Promise<SystemStatus>;
  };
}

const encodedIpcErrorSchema = z
  .object({
    __knosys: z.literal(1),
    code: ipcErrorCodeSchema,
    message: z.string().min(1).max(2048),
    retryable: z.boolean(),
  })
  .strict();

/**
 * Typed error for `window.knosys` calls. Errors thrown across the sandboxed
 * contextBridge only keep their `message`, so the preload encodes the full
 * structured IPC error into the message via {@link KnosysApiError.encodeMessage}
 * and renderer callers recover it with {@link KnosysApiError.fromThrown}.
 */
export class KnosysApiError extends Error {
  readonly code: IpcErrorCode;
  readonly retryable: boolean;

  constructor(error: IpcError) {
    super(error.message);
    this.name = "KnosysApiError";
    this.code = error.code;
    this.retryable = error.retryable;
  }

  static encodeMessage(error: IpcError): string {
    return JSON.stringify({
      __knosys: 1,
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    });
  }

  static fromThrown(thrown: unknown): KnosysApiError {
    if (thrown instanceof KnosysApiError) return thrown;
    const raw =
      thrown instanceof Error
        ? thrown.message
        : typeof thrown === "string"
          ? thrown
          : "";
    if (raw.startsWith("{")) {
      let candidate: unknown;
      try {
        candidate = JSON.parse(raw);
      } catch {
        candidate = null;
      }
      const parsed = encodedIpcErrorSchema.safeParse(candidate);
      if (parsed.success) {
        return new KnosysApiError({
          code: parsed.data.code,
          message: parsed.data.message,
          retryable: parsed.data.retryable,
        });
      }
    }
    return new KnosysApiError({
      code: "INTERNAL_ERROR",
      message: raw.length > 0 ? raw : "An unexpected error occurred.",
      retryable: false,
    });
  }
}
