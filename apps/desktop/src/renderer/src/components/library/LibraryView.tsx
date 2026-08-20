import type { DocumentSummary, SearchResult } from "@knosys-rag/contracts";
import {
  AlertTriangle,
  BookOpenText,
  Check,
  FilePlus2,
  FolderOpen,
  LoaderCircle,
  Search,
} from "lucide-react";
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AnimatePresence, motion } from "motion/react";

import { ActivityPanel } from "@/components/library/ActivityPanel";
import { DocumentList } from "@/components/library/DocumentList";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { UseLibrary } from "@/hooks/useLibrary";
import type { UseRagStatus } from "@/hooks/useRagStatus";
import { describeError } from "@/lib/errors";
import { searchLocation } from "@/lib/format";
import { importOutcomeLabel } from "@/lib/library-labels";
import { contentTransition, exitTransition } from "@/lib/motion";

interface LibraryViewProps {
  readonly library: UseLibrary;
  readonly rag: UseRagStatus;
  readonly searchFocusRequest: number;
}

export function LibraryView({
  library,
  rag,
  searchFocusRequest,
}: LibraryViewProps): ReactNode {
  const [searchQuery, setSearchQuery] = useState("");
  const normalizedSearchQuery = searchQuery.trim();
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery);
  const [searchResults, setSearchResults] = useState<readonly SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [deleteCandidate, setDeleteCandidate] = useState<DocumentSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchFocusRequest > 0) searchInputRef.current?.focus();
  }, [searchFocusRequest]);

  useEffect(() => {
    if (!deferredSearchQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    const timeout = window.setTimeout(() => {
      setSearching(true);
      void window.knosys.library
        .search(deferredSearchQuery)
        .then((results) => {
          if (active) startTransition(() => setSearchResults(results));
        })
        .catch((error: unknown) => {
          if (active) setSearchError(describeError(error, "The local search failed."));
        })
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [deferredSearchQuery]);

  const documents = library.snapshot.documents;
  const importNeedsReview = library.importOutcomes.some((outcome) =>
    ["failed", "unsupported"].includes(outcome.status),
  );

  return (
    <div className="h-full min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-6">
        <header>
          <h1 className="font-display text-xl font-semibold">Library</h1>
          <p className="text-sm text-muted-foreground">
            Private sources indexed for fast local retrieval.
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden="true"
              className="absolute top-1/2 left-2.5 -translate-y-1/2 text-muted-foreground"
              size={15}
            />
            <input
              aria-keyshortcuts="Meta+K Control+K"
              aria-label="Search indexed text"
              className="w-full rounded-lg border bg-card py-2 pr-16 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              disabled={documents.length === 0}
              onChange={(event) => {
                setSearchQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Escape" && searchQuery) setSearchQuery("");
              }}
              placeholder="Title, heading, or passage"
              ref={searchInputRef}
              type="search"
              value={searchQuery}
            />
            {searching ? (
              <LoaderCircle
                aria-label="Searching"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 animate-spin text-muted-foreground"
                size={14}
              />
            ) : (
              <kbd
                aria-hidden="true"
                className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded border px-1.5 py-0.5 font-mono text-[0.65rem] text-muted-foreground"
              >
                ⌘K
              </kbd>
            )}
          </div>
          <Button
            disabled={library.importing !== null}
            onClick={() => void library.importSources("files")}
            size="sm"
          >
            {library.importing === "files" ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <FilePlus2 size={15} />
            )}
            {library.importing === "files" ? "Importing" : "Import files"}
          </Button>
          <Button
            disabled={library.importing !== null}
            onClick={() => void library.importSources("directory")}
            size="sm"
            variant="outline"
          >
            {library.importing === "directory" ? (
              <LoaderCircle className="animate-spin" size={15} />
            ) : (
              <FolderOpen size={15} />
            )}
            {library.importing === "directory" ? "Scanning" : "Import folder"}
          </Button>
        </div>

        <ActivityPanel
          importing={library.importing}
          importProgress={library.importProgress}
          ragStatus={rag.status}
          sourceCount={documents.length}
        />

        <AnimatePresence initial={false}>
        {library.operationMessage ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg border bg-card p-3 text-sm"
            data-state={importNeedsReview ? "review" : "complete"}
            exit={{ opacity: 0, transition: exitTransition }}
            initial={{ opacity: 0, y: 4 }}
            key="import-result"
            role="status"
            transition={contentTransition}
          >
            <p className="flex items-center gap-2 font-medium">
              {importNeedsReview ? (
                <AlertTriangle aria-hidden="true" className="text-amber-500" size={15} />
              ) : (
                <Check aria-hidden="true" className="text-primary" size={15} />
              )}
              {library.operationMessage}
            </p>
            {library.importOutcomes.length ? (
              <ul aria-label="Import results by file" className="mt-2 space-y-1 text-xs">
                {library.importOutcomes.slice(0, 100).map((outcome, index) => (
                  <li
                    className="flex flex-wrap items-baseline gap-x-2"
                    data-state={outcome.status}
                    key={`${outcome.originalName}-${index}`}
                  >
                    <span className="text-muted-foreground">{outcome.originalName}</span>
                    <strong>{importOutcomeLabel(outcome.status)}</strong>
                    {outcome.errorMessage ? (
                      <small className="text-destructive">{outcome.errorMessage}</small>
                    ) : null}
                  </li>
                ))}
                {library.importOutcomes.length > 100 ? (
                  <li>
                    <small>
                      {library.importOutcomes.length - 100} additional results are not
                      shown.
                    </small>
                  </li>
                ) : null}
              </ul>
            ) : null}
          </motion.div>
        ) : null}
        </AnimatePresence>

        <AnimatePresence initial={false}>
        {library.operationError || searchError ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            exit={{ opacity: 0, transition: exitTransition }}
            initial={{ opacity: 0, y: 4 }}
            key="library-error"
            role="alert"
            transition={contentTransition}
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <div>
              <strong>Local operation failed.</strong>
              <p className="text-muted-foreground">
                {library.operationError ?? searchError}
              </p>
            </div>
          </motion.div>
        ) : null}
        </AnimatePresence>

        {library.libraryState.state === "loading" ? (
          <div
            className="flex items-center gap-2 py-6 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
            Opening the local library
          </div>
        ) : null}
        {library.libraryState.state === "error" ? (
          <div
            className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm"
            role="alert"
          >
            <AlertTriangle aria-hidden="true" className="mt-0.5 shrink-0" size={16} />
            <div>
              <strong>Library unavailable.</strong>
              <p className="text-muted-foreground">{library.libraryState.message}</p>
            </div>
          </div>
        ) : null}

        {normalizedSearchQuery ? (
          <section aria-live="polite" className="space-y-2">
            <p className="text-xs text-muted-foreground" role="status">
              {searchResults.length} {searchResults.length === 1 ? "match" : "matches"} for{" "}
              <q>{normalizedSearchQuery}</q>
            </p>
            {!searching && searchResults.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">
                No matching passages. Try fewer words or a more specific phrase.
              </p>
            ) : null}
            <div className="divide-y rounded-xl border bg-card">
              {searchResults.map((result) => (
                <div className="px-3 py-2.5" key={result.chunkId}>
                  <p className="text-sm font-medium">{result.title}</p>
                  {result.headingPath.length || searchLocation(result) ? (
                    <p className="text-xs text-muted-foreground">
                      {[...result.headingPath, searchLocation(result)]
                        .filter(Boolean)
                        .join(" / ")}
                    </p>
                  ) : null}
                  <p className="mt-1 text-xs text-muted-foreground">{result.snippet}</p>
                </div>
              ))}
            </div>
          </section>
        ) : documents.length ? (
          <DocumentList
            documents={documents}
            onDelete={(document) => {
              setDeleteError(null);
              setDeleteCandidate(document);
            }}
          />
        ) : library.libraryState.state === "ready" ? (
          <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed px-6 py-10 text-center">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"
            >
              <BookOpenText size={24} strokeWidth={1.5} />
            </span>
            <div className="space-y-1">
              <h3 className="font-display font-semibold">Build a private reference shelf</h3>
              <p className="max-w-md text-sm text-muted-foreground">
                Import TXT, Markdown, HTML, DOCX, EPUB, or native-text PDF. Knosys copies
                each source into managed local storage before indexing it.
              </p>
            </div>
            <Button onClick={() => void library.importSources("files")}>
              <FilePlus2 size={15} /> Import first source
            </Button>
            <p className="text-xs text-muted-foreground">
              Scanned PDFs require OCR before they can be indexed.
            </p>
          </div>
        ) : null}
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null);
        }}
        open={deleteCandidate !== null}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete this source?</DialogTitle>
            <DialogDescription>
              “{deleteCandidate?.title}” will be removed from managed storage and the
              local index. Answers that cited it keep their saved quotes.
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => {
                setDeleteCandidate(null);
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const candidate = deleteCandidate;
                if (!candidate) return;
                void library.deleteDocument(candidate.id).then((error) => {
                  if (error === null) setDeleteCandidate(null);
                  else setDeleteError(error);
                });
              }}
              variant="destructive"
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
