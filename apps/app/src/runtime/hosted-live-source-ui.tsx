import {BrowserDigestDelegation} from '../browser/digest-delegation-ui';
import {browserDevProfile} from '../browser/dev-profile';
import { CloudDelegationPanel } from "./cloud-delegation-ui";
import { isAndroid } from '../native';
import { useState } from "react";
import { iconStyle } from "../icon-style";
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
			"Sign-in stays on phone",
		),
		[windowHours, setWindowHours] = useState(24),
		[expiresHours, setExpiresHours] = useState(24),
		[maxItems, setMaxItems] = useState(10),
		// Removing Google access ends every source that uses the account, so it is reviewed here first.
		[removing, setRemoving] = useState(false);
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
					? ""
					: "No account",
			);
		} catch {
			if (current()) {
				setAccounts([]);
				setMessage("");
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
			setMessage("");
		} catch {
			if (current())
				setMessage("Unavailable");
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
			summary: `Read ${label} · ${maxItems} items/${windowHours}h · until ${new Date(expiresAt).toLocaleString()}`,
		});
	}
	return (
		<details>
			<summary><span aria-hidden="true" className="alpha-google-icon" style={{ display: "inline-block", width: 18, height: 18, marginRight: 6, verticalAlign: "middle" }} />Live Google</summary>
            {scope && (browserDevProfile&&JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind==='development'?<BrowserDigestDelegation client={client} scope={scope} signal={signal} current={current} onConnected={()=>void loadAccounts()}/>:isAndroid?<CloudDelegationPanel client={client} scope={scope} signal={signal} current={current} onConnected={()=>void loadAccounts()}/>:null) }
			{message && <p>{message === "Sign-in stays on phone" && <span aria-hidden="true" style={{ ...iconStyle("lock-keyhole"), width: "16px", height: "16px", marginRight: 6, verticalAlign: "middle" }} />}{message}</p>}
			<button disabled={busy || pending} onClick={() => void loadAccounts()}>
				Refresh connected accounts
			</button>
			{account?.expiresAt && <p>Cloud access expires {new Date(account.expiresAt).toLocaleString()}.</p>}
            {account?.accountId.startsWith("cloud:") && !removing && <button disabled={busy||pending} onClick={()=>setRemoving(true)}>Remove Google access for every source that uses it</button>}
            {account?.accountId.startsWith("cloud:") && removing && <section role="group" aria-label="Review removing Google access">
                <p><strong>Remove Google access?</strong></p>
                <p>Every source that uses {account.label} stops reading it. You can connect it again later.</p>
                <button disabled={busy||pending} onClick={()=>void (async()=>{setPending(true);try{const result=await client.delegation("revoke",{grantId:account.accountId.split(":")[1],confirmed:true},signal);if(current()){setMessage(result.remoteRevocation==="confirmed"?"Removed":"Off · retry");if(result.remoteRevocation==="confirmed"){setAccounts([]);setAccountId("");}}}catch{if(current())setMessage("Revocation is not confirmed. Try again.");}finally{if(current()){setPending(false);setRemoving(false);}}})()}>Remove access</button>
                <button disabled={pending} onClick={()=>setRemoving(false)}>Keep access</button>
            </section>}
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
								setRemoving(false);setAccountId(e.target.value);
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
								{kind === "email" ? "Back (h)" : "Ahead (h)"}
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
								Max items
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
								Expires (h)
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
								aria-label="Review live source"
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
								Review
							</button>
						</>
					)}
				</>
			)}
		</details>
	);
}
