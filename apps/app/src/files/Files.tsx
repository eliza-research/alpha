// spec/app/files/index.md, "Story: Browse my storage"; spec/app/files/index.md, "Story: Arrange and filter what I see"; spec/app/files/index.md, "Story: Change my files"; spec/app/files/index.md, "Folders come before files in every sort: by name in the phone's order of names, by date the newest first, by size the largest first; choosing the sort again turns the order within the folders and within the files"; spec/app/files/index.md, "The owner sees a listed item's details: what it is, how big it is, when it last changed and where it is; they close when the owner closes them or moves, or when the item is no longer listed"
import { Alert, AppHeader, Button, Checkbox, Chip, cn, Dialog, DialogContent, DialogTitle, dockClearance, EmptyState, FilesCard, filesCardCancel, FilesRow, FilesSelectionBar, focusRing, Input, ListGroup, ListRow, Menu, MenuContent, MenuItem, MenuTrigger, Progress, SearchField, Sheet, SheetContent, Spinner } from "@repo/ui";
import { Effect, Option, type Layer, type ManagedRuntime } from "effect";
import { ArrowDown, ArrowUp, AudioLines, Calendar, Check, ChevronLeft, Copy, Download, Ellipsis, File, FileArchive, FileText, Folder, FolderInput, HardDrive, Image, Info, LayoutGrid, Menu as Rows, Pencil, Plus, RefreshCw, Search, Share2, Trash2, Type, Video, X, type LucideIcon } from "lucide-react";
import { Fragment, useCallback, useMemo, useState } from "react";
import type { Event as FilesEvent, Files as FilesState, Machine, Order } from "../../gen/app__files.effect.vibe";
import { ahead, backLayer, browse, chosen, detailed, grouped, empty, filled } from "../../gen/app__files.ts";
import { useMachine } from "../../gen/app__files.react.ts";
import type { Dest, Work } from "../../gen/app__files__change.ts";
import { finding } from "../../gen/app__files__search.ts";
import { type Filter, everything } from "../../gen/app__files__search.ts";
import type { Item, Kind } from "../../gen/app__files__shared.ts";
import type { Machine as TrashMachine } from "../../gen/app__files__trash.effect.vibe";
import type { Alpha, Resident } from "../runtime/ui.tsx";
import { AppBack } from "../shell/ui.tsx";
import { launcherFirstHeader, launcherInnerHeader, launcherTop } from "../shell/ui.tsx";
import { Time } from "../runtime/index.vibe";
import { Handles } from "./handles.vibe";
import { changedOn, folderLocation, itemCount, parentPath, sized, validFileName } from "./entries.vibe";
import { CategoryGroups } from "./category.vibe";
import type { Machine as PreviewMachine } from "../../gen/app__files__preview.effect.vibe";
import type { Machine as RecentMachine } from "../../gen/app__files__recent.effect.vibe";
import type { Machine as Shell } from "../../gen/app__shell.effect.vibe";
import { useMachine as useRecent } from "../../gen/app__files__recent.react.ts";
import { useMachine as useScan } from "../../gen/app__files__scan.react.ts";
import { useMachine as usePreview } from "../../gen/app__files__preview.react.ts";
import { showing as showingPreview } from "../../gen/app__files__preview.ts";
import type { Opened } from "./preview.vibe";
import { Preview, RecentFiles } from "./Preview.tsx";
import { Trash, Undo } from "./Trash.tsx";
import type { TrashFacts } from "./trashFacts.vibe";
import { Scan } from "./Scan.tsx";
import { fileRowHeld, selectListedFile } from "./files.vibe";
import { type scan, startScan } from "./scan.vibe";

export interface FilesProps {
  /** Provides Files and its Trash, `files` of files.vibe, the numbers of the phone's storage and Alpha's time. */
  alpha: Alpha;
  runtime: ManagedRuntime.ManagedRuntime<Machine | TrashMachine | TrashFacts | PreviewMachine | RecentMachine | Opened | Handles | CategoryGroups | Time | Shell | Layer.Success<typeof scan> | Resident, unknown>;
}

const categories: readonly [Kind, string][] = [["Download", "Downloads"], ["Image", "Images"], ["Video", "Videos"], ["Audio", "Audio"], ["Document", "Documents"]];
const icons: Record<Kind, LucideIcon> = { Folder, Download, Image, Video, Audio: AudioLines, Document: FileText, Pdf: FileText, Other: File };
/** Develop's sort rows: each order both ways, named by what comes first. */
const sorts: readonly [Order, boolean, string, LucideIcon][] = [
  ["ByName", false, "Name A–Z", Type], ["ByName", true, "Name Z–A", Type], ["ByDate", false, "Newest first", Calendar],
  ["ByDate", true, "Oldest first", Calendar], ["BySize", false, "Largest first", HardDrive], ["BySize", true, "Smallest first", HardDrive],
];
/** Develop's Files options: a 220px panel under the header, ringed, with 44px action rows and 48px sort rows. */
const optionsPanel = "w-55 min-w-0 rounded-tile p-1.5 ring-1 ring-border shadow-popup dark:shadow-popup-dark";
const optionRow = "rounded-none px-3.5 py-2";
const sortRow = "min-h-12 rounded-lg px-3 [&_svg]:shrink-0";
/** Develop's browse tools: a text-only dropdown as wide as its words. */
const topRow = "rounded-none";
const shares: readonly [Dest, string][] = [["Chooser", "Share to an app"], ["Email", "Email"], ["Copy", "Copy"]];
const kinds: readonly [Kind | undefined, string][] = [[undefined, "Any kind"], ["Image", "Images"], ["Video", "Videos"], ["Audio", "Audio"], ["Document", "Documents"], ["Pdf", "PDFs"]];
const kindNames: Record<Kind, string> = { Folder: "Folder", Image: "Image", Video: "Video", Audio: "Audio", Document: "Document", Pdf: "PDF", Download: "Download", Other: "File" };
/** A name no folder holds, since it is a path's separator: what asks whether a new name would be taken at all. */
const unnamed = "/";
/** The kind a downloaded or unknown file shows by its name's extension, as develop names and draws it. */
const byExtension: readonly [RegExp, string, LucideIcon][] = [
  [/\.pdf$/i, "PDF", FileText], [/\.(jpe?g|png|gif|webp|heic)$/i, "Image", Image], [/\.(mp4|mov|webm|mkv)$/i, "Video", Video],
  [/\.(mp3|m4a|wav|ogg|aac)$/i, "Audio", AudioLines], [/\.(zip|rar|7z|tar|gz)$/i, "Archive", FileArchive], [/\.(txt|md|docx?|rtf|odt)$/i, "Document", FileText],
];
/** What a listed file is and the icon it shows: "PDF" for a PDF, else its kind. */
function kindOf(item: Item): { name: string; icon: LucideIcon } {
  const found = byExtension.find(([pattern]) => pattern.test(item.name));
  if (found && (item.kind === "Download" || item.kind === "Other" || found[1] === "PDF")) return { name: found[1], icon: found[2] };
  return { name: kindNames[item.kind], icon: icons[item.kind] };
}
/** Develop's empty folder: a large muted icon over one line, well below the header. */
const filesEmpty = "gap-3 px-4 pt-24 pb-4 [&_svg]:size-11";
const changedFully = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
/** What develop's details call an item's type: by its extension where one names it, else by its kind. */
const types: readonly [RegExp, string][] = [
  [/\.pdf$/i, "PDF"], [/\.(jpe?g|png|gif|webp|heic)$/i, "Image"], [/\.(mp4|mov|webm|mkv)$/i, "Video"], [/\.(mp3|m4a|wav|ogg|aac)$/i, "Audio"], [/\.(txt|md|csv|log)$/i, "Text"],
];
function typeOf(item: Item): string {
  if (item.kind === "Folder") return "Folder";
  return types.find(([pattern]) => pattern.test(item.name))?.[1] ?? (item.kind === "Download" ? "File" : kindNames[item.kind]);
}
function dateRange(filter: Filter): string {
  const date = (value: number) => new Date(value).toLocaleDateString();
  if (filter.from === everything.from) return filter.to === everything.to ? "" : `Through ${date(filter.to)}`;
  return filter.to === everything.to ? `Since ${date(filter.from)}` : `${date(filter.from)} – ${date(filter.to)}`;
}
type Naming =
  | { readonly work: Work; readonly name: string; readonly place: string; readonly destinationRead?: never }
  | { readonly work: "NewFolder"; readonly name: string; readonly place?: never; readonly destinationRead: number };
const changeWords: Record<Work, string> = { NewFolder: "make the folder", Rename: "rename it", MoveTo: "move them", CopyTo: "copy them" };

/** The name the phone's storage gives a number: its volume's name at a volume's root, else the last step of its path. */
function labelOf(runtime: FilesProps["runtime"], handle: number): string {
  return Option.getOrElse(runtime.runSync(Effect.flatMap(Handles, (handles) => handles.label(handle))), () => "…");
}

/**
 * Files: the top with its volumes and categories, a folder with its path, what it lists and the filter, a selection
 * and one change, each control offered exactly when the rules take it from the owner.
 * @model spec/app/files/index.md
 */
export function Files({ runtime, alpha }: FilesProps) {
  const { state, cause, can, send } = useMachine(runtime);
  const recent = useRecent(runtime);
  const scan = useScan(runtime);
  const previewing = usePreview(runtime).state;
  const [text, setText] = useState("");
  const [naming, setNaming] = useState<Naming | undefined>(undefined);
  const [kind, setKind] = useState<Kind | undefined>(undefined);
  const [filtering, setFiltering] = useState(false);
  const hold = useCallback((held: () => void) => {
    const fiber = runtime.runFork(fileRowHeld(held));
    return () => fiber.interruptUnsafe();
  }, [runtime]);
  const [choosingAt, setChoosingAt] = useState<string | undefined>(undefined);
  const [destination, setDestination] = useState<"move" | "copy">("move");
  const items = state?.items;
  const order = state?.order;
  const reversed = state?.reversed;
  const sorted = useMemo(() => {
    if (!items || order === undefined || reversed === undefined) return [];
    return items.toSorted((a, b) => (ahead(order, reversed, a, b) ? -1 : ahead(order, reversed, b, a) ? 1 : 0));
  }, [items, order, reversed]);
  const marked = state?.picked;
  const marks = useMemo(() => new Set(marked), [marked]);
  const back = <AppBack alpha={alpha} />;
  const firstBack = <AppBack alpha={alpha} firstPage />;
  const scanner = <Scan runtime={runtime} alpha={alpha} />;
  const frame = cn("relative flex min-h-0 flex-1 flex-col", launcherTop);
  const header = (title: string) => <AppHeader title={title} className={launcherFirstHeader} leading={firstBack} />;
  if (cause) return <div className={frame}>{header("Files")}<Alert variant="destructive" className="m-4">Alpha could not open Files</Alert></div>;
  if (!state) return <section aria-label="Files" aria-busy className={frame}>{header("Files")}</section>;
  const owner = <E extends Parameters<typeof can>[0]>(event: E) => can(event, "Owner");
  const tell = <E extends Parameters<typeof send>[0]>(event: E) => void send(event, "Owner");
  const shown = browse(state);
  const label = (handle: number) => labelOf(runtime, handle);
  if (shown === "Closed") return <section aria-label="Files" className={frame}>{header("Files")}</section>;
  if (shown === "Unsupported") return <div className={frame}>{header("Files")}<StorageStatus title="Storage unavailable" />{scanner}</div>;
  if (shown === "NotAsked" || shown === "NoAccess") {
    const allow = owner({ type: "allow" }) ? () => tell({ type: "allow" }) : undefined;
    return <div className={frame}>{header("Files")}<StorageStatus title="Allow all files access" text="Files shows your files and folders after you allow access." action={shown === "NotAsked" ? "Allow" : "Open Settings"} onAction={allow} />{scanner}</div>;
  }
  if (state.trash) return <><Trash runtime={runtime} onBack={owner({ type: "closeTrash" }) ? () => tell({ type: "closeTrash" }) : undefined} />{scanner}</>;
  const atTop = shown === "AtTop";
  const looked = finding(state.search);
  const picked = chosen(state);
  const [firstPicked] = picked;
  const here = `${state.inCategory ? state.category : ""}/${state.trail.join("/")}`;
  const choosing = choosingAt === here;
  const selecting = marks.size > 0 || choosing;
  const grid = state.layout === "Grid";
  const category = categories.find(([kind]) => kind === state.category)?.[1];
  const groupedCategory = grouped(state);
  const folderGroups = groupedCategory
    ? runtime.runSync(Effect.flatMap(CategoryGroups, (groups) => groups.read(state.listing.ticket)))
    : [];
  const CategoryIcon = icons[state.category];
  const primary = state.volumes[0];
  const place = state.inCategory ? category : state.trail.length === 1 && state.trail[0] === primary?.id ? "All files" : label(state.trail.at(-1) ?? 0);
  const title = selecting ? `${marks.size} selected` : atTop ? "Files" : (place ?? "Files");
  const wanted: Filter = { ...everything, text: text.trim(), kind: kind ?? "Other", anyKind: kind === undefined };
  const today = new Date(runtime.runSync(Effect.flatMap(Time, (time) => time.latest())));
  const parentOf = (item: Item) => {
    const spot = runtime.runSync(Effect.flatMap(Handles, (handles) => handles.spot(item.id)));
    return Option.map(spot, ({ path }) => parentPath(path));
  };
  const location = (item: Item) => {
    const folder = Option.getOrElse(parentOf(item), () => "");
    return folderLocation(label(item.volume), folder);
  };
  const summary = (item: Item, showFolder: boolean) => {
    if (item.kind === "Folder") return itemCount(item.children);
    const folder = showFolder ? Option.map(parentOf(item), (path) => path || label(item.volume)) : Option.none();
    return [sized(item.bytes), changedOn(item.revision, today), Option.getOrUndefined(folder)].filter(Boolean).join(" · ");
  };
  const row = (item: Item) => {
    const toggle = { type: "toggle", target: item.id } as const;
    const open = item.kind === "Folder" ? ({ type: "openFolder", target: item.id } as const) : ({ type: "view", file: item } as const);
    const selectable = owner(toggle);
    const selected = marks.has(item.id);
    const { icon: Icon, name: kind } = kindOf(item);
    const detail = summary(item, state.inCategory && state.category !== "Download");
    const action = selecting ? toggle : open;
    const onClick = owner(action) ? () => tell(action) : undefined;
    return (
      <div key={item.id} className={cn("group relative min-w-0", !grid && "[contain-intrinsic-size:auto_4rem] [content-visibility:auto] focus-within:[content-visibility:visible]")}>
        <FilesRow
          layout={grid ? "tile" : "row"}
          aria-label={item.name}
          aria-description={[kind, detail].filter(Boolean).join(" · ")}
          name={item.name}
          detail={detail}
          icon={<Icon />}
          chosen={selecting ? selected : undefined}
          disabled={!onClick}
          onClick={onClick}
          hold={hold}
          onHold={selectable ? () => void runtime.runPromise(selectListedFile(item.id)) : undefined}
        />
        {selectable && !selecting && <Checkbox aria-label={`Select ${item.name}`} checked={false} className={`pointer-events-none absolute right-3 min-h-6 min-w-6 rounded-full opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 ${grid ? "top-3" : "top-1/2 -translate-y-1/2"}`} onCheckedChange={() => tell(toggle)} />}
      </div>
    );
  };
  const { change } = state;
  const ended = change.attempt.outcome;
  const placeKey = state.inCategory ? `cat:${state.category}` : state.trail.join(",");
  const activeNaming = naming === undefined ? undefined
    : naming.destinationRead !== undefined ? (state.sheet.open ? naming : undefined)
    : naming.place === placeKey || (atTop && primary !== undefined && naming.place === String(primary.id)) ? naming
    : undefined;
  const changeLayout = { type: "showAs", layout: grid ? "Rows" : "Grid" } as const;
  const showFilter = owner({ type: "searchFor", wanted });
  const refresh = owner({ type: "refresh" });
  const rootFolder = atTop && primary ? { type: "openVolume", target: primary.id } as const : undefined;
  const makeFolder = rootFolder ? owner(rootFolder) : owner({ type: "begin", work: "NewFolder", name: unnamed });
  const newFolder = () => {
    if (rootFolder) tell(rootFolder);
    setNaming({ work: "NewFolder", name: "", place: rootFolder ? String(primary.id) : placeKey });
  };
  const pickFile = { type: "openPicker", replacing: 0 } as const;
  const canPick = atTop && recent.can(pickFile, "Owner");
  const canScan = atTop && scan.can({ type: "start" }, "Owner");
  const showStorage = backLayer(state) !== "TopLayer" && owner({ type: "openTop" });
  const showTools = showFilter || refresh || makeFolder || owner(changeLayout) || canPick || canScan || showStorage;
  const [firstListed] = sorted;
  const canChoose = !groupedCategory && firstListed !== undefined && owner({ type: "toggle", target: firstListed.id });
  const sortTo = (order: Order, reversed: boolean) => {
    if (state.order === order && state.reversed === reversed) return;
    tell({ type: "sortBy", order });
    if (state.order !== order && reversed) tell({ type: "sortBy", order });
  };
  const endChoosing = () => {
    setChoosingAt(undefined);
    if (marks.size > 0 && owner({ type: "cancelSelection" })) tell({ type: "cancelSelection" });
  };
  const selectionActions = actionsOf({ owner, tell, chosenCount: marks.size, setDestination, rename: () => setNaming({ work: "Rename", name: firstPicked?.name ?? "", place: placeKey }) });
  const canDetails = firstPicked !== undefined && picked.length === 1 && owner({ type: "showDetails", target: firstPicked.id });
  return (
    <section aria-label="Files" className={frame}>
      <div key={atTop ? "top" : "folder"} inert={previewing !== undefined && showingPreview(previewing)} className={cn("flex min-h-0 flex-1 flex-col", !atTop && "motion-safe:animate-rise")}>
        <AppHeader title={title} detail={selecting || !atTop} className={cn(selecting || !atTop ? cn("[&>h1]:ms-1.5 in-data-[alpha-title-row]:[&>h1]:ms-0", launcherInnerHeader) : launcherFirstHeader, selecting && "[&>h1]:font-display [&>h1]:text-2xl [&>h1]:font-light")} leading={selecting && (choosing || owner({ type: "cancelSelection" })) ? <Button variant="ghost" size="icon" aria-label="Cancel" onClick={endChoosing}><X /></Button> : atTop ? firstBack : back}>
          {selecting && canDetails && <Button variant="ghost" size="icon" aria-label="Details" onClick={() => tell({ type: "showDetails", target: firstPicked.id })}><Info /></Button>}
          {selecting && owner({ type: "selectAll" }) && <Button variant="ghost" className="h-11 px-3" onClick={() => tell({ type: "selectAll" })}>Select all</Button>}
          {!selecting && showTools && (
            <Menu>
              <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label={atTop ? "Files tools" : "Files options"} className={atTop ? "size-11! min-w-11!" : undefined}><Ellipsis /></Button></MenuTrigger>
              <MenuContent {...(atTop ? { className: "w-max min-w-0" } : { sideOffset: 44, alignOffset: 4, className: optionsPanel })}>
                {canScan && <MenuItem className={topRow} onSelect={() => void runtime.runPromise(startScan())}>Scan document</MenuItem>}
                {canPick && <MenuItem className={topRow} onSelect={() => void recent.send(pickFile, "Owner")}>Open and remember a file</MenuItem>}
                {makeFolder && <MenuItem className={atTop ? topRow : optionRow} onSelect={newFolder}>{!atTop && <Plus />}New folder</MenuItem>}
                {!atTop && owner(changeLayout) && <MenuItem className={optionRow} onSelect={() => tell(changeLayout)}>{grid ? <Rows /> : <LayoutGrid />}{grid ? "List view" : "Grid view"}</MenuItem>}
                {!atTop && sorts.map(([order, reversed, name, Icon]) => owner({ type: "sortBy", order }) && (
                  <MenuItem key={name} aria-checked={state.order === order && state.reversed === reversed} className={sortRow} onSelect={() => sortTo(order, reversed)}>
                    <Icon className="size-5" />{reversed ? <ArrowUp className="-ml-2.25 size-3" /> : <ArrowDown className="-ml-2.25 size-3" />}
                    <span className="min-w-0 flex-1">{name}</span>
                    {state.order === order && state.reversed === reversed && <Check className="size-4.5 text-alpha" />}
                  </MenuItem>
                ))}
                {!atTop && canChoose && <MenuItem className={sortRow} onSelect={() => setChoosingAt(here)}><Check className="size-5" /><span className="min-w-0 flex-1">Select</span></MenuItem>}
                {showFilter && <MenuItem className={atTop ? topRow : optionRow} onSelect={() => { setText(state.search.filter.text); setKind(state.search.filter.anyKind ? undefined : state.search.filter.kind); setFiltering(true); }}>{!atTop && <Search />}Filter files</MenuItem>}
                {refresh && <MenuItem className={atTop ? topRow : optionRow} onSelect={() => tell({ type: "refresh" })}>{!atTop && <RefreshCw />}Refresh</MenuItem>}
                {showStorage && <MenuItem className={optionRow} onSelect={() => tell({ type: "openTop" })}><HardDrive />Browse storage</MenuItem>}
              </MenuContent>
            </Menu>
          )}
        </AppHeader>
        {!atTop && !state.inCategory && (
          <nav aria-label="Folder path" className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-4.5 pb-1.5 text-meta whitespace-nowrap text-muted-foreground">
            {state.trail.map((handle, at) => {
              const crumb = { type: "openCrumb", depth: at + 1 } as const;
              return at < state.trail.length - 1
                ? <Fragment key={handle}><button type="button" className={cn("min-h-11 rounded-sm px-1", focusRing)} disabled={!owner(crumb)} onClick={() => tell(crumb)}>{label(handle)}</button><span aria-hidden className="px-0.5">›</span></Fragment>
                : <span key={handle} aria-current="location" className="text-foreground">{label(handle)}</span>;
            })}
          </nav>
        )}
        {filtering && showFilter && (
          <form className="flex shrink-0 flex-col gap-2 px-4 pb-2" onSubmit={(event) => { event.preventDefault(); tell({ type: "searchFor", wanted }); }}>
            <div className="flex gap-2">
              <SearchField aria-label="Filter" value={text} onValueChange={setText} className="flex-1" />
              <Button type="submit" variant="outline">Filter</Button>
              <Button type="button" variant="ghost" size="icon" aria-label="Close filter controls" onClick={() => setFiltering(false)}><X /></Button>
            </div>
            <div role="group" aria-label="Kind" className="flex flex-wrap gap-1">
              {kinds.map(([one, name]) => <Chip key={name} pressed={kind === one} onPressedChange={() => setKind(one)}>{name}</Chip>)}
            </div>
          </form>
        )}
        <div className={cn("min-h-0 flex-1 touch-pan-y overflow-y-auto px-2", selecting ? "pb-[calc(--spacing(24)+max(var(--alpha-dock-overlap,5.75rem),var(--alpha-safe-bottom,0px)))]" : dockClearance)}>
          <div className="mb-2 flex flex-col gap-2 empty:hidden">
            {state.missing && <Alert variant="warn">That folder is no longer there</Alert>}
            {(ended === "Refused" || ended === "Unknown") && <Alert variant="warn">{ended === "Unknown" ? `Alpha cannot tell whether the phone could ${changeWords[change.work]}` : `The phone could not ${changeWords[change.work]}`}</Alert>}
            {change.sending.outcome === "Refused" && <Alert variant="warn">Android could not open sharing</Alert>}
            {change.stale && <Alert variant="info">The selection changed, so nothing was shared</Alert>}
          </div>
          {looked !== "NoFilter" && (
            <div className="flex flex-col gap-2">
              <div className="px-2"><Chip onClear={owner({ type: "clearFilter" }) ? () => { tell({ type: "clearFilter" }); setText(""); setKind(undefined); } : undefined} clearLabel="Clear the filter" className="h-9 max-w-full gap-1.5 pr-1 pl-3.5 text-sm font-semibold">
                {[state.search.filter.text === "" ? "" : `“${state.search.filter.text}”`, state.search.filter.anyKind ? "" : kinds.find(([one]) => one === state.search.filter.kind)?.[1] ?? "", dateRange(state.search.filter), looked === "Found" ? `${state.search.hits.length}${state.search.complete ? "" : "+"}` : ""].filter(Boolean).join(" · ") || "Everything"}
              </Chip></div>
              {looked === "Looking" && <p role="status" className="px-6 py-2 text-sm text-muted-foreground">Searching…</p>}
              {looked === "Nothing" && <EmptyState icon={<Search className="size-10" />} title="No files match." className={filesEmpty} />}
              {looked === "Trouble" && <Alert variant="warn">The search could not finish</Alert>}
              {looked === "Unfinished" && <Alert variant="info">Nothing found in what the phone could search</Alert>}
              {looked === "Found" && !state.search.complete && <Alert variant="info">Only part of this place could be searched</Alert>}
              {looked === "Found" && (
                <div role="group" aria-label="Found">
                  {state.search.hits.map((hit) => {
                    const { icon: Icon, name: kind } = kindOf(hit);
                    const detail = summary(hit, true);
                    return <FilesRow key={hit.id} aria-label={hit.name} aria-description={[kind, detail].filter(Boolean).join(" · ")} name={hit.name} icon={<Icon />} detail={detail} disabled={!owner({ type: "view", file: hit })} onClick={() => tell({ type: "view", file: hit })} />;
                  })}
                </div>
              )}
            </div>
          )}
          {looked === "NoFilter" && (atTop ? (
            <>
              <FilesHome state={state} label={label} owner={owner} tell={tell} refresh={refresh} />
              <RecentFiles runtime={runtime} />
            </>
          ) : (
            <>
              {shown === "Reading" && (state.items.length === 0 || groupedCategory) && <p role="status" className="mx-2 my-2 text-sm text-muted-foreground">Loading…</p>}
              {shown === "Unreachable" && <Alert variant="destructive">This place cannot be read now</Alert>}
              {empty(state) && folderGroups.length === 0 && <EmptyState icon={state.inCategory ? <CategoryIcon className="size-11" /> : <Folder className="size-11" />} title={state.inCategory ? `No ${category?.toLowerCase() ?? "files"}` : "This folder is empty"} className={filesEmpty} />}
              {shown === "Showing" && state.partial && <Alert variant="info">Only part of this place could be read</Alert>}
              {groupedCategory && folderGroups.length > 0 && (
                <div role="group" aria-label="Folders" className={grid ? "grid grid-cols-3 gap-2" : undefined}>
                  {folderGroups.map((group) => {
                    const open = { type: "openCategoryGroup", groupTrail: [...group.trail], ticket: state.listing.ticket } satisfies FilesEvent;
                    return <FilesRow key={group.folder} layout={grid ? "tile" : "row"} name={group.name} detail={group.folder || "Internal storage"} count={String(group.count)} icon={<CategoryIcon />} aria-label={`Open ${group.name}`} disabled={!owner(open)} onClick={() => tell(open)} />;
                  })}
                </div>
              )}
              {!groupedCategory && sorted.length > 0 && <div role="group" aria-label="Listed" className={grid ? "grid grid-cols-3 gap-2" : undefined}>{sorted.map(row)}</div>}
            </>
          ))}
        </div>
        <Undo runtime={runtime} />
        {selecting && (
          <FilesSelectionBar actions={selectionActions} />
        )}
      </div>
      <FileLayers state={state} destination={destination} onMoved={() => setDestination("move")} picked={picked} naming={activeNaming} setNaming={setNaming} owner={owner} tell={tell} label={label} location={location} />
      <Preview runtime={runtime} today={today} />
      {scanner}
    </section>
  );
}


/** Develop's selection bar: Share, Move, Copy, Rename for one item, Delete; each shown while the rules take it, and dimmed while nothing is chosen. */
function actionsOf({ owner, tell, chosenCount, setDestination, rename }: {
  readonly owner: (event: FilesEvent) => boolean;
  readonly tell: (event: FilesEvent) => void;
  readonly chosenCount: number;
  readonly setDestination: (op: "move" | "copy") => void;
  readonly rename: () => void;
}) {
  const moveOrCopy = (op: "move" | "copy") => owner({ type: "openMoveTo" }) ? () => { setDestination(op); tell({ type: "openMoveTo" }); } : undefined;
  return [
    { label: "Share", icon: <Share2 />, onPress: owner({ type: "openShare", mail: false }) ? () => tell({ type: "openShare", mail: false }) : undefined },
    { label: "Move", icon: <FolderInput />, onPress: moveOrCopy("move") },
    { label: "Copy", icon: <Copy />, onPress: moveOrCopy("copy") },
    { label: "Rename", icon: <Pencil />, onPress: owner({ type: "begin", work: "Rename", name: unnamed }) ? rename : undefined },
    { label: "Delete", icon: <Trash2 />, onPress: owner({ type: "askToDelete" }) ? () => tell({ type: "askToDelete" }) : undefined },
  ].filter((action) => action.onPress !== undefined || (chosenCount === 0 && action.label !== "Rename"));
}

/** Develop's storage notice at the top of Files: a filled card that says why nothing is listed, with its one way forward. */
function StorageStatus({ title, text, action, onAction }: { readonly title: string; readonly text?: string; readonly action?: string; readonly onAction?: (() => void) | undefined }) {
  return (
    <div className="m-2 flex items-center gap-3 rounded-xl bg-secondary px-4 py-3.5 text-base">
      {text === undefined ? <div role="alert" className="min-w-0 flex-1">{title}</div> : <div className="min-w-0 flex-1"><strong className="font-semibold">{title}</strong><p className="mt-1 text-sm text-muted-foreground">{text}</p></div>}
      {onAction && action && <button type="button" className={cn(focusRing, "min-h-11 shrink-0 rounded-xl bg-alpha px-4 font-semibold text-alpha-foreground")} onClick={onAction}>{action}</button>}
    </div>
  );
}

function FilesHome({ state, label, owner, tell, refresh }: Pick<FileLayersProps, "state" | "label" | "owner" | "tell"> & { readonly refresh: boolean }) {
  const primary = state.volumes[0];
  return <>
    {state.storage.status === "Loading" && <p role="status" className="mx-4 my-2 text-sm text-muted-foreground">Loading…</p>}
    {state.storage.status === "Failed" && <Alert variant="destructive"><span>Your storage cannot be read now</span>{refresh && <Button variant="ghost" size="sm" onClick={() => tell({ type: "refresh" })}>Retry</Button>}</Alert>}
    {(state.storage.status === "Loaded" || state.volumes.length > 0) && (
      <>
        <div role="group" aria-label="Categories">
          {primary && owner({ type: "openVolume", target: primary.id }) && <FilesRow size="place" aria-label="All files" name="All files" icon={<Folder />} onClick={() => tell({ type: "openVolume", target: primary.id })} />}
          {categories.map(([kind, name]) => {
            const counted = state.tally.counts.find((count) => count.kind === kind);
            const Icon = icons[kind];
            return <FilesRow key={kind} size="place" aria-label={name} aria-description={counted && `${counted.items} · ${sized(counted.bytes)}`} name={name} icon={<Icon />} count={counted === undefined ? undefined : String(counted.items)} disabled={!owner({ type: "openCategory", kind })} onClick={() => tell({ type: "openCategory", kind })} />;
          })}
        </div>
        <h2 className="mx-2 mt-3.5 mb-1 text-caption font-semibold text-muted-foreground">Storage</h2>
        {state.volumes.map((volume) => {
          const name = label(volume.id);
          return (
            <FilesRow
              key={volume.id}
              size="place"
              aria-label={name}
              name={name}
              icon={<HardDrive />}
              detail={volume.total > 0 && <><span className="block">{`${sized(Math.max(0, volume.total - volume.used))} free of ${sized(volume.total)}`}</span><Progress className="mt-2 h-1.5" aria-label={`${name} used`} value={filled(volume.used, volume.total)} /></>}
              disabled={!owner({ type: "openVolume", target: volume.id })}
              onClick={() => tell({ type: "openVolume", target: volume.id })}
            />
          );
        })}
        {owner({ type: "openTrash" }) && <FilesRow size="place" aria-label="Trash" name="Trash" icon={<Trash2 />} count={state.tally.trashed || undefined} onClick={() => tell({ type: "openTrash" })} />}
      </>
    )}
  </>;
}

type FileLayersProps = {
  readonly state: FilesState;
  /** Whether the destination sheet moves or copies, as the selection bar's Move or Copy opened it. */
  readonly destination: "move" | "copy";
  /** Called when the destination card closes, so the next one moves unless Copy opens it. */
  readonly onMoved: () => void;
  readonly picked: readonly Item[];
  readonly naming: Naming | undefined;
  readonly setNaming: (draft: Naming | undefined) => void;
  readonly owner: (event: FilesEvent) => boolean;
  readonly tell: (event: FilesEvent) => void;
  readonly label: (handle: number) => string;
  readonly location: (item: Item) => string;
};

function FileLayers({ state, destination, onMoved, picked, naming, setNaming, owner, tell, label, location }: FileLayersProps) {
  const [details] = detailed(state);
  const { change } = state;
  const namingEvent = naming === undefined ? undefined : naming.destinationRead === undefined
    ? { type: "begin", work: naming.work, name: naming.name.trim() } as const
    : { type: "beginDestinationFolder", destinationTicket: naming.destinationRead, name: naming.name.trim() } as const;
  const newDestination = { type: "beginDestinationFolder", destinationTicket: state.sheet.reading.ticket, name: unnamed } as const;
  const destinationFolderFailed = change.work === "NewFolder" && change.folder === state.sheet.trail.at(-1)
    && (change.attempt.outcome === "Refused" || change.attempt.outcome === "Unknown");
  const renamedFrom = naming?.work === "Rename" ? picked[0]?.name : undefined;
  const submitName = () => {
    if (namingEvent !== undefined && validFileName(namingEvent.name) !== undefined && owner(namingEvent)) { tell(namingEvent); setNaming(undefined); }
  };
  return (
    <>
      <FilesCard
        open={state.deleting.showing}
        onOpenChange={(open) => { if (!open && owner({ type: "keepFiles" })) tell({ type: "keepFiles" }); }}
        title={`Move ${picked.length === 1 ? `“${picked[0]?.name}”` : `${picked.length} items`} to the Trash?`}
        message={owner({ type: "confirmDelete" }) ? undefined : "What is selected changed"}
        cancelLabel={owner({ type: "keepFiles" }) ? "Cancel" : undefined}
        confirmLabel={owner({ type: "confirmDelete" }) ? "Delete" : undefined}
        onConfirm={() => tell({ type: "confirmDelete" })}
      />
      <FilesCard open={details !== undefined} onOpenChange={(open) => { if (!open && owner({ type: "closeDetails" })) tell({ type: "closeDetails" }); }} title={details?.name ?? ""}>
        {details !== undefined && (
          <dl aria-label="Details" className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2.5 text-base">
            <dt className="text-muted-foreground">Type</dt><dd className="wrap-anywhere">{typeOf(details)}</dd>
            {details.kind !== "Folder" && <><dt className="text-muted-foreground">Size</dt><dd className="wrap-anywhere">{details.bytes >= 1024 ? `${sized(details.bytes)} (${details.bytes.toLocaleString()} bytes)` : sized(details.bytes)}</dd></>}
            {details.revision > 0 && Number.isFinite(details.revision) && <><dt className="text-muted-foreground">Modified</dt><dd className="wrap-anywhere"><time dateTime={new Date(details.revision).toISOString()}>{changedFully.format(new Date(details.revision))}</time></dd></>}
            <dt className="text-muted-foreground">Location</dt><dd className="wrap-anywhere">{location(details)}</dd>
          </dl>
        )}
        <div className="mt-4.5 flex justify-end"><button type="button" className={filesCardCancel} onClick={() => { if (owner({ type: "closeDetails" })) tell({ type: "closeDetails" }); }}>Close</button></div>
      </FilesCard>
      <FilesCard
        open={naming !== undefined}
        onOpenChange={(open) => { if (!open) setNaming(undefined); }}
        title={naming?.work === "Rename" ? "Rename" : "New folder"}
        cancelLabel="Cancel"
        confirmLabel={naming?.work === "Rename" ? "Rename" : "Create"}
        confirmDisabled={namingEvent === undefined || validFileName(namingEvent.name) === undefined || !owner(namingEvent)}
        onConfirm={submitName}
      >
        <form onSubmit={(event) => { event.preventDefault(); submitName(); }}>
          <Input
            aria-label="Name"
            maxLength={255}
            value={naming?.name ?? ""}
            invalid={namingEvent !== undefined && namingEvent.name !== "" && namingEvent.name !== renamedFrom && (validFileName(namingEvent.name) === undefined || !owner(namingEvent))}
            onFocus={(event) => {
              const dot = naming?.work === "Rename" && picked[0]?.kind !== "Folder" ? event.target.value.lastIndexOf(".") : -1;
              event.target.setSelectionRange(0, dot > 0 ? dot : event.target.value.length);
            }}
            onChange={(event) => setNaming(naming && { ...naming, name: event.target.value })}
            className="rounded-md"
          />
        </form>
      </FilesCard>
      <Dialog open={change.clash.showing} onOpenChange={(open) => { if (!open && owner({ type: "goBack" })) tell({ type: "goBack" }); }}>
        <DialogContent>
          <DialogTitle>Some names are already there</DialogTitle>
          <div className="flex flex-col gap-2">
            {owner({ type: "keepBoth" }) && <Button onClick={() => tell({ type: "keepBoth" })}>Keep both</Button>}
            {owner({ type: "replaceThem" }) && <Button variant="destructive" onClick={() => tell({ type: "replaceThem" })}>Replace</Button>}
            {owner({ type: "goBack" }) && <Button variant="secondary" onClick={() => tell({ type: "goBack" })}>Back</Button>}
          </div>
        </DialogContent>
      </Dialog>
      <FilesCard
        open={state.sheet.open}
        onOpenChange={(open) => { if (!open && owner({ type: "closeMoveTo" })) { onMoved(); tell({ type: "closeMoveTo" }); } }}
        title={destination === "copy" ? "Copy to" : "Move to"}
        cancelLabel="Cancel"
        confirmLabel={destination === "copy" ? "Copy here" : "Move here"}
        confirmDisabled={!owner({ type: "begin", work: destination === "copy" ? "CopyTo" : "MoveTo", name: "" })}
        onConfirm={() => { onMoved(); tell({ type: "begin", work: destination === "copy" ? "CopyTo" : "MoveTo", name: "" }); }}
      >
        <nav aria-label="Destination path" className="flex min-h-10 items-center gap-1 text-meta text-muted-foreground">
          {state.sheet.trail.length > 0 && owner({ type: "moveUp", depth: state.sheet.trail.length - 1 }) && <Button variant="ghost" size="icon" aria-label="Parent folder" onClick={() => tell({ type: "moveUp", depth: state.sheet.trail.length - 1 })}><ChevronLeft /></Button>}
          <span aria-current="location" className="min-w-0 flex-1 wrap-anywhere">{state.sheet.trail.length === 0 ? "Storage" : state.sheet.trail.map(label).join(" › ")}</span>
          {owner(newDestination) && <button type="button" className={cn(filesCardCancel, "shrink-0 px-3 text-sm font-semibold text-foreground")} onClick={() => setNaming({ work: "NewFolder", name: "", destinationRead: newDestination.destinationTicket })}>New folder</button>}
        </nav>
        {destinationFolderFailed && <Alert variant="warn">{change.attempt.outcome === "Unknown" ? "Files could not confirm the new folder" : "The phone could not make the folder"}</Alert>}
        {state.sheet.reading.status === "Loading" && <Spinner label="Reading the folder" />}
        {state.sheet.reading.status === "Failed" && <Alert variant="warn">This folder cannot be read now</Alert>}
        <div role="group" aria-label="Folders">
          {(state.sheet.trail.length === 0 ? state.volumes.map((volume) => volume.id) : state.sheet.folders).map((target) => (
            <button key={target} type="button" aria-label={`Open ${label(target)}`} disabled={!owner({ type: "moveInto", target })} onClick={() => tell({ type: "moveInto", target })} className={cn(focusRing, "flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-left active:bg-accent disabled:opacity-40")}>
              <Folder className="size-5 shrink-0" /><span className="wrap-anywhere">{label(target)}</span>
            </button>
          ))}
        </div>
      </FilesCard>
      <Sheet open={change.panel !== 0} onOpenChange={(open) => { if (!open && owner({ type: "closeShare" })) tell({ type: "closeShare" }); }}>
        <SheetContent title="Share">
          <ListGroup surface="plain">
            {shares.map(([channel, name]) => owner({ type: "shareTo", channel }) && <ListRow key={channel} title={name} onClick={() => tell({ type: "shareTo", channel })} />)}
          </ListGroup>
        </SheetContent>
      </Sheet>
    </>
  );
}
