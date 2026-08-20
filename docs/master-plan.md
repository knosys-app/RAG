# Garden AI — Codex Implementation Plan

## Purpose

Build a **desktop-first, local-first knowledge application** that can ingest a personal library of gardening, agriculture, crop processing, food preservation, and crop storage material, then answer natural-language questions using that library with **grounded, verifiable citations**.

The first version is not an autonomous gardening agent. It is a reliable knowledge and retrieval platform that can later support richer agent behavior, personal garden records, weather, sensors, harvest tracking, and integration into an existing application.

The architecture must be modular enough that the core knowledge engine can later be moved into or consumed by another repository without bringing the Electron shell with it.

---

# 1. Product Goal

The Phase 1 application should let a user:

1. Import a directory or individual documents.
2. Ingest heterogeneous reference material.
3. Preserve useful document structure such as:
   - title
   - author
   - publisher
   - publication date
   - chapter
   - section
   - page number
   - paragraphs
   - lists
   - tables
   - image/OCR references when applicable
4. Normalize all supported formats into a single internal document representation.
5. Chunk documents semantically rather than by arbitrary token windows alone.
6. Generate embeddings and a searchable full-text index.
7. Ask natural-language questions.
8. Retrieve the best source passages using hybrid retrieval.
9. Generate an answer using only retrieved evidence when the question is intended to be grounded in the user's library.
10. Display citations that identify the source document and, where available, chapter/section/page.
11. Allow the user to inspect the cited source material.
12. Rebuild derived indexes without re-importing original source files.

The key success criterion is:

> Given a heterogeneous directory of agricultural reference documents, the system can reliably normalize and index them, retrieve the appropriate source material for a natural-language question, and generate a grounded answer with verifiable citations.

---

# 2. Explicit Non-Goals for Phase 1

Do **not** expand the initial build into the following areas yet:

- weather integrations
- garden sensors
- irrigation control
- planting calendar automation
- personal garden journal
- harvest inventory
- pest/disease image diagnosis
- autonomous agent loops
- web browsing as a primary knowledge source
- cloud sync
- multi-user accounts
- mobile application
- hosted SaaS backend
- elaborate plugin system
- custom model training or fine-tuning

Design interfaces so these can be added later, but do not let them expand Phase 1 scope.

---

# 3. Technology Stack

## Desktop

Use:

- **Electron**
- **React**
- **TypeScript**
- **Vite**
- **pnpm workspaces**
- **Tailwind CSS**
- **shadcn/ui**

The Electron application should be a relatively thin desktop shell around reusable application packages.

## Persistence

Use:

- **SQLite** as the canonical application and knowledge metadata store.
- **SQLite FTS5** for keyword/full-text retrieval.

The vector layer must be behind an abstraction.

Evaluate during planning whether Phase 1 should use:

- Qdrant
- an embedded SQLite vector extension
- another mature local vector implementation

Do not hard-code the rest of the architecture to the selected vector database.

## LLM

Create a provider abstraction.

Initial implementation should be **local-first**, with an adapter for an appropriate local runtime such as Ollama.

The architecture should make future adapters possible for:

- OpenAI
- Anthropic
- llama.cpp
- other local runtimes

Do not couple domain or retrieval code to a specific provider.

## Embeddings

Create an embedding provider abstraction.

Initial implementation should be local-first.

Codex should research and recommend an appropriate current embedding model/runtime based on:

- retrieval quality
- local hardware requirements
- context length
- embedding dimensions
- throughput
- licensing
- ease of distribution

---

# 4. Core Architectural Rule

The knowledge engine must not depend on Electron.

The dependency direction should look like:

```text
Electron / React UI
        |
        v
Application services
        |
        v
Agent / Retrieval / Ingestion packages
        |
        v
Core domain models + storage interfaces
```

Never:

```text
core package -> Electron
retrieval package -> Electron
ingestion package -> Electron
```

Electron-specific behavior belongs only in the desktop application layer.

The goal is to make future integration into another repository possible through package imports or a service boundary.

Example future usage:

```ts
import { createKnowledgeEngine } from "@garden-ai/core";
import { ask } from "@garden-ai/agent";
```

---

# 5. Process and Concurrency Model

Never perform CPU-heavy or long-running document work on:

- the Electron main event loop
- the React renderer event loop

Use an explicit job architecture.

Potential execution mechanisms:

- Node `worker_threads`
- Electron `utilityProcess`
- independent child processes
- native subprocesses
- selective Rust modules later if profiling demonstrates a need

Codex should evaluate which workload belongs where.

Likely examples:

```text
Electron Renderer
    UI only

Electron Main
    application lifecycle
    secure IPC
    filesystem permission orchestration
    worker supervision

Ingestion Workers
    parsing
    normalization
    chunking
    metadata analysis

External / Native Processes
    OCR
    model inference
    embeddings
    vector database if external
```

Node should act primarily as the orchestration/application layer.

Do not introduce Rust preemptively. Preserve a clean boundary where CPU-heavy components can later be rewritten or exposed as native modules if profiling justifies it.

---

# 6. Initial File Format Support

## P0 — Required

Support these formats in the initial ingestion engine:

- PDF (`.pdf`)
- Markdown (`.md`, `.markdown`)
- Microsoft Word (`.docx`)
- Plain text (`.txt`)
- EPUB (`.epub`)
- HTML (`.html`, `.htm`)

## P1 — Planned Immediately After Core Ingestion

Support image-based documents via OCR:

- PNG
- JPEG/JPG
- TIFF

## Later

Architect adapters so the following can be added without redesigning ingestion:

- RTF
- ODT
- legacy `.doc`
- PPTX
- CSV
- XLSX
- MHTML/web archive formats

Spreadsheets and presentation formats should eventually receive structure-aware parsing rather than being flattened into arbitrary text.

---

# 7. Ingestion Architecture

Every source format must pass through the same high-level pipeline:

```text
Source File
    |
    v
Detect Format
    |
    v
Parse
    |
    v
Normalized Structured Document IR
    |
    v
Validate
    |
    v
Enrich
    |
    v
Semantic / Structure-Aware Chunking
    |
    v
Embeddings
    |
    +--> Vector Index
    |
    +--> Full-Text Index
    |
    v
READY
```

Each stage must be:

- independently testable
- independently rerunnable
- resumable
- versionable
- observable
- safe to retry

Do not build ingestion as one monolithic `ingestFile()` function that performs all stages opaquely.

---

# 8. Source Files Must Be Immutable

Imported source documents are the source of truth and should be treated as immutable.

Store enough information to re-run later stages without asking the user to re-import the document.

Suggested conceptual layout:

```text
library/
  sources/
  extracted/
  normalized/
  derived/
```

The exact on-disk layout may differ, but preserve this distinction:

```text
Original source = immutable truth

Extracted text = derived

Normalized IR = derived

Chunks = derived

Embeddings = derived

Vector index = derived
```

Any derived artifact should be reproducible from the original source plus versioned processing configuration.

---

# 9. File Fingerprinting and Deduplication

Immediately fingerprint imported files using SHA-256 or another appropriate cryptographic checksum.

Example:

```text
SHA-256(file bytes)
```

Use this to prevent exact duplicates from being ingested multiple times.

A later version may add near-duplicate detection, but exact file deduplication is required in Phase 1.

Track:

- checksum
- original filename
- original path
- imported timestamp
- file size
- MIME type
- parser used
- extraction version
- normalization version
- chunking version
- embedding model/version

---

# 10. Directory Ingestion

Directory ingestion is a first-class feature, not a convenience wrapper.

The user should be able to select a directory such as:

```text
Agriculture/
├── Gardening/
│   ├── Vegetables/
│   ├── Fruit/
│   └── Soil/
├── Preservation/
│   ├── Canning/
│   ├── Dehydrating/
│   └── Fermentation/
└── Storage/
```

The application should recursively discover supported source files.

Directory hierarchy may be preserved as metadata, for example:

```text
category = Preservation
subcategory = Canning
```

Do not treat folder-derived metadata as authoritative factual metadata; it is user organization metadata.

The design should leave room for future watched folders, but watched-folder syncing is not required for the MVP.

---

# 11. Parser Adapter Interface

Every format parser should conform to a common contract.

Conceptual example:

```ts
export interface DocumentParser {
  readonly id: string;
  readonly version: string;

  supports(file: SourceFile): boolean;

  parse(
    file: SourceFile,
    options?: ParseOptions,
  ): Promise<ParsedDocument>;
}
```

Possible module structure:

```text
packages/
  ingestion/
    src/
      parsers/
        pdf/
        docx/
        markdown/
        text/
        epub/
        html/
```

Adding a new source format should not require changes to retrieval, chunking, embedding, or the agent.

---

# 12. Normalized Structured Document IR

This is one of the most important architectural components.

Do **not** flatten every document immediately into a single string.

All parsers should produce the same internal representation.

Conceptual model:

```ts
interface ParsedDocument {
  document: DocumentMetadata;
  blocks: DocumentBlock[];
  diagnostics: ParseDiagnostic[];
}

type DocumentBlock =
  | HeadingBlock
  | ParagraphBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | QuoteBlock
  | CodeBlock;
```

Common block metadata:

```ts
interface BaseBlock {
  id: string;

  ordinal: number;

  location?: {
    page?: number;
    pageEnd?: number;
    chapter?: string;
    section?: string;
    headingPath?: string[];
  };
}
```

Possible block types:

```ts
interface HeadingBlock extends BaseBlock {
  type: "heading";
  level: number;
  text: string;
}

interface ParagraphBlock extends BaseBlock {
  type: "paragraph";
  text: string;
}

interface ListBlock extends BaseBlock {
  type: "list";
  ordered: boolean;
  items: string[];
}

interface TableBlock extends BaseBlock {
  type: "table";
  caption?: string;
  headers?: string[];
  rows: string[][];
}

interface ImageBlock extends BaseBlock {
  type: "image";
  altText?: string;
  caption?: string;
  extractedText?: string;
}
```

The actual schema may evolve during implementation, but the following properties are mandatory:

- source document relationship
- stable ordering
- block type
- source location where available
- heading/chapter/section context
- page number where available
- original textual content
- table structure must not be casually destroyed

---

# 13. PDF Strategy

PDF parsing requires special treatment.

The engine should determine:

1. Does the PDF contain embedded text?
2. Is that embedded text usable?
3. Does layout extraction appear sane?
4. Is OCR required?
5. Are some pages native text and others scanned?

Conceptual decision path:

```text
PDF
 |
 v
Extract embedded text
 |
 v
Quality validation
 |
 +--> GOOD -> native structured extraction
 |
 +--> BAD/MISSING -> OCR / alternate extraction path
```

Do not assume "text exists" means "text is usable."

Detect common extraction problems where practical:

- scrambled columns
- character spacing corruption
- missing text
- invalid reading order
- repeated headers/footers
- excessive control characters
- extremely low text density
- pages containing only images

Codex should research current mature PDF parsing/extraction libraries for Node/TypeScript and recommend the best fit.

The evaluation should consider:

- text extraction accuracy
- page preservation
- heading/layout preservation
- table handling
- multi-column documents
- scanned-document handling
- licensing
- maintenance status
- Electron compatibility

---

# 14. OCR

OCR is required as a fallback capability, but it does not need to dominate the first implementation milestone.

The OCR design should:

- run outside Electron main/renderer threads
- preserve page numbers
- return confidence/diagnostics where possible
- store OCR output as a derived artifact
- allow OCR to be rerun with a different engine later

Codex should compare suitable current OCR options.

Do not repeatedly OCR documents that already have successful cached OCR output unless explicitly reprocessing.

---

# 15. Validation and Parse Quality

Every parsed document should produce diagnostics.

Examples:

```ts
interface ParseDiagnostic {
  severity: "info" | "warning" | "error";

  code: string;
  message: string;

  page?: number;
}
```

The system should be able to identify states such as:

```text
Parsed successfully

Parsed with warnings

OCR required

Low-confidence extraction

Unsupported structure

Failed
```

Do not silently index obviously corrupted extraction output.

---

# 16. Metadata Model

Store both source metadata and inferred metadata.

Possible source metadata:

- title
- authors
- publisher
- publication date/year
- ISBN if available
- source filename
- source path
- MIME type
- page count
- format
- language

Agricultural classification metadata may later include:

- crops
- crop varieties
- pests
- diseases
- soil topics
- nutrients
- fertilizer topics
- growing techniques
- harvest methods
- preservation methods
- storage methods
- climate/geographic regions

Maintain provenance for metadata.

Conceptual example:

```ts
interface MetadataValue<T> {
  value: T;
  provenance: "document" | "user" | "inferred";
  confidence?: number;
}
```

Do not overwrite reliable extracted metadata with model-generated guesses.

---

# 17. Authority Ranking

The knowledge system should represent source authority explicitly.

Initial conceptual tiers:

```text
Tier 1
- USDA
- NCHFP
- FDA
- state agricultural agencies

Tier 2
- university extension programs
- agricultural universities
- cooperative extension publications

Tier 3
- established reference books
- agricultural textbooks
- professional horticultural publications

Tier 4
- general gardening books
- magazines
- commercial growing guides

Tier 5
- personal notes
- miscellaneous or unverified sources
```

This should not be implemented as a simplistic universal ranking where a Tier 1 document always wins.

Authority weighting should be **query-sensitive**.

For example:

```text
Food safety / canning
    authority weighting = very high

Plant trellis style
    authority weighting = much lower
```

Design the retrieval scoring interface so authority weighting can be incorporated without hard-wiring one formula forever.

---

# 18. Chunking

Do not chunk documents only by a fixed token count.

Chunking should consider:

- chapter boundaries
- section boundaries
- heading hierarchy
- paragraph groups
- lists
- tables
- page boundaries
- maximum token budget
- useful overlap where needed

Preferred conceptual process:

```text
Document
   |
   v
Chapter
   |
   v
Section
   |
   v
Blocks
   |
   v
Semantic chunks
```

A chunk must retain its source context.

Conceptual schema:

```ts
interface KnowledgeChunk {
  id: string;
  documentId: string;

  text: string;

  blockIds: string[];

  location: {
    pageStart?: number;
    pageEnd?: number;
    chapter?: string;
    section?: string;
    headingPath?: string[];
  };

  classifications?: {
    topics?: string[];
    crops?: string[];
    techniques?: string[];
  };

  processing: {
    chunkerVersion: string;
    tokenCount?: number;
  };
}
```

Tables should be represented in a form that preserves their relationships.

Do not blindly turn:

```text
Temperature | Humidity
38-40 F     | 90-95%
```

into disconnected tokens.

---

# 19. Ingestion State Machine

Ingestion should be resumable.

Suggested document processing states:

```text
QUEUED
  |
  v
HASHED
  |
  v
PARSED
  |
  v
VALIDATED
  |
  v
NORMALIZED
  |
  v
ENRICHED
  |
  v
CHUNKED
  |
  v
EMBEDDED
  |
  v
INDEXED
  |
  v
READY
```

Errors should preserve enough state to retry the failed stage without starting from zero.

Store job information such as:

- stage
- status
- started timestamp
- completed timestamp
- retry count
- error details
- processor version
- progress
- worker identifier when useful

---

# 20. Versioned Processing

Each derived stage should record the implementation/model version that created it.

Examples:

```text
parser: pdf-parser-v1
normalizer: document-ir-v2
chunker: semantic-chunker-v3
embedding-provider: local
embedding-model: <model-name>
embedding-model-version: <version>
```

This enables selective reprocessing.

Example:

```text
Embedding model changed
        |
        v
Re-embed chunks

Do NOT:
reparse PDF
renormalize
rechunk
```

Likewise:

```text
Improved PDF parser
        |
        v
Reparse
renormalize
rechunk
re-embed
reindex
```

---

# 21. Canonical Storage Model

SQLite should remain the canonical metadata and knowledge-state database.

Likely entities include:

```text
documents
source_files
document_metadata
document_blocks
parse_runs
parse_diagnostics
chunks
chunk_metadata
ingestion_jobs
processing_versions
citations
tags
document_tags
chunk_tags
```

Codex should propose a normalized initial schema.

The vector store is a derived search index, not the source of truth.

This should always be possible:

```bash
garden-ai reindex
```

Conceptually, that command should be able to rebuild searchable indexes from canonical stored chunks.

The actual CLI command can be designed later.

---

# 22. Hybrid Retrieval

Do not use embeddings alone.

Initial retrieval should combine:

```text
Question
   |
   +----------------+
   |                |
   v                v
Vector Search   Full-Text Search
   |                |
   +--------+-------+
            |
            v
        Merge
            |
            v
Metadata / authority adjustments
            |
            v
        Reranking
            |
            v
Best evidence passages
```

Reasons:

Semantic retrieval is strong for questions such as:

> What symptoms indicate nitrogen deficiency in pumpkins?

Keyword/full-text search can be superior for exact identifiers such as:

> Blue Lake 274

or:

> 10-10-10 fertilizer

Build retrieval as a standalone module.

Conceptual API:

```ts
interface KnowledgeRetriever {
  retrieve(
    query: RetrievalQuery,
  ): Promise<RetrievalResult>;
}
```

Possible result:

```ts
interface RetrievalResult {
  query: string;

  matches: Array<{
    chunkId: string;
    documentId: string;

    text: string;

    scores: {
      semantic?: number;
      lexical?: number;
      rerank?: number;
      authority?: number;
      final: number;
    };

    citation: Citation;
  }>;
}
```

---

# 23. Retrieval and Generation Must Be Separate

The system must make it possible to test retrieval independently of the LLM answer.

Do not build:

```ts
askQuestion(question)
```

as an opaque function where retrieval and generation cannot be inspected separately.

Prefer:

```ts
const evidence = await knowledge.retrieve(question);

const answer = await agent.answer({
  question,
  evidence,
});
```

This separation is mandatory for evaluation and debugging.

---

# 24. Agent / Answer Generation

The first "agent" is primarily an answer orchestration layer.

Responsibilities:

- understand the user's question
- determine retrieval needs
- request evidence
- optionally apply metadata filters
- assemble context
- call the LLM
- require evidence-grounded answers
- construct citations
- detect unsupported claims where practical

It should not become an open-ended autonomous loop in Phase 1.

When answering from the user's library, the model should distinguish between:

- statements supported by retrieved documents
- model background knowledge
- uncertainty / absence of evidence

For grounded-library mode, default toward **not inventing information that is absent from retrieved evidence**.

---

# 25. Citation Model

Every retrieved chunk must retain enough information to construct a citation.

Conceptual schema:

```ts
interface Citation {
  documentId: string;
  documentTitle: string;

  authors?: string[];
  publisher?: string;

  pageStart?: number;
  pageEnd?: number;

  chapter?: string;
  section?: string;

  chunkId: string;
}
```

The user interface should eventually let the user click a citation and inspect the corresponding source passage/page.

Phase 1 does not require a full advanced PDF annotation viewer, but citation navigation must be accounted for architecturally.

---

# 26. Local Model Provider Interfaces

Keep providers isolated.

Conceptual LLM interface:

```ts
interface LanguageModel {
  generate(
    request: GenerationRequest,
  ): Promise<GenerationResponse>;
}
```

Conceptual embedding interface:

```ts
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}
```

Application packages should not import Ollama-specific code directly.

Instead:

```text
packages/
  llm/
    core/
    providers/
      ollama/
      future-openai/
      future-anthropic/

  embeddings/
    core/
    providers/
      local/
```

Provider-specific configuration belongs behind these boundaries.

---

# 27. Suggested Monorepo Structure

Codex should refine this if needed, but preserve the dependency boundaries.

```text
garden-ai/
│
├── apps/
│   └── desktop/
│       ├── electron/
│       ├── preload/
│       └── renderer/
│
├── packages/
│   ├── core/
│   │   ├── domain/
│   │   ├── errors/
│   │   └── config/
│   │
│   ├── database/
│   │
│   ├── documents/
│   │
│   ├── ingestion/
│   │   ├── parsers/
│   │   ├── normalization/
│   │   ├── validation/
│   │   ├── enrichment/
│   │   └── chunking/
│   │
│   ├── retrieval/
│   │
│   ├── embeddings/
│   │
│   ├── llm/
│   │
│   ├── agent/
│   │
│   └── ipc-contracts/
│
├── workers/
│   └── ingestion/
│
├── tests/
│   ├── fixtures/
│   ├── ingestion/
│   ├── retrieval/
│   └── evals/
│
├── scripts/
│
├── docs/
│   ├── architecture/
│   └── adr/
│
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

Avoid a giant shared `utils` package.

Favor explicit package responsibilities.

---

# 28. Electron Security Requirements

Use Electron security best practices from the beginning.

Requirements:

- context isolation enabled
- renderer sandboxed where practical
- no unrestricted Node access in renderer
- no raw `ipcRenderer` exposure
- expose narrow APIs through preload/context bridge
- validate IPC request payloads
- validate IPC responses where useful
- do not allow arbitrary renderer-provided filesystem paths to become privileged operations without validation
- keep external navigation restricted
- treat imported documents as untrusted input

Define typed IPC contracts.

Example conceptual boundary:

```ts
window.gardenAI.library.importDirectory()
window.gardenAI.library.listDocuments()
window.gardenAI.chat.ask(...)
window.gardenAI.ingestion.getJob(...)
```

Do not expose:

```ts
window.node.fs
window.electron.ipcRenderer
```

---

# 29. UI Scope for the MVP

The interface can be modest.

Minimum screens/components:

## Library

- import files
- import directory
- document list
- ingestion state
- source type
- extraction warnings/errors
- reprocess/retry option

## Ask

- question input
- streaming or progressive answer display if supported
- citations
- retrieved evidence inspector

## Document Detail

Basic metadata:

- title
- source path/name
- format
- pages if known
- authority tier
- ingestion state
- processing versions
- detected topics/tags
- diagnostics

Avoid building an elaborate visual design system before the retrieval pipeline works.

---

# 30. Evaluation System

Evaluation is a first-class part of the architecture, not a later polish task.

Create an evaluation fixture format.

Conceptual example:

```yaml
id: potato-storage-temperature
question: "At what temperature should potatoes be stored?"

expected_documents:
  - source-a

expected_pages:
  - 42

required_concepts:
  - "38"
  - "40"
```

Track at least:

- retrieval hit rate
- Recall@K
- citation correctness
- source authority quality
- answer faithfulness
- unsupported claims
- latency
- ingestion success rate
- parser quality across fixtures

Keep retrieval evaluation separate from answer-generation evaluation.

---

# 31. Test Corpus

Create a small controlled test library containing examples of:

- native-text PDF
- multi-column PDF
- scanned PDF
- PDF containing tables
- DOCX with headings and tables
- Markdown document
- plain text file
- EPUB
- HTML article
- duplicate document
- malformed or unsupported document

If copyright restrictions make real publications unsuitable for repository fixtures, generate synthetic test documents that mimic the required structures.

---

# 32. Logging and Observability

The application should make ingestion failures diagnosable.

Use structured logs for:

- ingestion job lifecycle
- parser selection
- parse duration
- page count
- OCR use
- extraction quality
- chunk counts
- embedding duration
- vector indexing duration
- retrieval timings
- selected evidence
- model provider failures

Never log sensitive document content unnecessarily.

Provide developer-friendly debug logging, but avoid making verbose internal logs part of the normal user experience.

---

# 33. Error Handling

Use typed/domain errors where practical.

Examples:

```text
UnsupportedDocumentFormat
DuplicateSourceFile
DocumentParseFailed
OCRFailed
EmbeddingProviderUnavailable
VectorIndexUnavailable
LanguageModelUnavailable
IngestionJobFailed
InvalidIPCRequest
```

The UI should present useful error states rather than generic "Something went wrong."

---

# 34. Performance Principles

Do not optimize blindly.

Initial principles:

- never block renderer or Electron main event loops with heavy work
- batch embeddings
- maintain worker pools rather than creating a new worker per chunk
- cache derived stages
- use incremental indexing
- avoid rereading large source files unnecessarily
- paginate document lists
- stream ingestion progress
- profile before introducing Rust/native rewrites

Performance-sensitive code may later move to Rust if measured bottlenecks justify it.

---

# 35. Future Domain Model

Do not fully implement this in Phase 1, but reserve clean extension points for agricultural entities such as:

```text
Crop
Variety
Disease
Pest
Nutrient
Fertilizer
Technique
PreservationMethod
StorageMethod
ClimateZone
SoilType
```

In a later phase these can support metadata-aware retrieval.

Example:

```text
question:
"What does my library say about overwintering strawberries?"

possible future filters:
crop = strawberry
topic = overwintering
```

Do not prematurely build a large ontology before the core RAG system works.

---

# 36. Future Personal Garden Dataset

Keep personal garden information conceptually separate from the reference knowledge library.

Future domain entities may include:

```text
Garden
GardenBed
Planting
Plant
Harvest
Treatment
Observation
SoilMeasurement
WeatherObservation
IrrigationEvent
```

Later:

```text
Reference Library
        |
        v
Knowledge Engine
        ^
        |
Personal Garden Data
```

A future question could combine both:

> Why are my pumpkin leaves turning yellow?

and retrieve:

- reference material about nutrient deficiency, disease, heat stress, and watering
- the user's planting date
- fertilizer history
- irrigation events
- soil measurements
- recent weather

This separation should influence package design, but should not expand Phase 1 implementation.

---

# 37. Implementation Milestones

## Milestone 0 — Architecture Validation

Before significant implementation:

- inspect repository state
- confirm monorepo tooling
- define package boundaries
- define dependency graph
- define ADR format
- select test framework
- select validation library
- research unresolved technical choices
- produce implementation plan and risk list

Deliverables:

- architecture document
- repository skeleton
- initial ADRs
- technical dependency recommendations

---

## Milestone 1 — Desktop Shell

Build:

- Electron + React + TypeScript
- Vite
- pnpm workspace
- Tailwind
- shadcn/ui
- secure preload
- typed IPC foundation
- application logging
- basic navigation

Acceptance:

- desktop app starts on macOS
- React renderer is sandboxed appropriately
- renderer cannot directly access unrestricted Node APIs
- typed IPC call works between renderer and main

Do not spend significant effort on visual polish yet.

---

## Milestone 2 — Canonical Storage

Build SQLite persistence for:

- source documents
- metadata
- ingestion jobs
- processing versions
- blocks
- chunks
- diagnostics

Add migrations.

Acceptance:

- database initializes cleanly
- migrations are testable
- source and derived state are distinguishable
- deleting vector indexes does not destroy canonical document/chunk data

---

## Milestone 3 — File Import + Deduplication

Build:

- file picker
- directory picker
- recursive discovery
- supported format detection
- SHA-256 fingerprinting
- duplicate detection
- immutable source storage/reference strategy
- ingestion queue

Acceptance:

- a directory containing mixed formats can be queued
- unsupported files are reported but do not crash the import
- exact duplicates are not re-ingested
- ingestion jobs survive app restart

---

## Milestone 4 — Normalized IR + Simple Parsers

Implement first:

- TXT
- Markdown
- HTML

These provide low-complexity validation of the IR architecture.

Acceptance:

- all three formats produce the same normalized IR
- headings, paragraphs, lists, and source metadata are preserved where available
- parser unit tests cover core structures

---

## Milestone 5 — DOCX + EPUB

Implement:

- DOCX parser
- EPUB parser
- tables
- headings
- sections
- metadata where available

Acceptance:

- Word headings and tables survive normalization
- EPUB chapter hierarchy survives normalization
- generated chunks retain source hierarchy

---

## Milestone 6 — PDF

Implement native-text PDF ingestion.

Then add:

- extraction quality analysis
- multi-column testing
- page preservation
- repeated header/footer handling where practical
- table handling strategy
- OCR fallback interface

Acceptance:

- native test PDFs index correctly
- page-level citation metadata is preserved
- low-quality extraction can be flagged instead of silently indexed

---

## Milestone 7 — Semantic Chunking

Implement structure-aware chunking.

Acceptance:

- chunks do not unnecessarily cross chapter/section boundaries
- chunks retain heading hierarchy
- tables retain useful structure
- chunk size remains within embedding/model constraints
- deterministic tests cover chunking behavior

---

## Milestone 8 — Full-Text Search

Implement SQLite FTS5.

Acceptance:

- exact cultivar names and numeric terms are retrievable
- result includes citation metadata
- retrieval package is independent from the UI

---

## Milestone 9 — Embeddings + Vector Store

Implement:

- embedding provider abstraction
- initial local provider
- vector index abstraction
- selected Phase 1 vector backend
- batch embedding
- reindexing

Acceptance:

- semantic queries retrieve appropriate passages
- vector index can be deleted and reconstructed
- embedding model/version is tracked
- changing embeddings does not require reparsing documents

---

## Milestone 10 — Hybrid Retrieval

Implement:

- FTS results
- vector results
- merge strategy
- metadata filtering hooks
- authority scoring hook
- reranking interface

Acceptance:

- evaluation suite demonstrates hybrid retrieval performs at least as well as either lexical or vector-only retrieval on the controlled corpus
- exact-name queries remain strong
- semantic questions remain strong

---

## Milestone 11 — Local LLM + Grounded Answers

Implement:

- LLM provider interface
- initial local runtime adapter
- evidence context construction
- grounded response prompt
- citation generation
- unsupported-evidence behavior

Acceptance:

- question produces answer plus citations
- answer citations point to retrieved chunks
- model does not silently invent citations
- evidence can be inspected independently of generated answer

---

## Milestone 12 — Evaluation Harness

Formalize evaluation and regression testing.

Acceptance:

- retrieval metrics can be run from CLI/script
- answer faithfulness tests exist
- parser fixture tests exist
- changing chunking or embeddings produces measurable before/after results

---

# 38. Initial Research Questions for Codex

Before finalizing dependencies, research current primary documentation and active packages for the following.

## PDF

Compare current options for:

- text extraction
- reading order
- page metadata
- table extraction
- multi-column handling
- Electron compatibility

Recommend one primary parser and a fallback strategy.

## DOCX

Evaluate current maintained libraries for:

- headings
- lists
- tables
- metadata
- relationships/images if useful

## EPUB

Evaluate current maintained EPUB parsing options that preserve:

- chapter ordering
- headings
- HTML structure
- metadata

## HTML

Prefer a mature DOM parser and implement readability cleanup carefully.

Do not aggressively strip semantically useful headings/tables.

## OCR

Compare current local OCR options based on:

- accuracy
- macOS compatibility
- Windows/Linux portability
- distribution complexity
- confidence reporting
- performance

## Vector Storage

Compare at minimum:

- Qdrant
- embedded SQLite vector solution(s)

Evaluate:

- installation/distribution burden
- index performance
- filtering
- persistence
- local-only operation
- Electron packaging
- rebuildability
- future scaling

## Embeddings

Recommend an initial local embedding model based on:

- English retrieval quality
- agriculture-specific terminology robustness
- model size
- local performance
- licensing
- batching support
- context length

## LLM Runtime

Recommend an initial local runtime integration.

The provider abstraction matters more than the first provider choice.

---

# 39. Architectural Decision Records

Create ADRs for important decisions rather than burying them in code.

Initial ADRs should include:

```text
ADR-001: Electron desktop shell
ADR-002: TypeScript monorepo and package boundaries
ADR-003: SQLite as canonical store
ADR-004: Structured normalized document IR
ADR-005: Hybrid lexical + vector retrieval
ADR-006: Provider abstraction for LLMs and embeddings
ADR-007: Process isolation for heavy workloads
ADR-008: Immutable source files and rebuildable derived state
```

Include alternatives considered and consequences.

---

# 40. Code Quality Requirements

- TypeScript strict mode.
- Avoid `any` unless deliberately justified.
- Use schema validation across process/data boundaries.
- Prefer dependency injection for providers/storage where it materially improves testability.
- Keep domain interfaces small.
- Avoid premature abstraction.
- Avoid large god classes/services.
- Keep parser-specific behavior inside parser modules.
- Keep renderer state separate from knowledge-engine state.
- Do not silently catch ingestion failures.
- Add tests with each package rather than at the end.

---

# 41. Security and Privacy Philosophy

This application is local-first.

Initial principles:

- user documents remain local by default
- no document content is transmitted to a cloud model unless a future cloud provider is explicitly configured
- clearly represent the active model/provider
- treat imported files as untrusted
- avoid executing content from imported HTML/documents
- sanitize rendered HTML
- validate file paths and IPC payloads
- never evaluate scripts contained in imported content

---

# 42. Definition of Phase 1 Done

Phase 1 is complete when all of the following are true:

1. The Electron application runs reliably.
2. The user can import a directory containing:
   - PDF
   - DOCX
   - Markdown
   - TXT
   - EPUB
   - HTML
3. Duplicate source files are detected.
4. Ingestion is resumable.
5. All formats normalize into the shared structured IR.
6. Page/section/chapter metadata is retained where available.
7. Documents are chunked semantically.
8. SQLite FTS is functional.
9. Semantic vector retrieval is functional.
10. Hybrid retrieval is functional.
11. An evaluation corpus demonstrates retrieval quality.
12. A local LLM can answer questions using retrieved evidence.
13. Answers contain verifiable source citations.
14. The user can inspect the passages supporting an answer.
15. Vector indexes can be rebuilt from canonical stored data.
16. The Electron main and renderer threads remain responsive during ingestion.
17. Core ingestion/retrieval/agent packages have no Electron dependency.

---

# 43. Instructions to Codex

Treat this document as the product and architecture brief.

Before writing substantial code:

1. Inspect the current repository.
2. Identify any existing project conventions that should be preserved.
3. Research unresolved dependencies using current primary documentation.
4. Produce a concrete implementation plan broken into small milestones.
5. Call out any recommendation in this document that should change because of a materially better current technical option.
6. Explain the tradeoff before deviating.
7. Define the proposed package dependency graph.
8. Define the initial database schema.
9. Define the normalized Document IR.
10. Define the typed IPC boundary.
11. Define the ingestion state machine.
12. Define the first evaluation corpus and metrics.
13. List major technical risks.
14. Identify which choices should be ADRs.
15. Do not expand Phase 1 scope into sensors, weather, garden journaling, cloud sync, or autonomous agents.

When implementation begins:

- work milestone by milestone
- keep commits small and coherent
- add tests with each milestone
- do not move heavy ingestion work onto Electron main/renderer threads
- do not couple reusable packages to Electron
- do not make Qdrant, Ollama, or any other initial provider impossible to swap later
- do not discard document structure during ingestion
- do not generate citations that cannot be traced back to stored source metadata
- preserve the ability to rebuild derived indexes from the canonical source/SQLite state

---

# 44. Guiding Principle

The product should evolve in this order:

```text
Reliable document ingestion
        |
        v
Reliable structured knowledge
        |
        v
Reliable retrieval
        |
        v
Reliable citations
        |
        v
Reliable answers
        |
        v
Domain intelligence
        |
        v
Personal garden context
        |
        v
Agent behavior and integrations
```

Do not invert that order.

The value of the eventual agricultural assistant depends on the reliability of the knowledge foundation underneath it.

---

# 45. Approved RAG Execution Plan

This section amends the master plan with the implementation decisions approved
after completion of the secure desktop shell, canonical managed library,
normalized IR v2, structure-aware chunking, and SQLite FTS5 retrieval.

## 45.1 Locked Decisions

- Use exact-pinned `sqlite-vec` with `node:sqlite`, subject to a signed packaged
  runtime proof before committing production migrations to the extension.
- Use `qwen3-embedding:0.6b` as the reference embedding model, with its full
  1024-dimensional normalized output.
- Use `qwen3:8b` as the generation baseline compatible with the 16 GB minimum.
- Also evaluate and support `gemma4:26b` as a higher-memory quality profile.
- Keep all providers local through a separately installed Ollama runtime.
- Generation selection is model-neutral: consider any compatible local Ollama
  completion model, preserve valid manual choices, and in automatic mode choose
  deterministically by smallest artifact size, then model name and digest.
- Build both answer-delivery stages initially:
  1. a non-streaming, schema-validated grounded claim plan;
  2. streamed prose generated only from that validated plan and its evidence.
- Keep PDF and OCR as their own ingestion milestone. They must not block RAG
  over TXT, Markdown, HTML, DOCX, and EPUB.

## 45.2 Package and Process Boundaries

Add Electron-independent packages with the following responsibilities:

```text
@knosys-rag/inference
    provider interfaces and the validated Ollama adapter

@knosys-rag/retrieval
    lexical/vector candidate types, fusion, and evidence selection

@knosys-rag/answering
    grounding policy, claim planning, citation validation, and answer writing

@knosys-rag/evaluation
    fixture schemas, metrics, runners, baselines, and reports
```

The dependency direction is:

```text
desktop
  -> contracts
  -> engine
       -> ingestion
       -> storage-sqlite
       -> inference
       -> retrieval
       -> answering

evaluation
  -> ingestion
  -> storage-sqlite
  -> retrieval
  -> answering
```

Ollama, SQLite, vectors, source paths, and raw filesystem access remain inside
the privileged utility-process boundary. The renderer keeps `connect-src
'none'` and receives only validated application data.

## 45.3 Execution Slices

### Slice A — Native Vector Proof

- Pin `sqlite-vec` exactly.
- Load only the app-packaged, trusted extension and disable extension loading
  immediately afterward.
- Verify scalar cosine distance and `vec0` search in unit, development,
  production-build, signed-app, DMG, restart, and migration contexts.
- Fall back to canonical Float32 BLOB storage with TypeScript exact cosine
  ranking only if the signed packaged proof fails.

### Slice B — Evaluation Foundation

- Add versioned JSON corpus and case schemas validated with Zod.
- Identify gold evidence by source checksum, locator, and quote hash rather than
  generated block or chunk UUIDs.
- Implement Hit@K, Recall@K, precision, MRR, nDCG, citation validity, citation
  coverage, and baseline comparison.
- Record the current FTS5 behavior as the lexical baseline before retrieval
  tuning.

### Slice C — Durable Embeddings

- Add a schema-only migration for embedding profiles, semantic-index jobs,
  chunk embeddings, selected models, and coverage state.
- Record provider, model name, Ollama digest, dimensions, chunk content hash,
  embedding-input version, and timestamps.
- Never call Ollama from a migration or while holding the canonical document
  completion transaction.
- Run resumable, bounded embedding batches after lexical ingestion commits.
- Preserve lexical availability when Ollama or the embedding model is absent.
- Re-embed selectively when the model digest, dimensions, content hash, or
  embedding-input version changes. Do not reparse unchanged sources.

### Slice D — Vector and Hybrid Retrieval

- Use Float32 BLOBs as the canonical rebuildable embedding representation and
  `sqlite-vec` cosine distance for exact search.
- Add a `vec0` mirror only if corpus benchmarks show exact scan latency misses
  the release target.
- Embed Qwen3 queries with a versioned English retrieval instruction; do not add
  that instruction to document chunks.
- Retrieve independent lexical and vector candidate pools, initially 50 each.
- Fuse ranks with a versioned reciprocal-rank-fusion implementation.
- Return complete evidence with document/chunk identities, source anchors,
  component ranks/scores, fused score, and retrieval version.
- Support explicit `hybrid`, `lexical`, and `vector` diagnostic modes and an
  automatic lexical fallback when semantic retrieval is unavailable.
- Keep authority weighting and reranking behind interfaces until fixtures prove
  their value.

### Slice E — Grounded Answers and Persistent Chat

- Separate retrieval from generation in production APIs and tests.
- Assign application-issued evidence IDs before prompting the model.
- First call Ollama with a JSON schema to produce either:
  - `answer`, with atomic claims mapped to evidence IDs; or
  - `insufficient-evidence`, with no unsupported claims.
- Reject any plan containing unknown or unsupported evidence IDs.
- Stream a second writer pass constrained to the validated claim plan and
  evidence. Disable tools and do not expose model thinking traces.
- Validate citation markers during streaming. If final validation fails, use a
  deterministic answer assembled from the validated claim plan.
- Persist threads, messages, runs, model/retrieval versions, and immutable
  citation snapshots so old answers survive chunk reprocessing.
- Support cancellation, retry, interrupted-run recovery, and sequenced status,
  delta, citation, completion, cancellation, and failure events.
- Preserve typed error codes through utility process, main, preload, and
  renderer boundaries.

### Slice F — Chat and Evidence UI

- Enable Chats navigation and keep history readable when Ollama is unavailable.
- Show independent source, embedding-model, generation-model, and semantic-index
  readiness states.
- Add persistent thread history, a labeled composer, Send/Stop behavior, and
  retrieval/generation progress.
- Reuse the inspection rail for exact evidence snapshots and neighboring
  normalized source blocks.
- Render imported and generated content as inert React text/components. Never
  use imported HTML or model output with `dangerouslySetInnerHTML`.
- Meet WCAG 2.2 AA for streaming announcements, citation labels, focus return,
  keyboard operation, touch targets, errors, cancellation, and narrow-window
  dialogs.

### Slice G — Evaluation Completion

- Build a controlled synthetic corpus of approximately 20–30 documents and at
  least 80 retrieval/answer cases covering every available parser.
- Include exact identifiers, numeric values, semantic paraphrases, tables,
  near-neighbor distractors, contradictions, unanswerable questions,
  authority-sensitive safety questions, duplicate passages, and embedded prompt
  injection.
- Run lexical, vector, and hybrid ablations.
- Evaluate answer generation with oracle evidence, frozen retrieved evidence,
  and full end-to-end retrieval.
- Evaluate `qwen3:8b` and `gemma4:26b` separately with pinned model digests.
- Keep deterministic fake-provider evaluation in normal CI and real-model runs
  in local/reference-hardware release validation.

## 45.4 Initial Quality Gates

- Exact and numerical query Hit@5: `1.00`.
- Macro retrieval Recall@5: at least `0.90`.
- Hybrid Recall@5 and nDCG@10: no worse than the stronger lexical or vector
  baseline on the same corpus.
- Citation ID validity: `1.00`.
- Invented citations: zero.
- Factual-claim citation coverage: at least `0.95`.
- Unsupported claim rate: at most `0.05`.
- Unanswerable-question abstention F1: at least `0.90`.
- No critical food-safety case may regress.

## 45.5 Definition of This Milestone Done

This RAG milestone is complete when:

1. Existing and newly imported chunks receive durable, resumable embeddings.
2. Semantic and hybrid retrieval work and degrade safely to lexical retrieval.
3. Vector indexes can be deleted and rebuilt from canonical chunks.
4. Users can ask questions and receive local, persistent, evidence-grounded
   answers.
5. Every citation resolves to the exact evidence snapshot and source context
   used for the answer.
6. Model and embedding changes trigger selective derived-data rebuilds rather
   than source re-import or unnecessary parsing.
7. Deterministic evaluation and real-model reference evaluation meet the gates
   above.
8. `pnpm validate`, arm64 packaging, code-sign verification, launch/restart,
   index persistence, chat persistence, and packaged `sqlite-vec` loading pass.
9. Existing sandbox, context-isolation, immutable-source, and reusable-package
   boundaries remain intact.

---

# 46. Hybrid Relevance and Answerability Gate

This section amends the RAG execution plan after live ingested-grounding
evaluation demonstrated that the selected model can correctly recognize absent
information while still encoding that response as a cited answer plan. The
system must distinguish retrieval confidence from semantic answerability rather
than relying on prompt wording or structured-output branch order alone.

## 46.1 Objective

Prevent unsupported answers and unrelated citations while avoiding an extra
model call for retrieval results that can be classified confidently and safely.

## 46.2 Locked Decision

Add a three-way deterministic evidence-confidence gate before grounded planning:

1. `insufficient`: return an application-created `insufficient-evidence` result
   with no citations and no model inference.
2. `sufficient`: continue directly to the existing grounded planner without an
   additional answerability inference.
3. `uncertain`: call a dedicated, schema-validated answerability provider. An
   empty supporting-evidence set produces deterministic insufficiency; a valid
   non-empty set continues to answer-only planning over those evidence items.

The deterministic assessment must use versioned, calibrated retrieval and
context signals. It must not rely on fused RRF score alone, model-specific prompt
examples, generated confidence numbers, or brittle checks for phrases such as
"not mentioned."

Unknown calibration fingerprints default to `uncertain`. Malformed model
assessment output, duplicate or unknown evidence IDs, cancellation, and timeout
remain typed failures and must never be converted silently into abstention.

## 46.3 Deterministic Signals

The confidence assessment may use:

- raw vector cosine similarity and score margins;
- lexical result presence, rank, and within-channel score margins;
- chunk-level and source-level lexical/vector agreement;
- candidate counts, retrieval mode, fallback state, and stage health;
- embedding coverage and stale or missing vector counts;
- selected-context item count, character usage, and truncation state;
- distinctive query-term overlap as a diagnostic feature, never a sole gate.

Calibration is bound to an explicit fingerprint that includes the embedding
model and digest, embedding-input/query-instruction versions, retrieval and
fusion versions, pool sizes, `rrfK`, chat `topK`, lexical query version, chunker
version, context-selection version, and threshold-policy version. A fingerprint
mismatch cannot produce a confident negative decision.

## 46.4 Answerability Contract

Add a model-neutral answerability provider whose structured result is a single
bounded array of supporting evidence IDs:

```text
[]              -> the requested information is absent
[E1, ...]       -> these supplied evidence items support a direct response
```

The flat schema deliberately has no `oneOf`, status discriminator, prose reason,
or confidence field. Conflicting or conditional evidence remains answerable when
the response can accurately disclose the conflict or conditions; the provider
must select every material item needed for that disclosure. Evidence text stays
untrusted data.

The adapter and answering orchestrator both validate the result. IDs must be
unique, known, bounded, and preserved in retrieval order. Ambiguous accepted
evidence is passed to an answer-only grounded planner so branch-order bias cannot
reintroduce an abstention decision after answerability has been established.

## 46.5 Execution Slices

### Slice A - Confidence Policy

- Add explicit confidence types, reason codes, feature extraction, calibration
  fingerprinting, and three-way routing.
- Preserve raw component score semantics; do not treat RRF as probability.
- Default empty context to `insufficient` and uncalibrated or degraded retrieval
  to `uncertain`.
- Freeze calibrated thresholds only after evaluating answerable and unanswerable
  cases with the reference embedding profile.

### Slice B - Structured Answerability

- Add the provider contract and flat Ollama JSON schema.
- Add strict response, evidence-membership, model-envelope, cancellation, and
  timeout validation.
- Restrict downstream evidence to validated supporting IDs.
- Use an answer-only plan schema after positive answerability assessment.

### Slice C - Orchestration and Diagnostics

- Route deterministic reject, deterministic direct, ambiguous accept, and
  ambiguous reject paths explicitly.
- Emit a validated `routing` or evidence-checking progress event.
- Persist policy version, route, reason codes, signals, calibration fingerprint,
  model assessment, model digest, and latency with the assistant message.
- Keep answer status semantics unchanged: rejected cases remain
  `insufficient-evidence`; citation-validation fallback remains `fallback`.

### Slice D - Evaluation and Calibration

- Include unanswerable cases in production-path retrieval evaluation.
- Record raw component scores, margins, agreement, context-selection diagnostics,
  confidence route, and calibration fingerprint per case.
- Add same-topic missing-attribute, unrelated, partial-evidence, paraphrase,
  contradiction, multi-source, context-pressure, degraded-index, and
  prompt-injection cases.
- Calibrate separate low and high thresholds with a deliberately wide uncertain
  band when sample size is limited.

## 46.6 Required Tests

- Clearly irrelevant evidence abstains without model inference.
- Clearly supported evidence uses the existing planner without an extra
  answerability call.
- Uncertain evidence invokes exactly one answerability call.
- Same-topic but missing-attribute questions abstain.
- Paraphrased, contradictory, and multi-source answerable questions are not
  rejected.
- Abstentions never contain citations.
- Unknown evidence IDs and malformed answerability results fail safely.
- Threshold equality, calibration mismatch, degraded retrieval, and incomplete
  embedding coverage behave deterministically.
- Cancellation during answerability prevents planning and streaming.
- Routing diagnostics survive persistence and engine restart.

## 46.7 Quality Gates

- Live ingested-grounding suite: all cases passing, including same-topic missing
  attributes.
- Controlled unanswerable-case abstention: `100%`.
- Controlled answerable-case false rejection: `0%`.
- Invented citations: zero.
- Abstention citations: zero.
- Existing retrieval, contradiction, synthesis, injection, counterfactual, and
  persistence cases do not regress.
- Additional model inference occurs only on the uncertain route.
- `pnpm validate`, arm64 packaging, code-sign verification, packaged launch, and
  persistence checks pass.

## 46.8 Definition of Done

1. The Emberroot live case returns `insufficient-evidence` without citations.
2. Clearly irrelevant questions avoid generation entirely.
3. Clearly supported questions incur no additional answerability-model latency.
4. Uncertain questions receive semantic answerability review through a flat,
   validated evidence-selection schema.
5. Routing decisions are reproducible, persisted, and diagnosable.
6. Thresholds and calibration artifacts are versioned against their complete
   retrieval and embedding fingerprint.
7. The strict live grounding gate passes before release packaging proceeds.

## 46.9 Implementation Status

Completed on 2026-08-14:

- Added the calibrated three-way confidence policy for the exact reference
  Qwen3 embedding digest and retrieval fingerprint.
- Added the flat evidence-ID answerability provider and answer-only grounded
  planner schema.
- Added schema 7 routing-diagnostics persistence, validated routing events, and
  renderer evidence-checking status.
- Added raw score diagnostics to deterministic evaluation and included
  unanswerable cases in production-path reports.
- Expanded the live suite to 13 cases with explicit direct, deterministic-reject,
  semantic-answerability, and same-topic missing-attribute assertions.
- Live ingested-grounding evaluation passes `13/13` with `gemma4:26b` and
  `qwen3-embedding:0.6b`.
- Repository validation passes lint, all typechecks, 155 tests, and production
  build.
- A real Blue Lake bean question exposed and verified two follow-up corrections:
  chat now retains the top 12 candidates, and grounded evidence carries bounded
  preceding-chunk structure so split PDF table headers remain interpretable and
  verifiable. Ambiguous bush/pole rows are disclosed rather than collapsed.
- The arm64 package builds, passes strict code-sign validation, launches with
  schema 7, and loads packaged `sqlite-vec v0.1.9`.

Public Gatekeeper acceptance remains blocked only by the separately tracked
notarization credential/ticket requirement.

# 47. Verified Hybrid Synthesis

Status: **V1 implemented and validated on 2026-08-14; evidence-first V2
implemented and validated on 2026-08-16**.

Section 47.11 supersedes the V1 execution stages and presentation contract for
new hybrid answers. V1 remains supported for persisted-message reads.

## 47.1 Product Decision

Hybrid answers become the default. Library-only grounded answers remain an
explicit alternate mode. A hybrid answer combines:

1. a closed-book response generated from the selected local model without
   library evidence;
2. a grounded response generated from retrieved library evidence;
3. claim-level reconciliation against immutable evidence snapshots;
4. a final local-model prose synthesis over both complete responses; and
5. a post-synthesis verification pass before any answer is shown or persisted.

Model-generated claims that the retrieved library neither supports nor
contradicts remain visible in the unified answer with an inline `Model
knowledge` label stating that the library did not verify them. The same labeling
policy applies to gardening, pesticides, food
preservation, toxicity, dosage, and other safety-sensitive topics; there is no
automatic strict-mode classifier.

The system must never silently blend unsupported model knowledge into cited
library prose. Citations are attached by application code from validated claim
relationships, never selected by the final synthesis model.

## 47.2 Execution Pipeline

### Stage A - Contextualization

- Preserve the original user message in storage.
- Resolve follow-up references into a bounded standalone question using the
  existing versioned contextualization provider.
- Use the standalone question for both the closed-book and library branches.

### Stage B - Parallel Component Answers

- Start closed-book local-model generation and hybrid library retrieval in
  parallel.
- The closed-book request contains the question only and returns bounded atomic
  model claims. It cannot receive evidence, source text, or citation IDs.
- The library branch uses the existing confidence gate, answerability provider,
  grounded planner, and immutable evidence snapshots.
- Hybrid mode assembles the grounded component deterministically from its plan;
  the final synthesis pass owns user-facing prose composition.
- Strict mode retains the existing grounded streaming path and invokes none of
  the hybrid-only providers.

### Stage C - Claim Reconciliation

- Assign application-issued `M#` IDs to model claims and `L#` IDs to library
  claims.
- Reconcile every model claim against the selected library evidence and library
  claims using a strict structured response.
- Record supporting evidence IDs, contradicting evidence IDs, and equivalent
  library claim IDs.
- Derive `supported`, `contradicted`, `mixed`, and `unverified` classifications
  in application code.
- A malformed reconciliation falls back conservatively: library claims remain
  grounded and every model claim becomes unverified.

### Stage D - Final Prose Synthesis

- Provide the final synthesizer with the original question, complete closed-book
  answer, complete grounded library answer, canonical claim catalog, and
  validated reconciliation ledger.
- Do not provide raw source text to the synthesizer; evidence relationships are
  already fixed by reconciliation.
- Require an ordered array of structured statements representing one coherent
  user-facing narrative. Every synthesized statement must identify the canonical
  claim IDs from which it was derived.
- Allow the synthesizer to reorder, deduplicate, combine, and naturally rephrase
  claims, but never to emit citation IDs or citation markers.
- Preserve distinct statement-level provenance lanes for library-backed content,
  library conflicts, and model-generated background not verified by the library.
  Statements from different lanes may be interleaved for narrative flow, but a
  single statement may not combine claims from different lanes.

### Stage E - Synthesis Verification

- Send every synthesized statement, its declared source claim IDs, the canonical
  claims, reconciliation ledger, and bounded evidence needed for verification to
  a structured verifier.
- Verify that each statement is faithful to its declared claims, introduces no
  new factual content, and belongs in its declared provenance lane.
- Application validation must reject missing, duplicate, unknown, or cross-lane
  claim IDs and any citation marker emitted by the model.
- Attach supporting and contradicting citations only after verification, using
  validated claim/evidence edges.
- Buffer synthesis output until verification succeeds; no provisional hybrid
  prose is shown or persisted.
- If synthesis or verification fails, discard the generated prose and render a
  deterministic answer from canonical validated claims. User cancellation never
  produces a fallback answer.

## 47.3 Answer and Provenance Contract

Add an independently versioned `AnswerProvenanceV1` payload containing:

- answer mode and pipeline version;
- closed-book answer and canonical `M#` claims;
- grounded library answer and canonical `L#` claims;
- reconciliation assessments and derived classifications;
- synthesized sections and statement-to-claim mappings;
- synthesis-verification assessments;
- claim-to-evidence support and contradiction edges;
- selected model name and digest;
- prompt versions, duration, status, and fallback reason for every model stage.

Persist provenance separately from routing diagnostics. Legacy messages keep a
null provenance payload and remain readable without inferred classifications.

The rendered answer is one ordered narrative with three possible statement
treatments:

1. **Library-backed statement** - verified library claims and verified model
   claims supported by library evidence, with source controls scoped to that
   statement.
2. **Conflict statement** - model claims contradicted or only partially
   supported by retrieved evidence, with an inline conflict label and supporting
   and contradicting evidence labeled separately.
3. **Model-knowledge statement** - relevant closed-book claims with an inline
   `Model knowledge` label and no citations or source controls.

The UI must not render these treatments as separate answer cards or top-level
sections. Visual continuity must not imply that a nearby library source supports
an unverified model statement.

## 47.4 Persistence and Process Boundaries

- Migrate SQLite schema 7 to schema 8 with nullable
  `chat_messages.answer_provenance_json`.
- Validate provenance on write and read; no source re-import, reparsing, or
  re-embedding is required.
- Extend desktop and utility-process contracts with
  `labeled-hybrid | strict-grounded` answer mode, defaulting new sends to hybrid.
- Extend progress events for closed-book generation, reconciliation, synthesis,
  and verification while preserving cancellation and sequence semantics.
- Keep immutable citation snapshots as the authority for every persisted
  evidence edge.

## 47.5 Source Interpretation and Derived Reasoning

- Expand bounded preceding source context enough to recover split table headers
  when the immediate previous chunk contains only data rows.
- Grounded planning may perform transparent arithmetic and date calculations
  using user-supplied facts and cited evidence.
- Derived estimates must identify their inputs, remain explicitly approximate,
  and cite the evidence supplying factual values.
- Pretrained location, climate, cultivation, or safety guidance that the library
  does not verify belongs only in the model-background provenance lane and is
  identified inline as `Model knowledge` within the unified narrative.

## 47.6 Failure Policy

- Closed-book failure: complete a library-only hybrid response.
- Library insufficiency: retain relevant model claims as unverified background.
- Library technical failure: show only labeled model background and record the
  library-stage failure.
- Reconciliation failure: classify every model claim as unverified.
- Synthesis or verification failure: use deterministic provenance-safe rendering
  and persist the fallback reason.
- Strict-grounded mode keeps its existing abstention and typed-failure behavior.
- External cancellation aborts every branch and model stage without fallback.

## 47.7 Performance Policy

- Overlap closed-book generation with lexical/vector retrieval.
- Serialize completion-model calls after retrieval to avoid concurrent large
  model workloads on minimum-memory Macs.
- Allow up to 180 seconds per local inference request so a cold start of the
  selected generation model does not fail before producing its first token.
- Reuse one run-wide abort signal and apply bounded stage-specific timeouts.
- Bound claim counts, claim lengths, evidence items, synthesis statements, and
  persisted provenance size.
- Expected hybrid path: closed-book, grounded plan, optional answerability,
  reconciliation, synthesis, and verification model calls.

## 47.8 Required Tests and Gates

- Closed-book requests contain no evidence or citation IDs.
- Supported, contradicted, mixed, and unverified classifications are exact and
  reject missing, duplicate, or invented `M#`, `L#`, and `E#` IDs.
- Final synthesis starts only after both component answers and reconciliation
  complete.
- Every synthesized statement is verified before display or persistence.
- Synthesized statement order survives persistence and renders as one narrative.
- Unverified statements never receive citations or evidence controls.
- Unverified statements render with a visible inline `Model knowledge` label.
- Contradicting evidence is never presented as supporting evidence.
- Citation markers cannot be forged through model output or source instructions.
- Malformed reconciliation, synthesis, and verification responses follow their
  conservative deterministic fallbacks.
- Hybrid is the default; strict mode invokes no hybrid-only providers.
- Schema 7 to 8 migration, legacy null provenance, restart round-trip, and
  immutable citation snapshots pass.
- Live cases cover agreement, counterfactual contradiction, mixed evidence,
  library silence, empty library, prompt injection, follow-up context, derived
  date arithmetic, safety-sensitive background, strict-mode isolation, and
  deterministic synthesis fallback.
- Existing grounding, retrieval, answerability, citation, UI accessibility,
  packaging, code-signing, and persistence gates do not regress.

## 47.9 Definition of Done

1. Hybrid is the default answer mode and strict library-only mode remains usable.
2. The local model produces a complete closed-book component answer without
   receiving library evidence.
3. The existing RAG path produces a complete grounded component answer.
4. Every model claim receives a validated library relationship.
5. A final local-model pass coherently synthesizes both component answers.
6. Every synthesized statement passes post-synthesis verification before display.
7. Citations are attached only by application code from verified evidence edges.
8. Unverified model knowledge is clearly identified inline and never appears
   cited or visually covered by a neighboring source control.
9. Provenance survives persistence and restart under schema 8.
10. Full validation, expanded live evaluation, signed arm64 packaging, and
    packaged launch checks pass.

## 47.10 Unified Narrative Amendment

Status: **implemented and validated on 2026-08-14**.

- Continue passing the complete closed-book answer and complete grounded library
  answer to the final local-model synthesizer together with the canonical claim
  catalog and reconciliation ledger.
- Treat the synthesizer's `S1`, `S2`, and subsequent statement order as the
  user-facing narrative order. Provenance lane is metadata, not a presentation
  section.
- Render one answer container without library, conflict, or model-background
  cards. Attach source controls directly to the statement they support or
  contradict.
- Render the inline `Model knowledge` badge after each unverified statement and
  an inline conflict badge on each conflict statement. Text labels are required;
  color alone is insufficient.
- Serialize the same ordered narrative for persistence, thread previews,
  follow-up contextualization, and non-renderer consumers. Application-owned
  evidence markers may remain in serialized content, but generated statement
  text stays marker-free.
- Keep `AnswerProvenanceV1.finalSections` as the validated persistence ledger and
  derive narrative order from statement IDs so existing schema-8 data remains
  readable. No database migration is required.
- Preserve all citation anti-laundering, cross-lane rejection, post-synthesis
  verification, immutable evidence snapshot, strict-mode isolation, fallback,
  and cancellation guarantees.

## 47.11 Evidence-First Hybrid V2 Amendment

Status: **implemented and validated on 2026-08-16**.

### Product Decision

- Replace the separate closed-book, claim-reconciliation, and final-synthesis
  stages for new hybrid answers with evidence-conditioned generation.
- Complete the library retrieval, answerability, and grounded-planning check
  first. Then provide the original user wording, contextualized standalone query,
  user-supplied facts, and bounded selected evidence together to the local model.
- Instruct the model that library evidence is authoritative, overrides conflicting
  pretrained knowledge, and is untrusted data rather than executable instruction.
- Permit relevant pretrained knowledge only when library evidence is incomplete.
  Such statements remain uncited and cause the answer to carry an `Includes model
  knowledge` label.
- Present one uninterrupted body of prose. Place one `Evidence used (N)` control
  at the bottom rather than per-statement evidence buttons.

### Execution Pipeline

1. Preserve the original question and resolve follow-up context into a standalone
   query as before.
2. Retrieve bounded library context and complete the existing confidence,
   answerability, and deterministic grounded-plan checks.
3. Send one evidence-first generation request containing the original question,
   resolved query, grounded library answer, and immutable selected evidence.
4. Require an ordered structured response of atomic statements. Each statement
   is either `library` with one or more supplied evidence IDs or `model` with no
   evidence IDs.
5. Run an independent structured verification pass over every statement and its
   declared evidence. A library statement is acceptable only when fully entailed
   by all declared evidence; a model statement must be relevant and must not
   contradict supplied evidence.
6. Attach citations in application code only after all statements and evidence
   relationships pass verification. Buffer all prose until that point.
7. On malformed generation, unknown evidence IDs, failed verification, or timeout,
   discard generated prose and render the deterministic grounded library result.
   External cancellation never produces fallback prose.

### Provenance V2

- Add `AnswerProvenanceV2` alongside V1 in process contracts. V2 stores ordered
  statements, `library | model` kind, validated evidence IDs, selected generation
  model and digest, prompt versions, stage status, and fallback reasons.
- Persist V1 or V2 in the existing schema-8 `answer_provenance_json` column. No
  SQLite migration is required.
- Continue validating legacy V1 on every read. New hybrid answers write V2 only.
- Message citations must exactly equal the union of evidence IDs referenced by V2
  library statements. Model statements must never reference evidence.

### Presentation

- Render V2 statements as one continuous answer body without section cards,
  inline provenance pills, or per-statement source buttons.
- If any V2 statement is model knowledge, show one `Includes model knowledge`
  badge in the answer footer.
- If evidence is used, show one `Evidence used (N)` button in the answer footer.
  Opening it shows each source snapshot and the exact answer statements it
  supports. Model-only statements appear in the panel as not supported by the
  library.
- If no evidence is used, omit the evidence button and retain the model-knowledge
  badge. Strict library-only presentation remains unchanged.

### Required Gates

- The evidence-first request contains both original and contextualized queries and
  no evidence outside the bounded selected set.
- Library evidence wins when pretrained knowledge disagrees.
- Every generated statement is assessed exactly once before persistence.
- Unknown, duplicate, missing, or cross-kind evidence relationships are rejected.
- Unsupported statements remain uncited and trigger the answer-level model label.
- The bottom evidence panel maps every citation to the statements it supports and
  never implies support for model-only statements.
- V1 restart reads, V2 restart round trips, strict-mode isolation, prompt
  injection, empty-library, follow-up, conflict, timeout, cancellation, and
  deterministic fallback tests pass.

### Implementation Validation

- Repository validation passes lint, all typechecks, 225 tests, and the
  production desktop build.
- Live ingested-grounding evaluation passes `18/18` with `gemma4:26b` digest
  `5571076f3d70050487b26b341705799e0ab29b808164f90d20d4cf84f699d251`
  and `qwen3-embedding:0.6b` digest
  `ac6da0dfba84a81fdbfbaf330198c33cd77c4cdfc53e8bc50eb581914a15621d`.
- The arm64 app bundle passes deep strict Developer ID signature validation,
  packages to DMG and ZIP, and launches from the packaged output. Public
  Gatekeeper acceptance remains blocked by the missing notarization ticket.
