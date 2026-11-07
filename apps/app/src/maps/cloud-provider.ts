import { readServiceLimit, retryDuration } from '../runtime/subscription-entitlement.ts';
import { boundedText, coordinate, MapsFailure, place, type Coordinate, type MapsProvider, type Place, type ProviderConfig, type Route, type TravelMode } from './contracts.ts';

/** Exact Cloud Maps routes (#412) that the managed-service transport admits. */
export type CloudMapsRoute = 'capabilities' | 'geocode' | 'reverse' | 'places/search' | 'places/details' | 'routes';
/** Account-bound Cloud request. Queries and coordinates travel only in the JSON body. */
export type CloudMapsRequest = (route: CloudMapsRoute, signal: AbortSignal, body?: Record<string, unknown>) => Promise<Record<string, unknown>>;
export type CloudMapsRegion = Readonly<{ id: string; name: string; bounds: readonly [number, number, number, number] }>;
export type CloudMapsCoverage = Readonly<{ providerId: string; revision: string; attribution: string; regions: readonly CloudMapsRegion[] }>;

const MODES: readonly TravelMode[] = ['drive', 'walk', 'bicycle', 'transit'];
/** What Cloud may advertise: live traffic, scheduled transit, or neither. Approximations are refused. */
const TRAFFIC = ['none', 'live'] as const, TRANSIT = ['none', 'scheduled'] as const;
type CloudTraffic = typeof TRAFFIC[number]; type CloudTransit = typeof TRANSIT[number];

function validBounds(value: unknown): value is [number, number, number, number] {
 if (!Array.isArray(value) || value.length !== 4 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return false;
 const [west, south, east, north] = value as number[];
 return west >= -180 && east <= 180 && south >= -90 && north <= 90 && west < east && south < north;
}

/** Whether a point is inside any Cloud coverage region. */
export function insideCloudCoverage(coverage: Pick<CloudMapsCoverage, 'regions'>, point: Coordinate): boolean {
 return coverage.regions.some(({ bounds: [west, south, east, north] }) => point.longitude >= west && point.longitude <= east && point.latitude >= south && point.latitude <= north);
}

/** Typed device failure for a Cloud refusal. Cloud never sends guessed data, so no fallback is tried. */
export function cloudMapsFailure(error: unknown, signal?: AbortSignal): MapsFailure {
 if (error instanceof MapsFailure) return error;
 if (signal?.aborted) return new MapsFailure('cancelled', 'Maps request cancelled.');
 const failure = error as { name?: unknown; code?: unknown; status?: unknown; data?: unknown } | null;
 if (failure && typeof failure === 'object' && failure.name === 'CloudProtocolError') {
  if (failure.code === 'invalid-response') return new MapsFailure('invalid-response', 'Maps is unavailable right now.');
  if (failure.code !== 'http') return new MapsFailure('unauthorized', 'Sign in to use Maps.');
  const code = failure.data && typeof failure.data === 'object' ? (failure.data as { code?: unknown }).code : undefined;
  if(code==='maps_allowance_unconfigured')return new MapsFailure('unconfigured','Maps isn’t available yet.');
  if(code==='maps_admission_unknown'||code==='maps_request_already_admitted'||code==='maps_request_identity_conflict')return new MapsFailure('unavailable','Maps couldn’t finish that request.');
  switch (failure.status) {
   case 401: return new MapsFailure('unauthorized', 'Sign in to use Maps.');
   // An authenticated 404 means this Cloud deployment does not serve Maps yet (#412).
   case 404: return new MapsFailure('unconfigured', 'Maps isn’t available yet.');
   case 403: return new MapsFailure('unauthorized', code === 'subscription_required' ? 'Maps comes with an Eliza Cloud plan.' : 'Maps isn’t available for this account.');
   case 429: {
    const now = Date.now(), limit = readServiceLimit(error, now);
    if (limit?.kind === 'allowance-exhausted') {
     const reset = limit.resetsAt != null && limit.resetsAt > now && limit.resetsAt - now <= 400 * 86400000 ? ` Resets ${new Date(limit.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.` : limit.retryAfterMs != null ? ` Resets in ${retryDuration(limit.retryAfterMs)}.` : '';
     return new MapsFailure('rate-limited', `Maps limit reached.${reset}`);
    }
    const retryMs = limit?.retryAfterMs ?? (limit?.resetsAt != null && limit.resetsAt > now && limit.resetsAt - now <= 86400000 ? limit.resetsAt - now : null);
    const wait = retryMs != null ? `Try again in ${retryDuration(retryMs)}.` : 'Try again later.';
    return new MapsFailure('rate-limited', `Too many Maps requests. ${wait}`);
   }
   case 422: return new MapsFailure('unsupported', code === 'no_route' ? 'No route is available between these places.' : code === 'unsupported_mode' ? 'This travel mode isn’t available here.' : 'Maps doesn’t cover this area yet.');
   case 503: return code === 'maps_not_configured' ? new MapsFailure('unconfigured', 'Maps isn’t available yet.') : new MapsFailure('unavailable', 'Maps is unavailable right now.');
   default: return new MapsFailure(failure.status === 502 ? 'invalid-response' : 'unavailable', 'Maps is unavailable right now.');
  }
 }
 if (error instanceof Error && /network|offline|timed out|failed to fetch|load failed|internet/i.test(error.message)) return new MapsFailure('offline', 'Offline. Maps reconnects when you’re back online.');
 return new MapsFailure('unavailable', 'Maps is unavailable right now.');
}

/**
 * Cloud Maps as the device provider. Cloud supplies places and routes only; GPS,
 * the active route and guidance stay on the phone. Cloud serves no tiles, so the
 * capabilities report no map plane.
 */
export function createCloudMaps(captureRequest: () => CloudMapsRequest, configure: (config: ProviderConfig, provider?: MapsProvider) => void,
 /** Failure codes the caller retries by itself; only those say "Trying again automatically." */
 retried: (code: string) => boolean = () => false) {
 let generation = 0;
 let coverage: CloudMapsCoverage | undefined;
 // Only a provider this instance installed is retired; another configured provider is left alone.
 let installed = false;
 const uninstall = () => { if (installed) { installed = false; configure({ status: 'unconfigured' }); } };
 const diagnostic = { configured: false, error: '', message: '' };
 async function call(request: CloudMapsRequest, route: CloudMapsRoute, signal: AbortSignal, body?: Record<string, unknown>) {
  try { return await request(route, signal, body); } catch (error) { throw cloudMapsFailure(error, signal); }
 }
 class CloudProvider implements MapsProvider {
  constructor(readonly providerId: string, readonly connectionId: string, private readonly request: CloudMapsRequest) {}
  private places(value: unknown): readonly Place[] {
   if (!Array.isArray(value) || value.length > 100) throw new MapsFailure('invalid-response', 'Maps is unavailable right now.');
   return value.map(item => place(item, this.providerId));
  }
  async search(query: string, signal: AbortSignal): Promise<readonly Place[]> {
   const text = query.trim();
   if (!text) return [];
   if (text.length > 300) throw new MapsFailure('unsupported', 'Search text is too long.');
   return this.places((await call(this.request, 'places/search', signal, { query: text })).places);
  }
  async detail(id: string, signal: AbortSignal): Promise<Place | null> {
   if (!boundedText(id, 512)) return null;
   const result = (await call(this.request, 'places/details', signal, { id })).place;
   return result === null ? null : place(result, this.providerId);
  }
  async route(from: Coordinate, to: Coordinate, mode: TravelMode, signal: AbortSignal): Promise<Route> {
   const routes = (await call(this.request, 'routes', signal, { from: coordinate(from), to: coordinate(to), mode })).routes;
   // The controller validates the route's identity, endpoints, geometry and steps.
   if (!Array.isArray(routes) || !routes[0] || typeof routes[0] !== 'object') throw new MapsFailure('invalid-response', 'Maps is unavailable right now.');
   return routes[0] as Route;
  }
 }
 /** Reads coverage and configures the provider. On failure Maps stays unconfigured; nothing falls back. */
 async function initializeCloudMaps(signal: AbortSignal = new AbortController().signal): Promise<void> {
  const attempt = ++generation;
  coverage = undefined;
  uninstall();
  diagnostic.configured = true; diagnostic.error = ''; diagnostic.message = '';
  try {
   const captured = captureRequest();
   const request: CloudMapsRequest = async (route, signal, body) => {
    if (attempt !== generation) throw new MapsFailure('cancelled', 'Maps connection changed.');
    signal.throwIfAborted();
    const value = await captured(route, signal, body);
    signal.throwIfAborted();
    if (attempt !== generation) throw new MapsFailure('cancelled', 'Maps connection changed.');
    return value;
   };
   const meta = await call(request, 'capabilities', signal);
   const caps = meta.capabilities as Record<string, unknown> | undefined;
   const regions = meta.regions;
   if (typeof meta.providerId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,79}$/.test(meta.providerId) ||
    typeof meta.connectionId !== 'string' || !/^conn_[A-Za-z0-9_-]{16,}$/.test(meta.connectionId) ||
    !boundedText(meta.revision, 100) || !boundedText(meta.attribution, 2000) ||
    !Array.isArray(regions) || regions.length < 1 || regions.length > 64 ||
    !regions.every(r => r && typeof r === 'object' && boundedText(r.id, 64) && boundedText(r.name, 100) && validBounds(r.bounds)) ||
    !caps || caps.search !== true || caps.placeDetails !== true ||
    !TRAFFIC.includes(caps.traffic as CloudTraffic) || !TRANSIT.includes(caps.transit as CloudTransit) ||
    !Array.isArray(caps.modes) || caps.modes.length < 1 || !caps.modes.every(mode => MODES.includes(mode)) ||
    // Transit is a mode exactly when Cloud has schedules for it.
    caps.modes.includes('transit') !== (caps.transit === 'scheduled'))
    throw new MapsFailure('invalid-response', 'Maps is unavailable right now.');
   coverage = Object.freeze({ providerId: meta.providerId, revision: meta.revision as string, attribution: meta.attribution as string,
    regions: Object.freeze(regions.map(r => Object.freeze({ id: r.id, name: r.name, bounds: Object.freeze([...r.bounds]) as unknown as CloudMapsRegion['bounds'] }))) });
   configure({ status: 'configured', providerId: meta.providerId, connectionId: meta.connectionId, revision: meta.revision as string,
    capabilities: { map: false, search: true, placeDetails: true, modes: [...caps.modes as TravelMode[]], traffic: caps.traffic as CloudTraffic, transit: caps.transit as CloudTransit, offline: { map: false, search: false, routing: false } } },
   new CloudProvider(meta.providerId, meta.connectionId, request));
   installed = true;
  } catch (error) {
   if (attempt !== generation) return;
   coverage = undefined;
   const failure = cloudMapsFailure(error, signal);
   diagnostic.error = failure.code; diagnostic.message = retried(failure.code) ? `${failure.message} Trying again automatically.` : failure.message;
  }
 }
 return {
  initializeCloudMaps,
  retireCloudMaps: () => { ++generation; coverage = undefined; diagnostic.error = 'unauthorized'; diagnostic.message = 'Sign in to use Maps.'; uninstall(); },
  cloudMapsCoverage: () => coverage,
  cloudMapsDiagnostics: () => ({ ...diagnostic }),
 };
}
