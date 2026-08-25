import type {
  ChatFolder,
  ChatThreadSummary,
  KnosysDesktopApi,
} from "@knosys-rag/contracts";
import {
  ChevronRight,
  Folder,
  FolderPlus,
  Library,
  LoaderCircle,
  Plus,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { FolderSection } from "@/components/layout/FolderSection";
import { THREAD_DRAG_TYPE, ThreadListItem } from "@/components/layout/ThreadListItem";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { contentFade, contentTransition, exitTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type AppView = "chat" | "library";

const COLLAPSED_STORAGE_KEY = "knosys.sidebar.collapsedFolders";

function readCollapsedFolders(): ReadonlySet<string> {
  try {
    const stored = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    const parsed: unknown = stored === null ? [] : JSON.parse(stored);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value): value is string => typeof value === "string"));
    }
  } catch {
    // Collapse state is cosmetic; fall back to everything expanded.
  }
  return new Set();
}

interface AppSidebarProps {
  readonly activeJobCount: number;
  readonly activeRunThreadId: string | null;
  readonly folders: readonly ChatFolder[];
  readonly onCreateFolder: (name: string) => Promise<string | null>;
  readonly onDeleteFolder: (folderId: string) => Promise<string | null>;
  readonly onDeleteThread: (threadId: string) => Promise<string | null>;
  readonly onMoveThread: (threadId: string, folderId: string | null) => void;
  readonly onNewChat: () => void;
  readonly onNewChatInFolder: (folderId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onRenameFolder: (folderId: string, name: string) => Promise<string | null>;
  readonly onRenameThread: (threadId: string, title: string) => Promise<string | null>;
  readonly onSelectThread: (threadId: string) => void;
  readonly onSetThreadMemoryExclusion: (threadId: string, excluded: boolean) => void;
  readonly onViewChange: (view: AppView) => void;
  readonly selectedThreadId: string | null;
  readonly sourceCount: number;
  readonly threads: readonly ChatThreadSummary[];
  readonly threadsLoading: boolean;
  readonly view: AppView;
}

export function AppSidebar({
  activeJobCount,
  activeRunThreadId,
  folders,
  onCreateFolder,
  onDeleteFolder,
  onDeleteThread,
  onMoveThread,
  onNewChat,
  onNewChatInFolder,
  onOpenSettings,
  onRenameFolder,
  onRenameThread,
  onSelectThread,
  onSetThreadMemoryExclusion,
  onViewChange,
  selectedThreadId,
  sourceCount,
  threads,
  threadsLoading,
  view,
}: AppSidebarProps): ReactNode {
  const [deleteCandidate, setDeleteCandidate] = useState<ChatThreadSummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [folderDeleteCandidate, setFolderDeleteCandidate] = useState<ChatFolder | null>(
    null,
  );
  const [folderDeleteError, setFolderDeleteError] = useState<string | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [collapsedFolders, setCollapsedFolders] =
    useState<ReadonlySet<string>>(readCollapsedFolders);
  const [ungroupedDragOver, setUngroupedDragOver] = useState(false);
  const collapsedRef = useRef(collapsedFolders);
  collapsedRef.current = collapsedFolders;

  useEffect(() => {
    // localStorage is origin-scoped (dev vs packaged); the durable copy lives
    // behind preferences.get/set. Feature-detected for tests/older preloads.
    const api = (window as { knosys?: Partial<KnosysDesktopApi> }).knosys?.preferences;
    if (!api) return;
    let active = true;
    void api
      .get()
      .then((stored) => {
        if (!active) return;
        if (stored.collapsedFolders !== null) {
          setCollapsedFolders(new Set(stored.collapsedFolders));
        } else if (collapsedRef.current.size > 0) {
          void api
            .set({ collapsedFolders: [...collapsedRef.current] })
            .catch(() => undefined);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const threadsByFolder = useMemo(() => {
    const groups = new Map<string | null, ChatThreadSummary[]>();
    for (const thread of threads) {
      const key = thread.folderId;
      const group = groups.get(key);
      if (group) group.push(thread);
      else groups.set(key, [thread]);
    }
    return groups;
  }, [threads]);
  const ungroupedThreads = threadsByFolder.get(null) ?? [];
  const folderDeleteCount = folderDeleteCandidate
    ? (threadsByFolder.get(folderDeleteCandidate.id) ?? []).length
    : 0;

  const toggleCollapsed = (folderId: string): void => {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      try {
        window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Persisting collapse state is best-effort.
      }
      void (window as { knosys?: Partial<KnosysDesktopApi> }).knosys?.preferences
        ?.set({ collapsedFolders: [...next] })
        .catch(() => undefined);
      return next;
    });
  };

  const commitNewFolder = (): void => {
    const trimmed = newFolderName.trim();
    setCreatingFolder(false);
    setNewFolderName("");
    if (trimmed.length === 0) return;
    void onCreateFolder(trimmed);
  };

  const renderThread = (thread: ChatThreadSummary): ReactNode => (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: exitTransition }}
      initial={{ opacity: 0, y: -4 }}
      key={thread.id}
      layout="position"
      transition={contentTransition}
    >
      <ThreadListItem
        disabled={activeRunThreadId !== null && activeRunThreadId !== thread.id}
        folders={folders}
        onDelete={() => {
          setDeleteError(null);
          setDeleteCandidate(thread);
        }}
        onMove={(folderId) => {
          onMoveThread(thread.id, folderId);
        }}
        onRename={(title) => onRenameThread(thread.id, title)}
        onSelect={() => {
          onSelectThread(thread.id);
        }}
        onSetMemoryExclusion={(excluded) => {
          onSetThreadMemoryExclusion(thread.id, excluded);
        }}
        selected={view === "chat" && thread.id === selectedThreadId}
        thread={thread}
      />
    </motion.div>
  );

  return (
    <aside
      aria-label="Primary navigation"
      className="flex w-64 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground max-sm:w-14"
    >
      <div className="flex items-center gap-2.5 px-4 pt-11 pb-3 max-sm:justify-center max-sm:px-1">
        <span
          aria-hidden="true"
          className="flex size-8 items-center justify-center rounded-lg bg-sidebar-primary font-display text-xs font-bold text-sidebar-primary-foreground"
        >
          KR
        </span>
        <span className="min-w-0 max-sm:hidden">
          <span className="block truncate font-display text-sm font-semibold">
            Knosys RAG
          </span>
          <span className="block text-[0.7rem] text-muted-foreground">
            Private knowledge
          </span>
        </span>
      </div>

      <div className="flex gap-1.5 px-3 pb-2 max-sm:px-1.5">
        <Button
          aria-label="New chat"
          className="min-w-0 flex-1 justify-start gap-2 max-sm:justify-center"
          disabled={activeRunThreadId !== null}
          onClick={onNewChat}
          size="sm"
        >
          <Plus size={15} /> <span className="max-sm:hidden">New chat</span>
        </Button>
        <Button
          aria-label="New folder"
          className="shrink-0 max-sm:hidden"
          onClick={() => {
            setCreatingFolder(true);
          }}
          size="sm"
          variant="outline"
        >
          <FolderPlus size={15} />
        </Button>
      </div>

      <nav
        aria-label="Conversation history"
        className="min-h-0 flex-1 overflow-y-auto px-2 pt-1 pb-2 max-sm:hidden"
      >
        {threadsLoading ? (
          <div
            className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground"
            role="status"
          >
            <LoaderCircle aria-hidden="true" className="animate-spin" size={14} />
            Opening history
          </div>
        ) : null}
        {!threadsLoading && threads.length === 0 && folders.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Your grounded conversations will stay here.
          </p>
        ) : null}
        <div className="flex flex-col gap-0.5">
          {folders.map((folder) => (
            <FolderSection
              activeRunThreadId={activeRunThreadId}
              collapsed={collapsedFolders.has(folder.id)}
              folder={folder}
              folders={folders}
              key={folder.id}
              onDelete={() => {
                setFolderDeleteError(null);
                setFolderDeleteCandidate(folder);
              }}
              onDeleteThread={(thread) => {
                setDeleteError(null);
                setDeleteCandidate(thread);
              }}
              onDropThread={(threadId) => {
                onMoveThread(threadId, folder.id);
              }}
              onMoveThread={onMoveThread}
              onNewChat={() => {
                onNewChatInFolder(folder.id);
              }}
              onRename={(name) => onRenameFolder(folder.id, name)}
              onRenameThread={onRenameThread}
              onSelectThread={onSelectThread}
              onSetThreadMemoryExclusion={onSetThreadMemoryExclusion}
              onToggleCollapsed={() => {
                toggleCollapsed(folder.id);
              }}
              selectedThreadId={selectedThreadId}
              threads={threadsByFolder.get(folder.id) ?? []}
            />
          ))}
          {creatingFolder ? (
            <motion.div
              animate="visible"
              className="flex items-center gap-1.5 rounded-lg bg-sidebar-accent/60 px-2 py-1.5 ring-1 ring-ring ring-inset"
              initial="hidden"
              variants={contentFade}
            >
              <ChevronRight
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
                size={14}
              />
              <Folder
                aria-hidden="true"
                className="shrink-0 text-muted-foreground"
                size={14}
              />
              <input
                aria-label="New folder name"
                autoFocus
                className="min-w-0 flex-1 bg-transparent text-sm font-medium outline-none placeholder:font-normal placeholder:text-muted-foreground"
                maxLength={120}
                onBlur={commitNewFolder}
                onChange={(event) => {
                  setNewFolderName(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    commitNewFolder();
                  }
                  if (event.key === "Escape") {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }
                }}
                placeholder="New folder"
                value={newFolderName}
              />
            </motion.div>
          ) : null}
          {folders.length > 0 || creatingFolder ? (
            <p
              className={cn(
                "mt-1 rounded-md px-2 pt-1 pb-0.5 text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase transition-colors",
                ungroupedDragOver && "bg-sidebar-accent ring-1 ring-ring",
              )}
              onDragLeave={() => {
                setUngroupedDragOver(false);
              }}
              onDragOver={(event) => {
                if (!event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setUngroupedDragOver(true);
              }}
              onDrop={(event) => {
                setUngroupedDragOver(false);
                const threadId = event.dataTransfer.getData(THREAD_DRAG_TYPE);
                if (threadId) {
                  event.preventDefault();
                  onMoveThread(threadId, null);
                }
              }}
            >
              Chats
            </p>
          ) : null}
          <AnimatePresence initial={false}>
            {ungroupedThreads.map(renderThread)}
          </AnimatePresence>
        </div>
      </nav>

      <div className="border-t px-2 py-2 max-sm:px-1.5">
        <button
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm transition-colors max-sm:justify-center max-sm:px-0",
            view === "library"
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60",
          )}
          data-active={view === "library"}
          onClick={() => {
            onViewChange("library");
          }}
          type="button"
        >
          <Library aria-hidden="true" size={16} />
          <span className="flex-1 text-left max-sm:hidden">Library</span>
          <span
            aria-live="polite"
            className="text-xs text-muted-foreground max-sm:hidden"
          >
            {sourceCount}
            {activeJobCount ? ` · ${activeJobCount} active` : ""}
          </span>
        </button>
        <button
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60 max-sm:justify-center max-sm:px-0"
          onClick={onOpenSettings}
          type="button"
        >
          <Settings2 aria-hidden="true" size={16} />
          <span className="flex-1 text-left max-sm:hidden">Settings</span>
        </button>
        <p className="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[0.65rem] text-muted-foreground max-sm:hidden">
          <ShieldCheck aria-hidden="true" size={12} />
          Sources stay in app-managed local storage.
        </p>
      </div>

      <Dialog
        onOpenChange={(open) => {
          if (!open) setDeleteCandidate(null);
        }}
        open={deleteCandidate !== null}
      >
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete this conversation?</DialogTitle>
            <DialogDescription>
              “{deleteCandidate?.title}” and its messages will be removed from this Mac.
              This cannot be undone.
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
                void onDeleteThread(candidate.id).then((error) => {
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

      <Dialog
        onOpenChange={(open) => {
          if (!open) setFolderDeleteCandidate(null);
        }}
        open={folderDeleteCandidate !== null}
      >
        <DialogContent
          className="sm:max-w-md"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete this folder?</DialogTitle>
            <DialogDescription>
              “{folderDeleteCandidate?.name}” and{" "}
              {folderDeleteCount === 1
                ? "its 1 conversation"
                : `its ${String(folderDeleteCount)} conversations`}{" "}
              will be permanently removed from this Mac. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {folderDeleteError ? (
            <p className="text-sm text-destructive" role="alert">
              {folderDeleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              onClick={() => {
                setFolderDeleteCandidate(null);
              }}
              variant="outline"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const candidate = folderDeleteCandidate;
                if (!candidate) return;
                void onDeleteFolder(candidate.id).then((error) => {
                  if (error === null) setFolderDeleteCandidate(null);
                  else setFolderDeleteError(error);
                });
              }}
              variant="destructive"
            >
              Delete folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
