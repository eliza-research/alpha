// spec/app/files/preview.md, "Story: Look at a file"; spec/app/files/preview.md, "Story: Act on the file I am looking at"; spec/app/files/preview.md, "Story: Get a file back when access was lost"; spec/app/files/recent.md, "Story: Find what I opened lately"; spec/app/files/preview.md, "The caption and Details show facts for the exact document held"
import { Alert, Button, cn, dockClearance, FilesCard, filesCardCancel, FilesRow, Input, LogoMark, Menu, MenuContent, MenuItem, MenuTrigger, Spinner } from "@repo/ui";
import { Effect, Option, type ManagedRuntime } from "effect";
import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, Ellipsis, ExternalLink, FileText, FolderInput, Info, Mail, MessageCircle, Pause, Pencil, Play, Share2, Trash2, X } from "lucide-react";
import type { Machine as Browser } from "../../gen/app__files.effect.vibe";
import { previewActionReady } from "../../gen/app__files.ts";
import { useMachine as useFiles } from "../../gen/app__files.react.ts";
import type { Machine } from "../../gen/app__files__preview.effect.vibe";
import { loaded, showing, showsFileFacts, usable } from "../../gen/app__files__preview.ts";
import { useMachine } from "../../gen/app__files__preview.react.ts";
import type { Machine as RecentMachine } from "../../gen/app__files__recent.effect.vibe";
import { useMachine as useRecent } from "../../gen/app__files__recent.react.ts";
import type { Machine as Inbox } from "../../gen/app__inbox.effect.vibe";
import { useMachine as useInbox } from "../../gen/app__inbox.react.ts";
import type { Machine as Drafts } from "../../gen/app__inbox__drafts.effect.vibe";
import { useMachine as useDrafts } from "../../gen/app__inbox__drafts.react.ts";
import { changedOn, folderLocation, parentPath, sized, validFileName } from "./entries.vibe";
import { Handles } from "./handles.vibe";
import { Opened, emailAccount, pictureFits } from "./preview.vibe";
import { native } from "../platform/index.vibe";
import { launcherInnerHeader, launcherTop } from "../shell/ui.tsx";

/** Develop's File actions: a 220px panel under the header, ringed, with 44px rows and 20px icons. */
const actionsPanel = "w-55 min-w-0 rounded-tile p-1.5 ring-1 ring-border shadow-popup dark:shadow-popup-dark";
const actionRow = "min-h-11 rounded-lg px-3.5 py-2 [&_svg]:size-5";
const fully = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const linesPerCard = 8;

export interface PreviewProps {
  /** Provides the preview and Recent machines, and what the viewer read, of preview.vibe. */
  runtime: ManagedRuntime.ManagedRuntime<Machine | Browser | RecentMachine | Opened | Handles | Inbox | Drafts, unknown>;
  /** Files' current date, used to show the same short date as its list. */
  today: Date;
}

/** What the owner calls the document a grant names. */
function nameOf(runtime: PreviewProps["runtime"], grant: number): string | undefined {
  return Option.getOrUndefined(Option.map(runtime.runSync(Effect.flatMap(Opened, (opened) => opened.grant(grant))), (given) => given.name));
}

/**
 * The viewer: one file full screen, its text, picture, recording or PDF page, while it loads or why it cannot be
 * shown, and what the owner can do with it, each offered exactly when the rules take it.
 * @model spec/app/files/preview.md
 */
export function Preview({ runtime, today }: PreviewProps) {
  const { state, can, send } = useMachine(runtime);
  const recent = useRecent(runtime);
  const inbox = useInbox(runtime);
  const drafts = useDrafts(runtime);
  const files = useFiles(runtime);
  const contentShelf = runtime.runSync(Effect.flatMap(Opened, (opened) => opened.contentShelf()));
  const content = useSyncExternalStore(contentShelf.subscribe, contentShelf.snapshot, contentShelf.snapshot);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const nameButtonRef = useRef<HTMLButtonElement>(null);
  const [details, setDetails] = useState<{ readonly viewer: number; readonly revision: number }>();
  const [rename, setRename] = useState<{ readonly viewer: number; readonly revision: number; readonly name: string }>();
  const mediaRef = useRef<HTMLMediaElement | null>(null);
  const playing = state?.playing ?? false;
  const syncMedia = useCallback((node: HTMLMediaElement | null) => {
    mediaRef.current = node;
    if (!node) return;
    if (playing && node.paused) {
      void node.play().catch(() => { if (can({ type: "play" }, "Owner")) void send({ type: "play" }, "Owner"); });
    } else if (!playing && !node.paused) {
      node.pause();
    }
  }, [playing, can, send]);
  const focusOnOpen = useCallback((node: HTMLElement | null) => node?.focus({ preventScroll: true }), []);
  if (!state || !recent.state || !showing(state)
    || files.state?.sheet.open || files.state?.deleting.showing || files.state?.change.clash.showing) return null;
  const owner = <E extends Parameters<typeof can>[0]>(event: E) => can(event, "Owner");
  const tell = <E extends Parameters<typeof send>[0]>(event: E) => void send(event, "Owner");
  const mine = content.viewer === state.viewer && loaded(state);
  const grant = recent.state.shown.key === state.item ? recent.state.shown.grant : 0;
  const file = Option.getOrUndefined(runtime.runSync(Effect.flatMap(Opened, (opened) => opened.grant(grant))));
  const lapsedName = !usable(state) ? runtime.runSync(Effect.flatMap(Opened, (opened) => opened.nameAt(state.item))) : undefined;
  const name = file?.name ?? lapsedName ?? Option.getOrUndefined(runtime.runSync(Effect.flatMap(Handles, (handles) => handles.label(state.item)))) ?? "File";
  const mediaProps = {
    "aria-label": name,
    controls: true,
    preload: "metadata",
    onEnded: () => { if (state.playing && owner({ type: "play" })) tell({ type: "play" }); },
    onError: () => { if (state.playing && owner({ type: "play" })) tell({ type: "play" }); },
    ref: syncMedia,
  } as const;
  const askAlpha = owner({ type: "askAlpha" });
  const openElsewhere = owner({ type: "openElsewhere" });
  const forget = owner({ type: "forget" });
  const share = file !== undefined && owner({ type: "shareFile" });
  const picture = { type: "useInMessages", fitsPicture: pictureFits(file) } as const;
  const facts = file !== undefined && showsFileFacts(state, file.key, file.revision) ? file : undefined;
  const showDetails = facts !== undefined;
  const detailsOpen = showDetails && details?.viewer === state.viewer && details.revision === state.revision;
  const ownFile = file !== undefined && recent.state.shown.origin === "InFolder" && files.state !== undefined && previewActionReady(files.state);
  const move = { type: "actOnStoredFile", operation: "MoveFile", name: "", stored: ownFile } as const;
  const trash = { type: "actOnStoredFile", operation: "TrashFile", name: "", stored: ownFile } as const;
  const pickedRename = !ownFile && recent.state.shown.origin === "Picked" && file?.canRename === true;
  const nextName = rename?.name.trim() ?? "";
  const editName = pickedRename
    ? { type: "renamePicked", name: nextName, renameable: true } as const
    : { type: "actOnStoredFile", operation: "RenameFile", name: nextName, stored: ownFile } as const;
  const renaming = (ownFile || pickedRename) && rename?.viewer === state.viewer && rename.revision === state.revision;
  const showRename = owner({ ...editName, name: "/" });
  const renameTitle = ownFile && showRename;
  const startRename = () => setRename({ viewer: state.viewer, revision: state.revision, name });
  const place = facts?.storage;
  const location = place === undefined ? undefined : folderLocation(place.label, parentPath(place.path));
  const revision = facts?.revision ?? 0;
  const changed = changedOn(revision, today);
  const modified = changed === "" ? undefined : new Date(revision);
  const bytes = facts?.bytes;
  const kind = { Media: "Media", Photo: "Image", Text: "Text", Archive: "Archive", Pdf: "PDF", Receipt: "Receipt" }[state.kind];
  const caption = [facts?.mimeType, "selected on this device", location].filter(Boolean).join(" · ");
  const destination = inbox.state && drafts.state ? emailAccount(inbox.state, drafts.state) : undefined;
  const offer = { type: "useInEmail", account: destination?.account ?? 0 } as const;
  const email = file !== undefined && destination !== undefined && owner(offer);
  const submitRename = () => {
    if (!(owner(editName) && validFileName(editName.name) !== undefined && editName.name !== name)) return;
    tell(editName);
    setRename(undefined);
  };
  return (
    <section ref={focusOnOpen} role="dialog" aria-label="Preview" tabIndex={-1} data-alpha-subview="files-preview"
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.contains(event.target as Node) || !owner({ type: "close" })) return;
        event.stopPropagation();
        tell({ type: "close" });
      }}
      className={cn("absolute inset-0 z-20 flex flex-col overflow-hidden bg-background text-foreground focus-visible:outline-none motion-safe:animate-rise", launcherTop)}>
        <div className={cn("flex min-h-13 shrink-0 items-center gap-0.5 px-2 [&_button]:size-13", launcherInnerHeader)}>
          {owner({ type: "close" }) && <Button variant="ghost" size="icon" aria-label="Close" onClick={() => tell({ type: "close" })}><ChevronLeft /></Button>}
          <div className="flex-1" />
          {(askAlpha || openElsewhere || forget || email || owner(picture) || share || showDetails || (showRename && !renameTitle) || owner(move) || owner(trash)) && (
            <Menu>
              <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="File actions"><Ellipsis /></Button></MenuTrigger>
              <MenuContent sideOffset={44} alignOffset={4} className={actionsPanel}>
                {share && <MenuItem className={actionRow} onSelect={() => tell({ type: "shareFile" })}><Share2 />Share</MenuItem>}
                {owner(move) && <MenuItem className={actionRow} onSelect={() => tell(move)}><FolderInput />Add to folder</MenuItem>}
                {email && <MenuItem aria-label="Use in email" className={actionRow} onSelect={() => tell(offer)}><Mail />Email</MenuItem>}
                {askAlpha && <MenuItem className={actionRow} onSelect={() => tell({ type: "askAlpha" })}><LogoMark className="size-5" />Ask Alpha</MenuItem>}
                {owner(picture) && <MenuItem className={actionRow} onSelect={() => tell(picture)}><MessageCircle />Use in Messages</MenuItem>}
                {openElsewhere && <MenuItem className={actionRow} onSelect={() => tell({ type: "openElsewhere" })}><ExternalLink />{native() ? "Open in Android" : "Open elsewhere"}</MenuItem>}
                {showRename && !renameTitle && <MenuItem className={actionRow} onSelect={startRename}><Pencil />Rename</MenuItem>}
                {forget && <MenuItem className={actionRow} onSelect={() => tell({ type: "forget" })}><X />Forget</MenuItem>}
                {showDetails && <MenuItem className={actionRow} onSelect={() => setDetails({ viewer: state.viewer, revision: state.revision })}><Info />Details</MenuItem>}
                {owner(trash) && <MenuItem className={actionRow} onSelect={() => tell(trash)}><Trash2 />Delete</MenuItem>}
              </MenuContent>
            </Menu>
          )}
        </div>
        <div className={cn("min-h-0 flex-1 touch-pan-y overflow-y-auto px-6 pt-1", dockClearance)}>
          <h2 aria-label={renameTitle ? name : undefined} className="font-display text-title font-light break-words">
            {renameTitle ? <button ref={nameButtonRef} type="button" aria-label={`Rename ${name}`} className="block w-full text-left" onClick={startRename}>{name}</button> : name}
          </h2>
          {facts !== undefined && <p className="mt-2.5 mb-5 flex items-start gap-2.5 text-sm wrap-anywhere text-muted-foreground"><span aria-hidden data-facts-slot className="size-4.5 shrink-0" />{caption}</p>}
          {state.attempt.outcome === "Unknown" && state.offered.item === state.item && state.offered.revision === state.revision && <Alert variant="warn">Check Inbox before offering this file again</Alert>}
          {!usable(state) && <Alert variant="warn">Alpha can no longer read this file</Alert>}
          {state.content.status === "Loading" && <Spinner label="Opening the file" />}
          {state.content.status === "Failed" && <Alert variant="warn">{state.why === "Locked" ? "This PDF is locked" : state.why === "TooLarge" ? "This file is too large to show" : state.why === "TooSlow" ? "This PDF took too long to open" : state.why === "Unsealed" ? "This PDF could not be opened safely" : "This file cannot be shown here"}</Alert>}
          {state.drawing.status === "Failed" && <Alert variant="warn">{state.why === "Unsealed" ? "This page could not be opened safely" : "This page cannot be shown"}</Alert>}
          {mine && content.text !== undefined && <TextCards name={name} text={content.text} />}
          {mine && state.kind === "Photo" && content.uri !== undefined && <img alt={name} src={content.uri} decoding="async" className="mx-auto w-full max-h-[55dvh] object-contain" />}
          {mine && state.kind === "Media" && content.uri !== undefined && (file?.mimeType.startsWith("audio/") ? <audio {...mediaProps} src={content.uri} className="w-full" /> : <video {...mediaProps} src={content.uri} className="mx-auto w-full max-h-[55dvh]" />)}
          {owner({ type: "play" }) && <Button variant="ghost" size="icon" aria-label={state.playing ? "Pause" : "Play"} className="mx-auto mt-2 flex" onClick={() => tell({ type: "play" })}>{state.playing ? <Pause /> : <Play />}</Button>}
          {mine && state.kind === "Pdf" && state.drawing.status === "Loaded" && content.page !== undefined && <div className="overflow-hidden rounded-lg bg-alpha-foreground shadow-md ring-1 ring-border"><img alt={`Page ${state.page} of ${state.pages}`} src={content.page} decoding="async" className="block h-auto w-full" /></div>}
          {state.kind === "Pdf" && state.pages > 1 && (
            <div className="mt-3 flex items-center justify-between gap-2 text-muted-foreground">
              {owner({ type: "turnTo", page: state.page - 1 }) && <Button variant="ghost" size="icon" aria-label="Previous page" onClick={() => tell({ type: "turnTo", page: state.page - 1 })}><ChevronLeft /></Button>}
              <span className="text-base">{`Page ${state.page} of ${state.pages}`}</span>
              {owner({ type: "turnTo", page: state.page + 1 }) && <Button variant="ghost" size="icon" aria-label="Next page" onClick={() => tell({ type: "turnTo", page: state.page + 1 })}><ChevronRight /></Button>}
            </div>
          )}
          {owner({ type: "selectAgain" }) && <Button size="sm" className="mt-3" onClick={() => tell({ type: "selectAgain" })}>Select again</Button>}
        </div>
        <FilesCard
          open={renaming}
          onOpenChange={(open) => { if (!open) setRename(undefined); }}
          title="Rename"
          cancelLabel="Cancel"
          confirmLabel="Rename"
          confirmDisabled={!(owner(editName) && validFileName(editName.name) !== undefined && editName.name !== name)}
          onConfirm={submitRename}
          onOpenAutoFocus={(event) => {
            const input = renameInputRef.current;
            if (input === null) return;
            event.preventDefault();
            input.focus({ preventScroll: true });
            const dot = input.value.lastIndexOf(".");
            input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
          }}
          onCloseAutoFocus={(event) => {
            const trigger = nameButtonRef.current;
            if (trigger === null || trigger.ownerDocument.activeElement !== trigger.ownerDocument.body) return;
            event.preventDefault();
            trigger.focus({ preventScroll: true });
          }}
        >
          <form onSubmit={(event) => { event.preventDefault(); submitRename(); }}>
            <Input
              ref={renameInputRef}
              aria-label="Name"
              value={rename?.name ?? ""}
              onChange={(event) => setRename(rename && { ...rename, name: event.target.value })}
              className="rounded-md"
            />
          </form>
        </FilesCard>
        <FilesCard open={detailsOpen} onOpenChange={(open) => { if (!open) setDetails(undefined); }} title={name}>
          <dl aria-label="File details" className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-base">
            <dt className="text-muted-foreground">Type</dt><dd className="wrap-anywhere">{kind}</dd>
            {bytes !== undefined && <><dt className="text-muted-foreground">Size</dt><dd className="wrap-anywhere">{bytes >= 1024 ? `${sized(bytes)} (${bytes.toLocaleString()} bytes)` : sized(bytes)}</dd></>}
            {modified !== undefined && <><dt className="text-muted-foreground">Modified</dt><dd className="wrap-anywhere"><time dateTime={modified.toISOString()}>{fully.format(modified)}</time></dd></>}
            {location !== undefined && <><dt className="text-muted-foreground">Location</dt><dd className="wrap-anywhere">{location}</dd></>}
          </dl>
          <div className="mt-4.5 flex justify-end"><button type="button" aria-label="Close details" className={filesCardCancel} onClick={() => setDetails(undefined)}>Close</button></div>
        </FilesCard>
    </section>
  );
}

/**
 * A text file as v119's live preview drew it (selection-adapter.ts:272-283, template.html:3259-3270 at 45f6bed30): white
 * paper cards of eight numbered lines, each headed with the file's name and, after the first, "(continued)".
 */
function TextCards({ name, text }: { readonly name: string; readonly text: string }) {
  const lines = text.split("\n").map((words, index) => ({ number: index + 1, words }));
  const cards = Array.from({ length: Math.ceil(lines.length / linesPerCard) }, (_, card) => lines.slice(card * linesPerCard, (card + 1) * linesPerCard));
  return cards.map((rows) => (
    <div key={rows[0]?.number}
      // eslint-disable-next-line better-tailwindcss/no-unknown-classes -- design.md, "Dark": v119's paper stays white with dark text in either app theme
      className="light mt-5 aspect-[0.77] rounded-frame bg-background px-6.5 py-7.5 text-foreground shadow-md ring-1 ring-border">
      <p className="mb-4.5 font-display text-quote font-normal">{rows[0]?.number === 1 ? name : `${name} (continued)`}</p>
      <ol className="mb-4">
        {rows.map(({ number, words }) => (
          <li key={number} className="flex gap-2.5 border-b py-1.5 text-badge">
            <span className="w-21 shrink-0 text-muted-foreground">{number}</span>
            <span className="min-w-0 font-medium wrap-anywhere">{words}</span>
          </li>
        ))}
      </ol>
    </div>
  ));
}

/**
 * Recent: the files opened lately, newest first, each opened again when the phone still lets Alpha read it, and
 * otherwise named as one to select again.
 * @model spec/app/files/recent.md
 */
export function RecentFiles({ runtime }: Pick<PreviewProps, "runtime">) {
  const { state, can, send } = useRecent(runtime);
  if (!state || state.rows.length === 0) return null;
  return (
    <div role="group" aria-labelledby="files-recent">
      <h2 id="files-recent" className="mx-2 mt-3.5 mb-1 text-meta font-semibold text-muted-foreground">Recent</h2>
      {state.rows.map((row) => {
        const reopen = { type: "reopen", row } as const;
        const remembered = row.origin === "Picked" ? runtime.runSync(Effect.flatMap(Opened, (opened) => opened.nameAt(row.key))) : undefined;
        const name = nameOf(runtime, row.grant) ?? remembered ?? Option.getOrElse(runtime.runSync(Effect.flatMap(Handles, (handles) => handles.label(row.key))), () => "A file to select again");
        const reselect = { type: "openPicker", replacing: row.key } as const;
        const action = row.grant === 0 ? reselect : reopen;
        return <FilesRow key={`${row.origin} ${row.key}`} size="place" name={name} aria-label={row.grant === 0 ? `Select again: ${name}` : name} icon={<FileText />} detail={row.grant === 0 ? "Select it again to open it" : undefined} disabled={!can(action, "Owner")} onClick={() => void send(action, "Owner")} />;
      })}
    </div>
  );
}
