import { createCloudMaps } from './cloud-provider';
import { captureMapsSession } from './cloud-session';
import { configureMapsProvider } from './runtime';
import { connectionController } from '../runtime/connection-ui';

/** Failures that clear up by themselves ("Maps is unavailable right now. Trying again
 * automatically."): retried after 30 s, 1, 2 and then every 5 minutes while signed in and in front. */
const TRANSIENT = new Set(['unavailable', 'invalid-response', 'timeout']);
const RETRY_MS = [30_000, 60_000, 120_000, 300_000];
/** Cloud supplies data only; retained routes belong to the session that requested them. */
const maps = createCloudMaps(() => captureMapsSession(() => connectionController.getCloudClient()), configureMapsProvider, code => TRANSIENT.has(code));
export const { initializeCloudMaps, cloudMapsCoverage, cloudMapsDiagnostics } = maps;
let previous = connectionController.getCloudClient(), lastAttempt = 0, pending: Promise<void> | undefined;
let retry: ReturnType<typeof setTimeout> | undefined, retries = 0;
/** Maps connects when Alpha has a Cloud sign-in, not when the Maps screen first opens, so the
 * agent can search and route at once. It reconnects by itself after a failure: on account change,
 * when the network returns, when Alpha comes back to the front (at most once a minute), and on a
 * timer while Cloud Maps is temporarily unavailable. */
function connectNow(force = false) {
 // A forced connect (a new account, the network back) replaces one still in flight: the older
 // attempt is superseded and never reports its result.
 if (!connectionController.getCloudClient() || (pending && !force)) return;
 const state = maps.cloudMapsDiagnostics();
 if (!force && state.configured && !state.error) return;
 if (!force && Date.now() - lastAttempt < 60000) return;
 lastAttempt = Date.now();
 if (retry !== undefined) { clearTimeout(retry); retry = undefined; }
 const attempt: Promise<void> = maps.initializeCloudMaps().finally(() => { if (pending !== attempt) return; pending = undefined; scheduleRetry(); });
 pending = attempt;
}
/** The connection in flight, settled once no newer one replaced it; undefined when none is. */
export function cloudMapsConnecting(): Promise<void> | undefined {
 if (!pending) return undefined;
 return (async () => { for (let current = pending; current; current = pending) await current.catch(() => {}); })();
}
function scheduleRetry() {
 const { error } = maps.cloudMapsDiagnostics();
 if (!error) { retries = 0; return; }
 if (!TRANSIENT.has(error) || retry !== undefined || typeof document === 'undefined' || document.hidden || !connectionController.getCloudClient()) return;
 retry = setTimeout(() => { retry = undefined; connectNow(true); }, RETRY_MS[Math.min(retries++, RETRY_MS.length - 1)]);
}
connectionController.subscribe(() => {
 const next = connectionController.getCloudClient();
 if (previous?.sessionId !== next?.sessionId || previous?.credentialId !== next?.credentialId || previous?.client !== next?.client) {
  previous = next;
  // A new account never inherits the old session's routes or guidance.
  if (maps.cloudMapsDiagnostics().configured) maps.retireCloudMaps();
  retries = 0;
  if (next) connectNow(true);
 }
});
if (typeof window !== 'undefined') {
 window.addEventListener('online', () => { retries = 0; connectNow(true); });
 document.addEventListener('visibilitychange', () => { if (!document.hidden) connectNow(); });
 queueMicrotask(() => connectNow(true));
}
