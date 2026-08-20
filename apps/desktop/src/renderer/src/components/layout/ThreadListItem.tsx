import type { ChatFolder, ChatThreadSummary } from "@knosys-rag/contracts";
import { FolderInput, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export const THREAD_DRAG_TYPE = "application/x-knosys-thread";

interface ThreadListItemProps {
  readonly disabled: boolean;
  readonly folders: readonly ChatFolder[];
  readonly onDelete: () => void;
  readonly onMove: (folderId: string | null) => void;
  readonly onRename: (title: string) => Promise<string | null>;
  readonly onSelect: () => void;
  readonly selected: boolean;
  readonly thread: ChatThreadSummary;
}

export function ThreadListItem({
  disabled,
  folders,
  onDelete,
  onMove,
  onRename,
  onSelect,
  selected,
  thread,
}: ThreadListItemProps): ReactNode {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(thread.title);

  const commitRename = (): void => {
    const trimmed = title.trim();
    setEditing(false);
    if (trimmed.length === 0 || trimmed === thread.title) {
      setTitle(thread.title);
      return;
    }
    void onRename(trimmed).then((error) => {
      if (error !== null) setTitle(thread.title);
    });
  };

  if (editing) {
    return (
      <div className="px-1">
        <input
          aria-label={`Rename conversation ${thread.title}`}
          autoFocus
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          maxLength={512}
          onBlur={commitRename}
          onChange={(event) => {
            setTitle(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              commitRename();
            }
            if (event.key === "Escape") {
              setTitle(thread.title);
              setEditing(false);
            }
          }}
          value={title}
        />
      </div>
    );
  }

  return (
    <div
      className="group relative"
      draggable={!disabled}
      onDragStart={(event) => {
        event.dataTransfer.setData(THREAD_DRAG_TYPE, thread.id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <button
        aria-pressed={selected}
        className={cn(
          "w-full rounded-lg px-2.5 py-2 pr-8 text-left text-sm transition-colors",
          selected
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-sidebar-foreground hover:bg-sidebar-accent/60",
          disabled && "pointer-events-none opacity-50",
        )}
        disabled={disabled}
        onClick={onSelect}
        type="button"
      >
        <span className="block truncate font-medium">{thread.title}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {thread.lastMessagePreview ?? "Conversation started"}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            aria-label={`Conversation actions for ${thread.title}`}
            className="absolute top-2 right-1.5 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:text-foreground data-[state=open]:opacity-100"
            type="button"
          >
            <MoreHorizontal size={15} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" side="right">
          <DropdownMenuItem
            onSelect={() => {
              setTitle(thread.title);
              setEditing(true);
            }}
          >
            <Pencil size={14} /> Rename
          </DropdownMenuItem>
          {folders.length > 0 ? (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="mr-1" size={14} /> Move to
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  onValueChange={(value) => {
                    onMove(value === "" ? null : value);
                  }}
                  value={thread.folderId ?? ""}
                >
                  <DropdownMenuRadioItem value="">No folder</DropdownMenuRadioItem>
                  {folders.map((folder) => (
                    <DropdownMenuRadioItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : null}
          <DropdownMenuItem onSelect={onDelete} variant="destructive">
            <Trash2 size={14} /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
