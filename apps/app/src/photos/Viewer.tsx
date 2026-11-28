import { ChevronLeft, ChevronRight, Crop, Ellipsis, FolderInput, Heart, Info, Mail, MessageCircle, Pause, Pencil, Play, RotateCw, Share2, Trash2, Undo2, X } from "lucide-react";
import { Effect, Exit, type ManagedRuntime } from "effect";
import { Fragment, useCallback, useId, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent, type ReactNode, type RefCallback } from "react";
import { Button, Mark, Menu, MenuContent, MenuItem, MenuTrigger, Sheet, SheetContent, Slider, cn, dockClearance, focusRing } from "@repo/ui";
import { useMachine } from "../../gen/app__photos__viewer.react.ts";
import { canPlay, cropUnits, maxZoom, panUnits, type Event, type Look, type Pan, type Viewer as ViewerState } from "../../gen/app__photos__viewer.ts";
import type { Machine } from "../../gen/app__photos__viewer.effect.vibe";
import { taken, type Row } from "./catalog.vibe";
import { OpenedPhoto, photoEmailAllowed, photoLook, photoMessageType, type MediaView } from "./viewer.vibe";
import { photoLooks } from "../platform/index.vibe";
import { ClipEditor } from "./ClipEditor.tsx";
import { CropFrame, CropHeader, editFrame, editHeader, editTool } from "./CropFrame.tsx";
import { trashDaysLabel, trashDaysLeft } from "./Grid.tsx";
import { headingOf } from "../runtime/ui.tsx";
import { Time } from "../runtime/index.vibe";
import { Device } from "../platform/index.vibe";
import { fadeIn } from "../shell/ui.tsx";
import { launcherInnerHeader, launcherTop } from "../shell/ui.tsx";

const filters: readonly Look[] = ["Original", "Vivid", "Warm", "Cool", "Mono", "Fade", "Noir"];
const messages = {
  NoRefusal: "", Animated: "This photo is animated.", TooLarge: "This item is too large to edit.", TooLong: "This video is too long to edit.",
  NoRoom: "There is not enough storage to edit this video.", NoEditor: "This item cannot be edited here.",
};
const formatDate = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
const formatTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const hiddenChrome = "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100";
/**
 * While an item is looked at, its header and its controls float over the media as v119's did (template.html:2120,2140
 * at 45f6bed30): the header under the launcher's status bar on a fade 150px deep, and the controls on a fade just above
 * Ask Alpha, so the media has the whole screen above Ask Alpha (phone.css:1092). The editor keeps them in its column.
 */
const viewerTop = "pointer-events-none absolute inset-x-0 top-0 z-10 bg-linear-to-b from-background/80 from-67% to-transparent pb-12.5";
/** The foot of the media and of its controls: v119's reserve above Ask Alpha, 108px or 6px over the dock (phone.css:475). */
const viewerReserve = "[--alpha-viewer-reserve:max(108px,calc(var(--alpha-dock-clearance,102px)+6px))] pb-(--alpha-viewer-reserve)";
const viewerFoot = "pointer-events-none absolute inset-x-0 bottom-(--alpha-viewer-reserve) z-10 flex flex-col";
const dragX = "--alpha-photo-drag-x";
const dragY = "--alpha-photo-drag-y";
const panStep = panUnits / 8;
/** Solid-black 1x1 PNG data URI preventing WebView's default play-icon video poster when a clip has no thumbnail. */
const blackVideoPoster = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

interface PanGesture {
  readonly image: HTMLImageElement;
  readonly photo: number;
  readonly room: Pan;
  readonly from: Pan;
  pending: Pan;
}

function boundedPan(value: number): number {
  return Math.min(panUnits, Math.max(-panUnits, Math.round(value)));
}

function clipTime(tenths: number): string {
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function infoSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let unit = 0;
  let value = bytes;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${unit === 0 || value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/**
 * v119's media frame (template.html:2105 `data-alpha-photo-frame`, phone.css:741 at 45f6bed30): the largest 3:4 frame
 * the media area holds, centred, so 412 by 549px on a 412px screen and letterboxed in landscape.
 */
const mediaFrame = "h-[min(133.333cqw,100cqh)] w-[min(100cqw,75cqh)]";
/** A photo whole inside that frame, which clips it when zoomed and is what it pans within. */
const stillFrame = "pointer-events-none absolute top-1/2 left-1/2 w-[min(100cqw,calc(100cqh*var(--alpha-photo-ratio)))] max-w-none object-contain";

function stillStyle(ratio: number, zoom: number, pan: Pan): CSSProperties & Record<"--alpha-photo-ratio", number> {
  return { "--alpha-photo-ratio": ratio, aspectRatio: ratio, transform: imageTransform(zoom, pan) };
}

function imageTransform(zoom: number, pan: Pan): string {
  const axis = (name: string, offset: number, container: string) =>
    `calc(-50% + max(0px, (${zoom * 100}% - ${container}) / 2) * var(${name}, ${offset / panUnits}))`;
  return `translate(${axis(dragX, pan.x, "100cqw")}, ${axis(dragY, pan.y, "100cqh")}) scale(${zoom})`;
}

interface Props {
  readonly runtime: ManagedRuntime.ManagedRuntime<Machine | OpenedPhoto | Time | Device, unknown>;
  readonly before?: number;
  readonly after?: number;
  readonly row?: Row;
  readonly inTrash: boolean;
  readonly albumNamesFor: (itemId: string) => readonly string[];
  readonly onBack: () => void;
  readonly backToCamera: boolean;
  readonly onAddToAlbum?: () => void;
  readonly onRecover?: () => void;
  readonly onDelete?: () => void;
}

/** The photo or video shown at full size, with its metadata, owner actions and preview. */
export function MediaViewer({ runtime, before, after, row, inTrash, albumNamesFor, onBack, backToCamera, onAddToAlbum, onRecover, onDelete }: Props) {
  const { state, can, send } = useMachine(runtime);
  const positionId = useId();
  const [startedClip, setStartedClip] = useState<{ readonly readTicket: number; readonly uri: string }>();
  const [decodedClip, setDecodedClip] = useState<{ readonly readTicket: number; readonly uri: string; readonly loaded: boolean }>();
  const [dismissedRefusal, setDismissedRefusal] = useState<string>();
  const videoRef = useRef<HTMLVideoElement>(null);
  const attachVideo = useCallback((element: HTMLVideoElement | null) => {
    if (element === null) return;
    videoRef.current = element;
    return () => { element.pause(); videoRef.current = null; };
  }, []);
  const isPlaying = state?.playing === true;
  const syncVideoPlaying = useCallback((node: HTMLDivElement | null) => {
    if (node && !isPlaying && videoRef.current && !videoRef.current.paused) videoRef.current.pause();
  }, [isPlaying]);
  const returnCropFocusRef = useRef(0);
  const infoButtonRef = useRef<HTMLButtonElement>(null);
  const openPhoto = state?.open;
  const previewShowing = Boolean(state?.editing && !state.unavailable && state.preview.showing);
  const cropButton = useCallback((button: HTMLButtonElement | null) => {
    if (button && previewShowing && returnCropFocusRef.current === openPhoto) {
      returnCropFocusRef.current = 0;
      button.focus({ preventScroll: true });
    } else if (!previewShowing && returnCropFocusRef.current !== 0) {
      returnCropFocusRef.current = 0;
    }
  }, [openPhoto, previewShowing]);
  const mediaShelf = runtime.runSync(Effect.flatMap(OpenedPhoto, (opened) => opened.mediaShelf()));
  const previewShelf = runtime.runSync(Effect.flatMap(OpenedPhoto, (opened) => opened.previewShelf()));
  const current = useSyncExternalStore(mediaShelf.subscribe, mediaShelf.snapshot, mediaShelf.snapshot);
  const preview = useSyncExternalStore(previewShelf.subscribe, previewShelf.snapshot, previewShelf.snapshot);
  if (!state || state.open === 0) return null;
  const clipReady = startedClip?.readTicket === state.read.ticket && startedClip.uri === current.uri;
  const decoding = decodedClip?.readTicket === state.read.ticket && decodedClip.uri === current.uri ? decodedClip : undefined;
  const clipEditor = state.kind === "Clip" && state.editing;
  const showing = state.visible && state.read.status === "Loaded" && current.photo === state.open && !state.gone;
  const loadedRow: Row | undefined = showing && current.item !== undefined ? { kind: "phone", item: current.item }
    : showing && current.browser !== undefined ? { kind: "browser", item: current.browser.item } : undefined;
  const showingRow = loadedRow ?? row;
  const item = showingRow?.item;
  const name = item?.name ?? (state.kind === "Clip" ? "Video" : "Photo");
  const timestamp = showingRow === undefined ? 0 : taken(showingRow);
  const now = runtime.runSync(Effect.flatMap(Time, (time) => time.latest()));
  const capturedAt = timestamp > 0 ? new Date(timestamp) : undefined;
  const date = capturedAt !== undefined && Number.isFinite(capturedAt.getTime()) ? capturedAt : undefined;
  const expiry = inTrash && showingRow?.kind === "phone" ? trashDaysLeft(showingRow.item.expiresAt, now) : undefined;
  const day = date === undefined ? name : headingOf(timestamp, now, true);
  const infoLabel = state.kind === "Clip" ? "Video info" : "Photo info";
  const info = state.info ? loadedRow?.item : undefined;
  const duration = info?.duration;
  const facts = info === undefined ? [] : [
    { label: "Date", value: date === undefined ? "" : `${formatDate.format(date)} ${formatTime.format(date)}` },
    { label: "File", value: info.name ?? "" },
    { label: "Size", value: infoSize(info.size || current.browser?.file.size || 0) },
    { label: "Dimensions", value: info.width > 0 && info.height > 0 ? `${info.width} × ${info.height}` : "" },
    { label: "Length", value: state.kind === "Clip" && duration !== undefined && duration > 0 && Number.isFinite(duration) ? clipTime(duration * 10) : "" },
    { label: "Folder", value: loadedRow?.kind === "phone" ? loadedRow.item.folder?.replace(/\/+$/u, "") ?? "" : "" },
    { label: "Albums", value: albumNamesFor(info.id).join(", ") },
  ].filter(({ value }) => value !== "");
  function action(event: Event) {
    if (can(event, "Owner")) void send(event, "Owner");
  }
  function editAction(event: Event) {
    videoRef.current?.pause();
    action(event);
  }
  const allows = (event: Event) => can(event, "Owner");
  function seek(position: number) {
    const event = { type: "seek", position } satisfies Event;
    if (!allows(event)) return;
    if (videoRef.current) videoRef.current.currentTime = position / 10;
    action(event);
  }
  const rewind = { type: "seek", position: clipEditor ? state.edit.start : 0 } satisfies Event;
  const replay = state.kind === "Clip" && (clipEditor ? decoding?.loaded === true : (clipReady || decoding?.loaded === true || state.position >= state.duration)) &&
    state.position >= (clipEditor ? state.edit.end : state.duration) && allows(rewind);
  function playClip(clip: HTMLVideoElement, position: number) {
    clip.currentTime = position / 10;
    const playing = clip.play();
    void send({ type: "play" }, "Owner");
    void playing.catch(() => { if (videoRef.current === clip && clip.getAttribute("src") === current.uri) void send({ type: "pause" }, "Owner"); });
  }
  function toggle() {
    const clip = videoRef.current;
    if (!clip || !state) return;
    if (allows({ type: "pause" })) {
      clip.pause();
      action({ type: "pause" });
    } else if (allows({ type: "play" })) {
      playClip(clip, state.position);
    } else if (replay) {
      void send(rewind, "Owner").then((rewound) => {
        if (Exit.isSuccess(rewound) && videoRef.current === clip && clip.getAttribute("src") === current.uri && canPlay(rewound.value.state, "Owner")) playClip(clip, rewind.position);
      });
    }
  }
  function played(ended = false) {
    const clip = videoRef.current;
    if (clip === null || !state?.playing) return;
    const end = state.editing ? state.edit.end : state.duration;
    const position = ended ? end : Math.min(end, Math.max(0, Math.round(clip.currentTime * 10)));
    if (position >= end) clip.pause();
    if ((position !== state.position || ended) && can({ type: "played", position }, "Phone")) void send({ type: "played", position }, "Phone");
    else if (ended && can({ type: "pause" }, "Owner")) void send({ type: "pause" }, "Owner");
  }
  const close = () => {
    videoRef.current?.pause();
    onBack();
  };
  const backLabel = clipEditor ? "Close video editor" : state.editing ? "Cancel edit" : backToCamera ? "Back to Camera" : "Back from photo";
  const crop = { type: state.kind === "Still" ? "beginCrop" : "crop" } satisfies Event;
  const stillCropped = state.kind === "Still" && (state.edit.bounds.width < cropUnits || state.edit.bounds.height < cropUnits);
  const cropActive = state.kind === "Still" ? stillCropped : state.edit.cropped;
  function openCrop() {
    if (state?.kind === "Still") returnCropFocusRef.current = state.open;
    action(crop);
  }
  const useInMessages = !inTrash && showing && allows({ type: "useInMessages" }) && photoMessageType(current.item) !== undefined
    && runtime.runSync(Effect.flatMap(Device, (device) => device.capabilities())).image;
  const photosMenu = [
    !inTrash && state.kind === "Still" && allows({ type: "askAlpha" }) && { label: "Ask Alpha", icon: <Mark aria-hidden className="size-5" />, select: () => action({ type: "askAlpha" }) },
    onAddToAlbum && { label: "Add to album", icon: <FolderInput />, select: onAddToAlbum },
    !inTrash && photoEmailAllowed(current.item) && allows({ type: "email" }) && { label: "Email", icon: <Mail />, select: () => action({ type: "email" }) },
    useInMessages && { label: "Use in Messages", icon: <MessageCircle />, select: () => action({ type: "useInMessages" }) },
    !inTrash && allows({ type: "share" }) && { label: "Share", icon: <Share2 />, select: () => action({ type: "share" }) },
    !inTrash && allows({ type: "trashOpen", neighbour: after ?? before ?? 0 }) && { label: "Delete", icon: <Trash2 />, select: () => action({ type: "trashOpen", neighbour: after ?? before ?? 0 }) },
    onRecover && { label: "Recover", icon: <Undo2 />, select: onRecover },
    onDelete && { label: "Delete this item forever", icon: <Trash2 />, select: onDelete },
  ].filter((item) => item !== undefined && item !== false);
  const control = (label: string, event: Event, icon: React.ReactNode) => allows(event) && (
    <Button variant="ghost" size="icon" aria-label={label} onClick={() => action(event)}>{icon}</Button>
  );
  const swatchSource = current.item?.image || current.browser?.item.thumbnail || current.uri;
  const chrome = state.chrome || state.editing || !showing;
  const canEditClip = decoding?.loaded === true && state.save.outcome !== "Sent";
  const editStatus = state.save.outcome === "Sent" ? "Saving video copy…" : decoding?.loaded === false ? "Couldn’t load"
    : decoding === undefined ? "Loading video…" : state.unavailable ? "Couldn’t prepare the preview" : state.save.outcome === "Refused" ? "Not saved" : undefined;
  const edited = preview !== undefined && preview.revision === state.preview.revision && state.editing && !state.unavailable ? preview : undefined;
  const refusalKey = `${state.open}:${state.preview.revision}:${state.refusal}`;
  const showRefusal = state.refusal !== "NoRefusal" && dismissedRefusal !== refusalKey;
  if (state.cropping) return (
    <div aria-label="Crop photo" data-alpha-subview="photos-crop"
      // eslint-disable-next-line better-tailwindcss/no-unknown-classes -- design.md, "Dark": the crop tools follow the photo editor's fixed dark theme
      className={cn("dark absolute inset-0 z-50 flex min-h-0 flex-col bg-background pt-[var(--alpha-safe-top)] text-foreground", dockClearance)}>
      {edited && edited.width > 0 && edited.height > 0 ? <CropFrame key={state.revision} source={edited} bounds={state.edit.bounds}
        onCancel={close} onApply={(bounds) => action({ type: "applyCrop", bounds })} /> : <>
        <CropHeader onCancel={close} />
        <div className="m-auto text-center" role="status">
          {state.unavailable ? <><p>Couldn’t prepare the photo.</p><Button variant="secondary" onClick={() => action({ type: "retryPreview" })}>Try again</Button></> : "Preparing photo…"}
        </div>
      </>}
    </div>
  );
  const playOverlay = showing && state.kind === "Clip" && !state.editing ? (
    <Button variant="ghost" size="icon" className={cn("absolute top-1/2 left-1/2 z-20 size-18 -translate-1/2 rounded-full bg-background/70 font-normal text-foreground hover:bg-background/80 motion-safe:transition-opacity", state.playing && !chrome && hiddenChrome)}
      disabled={!allows({ type: "pause" }) && !allows({ type: "play" }) && !replay} aria-label={state.playing ? "Pause video" : replay ? "Replay video" : "Play video"} onClick={toggle}>
      {state.playing ? <Pause className="size-7" /> : <Play className="size-7 fill-current" />}
    </Button>
  ) : undefined;
  const canSeekClip = state.duration > 0 && allows({ type: "seek", position: 0 });
  return (
    <div ref={syncVideoPlaying} role={clipEditor ? "dialog" : undefined} aria-modal={clipEditor || undefined} aria-label={clipEditor ? "Edit video" : name} data-alpha-subview={clipEditor ? "photos-clip-editor" : state.editing ? "photos-editor" : "photos-viewer"}
      // eslint-disable-next-line better-tailwindcss/no-unknown-classes -- design.md, "Dark": the photo viewer and its controls keep their dark tokens in either app theme
      className={cn("dark absolute inset-0 z-50 flex min-h-0 flex-col bg-background text-foreground", fadeIn, !clipEditor && (state.editing ? dockClearance : viewerReserve))}>
      <div className={state.editing ? "contents" : cn(viewerTop, launcherTop, !chrome && "opacity-0 focus-within:opacity-100")}>
      <header data-host-chrome="" className={cn("motion-safe:transition-opacity", clipEditor ? "flex shrink-0 items-center gap-2 bg-foreground/[0.066667] px-3 pt-3 pb-2" : state.editing ? editHeader : cn("pointer-events-auto flex min-h-13 shrink-0 items-center gap-0.5 px-2 in-data-[alpha-launcher]:gap-1.5", launcherInnerHeader), !chrome && hiddenChrome)}>
        <Button variant="ghost" size="icon" className={clipEditor ? "size-11" : state.editing ? undefined : "size-13 rounded-tile in-data-[alpha-launcher]:size-11"} aria-label={backLabel} onClick={close}>{state.editing && !clipEditor ? <X /> : <ChevronLeft />}</Button>
        {clipEditor ? <h1 className="flex-1 text-base font-normal">Edit video</h1> : state.editing ? <div className="flex-1"><h1 className="sr-only">Edit photo</h1></div> : <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold">{day}</h1>
          {expiry !== undefined ? <span className="block truncate text-caption text-muted-foreground">{trashDaysLabel(expiry)}</span>
            : date && <time className="block truncate text-caption text-muted-foreground" dateTime={date.toISOString()}>{formatTime.format(date)}</time>}
        </div>}
        {!state.editing && showing && photosMenu.length > 0 && <Menu>
          <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Photo actions"><Ellipsis /></Button></MenuTrigger>
          <MenuContent>{photosMenu.map(({ label, icon, select }) => <MenuItem key={label} onSelect={select}>{icon}{label}</MenuItem>)}</MenuContent>
        </Menu>}
        {state.editing && preview?.canReplace && <Button variant="secondary" size="sm" className={editTool} aria-pressed={state.replace} disabled={!allows({ type: "chooseReplace", replace: !state.replace })} onClick={() => action({ type: "chooseReplace", replace: !state.replace })}>Replace</Button>}
        {state.editing && <Button className={clipEditor ? "h-11 px-4 text-base font-normal disabled:opacity-100" : "px-4.5"} size="sm"
          aria-label={clipEditor ? "Save video copy" : undefined} disabled={(!canEditClip && clipEditor) || !allows({ type: "save" })}
          onClick={() => editAction({ type: "save" })}>{state.replace ? "Replace" : "Save copy"}</Button>}
        {control("Check saved copy", { type: "checkCopy" }, <Info />)}
      </header>
      </div>
      <MediaViewport state={state} current={current} name={name} showing={showing} editedImage={edited?.image}
        before={before} after={after} action={action} allows={allows} attachVideo={attachVideo} played={played}
        playOverlay={playOverlay}
        onPlaybackStarted={() => setStartedClip({ readTicket: state.read.ticket, uri: current.uri })}
        onDecode={(loaded) => setDecodedClip({ readTicket: state.read.ticket, uri: current.uri, loaded })} />
      {clipEditor && <ClipEditor duration={state.duration} edit={state.edit} position={state.position} playing={state.playing} status={editStatus}
        onPreview={canEditClip && (allows({ type: "play" }) || allows({ type: "pause" }) || replay) ? toggle : undefined}
        onTrim={canEditClip ? (start, end) => {
          const clip = videoRef.current;
          const event = { type: "trim", start, end } satisfies Event;
          if (!clip || !allows(event)) return;
          clip.pause();
          clip.currentTime = (start !== state.edit.start ? start : end) / 10;
          action(event);
        } : undefined}
        onRotate={canEditClip && allows({ type: "rotate" }) ? () => action({ type: "rotate" }) : undefined}
        onCrop={canEditClip && allows({ type: "crop" }) ? () => action({ type: "crop" }) : undefined}
        onRetry={allows({ type: "retryPreview" }) ? () => action({ type: "retryPreview" }) : undefined} />}
      <div className={state.editing ? "contents" : viewerFoot}>
      {showRefusal && <div role="status" className="flex shrink-0 items-center justify-center gap-2 bg-background/80 px-4 py-2 text-center text-sm">
        <span>{messages[state.refusal]}</span>
        <Button variant="ghost" size="sm" onClick={() => setDismissedRefusal(refusalKey)}>Dismiss</Button>
      </div>}
      {state.save.outcome === "Unknown" && <p role="status" className="bg-background/80 px-4 py-2 text-center text-sm">{state.lookup.status === "Loaded" ? state.found ? "Saved copy found" : "No saved copy found" : "Save unconfirmed"}</p>}
      {state.editing && state.kind === "Still" && <div aria-label="Photo edit tools" className="mt-6.5 flex shrink-0 flex-col gap-5 px-4 pb-4 landscape:mt-2 landscape:gap-2">
        <div className="flex items-center justify-center gap-4">
          <Button variant="secondary" size="icon" className={editTool} aria-label="Rotate" disabled={!allows({ type: "rotate" })} onClick={() => action({ type: "rotate" })}><RotateCw /></Button>
          <Button ref={state.kind === "Still" ? cropButton : undefined} variant="secondary" size="icon" aria-label="Crop"
            aria-pressed={cropActive} disabled={!allows(crop)} onClick={openCrop}
            className={cropActive ? "bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80" : editTool}><Crop /></Button>
          {allows({ type: "retryPreview" }) && <Button variant="secondary" onClick={() => action({ type: "retryPreview" })}>Retry preview</Button>}
        </div>
        <div role="group" aria-label="Photo filters" className="flex gap-3 overflow-x-auto p-1">
          {filters.map((look) => <Button key={look} variant="ghost" aria-label={look} aria-pressed={state.edit.look === look}
            className="group h-auto min-w-14.5 flex-col gap-2 rounded-xl p-0 text-caption hover:bg-transparent" disabled={state.edit.look !== look && !allows({ type: "restyle", look })} onClick={() => action({ type: "restyle", look })}>
            <span className="relative size-14.5 overflow-hidden rounded-xl bg-secondary group-aria-pressed:outline-solid group-aria-pressed:outline-focus group-aria-pressed:outline-foreground">
              {swatchSource && <img src={swatchSource} alt="" className="absolute inset-0 size-full object-cover" style={{ filter: photoLooks[photoLook(look)], transform: `rotate(${state.edit.turns * 90}deg)` }} />}
            </span>
            <span className={state.edit.look === look ? "text-foreground" : "text-muted-foreground"}>{look}</span>
          </Button>)}
        </div>
      </div>}
      {!state.editing && showing && state.kind === "Clip" && <div className={cn("pointer-events-auto mx-4 mb-2 shrink-0 rounded-xl bg-background/80 p-3 text-sm motion-safe:transition-opacity", !chrome && hiddenChrome)}>
        <label htmlFor={positionId} className="sr-only">Video position</label>
        <Slider id={positionId} aria-label="Video position" min={0} max={Math.max(1, state.duration)} step={1} value={state.position}
          aria-valuetext={`${clipTime(state.position)} of ${clipTime(state.duration)}`} disabled={!canSeekClip}
          onValueChange={(value) => seek(value)} />
        <div className="flex items-center gap-3">
          <span aria-live="off" className="flex-1 tabular-nums">{clipTime(state.position)} / {clipTime(state.duration)}</span>
          {allows({ type: "toggleMute" }) && <Button variant="ghost" className="h-11 rounded-full bg-foreground/15 px-4 font-normal" aria-pressed={state.muted}
            onClick={() => action({ type: "toggleMute" })}>{state.muted ? "Unmute video" : "Mute video"}</Button>}
        </div>
      </div>}
      {!state.editing && showing && <div role="toolbar" aria-label="Photo controls" className={cn("pointer-events-auto relative flex shrink-0 justify-around gap-0.5 px-4 pt-2 pb-3 motion-safe:transition-opacity before:pointer-events-none before:absolute before:inset-x-0 before:-top-7 before:bottom-0 before:-z-10 before:bg-linear-to-t before:from-background/80 before:from-70% before:to-transparent", !chrome && hiddenChrome)}>
        {before !== undefined && allows({ type: "swipe", neighbour: before }) && <Button className="sr-only focus:not-sr-only" variant="ghost" size="icon" aria-label="Previous photo" onClick={() => action({ type: "swipe", neighbour: before })}><ChevronLeft /></Button>}
        {!inTrash && control(state.favourite ? "Remove from favorites" : "Favorite", { type: "toggleFavourite" }, <Heart className={state.favourite ? "fill-current" : undefined} />)}
        {!inTrash && allows({ type: "startEdit" }) && <Button variant="ghost" size="icon" aria-label={state.kind === "Clip" ? "Edit video" : "Edit photo"} onClick={() => editAction({ type: "startEdit" })}><Pencil /></Button>}
        {!inTrash && allows({ type: "toggleInfo" }) && <Button ref={infoButtonRef} variant="ghost" size="icon" aria-label={infoLabel}
          onClick={() => action({ type: "toggleInfo" })}><Info /></Button>}
        {after !== undefined && allows({ type: "swipe", neighbour: after }) && <Button className="sr-only focus:not-sr-only" variant="ghost" size="icon" aria-label="Next photo" onClick={() => action({ type: "swipe", neighbour: after })}><ChevronRight /></Button>}
      </div>}
      </div>
      <InfoSheet open={state.info && loadedRow !== undefined} infoLabel={infoLabel} day={day} time={date && formatTime.format(date)}
        facts={facts} onClose={() => action({ type: "toggleInfo" })} returnFocus={() => infoButtonRef.current} />
    </div>
  );
}

/** The photo or video metadata sheet shown above the viewer. */
function InfoSheet({ open, infoLabel, day, time, facts, onClose, returnFocus }: {
  readonly open: boolean;
  readonly infoLabel: string;
  readonly day: string;
  readonly time?: string;
  readonly facts: readonly { readonly label: string; readonly value: string }[];
  readonly onClose: () => void;
  readonly returnFocus: () => HTMLButtonElement | null;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent aria-label={infoLabel} aria-labelledby={undefined} title={day} description={time}
        className="inset-x-2 -translate-y-2 gap-1 rounded-sheet px-6 pt-6 pb-[max(--spacing(8),env(safe-area-inset-bottom))]"
        overlayClassName="bg-black/35 dark:bg-black/35"
        onCloseAutoFocus={(event) => {
          const trigger = returnFocus();
          if (trigger === null) return;
          event.preventDefault();
          trigger.focus({ preventScroll: true });
        }}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          {facts.map(({ label, value }) => <Fragment key={label}>
            <dt className="text-muted-foreground">{label}</dt><dd className="wrap-anywhere">{value}</dd>
          </Fragment>)}
        </dl>
      </SheetContent>
    </Sheet>
  );
}

interface ViewportProps {
  readonly state: ViewerState;
  readonly current: MediaView;
  readonly name: string;
  readonly showing: boolean;
  readonly editedImage?: string;
  readonly before?: number;
  readonly after?: number;
  readonly action: (event: Event) => void;
  readonly allows: (event: Event) => boolean;
  readonly attachVideo: RefCallback<HTMLVideoElement>;
  readonly played: (ended?: boolean) => void;
  readonly playOverlay?: ReactNode;
  readonly onPlaybackStarted: () => void;
  readonly onDecode: (loaded: boolean) => void;
}

/** The media area that turns pointer and keyboard input into viewer events. */
function MediaViewport({ state, current, name, showing, editedImage, before, after, action, allows, attachVideo, played, playOverlay, onPlaybackStarted, onDecode }: ViewportProps) {
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PanGesture | undefined>(undefined);
  const pointRef = useRef<{ readonly x: number; readonly y: number } | undefined>(undefined);
  const pointersRef = useRef(new Map<number, { readonly x: number; readonly y: number }>());
  const pinchRef = useRef<{ readonly level: number; readonly distance: number } | undefined>(undefined);
  const lastTapRef = useRef<{ readonly time: number; readonly x: number; readonly y: number } | undefined>(undefined);

  const source = current.item ?? current.browser?.item;
  const photoRatio = source && source.width > 0 && source.height > 0 ? source.width / source.height : undefined;
  const sideways = state.edit.turns % 2 !== 0;
  const videoRatio = state.editing && state.kind === "Clip" && source && source.width > 0 && source.height > 0
    ? (sideways ? source.height / source.width : source.width / source.height) : undefined;
  const videoScale = state.edit.cropped ? 130 : 100;

  function finishPan(commit: boolean) {
    const drag = dragRef.current;
    if (drag === undefined) return;
    dragRef.current = undefined;
    drag.image.style.removeProperty(dragX);
    drag.image.style.removeProperty(dragY);
    if (commit && state.open === drag.photo && (drag.pending.x !== drag.from.x || drag.pending.y !== drag.from.y)) action({ type: "panTo", pan: drag.pending });
  }
  function pointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    if (event.target instanceof Element && event.target.closest("button, a, input, [role='button'], [role='slider']")) return;
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      return;
    }
    const point = { x: event.clientX, y: event.clientY };
    pointersRef.current.set(event.pointerId, point);
    if (pointersRef.current.size === 1) {
      finishPan(false);
      pointRef.current = point;
      const image = imageRef.current;
      const frame = frameRef.current;
      if (state.zoom > 1 && image !== null && frame !== null) {
        const width = Math.max(0, (image.clientWidth * state.zoom - frame.clientWidth) / 2);
        const height = Math.max(0, (image.clientHeight * state.zoom - frame.clientHeight) / 2);
        dragRef.current = { image, photo: state.open, room: { x: width, y: height }, from: state.pan, pending: state.pan };
      }
    }
    if (pointersRef.current.size === 2) {
      finishPan(true);
      const [a, b] = [...pointersRef.current.values()];
      if (a && b) pinchRef.current = { level: state.zoom, distance: Math.hypot(a.x - b.x, a.y - b.y) };
      pointRef.current = undefined;
    }
  }
  function pointerMove(event: PointerEvent<HTMLElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const drag = dragRef.current;
    const from = pointRef.current;
    if (drag && from) {
      const dx = event.clientX - from.x, dy = event.clientY - from.y;
      const x = drag.room.x > 0 ? boundedPan(drag.from.x + dx / drag.room.x * panUnits) : 0;
      const y = drag.room.y > 0 ? boundedPan(drag.from.y + dy / drag.room.y * panUnits) : 0;
      drag.pending = { x, y };
      drag.image.style.setProperty(dragX, String(x / panUnits));
      drag.image.style.setProperty(dragY, String(y / panUnits));
      return;
    }
    const [a, b] = [...pointersRef.current.values()];
    if (!a || !b || !pinchRef.current || pinchRef.current.distance <= 0) return;
    const level = Math.max(1, Math.min(maxZoom, Math.round(pinchRef.current.level * Math.hypot(a.x - b.x, a.y - b.y) / pinchRef.current.distance)));
    if (state.zoom !== level) action({ type: "zoomTo", level });
  }
  function pointerEnd(event: PointerEvent<HTMLElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) pinchRef.current = undefined;
    const from = pointRef.current;
    pointRef.current = undefined;
    const cancelled = event.type !== "pointerup";
    const x = from ? event.clientX - from.x : 0, y = from ? event.clientY - from.y : 0;
    const tap = from !== undefined && Math.hypot(x, y) <= 8;
    finishPan(!cancelled && !tap);
    if (!from || cancelled) return;
    if (tap) {
      if (event.pointerType === "touch") {
        const previous = lastTapRef.current;
        if (previous !== undefined && event.timeStamp - previous.time <= 320 && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 32) {
          lastTapRef.current = undefined;
          action({ type: "zoomTo", level: state.zoom > 1 ? 1 : 2 });
          return;
        }
        lastTapRef.current = { time: event.timeStamp, x: event.clientX, y: event.clientY };
      }
      action({ type: "toggleChrome" });
      return;
    }
    lastTapRef.current = undefined;
    if (state.zoom !== 1 || Math.abs(x) <= Math.abs(y) || Math.abs(x) < 48) return;
    const neighbour = x < 0 ? after : before;
    if (neighbour !== undefined) action({ type: "swipe", neighbour });
  }
  return (
    <>
      <div className={cn(focusRing, "relative flex min-h-0 touch-none items-center justify-center overflow-hidden [container-type:size] focus-visible:-outline-offset-2", state.editing && state.kind === "Still" ? editFrame : "flex-1", state.editing && state.kind === "Clip" && "min-h-25 bg-background")}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd} onLostPointerCapture={pointerEnd}
        role="group" aria-label={state.kind === "Clip" ? "Video. Tap to show or hide controls, swipe to browse"
          : `Photo. Zoom ${state.zoom * 100} percent. Pinch or double tap to zoom; drag to pan. Use plus, minus, 0 and arrow keys.`} tabIndex={0}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          const key = event.key;
          if (key === "Enter" || key === " ") { event.preventDefault(); action({ type: "toggleChrome" }); return; }
          if (key === "+" || key === "=" || key === "-" || key === "0") {
            event.preventDefault();
            action({ type: "zoomTo", level: key === "0" ? 1 : Math.min(maxZoom, Math.max(1, state.zoom + (key === "-" ? -1 : 1))) });
            return;
          }
          if (state.zoom > 1 && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
            event.preventDefault();
            action({ type: "panTo", pan: {
              x: boundedPan(state.pan.x + (key === "ArrowLeft" ? panStep : key === "ArrowRight" ? -panStep : 0)),
              y: boundedPan(state.pan.y + (key === "ArrowUp" ? panStep : key === "ArrowDown" ? -panStep : 0)),
            } });
            return;
          }
          const neighbour = key === "ArrowLeft" ? before : key === "ArrowRight" ? after : undefined;
          if (neighbour !== undefined) { event.preventDefault(); action({ type: "swipe", neighbour }); }
        }}
        onDoubleClick={() => action({ type: "zoomTo", level: state.zoom > 1 ? 1 : 2 })}>
        {showing && (state.kind === "Clip"
          ? <div className="grid size-full place-items-center [container-type:size]">
              <div className={cn("relative overflow-hidden", !state.editing && mediaFrame,
                state.editing && videoRatio === undefined && "size-full")}
                style={videoRatio === undefined ? undefined : { width: `min(100cqw, calc(100cqh * ${videoRatio}))`, aspectRatio: videoRatio }}>
                <video ref={attachVideo} key={state.open} src={current.uri} poster={current.item?.image || current.browser?.item.thumbnail || blackVideoPoster}
                  muted={state.muted} playsInline preload="metadata" onPlaying={onPlaybackStarted} onLoadedData={() => onDecode(true)} onError={() => onDecode(false)} onTimeUpdate={() => played(false)} onEnded={() => played(true)}
                  className={videoRatio === undefined ? "size-full object-contain" : "absolute top-1/2 left-1/2 max-w-none object-fill"}
                  style={videoRatio === undefined ? undefined : { width: `${sideways ? videoScale / videoRatio : videoScale}%`, height: `${sideways ? videoScale * videoRatio : videoScale}%`, transform: `translate(-50%, -50%) rotate(${state.edit.turns * 90}deg)` }} />
                {!state.editing && state.playing && state.duration > 0 && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-0.75 bg-foreground/25">
                  <span className="block h-full bg-foreground" style={{ width: `${state.position / state.duration * 100}%` }} />
                </span>}
              </div>
            </div>
          : !state.editing
            ? <div ref={frameRef} data-alpha-photo-frame="" className={cn("absolute inset-0 m-auto overflow-hidden [container-type:size]", mediaFrame)}>
                <img key={state.open} ref={imageRef} src={current.uri} alt={name} draggable={false} decoding="async"
                  className={stillFrame} style={stillStyle(photoRatio ?? 1, state.zoom, state.pan)} />
              </div>
            : <img key={state.open} src={editedImage ?? current.uri} alt={name} draggable={false} decoding="async" className="size-full object-contain" style={{ transform: `scale(${state.zoom})` }} />)}
        {playOverlay}
        {state.gone && <p role="status">This item is no longer available.</p>}
        {state.read.status === "Loading" && <span role="status" aria-label="Loading photo">…</span>}
        {allows({ type: "reload" }) && <Button variant="secondary" onClick={() => action({ type: "reload" })}>Try again</Button>}
      </div>
    </>
  );
}
