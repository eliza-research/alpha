import { canonicalSyncRecurrence } from "../browser/calendar-sync-fields.ts";
import type { LinkedCalendarProviderPort } from "../../../../.eliza/client-features/packages/contracts/src/calendar-linked-sync";
import {
	type CalendarSyncClient,
	googleCalendarSyncPort as sharedGoogleCalendarSyncPort,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/google-sync-port.ts";
import type { CalendarSyncBinding } from "./calendar-linked-store";

export {
	calendarSyncHttp,
	type CalendarSyncClient,
	type CalendarSyncRequest,
	type CalendarSyncSelection,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/google-sync-port.ts";

/** Only the explicitly enabled controller supplies this exact binding and current-owner fence. */
export function googleCalendarSyncPort(
	client: CalendarSyncClient,
	binding: CalendarSyncBinding,
	current: () => boolean,
	signal: AbortSignal,
): Promise<LinkedCalendarProviderPort<string>> {
	return sharedGoogleCalendarSyncPort(client, binding, current, signal, {
		canonicalRecurrence: canonicalSyncRecurrence,
	});
}
