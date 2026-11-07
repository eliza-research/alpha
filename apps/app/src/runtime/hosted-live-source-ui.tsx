import {BrowserDigestDelegation} from '../browser/digest-delegation-ui';
import {browserDevProfile} from '../browser/dev-profile';
import { CloudDelegationPanel } from "./cloud-delegation-ui";
import { isAndroid } from '../native';
import { useState } from "react";
import type {
	HostedDigestProtocol,
	HostedLiveAccount,
	HostedLiveCalendar,
} from "./hosted-digests";
export function HostedLiveSourcePicker({
	client,
	scope,
	signal,
	current,
	busy,
	review,
}: {
	client: HostedDigestProtocol;
	scope?: string;
	signal: AbortSignal;
	current: () => boolean;
	busy: boolean;
	review: (value: {
		path: "sources";
		body: Record<string, unknown>;
		summary: string;
	}) => void;
}) {
	const [accounts, setAccounts] = useState<HostedLiveAccount[]>([]),
		[accountId, setAccountId] = useState(""),
		[kind, setKind] = useState<"email" | "calendar">("email"),
		[calendars, setCalendars] = useState<HostedLiveCalendar[]>([]),
		[calendarId, setCalendarId] = useState(""),
		[pending, setPending] = useState(false),
		[message, setMessage] = useState(
			"Choose a Google account connected to this agent. No Google token is copied from this phone.",
		),
		[windowHours, setWindowHours] = useState(24),
		[expiresHours, setExpiresHours] = useState(24),
		[maxItems, setMaxItems] = useState(10);
	const account = accounts.find((a) => a.accountId === accountId),
		calendar = calendars.find((c) => c.calendarId === calendarId);
	const range = (value: number, max: number) =>
		Number.isInteger(value) && value >= 1 && value <= max;
	async function loadAccounts() {
		if (busy || pending) return;
		setPending(true);
		setAccountId("");
		setCalendars([]);
		setCalendarId("");
		try {
			const result = await client.liveAccounts(signal);
			if (!current()) return;
			setAccounts(result.accounts);
			setMessage(
				result.accounts.length
					? "Choose an account and read scope. Access remains limited to its reviewed grant."
					: "No eligible account. Connect Cloud for scheduled reads or connect Google directly to this agent.",
			);
		} catch {
			if (current()) {
				setAccounts([]);
				setMessage(
					"This agent cannot provide live Google sources. Shared snapshots are still available.",
				);
			}
		} finally {
			if (current()) setPending(false);
		}
	}
	async function loadCalendars() {
		if (!account || busy || pending) return;
		setPending(true);
		setCalendars([]);
		setCalendarId("");
		try {
			const result = await client.liveCalendars(account, signal);
			if (!current()) return;
			setCalendars(result.calendars);
			setMessage(
				result.truncated
					? "Showing the first 50 calendars. Choose one listed calendar; no other calendar will be read."
					: "Choose the calendar to include.",
			);
		} catch {
			if (current())
				setMessage(
					"Calendar access changed or is unavailable. Refresh accounts before trying again.",
				);
		} finally {
			if (current()) setPending(false);
		}
	}
	function prepare() {
		if (
			!current() ||
			!account ||
			!account.kinds.includes(kind) ||
			(kind === "calendar" && !calendar) ||
			!range(windowHours, 168) ||
			!range(expiresHours, 168) ||
			!range(maxItems, 25)
		)
			return;
		// One clock reading keeps a 168-hour expiry within the agent's observedAt + 7 days bound.
		const reviewedAt = Date.now(),
			observedAt = new Date(reviewedAt).toISOString(),
			expiresAt = new Date(Math.min(reviewedAt + expiresHours * 3600000, account.expiresAt ? Date.parse(account.expiresAt) : Infinity)).toISOString(),
			label =
				account.label +
				" · " +
				(calendar && kind === "calendar" ? calendar.label : "Inbox");
		review({
			path: "sources",
			body: {
				id: crypto.randomUUID(),
				kind,
				label: label.slice(0, 200),
				observedAt,
				expiresAt,
				confirmed: true,
				live: {
					provider: "google",
					accountId: account.accountId,
					accountRevision: account.accountRevision,
					kind,
					windowHours,
					maxItems,
					...(kind === "calendar" ? { calendarId: calendar!.calendarId } : {}),
				},
			},
			summary: `Allow scheduled read-only access to ${label} through this agent until ${new Date(expiresAt).toLocaleString()}. Each run may read up to ${maxItems} ${kind === "email" ? "inbox subjects and snippets from the previous" : "events from the next"} ${windowHours} hours. ${kind === "email" ? "Message bodies and attachments are excluded." : "Only this calendar is included."} Reads require this agent to be running. An on-device agent cannot read while the phone is off. This does not send mail or change calendar events. Enabling a schedule is a separate review.`,
		});
	}
	return (
		<details>
			<summary>Use live Google data</summary>
            {scope && (browserDevProfile&&JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind==='development'?<BrowserDigestDelegation client={client} scope={scope} signal={signal} current={current} onConnected={()=>void loadAccounts()}/>:isAndroid?<CloudDelegationPanel client={client} scope={scope} signal={signal} current={current} onConnected={()=>void loadAccounts()}/>:<p>Cloud read access for scheduled reads is connected from the Android app.</p>) }
			<p>{message}</p>
			<button disabled={busy || pending} onClick={() => void loadAccounts()}>
				Refresh connected accounts
			</button>
			{account?.expiresAt && <p>Cloud access expires {new Date(account.expiresAt).toLocaleString()}.</p>}
            {account?.accountId.startsWith("cloud:") && <button disabled={busy||pending} onClick={()=>void (async()=>{setPending(true);try{const result=await client.delegation("revoke",{grantId:account.accountId.split(":")[1],confirmed:true},signal);if(current()){setMessage(result.remoteRevocation==="confirmed"?"Cloud grant revoked. All sources using it are disabled.":"Reads disabled. Retry revocation to finish disconnecting in Cloud.");if(result.remoteRevocation==="confirmed"){setAccounts([]);setAccountId("");}}}catch{if(current())setMessage("Revocation is not confirmed. Try again.");}finally{if(current())setPending(false);}})()}>Revoke selected Cloud grant for all its sources</button>}
            {accounts.length > 0 && (
				<>
					<label>
						Google account
						<select
							aria-label="Google account"
							disabled={busy || pending}
							value={accountId}
							onChange={(e) => {
								const chosen = accounts.find(
									(a) => a.accountId === e.target.value,
								);
								setAccountId(e.target.value);
								setKind(chosen?.kinds.includes("email") ? "email" : "calendar");
								setCalendars([]);
								setCalendarId("");
							}}
						>
							<option value="">Choose account</option>
							{accounts.map((a) => (
								<option key={a.accountId} value={a.accountId}>
									{a.label}
								</option>
							))}
						</select>
					</label>
					{account && (
						<>
							<label>
								Read scope
								<select
									aria-label="Read scope"
									disabled={busy || pending}
									value={kind}
									onChange={(e) => {
										setKind(e.target.value as "email" | "calendar");
										setCalendarId("");
									}}
								>
									{account.kinds.map((k) => (
										<option key={k} value={k}>
											{k === "email"
												? "Inbox subjects and snippets"
												: "Calendar events"}
										</option>
									))}
								</select>
							</label>
							{kind === "calendar" && (
								<>
									<button
										disabled={busy || pending}
										onClick={() => void loadCalendars()}
									>
										Load calendars
									</button>
									<label>
										Calendar
										<select
											aria-label="Calendar"
											disabled={busy || pending}
											value={calendarId}
											onChange={(e) => setCalendarId(e.target.value)}
										>
											<option value="">Choose calendar</option>
											{calendars.map((c) => (
												<option key={c.calendarId} value={c.calendarId}>
													{c.label}
												</option>
											))}
										</select>
									</label>
								</>
							)}
							<label>
								{kind === "email" ? "Look back hours" : "Look ahead hours"}
								<input
									aria-label="Source window hours"
									type="number"
									min={1}
									max={168}
									value={windowHours}
									onChange={(e) => setWindowHours(Number(e.target.value))}
								/>
							</label>
							<label>
								Maximum items per run
								<input
									aria-label="Maximum source items"
									type="number"
									min={1}
									max={25}
									value={maxItems}
									onChange={(e) => setMaxItems(Number(e.target.value))}
								/>
							</label>
							<label>
								Access expires after hours
								<input
									aria-label="Source access hours"
									type="number"
									min={1}
									max={168}
									value={expiresHours}
									onChange={(e) => setExpiresHours(Number(e.target.value))}
								/>
							</label>
							<button
								disabled={
									busy ||
									pending ||
									!range(windowHours, 168) ||
									!range(maxItems, 25) ||
									!range(expiresHours, 168) ||
									(kind === "calendar" && !calendar)
								}
								onClick={prepare}
							>
								Review live source
							</button>
						</>
					)}
				</>
			)}
		</details>
	);
}
