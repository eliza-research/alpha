import { createMapsNavigationPort } from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/agent-navigation.ts';
export * from '../../../../.eliza/client-features/plugins/plugin-maps/src/client/agent-navigation.ts';

/** Launcher-owned navigation offered only during an authenticated resident conversation turn. */
export const residentMapsNavigationPort = createMapsNavigationPort();

type CloudAccount = Readonly<{ sessionId: string; credentialId: string; client: unknown }>;
/**
 * Reads Cloud Maps coverage once a Cloud account is bound and the resident is ready, without
 * waiting for the Maps view, and again for each new account, so agent navigation is offered
 * from launch. A change is handled after the account-change retirement in cloud-maps.ts.
 */
export function keepCloudMapsCoverage(options: Readonly<{
  enabled(): boolean;
  ready(): boolean;
  account(): CloudAccount | null;
  initialize(): Promise<void>;
  onChange(listener: () => void): () => void;
}>): () => void {
  let seen: CloudAccount | null = null, pending = false, disposed = false;
  const sync = () => {
    if (disposed || !options.enabled()) return;
    const account = options.account();
    if (account?.sessionId !== seen?.sessionId || account?.credentialId !== seen?.credentialId || account?.client !== seen?.client) {
      seen = account;
      pending = !!account;
    }
    if (pending && options.ready()) {
      pending = false;
      void options.initialize();
    }
  };
  const unsubscribe = options.onChange(() => queueMicrotask(sync));
  sync();
  return () => { disposed = true; unsubscribe(); };
}
