/**
 * Scheduled digests (resident briefs). The protocol client, the client-scoped result inbox, the
 * occurrence policy and the retained-brief selection are the shared upstream client
 * (`plugins/plugin-workflow/src/client/hosted-digests.ts`); the agent schedules through the durable
 * runtime scheduler and this app never runs a digest. Alpha keeps only its retained-brief binding
 * for Home: one store for the current connection and the `alpha:retained-digest` window event.
 */
import {
  RetainedBriefStore,
  type DigestResult,
  type RetainedDigestSummary,
} from '../../../../.eliza/client-features/plugins/plugin-workflow/src/client/hosted-digests.ts';

export * from '../../../../.eliza/client-features/plugins/plugin-workflow/src/client/hosted-digests.ts';

const retained = new RetainedBriefStore();
retained.subscribe(() => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('alpha:retained-digest'));
});
/** Latest retained digest of the current connection, for Home. Never a fresh read or a run. */
export function latestRetainedDigest(): RetainedDigestSummary | null {
  return retained.current();
}
export function subscribeRetainedDigest(listener: () => void): () => void {
  return retained.subscribe(listener);
}
/**
 * Binds the retained brief to the current connection scope (origin, owner and agent). A different
 * scope clears it, and results read for another scope are ignored afterwards; `null` clears it.
 */
export function bindRetainedDigestScope(scope: string | null): void {
  retained.bind(scope);
}
/** Records the newest retained brief that actually ran, or clears it for `null`. A missed or skipped
 * occurrence never replaces the last brief on Home. Returns false when `scope` is not the bound one. */
export function rememberRetainedDigests(results: DigestResult[] | null, agent = 'Your agent', scope?: string): boolean {
  return retained.remember(results, {agent, ...(scope === undefined ? {} : {scope})});
}
