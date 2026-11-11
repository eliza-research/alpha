import {cloudDelegationSlot} from '../../../apps/app/src/runtime/cloud-delegation-ui';
import {controls} from './controls.ts';

const admitted = (slot: string) => {
  if (!cloudDelegationSlot.test(slot)) throw Error('Secure draft update failed');
  return slot;
};

export const secureConnectionStore = {
  async read(slot: string) {
    return JSON.parse(localStorage.getItem(admitted(slot)) || 'null');
  },
  async compareExchange(slot: string, expected: unknown, value: unknown) {
    admitted(slot);
    const race = controls.raceExchange;
    if (race) {
      delete controls.raceExchange;
      race(slot);
    }
    if (JSON.stringify(await this.read(slot)) !== JSON.stringify(expected)) return {status: 'conflict'};
    if (value === null) {
      if (controls.holdClear) await new Promise<void>(resolve => { controls.releaseClear = resolve; });
      localStorage.removeItem(slot);
    } else {
      localStorage.setItem(slot, JSON.stringify(value));
    }
    return {status: 'saved'};
  },
};

export async function openConnectionBrowser(url: string) {
  controls.authorizationUrl = url;
  controls.opened++;
}

export const isAndroid = true;
