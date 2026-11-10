export type FixtureCallback = {state: string; code?: string; error?: string};

interface DelegationControls {
  switchOwner(owner: string): void;
  emitCallback(callback: FixtureCallback): void;
  storedCallback(): FixtureCallback | null;
  authorizationUrl?: string;
  opened: number;
  connected: number;
  holdClear?: boolean;
  releaseClear?: () => void;
  raceExchange?: (slot: string) => void;
}

declare global {
  interface Window {
    alphaCloudDelegationFixture: DelegationControls;
  }
}

export const controls: DelegationControls = {
  switchOwner() { throw Error('Fixture owner switch is not ready'); },
  emitCallback() { throw Error('Fixture callback is not ready'); },
  storedCallback: () => null,
  opened: 0,
  connected: 0,
};

window.alphaCloudDelegationFixture = controls;
