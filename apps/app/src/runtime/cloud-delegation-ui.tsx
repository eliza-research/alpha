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
	const locked = useRef(false),
		// A return that arrives while another step holds the lock is read once that step ends.
		pendingCallback = useRef(false),
		slot = "cloud-delegation:v1:" + scope;
	const valid = () => current() && !signal.aborted;
	async function clear(expected: Pending) {
		const result = await secureConnectionStore.compareExchange(
			slot,
			expected,
			null,
		);
		if (result.status !== "saved")
			throw Error("Changed — reopen");
		if (valid()) setPending(null);
	}
	async function run(work: () => Promise<void>) {
		if (locked.current || !valid()) return;
		locked.current = true;
		setBusy(true);
		try {
			await work();
		} catch {
			if (valid())
				setMessage("Unconfirmed");
		} finally {
			locked.current = false;
			if (valid()) setBusy(false);
			if (pendingCallback.current) {
				pendingCallback.current = false;
				void callback();
			}
		}
	}
	// The native slot keeps the return for this process; drop it once its record is finished.
	const releaseCallback = (state: string) =>
		delegationNative.clearDelegationCallback({ state }).catch(() => {});
	async function recover(record: Pending, allowCompletion = true) {
		const status = await client.delegation(
			"status",
			{ state: record.state },
			signal,
		);
		if (!valid()) return;
		if (status.status === "complete" && typeof status.grantId === "string") {
			await clear(record);
			await releaseCallback(record.state);
			if (!valid()) return;
			setGrantId(status.grantId);
			setMessage("Connected");
			onConnected();
			return;
		}
		if (status.status === "failed") {
			await clear(record);
			await releaseCallback(record.state);
			if (!valid()) return;
			setMessage("Expired");
			return;
		}
		if (status.status === "waiting" && record.code && allowCompletion) {
			await client.delegation(
				"complete",
				{ state: record.state, code: record.code },
				signal,
			);
			if (valid()) await recover(record, false);
			return;
		}
		setMessage(
			status.status === "finishing"
				? "Finishing…"
				: record.code
					? "Unconfirmed"
					: "Waiting for browser",
		);
	}
	async function callback() {
		if (locked.current) {
			pendingCallback.current = true;
			return;
		}
		await run(async () => {
			const response = await delegationNative.readDelegationCallback();
			if (!valid() || !response.callback) return;
			const record = await secureConnectionStore.read<Pending>(slot),
				value = response.callback;
			// With nothing pending here the return may be another scope's or account's, so it stays.
			if (!record) return;
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
				setMessage("Cancelled");
				return;
			}
			if (!value.code || Date.parse(record.expiresAt) <= Date.now()) {
				await releaseCallback(record.state);
				setMessage("Expired");
				return;
			}
			const next: Pending = { ...record, phase: "finishing", code: value.code };
			const saved = await secureConnectionStore.compareExchange(
				slot,
				record,
				next,
			);
			if (saved.status !== "saved") throw Error("Authorization changed");
			setPending(next);
			await delegationNative.clearDelegationCallback({ state: record.state });
			await recover(next);
		});
	}
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
				if (!disposed)
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
			setMessage("Waiting for browser");
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
						disabled={busy || pending.phase === "finishing"}
						onClick={() =>
							void run(async () => {
								await client.delegation(
									"cancel",
									{ state: pending.state, confirmed: true },
									signal,
								);
								await clear(pending);
								setMessage("Cancelled");
							})
						}
						aria-label="Cancel authorization"
					>
						Cancel
					</button>
				</>
			)}
            {revocations.filter(g=>g.grantId!==grantId).map(g=><div key={g.grantId} style={{display:"flex",alignItems:"center",gap:8}}><p style={{flex:1}}><span aria-hidden="true" style={{display:"inline-block",width:8,height:8,borderRadius:"50%",marginRight:6,verticalAlign:"middle",background:"#b26a00"}}/>Disconnect pending</p><button aria-label="Retry Cloud disconnect" disabled={busy} onClick={()=>void run(async()=>{const result=await client.delegation("revoke",{grantId:g.grantId,confirmed:true},signal);if(!valid())return;await refreshRevocations();setMessage(result.remoteRevocation==="confirmed"?"Revoked":"Off · retry");})}><span aria-hidden="true" style={iconStyle("rotate-cw")}/></button></div>)}
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
							setMessage(
								result.remoteRevocation === "confirmed"
									? "Revoked"
									: "Off · retry",
							);
							if (result.remoteRevocation === "confirmed") setGrantId("");
                            await refreshRevocations();
							onConnected();
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
