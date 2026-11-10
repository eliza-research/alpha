import {controls, type FixtureCallback} from './controls.ts';

export const Capacitor = {Plugins: {}};

let callback: FixtureCallback | null = null;
const listeners = new Set<() => void>();
controls.emitCallback = value => {
  callback = value;
  for (const listener of listeners) listener();
};
controls.storedCallback = () => callback;

export function registerPlugin() {
  return {
    async addListener(_name: string, listener: () => void) {
      listeners.add(listener);
      return {remove: () => listeners.delete(listener)};
    },
    async readDelegationCallback() { return {callback}; },
    async clearDelegationCallback(input: {state: string}) {
      if (callback?.state === input.state) callback = null;
    },
  };
}
