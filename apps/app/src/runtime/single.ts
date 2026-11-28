import { type AlphaSurface, currentSurface, lockNameFor } from "../surface.ts";

/**
 * Whether this page is the one page over this origin's store for its surface, from now until it closes. Two pages over
 * one store would each take up the other's attempts as its own and write over the other's kept states, so the second
 * is told no, and builds no machine.
 */
export function single(surface: AlphaSurface = currentSurface()): Promise<boolean> {
  if (!("locks" in navigator)) return Promise.resolve(true);
  const name = lockNameFor(surface);
  return new Promise((told) => {
    navigator.locks.request(name, { ifAvailable: true }, (lock) => {
      told(lock !== null);
      return lock === null ? undefined : new Promise<never>(() => {});
    }).catch(() => {
      told(true);
    });
  });
}
