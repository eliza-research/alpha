import { useEffect, useRef, useState } from "react";
import { registerPlugin } from '../platform-plugins';
import { type PluginListenerHandle } from '@capacitor/core';
import {
	secureConnectionStore,
	openConnectionBrowser,
} from "./native-connection";
import type { HostedDigestProtocol } from "./hosted-digests";
import { iconStyle } from "../icon-style";
const small = (name: string) => ({ ...iconStyle(name), width: "18px", height: "18px", verticalAlign: "middle", marginRight: 6 });
/** Presentation for the one status line: a spinner keeps its words for screen readers, Connected gets a check. */
function DelegationStatus({ message }: { message: string }) {
	const spinning = message === "Finishing…" || message === "Waiting for browser";
	return (
		<p role="status">
			{spinning && <span className="alpha-spinner" aria-hidden="true" style={{ display: "inline-block", width: 16, height: 16, borderWidth: 2, marginRight: 8, verticalAlign: "middle" }} />}
			{message === "Expires in 7 days" && <span aria-hidden="true" style={small("clock")} />}
			{message === "Connected" && <span aria-hidden="true" style={{ ...small("circle-check"), color: "#1a7f37" }} />}
			{message}
		</p>
	);
}
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
			"Expires in 7 days",
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
			throw Error("Changed — reopen");
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
				setMessage("Unconfirmed");
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
			setMessage("Connected");
			onConnected();
			return "settled";
		}
		if (status.status === "failed") {
			await clear(record);
			await releaseCallback(record.state);
			if (!valid()) return "settled";
			setMessage("Ended");
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
				? "Finishing…"
				: record.code
					? "Unconfirmed"
					: "Waiting for browser",
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
		if (valid()) setMessage("Cancelled");
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
				setMessage("Wrong account");
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
				if (valid()) setMessage("Cancelled");
				return;
			}
			if (!value.code || Date.parse(record.expiresAt) <= Date.now()) {
				await releaseCallback(record.state);
				if (valid()) setMessage("Expired");
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
					setMessage("Storage unavailable");
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
			if (valid()) setMessage("Waiting for browser");
		});
	}
	return (
		<details
			className="alpha-cloud-delegation"
			open={expanded}
			onToggle={(e) => setExpanded(e.currentTarget.open)}
		>
			<summary>Cloud reads</summary>
			<DelegationStatus message={message} />
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
						<span aria-hidden="true" style={small("mail")} />Inbox
					</label>
					<label style={{ flexDirection: "row", alignItems: "center" }}>
						<input
							style={{ width: 20, flexShrink: 0 }}
							type="checkbox"
							checked={calendar}
							disabled={busy}
							onChange={(e) => setCalendar(e.target.checked)}
						/>{" "}
						<span aria-hidden="true" style={small("calendar")} />Calendar
					</label>
					<p><span aria-hidden="true" style={small("eye")} />Read only</p>
					<button
						disabled={busy || (!email && !calendar)}
						onClick={() => void start()}
					>
						Continue
					</button>
				</>
			)}
			{pending && (
				<>
					<button
						disabled={busy}
						onClick={() => void run(() => recover(pending))}
						aria-label="Refresh authorization status"
					>
						<span aria-hidden="true" style={small("rotate-cw")} />Refresh
					</button>
					<button
						disabled={busy}
						onClick={() =>
							void run(() => openConnectionBrowser(pending.authUrl, signal))
						}
						aria-label="Open authorization"
					>
						<span aria-hidden="true" style={small("external-link")} />Open
					</button>
					<button
						disabled={busy}
						onClick={() => void run(() => cancelPending(pending))}
						aria-label="Cancel authorization"
					>
						Cancel
					</button>
				</>
			)}
            {revocations.filter(g=>g.grantId!==grantId).map(g=><div key={g.grantId} style={{display:"flex",alignItems:"center",gap:8}}><p style={{flex:1}}><span aria-hidden="true" style={{display:"inline-block",width:8,height:8,borderRadius:"50%",marginRight:6,verticalAlign:"middle",background:"#b26a00"}}/>Disconnect pending</p><button aria-label="Retry Cloud disconnect" disabled={busy} onClick={()=>void run(async()=>{const result=await client.delegation("revoke",{grantId:g.grantId,confirmed:true},signal);if(!valid())return;setMessage(result.remoteRevocation==="confirmed"?"Revoked":"Off · retry");await refreshRevocations().catch(()=>{/* The revoke outcome above stands; the list is read again on the next open. */});})}><span aria-hidden="true" style={iconStyle("rotate-cw")}/></button></div>)}
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
									? "Revoked"
									: "Off · retry",
							);
							if (result.remoteRevocation === "confirmed") setGrantId("");
							// The revoke outcome above stands when the list cannot be read again.
							await refreshRevocations().catch(() => {});
							if (valid()) onConnected();
						})
					}
					aria-label="Revoke Cloud read grant"
				>
					Revoke
				</button>
			)}
		</details>
	);
}
