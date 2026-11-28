import { AppHeader, Skeleton } from "@repo/ui";
import { Context, Effect, Layer, Stream } from "effect";
import { type ComponentType, type ReactElement, Suspense, useSyncExternalStore } from "react";
import { captureReviewedDraft, MediaHandoff, stageAttachment, stageTranscript } from "./assistant/attachments.vibe";
import { readPage, stopPage } from "./assistant/read-aloud.vibe";
import { executeMedia } from "./assistant/media-executors.ts";
import { FileContext } from "./assistant/file-context.vibe";
import { MapsContext } from "./assistant/maps-context.vibe";
import { Machine as Shell, showing } from "../gen/app__shell.effect.vibe";
import type { View } from "../gen/app__shell.ts";
import { Machine as Layers, pageInert } from "../gen/app__shell__layers.effect.vibe";
import { MediaExecutors } from "./assistant/media-review.vibe";
import { type Mount, type Place, mounts as every } from "./areas.ts";
import { CalendarReviews } from "./calendar/reviews.vibe";
import { ScanExports } from "./files/scanEntry.vibe";
import { InboxCardEntry } from "./home/cards.vibe";
import { homeFrame } from "./home/firstFrame.ts";
import { AgentPages, BrowserDownloadsHandoff, InboxBrowserLinks } from "./platform/browser.vibe";
import { launchSiblingApp, openAlphaOverlay, openAppViaOverlay } from "./platform/contextBridge.vibe";
import { Device } from "./platform/device.vibe";
import type { Platform } from "./platform/platform.vibe";
import { resident } from "./resident.vibe";
import type { Alpha, Area } from "./runtime/area.tsx";
import { Contained } from "./runtime/contained.tsx";
import { rooted } from "./runtime/root.vibe";
import { AppBack } from "./shell/AppBack.tsx";
import { accessCover, startupAccessLifecycle } from "./startup/settingsAccess.vibe";
import { startupSignIn, StartupSignIn } from "./startup/signIn.vibe";
import * as Access from "../gen/app__startup__access.effect.vibe";
import { back, taking } from "./shell/shell.vibe";
import { viewHasHeader, views } from "./shell/views.tsx";
import { currentSurface } from "./surface.ts";

function ViewLoading({ alpha, place }: { alpha: Alpha; place: `view:${View}` }) {
  const view = place.slice("view:".length) as View;
  const label = views[view]?.label ?? view;
  return (
    <div role="status" aria-label={`Loading ${label}`} className="flex min-h-0 flex-1 flex-col bg-background pt-[var(--alpha-safe-top)] text-foreground">
      {viewHasHeader(view) && <AppHeader title={label} leading={<AppBack alpha={alpha} />} className="shrink-0" />}
      <div className="mx-auto flex w-full max-w-(--breakpoint-md) flex-col gap-3 px-4 py-4">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-4/5 rounded-xl" />
        <Skeleton className="h-12 w-3/5 rounded-xl" />
      </div>
    </div>
  );
}

/** How long an idle moment may wait before a screen's chunk is fetched anyway, in milliseconds. */
const idleWait = 2000;

/**
 * The screen of `mount`, opened the first time it is drawn (on commit via external store subscription, never during render),
 * and shown once the runtime opening it made is built, so its machines have started and it never draws a state they have
 * not reached (an unread month, an owner not known yet); at once on every later draw. A runtime that fails to build shows
 * the screen too, whose machines then say so. One whose chunk cannot be loaded, or that cannot be opened, throws to its
 * Contained; a chunk that failed is fetched again on the next draw. Unlike React's lazy, no Suspense reveal throttle
 * holds a screen that is ready.
 */
function openedScreen(
  mount: Mount,
  fetched: ReadonlyMap<Mount, Area>,
  fetch: (mount: Mount) => Promise<Area>,
  openWith: (loaded: Area, at: Place) => { Screen?: ComponentType; broken?: { cause: unknown }; built: Promise<void> },
): ComponentType {
  let Opened: ComponentType | undefined;
  let broken: { cause: unknown } | undefined;
  let built: Promise<void> | undefined;
  let ready = false;
  type ShownState = { readonly Screen?: ComponentType; readonly failed?: { cause: unknown } };
  let snapshot: ShownState = {};
  const listeners = new Set<() => void>();
  const setSnapshot = (next: ShownState) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const open = (loaded: Area): Promise<void> => {
    if (built) return built;
    const opened = openWith(loaded, mount.at);
    Opened = opened.Screen;
    broken = opened.broken;
    built = opened.built.then(() => { ready = true; }, () => { ready = true; });
    return built;
  };
  let inFlight = false;
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    if (broken) {
      if (snapshot.failed !== broken) setSnapshot({ failed: broken });
    } else if (ready && Opened) {
      if (snapshot.Screen !== Opened) setSnapshot({ Screen: Opened });
    } else if (!inFlight) {
      inFlight = true;
      const reveal = (loaded: Area) => {
        void open(loaded).then(() => {
          inFlight = false;
          setSnapshot(broken ? { failed: broken } : { Screen: Opened });
        });
      };
      const loaded = fetched.get(mount);
      if (loaded) reveal(loaded);
      else void fetch(mount).then(reveal, (cause: unknown) => {
        inFlight = false;
        setSnapshot({ failed: { cause } });
      });
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && snapshot.failed && !broken) snapshot = {};
    };
  };
  const getSnapshot = () => snapshot;
  return function Later() {
    const shown = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    if (shown.failed) throw shown.failed.cause;
    return shown.Screen ? <shown.Screen /> : null;
  };
}

/** Builds the cross-area handoff and context layers shared by the root runtime. */
function crossAreaLayers(getAlpha: () => Alpha) {
  const media = Layer.succeed(MediaHandoff, {
    attach: (file, current, suggestion) => Effect.suspend(() => {
      if (currentSurface().mode === "app") {
        return openAlphaOverlay("media-handoff", suggestion, false);
      }
      return Effect.promise(async () => {
        const { default: assistant } = await import("./assistant/index.tsx");
        return assistant.runtime(getAlpha()).runPromise(stageAttachment(file, current, suggestion));
      }).pipe(Effect.catchCause(() => Effect.succeed(false)));
    }),
    offerTranscript: (transcript) => Effect.suspend(() => {
      if (currentSurface().mode === "app") {
        return openAlphaOverlay("transcript-handoff", `Summarize "${transcript.title}"`, false);
      }
      return Effect.promise(async () => {
        const { default: assistant } = await import("./assistant/index.tsx");
        return assistant.runtime(getAlpha()).runPromise(stageTranscript(transcript));
      }).pipe(Effect.catchCause(() => Effect.succeed(false)));
    }),
    reviewedDraft: () => Effect.promise(async () => {
      const { default: assistant } = await import("./assistant/index.tsx");
      return assistant.runtime(getAlpha()).runPromise(captureReviewedDraft());
    }).pipe(Effect.catchCause(() => Effect.succeed(undefined))),
    offerPageSpeech: (speech) => Effect.promise(async () => {
      const { default: assistant } = await import("./assistant/index.tsx");
      return assistant.runtime(getAlpha()).runPromise(readPage(speech));
    }).pipe(Effect.catchCause(() => Effect.succeed(false))),
    stopPageSpeech: (item, source) => Effect.promise(async () => {
      const { default: assistant } = await import("./assistant/index.tsx");
      return assistant.runtime(getAlpha()).runPromise(stopPage(item, source));
    }).pipe(Effect.ignoreCause),
  });
  const executors = Layer.succeed(MediaExecutors, {
    filesContext: () => Effect.tryPromise(async () => {
      const [{ default: files }, { filesReadContext }] = await Promise.all([import("./files/index.tsx"), import("./files/agent.vibe")]);
      return files.runtime(getAlpha()).runPromise(filesReadContext);
    }).pipe(Effect.orElseSucceed(() => undefined)),
    readyFiles: () => Effect.tryPromise(async (signal) => {
      const [{ default: files }, { readyFilesReadContext }] = await Promise.all([import("./files/index.tsx"), import("./files/agent.vibe")]);
      return files.runtime(getAlpha()).runPromise(readyFilesReadContext, { signal });
    }).pipe(Effect.orElseSucceed(() => undefined)),
    reviewFiles: (operation) => Effect.tryPromise(async () => {
      const [{ default: files }, { reviewFileAction }] = await Promise.all([import("./files/index.tsx"), import("./files/agent.vibe")]);
      return files.runtime(getAlpha()).runPromise(reviewFileAction(operation));
    }).pipe(Effect.orElseSucceed(() => undefined)),
    execute: (operation, call, authority) => Effect.tryPromise(() => executeMedia(getAlpha(), operation, call, authority)).pipe(Effect.orElseSucceed(() => undefined)),
  });
  const filesShowing = Effect.gen(function* () {
    const shell = yield* Shell;
    const layers = yield* Layers;
    const device = yield* Device;
    return (yield* device.showing()) && showing(yield* shell.get(), "Files") && !pageInert(yield* layers.get());
  });
  const inFiles = <A,>(read: (signal: AbortSignal) => Promise<A | undefined>) => Effect.tryPromise(async (signal) => {
    const alpha = getAlpha();
    if (!(await alpha.runtime.runPromise(filesShowing, { signal }))) return undefined;
    const result = await read(signal);
    return (await alpha.runtime.runPromise(filesShowing, { signal })) ? result : undefined;
  }).pipe(Effect.orElseSucceed(() => undefined));
  const fileContext = Layer.succeed(FileContext, {
    selected: () => inFiles(async (signal) => {
      const [{ default: files }, { selectedTextContext }] = await Promise.all([import("./files/index.tsx"), import("./files/preview.vibe")]);
      return files.runtime(getAlpha()).runPromise(selectedTextContext(), { signal });
    }),
    read: (expected) => inFiles(async (signal) => {
      const [{ default: files }, { readCurrentFileText }] = await Promise.all([import("./files/index.tsx"), import("./files/preview.vibe")]);
      return files.runtime(getAlpha()).runPromise(readCurrentFileText(expected), { signal });
    }),
  });
  const downloads = Layer.succeed(BrowserDownloadsHandoff, {
    open: () => Effect.suspend(() => {
      if (currentSurface().mode === "app") {
        return Effect.asVoid(launchSiblingApp("Files", "alpha://files/downloads", JSON.stringify({ view: "Files", section: "downloads" })));
      }
      return Effect.tryPromise(async () => {
        const [{ default: files }, { showBrowserDownloads }] = await Promise.all([import("./files/index.tsx"), import("./files/files.vibe")]);
        await files.runtime(getAlpha()).runPromise(showBrowserDownloads);
      }).pipe(Effect.orElseSucceed(() => undefined));
    }),
  });
  const agentPages = Layer.succeed(AgentPages, {
    open: (page, current) => Effect.suspend(() => {
      if (currentSurface().mode === "overlay") {
        const payload = JSON.stringify({
          view: "Browser",
          action: "browser_open",
          url: page.operation.url,
          atOnce: page.atOnce,
        });
        return openAppViaOverlay("alpha://browser/open", undefined, payload);
      }
      return Effect.tryPromise(async () => {
        const [{ default: browser }, { openAgentPage }] = await Promise.all([import("./browser/index.tsx"), import("./browser/agent.vibe")]);
        return browser.runtime(getAlpha()).runPromise(openAgentPage({ ...page, current }));
      }).pipe(Effect.orElseSucceed(() => false));
    }),
  });
  const inboxLinks = Layer.succeed(InboxBrowserLinks, {
    open: (href, current) => Effect.suspend(() => {
      if (currentSurface().mode === "app") {
        const payload = JSON.stringify({ view: "Browser", action: "open_link", url: href, from: "Inbox" });
        return launchSiblingApp("Browser", "alpha://browser/open", payload);
      }
      return Effect.tryPromise(async (signal) => {
        const [{ default: browser }, { openMessageLink }] = await Promise.all([import("./browser/index.tsx"), import("./browser/browser.vibe")]);
        return browser.runtime(getAlpha()).runPromise(openMessageLink(href, "Inbox", current), { signal });
      }).pipe(Effect.orElseSucceed(() => false));
    }),
  });
  const mapsContext = Layer.succeed(MapsContext, {
    selected: () => Effect.tryPromise(async (signal) => {
      const [{ default: maps }, { mapsSelected }] = await Promise.all([import("./maps/index.tsx"), import("./maps/agent.vibe")]);
      return maps.runtime(getAlpha()).runPromise(mapsSelected(), { signal });
    }).pipe(Effect.orElseSucceed(() => undefined)),
  });
  const inboxCard = Layer.succeed(InboxCardEntry, {
    prepare: () => Effect.tryPromise(async (signal) => {
      const [{ default: inbox }, { prepareInboxCardEntry }] = await Promise.all([import("./inbox/index.tsx"), import("./inbox/message.vibe")]);
      const runtime = inbox.runtime(getAlpha());
      const enter = await runtime.runPromise(prepareInboxCardEntry(), { signal });
      return (route: number) => Effect.promise((signal) => runtime.runPromise(enter(route), { signal })).pipe(Effect.ignoreCause);
    }).pipe(Effect.orElseSucceed(() => undefined)),
  });
  const scans = Layer.succeed(ScanExports, {
    record: (selection) => Effect.tryPromise(async () => {
      const [{ default: files }, { retainScanExport }] = await Promise.all([import("./files/index.tsx"), import("./files/scan.vibe")]);
      await files.runtime(getAlpha()).runPromise(retainScanExport(selection));
    }).pipe(Effect.orElseSucceed(() => undefined)),
  });
  const calendarReviews = Layer.succeed(CalendarReviews, {
    relist: () => Effect.tryPromise(async () => {
      const [{ default: calendar }, { relistRequests }] = await Promise.all([import("./calendar/index.tsx"), import("./calendar/agent.vibe")]);
      await calendar.runtime(getAlpha()).runPromise(relistRequests);
    }).pipe(Effect.orElseSucceed(() => undefined)),
  });
  return Layer.mergeAll(media, executors, fileContext, mapsContext, downloads, agentPages, inboxLinks, inboxCard, scans, calendarReviews);
}

/**
 * Alpha over `platform`: one root runtime of the resident machines, and each screen of `mounts` at its place, opened
 * when it is first drawn, and contained: one that throws or cannot be loaded stops alone. Each screen's code is a chunk
 * of its own; once Home's first frame is drawn the chunks are fetched one per idle moment (and a tile's on a press), so
 * an app's first open waits only for its machines to start, not for its code, closer to v119, whose one bundle held
 * every view (45f6bed30 apps/app/src/main.tsx).
 */
export function boot(platform: Layer.Layer<Platform>, mounts: readonly Mount[] = every, requireNativeSignIn = false): Alpha {
  /** Late-bound StartupSignIn forwarded to the resident layer while the root is being built. */
  let builtSignIn: Context.Service.Shape<typeof StartupSignIn> | undefined;
  const signedIn = () => {
    if (builtSignIn === undefined) throw new Error("StartupSignIn was read before the root was built");
    return builtSignIn;
  };
  const lateSignIn = Layer.succeed(StartupSignIn, {
    changes: Stream.unwrap(Effect.sync(() => signedIn().changes)),
    shelf: () => Effect.suspend(() => signedIn().shelf()),
    clock: () => Effect.suspend(() => signedIn().clock()),
    active: () => Effect.suspend(() => signedIn().active()),
    confirmedAccount: () => Effect.suspend(() => signedIn().confirmedAccount()),
    check: () => Effect.suspend(() => signedIn().check()),
    touch: () => Effect.suspend(() => signedIn().touch()),
    openNetwork: () => Effect.suspend(() => signedIn().openNetwork()),
    send: (method, address) => Effect.suspend(() => signedIn().send(method, address)),
    chooseGoogle: () => Effect.suspend(() => signedIn().chooseGoogle()),
    verify: (code) => Effect.suspend(() => signedIn().verify(code)),
    resend: () => Effect.suspend(() => signedIn().resend()),
    back: () => Effect.suspend(() => signedIn().back()),
    useLocalMode: () => Effect.suspend(() => signedIn().useLocalMode()),
  });
  const signIn = Layer.tap(startupSignIn(requireNativeSignIn), (context) => Effect.sync(() => { builtSignIn = Context.get(context, StartupSignIn); }));
  const startup = Layer.provideMerge(startupAccessLifecycle(requireNativeSignIn), Layer.provideMerge(signIn, Layer.provideMerge(resident, lateSignIn)));
  const root = rooted(Layer.provideMerge(startup, Layer.merge(platform, crossAreaLayers(() => alpha))));
  const placed = new Map<Place, ReactElement[]>();
  /** The runtimes `over` makes while a screen is being opened. */
  let making: Array<{ context: () => Promise<unknown> }> | undefined;
  const alpha: Alpha = {
    runtime: root.runtime,
    over: (layer) => {
      const made = root.over(layer);
      making?.push(made);
      return made;
    },
    slot: (place) => placed.get(place),
    back: () => root.runtime.runPromiseExit(back()),
    requiresSignIn: requireNativeSignIn,
    taking: (place, took) => void root.runtime.runPromiseExit(taking(place, took)),
    dispose: () => {
      quiet();
      return root.dispose();
    },
  };
  if (requireNativeSignIn) alpha.taking("startup/sign-in", () => root.runtime.runPromise(StartupSignIn.use((signIn) => Effect.gen(function* () {
    if (yield* signIn.active()) {
      yield* signIn.back();
      return true;
    }
    const covered = yield* accessCover();
    const current = () => Effect.runSync(signIn.confirmedAccount()) && !covered();
    if (!current()) return false;
    const permissions = yield* Access.Machine;
    const access = yield* permissions.get();
    if (Access.canDone(access, "Owner")) {
      const done = yield* Effect.exit(permissions.send({ type: "done" }, "Owner", current));
      return done._tag === "Success";
    }
    return current() && !access.covered && (!access.begun || !Access.completed(access));
  }))));
  const stopped = (place: string, cause: unknown) => void root.runtime.runPromiseExit(Effect.logError(`the screen at ${place} stopped`, cause));
  const fetched = new Map<Mount, Area>();
  const fetching = new Map<Mount, Promise<Area>>();
  /** `mount`'s chunk, fetched once and never opened here; one that failed is fetched again when next asked. */
  const fetch = (mount: Mount): Promise<Area> => {
    const known = fetching.get(mount);
    if (known) return known;
    const loading = mount.load().then(({ default: loaded }) => {
      fetched.set(mount, loaded);
      return loaded;
    });
    fetching.set(mount, loading);
    void loading.catch(() => fetching.delete(mount));
    return loading;
  };
  const later = mounts.filter((mount) => mount.first === undefined);
  let idle: (() => void) | undefined;
  let prefetching = false;
  let disposed = false;
  /** The chunks the idle sweep has asked for: each once, so one that cannot be loaded is left to its first draw. */
  const swept = new Set<Mount>();
  /** Fetch the chunk at `place`, or with no place every chunk not fetched yet, one per idle moment, in the order of areas.ts. */
  const prefetch = (place?: Place) => {
    if (disposed) return;
    if (place !== undefined) {
      for (const mount of later) if (mount.at === place) void fetch(mount).catch(() => undefined);
      return;
    }
    if (prefetching) return;
    prefetching = true;
    const fiber = root.runtime.runFork(Effect.gen(function* () {
      for (const mount of later) {
        if (!prefetching || disposed) return;
        if (swept.has(mount) || fetched.has(mount)) continue;
        swept.add(mount);
        yield* Effect.sleep(idleWait);
        if (!prefetching || disposed) return;
        yield* Effect.ignore(Effect.promise(() => fetch(mount)));
      }
    }));
    idle = () => { fiber.interruptUnsafe(); };
  };
  const unserve = homeFrame.serve(prefetch);
  const unwatch = homeFrame.subscribe(() => { if (homeFrame.snapshot()) prefetch(); });
  if (homeFrame.snapshot()) prefetch();
  function quiet() {
    disposed = true;
    prefetching = false;
    idle?.();
    unserve();
    unwatch();
  }
  const openWith = (loaded: Area, at: Place) => {
    let Screen: ComponentType | undefined;
    let broken: { cause: unknown } | undefined;
    let built: Promise<void>;
    making = [];
    try {
      Screen = loaded.open(alpha, at);
    } catch (cause) {
      broken = { cause };
    } finally {
      const made = making ?? [];
      making = undefined;
      built = Promise.all(made.map((runtime) => runtime.context())).then(() => undefined, () => undefined);
    }
    return { Screen, broken, built };
  };
  for (const mount of mounts) {
    const Screen = mount.first?.open(alpha, mount.at) ?? openedScreen(mount, fetched, fetch, openWith);
    const isView = mount.at.startsWith("view:");
    const fallback = isView ? <ViewLoading alpha={alpha} place={mount.at as `view:${View}`} /> : null;
    const drawn = (
      <Contained key={`${mount.at} ${placed.get(mount.at)?.length ?? 0}`} place={mount.at} told={isView} onStopped={stopped}>
        <Suspense fallback={fallback}><Screen /></Suspense>
      </Contained>
    );
    placed.set(mount.at, [...(placed.get(mount.at) ?? []), drawn]);
  }
  return alpha;
}
