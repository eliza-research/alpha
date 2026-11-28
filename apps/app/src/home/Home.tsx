// spec/app/home/index.md, "Story: Open an app"; spec/app/home/index.md, "Story: Find an installed app in Apps"; spec/app/home/cards.md, "The row holds the agenda, Messages, Phone, Workflows, mail, Telegram, Slack and brief cards in that order, each only when drawn, and is not drawn when none is"; spec/app/home/index.md, "On the assistant alone Home shows no tile and no card"; spec/app/home/index.md, "Story: Edit Home"; spec/app/home/index.md, "Story: Pull down for notifications"
import type { InstalledApp } from "@elizaos/os-bridges";
import { AppsDrawer, type AppsDrawerProps, type DrawerApp, HomeScreen, type HomeTileItem, InstalledAppIcon } from "@repo/ui";
import { useCallback, useState, useSyncExternalStore } from "react";
import * as Home from "../../gen/app__home.ts";
import { useMachine as useHome } from "../../gen/app__home.react.ts";
import { useMachine as useDrawer } from "../../gen/app__home__drawer.react.ts";
import { type Tile, badged, ready, saving } from "../../gen/app__home__tiles.ts";
import { adjacentAskSheet, type View } from "../../gen/app__shell.ts";
import { useMachine as useLayers } from "../../gen/app__shell__layers.react.ts";
import { pageInert } from "../../gen/app__shell__layers.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import { useMachine as useCanvas } from "../../gen/app__shell__keyboard.react.ts";
import type { Resident, Shown } from "../runtime/ui.tsx";
import { untimed } from "../runtime/index.vibe";
import { homeEditFrame, landscapeHomeInput } from "../shell/index.vibe";
import { feel } from "../shell/index.vibe";
import { views } from "../shell/views.tsx";
import { useDayCards } from "./Cards.tsx";
import { homeFrame } from "./firstFrame.ts";
import { actOnAddHome, addLayerAt, openAddHome, reconcileAddHome } from "./addHome.vibe";
import { catalog, labelOf } from "./catalog.vibe";
import { type AppsInput, type HomeEditInput, actInApps, chooseApp, closeApps, editHome, openApps, openHomeFavorite, openOwnInApps, openOwnTile, told } from "./home.vibe";
import { launcherHeld, openNotifications, phoneLocked, watchHomePull } from "./pull.vibe";
import { waiting } from "./waiting.vibe";
import type { HomeMachines } from "./index.tsx";

const owner = "Owner" as const;
const noop = () => undefined;
const noSnapshot = () => null;

/** A tile's id on the screen: `view:<View>` for one of Alpha's own apps, `app:<key>` for an installed one. */
const idOf = (tile: Tile): string => (tile.tag === "Own" ? `view:${tile.view}` : `app:${tile.app}`);

const tileOf = (id: string): Tile => (id.startsWith("view:") ? { tag: "Own", view: id.slice("view:".length) as View } : { tag: "Installed", app: id.slice("app:".length) });

const imageOf = (app: InstalledApp | undefined): string | undefined =>
  app?.icon ? (app.icon.startsWith("data:") ? app.icon : `data:image/png;base64,${app.icon}`) : undefined;

const profileNames: Readonly<Record<NonNullable<InstalledApp["profile"]>, string>> = {
  work: "Work", private: "Private", clone: "Clone", other: "Other profile",
};

function drawerApp(id: string, app: InstalledApp): DrawerApp {
  return { id, label: app.label, packageName: app.packageName, activityName: app.activityName,
    profile: app.profile && profileNames[app.profile], locked: app.locked, user: app.user, image: imageOf(app) };
}

function tileItem(tile: Tile, known: ReadonlyMap<string, InstalledApp>, said?: string, editing = false): HomeTileItem {
  if (tile.tag === "Own") {
    const Glyph = views[tile.view].icon;
    const badge = badged(tile, said !== undefined, editing) ? said : undefined;
    return { id: idOf(tile), label: views[tile.view].label, icon: <Glyph className="size-7.5" />, ...(badge ? { badge } : {}) };
  }
  return { id: idOf(tile), label: labelOf(tile.app), icon: <InstalledAppIcon image={imageOf(known.get(tile.app))} /> };
}

/** Home: the day, its cards and the tiles kept on it, each control offered exactly when the rules allow its event. */
export function HomePage({ runtime, alpha }: Shown<HomeMachines | Resident>) {
  const home = useHome(runtime);
  const shell = useShell(alpha.runtime);
  const canvas = useCanvas(alpha.runtime).state;
  const layers = useLayers(alpha.runtime).state;
  const drawer = useDrawer(runtime);
  const known = useSyncExternalStore(catalog.subscribe, catalog.snapshot, catalog.snapshot);
  const inline = useSyncExternalStore(told.subscribe, told.snapshot, told.snapshot);
  const waits = useSyncExternalStore(waiting.subscribe, waiting.snapshot, waiting.snapshot);
  const h = home.state;
  const s = shell.state;
  const landscapePhone = landscapeHomeInput(canvas);
  const alongside = s !== undefined && Home.besideHomeSheet(s, landscapePhone);
  const { cards: day, settled } = useDayCards(runtime, s, alongside);
  const canPull = s !== undefined && home.can({ type: "pullDown", shell: s, locked: phoneLocked(), now: untimed }, owner);
  const [mount, setMount] = useState<{ frame: HTMLElement; current: () => boolean }>();
  const homeScroller = useCallback((node: HTMLDivElement | null) => {
    const frame = node?.closest("main");
    if (!node || !frame) return;
    let live = true;
    setMount({ frame, current: () => live && node.isConnected && frame.isConnected });
    const stopPull = canPull ? watchHomePull(node, () => { void runtime.runPromise(openNotifications()); }) : undefined;
    return () => {
      live = false;
      stopPull?.();
      void runtime.runPromiseExit(reconcileAddHome());
    };
  }, [canPull, runtime]);
  const hold = useCallback((held: () => void) => {
    const fiber = alpha.runtime.runFork(launcherHeld(held));
    return () => fiber.interruptUnsafe();
  }, [alpha]);
  const whole = h !== undefined && s !== undefined && (h.host === "AssistantOnly" || (ready(h.tiles) && (!Home.showsCards(h) || settled)));
  const markWhole = useCallback(() => {
    if (whole) homeFrame.drawn();
    return noop;
  }, [whole]);
  useSyncExternalStore(markWhole, noSnapshot, noSnapshot);
  if (!h || !s || h.host === "AssistantOnly") return null;
  const can = (event: Home.Event) => home.can(event, owner);
  const editVisible = Home.editSite(s, alongside) && homeEditFrame(canvas) && layers !== undefined && !pageInert(layers);
  const editing = h.editing && editVisible;
  const notice = inline && inline.place === Home.noticeAt(h, s, alongside) ? inline.notice : undefined;
  const beginEditing = { type: "beginEditing", shell: s, beside: alongside } as const;
  const mayEdit = editing && !saving(h.tiles);
  const addLayer = layers && h.adding && Home.editSite(s, alongside) && homeEditFrame(canvas)
    && (!alongside || mount !== undefined) ? addLayerAt(layers, s.route, alongside) : undefined;
  const add = { type: "showHidden", shell: s, beside: alongside } as const;
  const onShowHidden = editVisible && mount && can(add) ? () => {
    void runtime.runPromise(openAddHome(s.route, alongside, mount.current));
  } : undefined;
  const actOnEdit = (event: HomeEditInput) => runtime.runPromise(editHome(event, s.route, alongside));
  const offered = (event: HomeEditInput) => editVisible && can(event) ? () => { void actOnEdit(event); } : undefined;
  const showingApps = Home.offersDrawer(h) && s.drawer && Home.onPhone(h);
  const paired = showingApps && adjacentAskSheet(s, landscapePhone);
  const drawerActive = showingApps && layers !== undefined && !pageInert(layers) && s.textAsk.tag === "NoTextAsk"
    && (s.assistant === "Bar" || paired);
  const catalogApps = showingApps ? h.installed.apps.flatMap((id) => {
    const app = known.apps.get(id);
    return app && app.packageName !== "ai.alphacompute.alphaphone" ? [drawerApp(id, app)] : [];
  }) : [];
  // spec/app/home/index.md, "Apps also lists Alpha's own apps that are not on Home, and opens one as its tile would"
  const ownApps: DrawerApp[] = showingApps ? Home.drawerViews(h, s).map((view) => {
    const Glyph = views[view].icon;
    return { id: `view:${view}`, label: views[view].label, packageName: "", icon: <Glyph className="size-7.5" /> };
  }) : [];
  const opening = h.handoff.ask.tag !== "Shade" && h.handoff.attempt.outcome === "Sent" ? h.handoff.ask.app : undefined;
  const selected = drawer.state;
  const menuApp = selected?.menu;
  const act = (event: AppsInput) => {
    if (!drawerActive) return;
    void runtime.runPromise(actInApps(s.route, paired, event)).then((accepted) => {
      if (accepted && event.type === "openMenu") void alpha.runtime.runPromise(feel("LongPress"));
    });
  };
  const menu: AppsDrawerProps["menu"] = drawerActive && selected && menuApp && catalogApps.some(({ id }) => id === menuApp) ? {
    app: menuApp,
    actions: {
      onHome: h.tiles.favourites.some((tile) => tile.tag === "Installed" && tile.app === menuApp),
      add: home.can({ type: "pinInstalled", app: menuApp, shell: s, drawer: selected }, owner)
        ? () => { void runtime.runPromise(chooseApp(menuApp, "Pin", s.route, paired)); } : undefined,
      info: home.can({ type: "showAppInfo", app: menuApp, shell: s, drawer: selected, now: untimed }, owner)
        ? () => { void runtime.runPromise(chooseApp(menuApp, "Info", s.route, paired)); } : undefined,
      close: () => { if (drawer.can({ type: "closeMenu" })) act({ type: "closeMenu" }); },
    },
  } : undefined;
  const deck = (
    <HomeScreen
      launcher={h.host === "AsLauncher"}
      cards={Home.showsCards(h) ? day : []}
      appCards={Home.showsCards(h) && alpha.slot("home/cards")}
      tiles={ready(h.tiles) ? Home.tilesShown(h, s).map((tile) => ({
        ...tileItem(tile, known.apps, tile.tag === "Own" ? waits.get(tile.view) : undefined, h.editing),
        inert: tile.tag === "Installed" && !h.editing && !Home.favoriteAt(h, tile.app, s, alongside),
      })) : undefined}
      cardsInert={s.assistant !== "Bar" && (!alongside || h.editing)}
      appCardsInert={s.assistant !== "Bar"}
      drawerInert={s.assistant !== "Bar" && !alongside}
      covered={h.editing && !editVisible}
      held={s.trail.length > 0}
      editing={editing || (h.editing && addLayer !== undefined)}
      tileGestureScope={h.editing ? `${s.route}:${editVisible}:${editing}:${canvas?.width}:${canvas?.visible}` : "home"}
      onPressTile={(id) => { if (id.startsWith("view:")) homeFrame.want(id as `view:${View}`); }}
      onOpenTile={(id) => {
        const tile = tileOf(id);
        if (tile.tag === "Own") void runtime.runPromise(openOwnTile(tile.view, s.route, alongside));
        else void runtime.runPromise(openHomeFavorite(tile.app, s.route, alongside));
      }}
      onOpenDrawer={Home.offersDrawer(h) ? () => { void runtime.runPromise(openApps(s.route, alongside)); } : undefined}
      onBeginEditing={editVisible && can(beginEditing) ? () => { void actOnEdit(beginEditing).then((accepted) => {
        if (accepted) void alpha.runtime.runPromise(feel("LongPress"));
      }); } : undefined}
      hold={hold}
      onRemoveTile={mayEdit ? (id) => offered({ type: "removeFromHome", tile: tileOf(id), shell: s, beside: alongside })?.() : undefined}
      onMoveTile={mayEdit ? ({ id, onto, behind }) => offered({ type: "moveTile", tile: tileOf(id), onto: tileOf(onto), behind, shell: s, beside: alongside })?.() : undefined}
      scrollRef={homeScroller}
      onShowHidden={onShowHidden}
      onDone={offered({ type: "done" })}
      notice={notice}
      adding={addLayer !== undefined}
      addInFrame={alongside ? mount?.frame : undefined}
      hidden={Home.hiddenApps(h, s).map((view) => tileItem({ tag: "Own", view }, known.apps))}
      onAddToHome={addLayer !== undefined && !saving(h.tiles) ? (id) => { void runtime.runPromise(actOnAddHome(addLayer, tileOf(id))); } : undefined}
      onCloseAdding={addLayer === undefined ? undefined : () => { void runtime.runPromise(actOnAddHome(addLayer)); }}
    />
  );
  return (
    <>
      <div inert={showingApps || undefined} className="flex min-h-0 flex-1 flex-col">
        {deck}
      </div>
      {showingApps && (
        <AppsDrawer apps={[...ownApps, ...catalogApps]} query={drawer.state?.query ?? ""}
          catalog={h.installed.read.status === "Failed" ? "unavailable" : h.installed.read.status === "Loaded" ? "ready" : "reading"}
          opening={opening} notice={notice} hold={hold} menu={menu} modal={!paired} inactive={!drawerActive}
          onSearch={(query) => {
            const event = { type: "search", query, open: showingApps } as const;
            if (drawer.can(event)) act(event);
          }}
          onClose={() => { if (drawerActive) void runtime.runPromise(closeApps(s.route, paired)); }}
          onOpen={(app) => {
            const tile = app.startsWith("view:") ? tileOf(app) : undefined;
            if (tile?.tag !== "Own") act({ type: "openApp", app, now: untimed });
            else if (drawerActive) void runtime.runPromise(openOwnInApps(tile.view, s.route, paired));
          }}
          onOpenMenu={drawerActive ? (app) => {
            const event = { type: "openMenu", app, open: showingApps, listed: catalogApps.map(({ id }) => id) } as const;
            if (drawer.can(event)) act(event);
          } : undefined}
          onRetry={drawerActive && can({ type: "tryAgain", shell: s }) ? () => act({ type: "tryAgain", shell: s }) : undefined} />
      )}
    </>
  );
}
