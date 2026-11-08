/** Navigation-only use of the shared completed-action and renderer-claim contracts. */

import {
	NAVIGATE_VIEW_EVENT,
	type NavigateViewDetail,
} from "../../../../.eliza/client-features/packages/core/src/events.ts";
import { createCompletedActionNavigationState } from "../../../../.eliza/client-features/packages/core/src/views/completed-action-navigation.ts";
import { findViewActionHandoff } from "../../../../.eliza/client-features/packages/core/src/views/view-action-handoff.ts";
import { alphaCanonicalViewId, alphaViewKey, alphaViewPaths } from "../product/alpha-product";
import { AlphaClientError, type ContextEnvelope } from "./alpha-client";

type Request = (
	path: string,
	body: unknown,
	signal: AbortSignal,
) => Promise<unknown>;
export type NavigationAttempt = {
	controller: AbortController;
	current: () => void;
	fence: () => boolean;
};
const object = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw Error("Navigation reply was not verified");
	return value as Record<string, unknown>;
};
export class ViewNavigationClient {
	readonly clientId = crypto.randomUUID();
	private disposed = false;
	private attempt?: NavigationAttempt;
	private readonly deliveredContexts = new WeakMap<AbortController, ContextEnvelope>();
	private readonly state;
  private renderer?:{ready:Promise<void>;close:()=>void};
  private rendererGeneration=0;
  private rendererReady=false;
  private readonly rendererVisibility=()=>{if(document.hidden)this.retireRenderer();else this.connectRenderer();};
  private readonly interactions=new Set<string>();
  private readonly executing=new Set<AbortController>();
  private observationView?: string;
  private observationAccepted = false;
  private observation?: {view: string; controller: AbortController; ready: Promise<boolean>};
  private delivering = false;
	constructor(
		private readonly request: Request,
		private readonly currentSession: () => boolean,
		private readonly context: () => ContextEnvelope | null,
    private readonly subscribe?: (clientId:string,listener:(frame:unknown)=>void,ended:()=>void)=>{ready:Promise<void>;close:()=>void},
    private readonly executeView?: (view:string,capability:string,params:unknown,signal:AbortSignal,current:()=>void)=>Promise<unknown>,
	) {
    if(subscribe){document.addEventListener?.('visibilitychange',this.rendererVisibility);this.connectRenderer();}
		this.state = createCompletedActionNavigationState(() =>
			JSON.stringify(this.context()),
		);
	}
	metadata(context: ContextEnvelope) {
		return !context.sensitive && this.currentSession() && !this.disposed
			? {
					viewClientId: this.clientId,
					viewDelivery: "completed-action",
					uiView: alphaCanonicalViewId(context.view),
				}
			: {};
	}
  /** Record an already committed manual screen through the same owner-bound
   * prepare/claim/ack protocol as agent navigation. No second history is kept.
   * Cost: three requests per changed visible view; same-view updates reuse the result. */
  observeCommittedView(retryAfterFailure = false): Promise<boolean> {
    const context = this.context();
    if (this.disposed || !this.currentSession() || document.hidden || !context || context.sensitive) {
      this.observation?.controller.abort();
      this.observation = undefined;
      return Promise.resolve(false);
    }
    if (this.delivering) return Promise.resolve(false);
    if (this.observation?.view === context.view) return this.observation.ready;
    if (this.observationView === context.view && (!retryAfterFailure || this.observationAccepted)) return Promise.resolve(this.observationAccepted);
    this.observation?.controller.abort();
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 5000);
    this.observationView = context.view;
    this.observationAccepted = false;
    const viewId = context.view === 'home' ? 'chat' : context.view === 'workflows' ? 'automations' : context.view;
    const current = () => {
      controller.signal.throwIfAborted();
      const now = this.context();
      if (this.disposed || !this.currentSession() || document.hidden || now?.sensitive || now?.view !== context.view || this.delivering)
        throw Error('Committed navigation observation changed');
    };
    const ready = (async () => {
      let binding: Record<string, unknown> | undefined;
      let claimId: string | undefined;
      let claimAttempted = false;
      let positiveDispatched = false;
      try {
        current();
        const prepared = object(await this.request(`/api/views/${encodeURIComponent(viewId)}/navigate`, {
          clientId: this.clientId, delivery: 'completed-action', prepareOnly: true,
          viewType: 'gui', completedActionHandoffId: crypto.randomUUID(),
        }, controller.signal));
        const preparedBinding = object(prepared.navigationBinding);
        if (preparedBinding.clientId !== this.clientId || preparedBinding.viewId !== viewId || preparedBinding.viewType !== 'gui' || typeof preparedBinding.requestId !== 'string' || !preparedBinding.requestId || typeof preparedBinding.installationId !== 'string' || !preparedBinding.installationId)
          throw Error('Committed navigation binding changed');
        binding = preparedBinding;
        current();
        claimAttempted = true;
        const claimed = object(await this.request('/api/views/interact-claim', binding, controller.signal));
        if (typeof claimed.claimId !== 'string' || !claimed.claimId) throw Error('Committed navigation claim missing');
        claimId = claimed.claimId;
        current();
        positiveDispatched = true;
        const accepted = object(await this.request('/api/views/interact-result', {
          ...binding, claimId, success: true, result: {switched: true},
        }, controller.signal));
        current();
        if (accepted.accepted !== true) return false;
        this.observationAccepted = true;
        return true;
      } catch {
        // Only the original owner/session/runtime may retire its prepared waiter.
        // An ambiguous claim or dispatched positive acknowledgment is never retried.
        if (binding && !positiveDispatched && (!claimAttempted || claimId) && this.currentSession()) {
          const cleanup = new AbortController();
          const cleanupDeadline = setTimeout(() => cleanup.abort(), 1500);
          try {
            if (!claimId) {
              const claimed = object(await this.request('/api/views/interact-claim', binding, cleanup.signal));
              if (typeof claimed.claimId !== 'string' || !claimed.claimId) return false;
              claimId = claimed.claimId;
            }
            if (this.currentSession()) {
              await this.request('/api/views/interact-result', {
                ...binding, claimId, success: false, result: {switched: false},
              }, cleanup.signal);
            }
          } catch {
            // A rejected or lost cleanup stays unknown; never replay the request.
            return false;
          } finally {
            clearTimeout(cleanupDeadline);
          }
        }
        return false;
      } finally {
        clearTimeout(deadline);
        if (this.observation?.controller === controller) this.observation = undefined;
      }
    })();
    this.observation = {view: context.view, controller, ready};
    return ready;
  }
	capture(context: ContextEnvelope): NavigationAttempt {
		this.cancel();
		const expected = JSON.stringify(context),
			controller = new AbortController();
		const current = () => {
			controller.signal.throwIfAborted();
			if (
				this.disposed ||
				!this.currentSession() ||
				JSON.stringify(this.context()) !== expected ||
				context.sensitive ||
				document.hidden
			)
				throw new AlphaClientError(
					"stale",
					"Navigation cancelled because the screen or connection changed.",
				);
		};
		const attempt = {
			controller,
			current,
			fence: this.state.captureCompletedActionNavigationFence(),
		};
		this.attempt = attempt;
		return attempt;
	}
	currentAttempt(context: ContextEnvelope): NavigationAttempt | undefined {
		if (JSON.stringify(this.context()) !== JSON.stringify(context)) return;
		try { this.attempt?.current(); return this.attempt; } catch { return; }
	}
	deliveredContext(attempt: NavigationAttempt): ContextEnvelope | undefined {
		const context = this.deliveredContexts.get(attempt.controller);
		return context ? structuredClone(context) : undefined;
	}
	cancel() {
		this.attempt?.controller.abort();
		this.attempt = undefined;
	}
	dispose() {
		this.disposed = true;
    this.observation?.controller.abort();
		this.cancel();
		this.state.dispose();
    document.removeEventListener?.('visibilitychange',this.rendererVisibility);this.retireRenderer();
	}
  /** Optional command delivery never gates ordinary chat or completed-action navigation.
   * Cost: at most one empty subscription on connection use/foreground resume; no timer or replay. */
  connectRenderer(){
    if(!this.subscribe||this.renderer||this.disposed||!this.currentSession()||document.hidden)return;
    const generation=++this.rendererGeneration;
    const current=()=>generation===this.rendererGeneration&&!this.disposed&&this.currentSession()&&!document.hidden;
    const end=()=>{if(generation===this.rendererGeneration)this.retireRenderer();};
    try{
      const channel=this.subscribe(this.clientId,frame=>{if(current())void this.receiveInteraction(frame);},end);
      if(!current()){channel.close();return;}
      this.renderer=channel;
      void channel.ready.then(()=>{if(current())this.rendererReady=true;else end();},end);
    }catch{end();}
  }
  private retireRenderer(){
    ++this.rendererGeneration;this.rendererReady=false;
    const channel=this.renderer;this.renderer=undefined;
    for(const controller of this.executing)controller.abort();
    channel?.close();
  }
  interactionAvailable(){return this.rendererReady&&!this.disposed&&this.currentSession()&&!document.hidden;}
  async ready(){await this.renderer?.ready;}
  private async receiveInteraction(value:unknown){
    if(!this.executeView||this.disposed||!this.currentSession()||document.hidden||!value||typeof value!=='object'||Array.isArray(value))return;
    const frame=value as Record<string,any>,context=this.context();
    if(frame.type!=='view:interact'||frame.viewType!=='gui'||!context||frame.viewId!==context.view||context.sensitive||typeof frame.requestId!=='string'||typeof frame.installationId!=='string'||typeof frame.capability!=='string'||this.interactions.has(frame.requestId))return;
    this.interactions.add(frame.requestId);
    const controller=new AbortController();this.executing.add(controller);let claimId:string|undefined;
    const deadline=setTimeout(()=>controller.abort(),4500);
    const current=()=>{controller.signal.throwIfAborted();if(this.disposed||!this.currentSession()||document.hidden||JSON.stringify(this.context())!==JSON.stringify(context))throw Error('Renderer view or owner changed');};
    const identity={requestId:frame.requestId,clientId:this.clientId,viewId:frame.viewId,viewType:frame.viewType,installationId:frame.installationId};
    let success=false,result:unknown,error:string|undefined;
    try{
      current();const claim=object(await this.request('/api/views/interact-claim',identity,controller.signal));
      if(typeof claim.claimId!=='string')return;claimId=claim.claimId;current();
      result=await this.executeView(frame.viewId,frame.capability,frame.params,controller.signal,current);success=true;
    }catch{error='Native view command failed or its outcome is unknown; it was not repeated';}
    finally{
      if(claimId&&!this.disposed&&this.currentSession()&&!controller.signal.aborted){
        try{await this.request('/api/views/interact-result',{...identity,claimId,success,...(success?{result}:{error})},controller.signal);}catch{/* Lost acknowledgment is unknown; never replay an effect. */}
      }
      clearTimeout(deadline);this.executing.delete(controller);this.interactions.delete(frame.requestId);
    }
  }
	async deliver(
		results: readonly unknown[] | undefined,
		attempt: NavigationAttempt,
		navigate: (view: string, current: () => void) => Promise<boolean>,
	): Promise<{ status: "none" | "delivered" | "unknown"; label?: string }> {
		const views = results?.filter(
			(result) => findViewActionHandoff([result])?.navigationPrepared === true,
		);
		const handoff = findViewActionHandoff(views);
		if (!handoff?.navigationPrepared || !handoff.navigationBinding)
			return { status: "none" };
		// The product view registry resolves canonical, served and older ids and applies the
		// install's view availability; an unavailable view is refused before any claim.
		const binding = handoff.navigationBinding,
			target = alphaViewKey(handoff.viewId);
		if (
			binding.clientId !== this.clientId ||
			handoff.subview ||
			!target ||
			(handoff.viewPath &&
				!alphaViewPaths(handoff.viewId).includes(handoff.viewPath))
		)
			throw new AlphaClientError(
				"proposal-unavailable",
				"That screen is not available.",
			);
		const selected = views
				?.slice()
				.reverse()
				.find(
					(result) =>
						object(object(result).values).completedActionHandoffId ===
						binding.requestId,
				),
			values = object(object(selected).values);
		if (
			Object.keys(values).some(
				(key) =>
					![
						"mode",
						"viewId",
						"viewPath",
						"viewType",
						"label",
						"completedActionDelivered",
						"completedActionHandoffId",
						"navigationPrepared",
						"navigationBinding",
					].includes(key),
			)
		)
			throw Error("Navigation does not accept record parameters");
		attempt.current();
		if (!attempt.fence())
			throw new AlphaClientError(
				"stale",
				"Navigation cancelled because the screen changed.",
			);
		const claimed = object(
			await this.request(
				"/api/views/interact-claim",
				binding,
				attempt.controller.signal,
			),
		);
		if (typeof claimed.claimId !== "string" || !claimed.claimId)
			throw Error("Navigation claim was not verified");
		attempt.current();
		if (!attempt.fence())
			throw new AlphaClientError(
				"stale",
				"Navigation cancelled because the screen changed.",
			);
    this.delivering = true;
    try {
		let switched = false;
    this.observation?.controller.abort();
		const received = (event: Event) => {
			const detail = (event as CustomEvent<NavigateViewDetail>).detail;
			if (detail?.completedActionHandoffId !== binding.requestId) return;
			this.state.markCompletedActionNavigationHandled(event, detail);
		};
		window.addEventListener(NAVIGATE_VIEW_EVENT, received);
		try {
			if (
				!this.state.dispatchCompletedActionNavigation({
					viewId: handoff.viewId,
					source: "agent",
					completedActionHandoffId: binding.requestId,
				})
			)
				return { status: "none" };
			// The existing shell executor waits for its React commit, not just setState dispatch.
			switched = await navigate(target, attempt.current);
		} catch {
			switched = false;
		} finally {
			window.removeEventListener(NAVIGATE_VIEW_EVENT, received);
		}
		// Our own view switch retires the chat context; it must not cancel its exact
		// post-effect acknowledgment. A connection/owner/epoch change still refuses it.
		if (
			this.disposed ||
			!this.currentSession() ||
			attempt.controller.signal.aborted
		) {

			return { status: "unknown" };
    }
		switched =
			switched &&
			this.context()?.view === target &&
			!this.context()?.sensitive &&
			!document.hidden;
		const accepted = object(
			await this.request(
				"/api/views/interact-result",
				{
					...binding,
					claimId: claimed.claimId,
					success: switched,
					result: { switched },
				},
				AbortSignal.timeout(5000),
			),
		);
		if (
			switched &&
			accepted.accepted === true &&
			!this.disposed &&
			this.currentSession() &&
			!attempt.controller.signal.aborted &&
			this.context()?.view === target &&
			!this.context()?.sensitive &&
			!document.hidden
		) {
			this.deliveredContexts.set(attempt.controller, structuredClone(this.context()!));
      this.observationView = target;
      this.observationAccepted = true;

			return {
				status: "delivered",
				label:
					target === "home"
						? "Home"
						: typeof values.label === "string"
							? values.label
							: target,
			};
		}
    return { status: "unknown" };
    } finally { this.delivering = false; }
	}
}
