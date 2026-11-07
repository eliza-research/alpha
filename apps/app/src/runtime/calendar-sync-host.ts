import { Capacitor } from "@capacitor/core";
import { BrowserJsonDomainDocument } from "../browser/json-domain-document";
import {
	calendarDocument,
	initialCalendarState,
	prepareCalendarSource,
} from "../browser/calendar-store";
import { browserCalendarSyncPort } from "../browser/calendar-linked-local";
import { canonicalSyncRecurrence } from "../browser/calendar-sync-fields.ts";
import { readGoogleCalendarSyncDestination } from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/google-sync-port.ts";
import {
	type CalendarSyncDeviceGate,
	type CalendarSyncSettings,
	type CalendarSyncSettingsStore,
	type CalendarSyncTarget,
	calendarSyncSettingsSlot,
	createCalendarSyncHost,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/sync-host.ts";
import { calendarLinkStorage } from "./calendar-linked-storage";
import {
	ALPHA_CALENDAR_SYNC_NAMESPACE,
	type CalendarSyncBinding,
} from "./calendar-linked-store";
import { connectionController } from "./connection-ui";
import { nativeCalendarSync } from "./native-calendar-sync";
import { createGoogleAccounts } from "./google-accounts";
import {
	type GoogleCalendarSelection,
	readGoogleCalendarSelection,
} from "./google-calendar-selection";

export type {
	CalendarSyncReport,
	CalendarSyncReview,
} from "../../../../.eliza/client-features/plugins/plugin-calendar/src/linked-sync/sync-controller.ts";

const native = () => Capacitor.isNativePlatform();
// Installed storage names: the browser document and the encrypted native slot keep these exact keys.
const browserConfiguration = new BrowserJsonDomainDocument(
	"alpha.browser.calendar-sync-config.v1",
);
const nativeConfigurationSlot =
	"calendar-linked-sync:v1:7d1f8a65cde513c690bb719ba9fb6e93372b9f0dc6e8a92b40c18245f3b71df9";
const nativeConfiguration = calendarSyncSettingsSlot(
	calendarLinkStorage,
	nativeConfigurationSlot,
);
const configuration: CalendarSyncSettingsStore = {
	read: () =>
		native()
			? nativeConfiguration.read()
			: browserConfiguration.readJson<CalendarSyncSettings>(),
	edit: (edit) =>
		native()
			? nativeConfiguration.edit(edit)
			: browserConfiguration.editJson<CalendarSyncSettings>(edit),
};

function owner() {
	const state = connectionController.getSnapshot(),
		cloud = connectionController.getCloudClient(),
		account = state.cloudAccount;
	if (!cloud || !account?.organizationId || !state.session)
		throw Error(
			"Connect your Cloud account and agent before enabling Calendar sync.",
		);
	if (native() && account.environment !== "production")
		throw Error(
			"Device Calendar sync requires the production Cloud account; no other environment was used.",
		);
	const selection = readGoogleCalendarSelection({
		environment: account.environment,
		userId: account.userId,
		organizationId: account.organizationId,
	});
	if (!selection) throw Error("Choose a Google calendar for sync first.");
	return {
		account,
		cloud,
		selection,
		agentId: state.session.agentId,
		agentSession: state.session.sessionId,
	};
}
function target(): CalendarSyncTarget {
	const { account, selection, agentId } = owner();
	return {
		environment: account.environment,
		userId: account.userId,
		organizationId: account.organizationId!,
		connectionId: selection.connectionId,
		calendarId: selection.providerCalendarId,
		agentId,
	};
}
function identity() {
	try {
		const { account, cloud, selection, agentId, agentSession } = owner();
		return JSON.stringify([
			account.environment,
			account.userId,
			account.organizationId,
			cloud.credentialId,
			cloud.sessionId,
			selection,
			agentId,
			agentSession,
		]);
	} catch {
		return "";
	}
}
const foreground = () => !document.hidden;
/** Android keeps its own per-calendar sync opt-in; provider writes need both. */
const deviceGate: CalendarSyncDeviceGate = {
	enabled: () => nativeCalendarSync.enabled(),
	enable: async (current) => {
		await nativeCalendarSync.enable(current);
	},
	pause: () => nativeCalendarSync.pause(),
	cancel: () => nativeCalendarSync.cancel(),
};
/** Calendars device sync may write to: owned or writable calendars of the connected Google accounts that
 * granted Calendar changes, each account's own calendar first. Review still verifies write access. */
export async function googleCalendarSyncDestinations(
	signal: AbortSignal,
): Promise<GoogleCalendarSelection[]> {
	const cloud = connectionController.getCloudClient();
	if (!cloud)
		throw Error("Connect your Cloud account before choosing a Google calendar.");
	const accounts = (
		await createGoogleAccounts(cloud, () =>
			connectionController.getCloudClient(),
		).list(signal)
	).filter(
		(account) =>
			account.connected &&
			account.connectionId &&
			account.grantedCapabilities.includes("google.calendar.write"),
	);
	const destinations = await Promise.all(
		accounts.map(async (account) => {
			const connectionId = account.connectionId as string;
			return (await cloud.client.googleCalendars(connectionId, signal))
				.filter((calendar) => ["owner", "writer"].includes(calendar.accessRole))
				.sort((a, b) => Number(b.primary) - Number(a.primary))
				.map((calendar) => ({
					connectionId,
					sourceId: `google:${encodeURIComponent(connectionId)}:${encodeURIComponent(calendar.calendarId)}`,
					providerCalendarId: calendar.calendarId,
					name: calendar.summary,
					account: account.label,
				}));
		}),
	);
	signal.throwIfAborted();
	if (connectionController.getCloudClient()?.sessionId !== cloud.sessionId)
		throw new DOMException("The Cloud account changed", "AbortError");
	return destinations.flat();
}

const nativeSelection = (value: CalendarSyncTarget) => ({
	environment: value.environment,
	connectionId: value.connectionId,
	calendarId: value.calendarId,
});

/** Explicit local-first Google Calendar sync (@elizaos/plugin-calendar/linked-sync) on Alpha's
 * installed settings, checkpoints and device Calendar bridge. */
export const calendarSyncHost = createCalendarSyncHost({
	async prepare(signal, { interactive }) {
		const selected = owner(),
			key = identity();
		const current = () => !signal.aborted && foreground() && identity() === key;
		if (native()) {
			const source = await nativeCalendarSync.prepare(
					{
						environment: selected.account.environment,
						connectionId: selected.selection.connectionId,
						calendarId: selected.selection.providerCalendarId,
					},
					current,
					signal,
					interactive,
				),
				binding = source.binding;
			if (
				binding.environment !== selected.account.environment ||
				binding.userId !== selected.account.userId ||
				binding.organizationId !== selected.account.organizationId ||
				binding.agentId !== selected.agentId ||
				binding.connectionId !== selected.selection.connectionId ||
				binding.calendarId !== selected.selection.providerCalendarId
			)
				throw Error(
					"Device and Google Calendar account bindings differ. Nothing was enabled.",
				);
			const local = nativeCalendarSync.port(source, current, signal);
			return {
				reviewIdentity: key,
				binding,
				destination: { ...source.destination },
				client: selected.cloud.client,
				current,
				local,
				localDeletionUndone: local.deletionUndone,
				storage: calendarLinkStorage,
				events: () => nativeCalendarSync.events(source, current, signal),
			};
		}
		const source = await prepareCalendarSource();
		if (!current())
			throw new DOMException("Calendar sync context changed", "AbortError");
		const verified = await readGoogleCalendarSyncDestination(
			selected.cloud.client,
			{
				grantId: selected.selection.connectionId,
				calendarId: selected.selection.providerCalendarId,
			},
			current,
			signal,
		);
		const binding: CalendarSyncBinding = {
			environment: selected.account.environment,
			userId: selected.account.userId,
			organizationId: selected.account.organizationId!,
			connectionId: selected.selection.connectionId,
			providerAccountId: verified.providerAccountId,
			calendarId: selected.selection.providerCalendarId,
			agentId: selected.agentId,
			localSourceId: source.sourceId,
			localSourceRevision: source.sourceRevision,
		};
		return {
			reviewIdentity: key,
			binding,
			destination: {
				account: verified.accountEmail,
				calendar: verified.calendarLabel,
			},
			client: selected.cloud.client,
			current,
			local: browserCalendarSyncPort(source.sourceRevision, current),
			storage: calendarLinkStorage,
			events: async () => {
				const data = await calendarDocument.read(initialCalendarState, signal);
				if (!current() || data.sourceRevision !== source.sourceRevision)
					throw new DOMException("Calendar source changed", "AbortError");
				return data.events
					.map((event) => ({ id: event.id, revision: event.revision }))
					.sort((a, b) => a.id.localeCompare(b.id));
			},
		};
	},
	settings: configuration,
	target,
	identity,
	foreground,
	async source(selected, current) {
		if (native()) {
			const source = await nativeCalendarSync.prepare(
				nativeSelection(selected),
				current,
				new AbortController().signal,
			);
			return {
				revision: source.binding.localSourceRevision,
				deviceEnabled: source.enabled,
			};
		}
		return { revision: (await prepareCalendarSource()).sourceRevision };
	},
	storage: calendarLinkStorage,
	device: () => (native() ? deviceGate : undefined),
	controller: {
		idempotencyNamespace: ALPHA_CALENDAR_SYNC_NAMESPACE,
		canonicalRecurrence: canonicalSyncRecurrence,
	},
	settingsWritten: () =>
		window.dispatchEvent(new Event("alpha:calendar-sync-config-changed")),
	reviewMessage: (count) => `Ready to link ${count} Alpha events.`,
});

/** Foreground only: local edits and returning to Calendar refresh retained links; no polling or inference. */
export function startCalendarSyncHost() {
	let nativeRetired = false;
	const nativeObserver = native()
		? nativeCalendarSync.observe(() =>
				window.dispatchEvent(new Event("alpha:calendar-sync-source-changed")),
			)
		: undefined;
	void nativeObserver
		?.then((handle) => {
			if (nativeRetired) void handle.remove();
		})
		.catch(() => {});
	const scheduler = calendarSyncHost.start();
	const channel =
		typeof BroadcastChannel === "undefined"
			? null
			: new BroadcastChannel("alpha.calendar-sync-config.v1");
	if (channel) channel.onmessage = () => scheduler.settingsChangedElsewhere();
	const configChanged = () => channel?.postMessage({ changed: true });
	const unsubscribe = connectionController.subscribe(scheduler.ownerChanged);
	window.addEventListener("alpha:google-accounts-changed", scheduler.ownerChanged);
	window.addEventListener(
		"alpha:google-calendar-selection-changed",
		scheduler.ownerChanged,
	);
	window.addEventListener("alpha:calendar-document-changed", scheduler.localChanged);
	window.addEventListener(
		"alpha:calendar-sync-source-changed",
		scheduler.localChanged,
	);
	window.addEventListener("alpha:calendar-sync-config-changed", configChanged);
	document.addEventListener("visibilitychange", scheduler.visibilityChanged);
	return () => {
		nativeRetired = true;
		void nativeObserver?.then((handle) => handle.remove()).catch(() => {});
		scheduler.stop();
		unsubscribe();
		channel?.close();
		window.removeEventListener(
			"alpha:google-accounts-changed",
			scheduler.ownerChanged,
		);
		window.removeEventListener(
			"alpha:google-calendar-selection-changed",
			scheduler.ownerChanged,
		);
		window.removeEventListener(
			"alpha:calendar-document-changed",
			scheduler.localChanged,
		);
		window.removeEventListener(
			"alpha:calendar-sync-source-changed",
			scheduler.localChanged,
		);
		window.removeEventListener(
			"alpha:calendar-sync-config-changed",
			configChanged,
		);
		document.removeEventListener("visibilitychange", scheduler.visibilityChanged);
	};
}
