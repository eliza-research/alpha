import type { InboxOperationStore } from '../../.eliza/client-features/plugins/plugin-inbox/src/mailbox/operation-journal.ts';

export function inboxMemoryStore(slots: Map<string, unknown>, beforeRead?: () => Promise<void> | undefined) {
  return {
    async read<T>(key: string): Promise<T | null> {
      const pending = beforeRead?.();
      if (pending) await pending;
      return structuredClone(slots.get(key) ?? null) as T | null;
    },
    async compareExchange(key, prior, next) {
      if (JSON.stringify(slots.get(key) ?? null) !== JSON.stringify(prior)) return {status: 'conflict' as const};
      if (next === null) slots.delete(key);
      else slots.set(key, structuredClone(next));
      return {status: 'saved' as const};
    },
  } satisfies InboxOperationStore;
}
