import {reviewSourceRenewalQuestion,renewalMatches,type SourceRenewalTap} from './source-renewal-question';
import {hostedTapResolver,reviewHostedNoticeQuestion} from './hosted-notice-question';
import {iconStyle} from '../icon-style';
// Presentation only: status dots sit beside a word, chips name a source, switches map onto the existing handlers.
const srOnly={position:'absolute',width:1,height:1,overflow:'hidden',clip:'rect(0 0 0 0)',whiteSpace:'nowrap'} as const;
const dot=(color:string)=>({display:'inline-block',flex:'none',width:8,height:8,borderRadius:'50%',marginRight:6,verticalAlign:'middle',background:color});
const chip={display:'inline-block',padding:'2px 8px',borderRadius:12,background:'var(--connection-s2,#f3f3f3)',fontSize:13};
const switchRow={display:'flex',flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,margin:'4px 0',minHeight:44} as const;
const switchInput={width:22,height:22,flex:'none',padding:0};
import {registerPlugin} from '../platform-plugins';
import {openDomainRecovery} from '../browser/domain-recovery';
import {browserDevProfile} from '../browser/dev-profile';
import {browserScreenLocked} from '../browser/screen-locked';
import { holdPhoneInert } from './modal-inert';
import { browserHostedResults } from '../browser/hosted-results';
import { devSurfacesEnabled, testMocksEnabled } from '../build-flags';
import { browserLocalAgentEnabled } from './local-agent';
import { NativeResultInbox, configureHostedBackground } from './hosted-background';
import { createDigestInbox, type ResultInbox } from './digest-inbox';
import { isAndroid } from '../native';
import { delegationNative } from "./cloud-delegation-ui";
import { HostedLiveSourcePicker } from "./hosted-live-source-ui";
import { hostedResultNative, publishHostedResult, resolveHostedResultTap, type HostedResultBinding } from "./hosted-result-notices";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { connectionController, agentPendingText } from "./connection-ui";
import { cloudServiceName } from "./cloud-protocol";
import { secureConnectionStore } from "./native-connection";
import { actionScope } from "./device-actions";
import {
	HostedSourceRejected,
 digestSummaryText,
 digestRenewals,
 digestLoopState,
 digestStatusLabel,
 digestRan,
 digestZoneNote,
 missedRunNowOffers,
 type MissedRunNow,
 rememberRetainedDigests,
 bindRetainedDigestScope,
 digestPendingDiscardable,
 digestToggledSpec,
 digestMissingCalendars,
 digestTapNotice,
 DIGEST_SOURCE_MAX_HOURS,
	type DigestCapabilities,
	type DigestSource,
	type DigestLoop,
	type DigestResult,
	type DigestTemplate,
	type HostedDigestProtocol,
 type DigestStorage,
} from "./hosted-digests";
import { DailyApps } from "../daily";
import { formatDateTime } from "../prototype/locale-time";
type Pending = {
	path: "sources" | "loops" | "sources/revoke" | "dossier";
	body: Record<string, unknown>;
	summary: string;
 nativeConsent?:{sourceId:string;scope:Record<string,unknown>;expiresAt:number;expectedBinding:Record<string,unknown>};
 /** Renewal: after the new source saves, these loops move to it (same mutation IDs on retry). */
 rebind?:Array<{id:string;expectedVersionId:string;mutationId:string;spec:Record<string,unknown>}>;
 renews?:string;
 /** Run now of this missed record (#394): hidden here once confirmed; the agent returns the same run on repeat. */
 missedRunId?:string;
 /** 'review' until the request is about to reach the agent; a record without a phase (older build) counts as dispatched. */
 phase?:'review'|'dispatched';
};
// Refreshes replace state only when the agent's data changed, so a quiet poll renders nothing.
const same=(a:unknown,b:unknown)=>a===b||JSON.stringify(a)===JSON.stringify(b);
const nativeSources=registerPlugin<{nativeSourceConsent(input:Record<string,unknown>):Promise<Record<string,unknown>>;nativeSourceIdentity(input:{sessionId:string}):Promise<Record<string,unknown>>;scheduleSourceRenewal(input:{selection:SourceRenewalTap['selection'];expiresAt:number}):Promise<void>;clearSourceRenewal(input:{selection:SourceRenewalTap['selection']}):Promise<void>;pendingSourceRenewal():Promise<Partial<SourceRenewalTap>>;settleSourceRenewal(input:{token:string;discard:boolean}):Promise<void>;addListener(event:'renewSource',listener:()=>void):Promise<{remove():Promise<void>}>}>('AlphaHostedResults');
const nativeCalendars=registerPlugin<{requestWorkflowReadAccess():Promise<{status:string}>;workflowCalendars():Promise<{status:string;calendars:Array<{id:string;name:string;account:string;sourceRevision:string}>}>}>('AlphaCalendar');
function canSyncResults(){return !document.hidden&&(isAndroid||(document.documentElement.dataset.devBackground!=='true'&&!browserScreenLocked()));}
export function HostedDigestPanel({composeQuestion,canComposeQuestion}:{composeQuestion?:(draft:string,sessionId:string)=>boolean;canComposeQuestion?:(sessionId:string)=>boolean}={}) {
 const questionClose=useRef<undefined|(()=>void)>(undefined);
 const questionBusy=useRef(false);
 const resolveTap=useRef(hostedTapResolver());
 useEffect(()=>()=>questionClose.current?.(),[]);
	const panel = useRef<HTMLElement>(null);
	const connection = useSyncExternalStore(
		connectionController.subscribe,
		connectionController.getSnapshot,
	);
	const interactiveDevelopment=devSurfacesEnabled&&browserDevProfile&&JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind==='development';
	const [nativeReady,setNativeReady]=useState(false),[nativeSourceProtocol,setNativeSourceProtocol]=useState(false);
    // Agent-advertised features: native evening loops and lapsed-source pausing come from patched plugin-workflow.
    const [features,setFeatures]=useState<Pick<DigestCapabilities,'nativeEvening'|'sourcePause'|'dossier'>>({nativeEvening:false,sourcePause:false,dossier:false});
	const [backgroundEnabled,setBackgroundEnabled]=useState(false);
	const [noticeEnabled,setNoticeEnabled]=useState(false), [focusedRun,setFocusedRun]=useState<string|null>(null), [tap,setTap]=useState<{token:string;runId:string;sessionId:string}|null>(null);
	const [open, setOpen] = useState(false),
		[busy, setBusy] = useState(false),
		[message, setMessage] = useState(""),
		[sources, setSources] = useState<DigestSource[]>([]),
		[loops, setLoops] = useState<DigestLoop[]>([]),
		[results, setResults] = useState<DigestResult[]>([]),
		[review, setReview] = useState<Pending | null>(null),
		[pending, setPending] = useState<Pending | null>(null),
		[available, setAvailable] = useState(false);
	const [ranMissed, setRanMissed] = useState<ReadonlySet<string>>(new Set());
    useEffect(()=>{if(!isAndroid)return;let stopped=false;const listener=delegationNative.addListener('cloudDelegationCallback',()=>{if(!stopped)setOpen(true);}).catch(()=>null);void delegationNative.readDelegationCallback().then(r=>{if(r.callback&&!stopped)setOpen(true);}).catch(()=>{});return()=>{stopped=true;void listener.then(l=>l?.remove());};},[]);
	const [text, setText] = useState(""),
		[label, setLabel] = useState("My reviewed tasks"),
		[kind, setKind] = useState("tasks"),
		[hours, setHours] = useState(DIGEST_SOURCE_MAX_HOURS),
		[sourceId, setSourceId] = useState(""),
		[zone, setZone] = useState(
			Intl.DateTimeFormat().resolvedOptions().timeZone,
		),
		[morning, setMorning] = useState("08:00"),
		[evening, setEvening] = useState("18:00");
 const [nativeLabel,setNativeLabel]=useState('Phone sources');
 const [renewing,setRenewing]=useState<string|null>(null),[nativeOpen,setNativeOpen]=useState(false),[snapshotOpen,setSnapshotOpen]=useState(false);
 const [calendarChoices,setCalendarChoices]=useState<Array<{id:string;name:string;account:string;sourceRevision:string}>>([]),[selectedCalendars,setSelectedCalendars]=useState<string[]>([]),[selectedReminders,setSelectedReminders]=useState(false);
 useEffect(()=>{setCalendarChoices([]);setSelectedCalendars([]);setSelectedReminders(false);},[connection.session?.sessionId]);
 // The form starts from the saved schedules, so an edit changes only what the owner changes.
 const savedLoops=loops.filter(l=>!l.removed),savedKey=savedLoops.map(l=>l.id+':'+l.versionId).join();
 useEffect(()=>{const morningLoop=savedLoops.find(l=>l.spec.template==='morning'),eveningLoop=savedLoops.find(l=>l.spec.template==='evening');if(morningLoop)setMorning(morningLoop.spec.localTime);if(eveningLoop)setEvening(eveningLoop.spec.localTime);const zoned=morningLoop??eveningLoop;if(zoned)setZone(zoned.spec.timeZone);},[savedKey]);
	const binding = useRef<{
		storage: DigestStorage;
        recover?:()=>void;
		notices: HostedResultBinding;
		client: HostedDigestProtocol;
		inbox: ResultInbox;
		pendingSlot: string;
		sessionId: string;
		controller: AbortController;
	} | null>(null);
	const mutationBusy = useRef<NonNullable<typeof binding.current> | null>(null);
	const refreshFlight = useRef<{controller:AbortController;promise:Promise<void>;full:boolean} | null>(null);
	const openRef = useRef(false);openRef.current = open;
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		const show = () => setOpen(true);
		window.addEventListener("alpha:hosted-digests", show);
		return () => {
			mounted.current = false;
			window.removeEventListener("alpha:hosted-digests", show);
		};
	}, []);
    useEffect(()=>{if(isAndroid)return;let live=true;const update=()=>{void hostedResultNative.status().then(value=>{if(live){setNoticeEnabled(value.enabled);setBackgroundEnabled(value.backgroundEnabled===true);}}).catch(()=>{});};update();window.addEventListener('alpha:hosted-notices-changed',update);return()=>{live=false;window.removeEventListener('alpha:hosted-notices-changed',update);};},[]);
    const checkTap = (requestSignal?:AbortSignal) => resolveTap.current(async () => {
        if(!canSyncResults()||questionBusy.current||questionClose.current)return;
        const b=binding.current;
        try {
            const result=await resolveHostedResultTap(hostedResultNative,b?.notices ?? null,requestSignal ?? b?.controller.signal ?? new AbortController().signal);
            if(result.kind==='none'||!canSyncResults()||requestSignal?.aborted)return;
            if(b && binding.current!==b)return;
            let unreviewable=false;
            if(result.kind==='ready' && b&&result.question){
                const current=()=>mounted.current&&binding.current===b&&b.notices.current()&&canSyncResults()&&!connectionController.getSnapshot().open;
                // Failures after the dialog closes stay visible beside the saved result instead of in a closed panel.
                const report=(value:string)=>{if(!mounted.current||binding.current!==b)return;setOpen(true);setFocusedRun(result.result.runId);setMessage(value);};
                questionBusy.current=true;
                questionClose.current=reviewHostedNoticeQuestion({signal:b.controller.signal,result,current,recheck:()=>resolveHostedResultTap(hostedResultNative,b.notices,b.controller.signal),canCompose:()=>canComposeQuestion?.(b.sessionId)??false,consume:()=>hostedResultNative.consumeResult({token:result.token}),discard:async()=>{if(!hostedResultNative.releaseResultQuestion)throw Error('Question release unavailable');await hostedResultNative.releaseResultQuestion({token:result.token});},compose:draft=>{if(!composeQuestion?.(draft,b.sessionId))throw Error('Conversation unavailable');setOpen(false);},report,unreviewable:()=>{unreviewable=true;},closed:()=>{questionBusy.current=false;questionClose.current=undefined;}});
                if(!questionClose.current)questionBusy.current=false;
                // An unreviewable Ask opens like an ordinary tap, which consumes it instead of re-reporting on every poll.
                if(!unreviewable)return;
            }
            if(result.kind==='ready' && b){const history=await b.inbox.history();if(binding.current!==b||!canSyncResults())return;setOpen(true);setResults(history);setFocusedRun(result.result.runId);setTap({token:result.token,runId:result.result.runId,sessionId:b.sessionId});setMessage('');}
            else {const notice=digestTapNotice(result.kind,!!b);if(!notice)return;setOpen(true);setMessage(notice);}
        } catch { if(!b || binding.current===b)setMessage('Waiting'); }
    });
    useEffect(()=>{const listener=hostedResultNative.addListener('pendingResult',()=>{void checkTap();}).catch(()=>null);void checkTap();return()=>{void listener.then(value=>value?.remove());};},[]);
    useEffect(()=>{
        if(!open||!tap||!canSyncResults()||binding.current?.sessionId!==tap.sessionId)return;
        const node=document.getElementById('hosted-result-'+tap.runId);if(!node)return;node.scrollIntoView({block:'nearest'});node.focus();
        void hostedResultNative.consumeResult({token:tap.token}).then(()=>setTap(current=>current?.token===tap.token?null:current)).catch(()=>{});
    },[open,tap,results]);
    // Android: a result shown here withdraws its notice, and a result arriving while this panel is on screen posts silently.
    const withdrawn=useRef(new Set<string>()),showingScope=useRef<string|null>(null);
    useEffect(()=>{
        const b=binding.current;
        if(!isAndroid||!open||!b||!canSyncResults()||b.sessionId!==connection.session?.sessionId)return;
        const runIds=results.map(result=>result.runId).filter(run=>!withdrawn.current.has(b.notices.scope+':'+run));if(!runIds.length)return;
        for(const run of runIds)withdrawn.current.add(b.notices.scope+':'+run);
        void hostedResultNative.withdrawResult?.({scope:b.notices.scope,runIds}).catch(()=>{for(const run of runIds)withdrawn.current.delete(b.notices.scope+':'+run);});
    },[open,results]);
    useEffect(()=>{
        if(!isAndroid)return;
        const report=()=>{const b=binding.current,scope=open&&b&&!document.hidden?b.notices.scope:null;if(scope===showingScope.current)return;showingScope.current=scope;void hostedResultNative.setResultsShowing?.({scope}).catch(()=>{});};
        report();document.addEventListener('visibilitychange',report);
        return()=>document.removeEventListener('visibilitychange',report);
    },[open,results]);
    useEffect(()=>()=>{if(isAndroid&&showingScope.current)void hostedResultNative.setResultsShowing?.({scope:null}).catch(()=>{});},[]);
	// resultsOnly: the closed-panel poll reads only the inbox (results and notices for Home and taps).
	const refresh = (afterMutation=false,resultsOnly=false):Promise<void> => {
		const b = binding.current;
		if (!b || !canSyncResults() || (mutationBusy.current === b && !afterMutation)) return Promise.resolve();
		const flight = refreshFlight.current;
		if (flight) return flight.full || resultsOnly ? flight.promise : flight.promise.then(() => {
			if (binding.current === b) return refresh(afterMutation);
		});
		const controller = new AbortController();
		const abort = () => controller.abort();
		b.controller.signal.addEventListener("abort", abort, {once:true});
		if (b.controller.signal.aborted) abort();
		let timedOut = false;
		const deadline = setTimeout(() => { timedOut = true; abort(); }, 20000);
		const signal = controller.signal;
		const promise = Promise.resolve().then(async () => {
		try {
			if (resultsOnly) {
				const rr = await b.inbox.sync(b.client, signal);
				signal.throwIfAborted();
				if (binding.current !== b || document.hidden) return;
				setResults(prior=>same(prior,rr)?prior:rr);rememberRetainedDigests(rr,connection.name||undefined,b.notices.scope);
				await checkTap(signal);
				return;
			}
			// One status read: digest support plus the features this agent advertises.
			const advertised = await b.client.capabilities(signal),supported = advertised.digests;
			signal.throwIfAborted();
			if (binding.current !== b || document.hidden) return;
			setAvailable(supported);
            const nativeSupported=supported&&advertised.nativeSources&&isAndroid&&connection.kind==='resident';
            // The dossier needs native phone sources, which only the resident agent has. That agent is staged
            // from upstream.lock.json, whose plugin-workflow registers POST /api/workflow/hosted/dossier
            // (elizaOS/eliza#35906, test/digest-route-registration.test.mjs); /status does not advertise it.
            setNativeSourceProtocol(nativeSupported);const advertisedFeatures={nativeEvening:nativeSupported&&advertised.nativeEvening,sourcePause:supported&&advertised.sourcePause,dossier:nativeSupported};setFeatures(prior=>same(prior,advertisedFeatures)?prior:advertisedFeatures);
			if (!supported) {
				setMessage("Not available");
				return;
			}
			const [ss, ll, rr, pp] = await Promise.all([
				b.client.sources(signal),
				b.client.loops(signal),
				b.inbox.sync(b.client, signal),
				b.storage.read<Pending>(b.pendingSlot),
			]);
			signal.throwIfAborted();
			if (binding.current !== b || document.hidden) return;
			setSources(prior=>same(prior,ss)?prior:ss);
			setLoops(prior=>same(prior,ll)?prior:ll);
			setResults(prior=>same(prior,rr)?prior:rr);rememberRetainedDigests(rr,connection.name||undefined,b.notices.scope);
			setPending(prior=>same(prior,pp)?prior:pp);
			setMessage("Synced with this agent.");
            try {const status=await hostedResultNative.status();if(binding.current===b){setNoticeEnabled(status.enabled);setBackgroundEnabled(status.backgroundEnabled===true);}}catch{}
            await checkTap(signal);
            await checkRenewal();
		} catch {
			if (binding.current === b && (timedOut || !signal.aborted) && !document.hidden)
				setMessage("Offline");
		}
		}).finally(() => {
			clearTimeout(deadline); b.controller.signal.removeEventListener("abort", abort); controller.abort();
			if (refreshFlight.current?.controller === controller) refreshFlight.current = null;
		});
		refreshFlight.current = {controller,promise,full:!resultsOnly};
		return promise;
	};
	useEffect(() => {
		const selected = connectionController.getWorkflowClient();
		binding.current?.controller.abort();
        if (mutationBusy.current) {mutationBusy.current = null; setBusy(false);}
        questionClose.current?.();
		binding.current = null;
		setAvailable(false);setNativeReady(false);setBackgroundEnabled(false);setNoticeEnabled(false);setFeatures({nativeEvening:false,sourcePause:false,dossier:false});
		setResults([]);bindRetainedDigestScope(null);setFocusedRun(null);setTap(null);setRenewing(null);
		setSources([]);
		setLoops([]);
		setPending(null);
		setReview(null);
		setText("");
		setSourceId("");
		if (!selected || !connection.session) {
			setMessage(
				agentPendingText(connection),
			);
			return;
		}
		const controller = new AbortController();
		let disposed = false;
        let releaseBrowser:undefined|(()=>void),releaseScheduler:undefined|(()=>void);
		void (async () => {
			const session = connection.session!,
				slot =
					"hosted-digests:v1:" +
					(await actionScope(
						JSON.stringify([session.origin, session.ownerId, session.agentId]),
					));
			if (disposed) return;
            const client=selected.client.hosted();let inbox:ResultInbox;
            const development=devSurfacesEnabled&&browserDevProfile&&JSON.parse(localStorage.getItem('alpha.connection.selection.v1')||'null')?.kind==='development';
            const storage=development?await (await import('../browser/digest-storage')).browserDigestStore(session,()=>!disposed&&connectionController.getSnapshot().session?.sessionId===session.sessionId,controller.signal):devSurfacesEnabled&&!isAndroid&&browserLocalAgentEnabled&&connection.kind==='resident'?(await import('./local-agent-storage')).developmentDigestStore():secureConnectionStore;
            const notices:HostedResultBinding={scope:slot.slice('hosted-digests:v1:'.length),origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,current:()=>!disposed&&binding.current?.sessionId===session.sessionId&&connectionController.getSnapshot().session?.sessionId===session.sessionId,revalidate:signal=>client.available(signal),history:()=>inbox.history()};
            let ready=false;
            if(isAndroid){
                const cloud=testMocksEnabled&&connection.kind==='cloud'?await secureConnectionStore.read<Record<string,unknown>>(`cloud-runtime:${session.sessionId}`):null;
                controller.signal.throwIfAborted();
                if(connectionController.getSnapshot().session?.sessionId!==session.sessionId)return;
                ready=await configureHostedBackground({...cloud,mode:connection.kind,origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,sessionId:session.sessionId},controller.signal);
            }
            controller.signal.throwIfAborted();if(disposed)return;
            setNativeReady(ready);
            inbox=createDigestInbox({android:isAndroid,nativeReady:ready,storage,scope:slot,native:()=>new NativeResultInbox(session.sessionId),afterCommit:!isAndroid?async(result,signal)=>{await publishHostedResult(hostedResultNative,notices,result,signal);}:undefined});
			const b = {
                storage, notices,
                recover:development&&'recovery' in storage?()=>openDomainRecovery(storage.recovery as Parameters<typeof openDomainRecovery>[0],'digest inbox','Development digest inbox recovery','Download saved results and pending recovery records before resetting. Reset clears this account’s local inbox and pending request records. It does not cancel or restart agent schedules. Review uncertain requests with the agent before creating replacements. The backup preserves older slot bytes inside a JSON archive. Close older Alpha tabs before continuing.',controller.signal):undefined,
				client,
				inbox,
				pendingSlot: (isAndroid ? "renderer-" : "") + slot + ":pending",
				sessionId: selected.sessionId,
				controller,
			};
			binding.current = b;
            // Home's retained brief belongs to this account and agent only; a late read for another is ignored.
            bindRetainedDigestScope(notices.scope);
            if(development){const {startDevelopmentDigestScheduler}=await import('../browser/development-digests');if(!disposed)releaseScheduler=startDevelopmentDigestScheduler(notices.current,controller.signal);}
            if(!isAndroid)releaseBrowser=browserHostedResults.bind(session.sessionId,notices);
			try {
				const old = await b.inbox.history();
				if (binding.current === b) {setResults(old);rememberRetainedDigests(old,connection.name||undefined,b.notices.scope);}
			} catch {}
			await refreshFlight.current?.promise;
			if (!disposed && binding.current === b) await refresh();
		})().catch(()=>{if(!disposed)setMessage('Storage unavailable');});
		const resume = () => {
			if (!canSyncResults()) { refreshFlight.current?.controller.abort(); return; }
			void (async () => { await refreshFlight.current?.promise; if (!disposed && !document.hidden) await refresh(); })();
		};
		// Foreground freshness only; Android background delivery is a separate transport. While the panel
		// is closed only the inbox is read, once a minute; open, resume, mutation and reconnect refresh fully.
		let ticks = 0;
		const poll = setInterval(() => {
			const full = openRef.current;
			if ((!full && ++ticks % 4) || !canSyncResults()) return;
			void (async () => {
				const enabled = isAndroid || (await hostedResultNative.status()).backgroundEnabled;
				if (enabled && !disposed) await refresh(false, !full);
			})().catch(() => {});
		}, 15000);
		window.addEventListener("online", resume);
        let deviceFrame=0;const deviceResume=()=>{refreshFlight.current?.controller.abort();cancelAnimationFrame(deviceFrame);deviceFrame=requestAnimationFrame(resume);};
        window.addEventListener("alpha:device-state",deviceResume);
		document.addEventListener("visibilitychange", resume);
		const listener = DailyApps.addListener("appResumed", resume).catch(
			() => null,
		);
		return () => {
			disposed = true;
            releaseBrowser?.();releaseScheduler?.();
			clearInterval(poll);
			controller.abort();
			binding.current = null;
			window.removeEventListener("online", resume);
            window.removeEventListener("alpha:device-state",deviceResume);cancelAnimationFrame(deviceFrame);
			document.removeEventListener("visibilitychange", resume);
			void listener.then((value) => value?.remove());
		};
	}, [connection.session?.sessionId]);
	useEffect(() => {
		if (open) void refresh();
	}, [open]);
	useEffect(() => {
		if (!open) return;
		const previous = document.activeElement as HTMLElement | null;
		const phone = document.querySelector<HTMLElement>('.os');
		const releaseInert = holdPhoneInert(phone);
		if (phone && panel.current) {
			const theme = getComputedStyle(phone);
			for (const token of ['bg', 'fg', 's2', 'line', 'mut', 'acc']) panel.current.style.setProperty(`--connection-${token}`, theme.getPropertyValue(token === 'acc' ? '--acct' : `--${token}`));
		}

		panel.current?.focus();
		const back = (event: Event) => {
            if (document.querySelector("dialog[open]")) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			setOpen(false);
		};
		const key = (event: KeyboardEvent) => {
            if (document.querySelector("dialog[open]")) return;
			if (event.key === "Escape") back(event);
			if (event.key === 'Tab' && panel.current) {
				const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href]')).filter(item => item.getClientRects().length);
				const first = items[0], last = items.at(-1);
				if (!first) { event.preventDefault(); panel.current.focus(); }
				else if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
				else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
			}
		};
		const modal = panel.current;
		modal?.addEventListener("cancel", back);
		window.addEventListener("alpha-back", back, true);
		window.addEventListener("keydown", key);
		return () => {
			modal?.removeEventListener("cancel", back);
			window.removeEventListener("alpha-back", back, true);
			window.removeEventListener("keydown", key);
			releaseInert();
			previous?.focus();
		};
	}, [open]);
    // The native token carries the exact owner/enrollment/source revision, never an unbound source ID.
    const renewalSources=useRef(sources);renewalSources.current=sources;
    const renewalFlight=resolveTap;
    const renewalStart=useRef(startRenewal);renewalStart.current=startRenewal;
    // Renewal taps exist only on Android; elsewhere the native plugin is absent and must not replace the sync status.
    const checkRenewal=()=>renewalFlight.current(async()=>{
      const b=binding.current;if(!isAndroid||!b||!canSyncResults()||questionBusy.current||questionClose.current)return;
      // Only a real pending tap may report a failure: a check with no tap (the native record is
      // unavailable here, or nothing was tapped) leaves the panel's current status untouched.
      let tapped=false;
      try{const tap=await nativeSources.pendingSourceRenewal();if(!tap.token||!tap.selection||typeof tap.expiresAt!=='number'||binding.current!==b||!b.notices.current()||!canSyncResults())return;tapped=true;
       const current=()=>mounted.current&&binding.current===b&&b.notices.current()&&canSyncResults()&&!connectionController.getSnapshot().open&&renewalSources.current.some(source=>!source.revoked&&source.live?.provider==='native'&&renewalMatches(tap as SourceRenewalTap,source.live,source.expiresAt));
       if(!current())return;
       if(tap.question){
        questionBusy.current=true;
        questionClose.current=reviewSourceRenewalQuestion({
         tap:tap as SourceRenewalTap,signal:b.controller.signal,current,
         recheck:()=>nativeSources.pendingSourceRenewal(),
         settle:discard=>nativeSources.settleSourceRenewal({token:tap.token!,discard}),
         canCompose:()=>canComposeQuestion?.(b.sessionId)===true,
         compose:draft=>composeQuestion?.(draft,b.sessionId)===true,
         report:value=>{if(mounted.current&&binding.current===b&&b.notices.current())setMessage(value);},
         closed:()=>{questionBusy.current=false;questionClose.current=undefined;},
        });
        if(!questionClose.current)questionBusy.current=false;
        return;
       }
       await nativeSources.settleSourceRenewal({token:tap.token,discard:false});if(!current()){if(binding.current===b)setMessage('Renewal changed');return;}setOpen(true);renewalStart.current(tap.selection.sourceId);
      }catch{if(tapped&&binding.current===b)setMessage('Waiting');}
    });
    useEffect(()=>{if(!isAndroid)return;const listener=nativeSources.addListener('renewSource',()=>{void checkRenewal();}).catch(()=>null);void checkRenewal();return()=>{void listener.then(l=>l?.remove());};},[]);
    useEffect(()=>{if(isAndroid)void checkRenewal();},[sources]);
    // Arm the background renewal notice for each phone source that keeps a schedule running.
    useEffect(()=>{if(!isAndroid)return;for(const source of sources){if(source.live?.provider!=='native')continue;const bound=loops.some(l=>!l.removed&&l.spec.enabled&&l.spec.sourceId===source.id);if(bound&&!source.revoked)void nativeSources.scheduleSourceRenewal({selection:source.live,expiresAt:Date.parse(source.expiresAt)}).catch(()=>{});else void nativeSources.clearSourceRenewal({selection:source.live}).catch(()=>{});}},[sources,loops]);
    function clearRenewal(id:string){const selection=renewalSources.current.find(source=>source.id===id)?.live;if(selection?.provider==='native')void nativeSources.clearSourceRenewal({selection}).catch(()=>{});}
    function startRenewal(id:string){
     const source=sources.find(s=>s.id===id);if(!source)return;setRenewing(id);setReview(null);setSourceId('');
     const bound=loops.find(l=>!l.removed&&l.spec.sourceId===id);if(bound)setZone(bound.spec.timeZone);
     if(source.live?.provider==='native'){setNativeOpen(true);setNativeLabel(source.label);setMessage(`Renew ${source.label}`);}
     else if(source.live){setMessage(`Renew ${source.label}`);}
     else{setSnapshotOpen(true);setLabel(source.label);setKind(source.kind);setMessage(`Renew ${source.label}`);}
    }
    const renewalLoops=(id:string|null)=>id?loops.filter(l=>!l.removed&&l.spec.enabled&&l.spec.sourceId===id).map(l=>({id:l.id,expectedVersionId:l.versionId,mutationId:crypto.randomUUID(),spec:{version:1,template:l.spec.template,timeZone:l.spec.timeZone,localTime:l.spec.localTime,enabled:true}})):[];
    const renewalNote=(id:string|null)=>{const moved=renewalLoops(id);return moved.length?`\nRenewal: ${moved.map(l=>l.spec.template+' at '+l.spec.localTime).join(', ')} ${moved.length===1?'moves':'move'} to this source when you confirm.`:'';};
    // On the phone Cloud supplies the agent's model, so usage is the owner's plan allowance (P-43).
    const billing=interactiveDevelopment?'Development reply':isAndroid&&connection.kind==='resident'?`${cloudServiceName(connectionController.getCloudEnvironment()??connection.cloudAccount?.environment??connection.signIn?.environment??'production')} plan`:'Billed by agent';
    // A missed occurrence is never replayed; Run now is one new, separately reviewed run (#394).
    const missedOffers=available?missedRunNowOffers(binding.current?.sessionId===connection.session?.sessionId?results:[],loops,sources):new Map<string,MissedRunNow>();
    function reviewMissedRunNow(offer:MissedRunNow){
     setMessage('');
     setReview({path:'dossier',body:{sourceId:offer.sourceId,sourceRevision:offer.sourceRevision,mutationId:offer.mutationId,confirmed:true},missedRunId:offer.runId,summary:`Run missed ${formatDateTime(new Date(offer.scheduledAt))} digest now?\nSends ${offer.sourceLabel} to agent AI`});
     requestAnimationFrame(()=>document.getElementById('hosted-digest-review')?.focus());
    }
	async function submit(value: Pending) {
		const b = binding.current;
		if (!b || busy || mutationBusy.current === b) return;
		setBusy(true); mutationBusy.current = b;
		try {
			refreshFlight.current?.controller.abort();
			await refreshFlight.current?.promise;
			if (binding.current !== b) return;
			// A retry of a request that may already have reached the agent never goes back to 'review'.
			const reviewed:Pending = value===pending&&!digestPendingDiscardable(value) ? {...value,phase:'dispatched'} : {...value,phase:'review'};
			await b.storage.write(b.pendingSlot, reviewed);
			if (binding.current !== b) return;
			setPending(reviewed);
			let body=value.body;
            try{
              if(value.nativeConsent){
                const grant=await nativeSources.nativeSourceConsent({sessionId:b.sessionId,...value.nativeConsent,confirmed:true});
                if(binding.current!==b)return;
                body={...body,live:Object.fromEntries(['provider','ownerId','agentId','installationId','enrollmentId','sourceId','revision'].map(key=>[key,grant[key]]))};
              }
              if(value.path==='sources/revoke'){
                const source=sources.find(source=>source.id===body.id);
                if(source?.live?.provider==='native')await nativeSources.nativeSourceConsent({sessionId:b.sessionId,sourceId:source.live.sourceId,expectedBinding:source.live,revoke:true,confirmed:true});
                if(binding.current!==b)return;
              }
            }catch(error){
              // The phone refused before anything was sent (consent expired, a calendar changed): nothing to retry.
              if(binding.current!==b)return;
              // A retry of a dispatched request may already have reached the agent: keep it for Retry.
              if(!digestPendingDiscardable(reviewed)){setMessage(`Not confirmed: ${(error as Error)?.message||'this phone did not confirm access.'} Retry.`);return;}
              try{await b.storage.remove(b.pendingSlot);}catch{if(binding.current===b)setMessage('Not cleared');return;}
              if(binding.current!==b)return;
              setPending(null);setReview(null);setMessage(`Not sent: ${(error as Error)?.message||'this phone did not confirm access.'} Review it again.`);return;
            }
            const dispatched:Pending={...value,phase:'dispatched'};
            await b.storage.write(b.pendingSlot, dispatched);
            if(binding.current!==b)return;
            setPending(dispatched);
            const saved=await b.client.mutate(value.path, body, b.controller.signal);
            if(binding.current!==b)return;
            if(value.rebind?.length){
              // One confirmed renewal: the reviewed source above, then each loop moves to its exact new revision.
              const source=(saved as {source?:{id?:unknown;revision?:unknown}}).source;
              if(!source||source.id!==body.id||typeof source.revision!=='string')throw Error('Renewed source receipt changed');
              for(const loop of value.rebind){if(binding.current!==b)return;await b.client.mutate('loops',{spec:{...loop.spec,sourceId:source.id,sourceRevision:source.revision},mutationId:loop.mutationId,confirmed:true,id:loop.id,expectedVersionId:loop.expectedVersionId},b.controller.signal);}
              if(value.renews&&isAndroid&&binding.current===b)clearRenewal(value.renews);
            }
            if(value.path==='sources/revoke'&&isAndroid&&typeof body.id==='string'&&binding.current===b)clearRenewal(body.id);
            if(value.nativeConsent&&binding.current===b)setSourceId(value.nativeConsent.sourceId);
            if(value.renews&&binding.current===b)setRenewing(null);
            if(value.missedRunId&&binding.current===b){const id=value.missedRunId;setRanMissed(prior=>new Set([...prior,id]));}
			if (binding.current !== b) return;
			await b.storage.remove(b.pendingSlot);
			if (binding.current !== b) return;
			setPending(null);
			setReview(null);
			setText("");
			await refresh(true);
		} catch (error) {
      if(error instanceof HostedSourceRejected && binding.current===b){
        try { await b.storage.remove(b.pendingSlot); } catch {if(binding.current===b)setMessage("Source not saved. Retry to clear it.");return;}
        if(binding.current!==b)return;
        setPending(null);setReview(null);await refresh(true);if(binding.current===b)setMessage(error.message);return;
      }
			if (binding.current === b)
				setMessage("Save not confirmed. Retry.");
		} finally {
			if (mutationBusy.current === b) {
				mutationBusy.current = null;
				if (mounted.current) setBusy(false);
			}
		}
	}
	// Only a request still in review never reached the agent; it is dropped without a server call.
	async function discardPending(){
		const b=binding.current;if(!b||busy||!pending||!digestPendingDiscardable(pending))return;
		try{await b.storage.remove(b.pendingSlot);if(binding.current!==b)return;setPending(null);setReview(null);setMessage('Discarded');}
		catch{if(binding.current===b)setMessage('Couldn’t discard');}
	}
 async function loadNativeCalendars(){const b=binding.current;if(!b||busy)return;setBusy(true);try{const permission=await nativeCalendars.requestWorkflowReadAccess();if(permission.status!=='granted')throw Error('Calendar permission was not granted.');const result=await nativeCalendars.workflowCalendars();if(binding.current!==b)return;if(result.status!=='ready')throw Error('Calendar sources unavailable.');setCalendarChoices(result.calendars);if(digestMissingCalendars(selectedCalendars,result.calendars).length){setSelectedCalendars(ids=>ids.filter(id=>result.calendars.some(c=>c.id===id)));setMessage('Some selected calendars are no longer available. Choose again.');}}catch(error){if(binding.current===b)setMessage((error as Error).message);}finally{setBusy(false);}}
 async function reviewNativeSource(){try{await prepareNativeSource();}catch{if(mounted.current)setMessage('Couldn’t review');}}
 async function prepareNativeSource(){
  const b=binding.current;if(!b||busy)return;
  if(digestMissingCalendars(selectedCalendars,calendarChoices).length){setMessage('Some selected calendars are no longer available. Choose again.');return;}
  if(!nativeLabel.trim()){setMessage('Name this source selection before reviewing it.');return;}
  if(selectedCalendars.length>16){setMessage('Choose at most 16 calendars for this source.');return;}
  if(!selectedCalendars.length&&!selectedReminders){setMessage('Select a calendar or reminders first.');return;}
  try{new Intl.DateTimeFormat('en',{timeZone:zone}).format(0);if(!Number.isInteger(hours)||hours<1||hours>DIGEST_SOURCE_MAX_HOURS)throw Error();}catch{setMessage('Choose a valid time zone and expiry from 1 to 168 hours (7 days).');return;}
  let expectedBinding:Record<string,unknown>;try{expectedBinding=await nativeSources.nativeSourceIdentity({sessionId:b.sessionId});if(binding.current!==b)return;}catch{setMessage('Reconnect your agent, then try again.');return;}
  // One clock reading: the agent refuses an expiry later than observedAt + 7 days, so a 168-hour source must not drift past it.
  const sourceId=crypto.randomUUID(),reviewedAt=Date.now(),observedAt=new Date(reviewedAt).toISOString(),expiresAt=reviewedAt+hours*3600000;
  const scope={calendars:selectedCalendars.map(id=>({id,revision:calendarChoices.find(calendar=>calendar.id===id)!.sourceRevision})),reminders:selectedReminders,timeZone:zone,window:'owner_day_and_overdue_reminders',maximumItems:200,modelEgress:true};
  const renews=renewing&&sources.find(s=>s.id===renewing)?.live?.provider==='native'?renewing:null,rebind=renewalLoops(renews);
  setReview({path:'sources',body:{id:sourceId,kind:'tasks',label:nativeLabel.trim(),observedAt,expiresAt:new Date(expiresAt).toISOString(),confirmed:true},nativeConsent:{sourceId,scope,expiresAt,expectedBinding},...(renews?{renews,rebind}:{}),summary:`Allow ${connection.name||'your on-device agent'} to read the selected sources on this phone until ${formatDateTime(new Date(expiresAt))}?\nCalendars: ${calendarChoices.filter(c=>selectedCalendars.includes(c.id)).map(c=>c.name+' ('+c.account+')').join(', ')||'none'}. Reminders: ${selectedReminders?'open reminders due today and overdue'+(features.nativeEvening?'; evening briefs also list reminders completed today':''):'excluded'}.\nIt reads only event titles and times for the day in ${zone}, plus selected reminders’ titles, due times and status, up to 200 items. Descriptions, attendees, locations and reminder bodies are excluded.\nYour agent’s AI gets that data, also while Alpha is in the background or the phone is locked. Each schedule is a separate review. ${features.sourcePause?'Schedules pause when this source expires':'Schedules can no longer read it after it expires'}; renew or revoke it here. Briefs are saved in your agent’s history. It can’t send email, read your inbox or act on your phone. ${billing}${renewalNote(renews)}`});
 }
	function schedule(template: DigestTemplate, enabled = true) {
		const old = loops.find((l) => !l.removed && l.spec.template === template);
		// Pause keeps the saved schedule exactly; only enabled changes.
		if (!enabled) {
			if (!old) return;
			setReview({
				path: "loops",
				body: { spec: digestToggledSpec(old.spec, false), mutationId: crypto.randomUUID(), confirmed: true, id: old.id, expectedVersionId: old.versionId },
				summary: `Pause ${template} digest?`,
			});
			return;
		}
		try {
			new Intl.DateTimeFormat("en", { timeZone: zone }).format(0);
		} catch {
			setMessage("Enter a valid time zone.");
			return;
		}
		if (
			!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(
				template === "morning" ? morning : evening,
			)
		) {
			setMessage("Choose a valid local time.");
			return;
		}
		const source = sources.find((s) => s.id === (sourceId || old?.spec.sourceId));
		if (!source) {
			setMessage("Choose a reviewed source first.");
			return;
		}
		if (template === "evening" && source.live?.provider === "native" && !features.nativeEvening) {
			setMessage("Not for phone sources");
			return;
		}
		if (source.revoked || Date.parse(source.expiresAt) <= Date.now()) {
			setMessage("Choose a current, unrevoked source.");
			return;
		}
		const spec = {
			version: 1,
			template,
			sourceId: source.id,
			sourceRevision: source.revision,
			timeZone: zone,
			localTime: template === "morning" ? morning : evening,
			enabled,
		};
		setReview({
			path: "loops",
			body: {
				spec,
				mutationId: crypto.randomUUID(),
				confirmed: true,
				...(old ? { id: old.id, expectedVersionId: old.versionId } : {}),
			},
			summary: `Turn on ${template} digest at ${spec.localTime}?\nSends ${source.label} to agent AI`,
		});
	}
	const liveBinding = binding.current;
    const now=Date.now(),renewals=digestRenewals(sources,loops,now);
    // Read at render: travel or a changed system setting moves the device zone, never a reviewed schedule.
    const deviceZone=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone;}catch{return '';}})();
	if (!open || (binding.current && binding.current.sessionId!==connection.session?.sessionId)) return null;
	return (
		<div className="alpha-connection-scrim">
			<section
				ref={panel}
				tabIndex={-1}
				className="alpha-connection"
				role="dialog"
				aria-modal="true"
				aria-labelledby="digest-title"
			>
				<header>
					<span className="alpha-connection-logo alpha-compute-mark" aria-label="Alpha Compute"/>
					<button aria-label="Refresh" disabled={busy} onClick={() => void refresh()} style={{marginLeft:'auto'}}>
						<span aria-hidden="true" style={iconStyle("rotate-cw")}/>
					</button>
					<button
						aria-label="Close scheduled digests"
						onClick={() => setOpen(false)}
					>
						<span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/>
					</button>
				</header>
				<h1><span id="digest-title">Scheduled digests</span>{connection.kind==='resident'&&isAndroid&&<span role="img" aria-label="Runs on this phone" style={{...iconStyle("phone"),width:'20px',height:'20px',marginLeft:8,verticalAlign:'middle'}}/>}</h1>
                {liveBinding?.recover&&<button onClick={()=>{setOpen(false);liveBinding.recover?.();}}>Digest inbox recovery</button>}
				<p role="status">{message==='Synced with this agent.'?<><span aria-hidden="true" style={{...iconStyle("circle-check"),width:'18px',height:'18px',color:'#1a7f37',verticalAlign:'middle'}}/><span style={srOnly}>{message}</span></>:<>{(message==='Offline'||message==='Waiting')&&<span aria-hidden="true" style={dot(message==='Offline'?'#8a8a8a':'#b26a00')}/>}{message}</>}</p>
                <ul style={{listStyle:'none',padding:0,margin:'8px 0'}}>
                {!isAndroid&&<li><label style={switchRow}><span>Result checks</span><input type="checkbox" role="switch" aria-label="Result checks" checked={backgroundEnabled} onChange={()=>void hostedResultNative.setBackgroundPolling({enabled:!backgroundEnabled}).then(value=>setBackgroundEnabled(value.backgroundEnabled===true)).catch(()=>setMessage('Not saved'))} style={switchInput}/></label></li>}
                {isAndroid&&nativeReady&&<li><label style={switchRow}><span>Background checks</span><input type="checkbox" role="switch" aria-label="Background checks" checked={backgroundEnabled} onChange={()=>void hostedResultNative.setBackgroundPolling({enabled:!backgroundEnabled}).then(value=>setBackgroundEnabled(value.backgroundEnabled===true)).catch(()=>setMessage('Not saved'))} style={switchInput}/></label></li>}
                {isAndroid&&!nativeReady&&<li style={switchRow}><span>Background checks</span><span><span aria-hidden="true" style={dot('#8a8a8a')}/>Background off</span></li>}
                {!isAndroid&&<li><label style={switchRow}><span><span aria-hidden="true" style={{...iconStyle("bell"),width:'18px',height:'18px',marginRight:6,verticalAlign:'middle'}}/>Notifications</span><input type="checkbox" role="switch" aria-label="Notifications" checked={noticeEnabled} onChange={()=>void browserHostedResults.setNotifications({enabled:!noticeEnabled}).catch(()=>setMessage('Not saved'))} style={switchInput}/></label></li>}
                {isAndroid&&nativeReady&&<li style={switchRow}><span><span aria-hidden="true" style={{...iconStyle("bell"),width:'18px',height:'18px',marginRight:6,verticalAlign:'middle'}}/>Notifications <span aria-hidden="true" style={{...dot(noticeEnabled?'#1a7f37':'#8a8a8a'),marginLeft:6}}/>{noticeEnabled?'Allowed':'Off'}</span><button aria-label="Notification settings" onClick={()=>void hostedResultNative.enable().then(()=>hostedResultNative.status()).then(value=>setNoticeEnabled(value.enabled)).catch(()=>setMessage('Allow in Android'))}><span aria-hidden="true" style={iconStyle("external-link")}/></button></li>}
                </ul>
                {renewals.length>0&&<section aria-label="Source renewal">
                    <h2>Source renewal</h2>
                    {renewals.map(r=><p key={r.source.id} style={{display:'flex',alignItems:'center',flexWrap:'wrap',gap:8}}>
                        <span>{r.source.label}</span>{' '}<span style={{...chip,background:r.state==='expiring'?'#fff1d6':'#fde2e2',color:r.state==='expiring'?'#7a4a00':'#8a1c1c'}}>{r.state==='expiring'?`expires ${formatDateTime(new Date(r.source.expiresAt))}`:r.state}</span>
                        {!r.source.revoked&&<button aria-label={`Renew ${r.source.label}`} disabled={busy||!!pending} onClick={()=>startRenewal(r.source.id)}>Renew</button>}
                        {renewing===r.source.id&&<span role="status"><span className="alpha-spinner" aria-hidden="true" style={{display:'inline-block',width:16,height:16,borderWidth:2,verticalAlign:'middle'}}/><span style={srOnly}>Renewing</span></span>}
                    </p>)}
                </section>}
                {loops.some(l=>!l.removed)&&<section aria-label="Digest schedules"><h2>Schedules</h2><ul>{loops.filter(l=>!l.removed).map(l=><li key={l.id}><strong>{l.spec.template==='evening'?'Evening':'Morning'}</strong> at {l.spec.localTime} ({l.spec.timeZone}) · <span style={chip}>{sources.find(s=>s.id===l.spec.sourceId)?.label??'Unknown source'}</span> · {digestLoopState(l,sources,now,features.sourcePause)}{deviceZone&&digestZoneNote(l,deviceZone,now)?<><br/><span>{digestZoneNote(l,deviceZone,now)}</span></>:null}</li>)}</ul></section>}
				{pending ? (
					<section>
						<h2><span aria-hidden="true" style={dot('#b26a00')}/>Not saved</h2>
						<p>{pending.summary}</p>
						<button disabled={busy} onClick={() => void submit(pending)}>
							Retry
						</button>
						{digestPendingDiscardable(pending) && <button disabled={busy} onClick={() => void discardPending()}>Discard</button>}
					</section>
				) : review ? (
					<section id="hosted-digest-review" tabIndex={-1}>
						<h2>Review</h2>
						<p style={{ whiteSpace: "pre-wrap" }}>{review.summary}</p>
						{(review.path==='loops'||review.path==='dossier')&&<p><span aria-hidden="true" style={{...iconStyle("info"),width:'16px',height:'16px',marginRight:6,verticalAlign:'middle'}}/>{billing}</p>}
						<button disabled={busy} onClick={() => void submit(review)}>
							Confirm
						</button>
						<button disabled={busy} onClick={() => setReview(null)}>
							Cancel
						</button>
					</section>
				) : (
					available && (
						<>
							{isAndroid&&connection.kind==='resident'&&nativeReady&&nativeSourceProtocol&&<details open={nativeOpen} onToggle={e=>setNativeOpen((e.currentTarget as HTMLDetailsElement).open)}><summary>Selected phone sources</summary><label>Source name<input maxLength={200} value={nativeLabel} onChange={e=>setNativeLabel(e.target.value)}/></label><button disabled={busy} onClick={()=>void loadNativeCalendars()}>Choose calendars</button>{calendarChoices.map(c=><label key={c.id}><input type="checkbox" checked={selectedCalendars.includes(c.id)} onChange={e=>setSelectedCalendars(ids=>e.target.checked?[...ids,c.id]:ids.filter(id=>id!==c.id))}/>{c.name} · {c.account}</label>)}<label><input type="checkbox" aria-label="Open phone reminders due today and overdue" checked={selectedReminders} onChange={e=>setSelectedReminders(e.target.checked)}/>Reminders</label><label>Expires (h)<input type="number" aria-label="Consent expires in hours" min={1} max={DIGEST_SOURCE_MAX_HOURS} value={hours} onChange={e=>setHours(Number(e.target.value))}/></label><button disabled={busy} onClick={()=>void reviewNativeSource()}>{renewing&&sources.find(s=>s.id===renewing)?.live?.provider==='native'?'Review renewal':'Review'}</button></details>}
                            {liveBinding && <HostedLiveSourcePicker key={liveBinding.sessionId} client={liveBinding.client} scope={liveBinding.notices.scope} signal={liveBinding.controller.signal} current={() => binding.current === liveBinding} busy={busy} review={value=>{const renews=renewing&&sources.find(s=>s.id===renewing)?.live?.provider==='google'?renewing:null;setReview(renews?{...value,renews,rebind:renewalLoops(renews),summary:value.summary+renewalNote(renews)}:value);}} />}
							<details open={snapshotOpen} onToggle={e=>setSnapshotOpen((e.currentTarget as HTMLDetailsElement).open)}>
								<summary>Share a snapshot</summary>
								<label>
									Source type
									<select
										value={kind}
										onChange={(e) => setKind(e.target.value)}
									>
										{["tasks", "calendar", "email", "notes"].map((v) => (
											<option key={v}>{v}</option>
										))}
									</select>
								</label>
								<label>
									Label
									<input
										maxLength={200}
										value={label}
										onChange={(e) => setLabel(e.target.value)}
									/>
								</label>
								<label>
									Snapshot text
									<textarea
										rows={5}
										maxLength={12000}
										value={text}
										onChange={(e) => setText(e.target.value)}
										style={{
											font: "inherit",
											width: "100%",
											boxSizing: "border-box",
										}}
									/>
								</label>
								<label>
									Expires (h)
									<input
										aria-label="Expires after hours"
										type="number"
										min={1}
										max={168}
										value={hours}
										onChange={(e) => setHours(Number(e.target.value))}
									/>
								</label>
								<button
									disabled={
										!text.trim() ||
										!label.trim() ||
										!Number.isFinite(hours) ||
										hours < 1 ||
										hours > 168 ||
										JSON.stringify({ text, label }).length > 14000 ||
										busy
									}
									onClick={() => {
										// One clock reading keeps a 168-hour expiry within the agent's observedAt + 7 days bound.
										const reviewedAt = Date.now(),
											observedAt = new Date(reviewedAt).toISOString(),
											expiresAt = new Date(
												reviewedAt + hours * 3600000,
											).toISOString();
										const renews=renewing&&!sources.find(s=>s.id===renewing)?.live?renewing:null;
										setReview({
											path: "sources",
											body: {
												id: crypto.randomUUID(),
												kind,
												label,
												text,
												observedAt,
												expiresAt,
												confirmed: true,
											},
											...(renews?{renews,rebind:renewalLoops(renews)}:{}),
											summary: `Share this ${kind} snapshot with the connected agent. Expires ${expiresAt}.${renewalNote(renews)}\n\n${label}\n${text}`,
										});
									}}
								>
									Review snapshot
								</button>
							</details>
							<label>
								Reviewed source
								<select
									value={sourceId}
									onChange={(e) => setSourceId(e.target.value)}
								>
									<option value="">Choose source</option>
									{sources
										.filter((s) => !s.revoked)
										.map((s) => (
											<option value={s.id} key={s.id}>
												{s.label} · expires{" "}
												{formatDateTime(new Date(s.expiresAt))}
											</option>
										))}
								</select>
							</label>
{features.dossier&&sources.find(s=>s.id===sourceId)?.live?.provider==='native'&&<button disabled={busy} onClick={()=>{const source=sources.find(s=>s.id===sourceId)!;setReview({path:'dossier',body:{sourceId:source.id,sourceRevision:source.revision,mutationId:crypto.randomUUID(),confirmed:true},summary:`Prepare a brief now from ${source.label}? This sends one read of these sources to your agent’s AI. It creates no schedule. It can’t send email or act on your phone. ${billing}`});}}>Review on-demand brief</button>}
							<label>
								Time zone
								<input value={zone} onChange={(e) => setZone(e.target.value)} />
							</label>
							<label>
								Morning
								<input
									type="time"
									value={morning}
									onChange={(e) => setMorning(e.target.value)}
								/>
							</label>
{(features.nativeEvening||sources.find(source=>source.id===sourceId)?.live?.provider!=='native')&&							<label>
								Evening
								<input
									type="time"
									value={evening}
									onChange={(e) => setEvening(e.target.value)}
								/>
							</label>}
							<p>
								Missed times don’t run later. Only these digests run on a schedule.
							</p>
							{(["morning", "evening"] as const).filter(t=>t==='morning'||features.nativeEvening||sources.find(source=>source.id===sourceId)?.live?.provider!=='native').map((t) => (
								<div key={t}>
									<button disabled={busy} onClick={() => schedule(t)}>
										Review {t} schedule
									</button>
									{loops.some(
										(l) => !l.removed && l.spec.template === t && l.active,
									) && (
										<button disabled={busy} onClick={() => schedule(t, false)}>
											Pause
										</button>
									)}
								</div>
							))}
							{sources
								.filter((s) => !s.revoked)
								.map((s) => (
									<div key={s.id}>
										<span>{s.label}</span>
										<button
											disabled={busy}
											onClick={() =>
												setReview({
													path: "sources/revoke",
													body: { id: s.id, confirmed: true },
													summary: `Revoke ${s.label}?`,
												})
											}
										>
											Revoke
										</button>
									</div>
								))}
						</>
					)
				)}
				<h2>Results</h2>
				<p>
					{binding.current?.sessionId===connection.session?.sessionId&&results.length ? 'Your latest 100 results are kept here.' : 'No results yet.'}
				</p>
				{(binding.current?.sessionId===connection.session?.sessionId ? results : [])
					.slice()
					.reverse()
					.map((result) => (
						<article className="alpha-connection-agent" key={result.runId} id={"hosted-result-"+result.runId} tabIndex={-1} style={focusedRun===result.runId?{outline:'2px solid var(--connection-acc,#0000ff)',outlineOffset:2}:undefined}>
                            {focusedRun===result.runId&&<span style={srOnly}>Opened from notification</span>}
							<strong>
								{formatDateTime(new Date(result.scheduledAt))} ·{" "}
								{digestStatusLabel(result.status)}
							</strong>
							<span>
								<span role="img" aria-label={result.source.type==='live_selected_native_read'?'Phone sources read':result.source.type==='live_selected_google_read'?'Connected sources read':'Snapshot observed'} style={{...iconStyle(result.source.type==='live_selected_native_read'?'phone':result.source.type==='live_selected_google_read'?'mail':'list-checks'),width:'16px',height:'16px',marginRight:6,verticalAlign:'middle'}}/>{formatDateTime(new Date(String(result.source.observedAt)))}{" · "}
								<span role="img" aria-label={result.source.type==='live_selected_native_read'?'permission expires':'expires'} style={{...iconStyle('clock'),width:'16px',height:'16px',marginRight:6,verticalAlign:'middle'}}/>{formatDateTime(new Date(String(result.source.expiresAt)))}
							</span>
							<pre
								style={{
									whiteSpace: "pre-wrap",
									overflowWrap: "anywhere",
									font: "inherit",
									width: "100%",
								}}
							>
								{digestSummaryText(result)}
							</pre>
                            {/* A readable run summary; the raw agent output is a developer surface, never product UI. */}
                            {digestRan(result)&&result.source.type!=='live_selected_native_read'&&<details><summary aria-label="Execution details"><span aria-hidden="true" style={{...iconStyle('info'),width:'18px',height:'18px',verticalAlign:'middle'}}/></summary><p>Started {formatDateTime(new Date(result.startedAt))}. Finished {formatDateTime(new Date(result.completedAt))}.</p>{devSurfacesEnabled&&<pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',font:'inherit',width:'100%'}}>{JSON.stringify(result.output,null,2)}</pre>}</details>}
                            {missedOffers.has(result.runId)&&!ranMissed.has(result.runId)&&<button disabled={busy||!!pending||!!review} aria-label="Review Run now for this missed digest" onClick={()=>reviewMissedRunNow(missedOffers.get(result.runId)!)}>Run now</button>}
						</article>
					))}
			</section>
		</div>
	);
}
