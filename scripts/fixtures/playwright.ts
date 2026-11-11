import { createRequire } from 'node:module';
import path from 'node:path';

// A page init script installs only the bridge methods exercised by that fixture.
interface BridgeInput {
  slot: string;
  expectedValue: string | null;
  value: string | null;
  url: string;
  method: string;
  headers: Record<string, string>;
  saved?: boolean;
}

declare global {
  interface Window {
    androidBridge: object;
    Capacitor: {
      PluginHeaders: {name: string; methods: {name: string; rtype: string}[]}[];
      nativeCallback?(plugin: string, method: string, input: {eventName: string}, callback: (event: object) => void): string;
      nativePromise(plugin: string, method: string, input: BridgeInput): Promise<unknown>;
    };
  }
}

export function playwright(from: string, moduleDirectory = process.env.ALPHA_BROWSER_MODULES): typeof import('playwright') {
  const require = createRequire(moduleDirectory ? path.join(moduleDirectory, 'fixture.cjs') : from);
  return require('playwright');
}
