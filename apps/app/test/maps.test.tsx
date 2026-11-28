// @vitest-environment happy-dom
import { Effect } from "effect";
import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { Machine as Screen, type Maps as ScreenState } from "../gen/app__maps.effect.vibe";
import { Machine as Credits } from "../gen/app__maps__credits.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Atlas } from "../src/maps/atlas.vibe";
import { mapsSelected, readSelected } from "../src/maps/agent.vibe";
import { measured, meters, pointIn, toLine } from "../src/maps/geometry.ts";
import { handToMaps } from "../src/maps/handoff.ts";
import maps from "../src/maps/index.tsx";
import { handedOver, tile } from "../src/maps/maps.vibe";
import type { Alpha } from "../src/runtime/area.tsx";
import { button, closeAll, drawn, fill, hardware, later, only, open, press, pressOnTop, seen, underAct, until } from "./alpha.tsx";
import { cloudRoute, gallery, harbour, move, speech } from "./fakes/maps.ts";
import { scene } from "./fakes/scene.ts";

underAct();
afterEach(closeAll);

const withMaps = only("home", "view:Maps");

/** Press Enter in the field whose accessible name is `name`. */
const enter = (name: string) => drawn(() => {
  const field = [...document.querySelectorAll("input")].find((found) => found.getAttribute("aria-label") === name);
  if (!field?.form) throw new Error(`no form around ${name}`);
  field.form.requestSubmit();
});

/** Open Maps from the shell, as Home's tile or the agent does. */
const showMaps = (alpha: Alpha) => drawn(() =>
  alpha.runtime.runPromise(Effect.ignore(Effect.flatMap(Shell, (shell) => shell.send({ type: "openView", view: "Maps" })))),
);

async function onMaps(world: ReturnType<typeof scene>) {
  const running = await open(world, withMaps);
  await showMaps(running.alpha);
  return { ...running, runtime: maps.runtime(running.alpha) };
}

async function typeMapSearch(text: string) {
  await drawn(() => { document.querySelector<HTMLInputElement>('input[aria-label="Search Maps"]')?.focus(); });
  await fill("Search Maps", text);
}

/** The places the results list shows, by name. */
const results = () => [...document.querySelectorAll("section[aria-label=Maps] button")].map((found) => found.getAttribute("aria-label")).filter((name) => name?.startsWith("Harbour"));

/** Open Maps on `world` and wait until its provider is installed (or `ready` holds). */
async function openMaps(world: ReturnType<typeof scene>, ready: boolean | ((s: ScreenState) => boolean) = true) {
  const running = await open(world, withMaps);
  await showMaps(running.alpha);
  const runtime = maps.runtime(running.alpha);
  if (typeof ready === "function") await until(running.alpha, runtime, Screen, ready);
  else if (ready) await until(running.alpha, runtime, Screen, (s) => s.link.provider !== 0);
  return { ...running, runtime };
}

async function openGoogleMaps(world: ReturnType<typeof scene>, savedCount?: number) {
  if (!world.maps.coverage.available) throw new Error("expected available coverage");
  world.maps.coverage = { ...world.maps.coverage, providerId: "eliza-cloud-google" };
  return openMaps(world, (s) => s.link.google && (savedCount === undefined || s.saved.length === savedCount));
}

/** Focus Search Maps, submit `query`, and wait for search results or a dropped pin. */
async function searchFor(alpha: Alpha, runtime: ReturnType<typeof maps.runtime>, query: string, pin = false) {
  await typeMapSearch(query);
  await enter("Search Maps");
  await until(alpha, runtime, Screen, (s) => (pin ? s.place !== 0 : s.search.status === "Loaded"));
}

async function pickDirectionsOrigin(alpha: Alpha, runtime: ReturnType<typeof maps.runtime>, query: string, option: string) {
  await press("Directions");
  await fill("Starting point", query);
  await enter("Starting point");
  await until(alpha, runtime, Screen, (s) => s.origins.status === "Loaded" && s.originsFound === 1);
  await press(option);
}

describe("Maps on a phone", () => {
  it("Search for a place, get directions and navigate (spec/app/maps/index.md, \"Story: Search for a place\"; spec/app/maps/index.md, \"Story: Get directions\"; spec/app/maps/index.md, \"Story: Navigate\")", async () => {
    const world = { ...scene(), phone: true };
    const start = { latitude: 43.7300, longitude: 7.4200 };
    world.maps.routes = [cloudRoute("fast", start, harbour.coordinate, 400, 3), cloudRoute("scenic", start, harbour.coordinate, 500, 4)];
    // spec/app/maps/index.md, "Opening Maps, the network returning or Retry reads the coverage when no provider works, and leaves a working one alone"
    const { alpha, runtime } = await openMaps(world, (s) => s.link.provider !== 0 && s.link.offer.walk && !s.link.offer.transit);

    // spec/app/maps/connection.md, "Retry draws a broken map again on a new surface": this page has no WebGL, so MapLibre cannot draw
    await until(alpha, runtime, Screen, (s) => s.link.surface === "Broken");
    expect(document.querySelector("[role=application]")).not.toBeNull();
    await press("Retry map");
    await until(alpha, runtime, Screen, (s) => s.link.plane > 2 && s.link.surface === "Broken");

    // spec/app/maps/index.md, "Only the newest search's answer is shown: results, none, or a failure"
    await typeMapSearch("harbour");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 2);
    expect(results()).toEqual(["Harbour Cafe", "Harbour Gallery"]);
    const search = world.maps.asked.at(-1);
    expect([search?.path, (search?.body as { query?: string }).query, typeof search?.key]).toEqual(["/api/v1/maps/places/search", "harbour", "string"]);

    // spec/app/maps/index.md, "A result opens its place"
    await press("Harbour Cafe");
    await until(alpha, runtime, Screen, (s) => s.place !== 0 && s.sheet === "Half");
    // spec/app/maps/index.md, "Story: Look at a place": the field keeps the query, as v119 live did, not the place's name
    expect(document.querySelector<HTMLInputElement>("input[aria-label='Search Maps']")?.value).toBe("harbour");

    // spec/app/maps/index.md, "A fix goes to whoever holds the location"
    await press("Directions");
    await until(alpha, runtime, Screen, (s) => s.trip.route !== 0 && s.trip.origin === "MyLocation" && s.link.locator === "Nobody");
    expect(world.maps.asked.at(-1)?.body).toMatchObject({ from: start, to: harbour.coordinate, mode: "drive" });
    // spec/app/maps/index.md, "Maps opens without the disclosure, and the owner's tap for their location shows it": no Recenter floats over directions, as v119 live hid it; "Use my location" on the card stays
    expect([button("Recenter"), Boolean(button("Use my location"))]).toEqual([undefined, true]);

    // spec/app/maps/index.md, "Directions are asked for a way of travelling the provider offers, and another way asks again from the same start"
    expect(button("Transit")?.getAttribute("aria-disabled")).toBe("true");
    await press("Walk");
    await until(alpha, runtime, Screen, (s) => s.trip.travel === "Walk" && s.trip.plan.status === "Loaded");
    expect(world.maps.asked.at(-1)?.body).toMatchObject({ mode: "walk" });

    // spec/app/maps/index.md, "The provider's routes are listed in order, and choosing one shows it and sends no new request"
    const asked = world.maps.asked.length;
    await press(/^Alternative 1, 1 min, /);
    await until(alpha, runtime, Screen, (s) => s.chosen === 1 && s.trip.turns === 4);
    expect(world.maps.asked.length).toBe(asked);

    // spec/app/maps/index.md, "Start guides along the route shown, with location allowed"
    await press("Start");
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Going" && s.link.locator === "Guide");

    // spec/app/maps/navigation.md, "A fix moves guidance only when it is precise, fresh and close: arrival within 25 meters, a turn passed within 40 meters or after two fixes beyond 60, the route left beyond 75"
    move(world.maps, harbour.coordinate.latitude, harbour.coordinate.longitude, 8, world.now);
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Arrived" && s.link.locator === "Nobody");
    await until(alpha, runtime, Screen, () => world.maps.watches.size === 0);

    // spec/app/maps/index.md, "End stops guidance and its location and goes back to the directions"
    await press("End navigation");
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Stopped" && s.directions);

    // spec/app/maps/index.md, "Back leaves one mode: navigation to its directions, directions to the place, the place to the search, the search to the map"
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.directions && s.place !== 0);
    expect(Boolean(button("Recenter"))).toBe(true);
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => s.place === 0 && s.searching && s.trip.route === 0);
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.searching && s.query === "" && s.recent[0] === "harbour");
    await press("Back");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
  });

  it("Keep guiding away from Maps (spec/app/maps/index.md, \"Story: Keep guiding away from Maps\"; spec/app/maps/navigation.md, \"Story: Keep guiding with the screen off\"; spec/app/maps/navigation.md, \"Story: Hear the next instruction\")", async () => {
    const heard = speech();
    const world = { ...scene(), phone: true };
    const start = { latitude: 43.7300, longitude: 7.4200 };
    world.maps.routes = [cloudRoute("fast", start, harbour.coordinate, 400, 3)];
    const { alpha, runtime } = await openMaps(world);
    await typeMapSearch("cafe");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 1);
    await press("Harbour Cafe");
    await press("Directions");
    await until(alpha, runtime, Screen, (s) => s.trip.route !== 0 && s.trip.plan.status === "Loaded");

    // spec/app/maps/index.md, "Start guides along the route shown, with location allowed"; spec/app/maps/index.md, "Android confirms or loses the service of this journey"
    await press("Start");
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Going" && s.trip.service === "Running" && s.following);
    expect([world.maps.guidance.session, world.maps.guidance.title, world.maps.guidance.text]).toEqual(["alpha-maps-1", "Navigating to Harbour Cafe", "Head north"]);

    // spec/app/maps/index.md, "Guidance speaks the newest instruction with Maps on screen, once, and the instruction owed on coming back"; spec/app/maps/navigation.md, "An instruction is spoken for its turn and distance band: now within 50 meters, soon within 250, far beyond"
    await until(alpha, runtime, Screen, (s) => s.trip.speaking === 0);
    expect(heard.spoken).toEqual(["Head north"]);

    // spec/app/maps/index.md, "Guidance follows the phone until the owner moves the map, and Recenter follows it again": this page has no WebGL, so the owner's pan is told as the map tells it
    await act(async () => { await runtime.runPromise(Effect.ignore(Effect.flatMap(Screen, (screen) => screen.send({ type: "panMap" })))); });
    await until(alpha, runtime, Screen, (s) => !s.following);
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.following);

    // spec/app/maps/index.md, "Story: Keep guiding away from Maps": locking the phone is leaving
    await seen(false);
    await until(alpha, runtime, Screen, (s) => s.trip.away && s.trip.guidance === "Going");

    // spec/app/maps/navigation.md, "The next turn is spoken with Maps on screen, never while it is away, and the instruction owed is spoken on coming back"
    await until(alpha, runtime, Screen, (s) => s.trip.speaking === -1);
    expect(heard.spoken).toEqual(["Head north"]);

    // spec/app/maps/index.md, "The notification of this journey opens Maps on its guidance, or stops it"
    world.maps.guidance.opened = true;
    await seen(true);
    await until(alpha, runtime, Screen, (s) => !s.trip.away && s.trip.guidance === "Going");
    await until(alpha, runtime, Screen, (s) => s.trip.speaking === 0);
    expect(heard.spoken).toEqual(["Head north", "Head north"]);
    await hardware("home");
    await until(alpha, runtime, Screen, (s) => s.trip.away && s.trip.service === "Running");
    world.maps.guidance.opened = true;
    await drawn(() => { window.dispatchEvent(new Event("alpha:maps-open")); });
    await until(alpha, runtime, Screen, (s) => !s.trip.away && s.trip.guidance === "Going");
    expect(world.maps.guidance.opened).toBe(false);
    await seen(false);
    await until(alpha, runtime, Screen, (s) => s.trip.away);
    await drawn(() => { world.maps.guidance.stop?.("notification"); });
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Stopped" && s.guideNotice === "StoppedFromNotification" && s.link.locator === "Nobody");
    await seen(true);
    await until(alpha, runtime, Screen, (s) => !s.trip.away);
    expect(document.body.textContent).toContain("Navigation stopped from the notification.");

    // spec/app/maps/index.md, "The owner is told why guidance ended when it was not by their own End": the service lost while away
    await press("Start");
    await until(alpha, runtime, Screen, (s) => s.trip.service === "Running" && s.guideNotice === "Quiet");
    await seen(false);
    await until(alpha, runtime, Screen, (s) => s.trip.away);
    await drawn(() => { world.maps.guidance.stop?.("task-removed"); });
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Stopped" && s.guideNotice === "PausedAway");
    await seen(true);
    await until(alpha, runtime, Screen, (s) => !s.trip.away);
    expect(document.body.textContent).toContain("Navigation paused while the app is in the background. Tap Start to resume.");

    // spec/app/maps/index.md, "Arriving with Maps away is told once on the phone"
    await press("Start");
    await until(alpha, runtime, Screen, (s) => s.trip.service === "Running");
    await seen(false);
    await until(alpha, runtime, Screen, (s) => s.trip.away);
    move(world.maps, harbour.coordinate.latitude, harbour.coordinate.longitude, 8, world.now);
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Arrived");
    await until(alpha, runtime, Screen, () => world.maps.guidance.session === undefined && world.maps.guidance.arrivals.length === 1);
    expect(world.maps.guidance.arrivals).toEqual(["Arrived at Harbour Cafe."]);
  });

  async function openPromptMapsWithHarbour() {
    const world = { ...scene(), phone: true };
    world.maps.allowed = "prompt";
    const why = "Maps uses your location to show where you are";
    const now = (runtime: Awaited<ReturnType<typeof onMaps>>["runtime"]) => runtime.runPromise(Effect.flatMap(Screen, (machine) => machine.get()));
    const { alpha, runtime } = await onMaps(world);
    await until(alpha, runtime, Screen, (s) => s.link.known && s.link.provider !== 0);
    // spec/app/maps/index.md, "A query another app hands to Maps opens as a search, never over navigation": a places card's Map button, with the disclosure unread, searches at once, as v119 did
    await drawn(() => { handToMaps("harbour"); });
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 2);
    return { world, alpha, runtime, why, now };
  }

  it("A handed search runs at once, and Recenter tells why before Android asks, then locates (spec/app/maps/index.md, \"Story: Use my location\")", async () => {
    const { world, alpha, runtime, why, now } = await openPromptMapsWithHarbour();
    expect(results()).toEqual(["Harbour Cafe", "Harbour Gallery"]);
    expect([(await now(runtime)).link.disclosed, document.body.textContent?.includes(why)]).toEqual([false, false]);

    // spec/app/maps/index.md, "Maps opens without the disclosure, and the owner's tap for their location shows it": Android is not asked yet
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.explaining);
    const shown = await now(runtime);
    expect([shown.link.location.asked, document.body.textContent?.includes(why)]).toEqual([false, true]);

    // spec/app/maps/index.md, "Continuing past the disclosure asks Android, once, and then locates": Recenter stays while Android's prompt is open, as on v119
    let answer = () => {};
    world.maps.answer = new Promise((settle) => { answer = settle; });
    await press("Continue");
    await until(alpha, runtime, Screen, (s) => s.link.prompting && s.owedLocate && !s.explaining);
    expect([Boolean(button("Recenter")), document.body.textContent?.includes(why)]).toEqual([true, false]);
    await drawn(() => { answer(); });
    await until(alpha, runtime, Screen, (s) => !s.link.prompting && s.link.session > shown.link.session && !s.owedLocate);
    expect(Boolean(button("Recenter"))).toBe(true);
  });

  it("A search handed over before Maps opens runs on the first open, on a later open and through another account (spec/app/maps/index.md, \"A query another app hands to Maps opens as a search, never over navigation\")", async () => {
    const world = { ...scene(), phone: true };
    const { alpha } = await open(world, withMaps);
    const runtime = maps.runtime(alpha);
    const searched = () => [results(), document.querySelector<HTMLInputElement>('input[aria-label="Search Maps"]')?.value];
    const handThenOpen = async () => {
      act(() => { handToMaps("harbour"); });
      await showMaps(alpha);
    };
    const leave = async () => {
      await hardware("back");
      await until(alpha, runtime, Screen, (s) => !s.searching);
      await hardware("back");
      await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
    };

    // spec/app/maps/index.md, "Another account hides every route, place and search of the last one, and ends its guidance": the first open reads the account after the query arrives, and the query waits through it
    await handThenOpen();
    await until(alpha, runtime, Screen, (s) => s.link.known && s.search.status === "Loaded" && s.results === 2);
    expect(searched()).toEqual([["Harbour Cafe", "Harbour Gallery"], "harbour"]);

    // spec/app/maps/index.md, "A query another app hands to Maps opens as a search, never over navigation": a later open takes the query once the machine is back on screen, though React first draws the last visit's state
    await leave();
    await handThenOpen();
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 2);
    expect(searched()).toEqual([["Harbour Cafe", "Harbour Gallery"], "harbour"]);

    // spec/app/maps/index.md, "Another account hides every route, place and search of the last one, and ends its guidance": signing out keeps the query unanswered, and signing in again sends it through the account's provider
    await leave();
    world.signedIn = false;
    await handThenOpen();
    await until(alpha, runtime, Screen, (s) => s.link.account === 0 && s.searching && s.query === "harbour" && s.waitingProvider);
    world.signedIn = true;
    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
    await showMaps(alpha);
    await until(alpha, runtime, Screen, (s) => s.link.account !== 0 && s.search.status === "Loaded" && s.results === 2);
    expect(results()).toEqual(["Harbour Cafe", "Harbour Gallery"]);
  });

  it("The location disclosure closes on Back, on leaving Maps and once Android allows location, and Recenter shows it again (spec/app/maps/index.md, \"Story: Use my location\")", async () => {
    const { alpha, runtime, why, now } = await openPromptMapsWithHarbour();
    const told = (grant: "Unasked" | "Granted") =>
      act(async () => { await runtime.runPromise(Effect.ignore(Effect.flatMap(Screen, (machine) => machine.send({ type: "observeLocation", grant })))); });
    const card = () => Boolean(document.body.textContent?.includes(why));

    // spec/app/maps/index.md, "Maps opens without the disclosure, and the owner's tap for their location shows it": Back closes it with the search
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.explaining);
    expect(card()).toBe(true);
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.searching);
    expect([(await now(runtime)).explaining, card()]).toEqual([false, false]);

    // spec/app/maps/index.md, "Maps opens without the disclosure, and the owner's tap for their location shows it": Leaving Maps closes it, so the next visit opens on the bare map with Recenter
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.explaining);
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
    await showMaps(alpha);
    await until(alpha, runtime, Screen, (s) => s.link.known && s.link.provider !== 0);
    expect([(await now(runtime)).explaining, card(), Boolean(button("Recenter"))]).toEqual([false, false, true]);

    // spec/app/maps/index.md, "Maps opens without the disclosure, and the owner's tap for their location shows it": An answer that leaves location unasked keeps it; one that allows location closes it
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.explaining);
    await told("Unasked");
    expect([(await now(runtime)).explaining, card()]).toEqual([true, true]);
    await told("Granted");
    await until(alpha, runtime, Screen, (s) => !s.explaining);
    expect([(await now(runtime)).link.disclosed, card()]).toEqual([false, false]);
  });

  it("Signed out, Maps asks Cloud nothing and says to sign in (spec/app/maps/index.md, \"Story: Connect through my cloud account\")", async () => {
    const world = { ...scene(), phone: true, signedIn: false };
    const { alpha, runtime } = await onMaps(world);
    // spec/app/maps/connection.md, "Signing in, out or to another account retires the provider and reads the new account's coverage"
    await until(alpha, runtime, Screen, (s) => s.link.account === 0 && s.link.basemap === "World");
    await later(alpha, 1000);
    expect(world.maps.asked).toEqual([]);

    // spec/app/maps/connection.md, "Signing in, out or to another account retires the provider and reads the new account's coverage": signing in later is seen when Maps comes back on screen
    world.signedIn = true;
    await hardware("back");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.length === 0);
    await showMaps(alpha);
    await until(alpha, runtime, Screen, (s) => s.link.known && s.link.account !== 0 && s.link.provider !== 0);
  });
});

describe("Maps in a browser", () => {
  it("Look at a place and keep it (spec/app/maps/index.md, \"Story: Look at a place\")", async () => {
    const world = scene();
    localStorage.setItem("alpha.maps.saved-places.v1", JSON.stringify({ version: 1, items: [
      { id: "a1", label: "Office", coordinate: { latitude: 43.7401, longitude: 7.4262 }, savedAt: 1 },
      { id: "a2", label: "Lunch", coordinate: { latitude: 43.7, longitude: 7.4 }, providerId: "eliza-cloud-google", providerPlaceId: "g1", savedAt: 2 },
    ] }));
    const first = await openMaps(world);
    const { runtime } = first;

    // spec/app/maps/index.md, "Saved places are kept on the phone, and are what survives a restart": the previous Alpha's list is read
    await until(first.alpha, runtime, Screen, (s) => s.saved.length === 1 && s.saved[0]?.name === "Office");
    // spec/app/maps/connection.md, "The owner reads Alpha's location disclosure before Android asks": Maps opens on the bare map with Recenter, as v119 did, and no location card
    expect([Boolean(button("Recenter")), document.querySelector("[role=dialog][aria-label=Location]")]).toEqual([true, null]);

    // spec/app/maps/index.md, "Coordinates typed into Search drop a pin"; spec/app/maps/index.md, "A saved place is renamed in a name field the owner opens on its card": the card is v119's "Dropped pin" with Rename, and the field keeps what was typed
    await typeMapSearch("43.73, 7.42");
    await enter("Search Maps");
    await until(first.alpha, runtime, Screen, (s) => s.place !== 0 && !s.pinning);
    expect(world.maps.asked).toEqual([]);
    expect([document.querySelector("h2")?.textContent, document.querySelector<HTMLInputElement>("input[aria-label='Search Maps']")?.value, Boolean(button("Rename place"))]).toEqual(["Dropped pin", "43.73, 7.42", true]);
    // spec/app/maps/index.md, "The card shares the place or the arrival time, opens its website, or opens it in the phone's maps app": a dropped pin is a selected location, its row is v119's Directions, Save and Share, and Share opens the panel that offers Email, the sheet and its link
    const sharePanel = () => [...document.querySelectorAll("[role=dialog]")].find((one) => one.querySelector("h2")?.textContent === "Share");
    const panelRows = () => [...sharePanel()?.querySelectorAll("button") ?? []].map((one) => one.getAttribute("aria-label") ?? one.textContent);
    expect([document.body.textContent?.includes("Selected location"), Boolean(button("Share")), Boolean(button("Email")), Boolean(button("Copy link")), sharePanel()]).toEqual([true, true, false, false, undefined]);
    await press("Share");
    expect(panelRows()).toEqual(["Close share", "Email", "Share", "Copy link"]);
    // spec/app/maps/index.md, "Back leaves one mode: navigation to its directions, directions to the place, the place to the search, the search to the map": Back closes the panel first and keeps the place
    await hardware("back");
    await drawn(() => expect(sharePanel()).toBeUndefined());
    expect((await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).place).not.toBe(0);
    await press("Share");
    await pressOnTop("Copy link");
    await drawn(() => expect(sharePanel()).toBeUndefined());
    await expect.poll(() => navigator.clipboard.readText()).toBe("https://www.openstreetmap.org/?mlat=43.73&mlon=7.42#map=17/43.73/7.42");

    // spec/app/maps/index.md, "The place on the card is saved under a name, renamed under another, or forgotten"; spec/app/maps/index.md, "A saved list that cannot be read is never written over, and a change is told only once it reads back"
    await press("Save");
    await until(first.alpha, runtime, Screen, (s) => s.saved.length === 2 && s.notice === "PlaceSaved");
    expect(document.body.textContent).toContain("Place saved on this device.");
    await press("Rename place");
    await fill("Place name", "Quay");
    await press("Apply place name");
    await until(first.alpha, runtime, Screen, (s) => s.saved.length === 2 && s.saved[1]?.name === "Quay" && s.notice === "PlaceRenamed");
    expect(document.body.textContent).toContain("Saved on this device");
    // spec/app/maps/places.md, "A saved place keeps its name, its coordinates and the provider's identity of it, and nothing else"
    const stored = JSON.parse(localStorage.getItem("alpha/maps/saved@1") ?? "[]") as { name: string; spot: Record<string, unknown> }[];
    expect(stored.map((entry) => [entry.name, Object.keys(entry.spot).filter((key) => ["address", "phone", "website", "hours"].includes(key))])).toEqual([["Office", []], ["Quay", []]]);
    await first.close();

    // spec/app/maps/index.md, "Saved places are kept on the phone, and are what survives a restart"
    const second = await openGoogleMaps(world, 2);
    const again = second.runtime;
    expect([Boolean(button("Quay")), Boolean(button("Office"))]).toEqual([true, true]);

    // spec/app/maps/index.md, "Saved places open from the map or the search"; spec/app/maps/index.md, "Story: Look at a place": a saved place opens with its name on the card and the field empty under "Search", as v119 live
    await press("Quay");
    await until(second.alpha, again, Screen, (s) => s.place !== 0);
    const field = document.querySelector<HTMLInputElement>("input[aria-label='Search Maps']");
    expect([document.querySelector("h2")?.textContent, field?.value, field?.placeholder]).toEqual(["Quay", "", "Search"]);
    await hardware("back");
    await until(second.alpha, again, Screen, (s) => s.place === 0);

    // spec/app/maps/index.md, "The place on the card is saved under a name, renamed under another, or forgotten": a dropped pin is the owner's, not Google's, so Google's map offers Rename, Save and Share on it, as v119 live (prototype/maps-adapter.ts:378, 489)
    await typeMapSearch("43.75, 7.43");
    await enter("Search Maps");
    await until(second.alpha, again, Screen, (s) => s.place !== 0 && !s.pinning);
    expect([document.querySelector("h2")?.textContent, Boolean(button("Rename place")), Boolean(button("Save")), Boolean(button("Share"))]).toEqual(["Dropped pin", true, true, true]);
    await hardware("back");
    await until(second.alpha, again, Screen, (s) => s.place === 0);

    // spec/app/maps/connection.md, "Google's content is drawn only on Google's own map, whose only credit is the Google Maps badge"; spec/app/maps/places.md, "At most 200 places are saved: a full list only renames"
    await typeMapSearch("gallery");
    await enter("Search Maps");
    await until(second.alpha, again, Screen, (s) => s.search.status === "Loaded");
    await press("Harbour Gallery");
    await until(second.alpha, again, Screen, (s) => s.place !== 0);
    expect([Boolean(button("Directions")), Boolean(button("Save")), Boolean(button("Share")), Boolean(button("Email")), Boolean(button("Copy link"))]).toEqual([true, false, false, false, false]);

    // spec/app/maps/credits.md, "The credits panel opens from the badge or the information button of a drawn surface": Back closes it first (this page has no WebGL, so the drawn surface is told as the map tells it)
    const plane = (await again.runPromise(Effect.flatMap(Credits, (c) => c.get()))).plane;
    await act(async () => { await again.runPromise(Effect.ignore(Effect.flatMap(Credits, (c) => c.send({ type: "planeDrawn", plane })))); });
    await press("Google Maps");
    await until(second.alpha, again, Credits, (s) => s.infoOpen);
    await hardware("back");
    await until(second.alpha, again, Credits, (s) => !s.infoOpen);
    await until(second.alpha, again, Screen, (s) => s.place !== 0);

    // spec/app/maps/index.md, "Story: Get directions": Google's map offers no coordinate prompt
    await press("Directions");
    await until(second.alpha, again, Screen, (s) => s.directions);
    await fill("Starting point", "Off");
    expect([document.querySelector("input[aria-label='Starting point']")?.getAttribute("placeholder"), Boolean(button("From Office"))]).toEqual(["My location", true]);
  });

  it("A dropped pin is named before it is saved, and a place found never offers Rename (spec/app/maps/index.md, \"Story: Look at a place\")", async () => {
    const world = scene();
    world.maps.routes = [cloudRoute("there", harbour.coordinate, { latitude: 43.73, longitude: 7.42 }, 300, 2)];
    const { alpha, runtime } = await onMaps(world);
    const now = () => runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0);
    await typeMapSearch("43.73, 7.42");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.place !== 0 && !s.pinning);
    const pin = (await now()).place;

    // spec/app/maps/index.md, "A saved place is renamed in a name field the owner opens on its card": a start found by search, swapped onto the card, offers no Rename, as v119 offered none on an unsaved place it found
    await pickDirectionsOrigin(alpha, runtime, "cafe", "From Harbour Cafe");
    await until(alpha, runtime, Screen, (s) => s.trip.route !== 0 && s.startPlace !== 0);
    await press("Swap starting point and destination");
    await until(alpha, runtime, Screen, (s) => s.place !== pin && s.startPlace === pin && s.trip.route !== 0);
    await hardware("back");
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.directions && s.place !== 0 && s.place !== pin);
    expect([document.querySelector("h2")?.textContent, button("Rename place")]).toEqual(["Harbour Cafe", undefined]);

    // spec/app/maps/index.md, "A saved place is renamed in a name field the owner opens on its card": the pin's name only names it until Save keeps it under that name, as v119's applyName did
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => s.place === 0);
    await typeMapSearch("43.73, 7.42");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.place === pin && !s.pinning);
    await press("Rename place");
    expect(document.querySelector<HTMLInputElement>("input[aria-label='Place name']")?.value).toBe("Dropped pin");
    await fill("Place name", "Quay");
    await press("Apply place name");
    await until(alpha, runtime, Screen, (s) => s.notice === "PinNamed" && !s.renaming);
    expect([document.querySelector("h2")?.textContent, (await now()).saved, document.body.textContent?.includes("Name updated. Tap Save to keep this place."), Boolean(button("Save"))])
      .toEqual(["Quay", [], true, true]);
    // spec/app/maps/index.md, "A saved place is renamed in a name field the owner opens on its card": the pin's name is told on its card only, and Directions clears it, as v119's openDirections replaced its message
    await press("Directions");
    await until(alpha, runtime, Screen, (s) => s.directions);
    expect([(await now()).notice, document.body.textContent?.includes("Name updated. Tap Save to keep this place.")]).toEqual(["NoNotice", false]);
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.directions && s.place === pin);
    expect([document.querySelector("h2")?.textContent, document.body.textContent?.includes("Name updated. Tap Save to keep this place.")]).toEqual(["Quay", false]);
    await press("Save");
    await until(alpha, runtime, Screen, (s) => s.saved.length === 1 && s.saved[0]?.name === "Quay" && s.notice === "PlaceSaved");
    expect([document.querySelector("h2")?.textContent, document.body.textContent?.includes("Place saved on this device.")]).toEqual(["Quay", true]);
  });

  it("A saved list Alpha cannot read is never written over (spec/app/maps/index.md, \"Story: Look at a place\")", async () => {
    const world = scene();
    localStorage.setItem("alpha/maps/saved@1", "{not json");
    // spec/app/maps/index.md, "A saved list that cannot be read is never written over, and a change is told only once it reads back"
    const { alpha, runtime } = await openMaps(world, (s) => s.link.provider !== 0 && !s.keepable);
    expect(document.body.textContent).toContain("Saved places could not be read. Existing data has not been replaced.");
    await typeMapSearch("48.85, 2.35");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.place !== 0);
    expect([button("Save"), localStorage.getItem("alpha/maps/saved@1")]).toEqual([undefined, "{not json"]);

    // spec/app/maps/index.md, "A place outside every region the provider covers keeps its coordinates and says so"
    expect([document.body.textContent?.includes("This location is outside Test data coverage."), Boolean(button("Directions"))]).toEqual([true, true]);
  });

  it("Search as I type, start from a place by its name and swap the ends (spec/app/maps/index.md, \"Story: Search for a place\"; spec/app/maps/index.md, \"Story: Get directions\")", async () => {
    const world = scene();
    world.maps.routes = [cloudRoute("there", harbour.coordinate, gallery.coordinate, 300, 2)];
    const { alpha, runtime } = await openMaps(world);

    // spec/app/maps/index.md, "Typing searches once the owner pauses for 350 milliseconds, and Enter searches at once"
    await typeMapSearch("gallery");
    await until(alpha, runtime, Screen, (s) => s.pausing);
    expect(world.maps.asked).toEqual([]);
    await later(alpha, 350);
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 1);
    const asked = world.maps.asked.length;
    await fill("Search Maps", "GALLERY");
    await enter("Search Maps");
    await later(alpha, 400);
    expect([world.maps.asked.length, (await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).recent]).toEqual([asked, ["gallery"]]);

    // spec/app/maps/index.md, "The card shares the place or the arrival time, opens its website, or opens it in the phone's maps app"
    await press("Harbour Gallery");
    await until(alpha, runtime, Screen, (s) => s.place !== 0);
    expect(button("Copy phone number")).toBeUndefined();

    // spec/app/maps/index.md, "A starting point can be a place found by its name, around the phone or the last start"
    await pickDirectionsOrigin(alpha, runtime, "cafe", "From Harbour Cafe");
    await until(alpha, runtime, Screen, (s) => s.trip.route !== 0 && s.startPlace !== 0 && s.trip.origin === "SomePlace");
    expect(world.maps.asked.at(-1)?.body).toMatchObject({ from: harbour.coordinate, to: gallery.coordinate });

    // spec/app/maps/index.md, "Swapping the ends keeps each end's place and plans the reverse route"
    const before = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    await press("Swap starting point and destination");
    await until(alpha, runtime, Screen, (s) => s.place === before.startPlace && s.startPlace === before.place && s.trip.route !== 0);
    expect(world.maps.asked.at(-1)?.body).toMatchObject({ from: gallery.coordinate, to: harbour.coordinate });
    expect(button("Copy phone number")).toBeUndefined();
    await hardware("back");
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.directions && s.place === before.startPlace);
    await press("Copy phone number");
    await until(alpha, runtime, Screen, (s) => s.copyNotice !== "Uncopied");
    expect(document.body.textContent).toMatch(/Number copied|Couldn't copy/);
  });

  it("Back off when Maps asks me to wait (spec/app/maps/connection.md, \"Story: Serve Maps through my cloud account\")", async () => {
    const world = { ...scene(), now: Date.now() };
    const { alpha, runtime } = await openMaps(world);

    // spec/app/maps/connection.md, "A wait Cloud names holds every Maps request back until it ends: a rate limit for at most a day, a spent allowance for at most 400 days, and any other wait one minute"; spec/app/maps/index.md, "Cloud's wait holds the screen's requests until it ends, and its end lets them go again"
    await later(alpha, Math.max(0, Date.now() - world.now));
    world.maps.limited = 120;
    await typeMapSearch("harbour");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.search.status === "Failed" && s.link.held >= 119 && s.link.held <= 121);
    expect(document.body.textContent).toMatch(/Maps request limit reached\. Try again in [23] minutes\./);
    const asked = world.maps.asked.length;
    await fill("Search Maps", "harbour cafe");
    await enter("Search Maps");
    await later(alpha, 1000);
    const held = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect([world.maps.asked.length, held.query]).toEqual([asked, "harbour"]);

    await later(alpha, 122_000);
    await until(alpha, runtime, Screen, (s) => s.link.held === 0);
    await fill("Search Maps", "harbour");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 2);

    // spec/app/maps/connection.md, "A wait Cloud names holds every Maps request back until it ends: a rate limit for at most a day, a spent allowance for at most 400 days, and any other wait one minute": a wait that names no end holds a minute
    world.maps.limited = 0;
    await fill("Search Maps", "gallery");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.search.status === "Failed" && s.link.held === 60);
    await later(alpha, 60_000);
    await until(alpha, runtime, Screen, (s) => s.link.held === 0);

    // spec/app/maps/connection.md, "A wait Cloud names holds every Maps request back until it ends: a rate limit for at most a day, a spent allowance for at most 400 days, and any other wait one minute": a tile's wait holds the search, and a search's wait refuses tiles without asking
    world.maps.tilesLimited = 90;
    const tried = (z: number) => act(() => runtime.runPromise(Effect.match(tile(z, 0, 0, new AbortController().signal), { onFailure: () => false, onSuccess: () => true })));
    expect(await tried(1)).toBe(false);
    await until(alpha, runtime, Screen, (s) => s.link.held >= 89 && s.link.held <= 91);
    const searches = world.maps.asked.length;
    await fill("Search Maps", "cafe");
    await enter("Search Maps");
    await later(alpha, 500);
    expect(world.maps.asked.length).toBe(searches);
    await later(alpha, 92_000);
    await until(alpha, runtime, Screen, (s) => s.link.held === 0);
    world.maps.limited = 120;
    await fill("Search Maps", "harbour gallery");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.link.held >= 119);
    const tiles = world.maps.tiles.length;
    expect([await tried(2), world.maps.tiles.length]).toEqual([false, tiles]);
  });

  it('Handles antimeridian, empty-line, and coordinate edge cases in geometry (spec/app/maps/navigation.md, "A fix moves guidance only when it is precise, fresh and close: arrival within 25 meters, a turn passed within 40 meters or after two fixes beyond 60, the route left beyond 75")', () => {
    expect(pointIn("+43.73, +7.42")).toEqual({ lat: 43_730_000, lng: 7_420_000 });
    expect(pointIn(".5, -.5")).toEqual({ lat: 500_000, lng: -500_000 });
    expect(pointIn("-0, -0")).toEqual({ lat: 0, lng: 0 });
    expect(Object.is(pointIn("-0, -0")?.lat, -0)).toBe(false);

    const west = { lat: 0, lng: 179_999_000 };
    const east = { lat: 0, lng: -179_999_000 };
    expect(meters(west, east)).toBeLessThan(300);
    expect(toLine({ lat: 0, lng: 180_000_000 }, [west, east])).toBeLessThan(50);

    const empty = measured(west, { line: [], turns: [] }, 0);
    expect(Number.isFinite(empty.toRoute)).toBe(true);
    expect(empty.toEnd).toBeGreaterThan(25);
    expect(empty.beyond).toBe(0);

    const a = { lat: 43_730_000, lng: 7_420_000 };
    const turn = { lat: 43_731_000, lng: 7_420_000 };
    const b = { lat: 43_731_000, lng: 7_421_000 };
    const beforeTurn = measured({ lat: 43_730_500, lng: 7_420_000 }, { line: [a, turn, b], turns: [a, turn, b] }, 0);
    const pastTurn = measured({ lat: 43_731_000, lng: 7_420_800 }, { line: [a, turn, b], turns: [a, turn, b] }, 0);
    expect(beforeTurn.beyond).toBe(0);
    expect(pastTurn.beyond).toBeGreaterThan(50);
  });

  it(`Isolates Atlas per runtime, clears details on leave, skips coordinate search debounce, and refuses Google without tiles (spec/app/maps/index.md, "A place's details are read from its provider once it is on the card, and shown only while it still is"; spec/app/maps/connection.md, "Google's content is drawn only on Google's own map, whose only credit is the Google Maps badge")`, async () => {
    const world = scene();
    const first = await openMaps(world);
    const { runtime } = first;

    await typeMapSearch("43.73, 7.42");
    await later(first.alpha, 450);
    expect(world.maps.asked).toEqual([]);
    expect((await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).recent).toEqual([]);

    await fill("Search Maps", "harbour");
    await enter("Search Maps");
    await until(first.alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 2);
    await fill("Search Maps", "");
    await until(first.alpha, runtime, Screen, (s) => s.query === "" && s.results === 0);

    await fill("Search Maps", "cafe");
    await enter("Search Maps");
    await until(first.alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 1);
    await press("Harbour Cafe");
    await until(first.alpha, runtime, Screen, (s) => s.place !== 0 && s.details.status === "Loaded");
    await press("Save");
    await until(first.alpha, runtime, Screen, (s) => s.saved.length === 1);
    expect(localStorage.getItem("alpha/maps/saved@1")).not.toContain("+377 93 15 00 00");

    const place = (await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).place;
    const store = await runtime.runPromise(Atlas);
    expect(store.spot(place)?.phone).toBe("+377 93 15 00 00");
    await seen(false);
    await until(first.alpha, runtime, Screen, (s) => s.trip.away);
    await later(first.alpha, 10);
    expect(store.spot(place)?.phone).toBeUndefined();
    await first.close();
    localStorage.clear();

    const second = await openGoogleMaps(world);
    const secondStore = await second.runtime.runPromise(Atlas);
    expect(secondStore).not.toBe(store);
    expect(secondStore.spot(place)).toBeUndefined();
    expect(document.body.textContent).toContain("The Google map is missing.");
  });

  it('Takes a quiet fix on open that fails silently and clears one-shot GPS watches (spec/app/maps/index.md, "Opening Maps with location already allowed and nothing chosen takes one fix quietly, once a visit"; spec/app/maps/index.md, "A fix goes to whoever holds the location")', async () => {
    const world = { ...scene(), phone: true };
    world.maps.here = undefined;
    world.platform.network.failing = true;
    const first = await openMaps(world, false);
    await until(first.alpha, first.runtime, Screen, (s) => s.link.locator !== "Nobody");
    const locating = await first.runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect([locating.link.locator, locating.quiet]).toEqual(["Finder", true]);
    await later(first.alpha, 16_000);
    await until(first.alpha, first.runtime, Screen, (s) => s.link.locator === "Nobody");
    const timedOut = await first.runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect([timedOut.missedFix, world.maps.watches.size]).toEqual([false, 0]);
    await first.close();

    const secondWorld = { ...scene(), phone: true };
    const second = await openMaps(secondWorld);
    await until(second.alpha, second.runtime, Screen, (s) => s.link.locator === "Nobody");
    expect(secondWorld.maps.watches.size).toBe(0);
  });

  it('Never searches typed coordinates on pause, clears search results on empty input, and clears search text on Back (spec/app/maps/index.md, "Recent searches are the last five, newest first, each once"; spec/app/maps/index.md, "Typing searches once the owner pauses for 350 milliseconds, and Enter searches at once")', async () => {
    const world = scene();
    const { alpha, runtime } = await openMaps(world);

    await typeMapSearch("43.73, 7.42");
    await later(alpha, 500);
    const afterCoords = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect([world.maps.asked.filter((a) => a.path.includes("/places/search")).length, afterCoords.recent]).toEqual([0, []]);

    await searchFor(alpha, runtime, "harbour");
    await until(alpha, runtime, Screen, (s) => s.results === 2);
    await typeMapSearch("");
    await until(alpha, runtime, Screen, (s) => s.query === "" && s.results === 0);

    await typeMapSearch("harbour");
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.searching);
    expect(document.querySelector<HTMLInputElement>("input[aria-label='Search Maps']")?.value).toBe("");
  });

  it(`Shows Maps unavailable, distinct Cloud wait notices, and missing Google map notice (spec/app/maps/connection.md, "Only the newest read's answer is taken, while signed in, and a healthy answer installs the provider for that account"; spec/app/maps/connection.md, "A wait Cloud names holds every Maps request back until it ends: a rate limit for at most a day, a spent allowance for at most 400 days, and any other wait one minute"; spec/app/maps/connection.md, "Google's content is drawn only on Google's own map, whose only credit is the Google Maps badge")`, async () => {
    const unofferedWorld = scene();
    unofferedWorld.maps.coverage = { available: false };
    const first = await openMaps(unofferedWorld, false);
    await until(first.alpha, first.runtime, Screen, (s) => s.link.unoffered);
    expect(document.body.textContent).toContain("Maps unavailable");
    await first.close();

    const googleWorld = scene();
    googleWorld.maps.coverage = { ...googleWorld.maps.coverage, providerId: "eliza-cloud-google" } as typeof googleWorld.maps.coverage;
    const second = await openMaps(googleWorld, false);
    await until(second.alpha, second.runtime, Screen, (s) => s.link.google);
    expect(document.body.textContent).toContain("The Google map is missing.");
    expect(document.querySelector("[role=application]")).toBeNull();

    const account = (await second.runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).link.account;
    await act(async () => {
      await second.runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.send({ type: "cloudWaits", wait: "Unnamed", seconds: 60, now: googleWorld.now, account })));
    });
    expect(document.body.textContent).toContain("Maps request limit reached. Try again later.");
    await act(async () => {
      await second.runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.send({ type: "cloudWaits", wait: "AllowanceSpent", seconds: 86_400 * 3, now: googleWorld.now, account })));
    });
    expect(document.body.textContent).toContain("You have used your Maps allowance for this period. It resets in 3 days.");
  });

  it(`Shows imprecise notice on stale fix, updates remaining guidance distance, and offers Share arrival in Guidance (spec/app/maps/navigation.md, "A fix moves guidance only when it is precise, fresh and close: arrival within 25 meters, a turn passed within 40 meters or after two fixes beyond 60, the route left beyond 75"; spec/app/maps/navigation.md, "Something remains ahead while going, and nothing once guidance stops or arrives"; spec/app/maps/index.md, "The card shares the place or the arrival time, opens its website, or opens it in the phone's maps app")`, async () => {
    const world = { ...scene(), phone: true };
    const start = { latitude: 43.7300, longitude: 7.4200 };
    world.maps.routes = [cloudRoute("fast", start, harbour.coordinate, 600, 3)];
    const { alpha, runtime } = await openMaps(world);
    await searchFor(alpha, runtime, "harbour");
    await press("Harbour Cafe");
    await press("Directions");
    await until(alpha, runtime, Screen, (s) => s.trip.route !== 0);
    await press("Start");
    await until(alpha, runtime, Screen, (s) => s.trip.guidance === "Going");
    expect(button("Share arrival")).toBeDefined();

    const stepOne = world.maps.routes[0]?.steps[1]?.coordinate;
    if (!stepOne) throw new Error("missing route step");
    move(world.maps, stepOne.latitude, stepOne.longitude, 8, world.now);
    await until(alpha, runtime, Screen, (s) => s.trip.turn === 1);
    expect(document.body.textContent).toMatch(/(?:400 m|0\.2 mi)/);

    move(world.maps, stepOne.latitude, stepOne.longitude, 8, world.now - 60_000);
    await until(alpha, runtime, Screen, (s) => s.imprecise);
    expect(document.body.textContent).toContain("Turn guidance needs a precise");
  });

  it(`Strips provider details from saved storage, enforces legacy 200-place limit, forgets details on leave, and blocks cross-provider saved origins (spec/app/maps/places.md, "A saved place keeps its name, its coordinates and the provider's identity of it, and nothing else"; spec/app/maps/places.md, "A saved provider place is used only with the open-data provider that served it"; spec/app/maps/index.md, "A place's details are read from its provider once it is on the card, and shown only while it still is")`, async () => {
    const world = { ...scene(), phone: true };
    const first = await openMaps(world);
    await searchFor(first.alpha, first.runtime, "harbour");
    await press("Harbour Cafe");
    await until(first.alpha, first.runtime, Screen, (s) => s.place !== 0);
    const cafe = (await first.runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).place;
    await press("Save");
    await until(first.alpha, first.runtime, Screen, (s) => s.saved.length === 1);
    const rawSaved = localStorage.getItem("alpha/maps/saved@1") ?? "";
    expect(rawSaved).not.toContain("+377 93 15 00 00");
    expect(rawSaved).not.toContain("\"phone\"");

    await seen(false);
    await until(first.alpha, first.runtime, Screen, (s) => s.trip.away);
    expect((await first.runtime.runPromise(Atlas)).spot(cafe)?.phone).toBeUndefined();
    await first.close();
    await seen(true);

    const otherWorld = scene();
    otherWorld.maps.coverage = { ...otherWorld.maps.coverage, providerId: "other-open" } as typeof otherWorld.maps.coverage;
    const second = await openMaps(otherWorld);
    await until(second.alpha, second.runtime, Screen, (s) => s.saved.length === 1);
    await searchFor(second.alpha, second.runtime, "48.85, 2.35", true);
    await press("Directions");
    await fill("Starting point", "Harbour");
    expect(button("From Harbour Cafe")).toBeUndefined();
    await second.close();

    localStorage.clear();
    localStorage.setItem("alpha.maps.saved-places.v1", JSON.stringify({
      version: 1,
      items: Array.from({ length: 201 }, (_, index) => ({
        id: `p${index}`, label: `Place ${index}`, coordinate: { latitude: 43.7 + index * 0.0001, longitude: 7.4 }, savedAt: index + 1,
      })),
    }));
    const third = await openMaps(scene());
    await until(third.alpha, third.runtime, Screen, (s) => s.saved.length === 200 && s.keepable);
    await third.close();

    localStorage.clear();
    localStorage.setItem("alpha/maps/saved@1", JSON.stringify(
      Array.from({ length: 201 }, (_, index) => ({
        name: `Place ${index}`, spot: { name: `Place ${index}`, category: "", at: { lat: 43_700_000 + index, lng: 7_400_000 }, providerId: "", id: "", google: false },
      })),
    ));
    const fourth = await openMaps(scene());
    await until(fourth.alpha, fourth.runtime, Screen, (s) => !s.keepable);
  });

  it("A full saved list only renames (spec/app/maps/places.md, \"Story: Keep my saved places\")", async () => {
    const world = scene();
    const full = Array.from({ length: 200 }, (_, index) => ({ name: `Place ${index + 1}`, spot: { name: `Place ${index + 1}`, category: "", at: { lat: 43_000_000 + index, lng: 7_000_000 }, providerId: "", id: "", google: false } }));
    localStorage.setItem("alpha/maps/saved@1", JSON.stringify(full));
    const { alpha, runtime } = await onMaps(world);
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0 && s.saved.length === 200);
    // spec/app/maps/places.md, "At most 200 places are saved: a full list only renames"
    await typeMapSearch("43.5, 7.5");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.place !== 0 && !s.pinning);
    expect([button("Save"), document.body.textContent?.includes("Saved places are full. Remove one before adding another.")]).toEqual([undefined, true]);
    // spec/app/maps/places.md, "A saved place keeps its name, its coordinates and the provider's identity of it, and nothing else": a pin at a saved place's coordinates is that place
    await hardware("back");
    await fill("Search Maps", "43.000001, 7");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.place === s.saved[1]?.place);
    expect(Boolean(button("Rename place"))).toBe(true);
  });

  it("Be told why before Android asks for my location, and sent to Settings once I said no (spec/app/maps/index.md, \"Story: Use my location\"; spec/app/maps/connection.md, \"Story: Use my location\")", async () => {
    const world = { ...scene(), phone: true };
    world.maps.allowed = "prompt";
    const { alpha, runtime } = await onMaps(world);
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0);
    // spec/app/maps/index.md, "Maps opens without the disclosure, and the owner's tap for their location shows it"; spec/app/maps/index.md, "Continuing past the disclosure asks Android, once, and then locates"
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.explaining);
    expect(Boolean(button("Continue"))).toBe(true);
    world.maps.allowed = "denied";
    await press("Continue");
    await until(alpha, runtime, Screen, (s) => s.link.disclosed && !s.link.prompting && s.link.location.grant === "Denied");
    expect(world.maps.watches.size).toBe(0);
    // spec/app/maps/index.md, "Settings opens only once Android has said no"; spec/app/maps/index.md, "\"Use my location\" locates once when allowed, asks when it may, and otherwise opens Settings"
    await press("My location");
    await until(alpha, runtime, Screen, () => world.settings.opened.includes("location"));
    expect(world.maps.watches.size).toBe(0);
  });

  it("\"Use my location\" gives up when no fix arrives, and the quiet fix on opening says nothing (spec/app/maps/index.md, \"Story: Use my location\"; spec/app/maps/connection.md, \"Story: Use my location\")", async () => {
    const world = { ...scene(), phone: true };
    world.maps.allowed = "granted"; world.maps.precision = "precise";
    world.maps.here = undefined;
    world.platform.network.failing = true;
    const { alpha, runtime } = await onMaps(world);
    // spec/app/maps/index.md, "Opening Maps with location already allowed and nothing chosen takes one fix quietly, once a visit"
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0 && s.quiet && s.quietDone);
    // spec/app/maps/connection.md, "\"Use my location\" gives up after 15 seconds without a fix"
    await later(alpha, 16_000);
    await until(alpha, runtime, Screen, (s) => !s.quiet && s.link.locator === "Nobody");
    expect([document.body.textContent?.includes("No location fix arrived."), world.maps.watches.size]).toEqual([false, 0]);
    await press("Recenter");
    await until(alpha, runtime, Screen, (s) => s.link.locator === "Finder" && !s.quiet);
    await later(alpha, 16_000);
    await until(alpha, runtime, Screen, (s) => s.missedFix && s.link.locator === "Nobody");
    expect([document.body.textContent?.includes("No location fix arrived."), world.maps.watches.size]).toEqual([true, 0]);
  });

  it("A secondary click drops a pin at once, never on the directions (spec/app/maps/index.md, \"Story: Look at a place\")", async () => {
    const world = scene();
    const { alpha, runtime } = await onMaps(world);
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0);
    const send = (event: { readonly type: "menuPin"; readonly lat: number; readonly lng: number }) => act(async () => { await runtime.runPromise(Effect.ignore(Effect.flatMap(Screen, (screen) => screen.send(event)))); });
    // spec/app/maps/index.md, "A secondary click, or a menu opened with no finger down, drops a pin there at once"
    await send({ type: "menuPin", lat: 43_731_000, lng: 7_421_000 });
    await until(alpha, runtime, Screen, (s) => s.place !== 0 && !s.pinning);
    expect(document.body.textContent).toContain("Selected location");
    await press("Directions");
    await until(alpha, runtime, Screen, (s) => s.directions);
    const before = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    await send({ type: "menuPin", lat: 43_732_000, lng: 7_422_000 });
    const after = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect([after.place, after.directions]).toEqual([before.place, true]);
  });

  it("A phone updated from the previous Alpha keeps its saved places (spec/app/maps/places.md, \"Story: Keep my saved places\")", async () => {
    const world = scene();
    const row = (label: string, latitude: number, longitude: number, providerId?: string, providerPlaceId?: string) => ({ label, coordinate: { latitude, longitude }, ...(providerId === undefined ? {} : { providerId, providerPlaceId }) });
    const items = [
      row(" Home ", 43.73, 7.42),
      row("Gallery", 37.795, -122.394, "eliza-cloud-google", "g1"),
      row("", 43.74, 7.43),
      row("Home again", 43.73, 7.42),
      row("Cafe", 43.731, 7.421, "osm", "n1"),
      ...Array.from({ length: 205 }, (_, index) => row(`Place ${index + 1}`, 44 + index / 1000, 7)),
    ];
    localStorage.setItem("alpha.maps.saved-places.v1", JSON.stringify({ version: 1, items }));
    const { alpha, runtime } = await onMaps(world);
    // spec/app/maps/places.md, "A phone updated from the previous Alpha keeps its saved places"; spec/app/maps/index.md, "A list this version never wrote takes the previous Alpha's places once, and keeps them"
    await until(alpha, runtime, Screen, (s) => s.saved.length === 200 && s.keepable);
    const state = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect(state.saved.slice(0, 3).map((saved) => saved.name)).toEqual(["Home", "Cafe", "Place 1"]);
    await until(alpha, runtime, Screen, () => localStorage.getItem("alpha/maps/saved@1") !== null);
    const written = JSON.parse(localStorage.getItem("alpha/maps/saved@1") ?? "[]") as ReadonlyArray<{ name: string }>;
    expect([written.length, written[0]?.name, localStorage.getItem("alpha.maps.saved-places.v1") === JSON.stringify({ version: 1, items })]).toEqual([200, "Home", true]);
  });

  it("A previous list Alpha cannot read leaves this version's list empty and usable (spec/app/maps/places.md, \"Story: Keep my saved places\")", async () => {
    const world = scene();
    localStorage.setItem("alpha.maps.saved-places.v1", JSON.stringify({ version: 1, items: [{ label: "Home", coordinate: { latitude: "north" } }] }));
    const { alpha, runtime } = await onMaps(world);
    // spec/app/maps/places.md, "A phone updated from the previous Alpha keeps its saved places": a previous list that cannot be read leaves this version's list empty and usable
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0);
    await typeMapSearch("48.85, 2.35");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.place !== 0 && !s.pinning);
    expect([Boolean(button("Save")), document.body.textContent?.includes("Saved places could not be read.")]).toEqual([true, false]);
  });

  it("Let the agent read the place I am looking at, only by the handle it was told and once I approved (spec/app/maps/index.md, \"Story: Let the agent help with Maps\")", async () => {
    const world = scene();
    const { alpha, runtime } = await onMaps(world);
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0);

    // spec/app/maps/index.md, "While Maps is in front the agent is told what it shows, a place, a route or a search, by a handle that names it on this phone only": a search alone is never readable
    await typeMapSearch("gallery");
    await enter("Search Maps");
    await until(alpha, runtime, Screen, (s) => s.search.status === "Loaded" && s.results === 1);
    expect(await runtime.runPromise(mapsSelected())).toBeUndefined();
    await press("Harbour Gallery");
    await until(alpha, runtime, Screen, (s) => s.place !== 0);
    const selected = await runtime.runPromise(mapsSelected());
    if (selected === undefined) throw new Error("Maps named no place to the agent");
    expect([selected.kind, /^maps_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(selected.id), selected.id.includes("gallery")]).toEqual(["map-place", true, false]);
    const target = { kind: selected.kind, id: selected.id, revision: selected.revision };

    // spec/app/maps/index.md, "The agent may ask to read the place on the card, which is put to the owner once its last read has ended": a selection changed since, or a read the owner did not approve, is never read
    const stale = await runtime.runPromise(readSelected({ type: "maps_read_selected", target: { ...target, revision: String(Number(target.revision) + 1) } }, () => Promise.resolve(true)));
    const unapproved = await runtime.runPromise(readSelected({ type: "maps_read_selected", target }, () => Promise.resolve(false)));
    expect([stale, unapproved]).toEqual([{ kind: "refused", code: "DEVICE_NOT_DISPATCHED" }, { kind: "refused", code: "DEVICE_NOT_DISPATCHED" }]);
    expect((await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()))).asked).toBe(0);

    // spec/app/maps/index.md, "Approving hands the agent the place shown, as a read sent once under its question's number, or starts guidance on the route shown"; spec/app/maps/index.md, "The agent is told how its read ended: delivered, refused, or unknown when no answer can be trusted"
    const read = await runtime.runPromise(readSelected({ type: "maps_read_selected", target }, () => Promise.resolve(true)));
    expect(read).toMatchObject({ kind: "applied", result: { kind: "maps_read_selected", target, fields: { kind: "map-place", label: "Harbour Gallery" } } });
    const at = (read as { result: { fields: { coordinate: { latitude: number; longitude: number } } } }).result.fields.coordinate;
    expect([at.latitude, at.longitude].map((degrees) => Math.round(degrees * 1e4))).toEqual([437333, 74167]);
    await until(alpha, runtime, Screen, (s) => s.asked === 1 && s.telling.id === 1 && s.telling.outcome !== "Sent" && s.question === "NoQuestion");

    // spec/app/maps/index.md, "No place reaches the agent without the owner's approval of that place": outside Maps nothing is shown
    await hardware("home");
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.at(-1) !== "Maps");
    expect(await runtime.runPromise(mapsSelected())).toBeUndefined();
  });

  it("A Calendar event hands Maps its place's words, and Back goes back to the event (spec/app/maps/index.md, \"Story: Come from a Calendar event\")", async () => {
    const world = scene();
    const { alpha } = await open(world, only("home", "view:Maps", "view:Calendar"));
    await showMaps(alpha);
    const runtime = maps.runtime(alpha);
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0);
    // spec/app/maps/index.md, "A query another app hands to Maps opens as a search, never over navigation"
    await act(async () => { await runtime.runPromise(handedOver("harbour", 7)); });
    await until(alpha, runtime, Screen, (s) => s.searching && s.fromEvent === 7 && s.search.status === "Loaded" && s.results === 2);
    // spec/app/maps/index.md, "Back leaves one mode: navigation to its directions, directions to the place, the place to the search, the search to the map"
    await hardware("back");
    await until(alpha, runtime, Screen, (s) => !s.searching && s.fromEvent === 0);
    await until(alpha, alpha.runtime, Shell, (s) => s.trail.at(-1) === "Calendar");
  });

  it(`Keeps the world basemap usable when Cloud tiles return 402 insufficient credits and installs Google on Retry without refetching the probed tile (spec/app/maps/connection.md, "Story: Serve Maps through my cloud account"; spec/app/maps/connection.md, "Google's content is drawn only on Google's own map, whose only credit is the Google Maps badge")`, async () => {
    const world = { ...scene(), phone: true };
    if (!world.maps.coverage.available) throw new Error("expected available coverage");
    world.maps.coverage = {
      ...world.maps.coverage,
      providerId: "google",
      sources: { data: "Google Maps", search: "Google Maps", routing: "Google Maps" },
      capabilities: { ...world.maps.coverage.capabilities, map: true },
      tiles: { urlTemplate: "/api/v1/maps/tiles/{z}/{x}/{y}", mapType: "roadmap", minZoom: 0, maxZoom: 22, tileSize: 256, attribution: "Google" },
    };
    world.maps.tilesInsufficientCredits = true;
    const { alpha, runtime } = await openMaps(world, (s) => s.link.unoffered);

    const depleted = await runtime.runPromise(Effect.flatMap(Screen, (screen) => screen.get()));
    expect([depleted.link.provider, depleted.link.google, depleted.link.basemap, world.maps.tiles]).toEqual([0, false, "World", ["0/0/0"]]);
    expect(document.querySelector("[role=application]")).not.toBeNull();
    expect(document.body.textContent).toContain("Add Alpha Cloud credits to search places and get directions.");
    expect(document.body.textContent).toContain("OpenFreeMap");
    expect(document.body.textContent).not.toContain("Maps unavailable");
    expect(document.body.textContent).not.toContain("The Google map is missing.");

    world.maps.tilesInsufficientCredits = false;
    await press("Retry");
    await until(alpha, runtime, Screen, (s) => s.link.provider !== 0 && s.link.google && s.link.basemap === "Cloud");
    expect(world.maps.tiles).toEqual(["0/0/0", "0/0/0"]);
    const cached = await runtime.runPromise(tile(0, 0, 0, new AbortController().signal));
    expect([cached.byteLength > 0, world.maps.tiles]).toEqual([true, ["0/0/0", "0/0/0"]]);
    expect(document.body.textContent).not.toContain("Add Alpha Cloud credits");
  });

  it(`Falls back to AlphaNetworkLocation after 4 seconds indoors and offsets the search bar by the safe top inset (spec/app/maps/connection.md, "Story: Use my location")`, async () => {
    const world = { ...scene(), phone: true };
    world.maps.allowed = "granted";
    world.maps.precision = "precise";
    world.maps.here = undefined;
    const { alpha, runtime } = await openMaps(world, (s) => s.link.provider !== 0 && s.link.location.grant === "Granted" && s.quiet);

    const searchBox = document.querySelector<HTMLInputElement>("input[aria-label='Search Maps']")?.closest("form");
    expect(searchBox?.className).toContain("var(--alpha-safe-top)");

    await later(alpha, 4_000);
    await until(alpha, runtime, Screen, (s) => !s.quiet && s.link.locator === "Nobody");
    const store = await runtime.runPromise(Atlas);
    expect([world.platform.network.asked.length, store.snapshot().here]).toEqual([1, { at: { lat: 51_500_000, lng: -120_000 }, accuracy: 40, approximate: true }]);
    expect(document.body.textContent).not.toContain("No location fix arrived.");
  });
});
