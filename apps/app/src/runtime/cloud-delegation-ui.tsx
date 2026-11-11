import { useEffect, useRef, useState } from "react";
import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import {
	secureConnectionStore,
	openConnectionBrowser,
} from "./native-connection";
import type { HostedDigestProtocol } from "./hosted-digests";
export const delegationNative = registerPlugin<{
	addListener(
		event: "cloudDelegationCallback",
		callback: () => void,
	): Promise<PluginListenerHandle>;
	readDelegationCallback(): Promise<{
		callback: { state: string; code?: string; error?: string } | null;
	}>;
	clearDelegationCallback(input: { state: string }): Promise<void>;
}>("AlphaConnection");
/** The secure slot shape AlphaConnectionPlugin admits for this panel (RendererCredentialSlots). */
export const cloudDelegationSlot = /^cloud-delegation:v1:[a-f0-9]{64}$/;
type Pending = {
	state: string;
	authUrl: string;
	expiresAt: string;
	phase: "waiting" | "finishing";
	code?: string;
};
/**
 * Cancel for a pending authorization. Before the return was received nothing can have completed, so
 * it is cancelled directly. After it (`finishing`) Cloud's state is read first: a grant Cloud already
 * holds is adopted, an ended one is cleared, one Cloud is still finishing is left alone, and only
 * one still waiting (completion never arrived) is cancelled.
 */
export function delegationCancelStep(
	phase: "waiting" | "finishing",
	status: "settled" | "finishing" | "waiting" | null,
): "cancel" | "read-status" | "done" {
	if (phase === "waiting") return "cancel";
	if (status === null) return "read-status";
	return status === "waiting" ? "cancel" : "done";
}
export function CloudDelegationPanel({
	client,
	scope,
	signal,
	current,
	onConnected,
}: {
	client: HostedDigestProtocol;
	scope: string;
	signal: AbortSignal;
	current: () => boolean;
	onConnected: () => void;
}) {
	const [expanded, setExpanded] = useState(false);
    const [revocations,setRevocations]=useState<Array<{grantId:string;expiresAt:string}>>([]);
    async function refreshRevocations(){ const result=await client.delegation("revocations",{},signal); if(valid()&&Array.isArray(result.grants)){setRevocations(result.grants.filter((g: any)=>typeof g.grantId==="string"&&typeof g.expiresAt==="string"));if(result.grants.length)setExpanded(true);} }
	const [pending, setPending] = useState<Pending | null>(null),
		[busy, setBusy] = useState(false),
		[message, setMessage] = useState(
			"Allow this agent to read selected Google data when this agent is running. Access expires within seven days.",
		);
	const [email, setEmail] = useState(true),
		[calendar, setCalendar] = useState(false),
		[grantId, setGrantId] = useState("");
	// Each async continuation belongs to the scope, client and cancellation lifetime of its render.
	const authority = useRef({ scope, client, signal });
	if (authority.current.scope !== scope || authority.current.client !== client || authority.current.signal !== signal)
		authority.current = { scope, client, signal };
	const owner = authority.current;
	const lockOwner = useRef(owner);
	const locked = useRef(false),
		// A return that arrives while another step holds the lock is read once that step ends.
		pendingCallback = useRef(false),
		slot = "cloud-delegation:v1:" + scope;
	const valid = () => authority.current === owner && current() && !signal.aborted;
	async function clear(expected: Pending) {
		if (!valid()) throw Error("The connection changed. Reopen this screen.");
		const result = await secureConnectionStore.compareExchange(
			slot,
			expected,
			null,
		);
		if (result.status !== "saved")
			throw Error("The connection changed. Reopen this screen.");
		if (valid()) setPending(null);
	}
	async function run(work: () => Promise<unknown>) {
		if ((locked.current && lockOwner.current === owner) || !valid()) return;
		locked.current = true;
		lockOwner.current = owner;
		setBusy(true);
		try {
			await work();
		} catch {
			if (valid())
				setMessage(
					"The connection is not confirmed. Check its status before starting another grant.",
				);
		} finally {
			if (lockOwner.current === owner) {
				locked.current = false;
				if (valid()) setBusy(false);
				if (pendingCallback.current && valid()) {
					pendingCallback.current = false;
					void callback();
				}
			}
		}
	}
	// The native slot keeps the return for this process; drop it once its record is finished.
	const releaseCallback = (state: string) =>
		delegationNative.clearDelegationCallback({ state }).catch(() => {});
	/** Reads Cloud's state for the authorization and applies it. `settled`: it ended (connected, or
	 * failed and cleared). `finishing` and `waiting` are Cloud's own words for one still pending. */
	async function recover(
		record: Pending,
		allowCompletion = true,
	): Promise<"settled" | "finishing" | "waiting" | null> {
		const status = await client.delegation(
			"status",
			{ state: record.state },
			signal,
		);
		if (!valid()) return null;
		if (status.status === "complete" && typeof status.grantId === "string") {
			await clear(record);
			await releaseCallback(record.state);
			if (!valid()) return "settled";
			setGrantId(status.grantId);
			setMessage(
				"Cloud read access is connected. Choose the Google account and source below.",
			);
			onConnected();
			return "settled";
		}
		if (status.status === "failed") {
			await clear(record);
			await releaseCallback(record.state);
			if (!valid()) return "settled";
			setMessage(
				"This authorization expired or was cancelled. Start a new review.",
			);
			return "settled";
		}
		if (status.status === "waiting" && record.code && allowCompletion) {
			const currentRecord = await secureConnectionStore.read<Pending>(slot);
			if (!valid() || JSON.stringify(currentRecord) !== JSON.stringify(record)) return null;
			await client.delegation(
				"complete",
				{ state: record.state, code: record.code },
				signal,
			);
			return valid() ? recover(record, false) : null;
		}
		setMessage(
			status.status === "finishing"
				? "Cloud is finishing authorization. Check again shortly."
				: record.code
					? "Authorization completion is not confirmed. Check status again; it will not be retried automatically."
					: "Finish authorization in the browser, then return here.",
		);
		return status.status === "waiting" ? "waiting" : "finishing";
	}
	async function cancelPending(record: Pending) {
		let status: Awaited<ReturnType<typeof recover>> = null;
		if (delegationCancelStep(record.phase, null) === "read-status") {
			status = await recover(record, false);
			if (!valid() || status === null) return;
		}
		if (delegationCancelStep(record.phase, status) !== "cancel") return;
		await client.delegation(
			"cancel",
			{ state: record.state, confirmed: true },
			signal,
		);
		await clear(record);
		await releaseCallback(record.state);
		if (valid()) setMessage("Authorization cancelled.");
	}
	async function callback() {
		if (!valid()) return;
		if (locked.current && lockOwner.current === owner) {
			pendingCallback.current = true;
			return;
		}
		await run(async () => {
			const response = await delegationNative.readDelegationCallback();
			if (!valid() || !response.callback) return;
			const record = await secureConnectionStore.read<Pending>(slot),
				value = response.callback;
			// With nothing pending here the return may be another scope's or account's, so it stays.
			if (!valid() || !record) return;
			setExpanded(true);
			if (record.state !== value.state) {
				setMessage(
					"This return link belongs to another account or an older connection. Select the account that started it.",
				);
				return;
			}
			if (value.error) {
				await client.delegation(
					"cancel",
					{ state: record.state, confirmed: true },
					signal,
				);
				await clear(record);
				await delegationNative.clearDelegationCallback({ state: record.state });
				if (valid()) setMessage("Authorization cancelled.");
				return;
			}
			if (!value.code || Date.parse(record.expiresAt) <= Date.now()) {
				await releaseCallback(record.state);
				if (valid()) setMessage(
					"Authorization expired. Check status, then start a new review.",
				);
				return;
			}
			const next: Pending = { ...record, phase: "finishing", code: value.code };
			const saved = await secureConnectionStore.compareExchange(
				slot,
				record,
				next,
			);
			if (saved.status !== "saved") throw Error("Authorization changed");
			if (valid()) setPending(next);
			await delegationNative.clearDelegationCallback({ state: record.state });
			if (valid()) await recover(next);
		});
	}
	// A grant, a pending authorization and unfinished revocations belong to the account they were
	// read for; the effect below reads the new account's own.
	useEffect(() => {
		setGrantId("");
		setPending(null);
		setRevocations([]);
		setBusy(false);
	}, [scope, client, signal]);
	useEffect(() => {
		let disposed = false;
        void refreshRevocations().catch(()=>{});
		void secureConnectionStore
			.read<Pending>(slot)
			.then((record) => {
				if (!disposed && valid()) {
					setPending(record);
					if (record) setExpanded(true);
					void callback();
				}
			})
			.catch(() => {
				if (!disposed && valid())
					setMessage("Secure authorization storage is unavailable.");
			});
		const listener = delegationNative
			.addListener("cloudDelegationCallback", () => void callback())
			.catch(() => null);
		return () => {
			disposed = true;
			void listener.then((l) => l?.remove());
		};
	}, [scope, client]);
	async function start() {
		await run(async () => {
			const result = await client.delegation(
				"start",
				{
					confirmed: true,
					kinds: [
						...(email ? ["email"] : []),
						...(calendar ? ["calendar"] : []),
					],
				},
				signal,
			);
			if (!valid()) return;
			const url = new URL(String(result.authUrl)),
				state = url.searchParams.get("state");
			if (
				url.protocol !== "https:" ||
				url.username ||
				url.password ||
				url.pathname !== "/app-auth/authorize" ||
				!state ||
				!/^[-\w]{43}$/.test(state) ||
				typeof result.expiresAt !== "string" ||
				!Number.isFinite(Date.parse(result.expiresAt))
			)
				throw Error("Invalid authorization");
			const record: Pending = {
				state,
				authUrl: url.href,
				expiresAt: result.expiresAt,
				phase: "waiting",
			};
			const saved = await secureConnectionStore.compareExchange(
				slot,
				null,
				record,
			);
			if (saved.status !== "saved")
				throw Error("Authorization already pending");
			if (!valid()) return;
			setPending(record);
			await openConnectionBrowser(url.href, signal);
			if (valid()) setMessage(
				"Review the read permissions in Cloud, then choose Continue in Alpha Phone.",
			);
		});
	}
	return (
		<details
			className="alpha-cloud-delegation"
			open={expanded}
			onToggle={(e) => setExpanded(e.currentTarget.open)}
		>
			<summary>Connect Cloud for scheduled reads</summary>
			<p>{message}</p>
			{!pending && (
				<>
					<label style={{ flexDirection: "row", alignItems: "center" }}>
						<input
							style={{ width: 20, flexShrink: 0 }}
							type="checkbox"
							checked={email}
							disabled={busy}
							onChange={(e) => setEmail(e.target.checked)}
						/>{" "}
						Inbox subjects and snippets
					</label>
					<label style={{ flexDirection: "row", alignItems: "center" }}>
						<input
							style={{ width: 20, flexShrink: 0 }}
							type="checkbox"
							checked={calendar}
							disabled={busy}
							onChange={(e) => setCalendar(e.target.checked)}
						/>{" "}
						Calendar events
					</label>
					<p>No sending, calendar changes, or billing access is requested.</p>
					<button
						disabled={busy || (!email && !calendar)}
						onClick={() => void start()}
					>
						Review Cloud read access
					</button>
				</>
			)}
			{pending && (
				<>
					<button
						disabled={busy}
						onClick={() => void run(() => recover(pending))}
					>
						Check authorization status
					</button>
					<button
						disabled={busy}
						onClick={() =>
							void run(() => openConnectionBrowser(pending.authUrl, signal))
						}
					>
						Return to authorization
					</button>
					<button
						disabled={busy}
						onClick={() => void run(() => cancelPending(pending))}
					>
						Cancel authorization
					</button>
				</>
			)}
            {revocations.filter(g=>g.grantId!==grantId).map(g=><div key={g.grantId}><p>Reads are disabled. Cloud disconnect still needs confirmation.</p><button disabled={busy} onClick={()=>void run(async()=>{const result=await client.delegation("revoke",{grantId:g.grantId,confirmed:true},signal);if(!valid())return;setMessage(result.remoteRevocation==="confirmed"?"Cloud read access revoked.":"Reads disabled. Retry revocation to finish disconnecting in Cloud.");await refreshRevocations().catch(()=>{/* The revoke outcome above stands; the list is read again on the next open. */});})}>Retry Cloud disconnect</button></div>)}
			{grantId && (
				<button
					disabled={busy}
					onClick={() =>
						void run(async () => {
							const result = await client.delegation(
								"revoke",
								{ grantId, confirmed: true },
								signal,
							);
							if (!valid()) return;
							setMessage(
								result.remoteRevocation === "confirmed"
									? "Cloud read access revoked."
									: "Reads disabled. Retry revocation to finish disconnecting in Cloud.",
							);
							if (result.remoteRevocation === "confirmed") setGrantId("");
							// The revoke outcome above stands when the list cannot be read again.
							await refreshRevocations().catch(() => {});
							if (valid()) onConnected();
						})
					}
				>
					Revoke this Cloud read grant
				</button>
			)}
		</details>
	);
}
