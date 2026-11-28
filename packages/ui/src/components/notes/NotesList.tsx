import type { ComponentProps, ReactNode } from "react";
import { RotateCw, Search, StickyNote, X } from "lucide-react";
import { cn, focusRing } from "../../lib/cn.ts";
import { dockClearance } from "../../lib/styles.ts";
import { Skeleton } from "../Skeleton.tsx";

export type NotesListProps = Omit<ComponentProps<"div">, "children"> & {
  /** What the list shows: the notes, nothing while the first reading is under way, or the notes out of reach. */
  state: "listed" | "loading" | "unavailable";
  /** The pinned notes, each a `NoteRow`, listed first under their own heading. */
  pinned?: ReactNode[];
  /** Every other note, each a `NoteRow`. */
  others?: ReactNode[];
  /** The folder the list is narrowed to, shown as a chip that clears it. */
  filter?: string;
  /** Clears the folder the list is narrowed to. */
  onClearFilter?: () => void;
  /** Why the notes are out of reach. */
  message?: string;
  /** Reads the notes again while they are out of reach. */
  onRetry?: () => void;
  /** Direct actions offered below the empty status when there are no notes. */
  emptyActions?: ReactNode;
};

const heading = "px-2 pt-2 pb-0.5 text-caption font-semibold text-muted-foreground";

/** The Notes list: the pinned notes first, then the rest, narrowed to a folder when asked, or why there are none. */
export function NotesList({ state, pinned = [], others = [], filter, onClearFilter, message = "Agent offline", onRetry, emptyActions, className, ...props }: NotesListProps) {
  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} {...props}>
      {filter !== undefined && (
        <div className="flex shrink-0 px-4 pb-2.5">
          <span role="status" className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full bg-secondary pr-1 pl-3 text-meta font-semibold">
            <Search aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{filter}</span>
            <button type="button" aria-label="Clear filter" onClick={onClearFilter} className={cn(focusRing, "-my-2 flex size-12 items-center justify-center rounded-full")}>
              <X aria-hidden className="size-3.5" />
            </button>
          </span>
        </div>
      )}
      <div className={cn(dockClearance, "min-h-0 flex-1 overflow-y-auto px-4")}>
        {state === "loading" && (
          <div role="status" aria-label="Loading notes" aria-busy className="flex flex-col gap-2 pt-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {state === "unavailable" && (
          <div className="flex flex-col items-center gap-2.5 px-2 py-12 text-center">
            <span aria-hidden className="relative flex text-muted-foreground">
              <StickyNote className="size-7" />
              <span className="absolute -top-0.5 left-1/2 -ml-px h-8 w-0.5 -rotate-45 rounded-clip bg-current" />
            </span>
            <h2 className="sr-only">Notes unavailable</h2>
            <p role="status" className="m-0 text-body leading-chat font-semibold">{message}</p>
            {onRetry && (
              <button type="button" onClick={onRetry} className={cn(focusRing, "inline-flex min-h-12 items-center gap-2 rounded-full bg-secondary px-5 font-semibold")}>
                <RotateCw aria-hidden className="size-4.5" />
                Reconnect
              </button>
            )}
          </div>
        )}
        {state === "listed" && pinned.length + others.length === 0 && (
          <div className="flex flex-col items-center gap-4 px-2 py-12 text-center">
            <div role="status" className="flex flex-col items-center gap-2.5 text-muted-foreground">
              <StickyNote aria-hidden className="size-7" />
              <h2 className="m-0 text-body leading-chat font-semibold">{filter === undefined ? "No notes" : "No matches"}</h2>
            </div>
            {emptyActions}
          </div>
        )}
        {state === "listed" && pinned.length > 0 && <h2 className={heading}>Pinned</h2>}
        {state === "listed" && pinned}
        {state === "listed" && pinned.length > 0 && others.length > 0 && <h2 className={cn(heading, "pt-3.5")}>Notes</h2>}
        {state === "listed" && others}
      </div>
    </div>
  );
}
