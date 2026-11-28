// spec/app/maps/connection.md, "Story: Serve Maps through my cloud account"
import type { LocationErrorEvent, LocationPlugin, LocationResult } from "@elizaos/os-bridges";
import type { CloudClient } from "../../src/platform/cloud.vibe";
import { type Faked, plugin, rejection } from "./phone.ts";
import { type Route, readJsonBody } from "./routes.ts";

type Capabilities = Awaited<ReturnType<CloudClient["mapsCapabilities"]>>;
type CloudPlace = Awaited<ReturnType<CloudClient["mapsPlacesSearch"]>>["places"][number];
type CloudRoute = Awaited<ReturnType<CloudClient["mapsRoutes"]>>["routes"][number];

const attribution = "Map data from the test provider";

/** A place as the fake Cloud Maps answers it, typed by eliza's own schema. */
export function cloudPlace(id: string, name: string, latitude: number, longitude: number, phone?: string, more: Pick<CloudPlace, "address" | "openingHours" | "website"> = {}): CloudPlace {
  return { providerId: "test-open", id, name, coordinate: { latitude, longitude }, attribution, fetchedAt: 1, ...(phone === undefined ? {} : { phone }), ...more };
}

/** A route of `steps` steps along a straight line from `from` to `to`, `meters` long. */
export function cloudRoute(id: string, from: CloudPlace["coordinate"], to: CloudPlace["coordinate"], meters: number, steps: number): CloudRoute {
  const at = (share: number) => ({ latitude: from.latitude + (to.latitude - from.latitude) * share, longitude: from.longitude + (to.longitude - from.longitude) * share });
  return {
    providerId: "test-open", id, from, to, mode: "drive", geometry: [from, to], distanceMeters: meters, durationSeconds: meters / 10,
    steps: Array.from({ length: steps }, (_, index) => ({
      instruction: index === 0 ? "Head north" : index === steps - 1 ? "Arrive" : "Turn left", coordinate: at(index / Math.max(1, steps - 1)), distanceMeters: meters / steps,
      maneuver: index === 0 ? "depart" : index === steps - 1 ? "arrive" : "left",
    })),
    attribution, fetchedAt: 1, traffic: "none",
  };
}

/** What the fake Cloud Maps holds and how it behaves; a journey changes it between steps. */
export interface MapsScene {
  /** The coverage the account's deployment answers. */
  coverage: Capabilities;
  /** Every place a search can find, by the words of its name. */
  places: CloudPlace[];
  /** The routes a plan answers, in order. */
  routes: CloudRoute[];
  /** Searches answer 429 with this wait in seconds, once each, while it is set. */
  limited: number | undefined;
  /** What each Maps request asked, by its route, and the request key it carried. */
  readonly asked: { path: string; key: string | null; body: unknown }[];
  /** Where the fake phone is. */
  here: { latitude: number; longitude: number; accuracy: number } | undefined;
  /** Where the network says the phone is when GPS is absent. */
  network?: { latitude: number; longitude: number; accuracy: number };
  /** Whether Android currently grants Alpha location permission. */
  allowed: "granted" | "denied" | "prompt";
  /** When set, Android's location prompt stays open until it settles. */
  answer?: Promise<void>;
  /** How precisely Android lets Alpha locate the phone, once location is allowed. */
  precision: "precise" | "approximate";
  /** The page's listeners of the fake location plugin. */
  readonly listeners: Set<(result: LocationResult) => void>;
  /** The native watches the page started and has not cleared. */
  readonly watches: Set<string>;
  /** Alpha's screen-off guidance service: the session running with its notification, the arrival notices shown, and whether the owner opened Alpha from the notification. */
  readonly guidance: { session: string | undefined; title: string; text: string; arrivals: string[]; opened: boolean; stop?: (reason: string) => void };
  /** Tiles answer 429 with this wait in seconds, once each, while it is set. */
  tilesLimited: number | undefined;
  /** Tiles answer 402 insufficient_credits while true. */
  tilesInsufficientCredits?: boolean;
  /** The tiles the page fetched, as `z/x/y`. */
  readonly tiles: string[];
}

export const harbour = cloudPlace("test:harbour", "Harbour Cafe", 43.7312, 7.4211, "+377 93 15 00 00",
  { address: "6 Quai Antoine 1er, Monaco", openingHours: "Closed · opens 7:30 AM", website: "https://harbour-cafe.example/" });
export const gallery = cloudPlace("test:gallery", "Harbour Gallery", 43.7333, 7.4167, undefined, { address: "11 Rue Grimaldi, Monaco" });

export function mapsScene(): MapsScene {
  return {
    coverage: {
      available: true, providerId: "test-open", connectionId: "conn_testtesttesttest01", revision: "1", attribution,
      sources: { data: "Test data", search: "Test search", routing: "Test routing" },
      disclosure: { recipients: [{ role: "search", name: "Test search", operator: "Test" }], cloudRecords: "operation-and-result-code" },
      regions: [{ id: "mc", name: "Monaco", bounds: [7.40, 43.70, 7.45, 43.76] }],
      capabilities: {
        map: false, search: true, placeDetails: true, geocode: true, reverseGeocode: true, placeLookup: true,
        modes: ["drive", "walk"], alternatives: true, traffic: "none", transit: "none", offline: { map: false, search: false, routing: false },
      },
    },
    places: [harbour, gallery],
    routes: [cloudRoute("default", { latitude: 43.7300, longitude: 7.4200 }, harbour.coordinate, 1900, 4)],
    limited: undefined,
    asked: [],
    here: { latitude: 43.7300, longitude: 7.4200, accuracy: 8 },
    allowed: "granted",
    precision: "precise",
    listeners: new Set(),
    watches: new Set(),
    guidance: { session: undefined, title: "", text: "", arrivals: [], opened: false },
    tilesLimited: undefined,
    tiles: [],
  };
}

/** The page's speech synthesis as a recorder: what it was asked to read aloud, in order, and how often it was cut off. */
export function speech(): { readonly spoken: string[]; cancels: number } {
  const heard = { spoken: [] as string[], cancels: 0 };
  class Utterance { constructor(readonly text: string) {} }
  Object.assign(globalThis, {
    SpeechSynthesisUtterance: Utterance,
    speechSynthesis: { speak: (said: Utterance) => { heard.spoken.push(said.text); }, cancel: () => { heard.cancels += 1; } },
  });
  return heard;
}

/** The fake phone moves to `latitude, longitude`, and its open watches report it. */
export function move(scene: MapsScene, latitude: number, longitude: number, accuracy = 8, timestamp = 0) {
  scene.here = { latitude, longitude, accuracy };
  for (const told of scene.listeners) told({ coords: { latitude, longitude, accuracy, timestamp }, cached: false });
}

async function asked(scene: MapsScene, request: Request, url: URL): Promise<unknown> {
  const body: unknown = request.method === "POST" ? await readJsonBody(request) : undefined;
  scene.asked.push({ path: url.pathname, key: request.headers.get("idempotency-key"), body });
  return body;
}

/** Cloud Maps as eliza's cloud answers it, raw JSON in eliza's own shapes. */
export function mapsRoutes(scene: MapsScene, now: () => number): Route[] {
  const rateLimited = (wait: number) => Response.json(
    { error: "rate_limited", ...(wait > 0 ? { retryAt: now() + wait * 1000 } : {}) },
    { status: 429, ...(wait > 0 ? { headers: { "retry-after": new Date(now() + wait * 1000).toUTCString() } } : {}) },
  );
  return [
    (request, url) => (request.method === "GET" && url.pathname === "/api/v1/maps/capabilities" ? Response.json(scene.coverage) : undefined),
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/v1/maps/places/search") return;
      return asked(scene, request, url).then((body) => {
        if (scene.limited !== undefined) {
          const wait = scene.limited;
          scene.limited = undefined;
          return rateLimited(wait);
        }
        const query = typeof body === "object" && body !== null && "query" in body ? String(body.query).toLowerCase() : "";
        const providerId = scene.coverage.available ? scene.coverage.providerId : "test-open";
        return Response.json({ providerId, attribution, places: scene.places.filter((place) => place.name.toLowerCase().includes(query)).map((place) => ({ ...place, providerId })) });
      });
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/v1/maps/places/details") return;
      return asked(scene, request, url).then((body) => {
        const id = typeof body === "object" && body !== null && "id" in body ? String(body.id) : "";
        const providerId = scene.coverage.available ? scene.coverage.providerId : "test-open";
        const found = scene.places.find((place) => place.id === id);
        return Response.json({ providerId, attribution, place: found ? { ...found, providerId } : null });
      });
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/v1/maps/routes") return;
      return asked(scene, request, url).then(() =>
        scene.routes.length === 0
          ? Response.json({ error: { code: "NoRoute", message: "no route" } }, { status: 422 })
          : Response.json({ providerId: "test-open", attribution, routes: scene.routes }));
    },
    (request, url) => {
      const tile = /^\/api\/v1\/maps\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(url.pathname);
      if (request.method !== "GET" || tile === null) return;
      scene.tiles.push(`${tile[1]}/${tile[2]}/${tile[3]}`);
      if (scene.tilesInsufficientCredits) {
        return Response.json({ error: "insufficient_credits", errorDescription: "Insufficient credits.", retryable: false }, { status: 402 });
      }
      if (scene.tilesLimited !== undefined) {
        const wait = scene.tilesLimited;
        scene.tilesLimited = undefined;
        return rateLimited(wait);
      }
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== "/api/v1/maps/tiles/viewport") return;
      return asked(scene, request, url).then(() => Response.json({ providerId: "test-open", copyright: "Map data ©2026 Test" }));
    },
  ];
}

/** `ElizaLocation` of eliza's Android package: its permission, which Maps and Settings read, one watch per call, and the positions the scene moves to. */
export function elizaLocation(scene: MapsScene, now: () => number): Faked {
  return plugin<LocationPlugin, { locationChange: LocationResult; error: LocationErrorEvent }>((emit, onUnplug) => {
    const told = (result: LocationResult) => emit("locationChange", result);
    let next = 0;
    onUnplug?.(() => {
      scene.watches.clear();
      scene.listeners.delete(told);
    });
    return {
      checkPermissions: () => Promise.resolve({ location: scene.allowed, accuracy: scene.precision }),
      requestPermissions: async () => {
        await scene.answer;
        if (scene.allowed === "prompt") scene.allowed = "granted";
        return { location: scene.allowed, accuracy: scene.precision };
      },
      getCurrentPosition: (options) => {
        const found = options?.accuracy === "low" ? scene.network : scene.here;
        return found && scene.allowed === "granted" ? Promise.resolve({ coords: { ...found, timestamp: now() }, cached: false }) : Promise.reject(rejection("TIMEOUT"));
      },
      watchPosition: () => {
        if (scene.allowed !== "granted") return Promise.reject(rejection("PERMISSION_DENIED"));
        const watchId = `w${++next}`;
        scene.watches.add(watchId);
        scene.listeners.add(told);
        const here = scene.here;
        if (here) void Promise.resolve().then(() => { if (scene.watches.has(watchId)) told({ coords: { ...here, timestamp: now() }, cached: false }); });
        return Promise.resolve({ watchId });
      },
      clearWatch: ({ watchId }) => {
        scene.watches.delete(watchId);
        if (scene.watches.size === 0) scene.listeners.delete(told);
        return Promise.resolve();
      },
      removeAllListeners: () => {
        scene.watches.clear();
        scene.listeners.delete(told);
        return Promise.resolve();
      },
    };
  });
}

/** `AlphaMapsTransport` of Alpha's host: the foreground service that guides with the screen off, and its notification's Stop. */
export function alphaMapsTransport(scene: MapsScene): Faked {
  return (emit) => {
    const guidance = scene.guidance;
    guidance.stop = (reason) => {
      const session = guidance.session;
      guidance.session = undefined;
      if (session !== undefined) emit("navigationStopped", { sessionId: session, reason });
    };
    return {
      navigationAvailability: () => Promise.resolve({ background: true }),
      startNavigation: ({ sessionId, title, text }: { sessionId: string; title: string; text: string }) => {
        Object.assign(guidance, { session: sessionId, title, text });
        return Promise.resolve();
      },
      updateNavigation: ({ sessionId, title, text }: { sessionId: string; title: string; text: string }) => {
        const active = guidance.session === sessionId;
        if (active) Object.assign(guidance, { title, text });
        return Promise.resolve({ active });
      },
      navigationArrived: ({ text }: { text: string }) => {
        guidance.arrivals.push(text);
        return Promise.resolve({ shown: true });
      },
      stopNavigation: ({ sessionId }: { sessionId: string }) => {
        const stopped = guidance.session === sessionId;
        if (stopped) guidance.session = undefined;
        return Promise.resolve({ stopped });
      },
      consumeNavigationOpen: () => {
        const open = guidance.opened;
        guidance.opened = false;
        return Promise.resolve({ open });
      },
    };
  };
}
