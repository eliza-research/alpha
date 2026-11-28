// spec/app/shell/index.md, "Story: Move between Home and the apps"; spec/app/shell/index.md, "On Phone, Messages and Contacts the app's own bar stands in for Ask Alpha at rest, until Ask Alpha rises"; spec/app/shell/gestures.md, "A swipe travels more than 46 points; a sideways one from within 30 points of a side edge, towards the middle, is Back"; spec/app/shell/gestures.md, "On the launcher a swipe up from the bottom bar goes Home; nothing else is a shell swipe"; spec/app/shell/layers.md, "The page under a layer or a hold takes no touch, and a covering layer or a hold takes none for Ask Alpha either"; spec/app/update/page.md, "A page that was not mounted mounts its editors only once no update is pending"
import { Alert, AppHeader, SHEET_EASE, StartupFailureScreen, StartupMark, cn } from "@repo/ui";
import { Effect, Stream } from "effect";
import { type MouseEvent, type PointerEvent, type ReactNode, type SyntheticEvent, type TouchEvent, useCallback, useRef, useState, useSyncExternalStore } from "react";
import { useMachine as useComms } from "../gen/app__phone__comms.react.ts";
import * as Pages from "../gen/app__settings.effect.vibe";
import { Machine as ShellMachine } from "../gen/app__shell.effect.vibe";
import { useMachine } from "../gen/app__shell.react.ts";
import { type Shell, type View, adjacentAskSheet, askAlphaDrawn } from "../gen/app__shell.ts";
import { useMachine as useCanvas } from "../gen/app__shell__keyboard.react.ts";
import { useMachine as useLayers } from "../gen/app__shell__layers.react.ts";
import { assistantInert, pageInert, takesBack } from "../gen/app__shell__layers.ts";
import { useMachine as useAccess } from "../gen/app__startup__access.react.ts";
import { completed as accessCompleted, coveredAt as accessCoveredAt, panel as accessPanel } from "../gen/app__startup__access.ts";
import { barHeight, edge, swipe } from "../gen/app__shell__gestures.ts";
import { useMachine as usePage } from "../gen/app__update__page.react.ts";
import { dialogShown, editorsMounted } from "../gen/app__update__page.ts";
import { BrowserFrames } from "./browser/BrowserFrames.tsx";
import { OverlayControlBanner } from "./control/ControlBanner.tsx";
import { addLayerAt } from "./home/addHome.vibe";
import { MessagingBridge } from "./messaging/bridge.vibe";
import { noteSubjects, notesSelection } from "./notes/selection.vibe";
import { coarsePointer, desktopPreview, landscapeHomeInput, watchPrimaryPointer } from "./shell/canvas.vibe";
import {
  type AlphaIntentDetail,
  type AlphaIntentResult,
  DEFAULT_CONTEXT_LEASE_MS,
  finishThinAppTask,
  launchSiblingApp,
  publishForegroundContext,
  watchAppSurface,
  watchOverlaySurface,
} from "./platform/contextBridge.vibe";
import { native } from "./platform/device.vibe";
import type { Alpha } from "./runtime/area.tsx";
import { versions } from "./settings/build.ts";
import { AppBack } from "./shell/AppBack.tsx";
import { measureChrome, watchChrome } from "./shell/chrome.vibe";
import { ShellLayerHost } from "./shell/ShellLayerHost.tsx";
import { home } from "./shell/shell.vibe";
import { isCommsView, viewHasHeader, views } from "./shell/views.tsx";
import { type AlphaSurface, currentSurface } from "./surface.ts";
import { canLeaveSignInStep, SignIn, useFirstRun } from "./startup/SignIn.tsx";
import { AccessWalkthrough } from "./startup/SettingsAccess.tsx";
import { firstFrame } from "./startup/cover.vibe";
import { launcherBeforeMount, openHomeSettings, reloadBeforeMount } from "./startup/recovery.vibe";

export interface AppProps {
  /** Alpha as boot.tsx opened it: the root runtime, and every screen at its place. */
  alpha: Alpha;
  /** Optional explicit surface override; defaults to `currentSurface()`. */
  surface?: AlphaSurface;
}

type StartedSwipe = {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  across: number;
  down: number;
  owner: string;
  touch?: {
    target: Element;
    identifier?: number;
    pointerCanceled?: true;
    scrolled: () => boolean;
  };
};

/** Where the staged app slides in from when Alpha's sheet stays open across a switch of communications apps. */
type StageSide = "left" | "right";

/** The app layer as the apps share it: the view on top, its trail's length, and whether it is still rising over Home. */
type Risen = { view: View | undefined; depth: number; overHome: boolean; slide?: { side: StageSide; from: View | undefined; to: View | undefined } };

/** v119's stage slide (45f6bed30 prototype/phone.css:413-417): 18% in from the side at 0.4 opacity, 0.42 s on the sheet's curve. */
function slideStage(layer: HTMLElement, side: StageSide) {
  if (typeof layer.animate !== "function" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true) return;
  layer.animate(
    [{ transform: `translateX(${side === "left" ? "18%" : "-18%"})`, opacity: 0.4 }, { transform: "none", opacity: 1 }],
    { duration: 420, easing: SHEET_EASE },
  );
}

/**
 * The one layer the apps share, over `shell`: whether Home still shows under an app rising from it, the callback that holds the layer,
 * which slides a switch of communications apps in while Ask Alpha rests at its sheet in portrait, unless an emergency call
 * is live, and ends the rise when it is cancelled, what ends the rise, and the capture handler that notes a return to
 * Phone chosen from the tabs on its Contacts tab.
 */
function useAppLayer(shell: Shell | undefined, landscape: boolean, emergency: boolean) {
  const [risen, setRisen] = useState<Risen>({ view: undefined, depth: 0, overHome: false });
  // spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open": only a tab other than Contacts, chosen on Contacts, returns to Phone (45f6bed30 prototype/phone-adapter.ts:263-270), and the mark lasts until the view next changes.
  const tabReturnRef = useRef(false);
  const markedLayerRef = useRef<HTMLDivElement | null>(null);
  const slidRef = useRef<Risen["slide"]>(undefined);
  const slide = risen.slide;
  const showing = shell?.trail.at(-1);
  const risenOver = useCallback(() => setRisen((was) => ({ ...was, overHome: false })), []);
  // spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open": Phone's own tabs on its Contacts tab swap at once (45f6bed30 prototype/phone-adapter.ts:256-270).
  const holdLayer = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    // spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open": going Home takes the layer away, so a layer drawn again after Home holds no mark from before it.
    if (markedLayerRef.current !== node) {
      markedLayerRef.current = node;
      tabReturnRef.current = false;
    }
    if (slide !== undefined && slidRef.current !== slide) {
      slidRef.current = slide;
      const fromTabs = slide.from === "Contacts" && slide.to === "Phone" && tabReturnRef.current;
      if (!fromTabs) slideStage(node, slide.side);
    }
    if (showing !== "Contacts") tabReturnRef.current = false;
    // spec/app/shell/index.md, "The shell holds the apps opened on the way here, the Apps drawer, how far Ask Alpha is raised, and what this phone admits": Home shows under a rising app until the rise is over, ended or stopped early.
    const stopped = (event: Event) => { if (event.target === node) risenOver(); };
    node.addEventListener("animationcancel", stopped);
    return () => node.removeEventListener("animationcancel", stopped);
  }, [showing, slide, risenOver]);
  if (shell !== undefined && risen.view !== showing) {
    // spec/app/shell/index.md, "Opening another communications app from the stage keeps Ask Alpha open": an emergency call is never staged (45f6bed30 prototype/model.js:6286).
    const staged = shell.assistant === "Sheet" && !landscape && !emergency && isCommsView(risen.view) && isCommsView(showing);
    const depth = shell.trail.length;
    setRisen({ view: showing, depth, overHome: risen.view === undefined || risen.overHome, slide: staged ? { side: depth < risen.depth ? "right" : "left", from: risen.view, to: showing } : undefined });
  }
  const choosing = (event: SyntheticEvent<HTMLElement>, keep: boolean) => {
    const target = event.target;
    const tab = target instanceof Element ? target.closest("[data-alpha-phone-tab]") : null;
    if (tab !== null) tabReturnRef.current = showing === "Contacts" && tab.getAttribute("data-alpha-phone-tab") !== "contacts";
    else if (!keep) tabReturnRef.current = false;
  };
  return { overHome: risen.view === showing && risen.overHome, holdLayer, risenOver, choosing };
}

/** A swipe can belong to the shell only while the touched surface has not panned. */
function touchScroll(target: Element, shell: HTMLElement) {
  const vertical: { element: Element; top: number }[] = [];
  for (let element: Element | null = target; element && element !== shell; element = element.parentElement) {
    const style = getComputedStyle(element);
    const touchAction = style.touchAction ?? "";
    if (touchAction === "none" || /pan-(x|left|right)/.test(touchAction)
      || ((style.overflowX === "auto" || style.overflowX === "scroll") && element.scrollWidth > element.clientWidth)) return;
    if ((style.overflowY === "auto" || style.overflowY === "scroll") && element.scrollHeight > element.clientHeight) {
      vertical.push({ element, top: element.scrollTop });
    }
  }
  return () => vertical.some(({ element, top }) => element.scrollTop !== top);
}

function useShellSwipe(alpha: Alpha, blocked: boolean, launcher: boolean, owner: string) {
  const startedRef = useRef<StartedSwipe | undefined>(undefined);
  const suppressClickRef = useRef(false);
  const finishSwipe = (from: StartedSwipe, element: HTMLElement, clientX: number, clientY: number, claim?: () => void) => {
    if (from.owner !== owner || from.touch?.scrolled()) return;
    const box = element.getBoundingClientRect();
    if (element.offsetWidth !== from.width || element.offsetHeight !== from.height) return;
    const dx = (clientX - box.left) * from.across - from.x;
    const dy = (clientY - box.top) * from.down - from.y;
    const went = swipe(launcher, from.width, from.height, from.x, from.y, dx, dy);
    if (went === "SwipeBack") {
      suppressClickRef.current = true;
      claim?.();
      void alpha.back();
    } else if (went === "SwipeHome") {
      suppressClickRef.current = true;
      claim?.();
      void alpha.runtime.runPromise(home());
    }
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      suppressClickRef.current = false;
      if (blocked || !event.isPrimary || event.button !== 0 || event.defaultPrevented) return;
      startedRef.current = undefined;
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable]:not([contenteditable=false]), [data-alpha-own-gesture]")) return;
      const element = event.currentTarget;
      const box = element.getBoundingClientRect();
      const width = element.offsetWidth;
      const height = element.offsetHeight;
      if (box.width <= 0 || box.height <= 0 || width <= 0 || height <= 0) return;
      const across = width / box.width;
      const down = height / box.height;
      const x = (event.clientX - box.left) * across;
      const y = (event.clientY - box.top) * down;
      if (x >= edge && x <= width - edge && (!launcher || y <= height - barHeight)) return;
      const from: StartedSwipe = { id: event.pointerId, x, y, width, height, across, down, owner };
      if (event.pointerType === "touch" && target instanceof Element) {
        const scrolled = touchScroll(target, element);
        if (!scrolled) return;
        from.touch = { target, scrolled };
      }
      startedRef.current = from;
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      const from = startedRef.current;
      if (!event.isPrimary || from?.id !== event.pointerId) return;
      startedRef.current = undefined;
      if (!event.defaultPrevented && !blocked) finishSwipe(from, event.currentTarget, event.clientX, event.clientY, () => event.preventDefault());
    },
    onPointerCancel: (event: PointerEvent<HTMLElement>) => {
      const from = startedRef.current;
      if (from?.id !== event.pointerId) return;
      if (from.touch?.identifier !== undefined) from.touch.pointerCanceled = true;
      else startedRef.current = undefined;
    },
    onTouchStart: (event: TouchEvent<HTMLElement>) => {
      const touch = startedRef.current?.touch;
      if (!touch) return;
      if (event.defaultPrevented || event.touches.length !== 1 || touch.target !== event.target) {
        startedRef.current = undefined;
        return;
      }
      touch.identifier = event.touches[0]?.identifier;
    },
    onTouchEnd: (event: TouchEvent<HTMLElement>) => {
      const from = startedRef.current;
      if (!from?.touch?.pointerCanceled) return;
      startedRef.current = undefined;
      if (event.defaultPrevented || event.touches.length !== 0 || blocked) return;
      const ended = Array.from(event.changedTouches).find((touch) => touch.identifier === from.touch?.identifier);
      if (ended) finishSwipe(from, event.currentTarget, ended.clientX, ended.clientY);
    },
    onTouchCancel: () => { if (startedRef.current?.touch) startedRef.current = undefined; },
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      if (!event.isTrusted || event.detail === 0) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

function useSurfaceHost(alpha: Alpha) {
  const machine = useMachine(alpha.runtime);
  const layers = useLayers(alpha.runtime).state;
  const canvas = useCanvas(alpha.runtime).state;
  const phone = native();
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  return { ...machine, layers, canvas, phone, portalNode, setPortalNode };
}

function SurfaceChrome({ alpha, setPortalNode, topBanner }: {
  readonly alpha: Alpha;
  readonly setPortalNode: (node: HTMLElement | null) => void;
  readonly topBanner?: ReactNode;
}) {
  return (
    <>
      <div data-alpha-top-alerts="" className="pointer-events-none fixed inset-x-0 top-[var(--alpha-safe-top)] z-alert mx-auto flex max-w-103 flex-col gap-2 px-3 pt-2 *:pointer-events-auto">
        {topBanner}
        {alpha.slot("overlay")}
      </div>
      {alpha.slot("notice")}
      <div ref={setPortalNode} data-alpha-portal-root="" className="contents" />
    </>
  );
}

/** Transparent system-wide Ask Alpha overlay surface hosted inside `AlphaVoiceInteractionSession`. */
function OverlaySurface({ alpha }: { readonly alpha: Alpha }) {
  const { cause, layers, canvas, phone, portalNode, setPortalNode } = useSurfaceHost(alpha);
  const overlayRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    const stopChrome = watchChrome(node, (event) => { void alpha.runtime.runPromise(measureChrome(event)); });
    const stopOverlay = watchOverlaySurface(node);
    return () => {
      stopOverlay();
      stopChrome();
    };
  }, [alpha]);
  return (
    <ShellLayerHost alpha={alpha} portalContainer={portalNode}>
      <main
        ref={overlayRef}
        data-alpha-surface="overlay"
        data-alpha-native={phone ? "" : undefined}
        style={canvas?.covered ? { height: canvas.visible } : undefined}
        className="pointer-events-none relative mx-auto flex h-dvh w-full flex-col overflow-hidden bg-transparent font-sans text-base text-foreground *:pointer-events-auto"
      >
        <div
          data-alpha-assistant-host=""
          className="relative flex min-h-0 flex-1 flex-col justify-end [&>[data-alpha-detent]]:absolute [&>[data-alpha-detent]]:inset-x-0 [&>[data-alpha-detent]]:bottom-0 [&>[data-alpha-detent]]:max-w-none"
          inert={cause !== undefined || (layers !== undefined && assistantInert(layers))}
        >
          {alpha.slot("assistant")}
        </div>
        <SurfaceChrome alpha={alpha} setPortalNode={setPortalNode} topBanner={<OverlayControlBanner alpha={alpha} />} />
      </main>
    </ShellLayerHost>
  );
}

function parseIntentPayload(raw: string): Record<string, unknown> {
  if (raw.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function handleAppViewIntent(
  alpha: Alpha,
  view: View,
  detail: AlphaIntentDetail,
): Promise<AlphaIntentResult> {
  const payload = parseIntentPayload(detail.payloadJson);
  if (view === "Notes") {
    const target = typeof payload.target === "object" && payload.target !== null
      ? (payload.target as Record<string, unknown>)
      : undefined;
    const noteId = typeof target?.noteId === "string"
      ? target.noteId
      : typeof payload.noteId === "string" ? payload.noteId : undefined;
    if (noteId !== undefined && noteId.length > 0) {
      const { agentOpen } = await import("./notes/agent.vibe");
      const turn = detail.ticket > 0 ? detail.ticket : 1;
      const opened = await alpha.runtime.runPromise(agentOpen(noteId, { turn, current: turn, sensitive: false }));
      return {
        switched: true,
        result: { view, uri: detail.uri, opened, ...(opened && target !== undefined ? { shown: target } : {}) },
      };
    }
  }
  if (view === "Browser") {
    const url = typeof payload.url === "string" ? payload.url : undefined;
    if (url !== undefined && url.length > 0) {
      const [{ default: browser }, { openMessageLink }] = await Promise.all([
        import("./browser/index.tsx"),
        import("./browser/browser.vibe"),
      ]);
      const opened = await browser.runtime(alpha).runPromise(openMessageLink(url, "Ask Alpha"));
      return { switched: true, result: { view, uri: detail.uri, opened } };
    }
  }
  if (view === "Settings") {
    const section = typeof payload.section === "string" ? payload.section : undefined;
    if (section !== undefined && section.length > 0) {
      const parsed = Pages.parseEvent({ type: "openSection", page: section });
      if (parsed?.type === "openSection") {
        await alpha.runtime.runPromiseExit(Effect.flatMap(Pages.Machine, (pages) => pages.send(parsed)));
      }
    }
  }
  return { switched: true, result: { view, uri: detail.uri } };
}

/** Standalone single-view surface packaged inside a thin Alpha app APK. */
function AppSurface({ alpha, view }: { readonly alpha: Alpha; readonly view: View }) {
  const { cause, send, layers, canvas, phone, portalNode, setPortalNode } = useSurfaceHost(alpha);
  const comms = isCommsView(view);
  const inert = cause !== undefined || (layers !== undefined && pageInert(layers));
  const hasStepBack = cause === undefined && layers !== undefined && takesBack(layers);
  const canGoBack = String(hasStepBack);
  const appRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    void send({ type: "openView", view });
    const stopChrome = watchChrome(node, (event) => { void alpha.runtime.runPromise(measureChrome(event)); });
    const stopApp = watchAppSurface(view, async (detail) => {
      node.ownerDocument.defaultView?.dispatchEvent(new CustomEvent("alpha-view-intent", { detail }));
      return handleAppViewIntent(alpha, view, detail);
    });
    const appFiber = alpha.runtime.runFork(Effect.gen(function* () {
      const shell = yield* ShellMachine;
      const pages = yield* Pages.Machine;
      const bridge = yield* MessagingBridge;
      const syncSibling = Stream.runForEach(shell.changes, (state) => Effect.gen(function* () {
        const active = state.trail.at(-1);
        if (active === undefined || active === view) return;
        yield* launchSiblingApp(active);
        yield* Effect.exit(shell.send({ type: "openView", view }));
      }));
      const publishContext = Effect.gen(function* () {
        const pageState = yield* pages.get();
        const msgSnap = bridge.snapshot();
        const platform = view === "Telegram" ? "Telegram" : view === "Slack" ? "Slack" : undefined;
        const msgCtx = platform === undefined ? undefined : msgSnap.contexts[platform];
        const sensitive = (view === "Settings" && Pages.sensitive(pageState))
          || (platform !== undefined && (msgCtx?.sensitive === true || msgCtx?.pane === "auth"));
        const note = !sensitive && view === "Notes" ? yield* notesSelection() : undefined;
        const selectedObject = note ?? (view === "Settings" ? { kind: "settings", id: pageState.page } : undefined);
        const snapshotJson = JSON.stringify({
          view,
          title: node.ownerDocument.title || view,
          ...(view === "Settings" ? { section: pageState.page } : {}),
          ...(selectedObject === undefined ? {} : { selectedObject }),
        });
        yield* publishForegroundContext({
          view,
          route: view === "Settings" ? `/${pageState.page.toLowerCase()}` : `/${view.toLowerCase()}`,
          snapshotJson,
          sensitive,
          leaseMs: DEFAULT_CONTEXT_LEASE_MS,
        });
      });
      const contextSources = [
        Stream.as(pages.changes, undefined),
        Stream.as(bridge.changes, undefined),
        Stream.as(noteSubjects, undefined),
      ];
      const syncContext = Effect.andThen(
        publishContext,
        Stream.runForEach(Stream.mergeAll(contextSources, { concurrency: "unbounded" }), () => publishContext),
      );
      yield* Effect.all([syncSibling, syncContext], { concurrency: "unbounded" });
    }));
    const win = node.ownerDocument.defaultView;
    const onRootBack = () => {
      if (node.ownerDocument.documentElement.dataset.alphaCanGoBack !== "true") finishThinAppTask();
    };
    win?.addEventListener("alpha-back", onRootBack);
    return () => {
      win?.removeEventListener("alpha-back", onRootBack);
      appFiber.interruptUnsafe();
      stopApp();
      stopChrome();
    };
  }, [alpha, send, view]);
  return (
    <ShellLayerHost alpha={alpha} portalContainer={portalNode}>
      <main
        ref={appRef}
        data-alpha-surface="app"
        data-alpha-view={view}
        data-alpha-native={phone ? "" : undefined}
        style={canvas?.covered ? { height: canvas.visible } : undefined}
        className={cn(
          "relative mx-auto flex h-dvh w-full flex-col overflow-hidden bg-background font-sans text-base text-foreground [--alpha-call-inset-top:max(var(--alpha-native-inset-top,0px),env(safe-area-inset-top))] has-[[data-alpha-camera-native]]:bg-transparent in-data-[alpha-browser-under]:bg-transparent in-data-[alpha-browser-under]:bg-[linear-gradient(to_bottom,var(--background)_var(--alpha-browser-under-top),transparent_0_var(--alpha-browser-under-bottom),var(--background)_0),linear-gradient(to_right,var(--background)_var(--alpha-browser-under-left),transparent_0_var(--alpha-browser-under-right),var(--background)_0)] has-[[data-alpha-call-strip=over]]:pt-[calc(var(--alpha-call-inset-top)_+_4rem)]",
          view === "Camera" && "bg-camera-panel",
          !phone && "sm:pointer-fine:max-w-103 sm:pointer-fine:border-x sm:pointer-fine:border-border/60",
        )}
      >
        <div
          data-alpha-shell-page=""
          data-alpha-comms-stage={comms ? "" : undefined}
          ref={(node) => {
            const root = node?.ownerDocument.documentElement;
            if (root && root.dataset.alphaCanGoBack !== canGoBack) root.dataset.alphaCanGoBack = canGoBack;
          }}
          className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-auto overscroll-contain in-[main:has([data-alpha-call-strip=over])]:[--alpha-native-inset-top:0px]"
          inert={inert}
        >
          {comms && alpha.slot("phone/stage")}
          {!viewHasHeader(view) && <AppHeader
            title={views[view].label}
            leading={hasStepBack && <AppBack alpha={alpha} />}
            className="shrink-0"
          />}
          {alpha.slot(`view:${view}`)}
        </div>
        <SurfaceChrome alpha={alpha} setPortalNode={setPortalNode} />
      </main>
    </ShellLayerHost>
  );
}

/**
 * Alpha: Home, or the app on top of the trail under its title, with Back offered exactly when the rules allow it, and
 * over them Ask Alpha, whatever covers the screen, and the notices. Each screen is its area's, drawn at its place.
 * One startup cover, the white page with the Alpha mark, stays over it until what shows under it is ready, kept at one
 * place so its fade never starts over: v119 drew one cover for the whole start (45f6bed30 apps/app/src/main.tsx:357).
 * The apps share one layer, as v119's did (45f6bed30 prototype/template.html:130): it rises over Home when an app opens
 * from Home, with Home showing under it until the rise ends or is cancelled; an app opened from another, and Back, swap
 * in it at once, except that while Ask Alpha rests at its sheet a switch of communications apps slides in, as v119's
 * stage did (45f6bed30 prototype/model.js:5759-5785).
 * @model spec/app/shell/index.md
 */
export function App({ alpha, surface }: AppProps) {
  const resolved = surface ?? currentSurface();
  switch (resolved.mode) {
    case "overlay":
      return <OverlaySurface alpha={alpha} />;
    case "app":
      return <AppSurface alpha={alpha} view={resolved.view} />;
    case "monolith":
      return <MonolithApp alpha={alpha} />;
  }
}

function MonolithApp({ alpha }: { readonly alpha: Alpha }) {
  const { state, cause, can } = useMachine(alpha.runtime);
  const layers = useLayers(alpha.runtime).state;
  const page = usePage(alpha.runtime).state;
  const canvas = useCanvas(alpha.runtime).state;
  const fitted = useSyncExternalStore(desktopPreview.subscribe, desktopPreview.snapshot, () => undefined);
  const phone = native();
  const preview = phone ? undefined : fitted;
  const launcher = canvas?.launcher ?? false;
  const coarse = useSyncExternalStore(watchPrimaryPointer, coarsePointer, () => false);
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null);
  const [switchFailed, setSwitchFailed] = useState(false);
  const frame = useCallback((node: HTMLElement | null) => {
    if (node) return watchChrome(node, (event) => { void alpha.runtime.runPromise(measureChrome(event)); });
  }, [alpha]);
  const updating = page !== undefined && dialogShown(page);
  const { read: signedIn, flow: signInFlow } = useFirstRun(alpha, state !== undefined && cause === undefined && page !== undefined && editorsMounted(page) && !updating);
  const signingIn = alpha.requiresSignIn && signedIn?.stage !== "Admitted";
  const access = useAccess(alpha.runtime).state;
  const enrolled = alpha.requiresSignIn && signedIn?.accountConfirmed === true;
  const accessCovered = !state || cause !== undefined || !page || !layers
    || accessCoveredAt(state, pageInert(layers), updating || !editorsMounted(page));
  const accessHolding = enrolled && (!access || !access.begun || !accessCompleted(access) || access.finish.allSet);
  const accessMayShow = accessHolding && !accessCovered;
  const accessStage = access !== undefined && accessPanel(access);
  const accessShowing = accessMayShow && (accessStage === "Walkthrough" || accessStage === "AllSet");
  const [homeShown, setHomeShown] = useState(() => !alpha.slot("home"));
  const homeLayer = useCallback((node: HTMLDivElement | null) => {
    const main = node?.closest("main");
    if (!main || homeShown) return;
    const stop = new AbortController();
    void alpha.runtime.runPromise(firstFrame(main), { signal: stop.signal }).then(() => setHomeShown(true), () => undefined);
    return () => stop.abort();
  }, [alpha, homeShown]);
  const emergencyCall = useComms(alpha.runtime).state?.emergency === true;
  const { overHome, holdLayer, risenOver, choosing } = useAppLayer(state, canvas?.landscape === true, emergencyCall);
  const shellFailed = cause !== undefined;
  const showing = state?.trail.at(-1);
  const swipeBlocked = !state || shellFailed || signingIn || accessHolding || state.textAsk.tag === "TextAskVisit";
  const swipeOwner = state ? `${showing ?? "home"}:${state.assistant}:${launcher}:${state.textAskThrough}` : "";
  const swipeHandlers = useShellSwipe(alpha, swipeBlocked, launcher, swipeOwner);
  const pageReady = state !== undefined && cause === undefined && page !== undefined && editorsMounted(page) && !updating;
  const signInWaits = signingIn && (!signedIn || signedIn.stage === "Checking" || !signInFlow);
  const cover = !updating && cause === undefined
    && (!pageReady || signInWaits || (accessMayShow && !accessShowing) || (!signingIn && !accessHolding && !homeShown))
    ? <StartupMark key="startup" className="fixed inset-0 z-sheet" /> : null;
  if (!state) {
    if (updating) return <>{alpha.slot("overlay")}</>;
    const asHome = launcher || launcherBeforeMount();
    return cause
      ? <StartupFailureScreen
          kind="FailedToStart"
          platform={phone ? "android" : "web"}
          version={versions().app}
          asHome={asHome}
          switchFailed={switchFailed}
          onReload={reloadBeforeMount}
          onSwitchHome={asHome ? () => {
            void alpha.runtime.runPromise(openHomeSettings()).then((ok) => { if (!ok) setSwitchFailed(true); }, () => setSwitchFailed(true));
          } : undefined}
        />
      : <ShellLayerHost alpha={alpha} portalContainer={portalNode}>{null}{cover}</ShellLayerHost>;
  }
  const inert = shellFailed || (layers !== undefined && pageInert(layers));
  const comms = isCommsView(showing);
  const side = state.textAsk.tag === "NoTextAsk" && showing === undefined && canvas?.landscape === true && (phone || coarse);
  const nativeHomeSide = phone && side;
  const inboxLandscapeBar = !phone && showing === "Inbox" && state.assistant === "Bar" && state.textAsk.tag === "NoTextAsk"
    && canvas?.landscape === true && coarse;
  const fullScreen = state.assistant === "Full" && (phone || !side);
  const sheetBeside = layers !== undefined && !shellFailed && (!inert || addLayerAt(layers, state.route, true) !== undefined)
    && adjacentAskSheet(state, landscapeHomeInput(canvas));
  const voiceOverHome = phone && side && canvas?.voice === true;
  const strip = comms && fullScreen;
  const back = !shellFailed && can({ type: "goBack" });
  const canGoBack = String(!shellFailed && (accessMayShow || (signingIn ? canLeaveSignInStep(signedIn, signInFlow)
    : back || state.textAsk.tag === "TextAskVisit" || (layers !== undefined && takesBack(layers)))));
  const frameStyle = preview
    ? { left: preview.left, top: preview.top, width: preview.width, height: preview.height, transform: `scale(${preview.scale})`, transformOrigin: "top left" }
    : canvas?.covered ? { height: canvas.visible } : undefined;
  return (
    <ShellLayerHost alpha={alpha} portalContainer={portalNode}>
      <main
        data-alpha-native={phone ? "" : undefined}
        data-alpha-launcher={launcher ? "" : undefined}
        data-alpha-desktop-preview={preview ? "" : undefined}
        ref={frame}
        {...swipeHandlers}
        onMouseDownCapture={(event) => choosing(event, false)}
        onKeyDownCapture={(event) => choosing(event, false)}
        onFocusCapture={(event) => choosing(event, true)}
        style={frameStyle}
        className={cn("relative mx-auto flex h-dvh w-full flex-col overflow-hidden bg-background font-sans text-base text-foreground [--alpha-call-inset-top:max(var(--alpha-native-inset-top,0px),env(safe-area-inset-top))] has-[[data-alpha-camera-native]]:bg-transparent in-data-[alpha-browser-under]:bg-transparent in-data-[alpha-browser-under]:bg-[linear-gradient(to_bottom,var(--background)_var(--alpha-browser-under-top),transparent_0_var(--alpha-browser-under-bottom),var(--background)_0),linear-gradient(to_right,var(--background)_var(--alpha-browser-under-left),transparent_0_var(--alpha-browser-under-right),var(--background)_0)] has-[[data-alpha-call-strip=over]]:pt-[calc(var(--alpha-call-inset-top)_+_4rem)]", showing === "Camera" && "bg-camera-panel", !phone && "sm:pointer-fine:max-w-103 sm:pointer-fine:border-x sm:pointer-fine:border-border/60", side && "flex-row", nativeHomeSide && "gap-4 [--alpha-home-ask-width:min(400px,46%)]", preview && "absolute m-0 rounded-panel")}
      >
        <div
          data-alpha-shell-page=""
          data-alpha-comms-stage={comms ? "" : undefined}
          ref={(node) => {
            const document = node?.ownerDocument.documentElement;
            if (document && document.dataset.alphaCanGoBack !== canGoBack) document.dataset.alphaCanGoBack = canGoBack;
          }}
          className={cn(
            "relative flex min-h-0 min-w-0 flex-1 flex-col in-[main:has([data-alpha-call-strip=over])]:[--alpha-native-inset-top:0px] in-[main:has([data-alpha-call-strip=over])]:[--alpha-safe-top:0px]",
            showing !== undefined && "overflow-auto overscroll-contain",
            strip && "overflow-hidden",
            nativeHomeSide && "[--alpha-dock-overlap:0px]",
            nativeHomeSide && !launcher && "[&_[data-alpha-apps-drawer]]:top-0",
          )}
          inert={signingIn ? updating : inert || fullScreen || voiceOverHome}
        >
          {signingIn && !updating ? <SignIn alpha={alpha} read={signedIn} state={signInFlow} /> : null}
          {!signingIn && !accessHolding && comms && alpha.slot("phone/stage")}
          {signingIn || accessHolding || page === undefined || !editorsMounted(page) ? null : (
            <>
              <div
                key="home"
                ref={homeLayer}
                data-alpha-home-layer=""
                inert={showing !== undefined || undefined}
                className={cn(
                  showing === undefined ? "contents" : "absolute inset-0 isolate flex flex-col",
                  showing !== undefined && (comms || !overHome ? "invisible" : "motion-reduce:invisible in-data-[alpha-browser-under]:invisible"),
                )}
              >
                {alpha.slot("home")}
              </div>
              {showing !== undefined && (
                <div
                  ref={holdLayer}
                  onAnimationEnd={(event) => { if (event.target === event.currentTarget) risenOver(); }}
                  className={cn("relative flex min-h-0 flex-1 flex-col motion-safe:animate-rise has-[[data-alpha-camera-native]]:bg-transparent in-data-[alpha-browser-under]:bg-transparent", showing === "Camera" ? "bg-camera-panel" : "bg-background")}
                >
                  {!viewHasHeader(showing) && <AppHeader
                    title={views[showing].label}
                    leading={back && <AppBack alpha={alpha} />}
                    className="mt-[var(--alpha-safe-top)] shrink-0 in-data-[alpha-launcher]:mt-[max(--spacing(11),var(--alpha-safe-top))]"
                  />}
                  {alpha.slot(`view:${showing}`)}
                </div>
              )}
            </>
          )}
          {!phone && <BrowserFrames alpha={alpha} preview={preview} />}
        </div>
        {accessShowing ? <AccessWalkthrough runtime={alpha.runtime} /> : null}
        <div
          data-alpha-assistant-host=""
          hidden={signingIn || accessHolding || !askAlphaDrawn(state)}
          className={cn(
            "in-[body:has([data-alpha-notes-trash-sheet])]:invisible",
            "in-[body:has([data-alpha-subview=photos-clip-editor])]:invisible",
            "in-[body:has([data-alpha-covers-assistant])]:invisible",
            comms && "shrink-0",
            sheetBeside && "[&>[data-alpha-chat-scrim]]:hidden",
            !comms && "[&>[data-alpha-detent]]:absolute [&>[data-alpha-detent]]:inset-x-0 [&>[data-alpha-detent]]:bottom-0 [&>[data-alpha-detent]]:max-w-none",
            phone && canvas?.landscape && showing !== undefined && !comms && [
              "[&&>[data-alpha-detent]]:start-auto [&>[data-alpha-detent]]:w-[min(400px,46%)]",
              "[&&>[data-alpha-detent]:not([data-alpha-detent=bar])]:h-full [&>[data-alpha-detent]:not([data-alpha-detent=bar])]:max-h-full",
              "[&>[data-alpha-detent]:not([data-alpha-detent=bar])]:rounded-none [&>[data-alpha-detent]:not([data-alpha-detent=bar])]:shadow-none",
            ],
            inboxLandscapeBar && "[&&>[data-alpha-detent=bar]]:start-auto [&>[data-alpha-detent=bar]]:w-[min(400px,46%)]",
            side && [
              "relative flex w-[var(--alpha-home-ask-width,min(400px,46%))] shrink-0 flex-col justify-end",
              "[&>[data-alpha-detent=sheet]]:inset-0 [&>[data-alpha-detent=sheet]]:h-full [&>[data-alpha-detent=sheet]]:max-h-full",
              "[&>[data-alpha-detent=full]]:inset-0",
            ],
            nativeHomeSide && [
              "[&>[data-alpha-detent=bar]>[data-host-chrome]]:ml-0",
              "[&>[data-alpha-detent]_[data-alpha-composer]]:min-h-[min(168px,28dvh)] [&>[data-alpha-detent]_[data-alpha-composer]]:rounded-none",
              "[&>[data-alpha-detent]:not([data-alpha-detent=bar])]:h-full! [&>[data-alpha-detent]:not([data-alpha-detent=bar])]:rounded-none [&>[data-alpha-detent]:not([data-alpha-detent=bar])]:shadow-none",
            ],
          )}
          inert={shellFailed || (layers !== undefined && assistantInert(layers))}
        >
          {!signingIn && !accessHolding && alpha.slot("assistant")}
        </div>
        <div data-alpha-top-alerts="" className="pointer-events-none fixed inset-x-0 top-[var(--alpha-safe-top)] z-alert mx-auto flex max-w-103 flex-col gap-2 px-3 pt-2 *:pointer-events-auto">
          {alpha.slot("overlay")}
        </div>
        {alpha.slot("notice")}
        {shellFailed && !updating && <Alert variant="destructive" className="absolute inset-x-4 top-[max(--spacing(3),var(--alpha-safe-top))] z-dialog">Alpha could not read where you were</Alert>}
        <div ref={setPortalNode} data-alpha-portal-root="" className="contents" />
      </main>
      {cover}
    </ShellLayerHost>
  );
}
