// spec/app/files/trash.md, "Story: See what is in the Trash"; spec/app/files/trash.md, "Story: Bring something back"; spec/app/files/trash.md, "Story: Erase for good"; spec/app/files/trash.md, "The owner restores everything listed that is still kept, together, from a list read since the last job"; spec/app/files/trash.md, "The owner marks listed entries, one by one or every one, and a mark lasts while its entry is listed and no job has started"; spec/app/files/trash.md, "The phone keeps an item thirty days from when it went in; its days left count down from thirty and never go below zero"
import { Alert, AppHeader, Button, cn, dockClearance, EmptyState, FilesCard, filesCardCancel, filesCardConfirm, FilesRow, FilesSelectionBar, Toast } from "@repo/ui";
import { useState, useSyncExternalStore, type MouseEvent } from "react";
import { Effect, type ManagedRuntime } from "effect";
import { AudioLines, Check, ChevronLeft, FileText, Folder, Image, Trash2, Undo2, Video, X } from "lucide-react";
import type { Machine } from "../../gen/app__files__trash.effect.vibe";
import { daysLeft, view } from "../../gen/app__files__trash.ts";
import { useMachine } from "../../gen/app__files__trash.react.ts";
import { useTimed } from "../runtime/ui.tsx";
import { untimed, Time } from "../runtime/index.vibe";
import { TrashFacts } from "./trashFacts.vibe";
import { sized } from "./entries.vibe";
import { launcherTop } from "../shell/ui.tsx";

export interface TrashProps {
  /** Provides the Trash machine, of files.vibe, and Alpha's time, at which `can` is asked. */
  runtime: ManagedRuntime.ManagedRuntime<Machine | Time | TrashFacts, unknown>;
  /** Back to the top of Files, where the rules allow it. */
  onBack?: (() => void) | undefined;
}

/**
 * The Trash: what it lists, each item brought back or erased, and everything erased at once, always after the owner
 * saw what goes; how a job ended.
 * @model spec/app/files/trash.md
 */
export function Trash({ runtime, onBack }: TrashProps) {
  const { state, can, send } = useTimed(runtime, useMachine);
  const factsShelf = runtime.runSync(Effect.flatMap(TrashFacts, (trash) => trash.view()));
  const facts = useSyncExternalStore(factsShelf.subscribe, factsShelf.snapshot, factsShelf.snapshot);
  const [choosing, setChoosing] = useState(false);
  const [asked, setAsked] = useState<"empty" | "chosen">("chosen");
  if (!state) return null;
  const owner = <E extends Parameters<typeof can>[0]>(event: E) => can(event, "Owner");
  const tell = <E extends Parameters<typeof send>[0]>(event: E) => void send(event, "Owner");
  const shown = view(state);
  const ended = state.attempt.outcome;
  const now = runtime.runSync(Effect.flatMap(Time, (time) => time.latest()));
  const detail = state.entries.find((entry) => entry.mark === state.details);
  const details = detail === undefined ? undefined : facts.get(detail.mark);
  const restore = detail === undefined ? undefined : { type: "restore", entry: detail, now: untimed } as const;
  const erase = detail === undefined ? undefined : { type: "askToErase", entry: detail } as const;
  const selecting = choosing || state.marked.length > 0;
  const closeDetails = () => { if (owner({ type: "closeItemDetails" })) tell({ type: "closeItemDetails" }); };
  const stopChoosing = () => {
    setChoosing(false);
    if (owner({ type: "unmark" })) tell({ type: "unmark" });
  };
  const restoreMarked = { type: "restoreMarked", now: untimed } as const;
  return (
    <section aria-label="Trash" className={cn("relative flex min-h-0 flex-1 flex-col", launcherTop)}>
      {selecting ? (
        <AppHeader title={`${state.marked.length} selected`} detail className="in-data-[alpha-launcher]:min-h-14 [&>h1]:ms-1.5 [&>h1]:font-display [&>h1]:text-2xl [&>h1]:font-light in-data-[alpha-title-row]:[&>h1]:ms-0" leading={<Button variant="ghost" size="icon" aria-label="Cancel selection" onClick={stopChoosing}><X /></Button>}>
          {owner({ type: "markAll" }) && <Button variant="ghost" className="h-11 px-3" onClick={() => tell(state.marked.length === state.entries.length ? { type: "unmark" } : { type: "markAll" })}>Select all</Button>}
        </AppHeader>
      ) : (
        <AppHeader title="Trash" detail className="in-data-[alpha-launcher]:min-h-14 [&>h1]:ms-1.5 in-data-[alpha-title-row]:[&>h1]:ms-0" leading={onBack && <Button variant="ghost" size="icon" aria-label="Files" onClick={onBack}><ChevronLeft /></Button>}>
          {owner({ type: "refresh" }) && <Button variant="ghost" className="h-11 px-3.5" onClick={() => tell({ type: "refresh" })}>Refresh</Button>}
          {owner({ type: "restoreAll", now: untimed }) && <Button variant="ghost" className="h-11 px-3.5" onClick={() => tell({ type: "restoreAll", now: untimed })}>Restore all</Button>}
          {owner({ type: "askToEmpty" }) && <Button variant="ghost" className="h-11 px-3.5" onClick={() => { setAsked("empty"); tell({ type: "askToEmpty" }); }}>Empty</Button>}
          {owner({ type: "markAll" }) && <Button variant="ghost" size="icon" aria-label="Select items" onClick={() => setChoosing(true)}><Check /></Button>}
        </AppHeader>
      )}
      <div className={cn("min-h-0 flex-1 touch-pan-y space-y-3 overflow-y-auto px-2", selecting ? "pb-[calc(--spacing(24)+max(var(--alpha-dock-overlap,5.75rem),var(--alpha-safe-bottom,0px)))]" : dockClearance)}>
      {(ended === "Refused" || ended === "Unknown") && <Alert variant="warn">{ended === "Unknown" ? "Alpha cannot tell how far the phone got" : "The phone did not do all of it"}</Alert>}
      {shown === "NoAccess" && <Alert variant="warn">Alpha may not read your files</Alert>}
      {shown === "Reading" && <p role="status" className="mx-2 my-2 text-sm text-muted-foreground">Loading…</p>}
      {shown === "Unreadable" && <Alert variant="destructive">The Trash cannot be read now</Alert>}
      {shown === "Empty" && <EmptyState icon={<Trash2 className="size-11" />} title="Trash is empty. Items in Trash are deleted after 30 days." className="gap-3 px-4 pt-24 pb-4" />}
      {state.entries.length > 0 && (
        <div role="group" aria-label="In the Trash">
          {state.entries.map((entry) => {
            const open = { type: "openItemDetails", entry } as const;
            const mark = { type: "mark", entry } as const;
            const listed = facts.get(entry.mark);
            const mime = listed?.mimeType ?? "";
            const Icon = listed?.directory ? Folder : mime.startsWith("image/") ? Image : mime.startsWith("video/") ? Video : mime.startsWith("audio/") ? AudioLines : FileText;
            const marked = state.marked.includes(entry.mark);
            const action = selecting ? mark : open;
            return (
              <FilesRow
                key={entry.mark}
                name={entry.name}
                aria-label={selecting ? `${marked ? "Deselect" : "Select"} ${entry.name}` : entry.name}
                icon={<Icon />}
                detail={listed === undefined ? undefined : listed.directory ? listed.location : `${sized(listed.bytes)} · ${listed.location}`}
                count={`${daysLeft(entry, now)}d`}
                chosen={selecting ? marked : undefined}
                disabled={!owner(action)}
                onClick={() => tell(action)}
                onContextMenu={owner(mark) ? (event: MouseEvent) => { event.preventDefault(); if (!marked) tell(mark); } : undefined}
              />
            );
          })}
        </div>
      )}
      </div>
      {selecting && (
        <FilesSelectionBar actions={[
          { label: "Restore", icon: <Undo2 />, onPress: owner(restoreMarked) ? () => { setChoosing(false); tell(restoreMarked); } : undefined },
          { label: "Delete forever", icon: <Trash2 />, onPress: owner({ type: "askToEraseMarked" }) ? () => { setAsked("chosen"); tell({ type: "askToEraseMarked" }); } : undefined },
        ]} />
      )}
      <FilesCard open={detail !== undefined && !state.erasing.showing} onOpenChange={(open) => { if (!open) closeDetails(); }} title={detail?.name ?? ""} message={details?.location}>
        <div className="mt-2 flex flex-wrap gap-2.5">
          {restore !== undefined && owner(restore) && <button type="button" className={filesCardConfirm} onClick={() => tell(restore)}>Restore</button>}
          {erase !== undefined && owner(erase) && <button type="button" className={cn(filesCardConfirm, "bg-secondary text-foreground")} onClick={() => { setAsked("chosen"); tell(erase); }}>Delete now</button>}
          <button type="button" className={filesCardCancel} onClick={closeDetails}>Cancel</button>
        </div>
      </FilesCard>
      <FilesCard
        open={state.erasing.showing}
        onOpenChange={(open) => { if (!open && owner({ type: "keepThem" })) tell({ type: "keepThem" }); }}
        title={asked === "empty" ? "Empty Trash?" : "Delete permanently?"}
        message={owner({ type: "erase" }) ? `${state.doomed.length === 1 ? "1 item" : `${state.doomed.length} items`} will be deleted permanently.` : "The Trash changed"}
        cancelLabel={owner({ type: "keepThem" }) ? "Cancel" : undefined}
        confirmLabel={owner({ type: "erase" }) ? (asked === "empty" ? "Empty" : "Delete") : undefined}
        onConfirm={() => { setChoosing(false); tell({ type: "erase" }); }}
      />
    </section>
  );
}

/** Undo of what was just deleted into the Trash, offered for its moment as develop's notice over the top of Files. */
export function Undo({ runtime }: Pick<TrashProps, "runtime">) {
  const { state, can, send } = useTimed(runtime, useMachine);
  const undo = { type: "undoDelete", now: untimed } as const;
  if (!state || !can(undo, "Owner")) return null;
  return (
    <div role="status" aria-live="polite" className="pointer-events-none absolute inset-x-4 top-[calc(var(--alpha-safe-top)+--spacing(15))] z-toast flex flex-col items-center in-data-[alpha-launcher]:top-[calc(max(--spacing(11),var(--alpha-safe-top))+--spacing(15))]">
      <Toast key={state.undo.until} onUndo={() => void send(undo, "Owner")}>{`${state.binned.length === 1 ? "1 item" : `${state.binned.length} items`} moved to Trash`}</Toast>
    </div>
  );
}
