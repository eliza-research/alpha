/** Notification intent delivery is pulled only after the shell can safely show Maps. */
export function createMapsNotificationOpen(port: {
  ready(): boolean;
  consume(): Promise<{open: boolean}>;
  clear(): Promise<unknown>;
  open(): void;
}) {
  let requested = true, checking = false, epoch = 0, revision = 0, disposed = false;
  async function flush() {
    if (disposed || checking || !requested || !port.ready()) return;
    checking = true; requested = false;
    const captured = epoch, attempt = revision;
    try {
      const value = await port.consume();
      if (!disposed && epoch === captured && value.open && port.ready()) port.open();
    } catch { if (!disposed && epoch === captured) requested = true; }
    finally { checking = false; if (requested && revision !== attempt) void flush(); }
  }
  return {
    flush,
    request() { requested = true; ++revision; void flush(); },
    cancel() { requested = false; ++epoch; void port.clear().catch(() => {}); },
    dispose() { disposed = true; requested = false; ++epoch; },
  };
}
