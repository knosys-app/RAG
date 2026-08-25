import type { ChatFolder, ChatThreadSummary } from "@knosys-rag/contracts";
import {
  ChevronRight,
  Folder,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState, type ReactNode } from "react";

import { THREAD_DRAG_TYPE, ThreadListItem } from "@/components/layout/ThreadListItem";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { contentTransition, exitTransition } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface FolderSectionProps {
  readonly activeRunThreadId: string | null;
  readonly collapsed: boolean;
  readonly folder: ChatFolder;
  readonly folders: readonly ChatFolder[];
  readonly onDelete: () => void;
  readonly onDeleteThread: (thread: ChatThreadSummary) => void;
  readonly onDropThread: (threadId: string) => void;
  readonly onMoveThread: (threadId: string, folderId: string | null) => void;
  readonly onNewChat: () => void;
  readonly onRename: (name: string) => Promise<string | null>;
  readonly onRenameThread: (threadId: string, title: string) => Promise<string | null>;
  readonly onSetThreadMemoryExclusion: (threadId: string, excluded: boolean) => void;
  readonly onSelectThread: (threadId: string) => void;
  readonly onToggleCollapsed: () => void;
  readonly selectedThreadId: string | null;
  readonly threads: readonly ChatThreadSummary[];
}

export function FolderSection({
  activeRunThreadId,
  collapsed,
  folder,
  folders,
  onDelete,
  onDeleteThread,
  onDropThread,
  onMoveThread,
  onNewChat,
  onRename,
  onRenameThread,
  onSelectThread,
  onSetThreadMemoryExclusion,
  onToggleCollapsed,
  selectedThreadId,
  threads,
}: FolderSectionProps): ReactNode {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [dragOver, setDragOver] = useState(false);

  const commitRename = (): void => {
    const trimmed = name.trim();
    setEditing(false);
    if (trimmed.length === 0 || trimmed === folder.name) {
      setName(folder.name);
      return;
    }
    void onRename(trimmed).then((error) => {
      if (error !== null) setName(folder.name);
    });
  };

  return (
    <section aria-label={`Folder ${folder.name}`}>
      {editing ? (
        <div className="px-1">
          <input
            aria-label={`Rename folder ${folder.name}`}
            autoFocus
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            maxLength={120}
            onBlur={commitRename}
            onChange={(event) => {
              setName(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitRename();
              }
              if (event.key === "Escape") {
                setName(folder.name);
                setEditing(false);
              }
            }}
            value={name}
          />
        </div>
      ) : (
        <div
          className={cn(
            "group relative rounded-lg transition-colors",
            dragOver && "bg-sidebar-accent ring-1 ring-ring",
          )}
          onDragLeave={() => {
            setDragOver(false);
          }}
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(THREAD_DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            setDragOver(true);
          }}
          onDrop={(event) => {
            setDragOver(false);
            const threadId = event.dataTransfer.getData(THREAD_DRAG_TYPE);
            if (threadId) {
              event.preventDefault();
              onDropThread(threadId);
            }
          }}
        >
          <button
            aria-expanded={!collapsed}
            className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 pr-14 text-left text-sm font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent/60"
            onClick={onToggleCollapsed}
            type="button"
          >
            <ChevronRight
              aria-hidden="true"
              className={cn(
                "shrink-0 text-muted-foreground transition-transform",
                !collapsed && "rotate-90",
              )}
              size={14}
            />
            <Folder aria-hidden="true" className="shrink-0 text-muted-foreground" size={14} />
            <span className="min-w-0 flex-1 truncate">{folder.name}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {threads.length}
            </span>
          </button>
          <span className="absolute top-1 right-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <button
              aria-label={`New chat in ${folder.name}`}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground"
              onClick={onNewChat}
              type="button"
            >
              <Plus size={14} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label={`Folder actions for ${folder.name}`}
                  className="rounded-md p-1 text-muted-foreground hover:text-foreground data-[state=open]:opacity-100"
                  type="button"
                >
                  <MoreHorizontal size={14} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="right">
                <DropdownMenuItem
                  onSelect={() => {
                    setName(folder.name);
                    setEditing(true);
                  }}
                >
                  <Pencil size={14} /> Rename
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onDelete} variant="destructive">
                  <Trash2 size={14} /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        </div>
      )}
      <AnimatePresence initial={false}>
        {!collapsed && threads.length > 0 ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key="folder-threads"
            transition={contentTransition}
          >
            <div className="mt-0.5 ml-3 flex flex-col gap-0.5 border-l pl-1.5">
              <AnimatePresence initial={false}>
                {threads.map((thread) => (
                  <motion.div
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, transition: exitTransition }}
                    initial={{ opacity: 0, y: -4 }}
                    key={thread.id}
                    layout="position"
                    transition={contentTransition}
                  >
                    <ThreadListItem
                      disabled={
                        activeRunThreadId !== null && activeRunThreadId !== thread.id
                      }
                      folders={folders}
                      onDelete={() => {
                        onDeleteThread(thread);
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
                      selected={thread.id === selectedThreadId}
                      thread={thread}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
