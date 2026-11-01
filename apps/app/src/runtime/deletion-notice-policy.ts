import {
 pendingDeletionNotices,
 undoConfirmed,
 type DeferredDeletionsBridge,
} from '../../../../.eliza/client-features/packages/contracts/src/deletion-window';
import type {DeferredDeletionIdentity} from '../../../../.eliza/client-features/packages/ui/src/components/composites/deferred-deletion-notice';

/** Alpha keeps passive polling quiet until this owner has a deletion to reconcile.
 * The shared notice still owns polling, action errors and lifecycle fencing. */
export function createDeletionNoticePolicy(bridge: DeferredDeletionsBridge, identity: DeferredDeletionIdentity) {
 let owner = identity.read(), generation = 0, known = new Set<string>();
 const current = () => {
  const next = identity.read();
  if (next !== owner) { owner = next; generation++; known.clear(); }
  return generation;
 };
 const key = (entry: {kind:string;id:string}) => JSON.stringify([entry.kind,entry.id]);
 return {
  // Delegate the shared notice's one subscription. Observing every transition also
  // fences A -> B -> A while an old A poll or action is still awaiting a result.
  identity: {
   read() { current(); return owner; },
   subscribe(listener: () => void) {
    return identity.subscribe(() => { current(); listener(); });
   },
  } satisfies DeferredDeletionIdentity,
  bridge: {
   async pending() {
    const admitted = current();
    try {
     const result = await bridge.pending();
     if (current() === admitted) known = new Set(pendingDeletionNotices(result.deletions).map(key));
     return result;
    } catch (error) {
     if (current() !== admitted || !known.size) return {deletions:[]};
     throw error;
    }
   },
   async undo(input) {
    const admitted = current(), result = await bridge.undo(input);
    if (current() === admitted && undoConfirmed(result)) known.delete(key(input));
    return result;
   },
   async dismiss(input) {
    const admitted = current(), result = await bridge.dismiss(input);
    if (current() === admitted) known.delete(key(input));
    return result;
   },
  } satisfies DeferredDeletionsBridge,
 };
}
