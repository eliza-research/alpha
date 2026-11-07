import {
	CalendarLinkedStore as SharedCalendarLinkedStore,
	type CalendarLinkStorage,
	type CalendarSyncBinding,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/linked-store.ts";

export type { CalendarLinkStorage, CalendarSyncBinding };

/**
 * Alpha's installed provider idempotency keys keep their original prefix. Keys are
 * never rewritten, so a reconnect cannot create a second Google event.
 */
export const ALPHA_CALENDAR_SYNC_NAMESPACE = "alpha-calendar-sync";

/** Durable owner/source-bound checkpoints from @elizaos/plugin-calendar/linked-sync. */
export type CalendarLinkedStore = SharedCalendarLinkedStore;
export const CalendarLinkedStore = {
	open: (
		binding: CalendarSyncBinding,
		current: () => boolean,
		storage: CalendarLinkStorage,
	): Promise<SharedCalendarLinkedStore> =>
		SharedCalendarLinkedStore.open(binding, current, storage, {
			idempotencyNamespace: ALPHA_CALENDAR_SYNC_NAMESPACE,
		}),
};
