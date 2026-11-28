// spec/app/camera/index.md, "Story: Open the camera"; spec/app/camera/index.md, "Story: Frame the shot"; spec/app/camera/index.md, "Story: Take photos and videos"; spec/app/camera/index.md, "Story: Let Alpha take a photo"
import { Button, cn, focusRing } from "@repo/ui";
import { Camera as CameraIcon, ChevronLeft, MicOff, SwitchCamera, Video, Zap, ZapOff } from "lucide-react";
import { useCallback, useRef, useState, useSyncExternalStore, type PointerEvent } from "react";
import type { Camera as Visit, Event, Mode, Said } from "../../gen/app__camera.ts";
import { chosenLens, ready, recording } from "../../gen/app__camera.ts";
import { useMachine } from "../../gen/app__camera.react.ts";
import type { Clock as Reading, Film } from "../../gen/app__camera__recording.ts";
import { nearLimit, remaining, timer as elapsedClock } from "../../gen/app__camera__recording.ts";
import { allows } from "../../gen/kit__permission.ts";
import { CameraPort, type CameraMedia, type LensFacts, type Point } from "../platform/index.vibe";
import type { Resident, Shown } from "../runtime/ui.tsx";
import { useTimed } from "../runtime/ui.tsx";
import { untimed } from "../runtime/index.vibe";
import { drawsAppBack } from "../../gen/app__shell.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import { useMachine as useCanvas } from "../../gen/app__shell__keyboard.react.ts";
import { approveCapture, CameraAssets, focus, shutter, type CameraThumbnails, type camera } from "./camera.vibe";
import { Effect, type Layer } from "effect";

type Runtime = Layer.Success<typeof camera> | Resident;
type Can = (event: Event) => boolean;
type Fire = (event: Event) => void;

/** The zoom chips: the level in tenths and its fixed label; only 1 carries the ×. */
const stops = [[5, ".5"], [10, "1×"], [20, "2"], [50, "5"]] as const;
const notices = { Quiet: "", NotTaken: "Not saved", NothingRecorded: "Not saved", NotSaved: "Save unconfirmed", LightUnchanged: "Camera light did not change" } satisfies Record<Said, string>;

/**
 * Camera's portrait bands, as Alpha's earlier build placed them on a 915px screen: header 0 to 52, viewfinder from 96,
 * zoom chips at 585, modes at 656 and the capture row at 712. Each moves up to stay clear of the Ask Alpha dock
 * (`--alpha-dock-clearance`). With the Ask Alpha sheet half open (`sheet`), the viewfinder fills the screen above it
 * and the controls lie over its bottom.
 */
function bands(sheet: boolean) {
  return sheet
    ? {
      finder: "top-0 bottom-(--alpha-dock-clearance)",
      zoom: "top-[calc(100%_-_var(--alpha-dock-clearance,0px)_-_194px)]",
      modes: "top-[calc(100%_-_var(--alpha-dock-clearance,0px)_-_146px)]",
      capture: "top-[calc(100%_-_var(--alpha-dock-clearance,0px)_-_98px)]",
      below: "top-[calc(100%_-_var(--alpha-dock-clearance,0px))]",
    }
    : {
      finder: "top-24 h-[min(549px,calc(100%_-_var(--alpha-dock-clearance,102px)_-_258px))]",
      zoom: "top-[min(585px,calc(100%_-_var(--alpha-dock-clearance,102px)_-_217px))]",
      modes: "top-[min(656px,calc(100%_-_var(--alpha-dock-clearance,102px)_-_162px))]",
      capture: "top-[min(712px,calc(100%_-_var(--alpha-dock-clearance,102px)_-_106px))]",
      below: "top-[calc(6rem_+_min(549px,calc(100%_-_var(--alpha-dock-clearance,102px)_-_258px)))]",
    };
}
/** In landscape the capture row is a 132px rail at the right, and what lies over the viewfinder stops at it. */
const railed = "landscape:right-33";
const headerButton = cn("relative flex size-13 shrink-0 items-center justify-center rounded-tile text-foreground active:bg-accent disabled:cursor-default", focusRing);

const read = ({ minutes, seconds }: Reading) => `${minutes}:${seconds.toString().padStart(2, "0")}`;

const timed = (film: Film) => nearLimit(film) ? `${read(elapsedClock(film))} · ${read(remaining(film))} left` : read(elapsedClock(film));

/** Solid-black 1x1 PNG data URI preventing WebView's default play-icon video poster before a live frame renders. */
const blackVideoPoster = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function Viewfinder({ state, native, nativePreview, sheet, zoom, focusAt, bind }: {
  state: Visit;
  native: boolean;
  nativePreview: boolean;
  sheet: boolean;
  zoom: (tenths: number) => void;
  focusAt: (point: Point) => void;
  bind: (video: HTMLVideoElement | null) => (() => void) | undefined;
}) {
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ distance: number; zoom: number } | undefined>(undefined);
  const pinchedRef = useRef(false);
  const [target, setTarget] = useState<(Point & { preview: number }) | undefined>(undefined);
  const input = (event: PointerEvent<HTMLButtonElement>) => ({ x: event.clientX, y: event.clientY });
  function spread() {
    const [a, b] = pointersRef.current.values();
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }
  function down(event: PointerEvent<HTMLButtonElement>) {
    const held = pointersRef.current;
    if (held.size === 0) pinchedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    held.set(event.pointerId, input(event));
    if (held.size === 2) {
      pinchRef.current = { distance: spread(), zoom: state.zoom };
      pinchedRef.current = true;
    }
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, input(event));
    const start = pinchRef.current;
    if (start && start.distance > 0 && pointersRef.current.size === 2) zoom(Math.round(start.zoom * spread() / start.distance));
  }
  function up(event: PointerEvent<HTMLButtonElement>) {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = undefined;
  }
  return (
    <button
      type="button"
      aria-label="Viewfinder. Tap to focus or pinch to zoom"
      data-alpha-camera="viewfinder"
      className={cn(
        "absolute inset-x-0 block touch-none overflow-hidden landscape:top-0 landscape:right-33 landscape:bottom-(--alpha-dock-clearance,0px) landscape:h-auto",
        bands(sheet).finder,
        !native && "bg-background",
        focusRing,
      )}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onClick={(event) => {
        if (event.detail === 0) pinchedRef.current = false;
        else if (pinchedRef.current) {
          pinchedRef.current = false;
          return;
        }
        if (!ready(state)) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (!box.width || !box.height) return;
        const x = event.detail === 0 ? box.left + box.width / 2 : event.clientX;
        const y = event.detail === 0 ? box.top + box.height / 2 : event.clientY;
        const page = event.currentTarget.ownerDocument.documentElement;
        const relX = Math.max(0, Math.min(1, (x - box.left) / box.width));
        const relY = Math.max(0, Math.min(1, (y - box.top) / box.height));
        const point = {
          x: relX,
          y: relY,
          viewportX: page.clientWidth > 0 ? Math.max(0, Math.min(1, x / page.clientWidth)) : relX,
          viewportY: page.clientHeight > 0 ? Math.max(0, Math.min(1, y / page.clientHeight)) : relY,
        };
        setTarget({ ...point, preview: state.preview });
        focusAt(point);
      }}
    >
      <video
        ref={bind}
        autoPlay
        muted
        playsInline
        poster={blackVideoPoster}
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 size-full object-cover", (nativePreview || !ready(state)) && "invisible")}
        style={nativePreview ? undefined : { scale: `${(state.lens === "Front" ? -1 : 1) * state.zoom / 10} ${state.zoom / 10}` }}
      />
      <span aria-hidden className="pointer-events-none absolute top-1/2 -left-[4%] block aspect-3/4 w-[108%] -translate-y-1/2" />
      {state.focus > 0 && target !== undefined && target.preview === state.preview && (
        <span
          key={state.focus}
          role="status"
          aria-label={state.confirmed === state.focus ? "Camera focus applied" : "Focus target"}
          className="pointer-events-none absolute z-10 size-10.5 -translate-1/2 rounded-frame border-2 border-camera-focus shadow-focus-target motion-safe:transition-opacity"
          style={{ left: `${target.x * 100}%`, top: `${target.y * 100}%` }}
        />
      )}
      {state.shot !== 0 && (
        <span
          key={state.shot}
          aria-hidden
          className={cn("pointer-events-none absolute inset-0 block bg-foreground opacity-0 transition-opacity duration-slow ease-out motion-reduce:hidden", state.flash ? "starting:opacity-100" : "starting:opacity-85")}
        />
      )}
    </button>
  );
}

function Access({ state, present, native, can, fire, takeSilent }: {
  state: Visit;
  present: boolean;
  native: boolean;
  can: Can;
  fire: Fire;
  takeSilent: () => void;
}) {
  const video = state.mode === "Video";
  const noCamera = !allows(state.permission);
  const failed = state.phase === "Failed" || !present;
  const noMic = !noCamera && !failed && video && !allows(state.mic) && !recording(state);
  if (!state.showing || !noCamera && !failed && !noMic) return null;
  const title = failed ? "Can’t start camera" : noCamera ? "Camera off" : "Mic off";
  const ask = { type: noCamera ? "askAccess" : "askMicrophone" } as const;
  const allow = failed ? undefined : can(ask) ? ask : native && can({ type: "openSettings" }) ? { type: "openSettings" } as const : undefined;
  const action = cn("min-h-11 rounded-tile bg-foreground/16 px-4 text-base font-normal text-foreground", focusRing);
  return (
    <section role="alert" aria-label={title} data-alpha-camera-access="" className="absolute inset-x-4 top-[38%] z-50 flex max-h-[max(160px,calc(62%_-_var(--alpha-dock-clearance,108px)))] flex-col gap-3 overflow-y-auto overscroll-contain rounded-xl bg-camera-panel p-4 text-center text-foreground landscape:right-37">
      <span aria-hidden className="relative flex self-center">
        {noMic ? <MicOff className="size-8" /> : <CameraIcon className="size-8" />}
        {!noMic && <span className="absolute -top-0.5 left-1/2 -ml-px h-9 w-[2.5px] -rotate-45 rounded-full bg-current ring-2 ring-camera-panel" />}
      </span>
      <strong>{title}</strong>
      <div className="flex flex-wrap justify-center gap-2">
        {allow && <button type="button" className={action} aria-label={allow.type === "openSettings" ? "Allow in Settings" : undefined} onClick={() => fire(allow)}>{native ? "Allow" : "Retry"}</button>}
        {failed && can({ type: "retry" }) && <button type="button" className={action} onClick={() => fire({ type: "retry" })}>Retry</button>}
        {noMic && can({ type: "startRecording", sound: false }) && <button type="button" className={action} aria-label="Record without sound" onClick={takeSilent}>No sound</button>}
      </div>
    </section>
  );
}

function ZoomStops({ state, lens, top, zoom, can, hidden }: { state: Visit; lens: LensFacts | undefined; top: string; zoom: (level: number) => void; can: Can; hidden: boolean }) {
  const enabled = stops.filter(([level]) => level >= (lens?.minimum ?? 10) && level <= (lens?.maximum ?? 10));
  if (hidden || !ready(state) || enabled.length < 2) return null;
  const nearest = enabled.reduce((a, b) => Math.abs(a[0] - state.zoom) < Math.abs(b[0] - state.zoom) ? a : b);
  return (
    <div role="group" aria-label="Zoom" data-alpha-camera="zoom" className={cn("pointer-events-none absolute inset-x-0 z-10 flex h-11 items-center justify-center landscape:top-auto landscape:bottom-15", top, railed)}>
      {enabled.map(([level, label]) => (
        <button
          key={level}
          type="button"
          aria-label={`Zoom ${level / 10}x`}
          aria-pressed={nearest[0] === level}
          disabled={!can({ type: "zoomTo", level })}
          className={cn("pointer-events-auto grid size-11 place-items-center rounded-full font-bold", focusRing)}
          onClick={() => zoom(level)}
        >
          <span className={cn("grid place-items-center rounded-full transition-all duration-base", state.zoom === level ? "size-10 bg-foreground text-meta text-background" : "size-8.5 bg-background/65 text-xs text-foreground")}>
            {label}
          </span>
        </button>
      ))}
    </div>
  );
}

function LastCapture({ id, media, thumbnails, open }: {
  id: number;
  media: CameraMedia;
  thumbnails: CameraThumbnails;
  open: () => void;
}) {
  const thumbnail = useSyncExternalStore(thumbnails.subscribe, () => thumbnails.snapshot(id));
  const video = media.mime.startsWith("video/");
  const preview = thumbnail || media.source;
  return (
    <button type="button" aria-label={video ? "Open last video" : "Open last photo"} onClick={open} className={cn("relative block size-13 shrink-0 overflow-hidden rounded-md ring-[1.5px] ring-foreground/70", focusRing)}>
      {!preview || (video && !thumbnail) ? <Video aria-hidden className="m-auto size-5" /> : <img src={preview} alt="" className="size-full object-cover" />}
    </button>
  );
}

/** Camera’s live viewfinder, framing controls, shutter, last capture and capture approval. @model spec/app/camera/index.md */
export function Camera({ runtime, alpha }: Shown<Runtime>) {
  const { state, can: permits, send } = useTimed(runtime, useMachine);
  const shell = useShell(alpha.runtime);
  const launcher = useCanvas(alpha.runtime).state?.launcher ?? false;
  const bind = useCallback((video: HTMLVideoElement | null) => {
    if (!video) return;
    void runtime.runPromiseExit(Effect.flatMap(CameraAssets, (assets) => assets.bind(video)));
    return () => { void runtime.runPromiseExit(Effect.flatMap(CameraAssets, (assets) => assets.bind(null))); };
  }, [runtime]);
  if (!state) return (
    <section
      aria-label="Camera"
      data-alpha-camera-root=""
      // eslint-disable-next-line better-tailwindcss/no-unknown-classes -- design.md, "Dark": Camera keeps a dark viewfinder and controls in both themes, as in develop
      className="dark relative isolate min-h-0 flex-1 overflow-hidden bg-background text-foreground"
    />
  );

  const port = runtime.runSync(CameraPort);
  const assets = runtime.runSync(CameraAssets);
  const lens = runtime.runSync(assets.lens(state.preview));
  const last = state.last === 0 ? undefined : runtime.runSync(assets.read(state.last));
  const can: Can = (event) => permits(event, "Owner");
  const fire: Fire = (event) => { if (can(event)) void send(event, "Owner"); };
  const video = state.mode === "Video";
  const inProgress = recording(state);
  const active = ready(state);
  const native = port.nativePreview && state.phase === "Ready";
  const sheet = shell.state?.assistant === "Sheet";
  const band = bands(sheet);
  const currentZoom = (level: number) => {
    const low = Math.max(5, lens?.minimum ?? 10);
    const high = Math.min(100, lens?.maximum ?? 10);
    const next = Math.min(high, Math.max(low, level));
    if (next !== state.zoom) fire({ type: "zoomTo", level: next });
  };
  const click = () => void runtime.runPromiseExit(shutter());
  const photoShutter = can({ type: "shutter" });
  const light = { type: port.nativePreview ? "toggleFlash" : "toggleTorch" } as const;
  const canLight = can(light);
  const writingLight = !port.nativePreview && state.torch.write !== 0;
  const lit = port.nativePreview ? state.flash : state.torch.lit;
  const autoFlash = port.nativePreview && state.flashAuto;
  const flashLabel = autoFlash ? "Flash auto" : !video ? (lit ? "Flash on" : "Flash off") : lit ? "Light on" : "Light off";
  const Flash = lit || autoFlash ? Zap : ZapOff;
  const videoShutter = (state.film.stage === "Running" && can({ type: "stopRecording", now: untimed })) || can({ type: "startRecording", sound: true });
  const overlayShown = (state.showing && (!allows(state.permission) || state.phase === "Failed" || !port.present || (video && !allows(state.mic) && !inProgress))) || (active && state.agent.stage === "Asked");

  return (
    <section
      aria-label="Camera"
      data-alpha-camera-root=""
      data-alpha-camera-native={native ? "" : undefined}
      // eslint-disable-next-line better-tailwindcss/no-unknown-classes -- design.md, "Dark": Camera keeps a dark viewfinder and controls in both themes, as in develop
      className={cn("dark relative isolate min-h-0 flex-1 overflow-hidden text-foreground", !native && "bg-background")}
    >
      {native && (
        <>
          <span aria-hidden className={cn("absolute inset-x-0 top-0 h-24 bg-background landscape:hidden", sheet && "hidden")} />
          <span aria-hidden className={cn("absolute inset-x-0 bottom-0 bg-background landscape:top-auto landscape:h-(--alpha-dock-clearance,0px)", band.below)} />
          <span aria-hidden className="absolute inset-y-0 right-0 hidden w-33 bg-background landscape:block" />
        </>
      )}
      <Viewfinder
        state={state}
        native={native}
        nativePreview={port.nativePreview}
        sheet={sheet}
        bind={bind}
        zoom={currentZoom}
        focusAt={(point) => void runtime.runPromiseExit(focus(point))}
      />
      {sheet && <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-(--alpha-dock-clearance,0px) h-40 bg-linear-to-b from-transparent to-background/55" />}

      <header data-alpha-app-header="main" className="absolute inset-x-0 top-0 z-10 flex h-13 items-center px-2.5 portrait:top-[max(--spacing(11),var(--alpha-native-inset-top,0px),env(safe-area-inset-top))]">
        {shell.state && drawsAppBack(shell.state, launcher, "FirstPage") && <button type="button" className={cn(headerButton, "rounded-lg")} aria-label="Back to apps" onClick={() => void alpha.back()}><ChevronLeft className="size-5.5" aria-hidden /></button>}
        <span className="flex-1" />
        {inProgress && (
          <span role="timer" aria-label="Recording" className="flex h-7.5 items-center gap-2 rounded-segment bg-background/75 px-3 text-sm font-semibold text-foreground tabular-nums">
            <span aria-hidden className="size-1.75 rounded-full bg-record motion-safe:animate-blink" />{timed(state.film)}
          </span>
        )}
        {!inProgress && <button type="button" className={headerButton} aria-label="Switch camera" disabled={!can({ type: "flip" })} onClick={() => fire({ type: "flip" })}><SwitchCamera className="size-5.5" aria-hidden /></button>}
        {lens?.flash && (canLight || writingLight) && (
          <button type="button" className={headerButton} aria-label={flashLabel} aria-busy={writingLight} disabled={!canLight} onClick={() => fire(light)}>
            <Flash className="size-5.5" aria-hidden />
            {autoFlash && <span aria-hidden className="absolute right-0.5 bottom-0.5 text-camera-badge font-bold">A</span>}
          </button>
        )}
      </header>

      {state.said !== "Quiet" && (
        <button type="button" data-alpha-camera="said" aria-label="Dismiss camera message" className={cn("absolute inset-x-4 top-27 z-20 flex items-center rounded-tile bg-background/62 px-4 py-3 text-left text-foreground motion-safe:animate-drop landscape:right-37", focusRing)} onClick={() => fire({ type: "dismiss" })}>
          <span className="text-subject leading-normal">{notices[state.said]}</span>
        </button>
      )}
      <ZoomStops state={state} lens={lens} top={band.zoom} zoom={currentZoom} can={can} hidden={overlayShown} />
      <Access state={state} present={port.present} native={port.nativePreview} can={can} fire={fire} takeSilent={() => fire({ type: "startRecording", sound: false })} />
      {active && state.agent.stage === "Asked" && (
        <section aria-label="Camera request" className={cn("absolute inset-x-4 z-20 mx-auto flex max-w-md -translate-y-full flex-col gap-3 rounded-tile bg-secondary p-4 text-secondary-foreground landscape:top-auto landscape:right-37 landscape:bottom-28 landscape:translate-y-0", band.zoom)}>
          <strong>Take a photo for Alpha?</strong>
          {state.requestedLens !== "AsShown" && <span className="text-sm text-muted-foreground">{chosenLens(state) === "Front" ? "Front camera requested" : "Back camera requested"}</span>}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" disabled={!can({ type: "agentDecline" })} onClick={() => fire({ type: "agentDecline" })}>Decline</Button>
            <Button size="sm" disabled={!can({ type: "agentApprove" })} onClick={() => void runtime.runPromiseExit(approveCapture())}>Take photo</Button>
          </div>
        </section>
      )}

      {!inProgress && (
        <div role="group" aria-label="Camera mode" data-alpha-camera="modes" className={cn("absolute inset-x-0 z-10 flex h-11 items-center justify-center gap-2 landscape:top-auto landscape:bottom-2", band.modes, railed)}>
          {(["Video", "Photo"] satisfies Mode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              aria-label={`${mode} mode`}
              aria-pressed={state.mode === mode}
              disabled={!can({ type: "setMode", mode })}
              className={cn("flex min-h-11 shrink-0 flex-col items-center justify-center gap-1.25 px-3.5 text-subject font-semibold transition-colors duration-base disabled:opacity-60 landscape:rounded-tile landscape:bg-background/62", state.mode === mode ? "text-foreground" : "text-foreground/55", focusRing)}
              onClick={() => fire({ type: "setMode", mode })}
            >
              {mode}<span aria-hidden className={cn("size-1 rounded-full bg-foreground", state.mode !== mode && "invisible")} />
            </button>
          ))}
        </div>
      )}

      <div data-alpha-camera="capture" className={cn("absolute inset-x-0 z-10 flex h-22.5 items-center justify-between px-11 landscape:top-13 landscape:bottom-0 landscape:left-auto landscape:h-auto landscape:w-33 landscape:flex-col-reverse landscape:px-0 landscape:py-2", band.capture)}>
        {last && can({ type: "openLast" }) ? (
          <LastCapture id={state.last} media={last} thumbnails={assets.thumbnails} open={() => fire({ type: "openLast" })} />
        ) : <span aria-hidden className="size-13" />}
        <button
          type="button"
          aria-label={!video ? "Take photo" : state.film.stage === "Running" ? "Stop recording" : "Start recording"}
          aria-busy={state.shot !== 0 || inProgress && state.film.stage !== "Running"}
          disabled={!active || (video ? !videoShutter : !photoShutter)}
          onClick={click}
          className={cn("flex size-20 shrink-0 items-center justify-center rounded-full ring-4 ring-foreground ring-inset", focusRing)}
        >
          <span aria-hidden className={cn("transition-all duration-base ease-standard motion-reduce:transition-none", inProgress ? "size-7.5 rounded-frame bg-record-shutter" : cn("size-15.5 rounded-full", video ? "bg-record-shutter" : "bg-foreground"))} />
        </button>
        <span aria-hidden className="size-13" />
      </div>
    </section>
  );
}
