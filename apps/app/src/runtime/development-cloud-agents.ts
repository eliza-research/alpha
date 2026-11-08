import {isPreparedViewNavigationRequest} from './prepared-view-navigation.ts';
import type {ChatChannel} from './alpha-client';
import type {AutomationsMethod} from './automations-route-policy.ts';
import {ownerRouteAllowed, ownerRouteGroup} from './owner-route-policy.ts';
import { CloudPersonalProtocol, PersonalProtocolError } from './cloud-personal-protocol.ts';
import { CloudProtocol, CloudProtocolError, object, optionalString, string, uuid, type CloudAgent } from './cloud-protocol.ts';

/**
 * DEVELOPMENT INFRASTRUCTURE ONLY. Not a product path.
 *
 * The agent always runs on the phone (owner directive 2026-10-13; issues #406 and #415). Hosted Eliza
 * Cloud agents (discovery, the personal/Dedicated setup, runtime conversations and the phone
 * device-action protocol on a hosted runtime) are kept only as development fixtures for
 * ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds. connection-ui constructs this class only behind that flag, so
 * a flag-off bundle carries none of it (scripts/audit-production-bundle.mjs denies its markers), and
 * the production CloudProtocol has no agent routes. Native transport refuses these hosts and routes
 * in product builds independently (ConnectionRoutes.java).
 */
export interface CloudPhoneTarget {
  agentId: string; origin: string; userId: string; organizationId: string;
  credentialId: string; headers: Record<string,string>;
}
export class DevelopmentCloudAgentProtocol extends CloudProtocol {
  private phoneTarget: CloudPhoneTarget | null = null;
  setPhoneTarget(target: CloudPhoneTarget | null) { this.phoneTarget = target; }
  async phoneRequest(target: CloudPhoneTarget, path: string, signal: AbortSignal, body?: unknown, method: AutomationsMethod = body === undefined ? 'GET' : 'POST'): Promise<Record<string,unknown>> {
    signal.throwIfAborted();
    if (ownerRouteGroup(path, 'automations') ? !ownerRouteAllowed('automations', path, method) : !['GET','POST'].includes(method) || !(/^\/api\/(?:client-devices|workflow|conversations)(?:\/|\?|$)/.test(path)||/^\/api\/views\/interact-(claim|result)$/.test(path)||isPreparedViewNavigationRequest(path,body,method)) || path.includes('..') || /[\\#\s]/.test(path)) throw new Error('Invalid phone route');
    if ((method === 'GET' || method === 'DELETE') && body !== undefined) throw new Error('Invalid phone request body');
    const credential = await this.credentials.read(this.environment); signal.throwIfAborted();
    if (!credential || credential.credentialId !== target.credentialId) throw new Error('Cloud account changed');
    const identity = await this.identity(signal);
    if (identity.userId !== target.userId || identity.organizationId !== target.organizationId) throw new Error('Cloud owner changed');
    const agent = await this.agentDetail(target.agentId, signal);
    if (agent.runtimeUrl !== target.origin || !['dedicated-lazy','dedicated-always','custom'].includes(agent.executionTier || '')) throw new Error('Verified dedicated runtime unavailable');
    const result = await this.call(path, signal, {authenticated:true,runtimeBase:target.origin,body,method,timeoutMs:120000,headers:{...target.headers,'X-Eliza-Phone-Protocol':'1'},credentialId:target.credentialId});
    if ((await this.credentials.read(this.environment))?.credentialId !== target.credentialId) throw new Error('Cloud account changed');
    signal.throwIfAborted(); return result;
  }
  /** Scoped personal onboarding, using the existing native credential transport. */
  async personal(signal: AbortSignal): Promise<CloudPersonalProtocol> {
    const credential = await this.credentials.read(this.environment);
    if (!credential?.credentialId) throw new PersonalProtocolError('account-changed');
    const identity = await this.identity(signal);
    if (!identity.organizationId) throw new PersonalProtocolError('account-changed');
    const owner = Object.freeze({ environment:this.environment, credentialId:credential.credentialId,
      userId:identity.userId, organizationId:identity.organizationId });
    const assertCurrent = async () => {
      signal.throwIfAborted();
      const current = await this.credentials.read(this.environment);
      if (current?.credentialId !== owner.credentialId) throw new PersonalProtocolError('account-changed');
    };
    await assertCurrent();
    return new CloudPersonalProtocol(owner, async (path, requestSignal, body) => {
      await assertCurrent(); requestSignal.throwIfAborted();
      const currentOwner=await this.identity(requestSignal);
      await assertCurrent();
      if(currentOwner.userId!==owner.userId||currentOwner.organizationId!==owner.organizationId)throw new PersonalProtocolError('account-changed');
      let status=200;
      try {
        const data=await this.requestData(path,requestSignal,{authenticated:true,credentialId:owner.credentialId,body,onStatus:value=>{status=value;}});
        await assertCurrent(); requestSignal.throwIfAborted(); return {status,data};
      } catch(error) {
        await assertCurrent(); requestSignal.throwIfAborted();
        if(error instanceof CloudProtocolError && error.code==='http')return {status:error.status!,data:error.data};
        throw error;
      }
    }, async (target, requestSignal, expectedApiBase) => {
      await assertCurrent();
      const agent=await this.agentDetail(target,requestSignal);
      await assertCurrent();
      if(!['dedicated-lazy','dedicated-always','custom'].includes(agent.executionTier??'') ||
        (expectedApiBase!==undefined && (this.runtimeUrl(expectedApiBase,target,agent.executionTier)!==expectedApiBase || (agent.runtimeUrl!==null && agent.runtimeUrl!==expectedApiBase))) || (agent.status==='running'&&!agent.runtimeUrl)) throw new PersonalProtocolError('invalid-response');
      return agent.status;
    });
  }
  private runtimeUrl(value: unknown, id: string, tier: string | null): string | null {
    if (value == null) return tier === "shared" ? `${this.authority.api}/api/v1/eliza/agents/${id}` : null;
    let url: URL;
    try { url = new URL(string(value)); } catch { throw new CloudProtocolError("invalid-response"); }
    const sharedPath = `/api/v1/eliza/agents/${id}`;
    const dedicated = url.hostname === `${id}.${this.authority.agents}` && (url.pathname === "/" || url.pathname === "");
    const shared = url.origin === this.authority.api && url.pathname.replace(/\/$/, "") === sharedPath;
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || (!dedicated && !shared)) throw new CloudProtocolError("invalid-response");
    return url.href.replace(/\/$/, "");
  }
  private agent(value: unknown): CloudAgent {
    const data = object(value), id = uuid(data.id ?? data.agentId);
    const tier = optionalString(data.executionTier);
    return { id, name: optionalString(data.agentName), status: string(data.status), executionTier: tier,
      runtimeUrl: this.runtimeUrl(data.webUiUrl, id, tier) };
  }
  async listAgents(signal: AbortSignal): Promise<CloudAgent[]> {
    const data = this.success(await this.call("/api/v1/eliza/agents", signal, { authenticated: true }));
    if (!Array.isArray(data)) throw new CloudProtocolError("invalid-response");
    return data.map(value => this.agent(value));
  }
  async agentDetail(id: string, signal: AbortSignal): Promise<CloudAgent> {
    const agent = this.agent(this.success(await this.call(`/api/v1/eliza/agents/${uuid(id)}`, signal, { authenticated: true })));
    if (agent.id !== id) throw new CloudProtocolError("invalid-response");
    return agent;
  }
  private async runtimeCall(agentId: string, path: string, signal: AbortSignal, body?: unknown) {
    if (this.phoneTarget?.agentId === agentId) return this.phoneRequest(this.phoneTarget, path, signal, body);
    const agent = await this.agentDetail(agentId, signal);
    if (!agent.runtimeUrl) throw new CloudProtocolError("invalid-response");
    // Hosted shared REST lives on the API host. Dedicated REST lives on its
    // returned per-agent subdomain, whose proxy validates the same cloud token.
    return this.call(path, signal, { authenticated: true, runtimeBase: agent.runtimeUrl, body, timeoutMs: 120_000 });
  }
  async listConversations(agentId: string, signal: AbortSignal): Promise<Array<{ id: string; title?: string }>> {
    const response = await this.runtimeCall(agentId, "/api/conversations", signal);
    if (!Array.isArray(response.conversations)) throw new CloudProtocolError("invalid-response");
    return response.conversations.map(value => {
      const conversation = object(value);
      return { id: string(conversation.id), ...(typeof conversation.title === "string" ? { title: conversation.title } : {}) };
    });
  }
  async messages(agentId: string, conversationId: string, signal: AbortSignal): Promise<{ messages: Record<string, unknown>[] }> {
    const data = await this.runtimeCall(agentId, `/api/conversations/${encodeURIComponent(string(conversationId))}/messages`, signal);
    if (!Array.isArray(data.messages)) throw new CloudProtocolError("invalid-response");
    return { messages: data.messages.map(object) };
  }
  async createConversation(agentId: string, title: string, signal: AbortSignal): Promise<{ id: string; title?: string }> {
    const response = await this.runtimeCall(agentId, "/api/conversations", signal, { title });
    const conversation = object(response.conversation);
    return { id: string(conversation.id), ...(typeof conversation.title === "string" ? { title: conversation.title } : {}) };
  }
  /** Never replay a send automatically. Shared Cloud currently ignores metadata;
   * the dedicated host accepts it. Caller must not treat shared context as delivered. */
  async send(agentId: string, conversationId: string, text: string,
    options: { metadata?: Record<string, unknown>; clientMessageId?: string; channelType?:ChatChannel; signal: AbortSignal },
  ): Promise<{ text: string; agentName: string; messageId?:string;userMessageId?:string;actionResults?:readonly unknown[];interrupted?: boolean; noResponseReason?: "ignored"; failureKind?: unknown; terminalFailure?: unknown }> {
    if (!text.trim()) throw new TypeError("Message must not be empty");
    const response = await this.runtimeCall(agentId,
      `/api/conversations/${encodeURIComponent(string(conversationId))}/messages`, options.signal,
      { text, channelType: options.channelType ?? "DM", ...(options.metadata ? { metadata: options.metadata } : {}),
        ...(options.clientMessageId ? { clientMessageId: options.clientMessageId } : {}) });
    if (typeof response.text !== "string" || typeof response.agentName !== "string") throw new CloudProtocolError("invalid-response");
    if (response.terminalFailure || response.failureKind) throw new CloudProtocolError("invalid-response");
    for(const key of ['messageId','userMessageId'])if(response[key]!==undefined&&typeof response[key]!=='string')throw new CloudProtocolError('invalid-response');
    return { text: response.text, agentName: response.agentName,
      ...(typeof response.messageId==='string'?{messageId:response.messageId}:{}),
      ...(typeof response.userMessageId==='string'?{userMessageId:response.userMessageId}:{}),
      ...(Array.isArray(response.actionResults)?{actionResults:response.actionResults}:{}),
      ...(response.interrupted === true ? { interrupted: true } : {}),
      ...(response.noResponseReason === "ignored" ? { noResponseReason: "ignored" as const } : {}) };
  }
}
