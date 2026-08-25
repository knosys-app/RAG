import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ChatProgressStatus } from "@knosys-rag/contracts";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import { ThemeProvider } from "./hooks/useTheme.js";
import {
  assistantMessage,
  CONTRADICTING_CITATION_ID,
  documentSummary,
  emptySnapshot,
  evidenceFirstAssistantMessage,
  evidenceFirstProvenance,
  hybridAssistantMessage,
  installKnosysApi,
  MEMORY_THREAD_ID,
  memoryAssistantMessage,
  memoryThreadSummary,
  offlineRagStatus,
  FOLDER_ID,
  folderSummary,
  pendingAssistantMessage,
  readyRagStatus,
  RUN_ID,
  threadSummary,
  userMessage,
} from "./test/fixtures.js";

function dragPayload(threadId: string) {
  const data: Record<string, string> = {
    "application/x-knosys-thread": threadId,
  };
  return {
    dataTransfer: {
      dropEffect: "none",
      effectAllowed: "all",
      getData: (type: string) => data[type] ?? "",
      setData: (type: string, value: string) => {
        data[type] = value;
      },
      types: Object.keys(data),
    },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderApp(): ReturnType<typeof render> {
  return render(
    <ThemeProvider>
      <App />
    </ThemeProvider>,
  );
}

async function waitForComposerReady(): Promise<HTMLTextAreaElement> {
  const question = screen.getByLabelText("Question") as HTMLTextAreaElement;
  await waitFor(() => expect(question.disabled).toBe(false));
  return question;
}

describe("chat", () => {
  it("defaults to Hybrid and can send without library sources", async () => {
    const { send } = installKnosysApi();

    renderApp();
    const question = await waitForComposerReady();

    const hybridOption = screen.getByRole("radio", { name: "Hybrid" });
    expect(hybridOption).toHaveProperty("checked", true);
    expect(question.placeholder).toContain("model knowledge");
    expect(screen.getByText(/No library sources yet/)).toBeTruthy();

    // The active-pill restructure must not break the underlying radio group:
    // selecting the other mode reflects checked state immediately.
    fireEvent.click(screen.getByRole("radio", { name: "Library only" }));
    expect(screen.getByRole("radio", { name: "Library only" })).toHaveProperty(
      "checked",
      true,
    );
    fireEvent.click(hybridOption);
    expect(hybridOption).toHaveProperty("checked", true);

    fireEvent.change(question, { target: { value: "What is seed dormancy?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(null, "What is seed dormancy?", "labeled-hybrid"),
    );
  });

  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    const { send } = installKnosysApi();
    const user = userEvent.setup();

    renderApp();
    const question = await waitForComposerReady();

    await user.click(question);
    await user.keyboard("First line{Shift>}{Enter}{/Shift}Second line");
    expect(send).not.toHaveBeenCalled();
    expect(question.value).toBe("First line\nSecond line");

    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        null,
        "First line\nSecond line",
        "labeled-hybrid",
      ),
    );
  });

  it("requires a source when Library only is selected", async () => {
    const { send } = installKnosysApi();

    renderApp();
    await waitForComposerReady();
    fireEvent.click(screen.getByRole("radio", { name: "Library only" }));

    expect(screen.getByLabelText("Question")).toHaveProperty("disabled", true);
    expect(
      screen.getByText("Library only requires at least one indexed source."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send question" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it("propagates an explicit Library only selection", async () => {
    const { send } = installKnosysApi({
      snapshot: { documents: [documentSummary], jobs: [] },
    });

    renderApp();
    const question = await waitForComposerReady();
    fireEvent.click(screen.getByRole("radio", { name: "Library only" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Question") as HTMLTextAreaElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.change(question, { target: { value: "How should I store seeds?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));

    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        null,
        "How should I store seeds?",
        "strict-grounded",
      ),
    );
  });

  it("labels every progress stage, streams deltas, and exposes cancellation", async () => {
    const { emit } = installKnosysApi();

    renderApp();
    const question = await waitForComposerReady();

    const modelSelector = screen.getByLabelText("Generation model") as HTMLSelectElement;
    expect([...modelSelector.options].map(({ text }) => text.trim())).toEqual([
      "Select an installed model",
      "Automatic (qwen3:8b)",
      "qwen3:8b · 6 GB · 32K context",
    ]);
    expect(screen.queryByRole("option", { name: /gemma4:26b/ })).toBeNull();

    fireEvent.change(question, { target: { value: "How should I store seeds?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop generating answer" })).toBeTruthy(),
    );

    const stages: readonly (readonly [ChatProgressStatus, string])[] = [
      ["background", "Generating model background"],
      ["retrieving", "Finding library evidence"],
      ["routing", "Checking evidence coverage"],
      ["planning", "Planning a library-grounded answer"],
      ["reconciling", "Reconciling library and model claims"],
      ["synthesizing", "Synthesizing one answer"],
      ["verifying", "Verifying statements and sources"],
      ["generating", "Writing a library-grounded answer"],
    ];
    for (const [sequence, [status, label]] of stages.entries()) {
      emit({ kind: "status", runId: RUN_ID, sequence, status });
      await waitFor(() => expect(screen.getAllByText(label).length).toBeGreaterThan(0));
    }
    emit({ kind: "delta", runId: RUN_ID, sequence: stages.length, text: "Keep seeds cool" });
    await waitFor(() => expect(screen.getByText("Keep seeds cool")).toBeTruthy());

    fireEvent.click(screen.getByRole("button", { name: "Stop generating answer" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send question" })).toBeTruthy(),
    );
    expect(window.knosys.chat.cancel).toHaveBeenCalledWith(RUN_ID);
  });

  it("adopts an interrupted run when reopening its thread", async () => {
    const generatingAssistant = {
      ...pendingAssistantMessage,
      content: "Partial answer",
      status: "generating" as const,
    };
    const { emit } = installKnosysApi({
      thread: {
        ...threadSummary,
        messages: [userMessage, generatingAssistant],
      },
      threads: [threadSummary],
    });

    renderApp();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop generating answer" })).toBeTruthy(),
    );
    await waitFor(() => expect(screen.getByText("Partial answer")).toBeTruthy());

    emit({
      fallback: false,
      insufficient: false,
      kind: "completed",
      message: assistantMessage,
      runId: RUN_ID,
      sequence: 10,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send question" })).toBeTruthy(),
    );
    await waitFor(() =>
      expect(screen.getAllByText(/Keep seeds cool and dry/).length).toBeGreaterThan(0),
    );
  });

  it("renders one ordered hybrid narrative with inline provenance and evidence", async () => {
    installKnosysApi({
      thread: {
        ...threadSummary,
        messages: [userMessage, hybridAssistantMessage],
      },
      threads: [threadSummary],
    });

    renderApp();
    const narrative = await screen.findByLabelText("Unified hybrid answer");
    expect(
      screen.queryByText("This serialized fallback content should not be rendered."),
    ).toBeNull();
    const statements = [
      ...narrative.querySelectorAll<HTMLElement>("[data-statement-id]"),
    ];
    expect(statements.map(({ dataset }) => dataset.statementId)).toEqual([
      "S1",
      "S2",
      "S3",
      "S4",
    ]);
    expect(statements.map(({ dataset }) => dataset.kind)).toEqual([
      "library",
      "conflict",
      "model",
      "library",
    ]);
    expect(
      within(statements[1]!).getByLabelText("Conflicts with your library"),
    ).toBeTruthy();
    expect(
      within(statements[2]!).getByLabelText(
        "Model knowledge, not verified by your library",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Grounded fallback")).toBeTruthy();
    expect(screen.getAllByText("Hybrid").length).toBeGreaterThan(0);

    const supportingChips = screen.getAllByRole("button", {
      name: "Evidence 1: Seed handbook, Page 7",
    });
    expect(supportingChips.length).toBeGreaterThan(0);
    const contradictingChip = screen.getByRole("button", {
      name: "Contradicting source 2: Seed trial notes, Page 7",
    });
    expect(within(statements[2]!).queryByRole("button")).toBeNull();

    fireEvent.click(contradictingChip);
    await screen.findByRole("dialog", { name: "Seed trial notes" });
    expect(window.knosys.evidence.get).toHaveBeenCalledWith(CONTRADICTING_CITATION_ID);
  });

  it("renders evidence-first prose with one footer control and statement mappings", async () => {
    installKnosysApi({
      thread: {
        ...threadSummary,
        messages: [userMessage, evidenceFirstAssistantMessage],
      },
      threads: [threadSummary],
    });

    renderApp();
    const narrative = await screen.findByLabelText("Unified hybrid answer");
    expect(
      screen.queryByText("This serialized V2 content should not be rendered."),
    ).toBeNull();
    expect(
      [
        ...narrative.querySelectorAll<HTMLElement>("[data-statement-id] .markdown"),
      ].map(({ textContent }) => textContent),
    ).toEqual([
      "Keep seeds cool and dry.",
      "Airtight containers can provide additional protection.",
      "One trial found room-temperature storage performed best.",
    ]);
    expect(screen.getByText("Includes model knowledge")).toBeTruthy();

    const evidenceControl = screen.getByRole("button", { name: /Evidence used \(2\)/ });
    expect(screen.getAllByRole("button", { name: /Evidence used/ })).toHaveLength(1);
    expect(screen.queryByLabelText("Evidence used by this answer")).toBeNull();
    fireEvent.click(evidenceControl);

    const evidenceIndex = screen.getByLabelText("Evidence used by this answer");
    expect(within(evidenceIndex).getByText("Keep seeds cool and dry.")).toBeTruthy();
    expect(
      within(evidenceIndex).getByText("Store seeds in a cool, dry place."),
    ).toBeTruthy();
    expect(
      within(evidenceIndex).getByText(
        "One trial found room-temperature storage performed best.",
      ),
    ).toBeTruthy();
    expect(
      within(evidenceIndex).getByText(
        "Airtight containers can provide additional protection.",
      ),
    ).toBeTruthy();
    expect(within(evidenceIndex).getByText("Not supported by the library")).toBeTruthy();

    fireEvent.click(
      within(evidenceIndex).getByRole("button", {
        name: "Open evidence 2: Seed trial notes",
      }),
    );
    await screen.findByRole("dialog", { name: "Seed trial notes" });
    expect(window.knosys.evidence.get).toHaveBeenCalledWith(CONTRADICTING_CITATION_ID);
  });

  it("omits the evidence control for a model-only V2 answer", async () => {
    installKnosysApi({
      thread: {
        ...threadSummary,
        messages: [
          userMessage,
          {
            ...evidenceFirstAssistantMessage,
            answerProvenance: {
              ...evidenceFirstProvenance,
              statements: [
                {
                  evidenceIds: [],
                  kind: "model" as const,
                  statementId: "S1",
                  text: "General model background.",
                },
              ],
            },
            citations: [],
          },
        ],
      },
      threads: [threadSummary],
    });

    renderApp();
    await screen.findByText("General model background.");
    expect(screen.getByText("Includes model knowledge")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Evidence used/ })).toBeNull();
  });

  it("renders V3 memory statements with a chip that opens the source thread", async () => {
    const { api } = installKnosysApi({
      thread: {
        ...threadSummary,
        messages: [userMessage, memoryAssistantMessage],
      },
      threads: [threadSummary, memoryThreadSummary],
    });

    renderApp();
    await screen.findByText("You previously settled on drying seeds fully before storage.");
    expect(screen.getByText("Memory used")).toBeTruthy();

    const chip = screen.getByRole("button", {
      name: "From a past chat: Seed saving, 2026-08-10",
    });
    fireEvent.click(chip);
    await waitFor(() => {
      expect(api.chat.getThread).toHaveBeenCalledWith(MEMORY_THREAD_ID);
    });
  });

  it("keeps history and exact evidence readable while generation is offline", async () => {
    installKnosysApi({
      ragStatus: offlineRagStatus,
      thread: {
        ...threadSummary,
        messages: [userMessage, assistantMessage],
      },
      threads: [threadSummary],
    });

    renderApp();
    const chip = await screen.findByRole("button", {
      name: "Evidence 1: Seed handbook, Page 7",
    });
    const composer = screen.getByLabelText("Question") as HTMLTextAreaElement;
    expect(composer.disabled).toBe(true);
    expect(
      screen.getByText("History remains available while local generation is offline."),
    ).toBeTruthy();
    chip.focus();
    fireEvent.click(chip);
    await screen.findByRole("dialog", { name: "Seed handbook" });
    expect(screen.getByText("Source evidence")).toBeTruthy();
    expect(screen.getAllByText("Store seeds in a cool, dry place.")).toHaveLength(2);
    expect(screen.getByText("Storage / Page 7")).toBeTruthy();
    expect(screen.getByText("p. 7")).toBeTruthy();
    expect(screen.getByText("Source context")).toBeTruthy();

    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The chip must survive the dialog close so Radix can restore focus to it
    // (the restore itself is not observable under jsdom's focus model).
    expect(chip.isConnected).toBe(true);
  });

  it("lists sources below the answer when no inline markers match", async () => {
    installKnosysApi({
      thread: {
        ...threadSummary,
        messages: [
          userMessage,
          { ...assistantMessage, content: "Keep seeds cool and dry." },
        ],
      },
      threads: [threadSummary],
    });

    renderApp();
    expect(
      await screen.findByRole("button", { name: /Source 1: Seed handbook · Page 7/ }),
    ).toBeTruthy();
  });

  it("renames and deletes conversations from the sidebar", async () => {
    const { api } = installKnosysApi({
      thread: { ...threadSummary, messages: [userMessage, assistantMessage] },
      threads: [threadSummary],
    });
    vi.mocked(api.chat.renameThread).mockResolvedValue({
      ...threadSummary,
      title: "Renamed thread",
    });
    const user = userEvent.setup();

    renderApp();
    await screen.findByText("Seed storage");

    await user.click(
      screen.getByRole("button", { name: "Conversation actions for Seed storage" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Rename/ }));
    const input = await screen.findByLabelText("Rename conversation Seed storage");
    await user.clear(input);
    await user.type(input, "Renamed thread{Enter}");
    await waitFor(() =>
      expect(api.chat.renameThread).toHaveBeenCalledWith(
        threadSummary.id,
        "Renamed thread",
      ),
    );
    await screen.findByText("Renamed thread");

    await user.click(
      screen.getByRole("button", { name: "Conversation actions for Renamed thread" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    await screen.findByRole("dialog", { name: "Delete this conversation?" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(api.chat.deleteThread).toHaveBeenCalledWith(threadSummary.id),
    );
    await waitFor(() => expect(screen.queryByText("Renamed thread")).toBeNull());
  });
});

describe("folders", () => {
  it("creates a folder from the sidebar", async () => {
    const { api } = installKnosysApi();
    const user = userEvent.setup();

    renderApp();
    await user.click(await screen.findByRole("button", { name: "New folder" }));
    const input = await screen.findByLabelText("New folder name");
    await user.type(input, "Garden research{Enter}");
    await waitFor(() =>
      expect(api.chat.createFolder).toHaveBeenCalledWith("Garden research"),
    );
    await screen.findByLabelText("Folder Garden research");
  });

  it("groups threads under folders with a collapsible header", async () => {
    const filed = { ...threadSummary, folderId: FOLDER_ID };
    installKnosysApi({
      folders: [folderSummary],
      thread: { ...filed, messages: [userMessage, assistantMessage] },
      threads: [filed],
    });

    renderApp();
    const section = await screen.findByLabelText("Folder Garden research");
    expect(within(section).getByText("Seed storage")).toBeTruthy();
    expect(screen.getByText("Chats")).toBeTruthy();

    const header = within(section).getByRole("button", {
      name: /^Garden research/,
    });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(header);
    await waitFor(() =>
      expect(within(section).queryByText("Seed storage")).toBeNull(),
    );
    expect(window.localStorage.getItem("knosys.sidebar.collapsedFolders")).toContain(
      FOLDER_ID,
    );
    fireEvent.click(header);
    await waitFor(() => expect(within(section).getByText("Seed storage")).toBeTruthy());
    window.localStorage.removeItem("knosys.sidebar.collapsedFolders");
  });

  it("moves a thread into a folder via the Move to submenu", async () => {
    const { api } = installKnosysApi({
      folders: [folderSummary],
      thread: { ...threadSummary, messages: [userMessage, assistantMessage] },
      threads: [threadSummary],
    });
    vi.mocked(api.chat.moveThread).mockResolvedValue({
      ...threadSummary,
      folderId: FOLDER_ID,
    });
    const user = userEvent.setup();

    renderApp();
    await screen.findByText("Seed storage");
    await user.click(
      screen.getByRole("button", { name: "Conversation actions for Seed storage" }),
    );
    await screen.findByRole("menuitem", { name: /Move to/ });
    // Radix submenus are driven by keyboard/hover; keyboard is deterministic
    // under jsdom: Rename → Move to → open sub → No folder → Garden research.
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowRight}");
    await screen.findByRole("menuitemradio", { name: "Garden research" });
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() =>
      expect(api.chat.moveThread).toHaveBeenCalledWith(threadSummary.id, FOLDER_ID),
    );
    const section = await screen.findByLabelText("Folder Garden research");
    await waitFor(() => expect(within(section).getByText("Seed storage")).toBeTruthy());
  });

  it("moves threads by dragging onto a folder and back onto Chats", async () => {
    const filed = { ...threadSummary, folderId: FOLDER_ID };
    const { api } = installKnosysApi({
      folders: [folderSummary],
      thread: { ...threadSummary, messages: [userMessage, assistantMessage] },
      threads: [threadSummary],
    });
    vi.mocked(api.chat.moveThread).mockResolvedValue(filed);

    renderApp();
    await screen.findByText("Seed storage");

    const payload = dragPayload("");
    fireEvent.dragStart(screen.getByText("Seed storage"), payload);
    const section = await screen.findByLabelText("Folder Garden research");
    const folderHeader = within(section).getByRole("button", {
      name: /^Garden research/,
    });
    fireEvent.dragOver(folderHeader, payload);
    fireEvent.drop(folderHeader, payload);
    await waitFor(() =>
      expect(api.chat.moveThread).toHaveBeenCalledWith(threadSummary.id, FOLDER_ID),
    );

    vi.mocked(api.chat.moveThread).mockResolvedValue(threadSummary);
    const chatsLabel = screen.getByText("Chats");
    const outPayload = dragPayload(threadSummary.id);
    fireEvent.dragOver(chatsLabel, outPayload);
    fireEvent.drop(chatsLabel, outPayload);
    await waitFor(() =>
      expect(api.chat.moveThread).toHaveBeenCalledWith(threadSummary.id, null),
    );
  });

  it("confirms folder deletion with the conversation count and clears state", async () => {
    const filed = { ...threadSummary, folderId: FOLDER_ID };
    const { api } = installKnosysApi({
      folders: [folderSummary],
      thread: { ...filed, messages: [userMessage, assistantMessage] },
      threads: [filed],
    });
    vi.mocked(api.chat.deleteFolder).mockResolvedValue({
      deletedFolderId: FOLDER_ID,
      deletedThreadIds: [filed.id],
    });
    const user = userEvent.setup();

    renderApp();
    await screen.findByLabelText("Folder Garden research");
    await user.click(
      screen.getByRole("button", { name: "Folder actions for Garden research" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /Delete/ }));
    const dialog = await screen.findByRole("dialog", { name: "Delete this folder?" });
    expect(within(dialog).getByText(/its 1 conversation/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(api.chat.deleteFolder).toHaveBeenCalledWith(FOLDER_ID));
    await waitFor(() =>
      expect(screen.queryByLabelText("Folder Garden research")).toBeNull(),
    );
    expect(screen.queryByText("Seed storage")).toBeNull();
  });

  it("files the next chat into a folder started from the folder plus button", async () => {
    const { api } = installKnosysApi({ folders: [folderSummary] });
    vi.mocked(api.chat.moveThread).mockResolvedValue({
      ...threadSummary,
      folderId: FOLDER_ID,
    });
    const user = userEvent.setup();

    renderApp();
    const section = await screen.findByLabelText("Folder Garden research");
    await user.click(
      within(section).getByRole("button", { name: "New chat in Garden research" }),
    );
    expect(screen.getByText(/Filing into Garden research/)).toBeTruthy();

    const question = await waitForComposerReady();
    fireEvent.change(question, { target: { value: "How do pumpkins grow?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send question" }));
    await waitFor(() =>
      expect(api.chat.moveThread).toHaveBeenCalledWith(threadSummary.id, FOLDER_ID),
    );
    await waitFor(() =>
      expect(screen.queryByText(/Filing into Garden research/)).toBeNull(),
    );
  });
});

describe("library", () => {
  it("renders the empty library with import enabled and no model gating", async () => {
    installKnosysApi();

    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Library/ }));
    await waitFor(() =>
      expect(screen.getByText("Build a private reference shelf")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Import files" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  it("shows imported documents and searches source text via Cmd+K", async () => {
    installKnosysApi({
      searchResults: [
        {
          chunkId: "8886d5d3-6324-43e0-a9c8-cc89f4534098",
          documentId: documentSummary.id,
          endBlockOrdinal: 2,
          endPageNumber: 3,
          headingPath: ["Tomato notes"],
          rank: -1,
          snippet: "Keep leaves dry when watering.",
          sourceFragment: null,
          sourcePath: null,
          startBlockOrdinal: 1,
          startPageNumber: 3,
          title: "Tomato notes",
        },
      ],
      snapshot: { documents: [documentSummary], jobs: [] },
    });

    renderApp();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Library/ }).textContent,
      ).toContain("1"),
    );
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByLabelText("Search indexed text")),
    );
    expect(screen.getByText("Tomato notes")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search indexed text"), {
      target: { value: "watering" },
    });
    await waitFor(() =>
      expect(screen.getByText("Keep leaves dry when watering.")).toBeTruthy(),
    );
    expect(screen.getByText(/Page 3/)).toBeTruthy();
    expect(window.knosys.library.search).toHaveBeenCalledWith("watering");
  });

  it("shows a bounded per-file import failure instead of only a batch count", async () => {
    installKnosysApi({
      importFiles: () =>
        Promise.resolve({
          batch: {
            duplicates: 0,
            failed: 1,
            imported: 0,
            items: [
              {
                documentId: null,
                errorCode: "PDF_OCR_REQUIRED",
                errorMessage: "This PDF has no selectable text. OCR is required.",
                originalName: "scanned-guide.pdf",
                status: "failed" as const,
              },
            ],
            reprocessed: 0,
            snapshot: emptySnapshot,
            unsupported: 0,
          },
          cancelled: false,
        }),
    });

    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Library/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Import files" }));
    await waitFor(() => expect(screen.getByText("scanned-guide.pdf")).toBeTruthy());
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText(/no selectable text/)).toBeTruthy();
  });

  it("shows live import stages and resumable semantic indexing", async () => {
    const buildingRagStatus = {
      ...offlineRagStatus,
      embedding: {
        ...offlineRagStatus.embedding,
        coverage: {
          currentChunks: 42,
          missingChunks: 58,
          ratio: 0.42,
          staleChunks: 0,
          totalChunks: 100,
        },
        model: { ...offlineRagStatus.embedding.model, capable: true },
      },
      runtime: {
        installDetected: true,
        provider: "ollama" as const,
        state: "available" as const,
      },
    };
    let resolveImport: (result: unknown) => void = () => undefined;
    const { emitImportProgress } = installKnosysApi({
      importFiles: () =>
        new Promise((resolve) => {
          resolveImport = resolve;
        }),
      ragStatus: buildingRagStatus,
      snapshot: { documents: [documentSummary], jobs: [] },
    });

    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Library/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Import files" }));
    emitImportProgress({
      completed: 3,
      currentName: "soil-guide.pdf",
      kind: "import-progress",
      operationId: "a9da48a8-7aca-4ef1-a7b8-2698b646a944",
      stage: "parsing",
      total: 10,
    });
    expect(screen.getByText("Extracting document text")).toBeTruthy();
    expect(screen.getByText("soil-guide.pdf")).toBeTruthy();
    expect(screen.getByText("Source 4 of 10")).toBeTruthy();
    expect(await screen.findByText("Building semantic index")).toBeTruthy();
    expect(screen.getByText("42 of 100 chunks embedded (42%).")).toBeTruthy();

    resolveImport({
      batch: {
        duplicates: 1,
        failed: 0,
        imported: 0,
        items: [
          {
            documentId: documentSummary.id,
            errorCode: null,
            errorMessage: null,
            originalName: "garden.pdf",
            status: "duplicate" as const,
          },
        ],
        reprocessed: 0,
        snapshot: { documents: [documentSummary], jobs: [] },
        unsupported: 0,
      },
      cancelled: false,
    });
    await waitFor(() => expect(screen.getByText("1 duplicate")).toBeTruthy());
  });

  it("deletes a document after confirmation", async () => {
    const { api } = installKnosysApi({
      snapshot: { documents: [documentSummary], jobs: [] },
    });
    vi.mocked(api.library.deleteDocument).mockResolvedValue({
      deletedDocumentId: documentSummary.id,
      snapshot: emptySnapshot,
    });
    const user = userEvent.setup();

    renderApp();
    fireEvent.click(await screen.findByRole("button", { name: /Library/ }));
    await screen.findByText("Tomato notes");
    await user.click(screen.getByRole("button", { name: "Delete Tomato notes" }));
    await screen.findByRole("dialog", { name: "Delete this source?" });
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(api.library.deleteDocument).toHaveBeenCalledWith(documentSummary.id),
    );
    await waitFor(() =>
      expect(screen.getByText("Build a private reference shelf")).toBeTruthy(),
    );
  });
});

describe("settings", () => {
  async function openSettings(): Promise<void> {
    fireEvent.click(await screen.findByRole("button", { name: /Settings/ }));
    await screen.findByRole("dialog", { name: "Settings" });
  }

  // Radix tab triggers activate on mousedown, not click.
  function selectTab(name: string): void {
    const tab = screen.getByRole("tab", { name });
    fireEvent.mouseDown(tab);
    fireEvent.click(tab);
  }

  it("shows runtime readiness and storage on the System tab", async () => {
    const { api } = installKnosysApi({
      snapshot: { documents: [documentSummary], jobs: [] },
    });
    vi.mocked(api.system.getStatus).mockRejectedValue(new Error("Status unavailable"));

    renderApp();
    await openSettings();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeTruthy();

    selectTab("System");
    await waitFor(() => expect(screen.getByText("Status unavailable")).toBeTruthy());
    expect(screen.getByText("Inspection failed.")).toBeTruthy();
    expect(
      screen.getByText("1 source in app-managed local storage"),
    ).toBeTruthy();
  });

  it("persists the accent color choice through durable preferences", async () => {
    const { api } = installKnosysApi();

    renderApp();
    await openSettings();
    fireEvent.click(screen.getByRole("radio", { name: "Coral accent" }));
    expect(document.documentElement.dataset.accent).toBe("coral");
    expect(window.localStorage.getItem("knosys.accent")).toBe("coral");
    await waitFor(() =>
      expect(api.preferences.set).toHaveBeenCalledWith({ accent: "coral" }),
    );

    fireEvent.click(screen.getByRole("radio", { name: "Violet accent" }));
    expect(document.documentElement.dataset.accent).toBeUndefined();
    await waitFor(() =>
      expect(api.preferences.set).toHaveBeenCalledWith({ accent: "violet" }),
    );
    window.localStorage.removeItem("knosys.accent");
  });

  it("adopts durable preferences over the local cache on launch", async () => {
    installKnosysApi({
      preferences: { accent: "blue", collapsedFolders: null, theme: "dark" },
    });

    renderApp();
    await waitFor(() => expect(document.documentElement.dataset.accent).toBe("blue"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.accent;
  });

  it("migrates a cached accent into durable preferences when unset", async () => {
    window.localStorage.setItem("knosys.accent", "rose");
    const { api } = installKnosysApi();

    renderApp();
    await waitFor(() =>
      expect(api.preferences.set).toHaveBeenCalledWith({ accent: "rose" }),
    );
    expect(document.documentElement.dataset.accent).toBe("rose");

    window.localStorage.removeItem("knosys.accent");
    delete document.documentElement.dataset.accent;
  });

  it("lists installed models with compatibility reasons and manages selection", async () => {
    const { api } = installKnosysApi();
    vi.mocked(api.rag.setGenerationModel).mockResolvedValue(readyRagStatus);

    renderApp();
    await openSettings();
    selectTab("Models");

    await waitFor(() => expect(screen.getByText("Automatic")).toBeTruthy());
    expect(screen.getAllByText("qwen3:8b").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/6 GB · 32K context/).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Incompatible: Not a text-generation model/),
    ).toBeTruthy();

    const qwenRadio = screen.getByRole("radio", { name: /qwen3:8b/ });
    expect(qwenRadio).toHaveProperty("checked", true);
    fireEvent.click(screen.getByRole("radio", { name: /Automatic/ }));
    await waitFor(() =>
      expect(api.rag.setGenerationModel).toHaveBeenCalledWith({ mode: "auto" }),
    );
  });

  it("downloads a recommended model with progress and cancellation", async () => {
    const { api, emitPullEvent } = installKnosysApi();

    renderApp();
    await openSettings();
    selectTab("Models");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download gemma4:26b" })).toBeTruthy(),
    );
    expect(
      screen.getByRole("button", { name: "Download qwen3-embedding:0.6b" }),
    ).toBeTruthy();
    expect(screen.getByText(/Installed/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download gemma4:26b" }));
    await waitFor(() => expect(api.models.pull).toHaveBeenCalledWith("gemma4:26b"));

    emitPullEvent({
      completedBytes: 8_000_000_000,
      error: null,
      kind: "model-pull",
      model: "gemma4:26b",
      status: "downloading",
      totalBytes: 16_000_000_000,
    });
    await waitFor(() => expect(screen.getByText("Downloading · 50%")).toBeTruthy());

    fireEvent.click(
      screen.getByRole("button", { name: "Cancel downloading gemma4:26b" }),
    );
    await waitFor(() =>
      expect(api.models.cancelPull).toHaveBeenCalledWith("gemma4:26b"),
    );
    emitPullEvent({
      completedBytes: null,
      error: null,
      kind: "model-pull",
      model: "gemma4:26b",
      status: "cancelled",
      totalBytes: null,
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download gemma4:26b" })).toBeTruthy(),
    );
  });

  it("surfaces a failed download with its error message", async () => {
    const { emitPullEvent } = installKnosysApi();

    renderApp();
    await openSettings();
    selectTab("Models");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Download gemma4:26b" })).toBeTruthy(),
    );

    emitPullEvent({
      completedBytes: null,
      error: "The Ollama request failed.",
      kind: "model-pull",
      model: "gemma4:26b",
      status: "failed",
      totalBytes: null,
    });
    await waitFor(() =>
      expect(screen.getByText("The Ollama request failed.")).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Download gemma4:26b" })).toBeTruthy();
  });
});
