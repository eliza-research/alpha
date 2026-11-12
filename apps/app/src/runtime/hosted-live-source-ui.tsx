import {BrowserDigestDelegation} from '../browser/digest-delegation-ui';
import {browserDevProfile} from '../browser/dev-profile';
import { CloudDelegationPanel } from "./cloud-delegation-ui";
import { isAndroid } from '../native';
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { iconStyle } from "../icon-style";
import { anyAbortSignal } from "./abort-signal";
import type {
	DigestLoop,
	DigestSource,
	HostedDigestProtocol,
	HostedLiveAccount,
	HostedLiveCalendar,
} from "./hosted-digests";

// Native descriptors include a connection suffix. The revoke route owns the whole grant.
function cloudGrantId(accountId: string) {
	return /^cloud:([A-Za-z0-9_-]+)(?::|$)/.exec(accountId)?.[1] ?? "";
}

type RemovalTarget = { grantId: string; account?: HostedLiveAccount };

function removalImpact(grantId: string, sources: DigestSource[], loops: DigestLoop[]) {
	const affectedSources = sources
		.filter(source => !source.revoked && source.live?.provider === "google" && cloudGrantId(source.live.accountId) === grantId)
		.map(({ id, revision, label }) => ({ id, revision, label }))
		.sort((a, b) => a.id.localeCompare(b.id));
	const sourceIds = new Set(affectedSources.map(source => source.id));
	const affectedLoops = loops
		.filter(loop => !loop.removed && sourceIds.has(loop.spec.sourceId))
		.map(({ id, versionId, spec }) => ({
			id, versionId, sourceId: spec.sourceId, sourceRevision: spec.sourceRevision,
			template: spec.template, localTime: spec.localTime, timeZone: spec.timeZone, enabled: spec.enabled,
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
	return { sources: affectedSources, loops: affectedLoops };
}

export function HostedLiveSourcePicker({
	client,
	scope,
	signal,
	current,
	busy,
	review,
	onRevoked,
}: {
	client: HostedDigestProtocol;
	scope?: string;
	signal: AbortSignal;
	current: () => boolean;
	busy: boolean;
	onRevoked?: () => void;
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
		[maxItems, setMaxItems] = useState(10);
	const account = accounts.find((a) => a.accountId === accountId),
		calendar = calendars.find((c) => c.calendarId === calendarId);
	const grantId = account ? cloudGrantId(account.accountId) : "";
	const [removal, setRemoval] = useState<{ target: RemovalTarget; impact: ReturnType<typeof removalImpact> } | null>(null);
	const [revocation, setRevocation] = useState<{ grantId: string; removed: boolean } | null>(null);
	const removalRequest = useRef<{ controller: AbortController; dispatched: boolean } | null>(null);
	const selectedAccount = useRef(account);
	selectedAccount.current = account;
	const liveDetails = useRef<HTMLDetailsElement>(null);
	const removalTitle = useId();
	const removalHeading = useRef<HTMLHeadingElement>(null);
	const removalButton = useRef<HTMLButtonElement>(null);
	const retireRemoval = useCallback(() => {
		setRemoval(null);
		const flight = removalRequest.current;
		if (!flight) return;
		removalRequest.current = null;
		flight.controller.abort();
		setPending(false);
		if (flight.dispatched) setMessage("Revocation is not confirmed. Refresh connected accounts.");
	}, []);
	useEffect(() => {
		const hidden = () => { if (document.hidden) retireRemoval(); };
		document.addEventListener("visibilitychange", hidden);
		window.addEventListener("pagehide", retireRemoval);
		return () => {
			document.removeEventListener("visibilitychange", hidden);
			window.removeEventListener("pagehide", retireRemoval);
			removalRequest.current?.controller.abort();
		};
	}, [retireRemoval]);
	useEffect(() => { if (removal) removalHeading.current?.focus(); }, [removal]);
	const range = (value: number, max: number) =>
		Number.isInteger(value) && value >= 1 && value <= max;
	async function loadAccounts() {
		if (busy || pending) return;
		setPending(true);
		retireRemoval();
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
	async function removeAccess(target: RemovalTarget, reviewed?: ReturnType<typeof removalImpact>) {
		const ownerCurrent = () => !target.account || selectedAccount.current === target.account;
		if (!target.grantId || busy || pending || removalRequest.current || signal.aborted ||
			!current() || !ownerCurrent() || !liveDetails.current?.open || document.hidden) return;
		const flight = { controller: new AbortController(), dispatched: false };
		const requestSignal = anyAbortSignal([signal, flight.controller.signal]);
		removalRequest.current = flight;
		setPending(true);
		setMessage("");
		const active = () => removalRequest.current === flight && !requestSignal.aborted && current();
		try {
			const [sources, loops] = await Promise.all([client.sources(requestSignal), client.loops(requestSignal)]);
			if (!active() || !ownerCurrent() || !liveDetails.current?.open || document.hidden) return;
			const impact = removalImpact(target.grantId, sources, loops);
			if (!reviewed || JSON.stringify(impact) !== JSON.stringify(reviewed)) {
				setRemoval({ target, impact });
				if (reviewed) setMessage("Sources or schedules changed. Review the updated list.");
				return;
			}
			flight.dispatched = true;
			const result = await client.delegation("revoke", { grantId: target.grantId, confirmed: true }, requestSignal);
			if (!active()) return;
			setRemoval(null);
			const removed = result.remoteRevocation === "confirmed";
			setMessage(target.account ? (removed ? "Removed" : "Off · retry") : "");
			setRevocation({ grantId: target.grantId, removed });
			if (removed) {
				setAccounts(accounts => accounts.filter(account => cloudGrantId(account.accountId) !== target.grantId));
				setAccountId(accountId => cloudGrantId(accountId) === target.grantId ? "" : accountId);
			}
			onRevoked?.();
		} catch {
			if (active()) setMessage(flight.dispatched ? "Revocation is not confirmed. Try again." : "Couldn’t load sources and schedules. Try again.");
		} finally {
			if (active()) setPending(false);
			if (removalRequest.current === flight) removalRequest.current = null;
			flight.controller.abort();
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
		<details ref={liveDetails} onToggle={event => { if (event.target === event.currentTarget && !event.currentTarget.open) retireRemoval(); }}>
			<summary onClick={() => { if (liveDetails.current?.open) retireRemoval(); }}><span aria-hidden="true" className="alpha-google-icon" style={{ display: "inline-block", width: 18, height: 18, marginRight: 6, verticalAlign: "middle" }} />Live Google</summary>
            {scope && (browserDevProfile&&JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind==='development'?<BrowserDigestDelegation client={client} scope={scope} signal={signal} current={current} onConnected={()=>void loadAccounts()}/>:isAndroid?<CloudDelegationPanel client={client} scope={scope} signal={signal} current={current} onConnected={()=>void loadAccounts()} onReviewRemoval={grantId => void removeAccess({ grantId })} removalBusy={busy || pending || !!removal} revocation={revocation}/>:null) }
			{message && <p>{message === "Sign-in stays on phone" && <span aria-hidden="true" style={{ ...iconStyle("lock-keyhole"), width: "16px", height: "16px", marginRight: 6, verticalAlign: "middle" }} />}{message}</p>}
			<button disabled={busy || pending} onClick={() => void loadAccounts()}>
				Refresh connected accounts
			</button>
			{account?.expiresAt && <p>Cloud access expires {new Date(account.expiresAt).toLocaleString()}.</p>}
			{grantId && !removal && <button ref={removalButton} disabled={busy || pending} onClick={() => void removeAccess({ grantId, account })}>Review Google access removal</button>}
			{removal && <section aria-labelledby={removalTitle}>
				<h3 id={removalTitle} ref={removalHeading} tabIndex={-1}>Remove Google access</h3>
				{removal.target.account && <p>{removal.target.account.label}</p>}
				<p>This removes access from every source that uses the same Cloud read grant.</p>
				{removal.impact.sources.length > 0 ? <>
					<h4>Sources</h4>
					<ul>{removal.impact.sources.map(source => <li key={source.id}>{source.label}</li>)}</ul>
				</> : <p>No saved sources use this access.</p>}
				{removal.impact.loops.length > 0 && <>
					<h4>Schedules</h4>
					<ul>{removal.impact.loops.map(loop => <li key={loop.id}>
						{loop.template === "evening" ? "Evening" : "Morning"} at {loop.localTime} ({loop.timeZone}){loop.enabled ? "" : " · Paused"}
					</li>)}</ul>
				</>}
				<button disabled={busy || pending} onClick={() => void removeAccess(removal.target, removal.impact)}>Confirm removal</button>
				<button disabled={busy || pending} onClick={() => { retireRemoval(); setMessage(""); requestAnimationFrame(() => removalButton.current?.focus()); }}>Cancel removal</button>
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
								setAccountId(e.target.value);
								retireRemoval();
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
