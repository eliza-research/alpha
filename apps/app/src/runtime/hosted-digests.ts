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
  type DigestSpec,
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
/** A saved request still in review never reached the agent, so it may be discarded. Once dispatched
 * only Retry is safe; a record from an older build has no phase and counts as dispatched. */
export function digestPendingDiscardable(pending: {phase?: unknown}): boolean {
  return pending.phase === 'review';
}
/** Pause or resume keeps the saved schedule: only `enabled` changes, never the time, zone or source. */
export function digestToggledSpec(spec: DigestSpec, enabled: boolean): DigestSpec {
  return {...spec, enabled};
}
/** Selected calendar ids the latest phone calendar list no longer offers. */
export function digestMissingCalendars(selected: readonly string[], choices: ReadonlyArray<{id: string}>): string[] {
  return selected.filter(id => !choices.some(choice => choice.id === id));
}
/** What a result tap that cannot open says. Before the digest binding exists the agent is still
 * connecting, so the tap waits for the next check instead of claiming another account. */
export function digestTapNotice(kind: string, bound: boolean): string | null {
  if (!bound) return null;
  return kind === 'other-account' ? 'Sign in to the matching account to open this result.' : 'This result isn’t available.';
}
