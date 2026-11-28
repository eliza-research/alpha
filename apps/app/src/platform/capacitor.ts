// spec/app/platform/index.md, "Story: Reach the phone's native capabilities"
import { registerPlugin } from "@capacitor/core";

const registered = new Map<string, unknown>();

/** Register a Capacitor plugin proxy once per plugin name for the life of the page. @throws {never} */
export function plugin<T>(name: string): T {
  const existing = registered.get(name);
  if (existing !== undefined) return existing as T;
  const created = registerPlugin<T>(name);
  registered.set(name, created);
  return created;
}

/** Attach an async Capacitor plugin listener with cancellation cleanup before resolution. @throws {never} */
export function subscribePluginListener(
  attach: (isActive: () => boolean) => Promise<{ remove(): Promise<void> }>,
): () => void {
  let active = true;
  let handle: { remove(): Promise<void> } | undefined;
  void attach(() => active).then((attached) => {
    if (!active) void attached.remove();
    else handle = attached;
  }, () => undefined);
  return () => {
    active = false;
    if (handle !== undefined) void handle.remove();
  };
}
