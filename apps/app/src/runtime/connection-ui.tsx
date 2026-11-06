import {productionCloud, stagingCloud} from './cloud-deployment.generated.ts';
import {browserCloudResidentEnabled,browserCloudResidentEnvironment} from './browser-cloud-resident';
import {CAMERA_CAPTURE_CAPABILITY} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';
import {sanitizeCloudInferenceFailure,type CloudInferenceFailure} from './crash-log';
import {residentRecoveryReason,residentRecoveryMessage,RESIDENT_RECOVERY_PENDING,type ResidentRecoveryReason,type ResidentRecoveryView} from './resident-recovery';
import {anyAbortSignal} from './abort-signal';
import {CALENDAR_APPROVAL_READ_PATH,calendarApprovalFromList,calendarApprovalId} from './calendar-approval';
import {readDevicePreferences} from '../browser/device-preferences';
import {resolveCloudEnvironment} from './cloud-environment-selection';
import { withResidentMapsNavigation } from '../maps/resident-relay.ts';
import {aospImage} from './aosp-image';
import {SMS_SEND_CAPABILITY} from './sms-agent-contract';
import {automationsRouteAllowed, type AutomationsMethod} from './automations-route-policy.ts';
import {iconStyle} from '../icon-style';
import {validateUuid} from '../../../../vendor/eliza/packages/core/src/utils/uuid';
import type {ConversationMessageTarget, ChatChannel, VoiceConversationBinding,VoiceTurnSignal,ReadReplyBinding,NativeNotesReadReplyHint} from './alpha-client';
import {ViewNavigationClient,type NavigationAttempt} from './view-navigation';
import {captureConversationChoice,selectConversation,conversationSelectionDocument} from './conversation-selection';
import {developmentDigestDocument} from '../browser/development-digest-document';
import {developmentExecutionDocument} from '../browser/development-execution-document';
import {developmentAgentDocument} from '../browser/development-agent-document';
import {openDomainRecovery} from '../browser/domain-recovery';
import {retireClockReviews} from './clock-agent-review';
import { negotiateEnabledViews } from './device-view-profile';
import { workflowPresentationProtocol } from './workflow-presentation';
import {developmentIdentity,readDevelopmentIdentity,verifyDevelopmentIdentity,developmentOwnerRecovery,assertDevelopmentIdentity} from '../browser/development-identity';
import {developmentCloudKey} from '../browser/development-cloud';
import {DevelopmentCloudSetup} from '../browser/development-cloud-ui';
import {developmentCredential,developmentJournal,authorDevelopmentAction} from '../browser/development-actions';
import {browserDevProfile as devProfileQuery} from '../browser/dev-profile';
import {testMocksEnabled,devSurfacesEnabled} from '../build-flags';
import {developmentBridge,developmentName,developmentProfiles,developmentReply,saveDevelopmentReply,type DevelopmentProfile} from '../browser/development-connection';
import {Capacitor} from '@capacitor/core';
import {personalIntentDocument,type PersonalIntent} from './cloud-personal-intent';
import { CloudPersonalSetup, personalIntent, savePersonalIntent, clearPersonalIntent, type PersonalSetupState } from './cloud-personal-setup';
import { PersonalProtocolError, type CloudPersonalProtocol, type PersonalView, type PersonalOwner } from './cloud-personal-protocol';
import { holdPhoneInert } from './modal-inert';
import { pauseHostedBackground } from './hosted-background';
import {developmentDeviceStore,developmentActionJournal} from './local-agent-storage';
import { reviewLocalRecovery,archiveLocalRecovery,stopLocalAgent, configureLocalProvider, bindResidentCloudProvider, LocalAgentProtocol, localAgentPackaged, browserLocalAgentEnabled, localProviderStatus, clearLocalProvider, providerStatusLabel, LOCAL_PROVIDER_MODEL, type LocalProviderStatus } from './local-agent';
import { presentDeviceRecordOperation } from './device-record-presentation';
import type { MessagePage } from './remote-protocol';
import type {DeviceRecovery} from "./device-actions";
import type { WorkflowPhoneReview } from './workflow-device-contract';
import { AlphaClientError } from './alpha-client';
import { WorkflowProtocol, WorkflowHttpError } from './workflow-protocol';
import { registerPlugin } from '../platform-plugins';
import { DailyApps } from '../daily';
import { DeviceActions, actionScope, type DeviceCredential, type DeviceExecutor, type ForegroundReviewExecutor, type ActionJournal } from './device-actions';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isAndroid } from '../native';
import type { ActionProposal, OperationReceipt, ContextEnvelope, VerifiedSession } from './alpha-client';
import { cloudServiceName, CloudProtocol, CloudProtocolError, type CloudAgent, type CloudEnvironment } from './cloud-protocol';
import { googleOutcome as signInOutcome, type CloudSignInGoogleOutcome, CloudSignInError, normalizeSignInCode, signInFailureMessage as formatSignInFailureMessage, signInReadiness, validSignInEmail, validSignInPhone, type CloudSignInAuthenticated } from './cloud-sign-in';
import { DevelopmentCloudAgentProtocol, type CloudPhoneTarget } from './development-cloud-agents';
import { checkEntitlement, clearEntitlementKeyCache, describeSubscription, EntitlementError, EntitlementRefresher, isEntitlementSignInFailure, CHOOSE_PLAN_LABEL, MANAGE_PLAN_LABEL, planAdmission, readServiceLimit, redeemFailureMessage, redeemSuccessMessage, serviceLimitMessage, SubscriptionRedeemError, type ServiceLimit, type SubscriptionView } from './subscription-entitlement';
import { RemoteProtocol, RemoteProtocolError } from './remote-protocol';
import { phoneContextMessage } from './phone-context';
import { CloudSignInPanel } from './cloud-sign-in-ui';
import { cloudCredentialStore, cloudSelfRevocationSupported, cloudSignIn, cloudSignInPhone, remoteCredentialStore, nativeCloudRequest, nativeRemoteRequest, openConnectionBrowser, removeStoredCloudCredential, secureConnectionStore } from './native-connection';
import { findStoppedUserTurn, type StoppedTurn } from './stopped-reply-match';
import './connection-ui.css';

/** `offline` and `none` exist only where no resident agent runs (test-mocks builds and the flag-off
 * web preview). Android production and browser development migrate them to `resident` on read
 * (decision P-43: the resident agent is always present). */
type Selection = {kind:'development';profile:DevelopmentProfile;account?:string} | { kind: 'resident' } | { kind: 'offline' } | { kind: 'none' } | { kind: 'mock' } | { kind: 'remote' | 'local'; origin: string } | { kind: 'cloud'; environment: CloudEnvironment; agentId: string; ownerId?: string };
export interface CloudServiceSession { environment: CloudEnvironment; userId: string; organizationId?: string; sessionId: string; credentialId: string; email?: string;
  /** When this phone's Cloud sign-in key expires (from the in-app sign-in), if Cloud reported it. */
  expiresAt?: number }
export interface RestoredMessage { id: string; from: 'user' | 'agent'; text: string }
export interface ConnectionSnapshot {
  /** Automatic session restoration has completed; null is now a resolved no-session state. */
  startupResolved?: boolean;
  /** Saved startup restoration is quiet; explicit settings and real failures remain visible. */
  automaticRestore?: boolean;
  /** Subscription plan state from a verified Cloud entitlement; never a credit balance. */
  residentSubscription?: SubscriptionView | null;
  residentSavedCredential?: boolean;
  /**
   * Production plan notice (#410). The on-device agent ALWAYS runs (owner directive 2026-10-13);
   * plan state only decides whether Eliza Cloud inference is bound into it. 'needs-plan': signed
   * in without an admissible plan, so the agent runs without Cloud inference and a non-blocking
   * notice offers Redeem code / Choose a plan. 'offline': Eliza Cloud cannot be reached.
   */
  residentPlanNotice?: 'needs-plan' | 'offline' | null;
  /**
   * Whether the running on-device agent has Eliza Cloud inference bound: 'cloud' when an
   * admitted plan bound it, 'unavailable' when the agent runs without it, 'unknown'
   * when native state has not been confirmed. Never a credential.
   */
  residentInference?: 'cloud' | 'unavailable' | 'unknown' | null;
  /** When the current plan or redeemed grant ends, if Cloud reported it. */
  planEndsAt?: number | null;
  /** Outcome of the last subscription code submission. Never contains the code. */
  redeemNotice?: string; redeemError?: string;
  cloudPersonal?: PersonalSetupState;
  phoneActionsAvailable: boolean; phoneCapabilityReason: string;
  conversations: Array<{ id: string; title: string }>;
  history: { sessionId: string; conversationId: string; revision: number; messages: RestoredMessage[]; automatic: boolean } | null;
  historyError?: string;
  /** `description` is the one-line presentation; title/detail/timestamp are its parts. */
  actionHistory: Array<{ id: string; state: string; description: string; title: string; detail: string; outcome: string; timestamp: string }>;
  /** Native provider status shown in Settings; never contains the key. */
  providerStatus?: LocalProviderStatus | null;
  /** Shown after Stop when the agent may still finish; cleared by the single reconciliation. */
  replyNotice?: string;
  /** Older messages beyond the restored window remain on the agent. */
  historyPartial?: boolean;
  /** The phone reports no network. The resident's hosted inference needs it; local apps do not. */
  inferenceOffline?: boolean;
  cloudAccount: CloudServiceSession | null;
  /** Fresh interactive sign-in owns setup/Ready; quiet account restoration does not replay it. */
  setupRevision?: number;
  /** Alpha's own Eliza Cloud sign-in screen. Never holds a code, session or credential. */
  signIn?: SignInView | null;
  /** The last in-app sign-in created a new Eliza Cloud account: said explicitly, never silent. */
  accountCreated?: boolean;
  purpose?:'agent'|'cloud-account'|'plan';
  open: boolean; busy: boolean; message: string; error: string;
  /** Android production and browser development: `starting`/`recovering` while the resident has
   * no session (P-43); `offline` only where no resident runs (test mocks, flag-off web preview). */
  kind: 'starting' | 'recovering' | 'offline' | 'remote' | 'local' | 'resident' | 'cloud'; name: string;
  /** A resident start is in progress; the dialog may close and the start continues (P-43). */
  residentStarting?: boolean;
  residentRecoveryReason?: ResidentRecoveryReason;
  residentRecovery?: ResidentRecoveryView;
  session: VerifiedSession | null; agents: CloudAgent[];
}
/**
 * In-app sign-in steps (owner directive 2026-10-14): choose Google or email, wait for Google's
 * Custom Tab to return, enter the emailed code, or complete a second verification. The address is
 * shown back to the owner; the code is never kept in state.
 */
export type SignInView =
  | { step: 'choose'; environment: CloudEnvironment }
  | { step: 'google'; environment: CloudEnvironment }
  | { step: 'code'; environment: CloudEnvironment; email: string; phone?: string; attemptId: string; expiresAt: number; resendAt: number }
  | { step: 'mfa'; environment: CloudEnvironment; email?: string; attemptId: string; method: 'totp' | 'sms' | 'passkey'; expiresAt: number };
/** `revokeDevice` revokes this phone's enrollment on the agent; `deviceSlot` names its installation key. */
type Enrollment = { revokeDevice?: (signal: AbortSignal) => Promise<boolean>; deviceSlot?: string; deviceHeaders?: Record<string,string> };
type DeviceRequest=(path:string,body:unknown|undefined,signal:AbortSignal)=>Promise<unknown>;
type Active = ({ kind: 'resident'; remote: LocalAgentProtocol; origin: string; actions?: DeviceActions; workflowProtocol?: 1|2; userTextFormatVersion?:1 } | { kind: 'remote' | 'local'; remote: RemoteProtocol; origin: string; actions?: DeviceActions; workflowProtocol?: 1|2 } | { kind: 'cloud'; cloud: DevelopmentCloudAgentProtocol; agentId: string; actions?: DeviceActions; workflowProtocol?: 1|2; phoneTarget?: CloudPhoneTarget; voiceExpiresAt?: number }) & Enrollment & { request?:DeviceRequest; viewNavigation?:ViewNavigationClient };
const SELECTION = 'alpha.connection.selection.v1';
// The development chooser exists only on an explicitly flagged development server.
const browserDevProfile = devSurfacesEnabled && devProfileQuery;
/** Production builds offer only the production Cloud environment. */
const cloudEnvironmentPolicy = {development: import.meta.env.DEV, testMocks: testMocksEnabled, android: isAndroid, previewEnvironment: import.meta.env.VITE_ALPHA_CLOUD_ENVIRONMENT, cloudResident:browserCloudResidentEnabled};
const cloudEnvironmentAllowed = (environment: unknown): environment is CloudEnvironment => browserCloudResidentEnabled ? environment===browserCloudResidentEnvironment : environment === 'production' || (testMocksEnabled && environment === 'staging');
/** Eliza Cloud admits no request from the production web origin, so no Cloud route is started there. */
const webCloudUnavailable = () => !testMocksEnabled && !isAndroid && !browserLocalAgentEnabled;
/** Decision P-43 (owner, 2026-10-13): the agent always runs locally. On Android production and in
 * browser development with the local agent there is never a "no agent" state: before the resident
 * has a session the connection is `starting` or `recovering`, never offline. */
export const residentAlwaysPresent = (isAndroid && !testMocksEnabled) || (!isAndroid && browserLocalAgentEnabled);
const RESIDENT_NAME = isAndroid ? 'On this device' : 'On this computer';
export const RESIDENT_STARTING = 'Starting your agent…';
/** Shown wherever a session is needed while the resident starts or recovers; nothing was sent. */
export const RESIDENT_STARTING_NOTICE = 'Your agent is starting. Nothing was sent.';
export const RESIDENT_RECOVERING_NOTICE = 'Your agent stopped. Retry in Settings › Agent connection. Nothing was sent.';
/** Decision P-43: production has no remote-agent path. Where no resident runs in a production build
 * (the flag-off web preview) the agent is the phone's own, so the copy says so and how to reach it.
 * Remote-agent wording exists only in test-mocks builds (constant-folded out of production). */
export const LOCAL_AGENT_ELSEWHERE = 'Your agent runs on your phone, not here. Open Alpha on your Android phone to use it.';
const PENDING_FALLBACK = testMocksEnabled ? 'Connect your remote agent in Settings.' : LOCAL_AGENT_ELSEWHERE;
const NO_SESSION_FALLBACK = testMocksEnabled ? 'Connect your remote agent first.' : LOCAL_AGENT_ELSEWHERE;
export const NO_AGENT_SEND = testMocksEnabled ? 'Connect your remote agent in Settings to send a message.' : 'Your agent runs on your phone, not here. Nothing was sent.';
export const NO_AGENT_VOICE = testMocksEnabled ? 'Connect your remote agent in Settings to start a voice conversation.' : 'Your agent runs on your phone, not here. Open Alpha on your Android phone to talk with it.';
/** One wording for every surface that needs the agent and has no session yet. */
export function residentPendingText(snapshot: Pick<ConnectionSnapshot, 'kind'|'residentRecoveryReason'> = state): string {
  if(snapshot.residentRecoveryReason)return RESIDENT_RECOVERY_PENDING;
  return snapshot.kind === 'recovering' ? 'Your agent stopped. Retry in Settings › Agent connection.' : 'Your agent is starting…';
}
/** Every surface that needs an agent and has no session: the resident state where the resident is
 * always present, otherwise the production web preview's on-phone wording (test mocks: the remote
 * development agent). */
export function agentPendingText(snapshot: Pick<ConnectionSnapshot, 'kind'|'residentRecoveryReason'> = state, remote = PENDING_FALLBACK): string {
  return residentAlwaysPresent || snapshot.kind === 'starting' || snapshot.kind === 'recovering' ? residentPendingText(snapshot) : remote;
}
/** Passive surfaces stay quiet during normal startup; attempted actions still explain refusals. */
export function agentAvailabilityNotice(snapshot: Pick<ConnectionSnapshot, 'kind'|'residentRecoveryReason'> = state, remote = PENDING_FALLBACK): string {
  return snapshot.kind === 'starting' ? '' : agentPendingText(snapshot, remote);
}
/** The send/voice refusal for a missing session: the resident state where it is always present. */
function noSessionError(fallback: string): Error {
  if(state.residentRecoveryReason)return new Error(RESIDENT_RECOVERY_PENDING+' Nothing was sent.');
  return new Error(residentAlwaysPresent || state.kind === 'starting' || state.kind === 'recovering' ? (state.kind === 'recovering' ? RESIDENT_RECOVERING_NOTICE : RESIDENT_STARTING_NOTICE) : fallback);
}
const CLOUD_SERVICE = 'alpha.connection.cloud-service.v1';
/**
 * Subscription gate QA (test-mocks builds only): runs the production sign-in and plan gate
 * against the chosen Cloud environment, including staging (docs/cloud-subscription-qa.md).
 */
const RESIDENT_QA = 'alpha.connection.resident-qa.v1';
function residentQa(): CloudEnvironment | null {
  if (!testMocksEnabled) return null;
  try { const value = localStorage.getItem(RESIDENT_QA); return value === 'production' || value === 'staging' ? value : null; } catch { return null; }
}
/**
 * Production Android always runs the Eliza Cloud sign-in and plan flow around its on-device agent;
 * test-mocks builds only in QA mode. The flow never withholds the agent: it decides only whether
 * Eliza Cloud inference is bound into it.
 */
function residentCloudFlow(): boolean { return browserCloudResidentEnabled || (isAndroid && !testMocksEnabled) || residentQa() !== null; }
/** The on-device agent is never stopped or disconnected on a product phone (owner directive 2026-10-13). */
const ALWAYS_LOCAL = 'Your agent always runs on this device. Sign out of Cloud or change your plan in Settings; the agent keeps running.';
/**
 * First run and a rejected sign-in: the Eliza Cloud sign-in dialog cannot be dismissed. The agent
 * runs meanwhile (without Cloud inference). Offline is not a sign-in requirement.
 */
function residentSignInRequired(): boolean { return residentCloudFlow() && !state.cloudAccount && state.residentPlanNotice !== 'offline' && !state.residentStarting; }
function residentEnvironment(): CloudEnvironment { return browserCloudResidentEnabled?browserCloudResidentEnvironment:residentQa() ?? 'production'; }
/** The on-device agent's Cloud inference binding is production-only (native reads cloud:production). */
function residentBindable(): boolean { return browserCloudResidentEnabled || isAndroid && residentEnvironment() === 'production'; }
/** Warn this long before this phone's Cloud sign-in key expires (CLI keys last 90 days). */
export const CLOUD_KEY_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * A verified Cloud billing mode within this window keeps its inference binding while
 * Cloud is unreachable (the agent runs either way). An engineering bound for offline use, not a
 * billing decision: Cloud enforces authentication, credits and quota on every request.
 */
export const OFFLINE_PLAN_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
const PLAN_ADMISSION = 'alpha.connection.plan-admission.v1';
export const PLAN_RECHECK_INTERVAL_MS = 60_000;
let lastPlanRecheck = -Infinity, lastRefusalRecheck = -Infinity;
let planManagementReturn = false;
type PlanAdmissionRecord = { version: 1; environment: CloudEnvironment; credentialId: string; userId: string; organizationId: string | null; status: 'active' | 'trialing' | 'past_due' | 'credit-funded'; planName: string; verifiedAt: number; endsAt: number | null };
function readPlanAdmission(): PlanAdmissionRecord | null {
  try {
    const value = JSON.parse(localStorage.getItem(PLAN_ADMISSION) || 'null');
    if (!value || value.version !== 1 || !cloudEnvironmentAllowed(value.environment) || typeof value.credentialId !== 'string' || typeof value.userId !== 'string' || !['active', 'trialing', 'past_due', 'credit-funded'].includes(value.status) || typeof value.planName !== 'string' || !Number.isFinite(value.verifiedAt)) return null;
    return { version: 1, environment: value.environment, credentialId: value.credentialId, userId: value.userId, organizationId: typeof value.organizationId === 'string' ? value.organizationId : null, status: value.status, planName: value.planName, verifiedAt: value.verifiedAt, endsAt: Number.isFinite(value.endsAt) ? value.endsAt : null };
  } catch { return null; }
}
function writePlanAdmission(record: PlanAdmissionRecord | null) { try { if (record) localStorage.setItem(PLAN_ADMISSION, JSON.stringify(record)); else localStorage.removeItem(PLAN_ADMISSION); } catch { /* Offline grace is a convenience; the gate still checks Cloud. */ } }
/** The recent admitting plan this credential holds, or null. */
function recentPlanAdmission(environment: CloudEnvironment, credentialId: string | undefined, userId?: string): PlanAdmissionRecord | null {
  const record = readPlanAdmission();
  if (!record || !credentialId || record.environment !== environment || record.credentialId !== credentialId || (userId !== undefined && record.userId.toLowerCase() !== userId.toLowerCase())) return null;
  const now = Date.now(), age = now - record.verifiedAt;
  if (record.endsAt !== null && record.endsAt <= now) return null;
  return age >= 0 && age <= OFFLINE_PLAN_GRACE_MS ? record : null;
}
/** A Cloud outage or no network: not a refusal of the account or the plan. */
function cloudUnreachable(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') return false;
  if (error instanceof CloudProtocolError) return error.code === 'http' && (error.status === 408 || error.status === 429 || (error.status ?? 0) >= 500);
  if (error instanceof EntitlementError) return false;
  return error instanceof Error && /^(Connection request failed|Connection timed out|Request cancelled)$/.test(error.message);
}
const OFFLINE_NOTICE = 'Cloud cannot be reached right now. Your agent is running on this device; AI replies return when Cloud is reachable again, checked when the network returns or you come back to Alpha Phone.';
/** Notice shown when Cloud inference is unavailable or account access is unconfirmed. */
const NEEDS_PLAN_NOTICE = 'Your agent is running on this device. AI replies aren’t available right now. Check your Cloud account in Settings.';
/**
 * The on-device agent's honest answer to a chat or assistant request while Eliza Cloud inference
 * is not bound (the local runtime reports it as a provider-less turn). Local tools keep working.
 */
export function inferenceUnavailableReply(notice: ConnectionSnapshot['residentPlanNotice'], signedIn: boolean): string {
  const local = 'Local apps keep working.';
  if (notice === 'offline') return `I'm running on this device, but I can't reach ${cloudServiceName(cloud.environment)} for AI replies right now. ${local} Check your connection and try again.`;
  if (!signedIn) return `I'm running on this device, but AI replies need ${cloudServiceName(cloud.environment)}. Sign in with ${cloudServiceName(cloud.environment)} to continue. ${local}`;
  return `I'm running on this device, but AI replies aren’t available right now. Check your ${cloudServiceName(cloud.environment)} account in Settings. ${local} Nothing was purchased.`;
}
const listeners = new Set<() => void>();
let developmentPageSuspended = false;
let state: ConnectionSnapshot = { startupResolved:false, inferenceOffline: typeof navigator !== 'undefined' && navigator.onLine === false, phoneActionsAvailable:false, phoneCapabilityReason:'', actionHistory: [], conversations: [], history: null, cloudAccount: null, open: false, busy: false, message: '', error: '', kind: residentAlwaysPresent ? 'starting' : 'offline', name: residentAlwaysPresent ? RESIDENT_NAME : 'Offline', session: null, agents: [] };
let active: Active | null = null, operation: AbortController | null = null;
let startup: Promise<void> | null = null, epoch = 0;
let sending: AbortController | null = null;
let developmentVoiceExpiresAt=0;
const automationsRequests = new Set<AbortController>();
const conversationMemory = new Map<string, string>();
const actionReceipts = new Map<string, { sessionId: string; result: Promise<OperationReceipt> }>();
const readReplyOwners=new Map<ReadReplyBinding,{actions:DeviceActions;proposalId:string;digest:string;cancelled:boolean}>();
function retireReadReplies(){for(const binding of [...readReplyOwners.keys()])void connectionController.cancelReadReply(binding).catch(()=>{});}
let navigationContext:(()=>ContextEnvelope|null)|undefined;
let requestedCameraContinuation:{messageId:string;selected:Active;session:VerifiedSession;generation:number;conversationId:string;client:ViewNavigationClient;attempt:NavigationAttempt;expiresAt:number}|undefined;
let deviceRecovery: DeviceRecovery | undefined;
let deviceExecutor: DeviceExecutor = async () => ({ status: 'failed', summary: 'Device action executor is unavailable.' });
/** Foreground local reviews (free/busy over owner-chosen calendars). The phone shell supplies the
 * executor; a restored connection may negotiate first, so a missing executor fails closed. */
let foregroundExecutor: ForegroundReviewExecutor | undefined;
const runForegroundReview: ForegroundReviewExecutor = (op, id, context, signal, bindingHash, journalIdentity) => foregroundExecutor ? foregroundExecutor(op, id, context, signal, bindingHash, journalIdentity) : Promise.resolve({ status: 'failed', summary: 'This review is unavailable on this phone. Nothing was shared.' });
/** The shared contract's free/busy capability name (kept equal by test-calendar-availability-flow). */
export const CALENDAR_AVAILABILITY_CAPABILITY = 'calendar.availability-read.v1';
/** Free/busy is negotiated only when the agent offers it. */
const availabilityNegotiated = (offered: unknown) => Array.isArray(offered) && offered.includes(CALENDAR_AVAILABILITY_CAPABILITY);
/** Native Clock can carry repeat days (EXTRA_DAYS) once surfaceInfo reports clockRepeatDaysVersion 1. */
async function clockRepeatDaysSupported():Promise<boolean>{
  if(Capacitor.getPlatform()!=='android')return false;
  try{const info=await DailyApps.surfaceInfo() as {clockRepeatDaysVersion?:unknown};return typeof info.clockRepeatDaysVersion==='number'&&info.clockRepeatDaysVersion>=1;}catch{return false;}
}
/** The X-Eliza-Device-Capabilities value for every runtime (remote, resident, Cloud): the base
 * local-record contracts plus each capability the agent offers that this phone supports. Clock
 * handoffs are Android-only; v2 (repeat days) also needs the native repeat-days support. */
async function deviceCapabilities(offered:unknown):Promise<string>{
  const agent:unknown[]=Array.isArray(offered)?offered:[],android=Capacitor.getPlatform()==='android';
  const capabilities=['calendar.local-event.v1','notes.local-record.v1'];
  if(agent.includes(CAMERA_CAPTURE_CAPABILITY)&&(Capacitor.isPluginAvailable('ElizaCamera')||!android&&typeof navigator!=='undefined'&&typeof navigator.mediaDevices?.getUserMedia==='function'))capabilities.push(CAMERA_CAPTURE_CAPABILITY);
  if(agent.includes('reminders.local-record.v2'))capabilities.push('reminders.local-record.v2');else if(agent.includes('reminders.local-record.v1'))capabilities.push('reminders.local-record.v1');
  for(const capability of ['notes.query.v1','reminders.create.v1',...(android?['calendar.create.v1','calendar.next-read.v1']:[]),'maps.selected-read.v1'])if(agent.includes(capability))capabilities.push(capability);
  if(availabilityNegotiated(agent))capabilities.push(CALENDAR_AVAILABILITY_CAPABILITY);
  if(android&&agent.includes('clock.handoff.v1'))capabilities.push('clock.handoff.v1');
  if(android&&agent.includes('clock.handoff.v2')&&await clockRepeatDaysSupported())capabilities.push('clock.handoff.v2');
  // SMS sending is negotiated only on the AOSP image, where Alpha holds the SMS role.
  if(aospImage&&agent.includes(SMS_SEND_CAPABILITY))capabilities.push(SMS_SEND_CAPABILITY);
  return capabilities.join(',');
}
let deviceReadReview:((proposal:ActionProposal,context:ContextEnvelope,signal:AbortSignal)=>Promise<void>)|undefined;
const actionJournal = registerPlugin<ActionJournal>('AlphaActionJournal');
let savedCloudEnvironment: unknown;
try { savedCloudEnvironment = localStorage.getItem(CLOUD_SERVICE); } catch { /* Use the explicit public preview default when storage is unavailable. */ }
let cloud = makeCloud(resolveCloudEnvironment(cloudEnvironmentPolicy, savedCloudEnvironment));
let service: { client: CloudProtocol; identity: CloudServiceSession; credentialReference?: string } | null = null;
let entitlementRefresher: EntitlementRefresher | null = null;
/**
 * The Eliza Cloud inference binding the running resident was started with: 'cloud' (bound to an
 * admitted plan), 'unbound', 'kept' (left as stored while Cloud was unreachable) or 'unknown'
 * (native could not confirm removing a stored binding; the agent still runs). Null before
 * the first start. A plan change that needs a different binding restarts the agent once.
 */
let residentBinding: 'cloud' | 'unbound' | 'kept' | 'unknown' | null = null;
/** Shown beside the running agent when native could not confirm the Cloud inference binding was removed. */
const RESIDENT_UNBIND_UNCONFIRMED='Cloud inference removal could not be confirmed. Your agent is running; retry in Settings.';
/** A plan change arrived while another connection step ran; it is applied when that step ends. */
let residentRebindQueued = false;
/** Every Cloud detach ends background plan refresh, so no request goes out under a stale admission. */
function stopEntitlementRefresh(){entitlementRefresher?.stop();entitlementRefresher=null;clearEntitlementKeyCache();}
function detachService() { stopEntitlementRefresh(); retireReadReplies();for(const request of automationsRequests)request.abort(new DOMException('Cloud account changed','AbortError')); clearPersonalSetup(); service = null; update({ cloudAccount: null }); }
async function verifyService(client: CloudProtocol, signal: AbortSignal, expected?:{credentialId:string;credentialReference?:string}) {
  const credential = await cloudCredentialStore.read(client.environment); signal.throwIfAborted();
  if(expected&&(credential?.credentialId!==expected.credentialId||credential?.credentialReference!==expected.credentialReference))throw new Error('Cloud account changed. Try again.');
  if(residentCloudFlow())update({residentSavedCredential:!!credential?.credentialId});
  if (!credential?.credentialId) throw new Error('Cloud credentials are unavailable. Sign in again.');
  const identity = await client.identity(signal); signal.throwIfAborted();
  const current=await cloudCredentialStore.read(client.environment);
  if (current?.credentialId !== credential.credentialId || current?.credentialReference !== credential.credentialReference || expected&&current?.credentialReference!==expected.credentialReference) throw new Error('Cloud account changed. Try again.');
  signal.throwIfAborted();
  const same = service?.identity.environment === client.environment && service.identity.userId === identity.userId && service.identity.organizationId === identity.organizationId && service.identity.credentialId === credential.credentialId && service.credentialReference === credential.credentialReference;
  const account = { ...identity, credentialId: credential.credentialId, environment: client.environment, sessionId: same ? service!.identity.sessionId : crypto.randomUUID(), ...(Number.isFinite(credential.expiresAt) ? { expiresAt: credential.expiresAt } : {}) };
  localStorage.setItem(CLOUD_SERVICE, client.environment);
  service = { client, identity: account, credentialReference:credential.credentialReference }; update({ cloudAccount: account });
  return identity;
}
let personalSetup: { client:CloudPersonalProtocol; serviceId:string } | null = null;
let personalGeneration=0;
let personalRecovery:AbortController|null=null;
function clearPersonalSetup(){personalRecovery?.abort();personalGeneration++;personalSetup=null;update({cloudPersonal:undefined});}
function personalCurrent(binding:NonNullable<typeof personalSetup>,generation:number){return generation===personalGeneration&&personalSetup===binding&&service?.identity.sessionId===binding.serviceId&&service.identity.credentialId===binding.client.owner.credentialId&&service.identity.environment===binding.client.owner.environment&&service.identity.userId===binding.client.owner.userId&&service.identity.organizationId===binding.client.owner.organizationId;}
async function inspectPersonal(signal:AbortSignal){
 if(!testMocksEnabled)throw Error(PAIRING_RETIRED);
 const generation=personalGeneration,serviceId=service?.identity.sessionId;
 if(!serviceId)throw Error(`Sign in with ${cloudServiceName(cloud.environment)} first.`);
 const client=await developmentCloud().personal(signal);signal.throwIfAborted();
 if(generation!==personalGeneration||service?.identity.sessionId!==serviceId||service.identity.credentialId!==client.owner.credentialId||service.identity.userId!==client.owner.userId||service.identity.organizationId!==client.owner.organizationId)throw Error('Cloud account changed. Refresh status.');
 const binding={client,serviceId};personalSetup=binding;
 try{const expected=await personalIntent(client.owner,signal);
 const view=await client.inspect(signal);signal.throwIfAborted();
 if(!personalCurrent(binding,generation))return;
 await publishPersonal(binding,view,expected,generation,signal);
 }catch(error){if(personalCurrent(binding,generation))update({cloudPersonal:{view:null,blocked:true,declined:false}});throw error;}
}
async function publishPersonal(binding:NonNullable<typeof personalSetup>,view:PersonalView,expected:PersonalIntent|null,generation:number,signal:AbortSignal){
 const current=()=>{signal.throwIfAborted();if(!personalCurrent(binding,generation))throw Error('Cloud account changed. Refresh status.');};current();
 let intent=await personalIntent(binding.client.owner,signal);current();
 if(JSON.stringify(intent)!==JSON.stringify(expected))throw Error('Cloud setup changed in another view. Refresh its status.');
 if(intent?.phase==='activation'&&intent.state==='accepted'&&(view.kind==='review'||view.kind==='unavailable')&&intent.personalElizaId===view.review.personalElizaId&&intent.dedicatedAgentId&&intent.dedicatedAgentId===view.review.dedicatedAgentId&&['stopped','sleeping','error'].includes(view.review.status||'')){await clearPersonalIntent(binding.client.owner,intent,signal);intent=null;current();}
 if(intent&&view.kind==='ready'){
  if(intent.personalElizaId!==view.identity.personalElizaId||(intent.dedicatedAgentId&&intent.dedicatedAgentId!==view.identity.activeAgentId))throw Error('Cloud setup returned a different target. Review the account before connecting.');
  await clearPersonalIntent(binding.client.owner,intent,signal);intent=null;current();
 }
 const blocked=!!intent&&view.kind!=='ready'&&(view.kind!=='pending'||intent.phase==='cutover'||intent.personalElizaId!==view.receipt.personalElizaId||(!!intent.dedicatedAgentId&&intent.dedicatedAgentId!==view.receipt.dedicatedAgentId));
 update({cloudPersonal:{view,blocked,declined:false},message:view.kind==='ready'?'Your personal Cloud agent is ready.':view.kind==='pending'?'Setup accepted. Check status to continue.':'Cloud account connected. Review Dedicated hosting before starting setup.',error:''});
}
async function personalDispatch(binding:NonNullable<typeof personalSetup>,generation:number,intent:PersonalIntent,signal:AbortSignal){
 if(!signal.aborted&&personalCurrent(binding,generation))return;
 await clearPersonalIntent(binding.client.owner,intent);signal.throwIfAborted();throw Error('Cloud account changed before setup was sent.');
}
async function personalWork(message:string,action:(binding:NonNullable<typeof personalSetup>,view:PersonalView,signal:AbortSignal)=>Promise<void>){
 if(!testMocksEnabled){update({error:PAIRING_RETIRED});return;}
 await work(message,async signal=>{
  const binding=personalSetup,view=state.cloudPersonal?.view,generation=personalGeneration;
  if(!binding||!view||!personalCurrent(binding,generation))throw Error('Refresh Cloud status before continuing.');
  try{await action(binding,view,signal);}
  catch(error){
   if(!personalCurrent(binding,generation))return;
   // Expiration detaches this exact service, without clearing durable setup intent.
   if((error instanceof CloudProtocolError||error instanceof PersonalProtocolError)&&expired(error)&&connectionController.rejectCloudSession(binding.serviceId,error))return;
   let blocked=true;try{blocked=!!await personalIntent(binding.client.owner);}catch{/* Invalid persistence refuses further setup writes. */}
   if(!personalCurrent(binding,generation))return;
   if(signal.aborted&&!blocked){update({cloudPersonal:undefined,message:'Cloud setup check stopped.',error:''});personalGeneration++;personalSetup=null;return;}
   update({cloudPersonal:{view:state.cloudPersonal?state.cloudPersonal.view:view,blocked,declined:false},message:blocked?'Setup could not be confirmed. Check status before taking another action.':'',error:blocked?'':error instanceof PersonalProtocolError&&error.code==='account-changed'?'Cloud account changed. Refresh status.':'Cloud setup is unavailable. Refresh status to review the current state.'});
  }
 });
}
function detachCloudTarget() { if (testMocksEnabled && active?.kind === 'cloud') retire(); }
// Only the Android transport admits Cloud's self-revocation DELETE; elsewhere sign-out reports a local removal.
// Product builds construct only the managed-services adapter; the hosted-agent fixture exists only with test mocks.
function makeCloud(environment: CloudEnvironment): CloudProtocol { return testMocksEnabled ? new DevelopmentCloudAgentProtocol(environment, nativeCloudRequest, cloudCredentialStore, openConnectionBrowser, { deleteRequests: cloudSelfRevocationSupported, signIn: cloudSignIn }) : new CloudProtocol(environment, nativeCloudRequest, cloudCredentialStore, openConnectionBrowser, { deleteRequests: cloudSelfRevocationSupported, signIn: cloudSignIn }); }
/** The client for an in-app sign-in in this environment; replaced when the environment changes. */
function signInClient(environment: CloudEnvironment): CloudProtocol {
  if (cloud.environment !== environment) cloud = makeCloud(environment);
  return cloud;
}
/**
 * A new key was stored, possibly for a different account: the old identity is detached before
 * anything reads the new one. Until then a request of the old identity is refused by the stored
 * credential generation check (account-changed). The resident agent keeps running; native stops a
 * process whose Cloud inference was bound to the replaced key.
 */
function prepareSignInReplacement() {
  if (residentCloudFlow()) { detachService(); update({ residentSubscription: null, residentPlanNotice: null, redeemError: '', redeemNotice: '', accountCreated: false }); return; }
  const replacingCloud = active?.kind === 'cloud' || selection()?.kind === 'cloud';
  detachCloudTarget(); detachService(); if (replacingCloud) save({ kind: 'none' }); update({ agents: [], accountCreated: false });
}
/** How long sign-in waits for optional Google readiness before offering email alone. */
const SIGN_IN_READINESS_WAIT_MS = 6000;
/** Whether the last ready host offered Google (it needs this phone's verified App Link return). */
let inAppGoogle = false, inAppPhone = false, inAppEmail = true, inAppMethodsUnconfirmed = true;
/** Explicit sign-in from a recovery screen can return without losing its controls. */
let inAppReturnToStart = false;
/**
 * The verified optional sign-in methods, or null when the readiness probe is unavailable. The host
 * (AlphaCloudSignInPlugin) runs a cheap, cached readiness probe: the native client registration,
 * Steward's redirect allowlist and providers, /.well-known/assetlinks.json listing this app's
 * package and signing certificate, and Android's verification of the return host. Fail-safe: no
 * host, an error, a slow or malformed answer, or `inApp` not exactly true hides Google.
 */
async function inAppSignInMethods(environment: CloudEnvironment, signal: AbortSignal): Promise<{ google: boolean; phone: boolean; email: boolean } | null> {
  const port = cloudSignIn;
  if (!port?.status) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    signal.throwIfAborted();
    const cancelled = new Promise<null>(resolve => { abort = () => resolve(null); signal.addEventListener('abort', abort, { once: true }); });
    // A fresh attempt must recover immediately after connectivity or App Link verification changes.
    const value = await Promise.race([port.status({ environment, refresh: true }), cancelled, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), SIGN_IN_READINESS_WAIT_MS); })]);
    return signInReadiness(value);
  } catch { return null; }
  finally { clearTimeout(timer); if (abort) signal.removeEventListener('abort', abort); }
}
/** A failed or cancelled step leaves the stored sign-in and the running service as they were. */
function signInFailed(environment: CloudEnvironment, keepStep = false) {
  if (!keepStep) update({ signIn: { step: 'choose', environment } });
}
/** The provider authenticated only the first factor; keep the credential and agent unchanged. */
function showGoogleMfa(outcome: Extract<CloudSignInGoogleOutcome, { status: 'mfa' }>) {
  update({ open: true, signIn: { step: 'mfa', environment: outcome.environment, attemptId: outcome.attemptId, method: outcome.method, expiresAt: outcome.expiresAt },
    message: '',
    error: outcome.method === 'passkey' ? signInFailureMessage('mfa-unsupported') : '' });
}
/** A verified interactive sign-in finishes through setup, not the account/plan modal underneath it. */
function showPostSignInSetup() {
  if (state.cloudAccount) update({open: false, purpose: 'agent', setupRevision: (state.setupRevision ?? 0) + 1});
}
/** The key is stored; the existing identity, entitlement and agent paths take over unchanged. */
async function signedIn(client: CloudProtocol, outcome: CloudSignInAuthenticated, signal: AbortSignal) {
  const created = outcome.accountCreated === true;
  prepareSignInReplacement();
  update({ signIn: null, accountCreated: created });
  const unconfirmed = outcome.previousSignIn === 'unconfirmed';
  if (residentCloudFlow()) {
    // Same admission as the browser hand-off (residentBrowserLogin): bind the new key, and remove a
    // key Cloud refused right after issuing it rather than keep it for a retry that cannot work.
    const issued = (await cloudCredentialStore.read(residentEnvironment()))?.credentialId;
    signal.throwIfAborted(); retire();
    try { await connectResident(signal); } catch (error) { if (residentAlwaysPresent && !active) update({ kind: 'recovering' }); showPostSignInSetup(); throw error; }
    if (!state.cloudAccount && state.residentPlanNotice !== 'offline' && issued && (await cloudCredentialStore.read(residentEnvironment()).catch(() => null))?.credentialId === issued) {
      await cloudCredentialStore.clear(residentEnvironment());
      update({ residentSavedCredential: false, open: true, error: `${cloudServiceName(cloud.environment)} refused this sign-in. Your agent keeps running; sign in again to turn AI on.` });
      return;
    }
    if (unconfirmed) update({ message: `Signed in. ${cloudServiceName(cloud.environment)} did not confirm revoking the sign-in this phone used before.` });
    showPostSignInSetup();
    return;
  }
  const accountOnly = state.purpose === 'cloud-account';
  await verifyService(client, signal);
  if (!active) save({ kind: 'none' });
  if (accountOnly || created || unconfirmed) update({ message: created ? `Signed in. ${cloudServiceName(cloud.environment)} created a new account for this sign-in.` : unconfirmed ? `Signed in to ${cloudServiceName(cloud.environment)}. ${cloudServiceName(cloud.environment)} did not confirm revoking the previous sign-in.` : `Signed in to ${cloudServiceName(cloud.environment)}.` });
  else if (hosted) await hosted.inspectPersonal(signal);
  if(accountOnly)showPostSignInSetup();
}
/** The development hosted-agent client. Product builds have none (#406). */
function developmentCloud(): DevelopmentCloudAgentProtocol { if (!testMocksEnabled || !(cloud instanceof DevelopmentCloudAgentProtocol)) throw Error(PAIRING_RETIRED); return cloud; }
function update(patch: Partial<ConnectionSnapshot>) {
  const next = { ...state, ...patch };
  if (state.purpose === 'cloud-account' && patch.cloudAccount && !state.cloudAccount) { next.open = false; next.purpose = 'agent'; }
  // Modal ownership follows production presentation. Automatic restore only suppresses rendering
  // temporarily; it must not erase an explicitly opened account or plan panel.
  state = isAndroid && !testMocksEnabled ? { ...next, open: connectionChooserVisible({ ...next, automaticRestore: false }) } : next;
  if (!developmentPageSuspended) listeners.forEach(listener => listener());
}
// P-43: where the resident is always present no "no agent" choice is ever stored.
function save(selection: Selection) { localStorage.setItem(SELECTION, JSON.stringify(residentAlwaysPresent && (selection.kind === 'none' || selection.kind === 'offline') ? { kind: 'resident' } : selection)); }
function retire(name?: string) {
  retireReadReplies();
  const retirement=Promise.allSettled([state.session?pauseHostedBackground(state.session.sessionId):Promise.resolve(),retireClockReviews()]).then(results=>{const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;});
  void retirement.catch(()=>update({error:'Background delivery could not be retired. Reconnect to reset it.'}));
  if (testMocksEnabled && active?.kind === 'cloud') { active.cloud.setPhoneTarget(null); if (state.session) void secureConnectionStore.remove(`cloud-runtime:${state.session.sessionId}`).catch(()=>{}); }
  active?.viewNavigation?.dispose();
  actionReceipts.clear();
  conversationMemory.clear();
  cancelStoppedReply();
  for(const request of automationsRequests)request.abort(new DOMException('The connection changed','AbortError'));
  epoch++;
  sending?.abort(new DOMException('The connection changed.', 'AbortError'));
  sending = null;
  active = null;
  update({ phoneActionsAvailable:false, phoneCapabilityReason:'', session: null, kind: residentAlwaysPresent ? 'starting' : 'offline', name: name ?? (residentAlwaysPresent ? RESIDENT_NAME : 'Offline'), conversations: [], history: null, historyError:'', historyPartial:false, replyNotice:'', actionHistory: [] });
  return retirement;
}
/** Test mocks only (the mock-mode exit and fixtures): where no resident runs, remember "offline". */
function persistOffline(): string {
  try { save({ kind: 'offline' }); return ''; }
  catch {
    try { localStorage.removeItem(SELECTION); } catch { /* The visible error explains restart uncertainty. */ }
    return 'Offline now, but this preference could not be saved. Check the connection again after restarting the app.';
  }
}
function expired(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return ('status' in error && error.status === 401) || ('code' in error && ['expired', 'credentials-missing', 'session_expired', 'not_connected'].includes(String(error.code)));
}
function selection(): Selection | null {
  try {
    const value = JSON.parse(localStorage.getItem(SELECTION) || 'null');
    if(browserDevProfile&&value?.kind==='development'&&developmentProfiles.includes(value.profile))return value;
    // P-43: a stored "offline", local-apps-only or "none" choice from an older build is the
    // resident wherever the resident is always present; elsewhere it stays as stored.
    if (value?.kind === 'offline' || value?.kind === 'none') return residentAlwaysPresent ? { kind: 'resident' } : value.kind === 'offline' ? { kind: 'offline' } : { kind: 'none' };
    if (value?.kind === 'resident') return value;
    if (testMocksEnabled && value?.kind === 'mock') return value;
    // Product builds have no hosted or paired agent (#406): a saved one reads as the resident agent.
    if (!testMocksEnabled) return legacyHostedKind(value?.kind) ? { kind: 'resident' } : null;
    if ((value?.kind === 'remote' || value?.kind === 'local') && typeof value.origin === 'string') return value;
    if (value?.kind === 'cloud' && cloudEnvironmentAllowed(value.environment) && typeof value.agentId === 'string') return value;
  } catch { /* Invalid nonsecret preferences do not authenticate a connection. */ }
  return null;
}
function signInFailureMessage(code: CloudSignInError['code']): string {
  const environment=state.signIn?.environment??cloud.environment;
  return formatSignInFailureMessage(code,cloudServiceName(environment));
}
function errorMessage(error: unknown): string {
  const recovery=residentRecoveryReason(error);if(recovery)return residentRecoveryMessage(recovery);
  if (error instanceof CloudSignInError) return signInFailureMessage(error.code);
  if (error && typeof error === 'object' && 'code' in error) {
    if (error.code === 'expired') return testMocksEnabled ? `This sign-in link has expired. Close the old browser tab and select Sign in with ${cloudServiceName(cloud.environment)} to open a fresh link.` : `Your ${cloudServiceName(cloud.environment)} sign-in has expired. Sign in again.`;
    if (error.code === 'credential-consumed') return `This sign-in link has already been used. Close the old browser tab and start a fresh ${cloudServiceName(cloud.environment)} sign-in.`;
    if (error.code === 'login-active') return signInFailureMessage('login-active');
    if (error.code === 'credentials-missing') return `Sign in with ${cloudServiceName(cloud.environment)} to reconnect your account.`;
  }
  if (error instanceof DOMException && error.name === 'AbortError') return 'Connection cancelled.';
  if (error instanceof EntitlementError && error.code === 'account-mismatch') return `${cloudServiceName(cloud.environment)} returned plan status for a different account. Sign in again.`;
  // Production phones have no pairing to fall back on: an expired session is a Cloud sign-in.
  if (error && typeof error === 'object' && 'status' in error && error.status === 401) return !testMocksEnabled ? RESIDENT_SIGN_IN_EXPIRED : 'Your session has expired. Sign in or pair again.';
  if (error && typeof error === 'object' && 'status' in error && error.status === 503) return 'The agent is starting or temporarily unavailable. Try again shortly.';
  return error instanceof Error ? error.message : 'The connection could not be completed.';
}
/** A resident start that does not open the dialog: Home shows the starting state (P-43). */
let residentStartInBackground = false;
/** `openOnError`: a background check (the quiet Cloud account restore) that opens the dialog only to report a failure. */
async function work(message: string, action: (signal: AbortSignal) => Promise<void>, background = false, openOnError = false) {
  if (operation) return;
  const controller = new AbortController(); operation = controller; residentStartInBackground = background;
  update({ busy: true, ...(background ? {} : { open: true }), message, error: '' });
  try { await action(controller.signal); }
  catch (error) {
    const recovery=residentRecoveryReason(error);if(recovery&&!active)update({residentRecoveryReason:recovery});
    if(controller.signal.aborted&&!state.open){update({error:'',message:''});return;}
    if(background&&!openOnError&&!state.open){update({error:errorMessage(error),message:''});return;}
    if (testMocksEnabled && expired(error) && active?.kind === 'cloud' && active.cloud.environment === cloud.environment) {
      const previous = active; retire('Sign-in required'); detachService();
      try { await previous.cloud.disconnect(); }
      catch { update({ error: 'The expired connection is detached, but its stored credential could not be removed.', open: true, message: '' }); return; }
    }
    update({ error: errorMessage(error), ...(background&&!state.open?{purpose:residentCloudFlow()?'agent' as const:'cloud-account' as const}:{}), open: true, message: '' });
  }
  finally { if (operation === controller) { operation = null; residentStartInBackground = false; } update({ busy: false, ...(background&&!state.open?{message:''}:{}) }); runQueuedResidentRebind(); runQueuedSignInReturn(); scheduleResidentAutoRetry(); }
}
/** P-43: the agent always runs. A resident left `recovering` (a failed start or rebind, never a
 * recovery review, which needs the owner) starts again by itself with backoff; Retry stays offered
 * throughout and once the attempts are spent. A running agent resets the attempts. */
const RESIDENT_AUTO_RETRY_MS = [3000, 10000, 30000, 60000];
let residentAutoRetries = 0, residentAutoRetry: ReturnType<typeof setTimeout> | undefined;
function scheduleResidentAutoRetry() {
  if (active) { residentAutoRetries = 0; return; }
  if (!residentAlwaysPresent || !isAndroid || testMocksEnabled || residentAutoRetry || operation || state.kind !== 'recovering' || state.residentRecoveryReason || residentAutoRetries >= RESIDENT_AUTO_RETRY_MS.length) return;
  residentAutoRetry = setTimeout(() => { residentAutoRetry = undefined; residentAutoRetries++; void ensureResident(); }, RESIDENT_AUTO_RETRY_MS[residentAutoRetries]);
}
/** Start (or restart) the resident. A failure leaves the `recovering` state with a Retry, never "no agent". */
async function startResident(message = RESIDENT_STARTING, background = true) {
  await work(message, async signal => {
    update({ residentStarting: true, ...(active ? {} : { kind: 'starting' as const, name: RESIDENT_NAME }) });
    try { await connectResident(signal); }
    catch (error) { if (residentAlwaysPresent && !active) update({ kind: 'recovering' }); throw error; }
    finally { update({ residentStarting: false }); }
    // A start the owner asked for (Retry, Check plan again) keeps the dialog open while AI is not ready.
    if (!background && isAndroid && !testMocksEnabled && state.residentInference !== 'cloud') update({ open: true });
  }, background);
  // A cancelled start is a resident that is not running: it recovers, with Retry.
  if (residentAlwaysPresent && !active && state.kind === 'starting') update({ kind: 'recovering' });
}
// Keep startup-error provenance separate from account and sign-out outcomes.
let residentStartFailure = '';
/** After an operation that stopped the resident (sign-in, sign-out, provider change, disconnect),
 * start it again in the background. That operation's outcome (message, error, open dialog) stays
 * visible; a failed restart shows its own error and leaves the resident recovering with Retry. */
async function ensureResident() {
  if (!residentAlwaysPresent || active || operation) return;
  const { message, error, open } = state;
  const startFailed = !!error && error === residentStartFailure;
  await startResident('Restarting your agent…', true);
  update({ open: open || state.open, message: message || (state.session ? '' : state.message), error: state.error || (state.session && startFailed ? '' : error) });
}
/** P-43: a startup path that ended without any agent (a Cloud account check that returned early, or
 * a saved development/remote/Cloud agent that could not be restored) must not keep claiming
 * "starting" with nothing starting. With the resident selected it starts now; otherwise the
 * state is `recovering`, whose Retry starts the resident. */
async function settleResidentAfterStartup() {
  if (!residentAlwaysPresent || active || operation || state.kind !== 'starting') return;
  // Mock mode (test mocks only) runs no agent connection at all.
  if (testMocksEnabled && new URLSearchParams(location.search).get('mode') === 'mock') return;
  const saved = selection();
  if (saved?.kind === 'mock') return;
  if (!saved || saved.kind === 'resident') { await ensureResident(); return; }
  update({ kind: 'recovering' });
}
function activate(next: Active, session: VerifiedSession, name: string) {
  retireReadReplies();
  active?.viewNavigation?.dispose();
  actionReceipts.clear();
  conversationMemory.clear();
  cancelStoppedReply();
  for(const request of automationsRequests)request.abort(new DOMException('The connection changed','AbortError'));
  epoch++; sending?.abort(new DOMException('The connection changed.', 'AbortError')); sending = null; active = next;
  update({ residentRecoveryReason:undefined,residentRecovery:undefined, phoneActionsAvailable:!!next.actions, conversations: [], history: null, historyError: '', historyPartial:false, replyNotice:'', actionHistory: [], kind: next.kind, name, session, open: false, message: next.kind === 'resident' && state.inferenceOffline ? '' : 'Connected', error: '' });
}
/**
 * Applies a plan change to the running on-device agent: re-admits the account, binds or unbinds
 * Eliza Cloud inference, and reconnects (attaching when the process already matches, otherwise a
 * clean restart; conversation history lives in the agent and is restored). The agent is never
 * left stopped because of plan state. At most one rebind runs; one more is queued behind it.
 */
function queueResidentRebind() {
  if (!residentCloudFlow()) return;
  if (operation) { residentRebindQueued = true; return; }
  residentRebindQueued = false;
  // An outcome the open dialog is showing (a sign-out, a cancelled sign-in) stays visible after the rebind.
  const shown = state.open ? { message: state.message, error: state.error, startFailed: !!state.error && state.error === residentStartFailure } : null;
  const signIn = state.signIn;
  void work('Updating your agent…', async signal => {
    retire();
    try { await connectResident(signal); }
    catch (error) { if (residentAlwaysPresent && !active) update({ kind: 'recovering' }); throw error; }
    // Rebinding inference must not discard the sign-in screen just selected by readiness.
    // Only the same still-active view is restored; a cancelled or completed sign-in stays closed.
    if (signIn && state.signIn === signIn && signIn.environment === residentEnvironment()) update({ open: true });
    if (shown && state.open) update({ ...(shown.message && !state.message ? { message: shown.message } : {}), ...(shown.error && !shown.startFailed && !state.error ? { error: shown.error } : {}) });
  }, true, true);
}
/** A native sign-in return that arrived while another step was running; handled once it ends. */
let queuedSignInReturn: unknown = null;
function runQueuedSignInReturn() { if (queuedSignInReturn !== null && !operation) { const value = queuedSignInReturn; queuedSignInReturn = null; void connectionController.signInReturned(value); } }
function runQueuedResidentRebind() { if (residentRebindQueued && !operation) queueResidentRebind(); }
async function remoteIdentity(remote: RemoteProtocol, signal: AbortSignal) {
  const credential = await remoteCredentialStore.read(remote.origin);
  if (!credential || !remote.session) throw new Error('Pair this agent before connecting.');
  const response = await nativeRemoteRequest({ url: remote.origin + '/api/agents', method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${credential.token}` }, signal });
  if (response.status !== 200) {
    if (response.status === 401) await remote.disconnect();
    throw new Error('The agent identity could not be verified. Pair again if its session was revoked.');
  }
  const agents = (response.body as { agents?: unknown })?.agents;
  if (!Array.isArray(agents) || agents.length !== 1) throw new Error('Choose an endpoint serving one agent.');
  const agent = agents[0];
  if (typeof agent?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(agent.id) || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(agent.id)) throw new Error('The agent has not published a valid identity.');
  if (agent.status !== 'running') throw new Error('The agent is not running yet. Try again when it is ready.');
  return { id: agent.id, name: typeof agent.name === 'string' ? agent.name : 'Remote agent' };
}
async function connectRemote(kind: 'remote' | 'local', origin: string, code: string, signal: AbortSignal) {
  // Fences every caller, including restore: no request is made and the saved credential is kept.
  if (!testMocksEnabled) throw new Error(PAIRING_RETIRED);
  let deviceHeaders: Record<string, string> = {};
  const remote = new RemoteProtocol(origin.trim(), input => nativeRemoteRequest({ ...input, headers: { ...input.headers, ...deviceHeaders } }), remoteCredentialStore, { developmentOrigins: kind === 'local' ? [new URL(origin).origin] : [] });
  if (code.trim()) await remote.pair(code.trim(), signal);
  else if (!await remote.restore(signal)) throw new Error('Enter the pairing code displayed by your agent.');
  const agent = await remoteIdentity(remote, signal); signal.throwIfAborted();
  const verified = remote.session!;
  const session = { ownerId: verified.identityId, agentId: agent.id, sessionId: crypto.randomUUID(), origin: remote.origin };
  let actions: DeviceActions | undefined;
  let deviceRequest:DeviceRequest|undefined;
  let reason = "";
  const enrollment: Enrollment = {};
  const workflowProtocol=await workflowPresentationProtocol(signal);
  try {
    const baseScope = await actionScope(JSON.stringify([remote.origin, session.ownerId, session.agentId]));
    const slot = `device:${baseScope}`;
    enrollment.deviceSlot = slot;
    let credential = await secureConnectionStore.read<DeviceCredential>(slot);
    if (!credential) {
      credential = { installationId: crypto.randomUUID(), key: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') };
      await secureConnectionStore.write(slot, credential);
    }
    if (!/^[a-f0-9]{64}$/.test(credential.key) || !/^[a-f0-9-]{36}$/.test(credential.installationId)) throw new Error('Invalid saved device identity');
    const headers = { 'X-Eliza-Device-Id': credential.installationId, 'X-Eliza-Device-Key': credential.key, 'X-Eliza-Device-Capabilities': 'calendar.local-event.v1,notes.local-record.v1' };
    const request = async (path: string, body: unknown | undefined, requestSignal: AbortSignal) => {
      requestSignal.throwIfAborted();
      const auth = await remoteCredentialStore.read(remote.origin);
      if (!auth || auth.identityId !== session.ownerId || !remote.session || auth.expiresAt <= Date.now()) throw new Error('Device session changed');
      const response = await nativeRemoteRequest({ url: remote.origin + path, method: body === undefined ? 'GET' : 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${auth.token}`, ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: requestSignal });
      if (response.status < 200 || response.status >= 300) throw Object.assign(new Error('Device action request failed'), { status: response.status });
      return response.body;
    };
    const registered = await request('/api/client-devices/register', { label: 'Alpha Phone', workflowProtocol }, signal) as { installationId: string; enrollmentId: string; capabilities?: string[]; viewProfileVersion?: unknown };
    if (registered.installationId !== credential.installationId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId)) throw new Error('Device registration was not verified');
    reason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);
    headers["X-Eliza-Device-Capabilities"]=await deviceCapabilities(registered.capabilities);
    credential.enrollmentId = registered.enrollmentId;
    await secureConnectionStore.write(slot, credential); signal.throwIfAborted();
    deviceHeaders = headers;
    enrollment.deviceHeaders = headers;
    credential.capabilities=headers["X-Eliza-Device-Capabilities"].split(",");
    actions = new DeviceActions(session, credential, await actionScope(JSON.stringify([baseScope, credential.installationId])), request, actionJournal, (op, id, context, effectSignal, bindingHash, workflowRoute, journalIdentity) => deviceExecutor(op, id, context, effectSignal, bindingHash, workflowRoute, journalIdentity),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:"unknown"}),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    deviceRequest=request;
  } catch { signal.throwIfAborted(); reason = "Chat connected. Phone action enrollment was not confirmed. Reconnect to review its status."; }
  save({ kind, origin: remote.origin });
  activate({ kind, remote, origin: remote.origin, actions, workflowProtocol, ...enrollment, request:deviceRequest }, session, agent.name);
  if (reason) update({phoneCapabilityReason: reason});
  await restoreSavedHistory(signal);

}
async function connectDevelopment(profile:DevelopmentProfile,signal:AbortSignal){
 if(!browserDevProfile)throw Error('Development mode required.');
 // This explicitly gated browser fixture implements reminder v2; real peers still negotiate it.
 const identity=await readDevelopmentIdentity(profile,signal);const client=new LocalAgentProtocol(developmentBridge(profile,identity));const {session,name}=await client.connect(signal);signal.throwIfAborted();const credential=developmentCredential(profile,identity),scope=await actionScope(JSON.stringify([client.origin,session.ownerId,session.agentId,credential.installationId]));const actions=new DeviceActions(session,credential,scope,(path,body,signal)=>client.request(path,body,signal),developmentJournal(profile,identity),(op,id,context,signal,binding,workflowRoute,journalIdentity)=>deviceExecutor(op,id,context,signal,binding,workflowRoute,journalIdentity),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:'unknown'}),true,true);await retire();signal.throwIfAborted();await verifyDevelopmentIdentity(identity,signal);const workflowProtocol=2 as const;save({kind:'development',profile,...(identity.account?{account:identity.account}:{})});developmentVoiceExpiresAt=Date.now()+3600000;activate({kind:'resident',remote:client,origin:client.origin,actions,workflowProtocol},session,name);
}
/** How the running resident's Eliza Cloud inference is bound after admission, and what to tell the owner. */
type ResidentAdmission = { binding: 'cloud' | 'unbound' | 'kept'; credentialId?: string; account?: { client: CloudProtocol; identity: CloudServiceSession }; notice?: { error?: string; message?: string; open?: boolean } };
/**
 * Reads the Eliza Cloud account and plan and decides only the inference binding of the on-device
 * agent. It never decides whether the agent runs: the agent always starts (owner directive
 * 2026-10-13: there is never a state without an agent). Without an admissible plan, while Cloud is
 * unreachable, or without a valid sign-in, the agent runs with Cloud inference unbound.
 */
async function admitCloudResident(signal:AbortSignal):Promise<ResidentAdmission> {
  stopEntitlementRefresh();
  update({residentSubscription:{kind:'checking'},redeemError:''});
  const environment=residentEnvironment();
  cloud = makeCloud(environment);
  const client=cloud;
  const saved=await cloudCredentialStore.read(environment);signal.throwIfAborted();
  // First run or signed out: sign-in is required (the dialog cannot be dismissed), and the agent
  // runs meanwhile without Cloud inference.
  if(!saved?.credentialId){
    if(service)detachService();
    update({residentSavedCredential:false,residentSubscription:null,residentPlanNotice:null,planEndsAt:null});
    return {binding:'unbound',notice:{open:true}};
  }
  let identity:Awaited<ReturnType<typeof verifyService>>;
  try{identity=await verifyService(client,signal);}
  catch(error){
    signal.throwIfAborted();
    if(cloudUnreachable(error)){
      // Offline or a Cloud outage: a plan verified recently for this sign-in keeps its binding
      // (Cloud still decides each AI request once reachable); otherwise inference is unbound.
      const recent=recentPlanAdmission(environment,saved.credentialId);
      update({residentPlanNotice:'offline',residentSubscription:{kind:'unavailable',reason:'outage'},planEndsAt:recent?.endsAt??null});
      return {binding:recent?'kept':'unbound',notice:{message:OFFLINE_NOTICE}};
    }
    // A rejected or unreadable sign-in: no Cloud inference until the owner signs in again.
    if(service)detachService();
    update({residentPlanNotice:null,residentSubscription:null,planEndsAt:null});
    return {binding:'unbound',notice:{error:errorMessage(error),open:true}};
  }
  const account=service;
  if(!account)return {binding:'unbound',notice:{error:'Cloud account changed. Sign in again.',open:true}};
  // One entitlement read at admission; turns never wait on billing.
  const expected={userId:identity.userId,organizationId:identity.organizationId??null};
  let checked:Awaited<ReturnType<typeof checkEntitlement>>;
  try{
    checked=await checkEntitlement(client.entitlementSource(),expected,signal);
    signal.throwIfAborted();
    if(service!==account || (await cloudCredentialStore.read(environment))?.credentialId!==account.identity.credentialId)throw Error('Cloud account changed. Sign in again.');
  }catch(error){
    signal.throwIfAborted();
    // An entitlement for another account, a rejected sign-in or a changed account: nothing is bound.
    if(isEntitlementSignInFailure(error)||(error instanceof EntitlementError&&error.code==='account-mismatch')||(error instanceof Error&&error.message==='Cloud account changed. Sign in again.')){
      if(isEntitlementSignInFailure(error)&&service===account)detachService();
      update({residentPlanNotice:null,residentSubscription:null,planEndsAt:null});
      return {binding:'unbound',notice:{error:errorMessage(error),open:true}};
    }
    // Cloud went unreachable between identity and plan: the same rule as offline admission.
    const recent=cloudUnreachable(error)?recentPlanAdmission(environment,account.identity.credentialId,account.identity.userId):null;
    if(cloudUnreachable(error)){update({residentPlanNotice:'offline',residentSubscription:{kind:'unavailable',reason:'outage'},planEndsAt:recent?.endsAt??null});return {binding:recent?'kept':'unbound',notice:{message:OFFLINE_NOTICE}};}
    update({residentPlanNotice:'needs-plan',residentSubscription:{kind:'unavailable',reason:'outage'},planEndsAt:null});
    return {binding:'unbound'};
  }
  let view=checked.view,decision=planAdmission(view);
  const recent=recentPlanAdmission(environment,account.identity.credentialId,account.identity.userId);
  // A billing outage after a recent verified plan keeps the binding: Cloud still decides each AI request.
  if(decision==='unknown'&&view.kind==='unavailable'&&view.reason==='outage'&&recent)decision=recent.status==='past_due'?'admit-with-warning':'admit';
  // End of the plan window when Cloud reported one: the billing snapshot's period end, a redeemed grant's end, or the last known.
  const endsAt=view.kind==='credits'?null:view.kind==='active'&&view.source==='billing-limits'&&view.expiresAt>0?view.expiresAt:recent?.endsAt??(state.cloudAccount?.credentialId===account.identity.credentialId?state.planEndsAt??null:null);
  if(decision==='needs-plan'||decision==='unknown'){
    // No admissible plan: the agent runs without Cloud inference; the plan notice offers Redeem
    // code / Choose a plan / Check plan again. Nothing is bound.
    if(decision==='needs-plan')writePlanAdmission(null);
    update({residentSubscription:view,residentPlanNotice:'needs-plan',planEndsAt:null});
    return {binding:'unbound',account};
  }
  if(view.kind==='active'||view.kind==='credits')writePlanAdmission({version:1,environment,credentialId:account.identity.credentialId,userId:account.identity.userId,organizationId:account.identity.organizationId??null,status:view.kind==='credits'?'credit-funded':view.status,planName:view.kind==='credits'?`${cloudServiceName(cloud.environment)} credits`:view.planName,verifiedAt:Date.now(),endsAt});
  update({residentSubscription:view,residentPlanNotice:null,planEndsAt:endsAt});
  // Background refresh: it updates what the owner sees, never interrupts a turn, and unbinds Cloud
  // inference (the agent keeps running) when Cloud reports the plan ended. Revocation is enforced
  // by Cloud immediately.
  entitlementRefresher=new EntitlementRefresher({entitlement:checked.entitlement,fallbackActive:checked.view.kind==='credits'||checked.view.kind==='active'&&checked.view.source==='billing-limits',retry:checked.view.kind==='unavailable'&&checked.view.reason!=='not-published',
    check:refreshSignal=>checkEntitlement(client.entitlementSource(),expected,refreshSignal),
    onView:next=>{if(service!==account)return;update({residentSubscription:next,...(next.kind==='credits'?{planEndsAt:null}:{})});
      const nextDecision=planAdmission(next);
      if((next.kind==='active'&&!next.refreshFailed)||next.kind==='credits')writePlanAdmission({version:1,environment,credentialId:account.identity.credentialId,userId:account.identity.userId,organizationId:account.identity.organizationId??null,status:next.kind==='credits'?'credit-funded':next.status,planName:next.kind==='credits'?`${cloudServiceName(cloud.environment)} credits`:next.planName,verifiedAt:Date.now(),endsAt:next.kind==='credits'?null:(state.planEndsAt??null)});
      if(nextDecision==='needs-plan')residentPlanEnded(account,next);},
    onAuthFailure:error=>{if(service===account)residentRefreshRefused(account,error);}});
  return {binding:'cloud',credentialId:account.identity.credentialId,account};
}
/**
 * Cloud reported, on a background refresh, that the plan ended: Eliza Cloud inference is unbound
 * from the running agent. The agent keeps running (restarted without the provider when needed).
 */
function residentPlanEnded(account:NonNullable<typeof service>,view:SubscriptionView){
  stopEntitlementRefresh();writePlanAdmission(null);
  if(service!==account)return;
  update({residentSubscription:view,residentPlanNotice:'needs-plan',planEndsAt:null});
  queueResidentRebind();
}

/**
 * A background refresh found the admitted account is no longer valid: a rejected sign-in, or an
 * entitlement issued for a different account. The same rule as admission applies: Cloud inference
 * is unbound, the agent keeps running and the owner is asked to sign in again. Anything else stays
 * an outage view.
 */
function residentRefreshRefused(account:NonNullable<typeof service>,error:unknown){
  if(!isEntitlementSignInFailure(error)){update({residentSubscription:{kind:'unavailable',reason:'outage'}});return;}
  stopEntitlementRefresh();
  if(service!==account)return;
  queueResidentRebind();
}
/**
 * Reads the account and plan again without opening the dialog (the owner returned to Alpha, or
 * the network came back). The running agent is rebound only when its binding must change; a start
 * that failed is retried. Never stops the agent because of plan state.
 */
async function recheckResidentPlan(){
  if(operation)return;
  if(!state.session||active?.kind!=='resident'){queueResidentRebind();return;}
  const controller=new AbortController();operation=controller;
  try{
    const admission=await admitCloudResident(controller.signal);
    const target=residentBindable()?admission.binding:residentBinding;
    if(target!=='kept'&&target!==residentBinding)residentRebindQueued=true;
    else if(admission.notice?.open||admission.notice?.error)update({open:true,purpose:state.purpose==='plan'||state.purpose==='cloud-account'?state.purpose:'agent',message:'',error:admission.notice.error??''});
  }catch{/* The next return checks again; the agent keeps running as it is. */}
  finally{if(operation===controller)operation=null;runQueuedResidentRebind();}
}
/** Bind or unbind Eliza Cloud inference before the agent starts. Returns the binding in effect. */
async function applyResidentBinding(admission:ResidentAdmission,signal:AbortSignal):Promise<{binding:'cloud'|'unbound'|'kept'|'unknown';error?:string}> {
  if(!residentBindable())return {binding:admission.binding};
  if(admission.binding==='kept')return {binding:'kept'};
  if(admission.binding==='cloud'&&admission.credentialId&&admission.account){
    try{
      // An admitted running resident under this same Cloud admission is reused, not stopped and
      // rebound: opening the assistant, or reconnecting one surface, must not retire the other's work.
      await bindResidentCloudProvider(admission.credentialId);
      signal.throwIfAborted();
      if(service!==admission.account || (await cloudCredentialStore.read(residentEnvironment()))?.credentialId!==admission.credentialId)throw Error('Cloud account changed. Sign in again.');
      return {binding:'cloud'};
    }catch(error){
      signal.throwIfAborted();
      // The agent always starts. It is reported unbound only after native confirms removal;
      // otherwise its inference state is unconfirmed (native still gates a Cloud binding on a
      // valid production credential at use time) and the owner can retry in Settings.
      try{await clearLocalProvider();}catch{signal.throwIfAborted();return {binding:'unknown',error:`AI could not be connected to your ${cloudServiceName(cloud.environment)} plan: ${errorMessage(error)} ${RESIDENT_UNBIND_UNCONFIRMED}`};}
      signal.throwIfAborted();
      return {binding:'unbound',error:`AI could not be connected to your ${cloudServiceName(cloud.environment)} plan: ${errorMessage(error)} Your agent is running; check your plan again in Settings.`};
    }
  }
  // Unbound: remove any stored Cloud inference binding. A no-op (no restart) when none is stored.
  // A removal native cannot confirm never stops the agent from starting; it is shown as unconfirmed.
  try{await clearLocalProvider();}catch{signal.throwIfAborted();return {binding:'unknown',error:RESIDENT_UNBIND_UNCONFIRMED};}
  signal.throwIfAborted();
  return {binding:'unbound'};
}
/** The packaged-runtime refusal. Android production without the runtime is a non-distributable
 * developer build (--allow-unpackaged-runtime); browser development needs the host agent running. */
const RESIDENT_UNPACKAGED = !testMocksEnabled ? 'This developer build does not include the on-device agent.' : !isAndroid && browserLocalAgentEnabled ? 'The local agent on this computer is not running. Start it with bun run dev.' : webCloudUnavailable() ? 'The local agent is unavailable here. Alpha runs its agent on the phone; this preview needs the local agent.' : 'The local agent is unavailable in this version. Connect a remote agent or sign in with Cloud.';
async function connectResident(signal: AbortSignal) {
  let admission:ResidentAdmission|null=null,bound:Awaited<ReturnType<typeof applyResidentBinding>>|null=null;
  if(residentCloudFlow()){
    admission=await admitCloudResident(signal);
    // QA on staging (or in a browser) stops at plan admission: the on-device agent's Cloud
    // inference binding is production-only, so nothing is started under another environment.
    if(testMocksEnabled&&!residentBindable()){update({open:true,message:`Plan ${admission.binding==='cloud'?'admitted':'not admitted'} on ${residentEnvironment()} (subscription gate QA). The on-device agent is not started in this mode.`,error:''});return;}
    // A required sign-in is asked for now, while the agent starts behind it (connecting closes the
    // dialog, so it is opened again below once the agent runs).
    if(admission.notice?.open)update({open:true,purpose:state.purpose==='plan'||state.purpose==='cloud-account'?state.purpose:'agent',error:admission.notice.error??''});
    bound=await applyResidentBinding(admission,signal);
  }
  if (!await localAgentPackaged()) throw new Error(RESIDENT_UNPACKAGED);
  signal.throwIfAborted();
  const client = new LocalAgentProtocol();
  const { session, name } = await client.connect(signal).catch(error => {
    residentStartFailure = errorMessage(error);
    throw error;
  });
  residentStartFailure = '';
  signal.throwIfAborted();
  let actions:DeviceActions|undefined;
  let deviceRequest:DeviceRequest|undefined;
  const workflowProtocol=await workflowPresentationProtocol(signal);
  let userTextFormatVersion:1|undefined;
  let reason='';
  try {
    const store=isAndroid?secureConnectionStore:developmentDeviceStore;
    const journal=isAndroid?actionJournal:developmentActionJournal;
    const baseScope=await actionScope(JSON.stringify([client.origin,session.ownerId,session.agentId]));
    const slot=`device:${baseScope}`;
    let credential=await store.read<DeviceCredential>(slot);
    if(!credential){credential={installationId:crypto.randomUUID(),key:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')};await store.write(slot,credential);}
    if(!/^[a-f0-9]{64}$/.test(credential.key)||!/^[a-f0-9-]{36}$/.test(credential.installationId))throw Error('Invalid device identity');
    // Browser and Android use the same reviewed local-record contracts.
    const headers={'X-Eliza-Device-Id':credential.installationId,'X-Eliza-Device-Key':credential.key,'X-Eliza-Device-Capabilities':'calendar.local-event.v1,notes.local-record.v1'};
    const request=(path:string,body:unknown|undefined,requestSignal:AbortSignal)=>client.request(path,body,requestSignal,headers);
    const registered=await request('/api/client-devices/register',{label:isAndroid?'Alpha Phone':'Alpha browser development',workflowProtocol},signal);
    if(registered.installationId!==credential.installationId||typeof registered.enrollmentId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId))throw Error('Device registration was not verified');
    if(registered.userTextFormatVersion===1)userTextFormatVersion=1;
    reason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);
    headers['X-Eliza-Device-Capabilities']=await deviceCapabilities(registered.capabilities);
    credential.enrollmentId=registered.enrollmentId;await store.write(slot,credential);signal.throwIfAborted();
    client.deviceHeaders=headers;
    credential.capabilities=headers["X-Eliza-Device-Capabilities"].split(",");
    actions=new DeviceActions(session,credential,await actionScope(JSON.stringify([baseScope,credential.installationId])),request,journal,(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity)=>deviceExecutor(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity),(op,id,binding,recoverySignal)=>deviceRecovery?deviceRecovery(op,id,binding,recoverySignal):Promise.resolve({status:'unknown'}),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    deviceRequest=request;
  } catch(error) {signal.throwIfAborted();reason='Local chat connected. Device actions are unavailable: '+(error instanceof Error?error.message:'Enrollment failed.');}
  save({kind:'resident'});
  activate({kind:'resident',remote:client,origin:client.origin,actions,workflowProtocol,request:deviceRequest,...(userTextFormatVersion?{userTextFormatVersion}:{})},session,name);
  if(reason)update({phoneCapabilityReason:reason});
  // Restore only the saved choice for this verified agent and owner; opening history never replays actions.
  if(residentCloudFlow()&&admission&&bound){
    residentBinding=bound.binding;
    update({residentInference:bound.binding==='cloud'?'cloud':bound.binding==='unbound'?'unavailable':'unknown'});
    // The agent is running. A sign-in that is still required keeps the (non-dismissible) sign-in
    // dialog; everything else is a notice beside the running agent, never a gate.
    // Both a refused sign-in and an unconfirmed unbind are shown; neither hides the other.
    const notice=admission.notice,error=[notice?.error,bound.error].filter(Boolean).join(' ')||undefined;
    if(notice?.open||error)update({open:true,purpose:state.purpose==='plan'||state.purpose==='cloud-account'?state.purpose:'agent',message:notice?.message??'',error:error??''});
    else if(notice?.message)update({message:notice.message});
    await restoreSavedHistory(signal);await refreshActionReview(signal);
  }else if(browserLocalAgentEnabled)await restoreSavedHistory(signal);
}
async function connectCloud(agentId: string, signal: AbortSignal, expectedOwner?: string, expectedOrigin?:string, expectedPersonalOwner?:Readonly<PersonalOwner>) {
  const client=developmentCloud();
  client.setPhoneTarget(null);
  const identity = await verifyService(client, signal); signal.throwIfAborted();
  const verifyPersonalOwner=async()=>{
    if(!expectedPersonalOwner)return;
    const credential=await cloudCredentialStore.read(client.environment);signal.throwIfAborted();
    if(cloud!==client||client.environment!==expectedPersonalOwner.environment||credential?.credentialId!==expectedPersonalOwner.credentialId||identity.userId!==expectedPersonalOwner.userId||identity.organizationId!==expectedPersonalOwner.organizationId||service?.identity.credentialId!==expectedPersonalOwner.credentialId||service.identity.userId!==expectedPersonalOwner.userId||service.identity.organizationId!==expectedPersonalOwner.organizationId)throw Error('Cloud account changed. Refresh your personal agent before connecting.');
  };
  await verifyPersonalOwner();
  if (expectedOwner && identity.userId !== expectedOwner) throw new Error('The Cloud account has changed. Refresh agents and choose an agent for this account.');
  const agent = await client.agentDetail(agentId, signal);
  await verifyPersonalOwner();
  if (agent.status !== 'running' || !agent.runtimeUrl) throw new Error('This agent is not ready. Refresh its status.');
  if(expectedOrigin&&new URL(agent.runtimeUrl).origin!==new URL(expectedOrigin).origin)throw Error('The personal Cloud runtime changed. Refresh its status.');
  const session = {ownerId:identity.userId,agentId,sessionId:crypto.randomUUID(),origin:new URL(agent.runtimeUrl).origin};
  const workflowProtocol=await workflowPresentationProtocol(signal);
  const next: Extract<Active,{kind:'cloud'}> = {kind:'cloud',cloud:client,agentId,workflowProtocol};
  let attached = false;
  let reason = 'This Cloud runtime has not enabled verified phone actions, workflows or paired speech.';
  try {
    const auth = await cloudCredentialStore.read(client.environment);
    await verifyPersonalOwner();
    if (!auth?.credentialId || !identity.organizationId) throw new Error('Cloud owner configuration unavailable');
    const baseScope = await actionScope(JSON.stringify(['cloud',session.origin,identity.userId,agentId]));
    const slot = `device:${baseScope}`;
    next.deviceSlot = slot;
    let credential = await secureConnectionStore.read<DeviceCredential>(slot);
    if (!credential) { credential={installationId:crypto.randomUUID(),key:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('')}; await secureConnectionStore.write(slot,credential); }
    if (!/^[a-f0-9]{64}$/.test(credential.key) || !/^[a-f0-9-]{36}$/.test(credential.installationId)) throw new Error('Invalid saved device identity');
    const target: CloudPhoneTarget = {agentId,origin:session.origin,userId:identity.userId,organizationId:identity.organizationId,credentialId:auth.credentialId,headers:{'X-Eliza-Device-Id':credential.installationId,'X-Eliza-Device-Key':credential.key,'X-Eliza-Device-Capabilities':'calendar.local-event.v1,notes.local-record.v1'}};
    const request = async (path:string,body:unknown|undefined,requestSignal:AbortSignal) => {
      if(attached && state.session?.sessionId!==session.sessionId)throw new Error('Cloud agent changed');
      const result=await client.phoneRequest(target,path,requestSignal,body);
      if(attached && state.session?.sessionId!==session.sessionId)throw new Error('Cloud agent changed');
      return result;
    };
    const capability = await request('/api/client-devices/capabilities',undefined,signal);
    const external=capability.externalIdentity as Record<string,unknown>|undefined,device=capability.deviceActions as Record<string,unknown>|undefined;
    if (capability.protocol!==1 || capability.agentId!==agentId || typeof capability.identityId!=='string' || !/^[a-f0-9-]{36}$/.test(capability.identityId) || external?.subject!==identity.userId || external?.organizationId!==identity.organizationId || typeof external?.issuer!=='string' || !external.issuer.startsWith('https://') || device?.protocol!==1 || !Array.isArray(device.capabilities) || !device.capabilities.includes('calendar.local-event.v1')) throw new Error('Cloud runtime owner capability was not verified');
    target.headers["X-Eliza-Device-Capabilities"]=await deviceCapabilities(device?.capabilities);
    session.ownerId=capability.identityId;
    const registered=await request('/api/client-devices/register',{label:'Alpha Phone',workflowProtocol},signal);
    if (registered.installationId!==credential.installationId || typeof registered.enrollmentId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId)) throw new Error('Cloud device registration was not verified');
    const profileReason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);

    credential.enrollmentId=registered.enrollmentId; await secureConnectionStore.write(slot,credential); signal.throwIfAborted();
    credential.capabilities=target.headers["X-Eliza-Device-Capabilities"].split(",");
    next.actions=new DeviceActions(session,credential,await actionScope(JSON.stringify([baseScope,credential.installationId])),request,actionJournal,(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity)=>deviceExecutor(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:"unknown"}),target.headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),target.headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    next.revokeDevice=async revokeSignal=>{try{await client.phoneRequest(target,'/api/client-devices/revoke',revokeSignal,{});return true;}catch{revokeSignal.throwIfAborted();return false;}};
    next.request=request;
    next.phoneTarget=target; next.voiceExpiresAt=Math.min(auth.expiresAt ?? Infinity,Date.now()+30*60*1000);
    await secureConnectionStore.write(`cloud-runtime:${session.sessionId}`,{environment:client.environment,credentialId:auth.credentialId,origin:session.origin,agentId,ownerId:session.ownerId,userId:identity.userId,organizationId:identity.organizationId,sessionId:session.sessionId,expiresAt:next.voiceExpiresAt});
    signal.throwIfAborted(); client.setPhoneTarget(target); reason=profileReason;
  } catch (error) {
    signal.throwIfAborted();
    if (expired(error)) throw error;
    next.actions=undefined;next.phoneTarget=undefined;next.voiceExpiresAt=undefined;next.revokeDevice=undefined;session.ownerId=identity.userId;
  }
  await verifyPersonalOwner();signal.throwIfAborted();
  save({ kind:'cloud',environment:client.environment,agentId,ownerId:identity.userId });
  activate(next,session,agent.name || `${cloudServiceName(cloud.environment)} agent`); attached=true; update({phoneCapabilityReason:reason});
  await restoreSavedHistory(signal);
}

/**
 * Production builds have no mock mode. A stored mock choice from an older or test
 * build becomes "no selection": the chooser opens and nothing resumes on its own.
 * Paused native collectors stay paused until an explicit connection choice.
 */
function migrateLegacyMock(): boolean {
  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem(SELECTION) || 'null'); } catch { return false; }
  if (!stored || typeof stored !== 'object' || (stored as { kind?: unknown }).kind !== 'mock') return false;
  // P-43: where the resident is always present, a stored mock choice becomes the resident and startup continues.
  if (residentAlwaysPresent) { try { save({ kind: 'resident' }); } catch { /* The resident starts either way. */ } return false; }
  try { save({ kind: 'none' }); } catch { /* The open chooser still requires an explicit choice. */ }
  update({ open: true, message: 'This version connects to real agents only. Choose how to connect your agent.' });
  return true;
}
/** Saved selection kinds of the retired hosted and paired agents (remote, local development, Cloud). */
function legacyHostedKind(kind: unknown): kind is 'remote' | 'local' | 'cloud' { return kind === 'remote' || kind === 'local' || kind === 'cloud'; }
/** Where migrated hosted-agent selections are kept, oldest first, unread by product code, for recovery and diagnostics. */
export const LEGACY_HOSTED_SELECTION = 'alpha.connection.legacy-hosted-selection.v1';
/**
 * The agent always runs on the phone (#406): product builds have no remote, paired or Cloud-hosted
 * agent. A saved selection of one from an earlier build becomes the resident agent. The old choice is
 * appended to LEGACY_HOSTED_SELECTION, not deleted: every earlier record (and an unreadable one, as
 * its raw text) is kept. Nothing is connected to it: no credential slot is read or removed, no request
 * is made, and conversation selections and history stay where they are. In the product web build,
 * which has no on-device agent, the stored 'resident' only names the Android agent: the web branch
 * of initialize() never connects it and shows the chooser. Test-mocks builds keep their development
 * selections.
 */
function migrateLegacyHostedSelection(): boolean {
  if (testMocksEnabled) return false;
  let stored: unknown = null;
  try { stored = JSON.parse(localStorage.getItem(SELECTION) || 'null'); } catch { return false; }
  if (!stored || typeof stored !== 'object' || !legacyHostedKind((stored as { kind?: unknown }).kind)) return false;
  try {
    let kept: unknown[] = [];
    try { const prior: unknown = JSON.parse(localStorage.getItem(LEGACY_HOSTED_SELECTION) || '[]'); kept = Array.isArray(prior) ? prior : [prior]; } catch { kept = [localStorage.getItem(LEGACY_HOSTED_SELECTION)]; }
    localStorage.setItem(LEGACY_HOSTED_SELECTION, JSON.stringify([...kept, stored]));
    save({ kind: 'resident' });
  } catch { /* selection() already reads the stored choice as the resident agent. */ }
  return true;
}
/**
 * Every Alpha Phone signs in to Eliza Cloud and holds a plan, and its on-device agent ALWAYS runs.
 * The retired local-apps-only choice is migrated on the next launch: only that
 * preference is replaced, and no data, history or credential is removed. A signed-out phone shows
 * the sign-in dialog while the agent runs without Cloud inference.
 */
async function startResidentGate(){
  // P-43: the resident always starts, signed in or not; a stored local-only choice reads as the resident.
  try{save({kind:'resident'});}catch{/* The resident starts either way. */}
  await startResident();
}
function conversationKey(session: VerifiedSession) { return JSON.stringify([session.origin, session.ownerId, session.agentId]); }
async function ensureSelectedConversation(selected:Active,session:VerifiedSession,signal:AbortSignal,current:()=>void):Promise<string>{
 const key=conversationKey(session),cached=await captureConversationChoice(key,signal);current();
 let id=conversationMemory.has(key)?conversationMemory.get(key):cached?.id;
 if(typeof id!=='string'||!id){
  const created=selected.kind==='cloud'?await selected.cloud.createConversation(selected.agentId,'Alpha Phone',signal):await selected.remote.createConversation('Alpha Phone',signal);current();id=created.id;
  let saved=true;try{await selectConversation(key,cached,id,signal,current);}catch{saved=false;}
  current();conversationMemory.set(key,id);update({});
  if(!saved)update({message:'Conversation is connected for this session. Its selection could not be saved for restart.'});
 }
 if(!conversationMemory.has(key)){current();conversationMemory.set(key,id);}
 return id;
}

/** Only remove an exact Alpha-generated prefix from restored user prose. */
function restoredText(text: string, userTextFormat?:unknown): string {
  // An explicit format, including an unknown future value, is never a legacy
  // transport envelope. Preserve literal authored banners byte for byte.
  if(userTextFormat!==undefined)return text;
  const marker = '\n[/CURRENT-TURN CLIENT OBSERVATION]\n[USER MESSAGE]\n';
  const end = text.indexOf(marker);
  if (!text.startsWith('[CURRENT-TURN CLIENT OBSERVATION]\n') || end < 0) return text;
  try {
    const lastLine = text.slice(0, end).split('\n').at(-1)!;
    const { source, ...context } = JSON.parse(lastLine);
    const prose = text.slice(end + marker.length);
    if (source === 'Alpha Phone client' && phoneContextMessage(prose, context).text === text) return prose;
  } catch { /* Unrecognized text remains authored text. */ }
  return text;
}
function restoredMessages(items:Record<string,unknown>[]):RestoredMessage[] {
  return items.filter(item=>item.role==='user'||item.role==='assistant').map(item=>{
    if(typeof item.id!=='string'||!item.id||typeof item.text!=='string'||item.text.length>200000)throw Error('The agent returned invalid history.');
    return {id:item.id,from:item.role==='user'?'user':'agent',text:item.role==='user'?restoredText(item.text,item.userTextFormat):item.text};
  });
}
/** Eliza Cloud's API answers credentialed browser requests only from Eliza's own origins
 * (pinned upstream `cloud-api-hono-cors.ts`), so the flag-off web build cannot sign in or read the
 * account. It offers the account page instead of a sign-in that would always fail. */
/** Says what a refused pairing means. Nothing was connected; 401 and 503 keep their shared wording. */
function pairingError(error: unknown, withCode: boolean): unknown {
  if (!(error instanceof RemoteProtocolError) || error.status === 401 || error.status === 503) return error;
  const text = ['invalid_origin', 'origin_required', 'https_required'].includes(error.code) ? 'Enter the agent’s HTTPS address without a path, for example https://your-agent.example. Nothing was sent.'
    : error.code === 'pairing_unavailable' ? 'This agent is not accepting pairing. Enable pairing on the agent, then try again.'
    : error.code === 'session_expired' ? 'The saved session for this agent has expired. Enter a new pairing code.'
    : ['owner_session_required', 'machine_session_required', 'identity_changed', 'pairing_identity_mismatch'].includes(error.code) ? 'The agent did not confirm an owner session for this phone. Nothing was connected.'
    : error.code === 'remote_request_failed' && withCode && error.status !== undefined && error.status >= 400 && error.status < 500 ? 'The agent refused this pairing code. Codes expire and work once; ask your agent for a new one.'
    : 'The agent did not answer as expected. Nothing was connected.';
  return new Error(text, { cause: error });
}
/** After the provider key is removed or Cloud is signed out: the agent keeps running with AI off. */
const AI_OFF_MESSAGE = 'Your agent is running. Sign in to Cloud to turn AI back on.';
const PAIRING_RETIRED = 'Pairing is unavailable. Your agent runs on this device; sign in to Cloud for inference.';
const RESIDENT_SIGN_IN_EXPIRED = 'Your Cloud sign-in has expired. Sign in with Cloud again.';
const RATE_LIMITED = 'The agent provider is rate-limiting requests. Wait before sending again. Alpha Phone did not retry your message.';
/** Owner-facing states for upstream's CHAT_FAILURE_KINDS (pinned contracts `chat.ts`). Each says
 * what happened and what to do next; none retries the message. Unlisted kinds keep the generic text. */
export const REPLY_FAILURES = {
  hosted_unreachable: (serviceName: string) => `Hosted inference (${serviceName} / Cerebras) could not be reached; nothing was retried.`,
  provider_unreachable: 'The agent’s model provider could not be reached; nothing was retried.',
  no_provider_resident: (serviceName: string) => `Your agent answered without its ${serviceName} AI connection. Check ${serviceName} again; nothing was retried.`,
  no_provider: 'The agent has no model provider configured. Set one up on the agent; nothing was retried.',
} as const;
/** The upstream failure kind a reply or a stream error frame carried, if any. */
function failureKindOf(value:unknown):string|undefined {
  if(!value||typeof value!=='object')return undefined;
  const {failureKind,terminalFailure}=value as {failureKind?:unknown;terminalFailure?:unknown};
  if(typeof failureKind==='string')return failureKind;
  const kind=terminalFailure&&typeof terminalFailure==='object'?(terminalFailure as {kind?:unknown}).kind:undefined;
  return typeof kind==='string'?kind:undefined;
}
/** The error a failed reply surfaces. Cloud's own refusal (rate limit, used allowance, no active
 * plan, billing) carries its retry information and is presented as such; the phone never retries,
 * upgrades or buys anything. Mapped kinds carry `failureKind` (and `serviceLimit` for Cloud limits)
 * so the chat can offer the next step (plan, sign-in); the rest keep the generic text. */
function replyFailure(kind:string|undefined,selected:Active,limit:ServiceLimit|null):Error {
  if(selected.kind==='resident'&&(limit?.kind==='subscription-required'||limit?.kind==='billing-refused'))connectionController.recheckPlanAfterRefusal();
  if(limit)return Object.assign(new AlphaClientError('transport-failed',serviceLimitMessage(limit, Date.now(), cloudServiceName(cloud.environment))),{failureKind:kind??limit.kind,serviceLimit:limit.kind});
  if(kind==='rate_limited')return new AlphaClientError('transport-failed',RATE_LIMITED);
  // The on-device agent without Eliza Cloud inference (no plan, offline, signed out): the same honest
  // answer as a recorded provider-less reply, with its plan action. Nothing is retried or purchased.
  if(kind==='no_provider'&&selected.kind==='resident'&&residentCloudFlow()){
    // Bound to an admitted plan, yet the agent ran without a provider: say so and offer a recheck.
    if(state.residentInference==='cloud')return Object.assign(new AlphaClientError('transport-failed',REPLY_FAILURES.no_provider_resident(cloudServiceName(cloud.environment))),{failureKind:kind,planAction:'retry'});
    const notice=state.residentPlanNotice??null,signedIn=!!state.cloudAccount;
    return Object.assign(new AlphaClientError('transport-failed',inferenceUnavailableReply(notice,signedIn)),{failureKind:kind,planAction:notice==='offline'?'retry':signedIn?'plan':'sign-in'});
  }
  const resident=selected.kind==='resident'&&isAndroid,serviceName=cloudServiceName(cloud.environment);
  // insufficient_credits is a Cloud billing refusal (readServiceLimit above), never a mapped kind here.
  const text=kind==='provider_issue'||kind==='generation_timeout'?(resident?REPLY_FAILURES.hosted_unreachable(serviceName):REPLY_FAILURES.provider_unreachable)
    :kind==='no_provider'?(resident?REPLY_FAILURES.no_provider_resident(serviceName):REPLY_FAILURES.no_provider):undefined;
  return text?Object.assign(new AlphaClientError('transport-failed',text),{failureKind:kind}):new Error('The agent could not complete this response.');
}
/** After a failed reply or a lost network, "Connected" is no longer a true statement; only a later
 * connection (which reads the plan) sets it again. */
function retractReadiness(){if(state.message==='Connected')update({message:''});}
export const WEB_CLOUD_UNAVAILABLE = 'Cloud sign-in is available in the Alpha Phone Android app. Cloud does not accept sign-in requests from this web page.';
/** Stop closes the transport and asks the agent to cancel through upstream's
 * `POST /api/turns/:roomId/abort` (resident, remote and local agents). Cloud agents and agents that
 * refuse that route keep the honest "may still finish" state. Either way one later read of the
 * conversation shows the reply if the agent finished it before or despite the cancel. */
const STOPPED_REPLY_CHECK_MS = 15_000;
export const STOPPED_REPLY_NOTICE = 'The agent may still finish this reply. Alpha Phone will check once and show it here if it does.';
export const STOPPED_CONFIRMED_NOTICE = 'The agent stopped this reply.';
export const STOPPED_CANCELLED_NOTICE = 'The agent cancelled this reply. Alpha Phone will check once in case it had already finished.';
let stoppedReply: { timer: ReturnType<typeof setTimeout>; controller: AbortController } | null = null;
function cancelStoppedReply() { if (!stoppedReply) return; clearTimeout(stoppedReply.timer); stoppedReply.controller.abort(); stoppedReply = null; }
/** A restart can land while the resident still holds the reply to the last message: the stop-check
 * timer died with the old process. A restored conversation ending in that recent user turn gets the
 * same single later read (no cancel attempt); nothing is sent. Only the restore that follows a
 * connection does this (not a message edit's re-read). Older unanswered turns are left alone. */
const RESTORED_REPLY_WINDOW_MS = 10 * 60_000;
function scheduleStoppedReply(selected: Active, session: VerifiedSession, conversationId: string, turn: StoppedTurn, delay = STOPPED_REPLY_CHECK_MS, cancelTurn = true) {
  cancelStoppedReply();
  const generation = epoch, controller = new AbortController();
  // The check belongs to the stopped conversation: selecting another one retires it.
  const current = () => !controller.signal.aborted && generation === epoch && selected === active && state.session?.sessionId === session.sessionId && conversationMemory.get(conversationKey(session)) === conversationId;
  // An earlier turn's confirmed stop is not this turn's outcome.
  update({ replyNotice: STOPPED_REPLY_NOTICE, ...(state.message === STOPPED_CONFIRMED_NOTICE ? { message: '' } : {}) });
  let cancelled = false;
  // The single reconciliation read waits for the cancel attempt, so it reports the settled outcome.
  const cancelAttempt = selected.kind === 'cloud' || !cancelTurn ? Promise.resolve() : selected.remote.abortTurn(conversationId, controller.signal).then(outcome => {
    if (outcome !== 'aborted' || !current() || stoppedReply?.controller !== controller) return;
    cancelled = true; update({ replyNotice: STOPPED_CANCELLED_NOTICE });
  }, () => {});
  const timer = setTimeout(() => { void (async () => {
    try {
      await cancelAttempt;
      // Never replace the visible chat while the user has started another request.
      if (!current()) return;
      if (sending || operation) { update({ replyNotice: 'Load this conversation from Agent connection to see whether the stopped reply finished.' }); return; }
      const result = await readConversation(selected, conversationId, controller.signal, () => { if (!current()) throw Error('The agent changed.'); });
      if (!current()) return;
      // Another operation began during the read: say so instead of leaving "will check once" standing.
      if (sending || operation) { update({ replyNotice: 'Load this conversation from Agent connection to see whether the stopped reply finished.' }); return; }
      // By clientMessageId when the agent returns it (two turns may share text), else by text and time.
      const user = findStoppedUserTurn(result.messages, turn, restoredText);
      const index = user ? result.messages.indexOf(user) : -1;
      const reply = user && (result.messages.find(item => item.role === 'assistant' && item.replyToMessageId === user.id) ?? result.messages.slice(index + 1).find(item => item.role === 'assistant' && item.replyToMessageId === undefined));
      if (!user) { update({ replyNotice: 'The agent did not record the stopped message.' }); return; }
      if (!reply || typeof reply.text !== 'string' || !reply.text.trim()) { update(cancelled ? { replyNotice: '', message: STOPPED_CONFIRMED_NOTICE } : { replyNotice: 'The agent had not finished the stopped reply when Alpha Phone checked. Load conversations later to see it.' }); return; }
      update({ history: { sessionId: session.sessionId, conversationId, revision: (state.history?.revision || 0) + 1, messages: restoredMessages(result.messages), automatic: true }, historyPartial: result.partial, replyNotice: '', message: 'The agent finished the stopped reply.' });
    } catch { if (current()) update({ replyNotice: 'The stopped reply could not be checked. Load conversations from Agent connection to see it.' }); }
    finally { if (stoppedReply?.controller === controller) stoppedReply = null; }
  })(); }, delay);
  stoppedReply = { timer, controller };
}
async function conversationList(selected: Active, signal: AbortSignal) {
  const list = selected.kind === 'cloud' ? await selected.cloud.listConversations(selected.agentId, signal) : await selected.remote.listConversations(signal);
  return list.map(item => ({ id: item.id, title: typeof item.title === 'string' && item.title ? item.title : 'Conversation' }));
}

async function restoreConversationHistory(id:string,signal:AbortSignal,automatic:boolean,afterConnect=false) {
  const selected=active,session=state.session,generation=epoch;
  if(!selected||!session)throw noSessionError(NO_SESSION_FALLBACK);
  const account=selected.kind==='resident'&&residentCloudFlow()?service:null;
  // P-43: a signed-out resident still owns its history and actions; a bound Cloud account must stay the same one.
  const assertCurrent=()=>{signal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId||account&&(service!==account||state.cloudAccount?.sessionId!==account.identity.sessionId))throw Error('The agent or account changed.');};
  const assertAccount=async()=>{
    assertCurrent();
    if(account){const credential=await cloudCredentialStore.read(account.identity.environment);assertCurrent();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}
  };
  const key=conversationKey(session),expected=await captureConversationChoice(key,signal);
  await assertAccount();
  if(automatic&&expected?.id!==id)throw Error('Saved conversation selection changed.');
  const list=await conversationList(selected,signal);await assertAccount();
  if(!list.some(item=>item.id===id))throw Error('This conversation is no longer available to this agent.');
  const result=await readConversation(selected,id,signal,assertCurrent);
  assertCurrent();
  const messages=restoredMessages(result.messages);
  await assertAccount();
  let saved=true;
  if(!automatic)try{await selectConversation(key,expected,id,signal,assertCurrent);}catch{saved=false;}
  await assertAccount();
  if(automatic){
    const current=Capacitor.getPlatform()==='android'?captureConversationChoice(key,signal):await captureConversationChoice(key,signal);
    assertCurrent();
    if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Saved conversation selection changed.');
  }
  conversationMemory.set(key,id);
  const older=result.partial?' Older messages remain on the agent.':'';
  // An explicit reload already shows whether a stopped reply finished; the pending check is retired.
  if(!automatic)cancelStoppedReply();
  update({history:{sessionId:session.sessionId,conversationId:id,revision:(state.history?.revision||0)+1,messages,automatic},historyError:'',historyPartial:result.partial,...(automatic?{}:{open:false,replyNotice:''}),message:(automatic?'Saved conversation restored.':saved?'Conversation restored.':'History restored for this session; restart selection could not be saved.')+older});
  const last=result.messages.at(-1);
  if(afterConnect&&selected.kind==='resident'&&last?.role==='user'&&typeof last.text==='string'&&typeof last.timestamp==='number'&&last.timestamp>Date.now()-RESTORED_REPLY_WINDOW_MS)
    scheduleStoppedReply(selected,session,id,{text:restoredText(last.text,last.userTextFormat),sentAt:last.timestamp,...(typeof last.clientMessageId==='string'?{clientMessageId:last.clientMessageId}:{})},STOPPED_REPLY_CHECK_MS,false);
}
/** Restored chats are bounded; anything older stays on the agent and is reported as partial. */
const HISTORY_LIMIT=2000, HISTORY_PAGE=200;
/** Reads the recent window, then pages older messages with ?before=<createdAt>&beforeId=<id> until
 * the agent reports hasMore:false. A server that does not report hasMore for an older page (or
 * rejects the cursor) ends paging without duplicating messages. Messages stay oldest first. */
async function readConversation(selected:Active,id:string,signal:AbortSignal,assertCurrent:()=>void):Promise<{messages:Record<string,unknown>[];partial:boolean}> {
  const first=selected.kind==='cloud'?await selected.cloud.messages(selected.agentId,id,signal):await selected.remote.messages(id,signal);
  assertCurrent();
  let messages=first.messages.slice(),partial=false;
  const seen=new Set(messages.map(item=>item.id));
  // Cloud's adapter does not expose the older-page cursor yet; a full recent window may be partial.
  if(selected.kind==='cloud')return {messages:messages.slice(-HISTORY_LIMIT),partial:messages.length>=HISTORY_PAGE};
  while(messages.length){
    if(messages.length>=HISTORY_LIMIT){partial=true;break;}
    const oldest=messages[0],cursor=oldest.timestamp;
    if(typeof cursor!=='number'||!Number.isSafeInteger(cursor)||cursor<0){partial=messages.length>=HISTORY_PAGE;break;}
    const page:MessagePage={before:cursor,limit:HISTORY_PAGE,...(typeof oldest.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(oldest.id)?{beforeId:oldest.id}:{})};
    let older:{messages:Record<string,unknown>[];hasMore?:boolean};
    try{older=await selected.remote.messages(id,signal,page);}
    catch(error){signal.throwIfAborted();assertCurrent();partial=messages.length>=HISTORY_PAGE;break;}
    assertCurrent();
    if(typeof older.hasMore!=='boolean'){partial=messages.length>=HISTORY_PAGE;break;}
    const fresh=older.messages.filter(item=>!seen.has(item.id)&&typeof item.timestamp==='number'&&item.timestamp<=cursor);
    for(const item of fresh)seen.add(item.id);
    fresh.sort((a,b)=>(a.timestamp as number)-(b.timestamp as number));
    messages=[...fresh,...messages];
    if(!older.hasMore)break;
    if(!fresh.length){partial=true;break;}
  }
  if(messages.length>HISTORY_LIMIT){messages=messages.slice(-HISTORY_LIMIT);partial=true;}
  return {messages,partial};
}
/** Restores the saved conversation for any verified connection (resident, remote or Cloud).
 * The resident-specific name is kept for existing contract tests. */
const restoreSavedResidentHistory=(signal:AbortSignal)=>restoreSavedHistory(signal);
void restoreSavedResidentHistory;
async function restoreSavedHistory(signal:AbortSignal) {
  const selected=active,session=state.session,generation=epoch;
  if(!selected||!session)return;
  try{
    const saved=await captureConversationChoice(conversationKey(session),signal);signal.throwIfAborted();
    if(generation!==epoch||selected!==active||state.session!==session)return;
    if(saved)await restoreConversationHistory(saved.id,signal,true,true);
  }catch(error){
    signal.throwIfAborted();
    if(generation!==epoch||selected!==active||state.session!==session)return;
    update({historyError:'Saved conversation could not be restored. Your selected conversation was kept. Retry from Agent connection.',message:'Connected. Saved history needs another check.'});
  }
}

type HistoryEntry = { id:string; state:string; operation:unknown; local?:{status?:string;phase?:string;createdAt?:unknown;applyingAt?:unknown;finishedAt?:unknown;record?:Record<string,unknown>} };
const actionStateLabels:Record<string,string>={pending:'Waiting for your review',executing:'Started on this phone',reconciliation_required:'Needs your review',completed:'Completed',rejected:'Rejected',expired:'Expired',failed:'Not completed'};
/** Plain-language action history. Operation JSON never reaches the screen. */
export function presentActionEntry(entry:HistoryEntry,timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone){
  const operation=entry.operation as {type?:unknown;title?:unknown;text?:unknown}|null;
  let title='',detail='';
  try{const presented=presentDeviceRecordOperation(operation as never,timeZone);if(typeof presented?.title==='string'){title=presented.title;detail=presented.description.split('\n').map(line=>line.trim()).find(line=>line&&line!==presented.title)||'';}}catch{/* Other operations use the generic label below. */}
  if(!title){
    const type=typeof operation?.type==='string'?operation.type:'';
    title=type==='post_notification'?'Post notification':type==='speak_text'?'Read text aloud':type?type.replace(/[_-]+/g,' ').replace(/^./,letter=>letter.toUpperCase()):'Phone action';
    detail=typeof operation?.title==='string'?`“${operation.title}”`:'';
  }
  if(detail.length>160)detail=detail.slice(0,157)+'…';
  const local=entry.local,status=local?.status||local?.phase;
  const when=[local?.finishedAt,local?.applyingAt,local?.createdAt].find((value):value is number=>typeof value==='number'&&Number.isFinite(value));
  const timestamp=when===undefined?'':new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short',timeZone}).format(new Date(when));
  const outcome=status?`${actionStateLabels[entry.state]||entry.state} · this phone: ${status}`:`${actionStateLabels[entry.state]||entry.state} · not dispatched by this phone`;
  return {id:entry.id,state:entry.state,title,detail,outcome,timestamp,description:[title,detail,outcome,timestamp].filter(Boolean).join(' · ')};
}
async function readActionHistory(selected:Active,signal:AbortSignal,sync=false){
  if(!selected.actions)throw new Error('Verified phone actions are unavailable on this connection.');
  if(sync)await selected.actions.syncReceipts(signal);
  return (await selected.actions.history(signal) as HistoryEntry[]).map(entry=>presentActionEntry(entry));
}
/** After connecting, surface uncertain phone actions so the user can record what happened. */
async function refreshActionReview(signal:AbortSignal){
  const selected=active,generation=epoch;
  if(!selected?.actions)return;
  try{
    const entries=await readActionHistory(selected,signal);
    if(generation!==epoch||selected!==active)return;
    const review=entries.some(entry=>entry.state==='reconciliation_required');
    // Production action history lives in Settings. A background refresh must not replace sign-in
    // instructions or claim modal ownership over the current view.
    update({actionHistory:entries,...(review&&!(isAndroid&&!testMocksEnabled)?{open:true,message:'A phone action needs your review. Check this phone, then record whether it happened.'}:{})});
  }catch{signal.throwIfAborted();/* The history stays available from Phone action history. */}
}
function boundNavigation():ViewNavigationClient|undefined {
 const selected=active,session=state.session,generation=epoch;
 if(!selected?.request||!session||!navigationContext)return undefined;
 return selected.viewNavigation??=new ViewNavigationClient(selected.request,()=>active===selected&&state.session===session&&epoch===generation&&!state.open&&!state.busy,()=>navigationContext?.()??null);
}

/*
 * DEVELOPMENT INFRASTRUCTURE ONLY (#406). The agent always runs on the phone; remote pairing, the
 * local development agent and Cloud-hosted agents (discovery, personal/Dedicated setup, runtime
 * restore) exist only in ELIZA_DEV_ALLOW_TEST_MOCKS=1 builds. `hosted` is null in every product
 * build, so none of these functions is reachable or bundled there (the production bundle audit
 * denies their markers).
 */
async function pair(kind: 'remote' | 'local', origin: string, code: string) {
  await work('Verifying your agent…', async signal => { retire(); try { await connectRemote(kind, origin, code, signal); } catch (error) { throw pairingError(error, !!code.trim()); } });
}
async function restoreHosted(saved: Extract<Selection, { kind: 'cloud' | 'remote' | 'local' }>, signal: AbortSignal) {
  if (saved.kind === 'cloud') {
    cloud = makeCloud(saved.environment);
    const identity=await verifyService(cloud,signal);
    if(saved.ownerId&&identity.userId!==saved.ownerId)throw Error('The Cloud account changed. Review your personal agent before connecting.');
    await inspectPersonal(signal);
    const current=state.cloudPersonal;
    if(saved.ownerId&&current?.view?.kind==='ready'&&!current.blocked)await connectCloud(current.view.identity.activeAgentId!,signal,saved.ownerId,current.view.identity.apiBase,personalSetup?.client.owner);
    else update({open:true});
  }
  else await connectRemote(saved.kind, saved.origin, '', signal);
}
async function cloudList(environment: CloudEnvironment) {
  await work('Loading your agents…', async signal => { cloud = makeCloud(environment);
    if (service && service.identity.environment !== environment) { detachCloudTarget(); detachService(); }
    const previous = service?.identity.sessionId;
    try { await verifyService(cloud, signal); }
    catch (error) { if (previous) connectionController.rejectCloudSession(previous, error); throw error; }
    if (!active) save({ kind: 'none' });
    await inspectPersonal(signal); });
}
function personalDecline(){if(operation)return;clearPersonalSetup();update({cloudPersonal:{view:null,blocked:false,declined:true},message:'Cloud account connected. Dedicated setup was not started.',error:''});}
async function personalAccept(){await personalWork('Submitting the reviewed setup…',async(binding,view,signal)=>{
   if(view.kind!=='review'||state.cloudPersonal?.blocked)throw Error('Refresh setup status before continuing.');
   const generation=personalGeneration,attempt=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:view.review.personalElizaId,dedicatedAgentId:view.review.dedicatedAgentId,state:'attempting'},null,signal);
   await personalDispatch(binding,generation,attempt,signal);
   let next:PersonalView,intent:PersonalIntent|null=attempt;
   try{next=await binding.client.accept(view.review,signal);}
   catch(error){if(error instanceof PersonalProtocolError&&error.code==='http'&&error.status!==undefined&&error.status>=400&&error.status<500){await clearPersonalIntent(binding.client.owner,attempt);if(personalCurrent(binding,generation))update({cloudPersonal:{view:null,blocked:false,declined:false}});}throw error;}
   if(next.kind==='review'||next.kind==='unavailable'){await clearPersonalIntent(binding.client.owner,attempt);intent=null;}
   else if(next.kind==='pending')intent=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:next.receipt.personalElizaId,dedicatedAgentId:next.receipt.dedicatedAgentId,state:'accepted'},attempt);
   if(personalCurrent(binding,generation)){await publishPersonal(binding,next,intent,generation,signal);if(next.kind==='review')update({message:'The hosting terms changed. Review the current quote before continuing.'});}
  });}
async function personalPoll(){await personalWork('Checking setup status…',async(binding,view,signal)=>{const generation=personalGeneration,expected=await personalIntent(binding.client.owner,signal);const next=view.kind==='pending'?await binding.client.poll(view.receipt,signal):await binding.client.inspect(signal);if(personalCurrent(binding,generation))await publishPersonal(binding,next,expected,generation,signal);});}
async function personalFinalize(){await personalWork('Completing personal agent setup…',async(binding,view,signal)=>{
   if(view.kind!=='pending'||view.phase!=='cutover'||state.cloudPersonal?.blocked)throw Error('Check setup status before continuing.');
   const generation=personalGeneration,prior=await personalIntent(binding.client.owner,signal);if(prior?.phase==='cutover')throw Error('Check the previous setup outcome before continuing.');if(prior&&(prior.personalElizaId!==view.receipt.personalElizaId||prior.dedicatedAgentId&&prior.dedicatedAgentId!==view.receipt.dedicatedAgentId))throw Error('Cloud setup target changed. Refresh its status.');
   const attempt=await savePersonalIntent(binding.client.owner,{phase:'cutover',personalElizaId:view.receipt.personalElizaId,dedicatedAgentId:view.receipt.dedicatedAgentId,state:'attempting'},prior,signal);
   await personalDispatch(binding,generation,attempt,signal);
   const next=await binding.client.finalize(view.receipt,signal);let intent:PersonalIntent=attempt;
   // A returned pending state is the protocol's explicit non-ambiguous retry permission.
   if(next.kind==='pending')intent=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:next.receipt.personalElizaId,dedicatedAgentId:next.receipt.dedicatedAgentId,state:'accepted'},attempt);
   else if(next.kind==='review'||next.kind==='unavailable')intent=await savePersonalIntent(binding.client.owner,{phase:'activation',personalElizaId:view.receipt.personalElizaId,dedicatedAgentId:view.receipt.dedicatedAgentId,state:'accepted'},attempt);
   if(personalCurrent(binding,generation))await publishPersonal(binding,next,intent,generation,signal);
  });}
async function personalRecoveryOpen(){
   const binding=personalSetup,generation=personalGeneration;if(Capacitor.getPlatform()==='android'||!binding||!personalCurrent(binding,generation)||operation)return;
   personalRecovery?.abort();const controller=personalRecovery=new AbortController(),check=()=>{controller.signal.throwIfAborted();if(!personalCurrent(binding,generation))throw Error('Cloud account changed.');};
   try{const domain=await personalIntentDocument(binding.client.owner);check();openDomainRecovery({async capture(signal){check();const value=await domain.capture(signal);check();return value;},async reset(expected,signal){check();await domain.reset(expected,signal);check();}},'Cloud setup intent','Cloud setup intent recovery','Download this account’s exact saved intent before resetting. An uncertain setup may already have started hosting. Check Cloud status first. Reset only clears local recovery; it does not stop hosting, revoke credentials or send another setup request.',controller.signal);}catch{if(!controller.signal.aborted&&personalCurrent(binding,generation))update({error:'Cloud setup recovery could not be opened.'});}
}
async function cloudManage(environment:CloudEnvironment){await work('Opening Cloud account…',signal=>openConnectionBrowser(`https://${testMocksEnabled&&environment==='staging'?stagingCloud.agents:productionCloud.agents}/cloud/agents`,signal));}
async function personalConnect(){await personalWork('Verifying your personal Cloud agent…',async(binding,_view,signal)=>{
   const generation=personalGeneration,expected=await personalIntent(binding.client.owner,signal),next=await binding.client.inspect(signal);if(!personalCurrent(binding,generation))return;await publishPersonal(binding,next,expected,generation,signal);
   if(next.kind!=='ready'||state.cloudPersonal?.blocked)throw Error('Your personal Cloud agent is not ready.');
   await connectCloud(next.identity.activeAgentId!,signal,binding.client.owner.userId,next.identity.apiBase,binding.client.owner);
  });}
/** Development only: a request to a paired remote or local development agent with its saved session. */
async function pairedRequest(selected:Extract<Active,{kind:'remote'|'local'}>,session:VerifiedSession,path:string,method:AutomationsMethod,body:unknown,signal:AbortSignal,current:()=>void,recheck:boolean){
  const credential=await remoteCredentialStore.read(selected.origin);if(recheck)current();
  if(!credential||credential.identityId!==session.ownerId||credential.expiresAt<=Date.now())throw Error('Pair the agent again');
  const response=await nativeRemoteRequest({url:selected.origin+path,method,headers:{Accept:'application/json','Content-Type':'application/json',Authorization:`Bearer ${credential.token}`},...(body===undefined?{}:{body:JSON.stringify(body)}),signal});current();
  if(recheck){
    const latest=await remoteCredentialStore.read(selected.origin);current();
    if(!latest||latest.token!==credential.token||latest.identityId!==session.ownerId||latest.expiresAt<=Date.now())throw new DOMException('The paired account changed','AbortError');
  }
  if(response.status<200||response.status>=300)throw new WorkflowHttpError(response.status,response.body);
  return response.body;
}
const hosted = testMocksEnabled ? { pairedRequest, pair, restore: restoreHosted, inspectPersonal, cloudList, cloudManage, personalDecline, personalAccept, personalPoll, personalFinalize, personalRecoveryOpen, personalConnect } : null;

/** Browser sign-in body for the explicit browser development/diagnostic entry. */
async function residentBrowserLoginAction(signal: AbortSignal) {
  // P-43: the resident keeps running while the owner signs in in the browser. A cancelled or
  // failed first sign-in leaves it untouched; a sign-in kept on this phone is re-admitted then.
  // (The native credential write itself stops a process whose provider depends on the replaced key.)
  const kept=!!service||state.residentSavedCredential===true;
  detachService();
  update({residentSubscription:null,residentPlanNotice:null,redeemError:'',redeemNotice:''}); cloud=makeCloud(residentEnvironment());
  // A login over a saved key revokes that key first (best effort); see CloudProtocol.login.
  let login:Awaited<ReturnType<typeof cloud.login>>;
  try{login=await cloud.login(signal,()=>update({message:`Finish signing in to ${cloudServiceName(cloud.environment)} in your browser, then return here.`}));}
  // A cancelled or failed sign-in leaves the stored sign-in as it was: re-admit it afterwards.
  catch(error){if(kept)residentRebindQueued=true;throw error;}
  const issued=(await cloudCredentialStore.read(residentEnvironment()))?.credentialId;
  // Admission binds the new sign-in: native attaches when the process already matches, otherwise
  // it restarts the agent once (a process bound to the replaced key is stopped by the write).
  signal.throwIfAborted(); retire();
  try{await connectResident(signal);}catch(error){if(residentAlwaysPresent&&!active)update({kind:'recovering'});showPostSignInSetup();throw error;}
  // Cloud refused the key it just issued. It is removed rather than kept for a retry that cannot
  // work; the agent keeps running without Cloud inference.
  if(!state.cloudAccount&&state.residentPlanNotice!=='offline'&&issued&&(await cloudCredentialStore.read(residentEnvironment()).catch(()=>null))?.credentialId===issued){await cloudCredentialStore.clear(residentEnvironment());update({residentSavedCredential:false,open:true,error:`${cloudServiceName(cloud.environment)} refused this sign-in. Your agent keeps running; sign in again to turn AI on.`});return;}
  // A verified account finishes through setup; AI binding/plan warnings stay visible there.
  if(login.previousSignIn==='unconfirmed')update({message:`Signed in. ${cloudServiceName(cloud.environment)} did not confirm revoking the sign-in this phone used before.`});
  showPostSignInSetup();
}
async function browserCloudLoginAction(environment: CloudEnvironment, signal: AbortSignal) {
  const accountOnly=state.purpose==='cloud-account';
  // A login can replace the environment's secure token with a different
  // account. Detach the old identity before any token can be replaced.
  const replacingCloud = active?.kind === 'cloud' || selection()?.kind === 'cloud';
  detachCloudTarget(); detachService(); if (replacingCloud) save({ kind: 'none' }); update({ agents: [] });
  cloud = makeCloud(environment);
  const login = await cloud.login(signal, () => update({ message: accountOnly?`Finish signing in to ${cloudServiceName(cloud.environment)} in your browser, then return here. If the link expires, cancel and sign in again.`:'Use the newly opened browser tab to sign in and approve this phone. If the link expires, cancel here and start a fresh sign-in.' }));
  await verifyService(cloud, signal);
  if (!active) save({ kind: 'none' });
  if(accountOnly)update({message:login.previousSignIn==='unconfirmed'?`Signed in to ${cloudServiceName(cloud.environment)}. ${cloudServiceName(cloud.environment)} did not confirm revoking the previous sign-in.`:`Signed in to ${cloudServiceName(cloud.environment)}.`});else if(hosted)await hosted.inspectPersonal(signal);
  if(accountOnly)showPostSignInSetup();
}

/** Shared controller for the chat adapter. Snapshot contains no credentials.
 * subscribe/getSnapshot expose connection changes; send uses server-bound identity
 * and one persisted conversation per origin+owner+agent. It never executes proposals.
 */
export const connectionController = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot() { return state; },
  async assistantDraftBinding(signal:AbortSignal){
    const selected=active,session=state.session,generation=epoch;
    signal.throwIfAborted();
    if(!selected||!session)return JSON.stringify(['offline']);
    const key=conversationKey(session),saved=await captureConversationChoice(key,signal);
    signal.throwIfAborted();if(generation!==epoch||selected!==active||session!==state.session)throw Error('The agent changed while opening its draft.');
    // Pin even an empty choice: another tab's restart preference cannot move this draft.
    if(!conversationMemory.has(key))conversationMemory.set(key,saved?.id||'');
    return JSON.stringify([session.origin,session.ownerId,session.agentId,conversationMemory.get(key)||null]);
  },
  setDeviceRecovery(recovery: DeviceRecovery) { deviceRecovery=recovery; },
  cancelViewNavigation(){active?.viewNavigation?.cancel();},
  setNavigationContext(read:()=>ContextEnvelope|null){navigationContext=read;},
  async performVoiceRequestedActions(binding:VoiceConversationBinding,messageId:string,signal:AbortSignal,operationType?:'camera_capture_photo'){
    const selected=active,expected=navigationContext?.();
    if(!selected?.actions||!expected||!validateUuid(messageId))return [];
    const context=structuredClone(expected);
    const current=()=>{signal.throwIfAborted();if(active!==selected||!this.voiceConversationCurrent(binding)||context.sensitive||JSON.stringify(navigationContext?.())!==JSON.stringify(context))throw Error('Voice action context changed');};
    const allowed=async()=>{current();const preferences=await readDevicePreferences(signal);current();return !preferences.askBeforeAgentActions;};
    if(!await allowed())return [];
    await selected.actions.pendingReview(context,signal);current();
    const receipts=await selected.actions.performRequested(messageId,context,signal,allowed,operationType);current();
    return receipts;
  },
  async continueRequestedCamera(messageId:string,signal:AbortSignal):Promise<OperationReceipt[]> {
    const pending=requestedCameraContinuation;
    if(!pending||pending.messageId!==messageId)return [];
    requestedCameraContinuation=undefined;
    const context=pending.client.deliveredContext(pending.attempt);
    if(!context||context.view!=='camera'||context.sensitive||!pending.selected.actions)return [];
    const current=()=>{signal.throwIfAborted();if(document.hidden||pending.attempt.controller.signal.aborted||Date.now()>pending.expiresAt||epoch!==pending.generation||active!==pending.selected||state.session!==pending.session||conversationMemory.get(conversationKey(pending.session))!==pending.conversationId||JSON.stringify(navigationContext?.())!==JSON.stringify(context))throw Error('The camera request changed.');};
    const allowed=async()=>{current();const preferences=await readDevicePreferences(signal);current();return !preferences.askBeforeAgentActions;};
    if(!await allowed())return [];
    await pending.selected.actions.pendingReview(context,signal);current();
    return pending.selected.actions.performRequested(messageId,context,signal,allowed,'camera_capture_photo');
  },
  voiceRendererClientId(){return boundNavigation()?.clientId;},
  voiceRendererMetadata(context:ContextEnvelope){return boundNavigation()?.metadata(context)??{};},
  captureViewNavigation(context:ContextEnvelope){const client=boundNavigation();return client?{client,attempt:client.capture(context)}:undefined;},
  setDeviceExecutor(executor: DeviceExecutor) { deviceExecutor = executor; },
  setForegroundExecutor(executor: ForegroundReviewExecutor) { foregroundExecutor = executor; },
  setDeviceReadReview(review:(proposal:ActionProposal,context:ContextEnvelope,signal:AbortSignal)=>Promise<void>){deviceReadReview=review;},
  async execute(proposal: ActionProposal, context: ContextEnvelope, signal: AbortSignal): Promise<OperationReceipt> {
    const selected = active;
    if (!selected || !selected.actions) return { proposalId: proposal.id, status: 'denied', summary: 'This connection does not support verified phone actions.' };
    const session=state.session!,sessionId=session.sessionId,generation=epoch,account=JSON.stringify(service?.identity??null),conversation=conversationMemory.get(conversationKey(session)),review=deviceReadReview;
    const prior = actionReceipts.get(proposal.id);
    if (prior?.sessionId === sessionId) return prior.result;
    const result = (async()=>{
      if(proposal.privateNotesRead){
        if(!review)throw Error('Notes review is unavailable. Nothing was shared.');
        await review(proposal,context,signal);signal.throwIfAborted();
        if(selected!==active||generation!==epoch||state.session!==session||conversationMemory.get(conversationKey(session))!==conversation||JSON.stringify(service?.identity??null)!==account||document.hidden||state.open)throw Error('The Notes review changed. Nothing was shared.');
      }
      return selected.actions!.approve(proposal.id, context, signal);
    })();
    actionReceipts.set(proposal.id, { sessionId, result });
    return result;
  },
  async readCalendarApproval(id:string,signal:AbortSignal){
    const selected=active,session=state.session,generation=epoch,history=state.history,account=service;
    if(!calendarApprovalId(id)||selected?.kind!=='resident'||!session||state.open||state.busy||document.hidden)throw Error('Calendar review is unavailable on this connection.');
    const current=()=>{signal.throwIfAborted();if(generation!==epoch||active!==selected||state.session!==session||state.history!==history||service!==account||state.open||state.busy||document.hidden)throw Error('The agent or conversation changed.');};
    current();const result=await selected.remote.request(CALENDAR_APPROVAL_READ_PATH,undefined,signal);current();
    return calendarApprovalFromList(result,id,session.ownerId);
  },
  async pendingActions(context:ContextEnvelope,signal:AbortSignal):Promise<ActionProposal[]> {
    const selected=active,session=state.session,generation=epoch,history=state.history;
    if(!selected?.actions||!session||state.open||state.busy||document.hidden||context.sensitive)return [];
    const account=selected.kind==='resident'&&residentCloudFlow()?service:null;
    // P-43: a signed-out resident still owns its history and actions; a bound Cloud account must stay the same one.
    const current=()=>{signal.throwIfAborted();if(generation!==epoch||selected!==active||state.session!==session||state.history!==history||state.open||state.busy||document.hidden||account&&(service!==account||state.cloudAccount?.sessionId!==account.identity.sessionId))throw Error('The agent or conversation changed.');};
    const checkAccount=async()=>{current();if(account){const credential=await cloudCredentialStore.read(account.identity.environment);current();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}};
    const key=conversationKey(session),choice=await captureConversationChoice(key,signal);
    await checkAccount();
    const proposals=await selected.actions.pending(context,signal);
    await checkAccount();
    const after=Capacitor.getPlatform()==='android'?captureConversationChoice(key,signal):await captureConversationChoice(key,signal);
    current();if(JSON.stringify(choice)!==JSON.stringify(after))throw Error('Saved conversation selection changed.');
    return proposals;
  },
  async approvePendingAction(id:string,context:ContextEnvelope,signal:AbortSignal):Promise<OperationReceipt> {
    // Refresh authenticated state and exact source preconditions at the tap. No
    // cached chat prose or prior approval can authorize a recovered proposal.
    const selected=active,session=state.session;
    const proposals=await this.pendingActions(context,signal);
    signal.throwIfAborted();
    if(active!==selected||state.session!==session)throw Error('The agent changed.');
    const proposal=proposals.find(proposal=>proposal.id===id);
    if(!proposal)throw Error('This action is no longer pending for the current screen. Open its original selection and review again.');
    return this.execute(proposal,context,signal);
  },
  getWorkflowPresentationProtocol():1|2 { return active?.actions ? active.workflowProtocol ?? 1 : 1; },
  getWorkflowDeviceTarget(){const selected=active;if(!selected||!selected.actions||!selected.actions.credential.enrollmentId)return null;return {installationId:selected.actions.credential.installationId,enrollmentId:selected.actions.credential.enrollmentId};},
  async workflowNoticeActions(review:WorkflowPhoneReview,signal:AbortSignal){
    const selected=active,generation=epoch,sessionId=state.session?.sessionId;
    if(!selected?.actions||state.open||document.hidden)throw new Error('Connection unavailable for notice validation');
    const result=await selected.actions.pendingWorkflowNotice(review,signal);signal.throwIfAborted();
    if(generation!==epoch||sessionId!==state.session?.sessionId||state.open||document.hidden)throw new Error('Workflow owner changed');return result;
  },
  async workflowPhoneActions(review:WorkflowPhoneReview,context:ContextEnvelope,signal:AbortSignal){
    const selected=active,generation=epoch,sessionId=state.session?.sessionId;
    if(!selected||!selected.actions||state.open||document.hidden||context.sensitive)throw new Error('Open this workflow on the selected phone agent');
    const result=await selected.actions.pendingForWorkflow(review,context,signal);signal.throwIfAborted();
    if(generation!==epoch||sessionId!==state.session?.sessionId||state.open||document.hidden)throw new Error('Workflow agent changed');return result;
  },
  async rejectWorkflowPhoneAction(id:string,review:WorkflowPhoneReview,context:ContextEnvelope,signal:AbortSignal){
    const selected=active;if(!selected||!selected.actions||state.open||document.hidden||context.sensitive)throw new Error('Open this workflow to deny its phone step');
    const proposals=await selected.actions.pendingForWorkflow(review,context,signal);if(!proposals.some(p=>p.id===id))throw new Error('Phone step is no longer pending');signal.throwIfAborted();await selected.actions.reject(id,signal);
  },
  async syncWorkflowPhoneReceipts(review:WorkflowPhoneReview,signal:AbortSignal){
    const selected=active,generation=epoch;
    if(!selected||!selected.actions||state.open||document.hidden)throw new Error('Open this workflow to reconcile its phone receipts');
    await selected.actions.syncReceipts(signal,{runId:review.runId,versionId:review.versionId,specDigest:review.specDigest});signal.throwIfAborted();if(generation!==epoch||state.open||document.hidden)throw new Error('Workflow agent changed');
  },
  async actionReceipt(proposalId: string, sessionId: string | undefined): Promise<OperationReceipt | null> {
    const tracked = actionReceipts.get(proposalId);
    if (!sessionId || state.session?.sessionId !== sessionId || tracked?.sessionId !== sessionId) return null;
    const receipt = await tracked.result;
    return state.session?.sessionId === sessionId ? receipt : null;
  },
  readReplyBinding(conversationId:string,proposalId:string,digest:string):ReadReplyBinding {
    const session=state.session;
    if(!active?.actions||!session||state.open||document.hidden||conversationMemory.get(conversationKey(session))!==conversationId)throw Error('Return to the original conversation to review this Notes request.');
    const binding={conversationId,session:{...session},connectionEpoch:epoch,cloudAccount:JSON.stringify(service?.identity??null)};
    readReplyOwners.set(binding,{actions:active.actions,proposalId,digest,cancelled:false});return binding;
  },
  readReplyCurrent(binding:ReadReplyBinding){
    return !!readReplyOwners.get(binding)&&!readReplyOwners.get(binding)!.cancelled&&this.voiceConversationCurrent(binding,false)&&binding.cloudAccount===JSON.stringify(service?.identity??null)&&!state.open&&!document.hidden;
  },
  async completeReadReply(hint:NativeNotesReadReplyHint,binding:ReadReplyBinding,signal:AbortSignal){
    const selected=active,account=service,owned=readReplyOwners.get(binding);
    const current=()=>{signal.throwIfAborted();if(!selected?.actions||owned?.actions!==selected.actions||owned.proposalId!==hint.proposalId||owned.digest!==hint.digest||active!==selected||!this.readReplyCurrent(binding)||hint.conversationId!==binding.conversationId)throw Error('The original Notes conversation changed.');};
    const checkAccount=async()=>{current();if(account){const credential=await cloudCredentialStore.read(account.identity.environment);current();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}};
    await checkAccount();
    current();const reply=await selected!.actions!.completeReadReply(hint,signal);await checkAccount();return reply;
  },
  async cancelReadReply(binding:ReadReplyBinding){
    const owned=readReplyOwners.get(binding);if(!owned||owned.cancelled)return;
    owned.cancelled=true;
    try{await owned.actions.cancelReadReply(owned.proposalId,owned.digest,new AbortController().signal);}finally{readReplyOwners.delete(binding);}
  },
  async actionHistory(sync = false) {
    await work('Reading phone action history…', async signal => {
      const selected = active, generation = epoch;
      if (!selected || !selected.actions) throw new Error('Verified phone actions are unavailable on this connection.');
      const entries = await readActionHistory(selected, signal, sync);
      if (generation !== epoch) return;
      update({ actionHistory: entries, message: 'Review local effects before resolving an uncertain action. No action is repeated here.' });
    });
  },
  async rejectAction(id: string) {
    await work('Rejecting phone action…', async signal => {
      if (!active || !active.actions) throw new Error('Device action connection unavailable');
      await active.actions.reject(id, signal);
      update({ actionHistory: [], message: 'Proposal rejected. No device action was performed.' });
    });
  },
  /** Reject one pending proposal without opening the connection dialog (chat cards use this). */
  async rejectProposal(id: string, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const selected = active, generation = epoch;
    if (!selected?.actions) throw new Error('This connection does not support verified phone actions.');
    await selected.actions.reject(id, signal);
    signal.throwIfAborted();
    if (generation === epoch && selected === active) update({ actionHistory: state.actionHistory.map(entry => entry.id === id ? { ...entry, state: 'rejected', outcome: `${actionStateLabels.rejected} · not dispatched by this phone`, description: [entry.title, entry.detail, `${actionStateLabels.rejected} · not dispatched by this phone`].filter(Boolean).join(' · ') } : entry) });
  },
  /** Record the user's check of an uncertain action. Nothing is executed or repeated. */
  async reconcile(entryId: string, applied: boolean, signal: AbortSignal = new AbortController().signal): Promise<void> {
    const selected = active, generation = epoch;
    if (!selected?.actions) throw new Error('This connection does not support verified phone actions.');
    await selected.actions.reconcile(entryId, applied ? 'applied' : 'not_applied', signal);
    signal.throwIfAborted();
    if (generation === epoch && selected === active) update({ actionHistory: (await readActionHistory(selected, signal).catch(() => state.actionHistory.filter(entry => entry.id !== entryId))) });
  },
  async reconcileAction(id: string, outcome: 'applied' | 'not_applied') {
    await work('Recording your action review…', async signal => {
      if (!active || !active.actions) throw new Error('Device action connection unavailable');
      await active.actions.reconcile(id, outcome, signal);
      update({ actionHistory: [], message: 'Review recorded. Refresh action history; no action was repeated.' });
    });
  },
  getAutomationsClient(): {sessionId:string;scope?:string;request:(path:string,method:AutomationsMethod,body:unknown|undefined,signal:AbortSignal)=>Promise<unknown>} | null {
    const selected=active,session=state.session,generation=epoch;
    if(!selected||!session||(testMocksEnabled&&selected.kind==='cloud'&&!selected.phoneTarget))return null;
    return {sessionId:session.sessionId,scope:selected.actions?.scope,request:async(path,method,body,signal)=>{
      if(!automationsRouteAllowed(path,method)||((method==='GET'||method==='DELETE')&&body!==undefined))throw Error('Unsupported automation request');
      const controller=new AbortController(),bounded=anyAbortSignal([signal,controller.signal]);automationsRequests.add(controller);
      const current=()=>{bounded.throwIfAborted();if(generation!==epoch||selected!==active||session!==state.session)throw new DOMException('The connection changed','AbortError');};
      try{
        current();
        let result:unknown;
        if(selected.kind==='resident')result=await selected.remote.request(path,body,bounded,{},method);
        else if(!hosted)throw Error('Your agent runs on this device.');
        else if(selected.kind==='cloud')result=await selected.cloud.phoneRequest(selected.phoneTarget!,path,bounded,body,method);
        else result=await hosted.pairedRequest(selected,session,path,method,body,bounded,current,true);
        current();return result;
      }catch(error){if(error instanceof CloudProtocolError&&error.status)throw new WorkflowHttpError(error.status,error.data);if(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number'&&!(error instanceof WorkflowHttpError))throw new WorkflowHttpError(error.status,'data' in error?error.data:undefined);throw error;}
      finally{automationsRequests.delete(controller);}
    }};
  },
  getWorkflowClient(): { client: WorkflowProtocol; sessionId: string; scope?:string } | null {
    const selected = active, session = state.session;
    if (!selected || !session || (testMocksEnabled && selected.kind==='cloud' && !selected.phoneTarget)) return null;
    const generation = epoch;
    return { sessionId: session.sessionId, scope:selected.actions?.scope, client: new WorkflowProtocol(async (path, body, signal) => {
      signal.throwIfAborted();
      if (generation !== epoch) throw new Error('Agent changed');
      if(selected.kind==='resident'){try{const response=await selected.remote.request(path,body,signal);if(generation!==epoch)throw Error('Agent changed');return response;}catch(error){if(error&&typeof error==='object'&&'status' in error&&typeof error.status==='number')throw new WorkflowHttpError(error.status,'data' in error?error.data:undefined);throw error;}}
      if (!hosted) throw new Error('Your agent runs on this device.');
      if (selected.kind==='cloud') { try { const response=await selected.cloud.phoneRequest(selected.phoneTarget!,path,signal,body); if(generation!==epoch)throw new Error('Agent changed');return response; } catch(error) { if(error instanceof CloudProtocolError && error.status)throw new WorkflowHttpError(error.status,error.data); throw error; } }
      return hosted.pairedRequest(selected,session,path,body === undefined ? 'GET' : 'POST',body,signal,()=>{if (generation !== epoch) throw new Error('Agent changed');},false);
    }) };
  },
  getResidentReadingBinding(){return active?.kind==='resident'&&state.session?{execution:'device' as const,ownerId:state.session.ownerId,sessionId:state.session.sessionId}:null;},
  async readCloudInferenceFailure(signal:AbortSignal):Promise<CloudInferenceFailure|null>{
    const selected=active,session=state.session,generation=epoch;
    signal.throwIfAborted();if(selected?.kind!=='resident'||!session)return null;
    const status=await selected.remote.request('/api/status',undefined,signal);
    signal.throwIfAborted();if(generation!==epoch||selected!==active||session!==state.session)throw new DOMException('The connection changed','AbortError');
    return sanitizeCloudInferenceFailure(status?.cloudInferenceFailure);
  },
  getBrowserSpeechAgent(){return active?.kind==='resident'&&state.session&&active.remote.browserSpeechAvailable?active.remote:null;},
  /** The resident agent's owner-authenticated request path, for its on-device live ASR route (live-voice.ts). */
  getResidentLiveVoice():{sessionId:string;subscribe:(listener:(envelope:unknown)=>void)=>()=>void;request:(path:string,body:unknown,signal:AbortSignal)=>Promise<unknown>}|null{
    const selected=active;if(selected?.kind!=='resident'||!state.session)return null;
    const remote=selected.remote,sessionId=state.session.sessionId;
    return {sessionId,subscribe:listener=>remote.subscribeVoiceEvents(listener),request:(path,body,signal)=>remote.request(path,body,signal,{},body===undefined?'GET':'POST')};
  },
  async refreshDeveloperVoiceHistory(binding:VoiceConversationBinding,signal:AbortSignal){if(!browserLocalAgentEnabled||active?.kind!=='resident'||!this.voiceConversationCurrent(binding))throw Error('Developer voice conversation changed');await restoreConversationHistory(binding.conversationId,signal,true);if(!this.voiceConversationCurrent(binding))throw Error('Developer voice conversation changed');},
  getPairedVoiceBinding(): { origin: string; ownerId: string; expiresAt: number; sessionId: string } | null {
    // Paired voice belongs to development and hosted agents; the resident agent has its own speech path.
    if (!testMocksEnabled) return null;
    if(browserDevProfile&&selection()?.kind==='development'&&state.session)return {...state.session,expiresAt:developmentVoiceExpiresAt};
    if (active?.kind==='cloud' && state.session && active.phoneTarget && active.voiceExpiresAt && active.voiceExpiresAt>Date.now()) return {origin:state.session.origin,ownerId:state.session.ownerId,expiresAt:active.voiceExpiresAt,sessionId:state.session.sessionId};
    if (!active || active.kind === 'cloud' || active.kind === 'resident' || !state.session || !active.remote.session || active.remote.session.expiresAt <= Date.now()) return null;
    return { origin: active.origin, ownerId: state.session.ownerId, expiresAt: active.remote.session.expiresAt, sessionId: state.session.sessionId };
  },
  getCloudEnvironment(): CloudEnvironment | null { return service?.identity.environment ?? null; },
  getCloudClient(): { client: CloudProtocol; sessionId: string; credentialId: string } | null { return service ? { client: service.client, sessionId: service.identity.sessionId, credentialId: service.identity.credentialId } : null; },
  rejectCloudSession(sessionId: string, error: unknown) {
    if (!expired(error) || service?.identity.sessionId !== sessionId) return false;
    const environment = service.identity.environment;
    if (testMocksEnabled && active?.kind === 'cloud' && active.cloud.environment === environment) retire('Sign-in required');
    detachService();
    update({ error: testMocksEnabled?`${cloudServiceName(cloud.environment)} sign-in has expired. Sign in again; remote agent pairing is unchanged.`:`${cloudServiceName(cloud.environment)} sign-in has expired. Sign in again to use managed services.` });
    return true;
  },
  // A recovering resident keeps its start failure visible beside Retry.
  open() { update({ open: true, automaticRestore:false, purpose:'agent', error: state.kind === 'recovering' ? state.error : '' }); },
  /** Window online/offline events. Offline retracts readiness; local apps are untouched. */
  networkChanged(online: boolean) {
    if (online === !state.inferenceOffline) return;
    update({ inferenceOffline: !online });
    if (!online) retractReadiness();
  },
  openCloudAccount(){
    update({open:true,automaticRestore:false,purpose:'cloud-account',message:'',error:''});
    // Production Android: whether a Cloud sign-in is kept on this phone decides if the panel offers
    // "Retry saved connection". A local keystore read; no Cloud request and nothing is restored.
    if(residentCloudFlow()&&!state.cloudAccount)void cloudCredentialStore.read(residentEnvironment()).then(credential=>{if(state.open&&state.purpose==='cloud-account'&&!state.cloudAccount)update({residentSavedCredential:!!credential?.credentialId});}).catch(()=>{/* Sign-in stays available. */});
  },
  /** Settings › Eliza Cloud account & plan: the plan panel with Redeem code, Manage plan and Sign out. */
  openPlan(){ update({open:true,automaticRestore:false,purpose:'plan',message:'',redeemError:'',redeemNotice:''}); },
  /** Test-mocks builds only: enter or leave subscription gate QA, then reload into it. */
  setResidentQa(environment:CloudEnvironment|null){
    if(!testMocksEnabled||operation)return;
    try{if(environment)localStorage.setItem(RESIDENT_QA,environment);else localStorage.removeItem(RESIDENT_QA);}catch{update({error:'Subscription gate QA could not be saved.'});return;}
    location.reload();
  },
  /** Plan state for Settings. Null when this build has no Cloud sign-in and plan flow. */
  residentPlanSettings(){
    if(!residentCloudFlow())return null;
    const serviceName=cloudServiceName(cloud.environment);
    const view=state.residentSubscription,account=state.cloudAccount,plan=view&&view.kind!=='checking'?describeSubscription(view,serviceName):null;
    const expiresAt=account?.expiresAt??null;
    // The agent always runs; this says only whether Eliza Cloud AI is connected to it.
    // An agent that is not running cannot use any plan: say that, not a plan or Cloud problem.
    const inference=!state.session&&account&&planAdmission(view)!=='needs-plan'?(state.kind==='recovering'?'Unavailable · agent not running':'Starting…'):state.residentInference==='unknown'?'Status unconfirmed':state.residentInference==='cloud'?serviceName:state.residentPlanNotice==='offline'?'Unavailable · Cloud unreachable':state.residentInference==='unavailable'?(account?(view?.kind==='inactive'?'Unavailable · check Cloud account':'Unavailable · Cloud status unconfirmed'):'Unavailable · sign in'):'Starting…';
    if(state.residentPlanNotice==='offline'&&!account){const recent=readPlanAdmission();return {signedIn:false,offline:true,offerRedeem:false,account:null,plan:recent?`${recent.planName} · offline`:'Offline',status:recent?.status??null,endsAt:state.planEndsAt??null,keyExpiresAt:null,keyExpiring:false,inference};}
    return {signedIn:!!account,offline:false,inference,account:account?(account.email||`Account ${account.userId.slice(0,8)}`):null,
      plan:plan?.headline??(account?'Checking plan…':'Not signed in'),
      status:view?.kind==='active'?view.status:view?.kind==='inactive'?view.status:null,
      // A code is offered as the way to get a plan; an account Cloud admitted is not asked for one.
      offerRedeem:!!account&&planAdmission(view)!=='admit'&&view?.kind!=='credits',
      endsAt:state.planEndsAt??null,keyExpiresAt:expiresAt,keyExpiring:expiresAt!==null&&expiresAt-Date.now()<=CLOUD_KEY_EXPIRY_WARNING_MS};
  },
  // P-43: the resident always exists, so the dialog closes; a start in progress keeps running in the
  // background and Home shows its starting state. Only the Eliza Cloud sign-in that every Alpha
  // Phone needs (signed out, or a sign-in Cloud rejected) keeps the dialog open; the agent runs meanwhile.
  close() {
    // The in-app sign-in screen closes back to where it was opened; a pending attempt is cancelled.
    if(state.signIn&&!state.busy){connectionController.cancelSignIn();return;}
    if(residentSignInRequired()){if((state.purpose==='cloud-account'||state.purpose==='plan')&&!state.busy)update({purpose:'agent',message:'',error:'',redeemError:'',redeemNotice:''});return;}
    if (!state.busy || residentStartInBackground || state.residentStarting) {if(state.purpose!=='cloud-account'&&state.purpose!=='plan')clearPersonalSetup();update({ open: false,purpose:'agent',redeemError:'',redeemNotice:'' });}
  },
  cancel() { operation?.abort(new DOMException('Cancelled', 'AbortError')); cloud.cancelLogin(); },
  async initialize() {
    if (startup) return startup;
    update({automaticRestore:!state.open});
    startup = (async () => {
      // A development profile whose account changed is not restored; where the resident is always
      // present, startup continues to it (P-43) instead of leaving no agent.
      if(browserDevProfile){const saved=selection();if(saved?.kind==='development'){if(saved.account!==(await readDevelopmentIdentity(saved.profile)).account){save({kind:'none'});if(!residentAlwaysPresent)return;}else{await work('Restoring development agent…',signal=>connectDevelopment(saved.profile,signal));return;}}}
      // A selected development host can restore its existing Mac-owned Cloud account.
      // The server returns only a reference; canonical identity still owns readiness.
      if(cloudCredentialStore.acceptsReferences&&!isAndroid&&!browserDevProfile&&!browserCloudResidentEnabled&&selection()?.kind!=='offline'&&new URLSearchParams(location.search).get('mode')!=='mock'){
        const restoreEpoch=epoch;
        const canRestore=()=>restoreEpoch===epoch&&!operation&&!state.open&&selection()?.kind!=='offline';
        try{
          const credential=await cloudCredentialStore.read('production');
          // A user choice during discovery also retires automatic agent startup.
          if(!canRestore())return;
          // An optional empty host store is not an account onboarding action.
          if(credential?.credentialReference&&credential.credentialId){
            const expected={credentialId:credential.credentialId,credentialReference:credential.credentialReference};
            await work('Checking your Cloud account…',async signal=>{
              const current=await cloudCredentialStore.read('production');signal.throwIfAborted();
              if(restoreEpoch!==epoch||current?.credentialId!==expected.credentialId||current?.credentialReference!==expected.credentialReference)throw Error('Cloud account changed. Try again.');
              await verifyService(makeCloud('production'),signal,expected);
            },true,true);
            if(restoreEpoch!==epoch||state.error||service?.identity.credentialId!==expected.credentialId)return;
          }
        }catch(error){if(canRestore())await work('Checking your Cloud account…',async()=>{throw error;},true,true);return;}
      }
      // A build that cannot use Eliza Cloud signs a saved Cloud service out on every start, whatever is selected
      // (an offline choice included): the marker and, best effort and unawaited, the stored Cloud key. Only that
      // slot; it is not read. No request is made.
      if (webCloudUnavailable()) { try { localStorage.removeItem(CLOUD_SERVICE); } catch { /* Nothing is restored either way. */ } void removeStoredCloudCredential('production').catch(() => {}); }
      // Subscription gate QA in a test-mocks build runs the production gate before any development flow.
      if (residentQa()) { await startResidentGate(); return; }
      if (!testMocksEnabled && migrateLegacyMock()) return;
      // A saved hosted or paired agent becomes the resident agent; nothing connects to it.
      if (!testMocksEnabled) migrateLegacyHostedSelection();
      if (testMocksEnabled && ((!isAndroid && !browserLocalAgentEnabled) || new URLSearchParams(location.search).get('mode') === 'mock')) return;
      if (!testMocksEnabled && !isAndroid && !browserLocalAgentEnabled) {
        // A production browser build has no on-device agent. Explain the real choices once.
        let stored: string | null = null;
        try { stored = localStorage.getItem(SELECTION); } catch { /* Unavailable storage still shows the choice. */ }
        if (stored === null) { try { save({ kind: 'none' }); } catch { /* The chooser explains the choice either way. */ } update({ open: true, message: '' }); return; }
      }
      const saved = selection();
      if(!testMocksEnabled&&!isAndroid&&!browserLocalAgentEnabled){
        // History stays for recovery; a hosted choice was already moved to LEGACY_HOSTED_SELECTION and the
        // selection now names the Android agent. Never read credentials or reconnect from the browser.
        update({open:saved?.kind!=='offline',message:'Your agent runs locally in the Android app. Local apps remain available here.'});return;
      }
      if (residentCloudFlow()) { await startResidentGate(); return; }
      if (saved?.kind === 'offline') { if (!residentAlwaysPresent) return; }
      if (saved?.kind === 'mock') { const url = new URL(location.href); url.searchParams.set('mode', 'mock'); location.replace(url.href); return; }
      await work('Restoring your connection…', async signal => {
        const environment = localStorage.getItem(CLOUD_SERVICE);
        if (environment === 'staging' && !testMocksEnabled) { localStorage.removeItem(CLOUD_SERVICE); update({ message: `Sign in with ${cloudServiceName(cloud.environment)} to continue.` }); }
        else if (cloudEnvironmentAllowed(environment)) {
          try { await verifyService(makeCloud(environment), signal); }
          catch (error) { signal.throwIfAborted(); detachService(); update({ message: 'Cloud services need sign-in or retry. Your agent connection is independent.' }); }
        }
        // `npm run dev` starts the agent on this computer; P-43 always connects it (a stored offline
        // or "none" choice reads as the resident). A host agent that is down recovers with Retry.
        if (saved?.kind === 'resident' || (!saved && residentAlwaysPresent)) { try { await connectResident(signal); } catch (error) { if (residentAlwaysPresent && !active) update({ kind: 'recovering', message: 'Reconnecting to the agent on this computer…' }); throw error; } return; }
        if (!saved || saved.kind === 'none') { update({ open: !service, message: 'Choose where to run your agent.' }); return; }
        // Development infrastructure only: product selection() never returns a hosted kind.
        if (hosted && (saved.kind === 'cloud' || saved.kind === 'remote' || saved.kind === 'local')) await hosted.restore(saved, signal);
      });
    })().then(settleResidentAfterStartup).finally(()=>update({startupResolved:true,automaticRestore:false}));
    return startup;
  },
  /** Test mocks and the flag-off web preview only: leave mock mode or a fixture connection where no resident runs. Where the
   * resident is always present (P-43) there is no offline mode; this returns to the resident. */
  async offline() {
    if (operation) return;
    if (residentAlwaysPresent) { await connectionController.startLocal(); return; }
    // Subscription gate QA (test-mocks builds): the gate has no local-only bypass.
    if(residentCloudFlow()){update({open:true,error:`Sign in with ${cloudServiceName(cloud.environment)} to use AI replies.`,message:''});return;}
    // The flag-off web preview runs no agent at all (A-27): it may close its notice and keep that choice.
    if (!testMocksEnabled && !webCloudUnavailable()) return;
    retire(); detachService();
    const error = persistOffline();
    update({ open: Boolean(error), error, message: '' });
  },
  /** Stop, then immediately start the resident again (P-43: never left stopped). */
  async restartLocal() {
    await work('Restarting your agent…',async signal=>{
      if(Capacitor.isNativePlatform())await stopLocalAgent();
      // As the former Stop did: background retirement reports its own failure and never blocks the restart.
      void retire();signal.throwIfAborted();
      try{await connectResident(signal);}catch(error){if(residentAlwaysPresent&&!active)update({kind:'recovering'});throw error;}
    });
  },
  async configureLocal(apiKey:string,model:string=LOCAL_PROVIDER_MODEL) { await work('Checking the key with Cerebras…',async()=>{await configureLocalProvider(apiKey,model);update({providerStatus:await localProviderStatus().catch(()=>null),message:'Key verified with Cerebras. Provider saved. Start or restart the local agent to use it.'});}); },
  async refreshProviderStatus() { try { update({ providerStatus: await localProviderStatus() }); } catch { update({ providerStatus: null }); } },
  /** Stops the running agent (its process holds the key), deletes the key and confirms removal. */
  async removeProvider() {
    if(residentCloudFlow()){update({error:ALWAYS_LOCAL,message:''});return;}
    const wasResident = active?.kind === 'resident';
    await work('Removing the provider key…', async () => {
      if (active?.kind === 'resident') { await stopLocalAgent(); await retire(); save({ kind: 'resident' }); }
      const status = await clearLocalProvider();
      update({ providerStatus: status, message: 'Provider key removed from this phone. ' + AI_OFF_MESSAGE });
    });
    // P-43: the resident restarts at once without inference (native start no longer needs a key).
    if (residentAlwaysPresent) await ensureResident(); else if (wasResident && !active && !state.error) await connectionController.startLocal();
  },
  /** Start a fresh conversation on the connected agent and make it the restart selection. */
  async newConversation() {
    if (sending) { update({ error: 'Wait for the current reply before starting a new conversation.' }); return; }
    await work('Starting a new conversation…', async signal => {
      const selected = active, session = state.session, generation = epoch;
      if (!selected || !session) throw noSessionError(NO_SESSION_FALLBACK);
      const assertCurrent = () => { signal.throwIfAborted(); if (generation !== epoch || selected !== active || state.session?.sessionId !== session.sessionId) throw Error('The agent changed.'); };
      const key = conversationKey(session), expected = await captureConversationChoice(key, signal); assertCurrent();
      const created = selected.kind === 'cloud' ? await selected.cloud.createConversation(selected.agentId, 'Alpha Phone', signal) : await selected.remote.createConversation('Alpha Phone', signal);
      assertCurrent();
      let saved = true;
      try { await selectConversation(key, expected, created.id, signal, assertCurrent); } catch { saved = false; }
      assertCurrent(); conversationMemory.set(key, created.id); cancelStoppedReply();
      update({ history: { sessionId: session.sessionId, conversationId: created.id, revision: (state.history?.revision || 0) + 1, messages: [], automatic: false }, historyError: '', historyPartial: false, replyNotice: '', open: false, message: saved ? 'New conversation started.' : 'New conversation started for this session; restart selection could not be saved.' });
    });
  },
  async authorDevelopment(profile:DevelopmentProfile,json:string){if(!devSurfacesEnabled)return;await work('Preparing development action…',async signal=>{await authorDevelopmentAction(profile,json,signal);update({message:'Action queued. Send a chat message to review it on the current screen.'});});},
  async startDevelopment(profile:DevelopmentProfile){if(!devSurfacesEnabled)return;await work('Starting development agent…',signal=>connectDevelopment(profile,signal));},
  async saveDevelopment(profile:DevelopmentProfile,reply:string){if(!devSurfacesEnabled)return;await work('Saving development reply…',async signal=>{await saveDevelopmentReply(profile,reply,signal);update({message:'Development reply saved.'});});},
  async reviewRecovery() {
    if(operation||state.residentRecoveryReason!=='ipc-recovery-retention-limit'||state.session)return;
    await work('Checking recovery…',async signal=>{
      update({residentRecovery:{step:'reviewing'}});
      try{const review=await reviewLocalRecovery();signal.throwIfAborted();update({message:'',residentRecovery:review.status==='reviewable'?{step:'review',review}:{step:'unavailable'}});}
      catch(error){update({residentRecovery:{step:'unavailable'}});throw error;}
    });
  },
  cancelRecoveryReview(){if(!operation)update({residentRecovery:undefined});},
  async confirmRecovery() {
    if(operation||state.residentRecoveryReason!=='ipc-recovery-retention-limit'||state.residentRecovery?.step!=='review'||state.session)return;
    const review=state.residentRecovery.review;let archived=false;
    await work('Keeping startup records…',async signal=>{
      update({residentRecovery:{step:'archiving'}});
      try{
        const result=await archiveLocalRecovery(review.reviewToken);signal.throwIfAborted();
        if(result.status!=='archived'||result.retainedCount!==0||result.archivedCount!==review.retainedCount){update({message:'',residentRecovery:{step:result.status==='partial'?'partial':'unavailable'}});return;}
        archived=true;update({residentRecoveryReason:undefined,residentRecovery:undefined,error:'',message:'Startup records were kept. Restarting your agent…'});
      }catch(error){update({residentRecovery:{step:'unavailable'}});throw error;}
    });
    if(archived)await connectionController.startLocal();
  },
  async startLocal() { if(state.residentRecoveryReason){update({open:true,purpose:'agent',error:residentRecoveryMessage(state.residentRecoveryReason)});return;} if (residentAlwaysPresent) { if (!operation) { retire(); await startResident('Starting the local agent…', false); } return; } await work('Starting the local agent…', signal => { retire(); return connectResident(signal); }); },
  async pair(kind: 'remote' | 'local', origin: string, code: string) {
    if (!hosted) { update({ error: PAIRING_RETIRED }); return; }
    await hosted.pair(kind, origin, code);
  },
  /**
   * Eliza Cloud sign-in for the resident agent (owner directive 2026-10-14: sign-in happens inside
   * Alpha). Email always uses Alpha's own screens. Readiness controls whether Google is offered;
   * a failed probe never opens hosted login. The agent keeps running throughout.
   */
  async residentCloudLogin() { await connectionController.beginSignIn(residentEnvironment()); },
  /** Opens Alpha's own sign-in screen when ready. Nothing is sent until the owner chooses Google or
   * enters an email; no Eliza Cloud web page is opened. */
  async beginSignIn(environment: CloudEnvironment = residentCloudFlow() ? residentEnvironment() : cloud.environment) {
    if (operation || !cloudEnvironmentAllowed(environment)) return;
    if (!state.signIn) inAppReturnToStart = !!(state.residentRecoveryReason || state.residentSavedCredential || state.error === RESIDENT_UNPACKAGED);
    // Readiness may take six seconds on a fresh install. Keep that wait cancellable and prevent
    // repeated taps from starting competing probes or opening a browser after the owner cancelled.
    await work(`Checking ${cloudServiceName(environment)} sign-in…`, async signal => {
      const methods = await inAppSignInMethods(environment, signal);
      signal.throwIfAborted();
      // Email stays inside Alpha even when readiness is unavailable. Its native request
      // reports the actual failure; missing Google/App Link setup never opens hosted login.
      if (!cloudSignIn) throw new CloudSignInError('unavailable');
      inAppMethodsUnconfirmed = methods === null;
      inAppGoogle = methods?.google === true;
      inAppPhone = methods?.phone === true;
      inAppEmail = methods === null || methods.email !== false;
      if (cloud.environment !== environment) cloud = makeCloud(environment);
      cloud.cancelLogin();
      update({ open: true, ...(residentCloudFlow() && state.purpose !== 'cloud-account' ? { purpose: 'agent' as const } : {}), signIn: { step: 'choose', environment }, message: '', error: '' });
    });
    await ensureResident();
  },
  /** Leaves the sign-in screen and burns any pending attempt. The stored sign-in is unchanged. */
  cancelSignIn() {
    if (operation) { connectionController.cancel(); return; }
    cloud.cancelLogin();
    update({ signIn: productionCloudSignInRequired(state) && !inAppReturnToStart ? {step: 'choose', environment: state.signIn?.environment ?? residentEnvironment()} : null, message: '', error: '' });
  },
  /** Google's consent in a Custom Tab, returning to Alpha through a verified App Link. */
  async signInGoogle() {
    const view = state.signIn; if (!view) return;
    await work('Continue in Google.', async signal => {
      update({ signIn: { step: 'google', environment: view.environment } });
      const client = signInClient(view.environment);
      let outcome: CloudSignInGoogleOutcome;
      try { outcome = await client.signInWithGoogle(signal); }
      catch (error) { signInFailed(view.environment); throw error; }
      if (outcome.status === 'mfa') { showGoogleMfa(outcome); return; }
      await signedIn(client, outcome, signal);
    });
    // A cancelled or failed sign-in never leaves the phone without its agent (P-43).
    await ensureResident();
  },
  /** Sends a six-digit code to the address. Resending waits out the cooldown the host enforces. */
  async signInEmail(email: string) {
    const view = state.signIn; if (!view) return;
    const address = email.trim();
    if (!validSignInEmail(address)) { update({ error: signInFailureMessage('invalid-email') }); return; }
    await work('Sending your code…', async signal => {
      const started = await signInClient(view.environment).startEmailSignIn(address, signal);
      update({ signIn: { step: 'code', environment: view.environment, email: address, ...started }, message: '' });
    });
    if (state.error && state.signIn?.step !== 'code') update({ signIn: { step: 'choose', environment: view.environment } });
  },
  async signInPhone(phone: string) {
    const view = state.signIn; if (!view || !cloudSignInPhone || !inAppPhone) return;
    const number = phone.trim();
    if (!validSignInPhone(number)) { update({ error: signInFailureMessage('invalid-phone') }); return; }
    await work('Sending your code…', async signal => {
      const started = await signInClient(view.environment).startPhoneSignIn(number, signal);
      update({ signIn: { step: 'code', environment: view.environment, email: '', phone: number, ...started }, message: '' });
    });
    if (state.error && state.signIn?.step !== 'code') update({ signIn: { step: 'choose', environment: view.environment } });
  },
  async resendSignInCode() { const view = state.signIn; if (view?.step === 'code') { if (view.phone) await connectionController.signInPhone(view.phone); else await connectionController.signInEmail(view.email); } },
  /** Verifies the emailed code, or the second verification Cloud asked for. */
  async verifySignInCode(code: string) {
    const view = state.signIn; if (!view || (view.step !== 'code' && view.step !== 'mfa')) return;
    const digits = normalizeSignInCode(code);
    if (!digits) { update({ error: signInFailureMessage('invalid-code') }); return; }
    await work('Checking your code…', async signal => {
      const client = signInClient(view.environment);
      let outcome: CloudSignInAuthenticated;
      try {
        if (view.step === 'mfa') outcome = await client.verifyMfaSignIn(view.attemptId, digits, signal);
        else {
          const codeOutcome = view.phone ? await client.verifyPhoneSignIn(view.attemptId, digits, signal) : await client.verifyEmailSignIn(view.attemptId, digits, signal);
          if (codeOutcome.status === 'mfa') {
            signInFailed(view.environment, true);
            update({ signIn: { step: 'mfa', environment: view.environment, email: view.email, attemptId: view.attemptId, method: codeOutcome.method, expiresAt: codeOutcome.expiresAt },
              message: '' });
            if (codeOutcome.method === 'passkey') throw new CloudSignInError('mfa-unsupported');
            return;
          }
          outcome = codeOutcome;
        }
      } catch (error) {
        // Only native verification failures retire the attempt. Once authenticated, resident
        // startup failures must not reopen sign-in over the stored key and permission setup.
        if (!(error instanceof CloudSignInError && error.code === 'invalid-code')) signInFailed(view.environment);
        else signInFailed(view.environment, true);
        throw error;
      }
      await signedIn(client, outcome, signal);
    });
    await ensureResident();
  },
  /**
   * Native finished a Google return after Alpha restarted (the process stopped while the Custom Tab
   * was open). Completed sign-ins have a stored key; MFA returns first revalidate the native attempt.
   */
  async signInReturned(value: unknown) {
    const environment = residentCloudFlow() ? residentEnvironment() : cloud.environment;
    let outcome: CloudSignInGoogleOutcome;
    try { outcome = signInOutcome(value, environment); } catch { return; }
    if (operation) { queuedSignInReturn = value; return; }
    if (outcome.status === 'mfa') {
      const resumeMfa = cloudSignIn?.resumeMfa?.bind(cloudSignIn);
      if (!resumeMfa) return;
      await work('Checking verification…', async signal => {
        const resumed = await resumeMfa({ attemptId: outcome.attemptId, environment });
        signal.throwIfAborted();
        if (resumed && typeof resumed === 'object' && (resumed as { active?: unknown }).active === true
          && outcome.expiresAt > Date.now()) showGoogleMfa(outcome);
      });
      await ensureResident(); return;
    }
    await work(`Finishing ${cloudServiceName(cloud.environment)} sign-in…`, signal => signedIn(signInClient(environment), outcome, signal));
    await ensureResident();
  },
  /**
   * A return reached Alpha without a sign-in result after the waiting step had already ended (the
   * Cloud page shown when Android did not hand the return to Alpha brings Alpha forward with no
   * parameters). Nothing was signed in: say so plainly and offer a fresh start.
   */
  signInIncomplete(value: unknown) {
    const code = value && typeof value === 'object' ? (value as { code?: unknown }).code : undefined;
    if (operation || code !== 'app-link-unverified') return;
    update({ open: true, signIn: state.signIn ? { step: 'choose', environment: state.signIn.environment } : state.signIn, message: '', error: signInFailureMessage('app-link-unverified') });
  },
  /**
   * The Cloud sign-in hand-off in the browser (cli-session), used by the explicit browser
   * development profile and the test-mocks diagnostic entry. Never a native readiness fallback.
   */
  async signInBrowser(environment: CloudEnvironment = state.signIn?.environment ?? (residentCloudFlow() ? residentEnvironment() : cloud.environment)) {
    if (operation) return;
    update({ signIn: null });
    if (residentCloudFlow()) await connectionController.residentBrowserLogin();
    else await connectionController.browserCloudLogin(environment);
  },
  async residentBrowserLogin() {
    await work(`Opening ${cloudServiceName(cloud.environment)} sign-in…`, residentBrowserLoginAction);
    // A cancelled or failed sign-in never leaves the phone without its agent (P-43).
    await ensureResident();
  },
  /** Opens the hosted plan page in the system browser; the plan is checked again on return. */
  async residentManagePlan() {
    await work(`Opening ${cloudServiceName(cloud.environment)} plans…`,async signal=>{await makeCloud(residentEnvironment()).openSubscriptionManagement(signal);planManagementReturn=true;update({message:`Choose or manage your plan in ${cloudServiceName(cloud.environment)}, then return here. Alpha checks your plan again when you come back.`});});
  },
  /**
   * Redeems a subscription code for the signed-in account, then checks the plan again and admits
   * the agent when the plan allows. Each submission gets a fresh idempotency key; only a transport
   * retry inside the protocol reuses it. The code is never stored, logged or echoed.
   */
  async residentRedeem(code:string):Promise<boolean> {
    if(operation)return false;
    let redeemed=false;
    const idempotencyKey=crypto.randomUUID();
    update({redeemError:'',redeemNotice:''});
    await work('Redeeming your code…',async signal=>{
      const account=service;
      if(!account)throw Error(`Sign in with ${cloudServiceName(cloud.environment)} first.`);
      let result;
      try{result=await account.client.redeemSubscriptionCode(code,idempotencyKey,signal);}
      catch(error){if(error instanceof SubscriptionRedeemError){update({redeemError:redeemFailureMessage(error, cloudServiceName(account.client.environment)),message:''});return;}throw error;}
      if(service!==account)throw Error('Cloud account changed. Sign in again.');
      redeemed=true;
      update({planEndsAt:result.planEndsAt});
      update({redeemNotice:redeemSuccessMessage(result)});
      const endsAt=result.planEndsAt;
      // Bind Eliza Cloud inference into the agent: attaches when the process already matches,
      // otherwise a clean restart. Conversation history stays in the agent and is restored.
      const notice=state.redeemNotice;
      retire();
      try{await connectResident(signal);}catch(error){if(residentAlwaysPresent&&!active)update({kind:'recovering'});throw error;}
      if(endsAt!==null){const record=readPlanAdmission();if(record&&record.credentialId===account.identity.credentialId){writePlanAdmission({...record,endsAt});update({planEndsAt:endsAt});}}
      // The code was redeemed from the plan panel: show its outcome there beside the running agent.
      if(!state.error)update({open:true,purpose:'plan',redeemNotice:notice,message:''});
    });
    return redeemed;
  },
  /** Checks the plan again after the owner returns from Eliza Cloud (resume or visibility). */
  recheckPlanOnReturn(explicit=false) {
    if(!residentCloudFlow()||operation||state.busy)return;
    const now=Date.now();
    if(!explicit&&!planManagementReturn&&now-lastPlanRecheck<PLAN_RECHECK_INTERVAL_MS)return;
    planManagementReturn=false;lastPlanRecheck=now;
    // Without bound Cloud inference (no plan, offline, signed out) or without a running agent, the
    // account and plan are read again; the agent is rebound or restarted only when that changes.
    if(!state.session||residentBinding!=='cloud'){void recheckResidentPlan();return;}
    entitlementRefresher?.refreshNow();
  },
  /** A billing refusal asks for fresh plan state; the failed turn is never retried. */
  recheckPlanAfterRefusal() {
    if(!residentCloudFlow()||!entitlementRefresher)return;
    // Deliver the terminal refusal before refreshing a plan that could rebind the resident.
    // Rebinding here aborts the known failed turn and replaces its billing feedback with an
    // unknown-outcome notice. The next return from account management performs the check.
    if(sending){planManagementReturn=true;return;}
    const now=Date.now();if(now-lastRefusalRecheck<PLAN_RECHECK_INTERVAL_MS)return;
    lastRefusalRecheck=now;entitlementRefresher.refreshNow();
  },
  async cloudLogin(environment: CloudEnvironment) {
    if(!testMocksEnabled && !isAndroid && !browserLocalAgentEnabled){update({open:true,error:WEB_CLOUD_UNAVAILABLE,message:''});return;}
    if(residentCloudFlow()){await connectionController.residentCloudLogin();return;}
    await connectionController.beginSignIn(environment);
  },
  async browserCloudLogin(environment: CloudEnvironment) {
    await work(`Opening ${cloudServiceName(cloud.environment)} sign-in…`, signal => browserCloudLoginAction(environment, signal));
  },
  async cloudList(environment: CloudEnvironment) {
    if (!hosted) { update({ error: PAIRING_RETIRED }); return; }
    await hosted.cloudList(environment);
  },
  cloudEnvironment(environment: CloudEnvironment) {
    if (operation || !cloudEnvironmentAllowed(environment)) return;
    clearPersonalSetup(); cloud = makeCloud(environment); update({ agents: [], message: '', error: '' });
  },
  // Development infrastructure only: Cloud-hosted agents are not a product path (#406).
  cloudPersonalDecline(){hosted?.personalDecline();},
  async cloudPersonalAccept(){if(!hosted){update({error:PAIRING_RETIRED});return;}await hosted.personalAccept();},
  async cloudPersonalPoll(){if(!hosted){update({error:PAIRING_RETIRED});return;}await hosted.personalPoll();},
  async cloudPersonalFinalize(){if(!hosted){update({error:PAIRING_RETIRED});return;}await hosted.personalFinalize();},
  async cloudPersonalRecovery(){await hosted?.personalRecoveryOpen();},
  async cloudManage(environment:CloudEnvironment){if(!hosted){update({error:PAIRING_RETIRED});return;}await hosted.cloudManage(environment);},
  async cloudPersonalConnect(){if(!hosted){update({error:PAIRING_RETIRED});return;}await hosted.personalConnect();},
  /** Revoke on the agent first (device enrollment, then owner session), then forget the local
   * credential and this phone's device installation key. */
  async disconnect() {
    if(residentCloudFlow()){update({error:ALWAYS_LOCAL,message:''});return;}
    await work('Disconnecting…', async signal => {
      const previous = active; const retirement=retire();
      save({ kind: 'none' });
      await retirement;
      let revoked: boolean | null = null;
      if (previous?.kind === 'remote' || previous?.kind === 'local') {
        const result = await previous.remote.revoke(previous.deviceHeaders ?? null, signal);
        revoked = result.session && (!previous.deviceHeaders || result.device);
      } else if (previous?.kind === 'cloud') revoked = previous.revokeDevice ? await previous.revokeDevice(signal) : null;
      else if (previous) await previous.remote.disconnect();
      if (previous?.deviceSlot) await secureConnectionStore.remove(previous.deviceSlot);
      update({ message: revoked === false
        ? 'Agent disconnected on this phone, but the agent did not confirm revocation. Remove this phone from the agent’s paired devices.'
        : revoked ? 'Agent disconnected. This phone’s access was revoked on the agent. Cloud services keep their separate sign-in.' : 'Agent disconnected. Cloud services keep their separate sign-in.', error: '', agents: [] });
    });
    // P-43: disconnecting another agent returns to the resident; it never leaves "no agent". The
    // disconnect outcome stays visible.
    await ensureResident();
  },
  async cloudSignOut() {
    await work('Signing out of Cloud services…', async signal => {
      const previous = service, client = (previous?.client ?? cloud) as CloudProtocol;
      const expected = await cloudCredentialStore.read(client.environment);
      if(previous && (expected?.credentialId!==previous.identity.credentialId || expected?.credentialReference!==previous.credentialReference))throw new Error('Cloud account changed. Reopen account settings before signing out.');
      if(residentCloudFlow()){
        stopEntitlementRefresh();writePlanAdmission(null);update({residentSubscription:null,residentPlanNotice:null,planEndsAt:null,redeemError:'',redeemNotice:''});
        // Unbind Cloud inference before the key is revoked: native stops a process holding the key
        // and removes the binding. The agent is started again after sign-out below, even when
        // native could not confirm removal (it is then shown as unconfirmed, never as unbound).
        await retire();residentBinding=null;update({residentInference:'unknown'});
        if(residentBindable())try{await clearLocalProvider();residentBinding='unbound';update({residentInference:'unavailable'});}catch{/* Retried by the restart below, which reports an unconfirmed removal. */}
      }
      detachCloudTarget(); detachService();
      localStorage.removeItem(CLOUD_SERVICE);
      if (!active) save({ kind: 'none' });

      // Only a confirmed server-side revocation counts. A transport or server that does not offer
      // the route ({supported:false}) or a failed request removes this phone's token only, and the copy says so.
      let revoked = false;
      if (typeof client.revokeSession === 'function') { try { const result = await client.revokeSession(signal, expected); revoked = result?.supported === true && result.revoked === true; } catch { /* Unconfirmed. A cancelled or failed revocation still removes the local token below. */ } }
      await client.disconnect(expected);
      const message = (revoked ? `Signed out of ${cloudServiceName(cloud.environment)}. This sign-in was revoked.` : `Signed out of ${cloudServiceName(cloud.environment)} on this phone. The sign-in token was removed here; ${cloudServiceName(cloud.environment)} did not confirm revoking it.`)+(isAndroid&&!testMocksEnabled?' '+AI_OFF_MESSAGE:'');
      update({ agents: [], residentSavedCredential:false, ...(residentCloudFlow()?{purpose:'agent' as const}:{}), message });
      // The agent keeps running: reconnected (or restarted) without Cloud inference, and the
      // sign-in dialog asks for an account again.
      // A cancelled sign-out still removed the local key above; the agent is then started by the queued rebind.
      if(residentCloudFlow()){if(signal.aborted)residentRebindQueued=true;else{retire();try{await connectResident(signal);}catch(error){if(residentAlwaysPresent&&!active)update({kind:'recovering'});throw error;}update({message,open:true,...(state.residentInference==='unknown'?{error:RESIDENT_UNBIND_UNCONFIRMED}:{})});}}
    });
    // P-43: signing out unbinds inference only; the resident restarts without it.
    await ensureResident();
  },
  async mock() {
    if (!testMocksEnabled) return;
    await work('Pausing live services before mock mode…', async signal => {
      const { pauseLiveActivityForMock } = await import('./mock-admission');
      // Retire renderer actions immediately, then await both live native barriers.
      const results=await Promise.allSettled([retire(),pauseLiveActivityForMock()]);
      if(results.some(result=>result.status==='rejected'))throw Error('Live background activity could not be paused. Retry before opening mock mode.');
      signal.throwIfAborted();
      save({ kind: 'mock' });
      detachService(); const url = new URL(location.href); url.searchParams.set('mode', 'mock'); location.assign(url.href);
    });
  },
  async listHistory() {
    if (sending) { update({ error: 'Wait for the current reply before loading conversations.' }); return; }
    await work('Loading conversations from your selected agent…', async signal => {
      const selected = active, session = state.session, generation = epoch;
      if (!selected || !session) throw noSessionError(NO_SESSION_FALLBACK);
      const list = await conversationList(selected, signal); signal.throwIfAborted();
      if (generation !== epoch) throw new Error('The agent changed.');
      update({ conversations: list, message: list.length ? 'Choose a conversation to replace the visible chat. Your draft will be cleared.' : 'No saved conversations were returned.' });
    });
  },
  async restoreHistory(id: string) {
    if (sending) { update({ error: 'Wait for the current reply before restoring history.' }); return; }
    await work('Verifying and restoring conversation…',signal=>restoreConversationHistory(id,signal,false));
  },
  async retrySavedHistory(){if(sending)return;await work('Checking saved conversation…',signal=>restoreSavedHistory(signal));},
  messageTargetCurrent(target:ConversationMessageTarget) {
    return !!active&&!!state.session&&!state.open&&!state.busy&&!sending&&!operation&&validateUuid(target.messageId)&&target.conversationId===conversationMemory.get(conversationKey(state.session))&&JSON.stringify(target.session)===JSON.stringify(state.session);
  },
  canEditMessages(){return !!active&&active.kind!=='cloud';},
  async truncateMessage(target:ConversationMessageTarget):Promise<void> {
    if(!this.messageTargetCurrent(target)||target.from!=='user'||!active||active.kind==='cloud'||document.hidden)throw Error('This message cannot be edited in the current connection.');
    const selected=active,session=state.session!,generation=epoch,controller=new AbortController(),contextKey=JSON.stringify(navigationContext?.());operation=controller;update({busy:true});let dispatched=false;
    const current=()=>{controller.signal.throwIfAborted();if(document.hidden||state.open||generation!==epoch||selected!==active||JSON.stringify(state.session)!==JSON.stringify(session)||conversationMemory.get(conversationKey(session))!==target.conversationId)throw Error('The conversation changed.');};
    try {
      const history=await selected.remote.messages(target.conversationId,controller.signal);current();
      const row=history.messages.find(row=>row.id===target.messageId);
      if(!row||row.role!=='user'||row.source==='local_command'||typeof row.text!=='string'||restoredText(row.text,row.userTextFormat)!==target.text)throw Error('This message changed. Reload its conversation before editing.');
      if(JSON.stringify(navigationContext?.())!==contextKey)throw Error('The active screen changed. Nothing was replaced.');
      dispatched=true;await selected.remote.truncateMessages(target.conversationId,target.messageId,controller.signal);current();
      await restoreConversationHistory(target.conversationId,controller.signal,true);current();
    } catch(error) {
      if(dispatched){if(generation===epoch)update({historyError:'Message replacement may have changed history. Reload the conversation before another edit.'});throw Object.assign(new Error('Message replacement needs a history check. Nothing was resent automatically.'),{historyChanged:true,cause:error});}
      throw error;
    } finally {if(operation===controller){operation=null;update({busy:false});}}
  },
  voiceConversationCurrent(binding:VoiceConversationBinding,foreground=true){
    return !!active&&(!foreground||!state.open&&!state.busy&&!document.hidden)&&binding.connectionEpoch===epoch&&JSON.stringify(state.session)===JSON.stringify(binding.session)&&conversationMemory.get(conversationKey(binding.session))===binding.conversationId;
  },
  async prepareVoiceConversation(signal:AbortSignal):Promise<VoiceConversationBinding>{
    if(operation||sending||state.open||state.busy||document.hidden)throw Error('Finish the current connection or conversation operation first.');
    const selected=active,session=state.session,generation=epoch;
    if(!selected||!session)throw noSessionError(NO_AGENT_VOICE);
    if((selected.kind==='remote'||selected.kind==='local')&&(!selected.remote.session||selected.remote.session.expiresAt<=Date.now()))throw Error('Your session expired. Pair again before starting voice.');
    const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();operation=controller;
    const current=()=>{controller.signal.throwIfAborted();if(document.hidden||state.open||generation!==epoch||selected!==active||JSON.stringify(state.session)!==JSON.stringify(session))throw Error('The voice conversation changed.');};
    try{current();const conversationId=await ensureSelectedConversation(selected,session,controller.signal,current);current();return {conversationId,session:{...session},connectionEpoch:generation};}
    finally{signal.removeEventListener('abort',cancel);if(operation===controller)operation=null;}
  },
  async send(text: string, context: ContextEnvelope, requestId: string, signal: AbortSignal, onText?:(text:string)=>void,replyTo?:ConversationMessageTarget,onReplyReady?:(results:readonly unknown[]|undefined)=>void,channelType:ChatChannel='DM',expectedConversationId?:string,voiceTurnSignal?:VoiceTurnSignal): Promise<{ messageId?:string;userMessageId?:string;messageBinding?:{conversationId:string;session:VerifiedSession};text: string; proposals?: ActionProposal[]; actionResults?:readonly unknown[]; planAction?: 'plan' | 'retry' | 'sign-in' }> {
    // P-43: before the resident has a session, say it is starting (or recovering); nothing is sent.
    if (!active && residentAlwaysPresent) throw noSessionError('');
    if (operation) throw new Error('Finish the connection or history operation before sending.');
    if(replyTo&&!this.messageTargetCurrent(replyTo))throw Error('The reply target belongs to a different conversation.');
    const message = phoneContextMessage(text, context);
    if (sending) throw new Error('Wait for the current reply before sending another message.');
    const selected = active, session = state.session, generation = epoch;
    requestedCameraContinuation=undefined;
    const cameraNavigation=boundNavigation(),cameraAttempt=cameraNavigation?.currentAttempt(context);
    if (!selected || !session) throw noSessionError(NO_AGENT_SEND);
    const controller = new AbortController();
    const cancel = () => controller.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    sending = controller;
    const requestSignal = controller.signal;
    let dispatched: { conversationId: string; at: number } | null = null;
    if (state.replyNotice) update({ replyNotice: '' });
    cancelStoppedReply();
    try {
      requestSignal.throwIfAborted();
      if (selected.kind === 'remote' || selected.kind === 'local') {
        if (!selected.remote.session || selected.remote.session.expiresAt <= Date.now()) throw Object.assign(new Error('Your session has expired. Pair again.'), { code: 'session_expired' });
      }
      const assertCurrent=()=>{requestSignal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId||(expectedConversationId!==undefined&&conversationMemory.get(conversationKey(session))!==expectedConversationId))throw Error('The connection or conversation changed.');};
      const id=await ensureSelectedConversation(selected,session,requestSignal,assertCurrent);
      if(expectedConversationId!==undefined&&id!==expectedConversationId)throw Error('The voice conversation changed.');
      if(replyTo&&(!validateUuid(replyTo.messageId)||replyTo.conversationId!==id||JSON.stringify(replyTo.session)!==JSON.stringify(session)))throw Error('The reply target belongs to a different conversation.');
      if(replyTo){const history=selected.kind==='cloud'?await selected.cloud.messages(selected.agentId,id,requestSignal):await selected.remote.messages(id,requestSignal);assertCurrent();const row=history.messages.find(row=>row.id===replyTo.messageId);if(!row||row.role!==(replyTo.from==='user'?'user':'assistant')||typeof row.text!=='string'||(replyTo.from==='user'?restoredText(row.text,row.userTextFormat):row.text)!==replyTo.text)throw Error('The reply target changed. Reload its conversation before replying.');}
      // Only the verified native resident profile negotiates verbatim prose
      // history. Other hosts retain the existing envelope and legacy alias.
      const nativeProse=isAndroid&&selected.kind==='resident'&&selected.userTextFormatVersion===1;
      const wireText=nativeProse?text:message.text;
      const actionPreferences=await readDevicePreferences(requestSignal).catch(()=>{requestSignal.throwIfAborted();return {askBeforeAgentActions:true};});assertCurrent();
      const directRequestedActions=!actionPreferences.askBeforeAgentActions;
      const options = { signal: requestSignal, clientMessageId: requestId, channelType, metadata: { ...(directRequestedActions?{agentActionMode:'direct-request-v1'}:{}), ...(channelType==='VOICE_DM'&&voiceTurnSignal?{voiceTurnSignal}:{}), ...(replyTo?{replyToMessageId:replyTo.messageId}:{}), ...(message.context.timeZone===undefined?{}:{uiTimeZone:message.context.timeZone}), clientDevice: { context: message.context }, ...boundNavigation()?.metadata(context), ...(nativeProse?{userTextFormat:'plain-v1'}:{alphaPhone:{context:message.context}}) } };
      dispatched = { conversationId: id, at: Date.now() };
      const progress=(value:string)=>{requestSignal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId)throw Error('The connection changed.');onText?.(value);};
      const replyReady=(results:readonly unknown[]|undefined)=>{assertCurrent();onReplyReady?.(results);};
      const reply = selected.kind === 'cloud' ? await selected.cloud.send(selected.agentId, id, wireText, options) : selected.kind==='resident'?await withResidentMapsNavigation(selected.request,id,requestSignal,()=>selected.remote.send(id,wireText,{...options,onText:progress,onReplyReady:replyReady})):await selected.remote.send(id, wireText, options);
      requestSignal.throwIfAborted();
      assertCurrent();
      if(channelType==='VOICE_DM' && (('interrupted' in reply && reply.interrupted===true)||('noResponseReason' in reply && reply.noResponseReason==='ignored')))throw Error('The voice response did not complete. Check conversation history before speaking again.');
      let responseFailure: Error | undefined;
      const failed = ('failureKind' in reply && !!reply.failureKind) || ('terminalFailure' in reply && !!reply.terminalFailure);
      // The on-device agent answered without Eliza Cloud inference (no plan, offline or signed
      // out): its turn is recorded in the conversation, and the owner gets an honest answer with
      // the plan actions instead of a generic failure. Nothing is retried or purchased.
      if (failed && selected.kind === 'resident' && residentCloudFlow() && (state.residentInference === 'unavailable' || ('failureKind' in reply && reply.failureKind === 'no_provider' && state.residentInference !== 'cloud'))) {
        const notice = state.residentPlanNotice ?? null, signedIn = !!state.cloudAccount;
        return { text: inferenceUnavailableReply(notice, signedIn), planAction: notice === 'offline' ? 'retry' : signedIn ? 'plan' : 'sign-in', ...(typeof reply.messageId === 'string' && validateUuid(reply.messageId) ? { messageId: reply.messageId } : {}), ...(typeof reply.userMessageId === 'string' && validateUuid(reply.userMessageId) ? { userMessageId: reply.userMessageId } : {}), messageBinding: { conversationId: id, session: { ...session } } };
      }
      if (failed) {
        // Cloud's own refusal (rate limit, used allowance, no active plan) carries its retry
        // information; the phone presents it and never retries, upgrades or buys anything.
        // A structured period-allowance reset (`resetAt`, ISO 8601) or wait (`retryAfterSeconds`)
        // on the failed turn is read like a direct HTTP refusal's; absent, nothing is invented.
        const timing = reply as { resetAt?: unknown; retryAfterSeconds?: unknown };
        responseFailure = replyFailure(failureKindOf(reply), selected, readServiceLimit({ failureKind: 'failureKind' in reply ? reply.failureKind : undefined, terminalFailure: 'terminalFailure' in reply ? reply.terminalFailure : undefined, resetAt: timing.resetAt, retryAfterSeconds: timing.retryAfterSeconds }));
        if ('failureKind' in responseFailure) retractReadiness();
      }
      for(const key of ['messageId','userMessageId'] as const)if(reply[key]!==undefined&&!validateUuid(reply[key]))throw Error('The agent returned an invalid message identity.');
      if (typeof reply.text !== 'string') throw new Error('The agent returned an invalid response.');
      let proposals: ActionProposal[] | undefined, notices: string[] = [];
      if (selected.actions) {
        // A pending action that does not fit this screen, time zone or negotiated support is
        // named to the owner instead of being dropped; it stays unapprovable.
        try { let items = await selected.actions.pendingReview(context, requestSignal);
          if(!responseFailure&&directRequestedActions&&typeof reply.userMessageId==='string'&&validateUuid(reply.userMessageId)){
            const performed=await selected.actions.performRequested(reply.userMessageId,context,requestSignal,async()=>!(await readDevicePreferences(requestSignal)).askBeforeAgentActions);
            assertCurrent();
            if(performed.length){notices.push(...performed.map(result=>result.summary.slice(0,500)));items=await selected.actions.pendingReview(message.context,requestSignal);}
          }
          proposals = items.flatMap(item => item.proposal ? [item.proposal] : []); notices.push(...items.flatMap(item => item.notice ? [item.notice.slice(0, 500)] : []));notices=notices.slice(0,5); }
        catch { update({ message: 'Reply received. Phone action proposals could not be checked; use action history.' }); }
      }
      requestSignal.throwIfAborted();
      assertCurrent();
      // A failed reply can follow a durably recorded proposal. Recover only the
      // existing identity/context-bound review; never retry chat or execute it.
      if (responseFailure && !proposals?.length) throw responseFailure;
      if(!responseFailure&&directRequestedActions&&message.context.view==='home'&&cameraNavigation&&cameraAttempt&&typeof reply.userMessageId==='string'&&Array.isArray(reply.actionResults)){
        requestedCameraContinuation={messageId:reply.userMessageId,selected,session,generation,conversationId:id,client:cameraNavigation,attempt:cameraAttempt,expiresAt:Date.now()+30_000};
      }
      return { text: responseFailure
        ? `${responseFailure.message} Pending phone actions are available for separate review. Nothing has been approved or performed automatically.`
        : reply.text, ...(notices.length ? { notices } : {}), ...(!responseFailure?{...(typeof reply.messageId==='string'?{messageId:reply.messageId}:{}),...(typeof reply.userMessageId==='string'?{userMessageId:reply.userMessageId}:{}),messageBinding:{conversationId:id,session:{...session}}}:{}), ...(proposals ? { proposals } : {}), ...(!responseFailure&&Array.isArray(reply.actionResults)?{actionResults:reply.actionResults}:{}) };
    } catch (error) {
      // Nothing carrying the message left this phone (no conversation, offline, changed owner, or a
      // Stop before the post): the composer keeps the text instead of reporting an unknown outcome.
      // The marker is set per failure: an error object seen after the post never keeps an earlier mark.
      // A transport that proves its request was refused before the turn was accepted (native IPC
      // rejection, an agent's 429 admission refusal) marks it `beforeDispatch`: still provably unsent.
      const refused = !!error && typeof error === 'object' && (error as { beforeDispatch?: unknown }).beforeDispatch === true;
      const mark = (target: unknown) => { if (target && typeof target === 'object' && (!dispatched || refused || 'notDispatched' in target)) try { Object.defineProperty(target, 'notDispatched', { value: !dispatched || refused, configurable: true }); } catch { /* An unmarkable error stays an unknown outcome. */ } };
      mark(error);
      // Stop (or leaving the chat) after dispatch: the turn may still complete on the agent.
      if (signal.aborted && dispatched && generation === epoch && selected === active && state.session?.sessionId === session.sessionId) scheduleStoppedReply(selected, session, dispatched.conversationId, { clientMessageId: requestId, text, sentAt: dispatched.at });
      if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
        const limited = refused ? Object.assign(new AlphaClientError('transport-failed', 'The agent is busy and did not accept this message. Wait, then send it again.'), { refusedBeforeTurn: true }) : new AlphaClientError('transport-failed', serviceLimitMessage(readServiceLimit(error), Date.now(), cloudServiceName(cloud.environment)));
        // Rate-limited before the post (creating or reading the conversation): still provably unsent.
        mark(limited); throw limited;
      }
      // A stream that ended on a terminal failure frame carries its kind: the turn failed on the agent.
      const kind = dispatched && !signal.aborted && !(error instanceof AlphaClientError) ? failureKindOf(error) : undefined;
      if (kind && generation === epoch && selected === active) {
        const failure = replyFailure(kind, selected, readServiceLimit(error));
        if ('failureKind' in failure) retractReadiness();
        mark(failure); throw failure;
      }
      if (expired(error) && generation === epoch) {
        retire('Sign-in required');
        update({ error: !testMocksEnabled ? errorMessage({ status: 401 }) : 'Sign in or pair again.', open: true });
        try {
          if (selected.kind === 'cloud') { detachService(); await selected.cloud.disconnect(); }
          else await selected.remote.disconnect();
        } catch {
          update({ error: 'The expired connection is detached, but its stored credential could not be removed.', open: true });
        }
      }
      throw error;
    } finally { signal.removeEventListener('abort', cancel); if (sending === controller) sending = null; }
  },
};

// A Google sign-in that native finished after Alpha restarted arrives as a retained event.
if (cloudSignIn?.addListener) Promise.resolve(cloudSignIn.addListener('signInCompleted', outcome => { void connectionController.signInReturned(outcome); })).catch(() => { /* No retained return. */ });
if (cloudSignIn?.addListener) Promise.resolve(cloudSignIn.addListener('signInMfaRequired', outcome => { void connectionController.signInReturned(outcome); })).catch(() => { /* No retained challenge. */ });
if (cloudSignIn?.addListener) Promise.resolve(cloudSignIn.addListener('signInIncomplete', value => { connectionController.signInIncomplete(value); })).catch(() => { /* No retained return. */ });
export function productionCloudSignInRequired(snapshot: Pick<ConnectionSnapshot,'cloudAccount'|'error'>): boolean {
  return isAndroid&&!testMocksEnabled&&(!snapshot.cloudAccount||snapshot.error===errorMessage({status:401})||(snapshot.cloudAccount.expiresAt!==undefined&&snapshot.cloudAccount.expiresAt<=Date.now()));
}
export function connectionChooserVisible(snapshot: Pick<ConnectionSnapshot,'open'|'automaticRestore'|'busy'|'error'>&Partial<Pick<ConnectionSnapshot,'cloudAccount'|'purpose'|'signIn'>>): boolean {
  if(isAndroid&&!testMocksEnabled&&'cloudAccount' in snapshot){
    if(productionCloudSignInRequired({cloudAccount:snapshot.cloudAccount??null,error:snapshot.error}))return true;
    // The signed-in agent's state and controls live in Settings, never in an automatic sheet.
    if(!snapshot.signIn&&snapshot.purpose!=='cloud-account'&&snapshot.purpose!=='plan')return false;
  }
  return snapshot.open && !(snapshot.automaticRestore && snapshot.busy && !snapshot.error);
}
export function ConnectionChooser() {
  const snapshot = useSyncExternalStore(connectionController.subscribe, connectionController.getSnapshot);
  // Production Android always enters through sign-in while signed out.
  // Only the explicit test-mocks build retains developer bypass behavior.
  const productionSignInRequired=productionCloudSignInRequired(snapshot);
  const visible=connectionChooserVisible(snapshot);
  const initialSignInStarted=useRef(false);
  useEffect(()=>{
    if(!productionSignInRequired){initialSignInStarted.current=false;return;}
    // Keep saved-session retry and startup/recovery errors visible before a new sign-in.
    if(initialSignInStarted.current||!snapshot.startupResolved||snapshot.busy||snapshot.signIn||snapshot.residentRecoveryReason||snapshot.residentSavedCredential||snapshot.error)return;
    initialSignInStarted.current=true;
    void connectionController.beginSignIn(residentEnvironment());
  },[productionSignInRequired,snapshot.startupResolved,snapshot.busy,snapshot.signIn,snapshot.residentRecoveryReason,snapshot.residentSavedCredential,snapshot.error]);
  const [developmentAction,setDevelopmentAction]=useState('{"type":"create_note","title":"Development note","body":"Reviewed local action"}');
  const [developmentProfile,setDevelopmentProfile]=useState<DevelopmentProfile>('local'),[reply,setReply]=useState(''),[developmentError,setDevelopmentError]=useState('');
  const [replyReady,setReplyReady]=useState(false),[developmentAccountRevision,setDevelopmentAccountRevision]=useState(0);
  const agentRecovery=useRef<AbortController|null>(null);
  useEffect(()=>()=>{agentRecovery.current?.abort();},[developmentProfile]);
  useEffect(()=>{const retire=()=>agentRecovery.current?.abort(),hidden=()=>{if(document.hidden)retire();};const events=['pagehide','launcher-home','alpha:device-state','alpha:dev-incoming-call'];for(const event of events)window.addEventListener(event,retire);document.addEventListener('visibilitychange',hidden);return()=>{retire();for(const event of events)window.removeEventListener(event,retire);document.removeEventListener('visibilitychange',hidden);};},[]);
  useEffect(()=>{if(!browserDevProfile||!visible||snapshot.purpose==='cloud-account')return;const controller=new AbortController();setReplyReady(false);setReply('');setDevelopmentError('');void developmentReply(developmentProfile,controller.signal).then(value=>{if(!controller.signal.aborted){setReply(value);setReplyReady(true);}},()=>{if(!controller.signal.aborted)setDevelopmentError('Development data could not be read. Open agent history recovery to download or reset it.');});return()=>controller.abort();},[developmentProfile,visible,snapshot.purpose,developmentAccountRevision]);
  const recoverConversationChoice=async()=>{if(state.busy)return;sending?.abort(new DOMException('Conversation recovery requested.','AbortError'));agentRecovery.current?.abort();const controller=agentRecovery.current=new AbortController();try{const domain=await conversationSelectionDocument();controller.signal.throwIfAborted();connectionController.close();openDomainRecovery(domain,'conversation selections','Conversation selection recovery','Download saved conversation selections before resetting. This clears only browser restart choices; conversations remain on their agents. It does not delete conversations, messages or provider data. Reset never sends a message. Close older Alpha tabs before continuing.',controller.signal);}catch{if(!controller.signal.aborted)update({error:'Conversation selections could not be read.'});}};
  const recoverDevelopment=(kind:'agent'|'execution'|'digest')=>{try{const identity=developmentIdentity(developmentProfile),domain=developmentOwnerRecovery(kind==='agent'?developmentAgentDocument(identity):kind==='execution'?developmentExecutionDocument(identity):developmentDigestDocument(identity),identity);agentRecovery.current?.abort();const controller=agentRecovery.current=new AbortController();connectionController.close();if(kind==='agent')openDomainRecovery(domain,'agent history','Development agent history recovery','Download this profile’s conversations, scripted reply and message receipts before resetting. Reset clears only this development agent history and restores the default reply. Pending device actions, workflows and real local-agent data are separate. Close older Alpha tabs before continuing.',controller.signal);else if(kind==='execution')openDomainRecovery(domain,'execution history','Development execution recovery','Download this profile’s workflows, runs, action proposals and receipts before resetting. Reset clears them together so waiting workflows cannot recreate cleared proposals. Pending actions may already have happened: reconcile them before resetting. Reset does not undo effects. Older bytes are preserved inside a JSON archive. Real local-agent data is separate. Close older Alpha tabs before continuing.',controller.signal);else openDomainRecovery(domain,'digest schedules','Development digest schedule recovery','Download this profile’s read grants, sources, schedules, execution results and delivery acknowledgements before resetting. Reset removes these local schedules and grants. Already saved inbox results remain in the separate inbox. Real provider grants and real local-agent data are separate. Close older Alpha tabs before continuing.',controller.signal);}catch{setDevelopmentError('Development recovery could not be opened.');}};
  const [localPackaging,setLocalPackaging]=useState<'checking'|'available'|'unavailable'>('checking');
  useEffect(()=>{if(!visible||snapshot.purpose==='cloud-account')return;let current=true;setLocalPackaging('checking');void localAgentPackaged().then(available=>{if(current)setLocalPackaging(available?'available':'unavailable');});return()=>{current=false;};},[visible,snapshot.purpose]);
  const providerKey=useRef<HTMLInputElement>(null);
  const redeemCode=useRef<HTMLInputElement>(null);
  const qaEnvironment=useRef<HTMLSelectElement>(null);
  const [confirmRemove,setConfirmRemove]=useState(false);
  // The plan notice beside the running agent can be dismissed until the notice changes.
  const [dismissedNotice,setDismissedNotice]=useState<string|null>(null);
  const panel = useRef<HTMLDivElement>(null);
  // The control that opened the dialog. Kept across re-runs while it stays open (busy or purpose
  // changes), which would otherwise capture a control inside the dialog and lose the return focus.
  const opener = useRef<HTMLElement | null>(null);
  // Read before this render commits: a field in the dialog may take focus as it mounts.
  if (visible && !opener.current && document.activeElement instanceof HTMLElement && !panel.current?.contains(document.activeElement) && document.activeElement !== document.body) opener.current = document.activeElement;
  const remoteOrigin = useRef<HTMLInputElement>(null), remoteCode = useRef<HTMLInputElement>(null);
  const localOrigin = useRef<HTMLInputElement>(null), localCode = useRef<HTMLInputElement>(null);
  const environment = useRef<HTMLSelectElement>(null);
  useEffect(() => { void connectionController.initialize(); }, []);
  useEffect(()=>{const offline=()=>connectionController.networkChanged(false),online=()=>connectionController.networkChanged(true);window.addEventListener('offline',offline);window.addEventListener('online',online);return()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',online);};},[]);
  // Plan state is checked again when the owner returns (for example from Eliza Cloud's plan page).
  useEffect(()=>{if(!residentCloudFlow())return;const visible=()=>{if(!document.hidden)connectionController.recheckPlanOnReturn();};document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',visible);window.addEventListener('online',visible);return()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',visible);window.removeEventListener('online',visible);};},[]);
  useEffect(()=>{
    if(isAndroid)return;
    const changed=(event:StorageEvent)=>{
      if(event.key!==SELECTION&&event.key!==CLOUD_SERVICE&&event.key!==null)return;
      agentRecovery.current?.abort();operation?.abort();
      if(event.key===SELECTION||event.key===null){
        void retire();
        if(event.key===null||selection()?.kind==='offline')detachService();
      }else{detachCloudTarget();detachService();}
      // Read preferences only. Another tab's choice must not trigger sign-in or
      // be overwritten by cancellation cleanup in this tab.
      update({open:false});
      // P-43: the agent on this computer reconnects instead of leaving this tab without one.
      if(residentAlwaysPresent&&selection()?.kind!=='development')void Promise.resolve().then(ensureResident);
    };
    window.addEventListener('storage',changed);
    return()=>window.removeEventListener('storage',changed);
  },[]);

  useEffect(()=>{if(!browserDevProfile)return;const changed=()=>{const selected=selection();if(selected?.kind==='development'&&selected.profile==='cloud'){operation?.abort();sending?.abort();void retire();save({kind:'none'});if(residentAlwaysPresent)void Promise.resolve().then(ensureResident);}agentRecovery.current?.abort();setReplyReady(false);setDevelopmentAccountRevision(value=>value+1);};const stored=(event:StorageEvent)=>{if(event.key===developmentCloudKey||event.key===null)changed();};window.addEventListener('alpha:development-account-changed',changed);window.addEventListener('storage',stored);return()=>{window.removeEventListener('alpha:development-account-changed',changed);window.removeEventListener('storage',stored);};},[developmentProfile]);
  useEffect(() => {
    if (!browserDevProfile) return;
    const cancel = () => { agentRecovery.current?.abort();operation?.abort(); sending?.abort(); update({open:false}); };
    // Firefox can revoke storage during pagehide. Retire pending work without
    // asking the shell to read device storage in a departing document.
    const suspend = () => { developmentPageSuspended = true; cancel(); };
    const resume = () => { developmentPageSuspended = false; update({}); };
    const visibility = () => { if (document.hidden) suspend(); else resume(); };
    const events = ['launcher-home','alpha:device-state'];
    events.forEach(event => window.addEventListener(event,cancel));
    window.addEventListener('pagehide',suspend);
    window.addEventListener('pageshow',resume);
    document.addEventListener('visibilitychange',visibility);
    return () => {
      developmentPageSuspended = false;
      events.forEach(event => window.removeEventListener(event,cancel));
      window.removeEventListener('pagehide',suspend);
      window.removeEventListener('pageshow',resume);
      document.removeEventListener('visibilitychange',visibility);
    };
  },[]);
  useEffect(() => {
    if (!visible) { const target = opener.current; opener.current = null; if (target?.isConnected) target.focus(); return; }
    const phone = document.querySelector<HTMLElement>('.os');
    const releaseInert = holdPhoneInert(phone);

    if (phone && panel.current) {
      const theme = getComputedStyle(phone);
      // The dialog's accent colours text and focus rings, so it takes the theme's text accent
      // (--acct): the fill accent (--acc) is 2.4:1 against the dark background.
      for (const key of ['bg', 'fg', 's2', 'line', 'mut', 'acc']) panel.current.style.setProperty(`--connection-${key}`, theme.getPropertyValue(key === 'acc' ? '--acct' : `--${key}`));
    }
    // A child form restores its input after verification. Updating the trap for busy state must
    // preserve that focus, rather than moving it back to the dialog and dismissing the keyboard.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const back = (event: Event) => { if(document.querySelector("dialog[open]"))return; event.preventDefault(); event.stopImmediatePropagation(); if (snapshot.busy) connectionController.cancel(); else connectionController.close(); };
    window.addEventListener('alpha-back', back, true);
    const key = (event: KeyboardEvent) => {
      if(document.querySelector("dialog[open]"))return;
      if (event.key === 'Escape') { event.preventDefault(); if (snapshot.busy) connectionController.cancel(); else connectionController.close(); }
      if (event.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); window.removeEventListener('alpha-back', back, true); releaseInert(); };
  }, [visible, snapshot.busy,snapshot.purpose]);
  const env = (): CloudEnvironment => resolveCloudEnvironment(cloudEnvironmentPolicy, environment.current?.value ?? snapshot.signIn?.environment ?? cloud.environment);
  const serviceName=cloudServiceName(env());
  const browserOnly = !testMocksEnabled && !isAndroid && !browserLocalAgentEnabled;
  const cloudAccountControls=<>
    {browserOnly&&<p>{WEB_CLOUD_UNAVAILABLE}</p>}
    {snapshot.cloudAccount&&<section className="alpha-connection-current alpha-cloud-account-summary"><strong>{snapshot.cloudAccount.email||`Signed in to ${serviceName}`}</strong>{!snapshot.cloudAccount.email&&<span>Account {snapshot.cloudAccount.userId}</span>}<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Sign out of {serviceName}</button></section>}
    {browserCloudResidentEnabled&&<p role="status">Cloud environment: {browserCloudResidentEnvironment==='staging'?'Staging QA':'Production'}. Your agent runs on this computer.</p>}
    {testMocksEnabled&&snapshot.purpose!=='cloud-account'&&<label>Environment<select aria-label="Environment" ref={environment} disabled={snapshot.busy} defaultValue={resolveCloudEnvironment(cloudEnvironmentPolicy, snapshot.signIn?.environment ?? cloud.environment)} onChange={()=>connectionController.cloudEnvironment(env())}><option value="production">Production</option><option value="staging">Staging</option></select></label>}
    {!browserOnly&&(!snapshot.cloudAccount||snapshot.purpose!=='cloud-account')&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.cloudLogin(env())}>Sign in with {serviceName}</button></div>}
  </>;
  if (!visible) {
    // Never a gate: the agent is running. A non-blocking notice offers the plan actions.
    const notice=residentCloudFlow()&&snapshot.session?(snapshot.residentPlanNotice==='offline'?'offline':snapshot.residentPlanNotice==='needs-plan'&&snapshot.cloudAccount?'needs-plan':null):null;
    if(!notice||dismissedNotice===notice)return null;
    return <aside className="alpha-plan-notice" role="region" aria-label={`${serviceName} plan notice`}>
      <p role="status">{notice==='offline'?OFFLINE_NOTICE:NEEDS_PLAN_NOTICE}</p>
      <div className="alpha-plan-notice-actions">
        {notice==='needs-plan'?<>
          <button disabled={snapshot.busy} onClick={()=>connectionController.openPlan()}>Redeem code</button>
          <button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{CHOOSE_PLAN_LABEL}</button>
        </>:<button disabled={snapshot.busy} onClick={()=>connectionController.recheckPlanOnReturn(true)}>Try again</button>}
        <button aria-label="Dismiss plan notice" onClick={()=>setDismissedNotice(notice)}>×</button>
      </div>
    </aside>;
  }
  if (snapshot.signIn) return <div className={productionSignInRequired?'alpha-auth-page':'alpha-connection-scrim'}><div className={`alpha-connection alpha-connection-native alpha-cloud-sign-in${productionSignInRequired?' alpha-auth-content':''}`} role={productionSignInRequired?'main':'dialog'} aria-modal={productionSignInRequired?undefined:true} aria-labelledby="cloud-sign-in-title" aria-busy={snapshot.busy||undefined} tabIndex={-1} ref={panel}>
    <CloudSignInPanel methodsUnconfirmed={inAppMethodsUnconfirmed} canGoBack={!productionSignInRequired || inAppReturnToStart} view={snapshot.signIn} busy={snapshot.busy} google={inAppGoogle} phone={cloudSignInPhone && inAppPhone} emailEnabled={inAppEmail} message={snapshot.message} error={snapshot.error}
      actions={{retry:()=>void connectionController.beginSignIn(snapshot.signIn!.environment),phone:number=>void connectionController.signInPhone(number),google:()=>void connectionController.signInGoogle(),email:address=>void connectionController.signInEmail(address),verify:code=>void connectionController.verifySignInCode(code),resend:()=>void connectionController.resendSignInCode(),cancel:()=>connectionController.cancelSignIn()}}
      extra={browserCloudResidentEnabled?<button disabled={snapshot.busy} onClick={()=>void connectionController.signInBrowser()}>Sign in with browser</button>:testMocksEnabled?<button disabled={snapshot.busy} onClick={()=>void connectionController.signInBrowser()}>Browser sign-in (diagnostic)</button>:undefined}/>
  </div></div>;
  if(productionSignInRequired)return <div className="alpha-auth-page"><div className="alpha-connection alpha-auth-content" role="main" aria-labelledby="alpha-auth-title" aria-busy={snapshot.busy||undefined} tabIndex={-1} ref={panel}>
    <div className="alpha-auth-body">
      <h1 id="alpha-auth-title" className="serif">Sign in</h1>
      <div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Sign in with {serviceName}</button></div>
      {snapshot.busy&&<><p role="status">{snapshot.message||'Please wait…'}</p><button className="alpha-connection-cancel" onClick={()=>connectionController.cancel()}>Cancel</button></>}
      {!snapshot.busy&&snapshot.message&&snapshot.message!=='Connected'&&<p role="status">{snapshot.message}</p>}
      {snapshot.residentSavedCredential&&!snapshot.residentRecoveryReason&&snapshot.error!==errorMessage({status:401})&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button>}
      {snapshot.error&&<p role="alert" className="alpha-connection-error">{snapshot.error}</p>}
      <ResidentRecoveryPanel snapshot={snapshot}/>
    </div>
  </div></div>;
  const accountCreatedNotice=snapshot.accountCreated&&snapshot.cloudAccount&&<p role="status" className="alpha-cloud-account-created">This sign-in created a new {serviceName} account{snapshot.cloudAccount.email?` (${snapshot.cloudAccount.email})`:''}. If you meant to use an existing account, sign out and sign in with that account’s email or Google.</p>;
  const actionReview=snapshot.session&&snapshot.phoneActionsAvailable&&<details open={snapshot.actionHistory.some(item=>item.state==='reconciliation_required')}><summary>Phone action history</summary><button disabled={snapshot.busy} onClick={() => void connectionController.actionHistory()}>Refresh actions</button><button disabled={snapshot.busy} onClick={() => void connectionController.actionHistory(true)}>Sync recorded receipts</button>{snapshot.actionHistory.map(item => <section key={item.id} className="alpha-connection-agent"><strong>{item.title}</strong>{item.detail&&<span>{item.detail}</span>}<span>{item.outcome}{item.timestamp&&` · ${item.timestamp}`}</span>{item.state === 'pending' && <button disabled={snapshot.busy} onClick={() => void connectionController.rejectAction(item.id)}>Reject proposal</button>}{['executing','reconciliation_required'].includes(item.state) && <><p>After checking this phone, confirm whether this exact action happened.</p><button disabled={snapshot.busy} onClick={() => void connectionController.reconcileAction(item.id, 'applied')}>I verified it happened</button><button disabled={snapshot.busy} onClick={() => void connectionController.reconcileAction(item.id, 'not_applied')}>I verified it did not happen</button></>}</section>)}</details>;
  const conversations=snapshot.session&&<details><summary>Conversation history</summary><p>Load from this agent only. Restoring replaces the visible chat and draft; it does not run past actions.</p><button disabled={snapshot.busy} onClick={() => void connectionController.newConversation()}>New conversation</button><button disabled={snapshot.busy} onClick={() => void connectionController.listHistory()}>Load conversations</button>{snapshot.conversations.map(item => <section key={item.id} className="alpha-connection-agent"><strong>{item.title}</strong><button disabled={snapshot.busy} onClick={() => void connectionController.restoreHistory(item.id)}>Restore conversation</button></section>)}</details>;
  // The account panel Inbox opens ("Connect Eliza Cloud"). On production Android a sign-in kept on
  // this phone is offered here exactly as Settings › Agent connection offers it: "Retry saved
  // connection" starts the on-device agent with that sign-in (connectResident, never a remote or
  // Cloud-hosted agent), only when the owner asks. Until that succeeds nothing says the phone is
  // signed in or connected, a failure is shown as the error it was, and a sign-in Cloud rejected
  // is no longer offered for retry.
  const savedSignInRejected=snapshot.error===errorMessage({status:401});
  const savedSignInOffered=residentCloudFlow()&&!snapshot.cloudAccount&&snapshot.residentSavedCredential===true&&!savedSignInRejected;
  if(snapshot.purpose==='cloud-account')return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="cloud-account-title" tabIndex={-1} ref={panel}>
    <header><h1 id="cloud-account-title" className="serif">{serviceName}</h1><button aria-label="Close Cloud account" disabled={snapshot.busy} onClick={()=>connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    {accountCreatedNotice}
    {!snapshot.cloudAccount&&<p>{savedSignInOffered?'Retry your saved connection or sign in again to use connected services such as Gmail.':'Sign in to use connected services such as Gmail.'}</p>}
    {savedSignInOffered&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button></div>}
    {savedSignInOffered&&snapshot.residentPlanNotice==='offline'&&<p role="status">{OFFLINE_NOTICE}</p>}
    {cloudAccountControls}
    {snapshot.message&&<p role="status">{snapshot.message}</p>}{snapshot.error&&<p role="alert" className="alpha-connection-error">{residentCloudFlow()&&savedSignInRejected?'Your saved Cloud sign-in is no longer valid.':snapshot.error}</p>}
    {snapshot.busy&&<button className="alpha-connection-cancel" onClick={()=>connectionController.cancel()}>Cancel</button>}
  </div></div>;

  // P-43 (owner, 2026-10-13): the agent always runs on this device. This dialog is its status
  // (Starting / Running on this device / Not running, with Retry) and its Eliza Cloud AI: sign-in
  // (which every Alpha Phone needs), plan, redeem code and sign-out. Plan state never stops the agent.
  const residentSignInRejected=snapshot.error===errorMessage({status:401});
  const residentStatus=snapshot.session?'Running on this device':snapshot.residentRecoveryReason?'Recovery review needed':snapshot.kind==='recovering'?'Not running':'Starting…';
  const residentNeedsPlan=snapshot.residentPlanNotice==='needs-plan'&&!!snapshot.cloudAccount&&!residentSignInRejected;
  const residentOffline=snapshot.residentPlanNotice==='offline'&&!snapshot.cloudAccount;
  // Only a required sign-in (first run, or a sign-in Cloud rejected) cannot be dismissed. The agent runs either way.
  const residentMustSignIn=residentCloudFlow()&&!snapshot.cloudAccount&&snapshot.residentPlanNotice!=='offline'&&!snapshot.residentStarting;
  // Required sign-in stays focused; a recovery error retains the full connection controls.
  const residentFirstSignIn=residentMustSignIn&&!snapshot.residentSavedCredential&&!residentSignInRejected&&!snapshot.residentRecoveryReason&&!snapshot.error;
  const planPanel=snapshot.purpose==='plan';
  // A check that ended without a view (identity or transport failure) is "unavailable", never a stale gate.
  const residentPlanView=snapshot.residentSubscription;
  const residentPlanUnchecked=!residentPlanView||residentPlanView.kind==='checking';
  const residentPlanDescribed=residentPlanUnchecked&&!snapshot.busy?{headline:'Plan status unavailable',detail:'Try again.',manage:false,manageLabel:''}:describeSubscription(residentPlanView,serviceName);
  const residentPlan=residentNeedsPlan&&residentPlanView?.kind==='unavailable'&&residentPlanView.reason!=='not-published'
    ?{...residentPlanDescribed,detail:`${serviceName} could not confirm a plan for this account right now. Check again, redeem a subscription code or choose a plan. Your data on this phone is kept.`}:residentPlanDescribed;
  const residentPlanRecheck=residentPlanUnchecked||residentPlanView.kind==='inactive'||residentPlanView.kind==='unavailable';
  const residentAiOff=residentFirstSignIn?`Sign in to ${serviceName} to use AI. Your agent keeps running on this phone.`:snapshot.residentSavedCredential?`AI is off. Retry your saved ${serviceName} sign-in or sign in again.`:`AI is off. Sign in to ${serviceName} for AI.`;
  const keyExpiresAt=snapshot.cloudAccount?.expiresAt;
  const keyExpiring=keyExpiresAt!==undefined&&keyExpiresAt-Date.now()<=CLOUD_KEY_EXPIRY_WARNING_MS;
  const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  const redeemForm=<form className="alpha-connection-redeem" aria-label="Redeem a subscription code" onSubmit={event=>{event.preventDefault();const value=redeemCode.current?.value||'';void connectionController.residentRedeem(value).then(redeemed=>{const input=redeemCode.current;if(!input)return;if(redeemed)input.value='';else input.focus();});}}>
    <label>Subscription code<input ref={redeemCode} name="subscription-code" autoComplete="one-time-code" aria-invalid={snapshot.redeemError?true:undefined} aria-describedby={snapshot.redeemError?'alpha-redeem-error':undefined} data-autofill-ignore="true" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={64} required disabled={snapshot.busy} placeholder="XXXX-XXXX-XXXX-XXXX"/></label>
    <button disabled={snapshot.busy}>Redeem code</button>
  </form>;
  if(residentCloudFlow())return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-connection-native alpha-connection-resume" role="dialog" aria-modal="true" aria-labelledby="connection-title" aria-busy={snapshot.residentStarting||undefined} tabIndex={-1} ref={panel}>
    <header><h1 id="connection-title" className="serif">{planPanel&&snapshot.cloudAccount?(residentPlanView?.kind==='credits'?`${serviceName} account`:`${serviceName} account & plan`):'Your agent'}</h1>{!residentMustSignIn&&<button aria-label="Close connection settings" disabled={snapshot.busy&&!snapshot.residentStarting} onClick={()=>connectionController.close()}>×</button>}</header>
    <section aria-label="Agent status"><p role="status"><strong>{residentStatus}</strong>{!snapshot.session&&snapshot.kind!=='recovering'?' · Your agent runs on this device.':''}</p>
      {snapshot.kind==='recovering'&&!snapshot.session&&!snapshot.residentRecoveryReason&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry</button></div>}
      <ResidentRecoveryPanel snapshot={snapshot}/>
      {snapshot.session&&!planPanel&&!residentFirstSignIn&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Reconnect agent</button></div>}
    </section>
    <section aria-label="AI inference"><h3>AI</h3>{!residentFirstSignIn&&<p>{snapshot.residentRecoveryReason?'AI is unavailable while your agent needs recovery.':snapshot.cloudAccount&&!residentSignInRejected?(snapshot.residentInference==='cloud'?`Your agent uses ${serviceName} for AI.`:snapshot.residentInference==='unavailable'?`AI is off. Your saved ${serviceName} sign-in is retained; check the connection below.`:'AI connection is not confirmed. Your agent still runs on this device.'):`Your agent runs with AI off until you sign in to ${serviceName}.`}</p>}
      {snapshot.cloudAccount&&!residentSignInRejected?<>
        {accountCreatedNotice}
        {(planPanel||residentNeedsPlan)&&<p>{snapshot.cloudAccount.email||`Account ${snapshot.cloudAccount.userId}`}</p>}
        <section aria-label={`${serviceName} plan`}><p><strong>{residentPlan.headline}</strong></p>{residentPlan.detail&&<p>{residentPlan.detail}</p>}{snapshot.planEndsAt&&!residentNeedsPlan?<p>Plan runs until {day(snapshot.planEndsAt)}.</p>:null}</section>
        {residentNeedsPlan&&<p role="status">{NEEDS_PLAN_NOTICE}</p>}
        {keyExpiring&&<section aria-label={`${serviceName} sign-in`}><p role="status">{keyExpiresAt<=Date.now()?`Your ${serviceName} sign-in on this phone has expired.`:`Your ${serviceName} sign-in on this phone expires ${day(keyExpiresAt)}.`} Approve this phone again to keep AI available.</p><button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Approve this phone again</button></section>}
        {(residentNeedsPlan||planPanel)&&redeemForm}
        {snapshot.redeemError&&<p id="alpha-redeem-error" role="alert" className="alpha-connection-error">{snapshot.redeemError}</p>}
        {snapshot.redeemNotice&&<p role="status">{snapshot.redeemNotice}</p>}
      </>:<p>{residentSignInRejected?(snapshot.error?`Sign in to ${serviceName} again to turn AI back on.`:'Your saved Cloud sign-in is no longer valid.'):residentAiOff}</p>}
      {residentOffline&&<p role="status">{OFFLINE_NOTICE}</p>}
      <div className="alpha-connection-actions">
      {snapshot.cloudAccount&&!residentSignInRejected ? <>
        {residentNeedsPlan?<button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{CHOOSE_PLAN_LABEL}</button>:(residentPlan.manage||planPanel)&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{residentPlan.manageLabel||MANAGE_PLAN_LABEL}</button>}
        {!snapshot.residentRecoveryReason&&(residentPlanRecheck||residentNeedsPlan)?<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Check plan again</button>:planPanel&&<button disabled={snapshot.busy} onClick={()=>connectionController.close()}>Done</button>}
        <button disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Sign out</button>
      </>:<>
        {residentOffline&&!snapshot.residentRecoveryReason&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Try again</button>}
        {snapshot.residentSavedCredential&&!residentSignInRejected&&!residentOffline&&!snapshot.residentRecoveryReason&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button>}
        {!residentOffline&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Sign in with {serviceName}</button>}
      </>}
      </div>
    </section>
    {snapshot.replyNotice&&<p role="status">{snapshot.replyNotice}</p>}
    {snapshot.message&&<p role="status">{snapshot.message}</p>}
    {snapshot.error&&<p role="alert">{snapshot.error===errorMessage({status:401})?'Your saved Cloud sign-in is no longer valid.':snapshot.error}</p>}
    {snapshot.historyError&&<><p role="status">{snapshot.historyError}</p><button disabled={snapshot.busy} onClick={()=>void connectionController.retrySavedHistory()}>Retry saved conversation</button></>}
    {!residentFirstSignIn&&conversations}
    {!residentFirstSignIn&&actionReview}
    {snapshot.busy&&!snapshot.residentStarting&&snapshot.residentRecovery?.step!=='archiving'&&<button className="alpha-connection-cancel" onClick={()=>connectionController.cancel()}>Cancel</button>}
    {testMocksEnabled&&residentQa()&&<p><button disabled={snapshot.busy} onClick={()=>connectionController.setResidentQa(null)}>Leave subscription gate QA ({residentEnvironment()})</button></p>}
  </div></div>;
  if(browserOnly)return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="local-only-title" tabIndex={-1} ref={panel}>
    <header><h1 id="local-only-title">Alpha Phone</h1><button aria-label="Close connection settings" onClick={()=>connectionController.close()}>Close</button></header>
    <p>Your agent runs locally in the Android app. Remote agents and pairing are unavailable.</p>
    <p>Local apps remain available here. Saved history is preserved.</p>
    <button onClick={()=>void connectionController.offline()}>Open local apps</button>
  </div></div>;
  const pairingOptions=testMocksEnabled?<>
    <details><summary>Remote agent</summary><form onSubmit={event => { event.preventDefault(); void connectionController.pair('remote', remoteOrigin.current?.value || '', remoteCode.current?.value || ''); if (remoteCode.current) remoteCode.current.value = ''; }}>
      <label>Agent HTTPS address<input ref={remoteOrigin} type="url" autoCapitalize="none" spellCheck={false} placeholder="https://your-agent.example" required disabled={snapshot.busy} /></label>
      <label>Pairing code<input ref={remoteCode} autoComplete="off" autoCapitalize="characters" placeholder="XXXX-XXXX-XXXX" disabled={snapshot.busy} /></label><p>Use the code shown by your agent. Leave it empty to restore this phone’s saved session.</p><button disabled={snapshot.busy}>Connect remote agent</button>
    </form></details>
    {testMocksEnabled&&<details><summary>Local development agent</summary><p>For a development build connected to your computer. Inference still runs on your agent’s configured provider.</p><form onSubmit={event => { event.preventDefault(); void connectionController.pair('local', localOrigin.current?.value || '', localCode.current?.value || ''); if (localCode.current) localCode.current.value = ''; }}>
      <label>Local agent address<input ref={localOrigin} type="url" defaultValue="http://10.0.2.2:2138" autoCapitalize="none" spellCheck={false} required disabled={snapshot.busy} /></label>
      <label>Pairing code<input ref={localCode} autoComplete="off" autoCapitalize="characters" disabled={snapshot.busy} /></label><button disabled={snapshot.busy}>Connect local agent</button>
    </form></details>}
  </>:null;
  if(browserDevProfile)return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="connection-title" tabIndex={-1} ref={panel}>
    <header><h1 id="connection-title">Development connections</h1><button aria-label="Close connection settings" disabled={snapshot.busy} onClick={()=>connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    <p>Local profiles exercise agent setup, conversations and history. Edit the reply to test each consumer.</p>
    <label>Development profile<select aria-label="Development profile" value={developmentProfile} disabled={snapshot.busy} onChange={e=>{const next=e.target.value as DevelopmentProfile;if(next===developmentProfile)return;setReplyReady(false);setDevelopmentProfile(next);}}>{developmentProfiles.map(profile=><option key={profile} value={profile}>{developmentName(profile)}</option>)}</select></label>
    <label>Scripted reply<textarea rows={4} aria-label="Scripted reply" value={reply} maxLength={16000} disabled={snapshot.busy||!replyReady} onChange={e=>setReply(e.target.value)}/></label>
    <button disabled={snapshot.busy||!replyReady||!!developmentError} onClick={()=>void connectionController.saveDevelopment(developmentProfile,reply)}>Save development reply</button>
    <button disabled={snapshot.busy||!replyReady||!!developmentError} onClick={()=>void connectionController.startDevelopment(developmentProfile)}>Connect development profile</button>
    <button disabled={snapshot.busy} onClick={()=>recoverDevelopment('agent')}>Agent history recovery</button>
    <button disabled={snapshot.busy} onClick={()=>recoverDevelopment('execution')}>Execution history recovery</button>
    <button disabled={snapshot.busy} onClick={()=>recoverDevelopment('digest')}>Digest schedule recovery</button>
    {!isAndroid&&<button disabled={snapshot.busy} onClick={()=>void recoverConversationChoice()}>Conversation selection recovery</button>}
    {snapshot.session&&<section><strong>{snapshot.name}</strong><button disabled={snapshot.busy} onClick={()=>void connectionController.disconnect()}>Disconnect agent</button><button disabled={snapshot.busy} onClick={()=>void connectionController.listHistory()}>Load conversations</button>{snapshot.conversations.map(item=><section key={item.id}><span>{item.title}</span><button disabled={snapshot.busy} onClick={()=>void connectionController.restoreHistory(item.id)}>Restore conversation</button></section>)}</section>}
    {snapshot.session&&selection()?.kind==='development'&&<details><summary>Development device actions</summary><label>Action JSON<textarea rows={5} aria-label="Action JSON" value={developmentAction} disabled={snapshot.busy} onChange={e=>setDevelopmentAction(e.target.value)}/></label><button disabled={snapshot.busy} onClick={()=>{const selected=selection();if(selected?.kind==='development')void connectionController.authorDevelopment(selected.profile,developmentAction);}}>Queue action for review</button><button disabled={snapshot.busy} onClick={()=>void connectionController.actionHistory()}>Refresh actions</button><button disabled={snapshot.busy} onClick={()=>void connectionController.actionHistory(true)}>Sync recorded receipts</button>{snapshot.actionHistory.map(item=><section key={item.id}><p>{item.description}</p><span>{item.state}</span>{item.state==='pending'&&<button disabled={snapshot.busy} onClick={()=>void connectionController.rejectAction(item.id)}>Reject proposal</button>}{['executing','reconciliation_required'].includes(item.state)&&<><button disabled={snapshot.busy} onClick={()=>void connectionController.reconcileAction(item.id,'applied')}>I verified it happened</button><button disabled={snapshot.busy} onClick={()=>void connectionController.reconcileAction(item.id,'not_applied')}>I verified it did not happen</button></>}</section>)}</details>}
    <p><a href="?mode=dev&workflows=agent&start=workflows">Agent workflows</a> · <a href="?mode=dev&start=workflows">Device workflows</a></p>
    <DevelopmentCloudSetup connect={()=>connectionController.startDevelopment('cloud')}/>
    {pairingOptions}
    {/* P-43: a profile switch replaces the agent; this surface never leaves "no agent". */}
    {browserLocalAgentEnabled&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>{snapshot.session&&snapshot.kind==='resident'?'Restart local agent':'Start local agent'}</button>}
    <p role="status">{snapshot.message}</p>{(snapshot.error||developmentError)&&<p role="alert">{snapshot.error||developmentError}</p>}{snapshot.busy&&<button onClick={()=>connectionController.cancel()}>Cancel</button>}
  </div></div>;
  // A production browser build has no on-device agent; say so instead of offering one.
  return <div className="alpha-connection-scrim"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="connection-title" tabIndex={-1} ref={panel}>
    <header><span className="alpha-connection-logo alpha-compute-mark" aria-label="Alpha Compute"/><button aria-label="Close connection settings" disabled={snapshot.busy} onClick={() => connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    <h1 id="connection-title" className="serif">Your agent.<br />Your phone.</h1>
    <p>{testMocksEnabled ? 'Run your agent locally, or use a development connection below.' : 'Your agent runs on this device.'} Model inference uses the provider configured for that agent.</p>
    <section><h3>{isAndroid ? 'On-device agent' : 'Agent on this computer'}</h3>
      <p>{isAndroid ? 'Agent execution and state stay on this Android device. Hosted inference, when configured, receives your prompts and selected context.' : 'The agent runs on your development computer. This preview connects to it; the Android app runs its own agent.'}</p>
      {testMocksEnabled && isAndroid && localPackaging==='available' && <details onToggle={event=>{if((event.currentTarget as HTMLDetailsElement).open)void connectionController.refreshProviderStatus();}}><summary>Model provider</summary><p role="status">{providerStatusLabel(snapshot.providerStatus)}</p><p>Cerebras receives prompts and selected context for inference with {LOCAL_PROVIDER_MODEL}. Your key is checked with Cerebras, then stored using Android Keystore. A new key takes effect after the agent restarts.</p><form onSubmit={event=>{event.preventDefault();const key=providerKey.current?.value||'';if(providerKey.current)providerKey.current.value='';void connectionController.configureLocal(key);}}><label>Cerebras API key<input ref={providerKey} type="password" autoComplete="off" required disabled={snapshot.busy}/></label><p>Model: {LOCAL_PROVIDER_MODEL}</p><button disabled={snapshot.busy}>Save provider</button></form>
        {snapshot.providerStatus?.configured&&snapshot.providerStatus.provider==='cerebras'&&(confirmRemove?<><p role="alert">Remove the saved Cerebras key from this phone? The local agent restarts with AI off until you add a key.</p><button disabled={snapshot.busy} onClick={()=>{setConfirmRemove(false);void connectionController.removeProvider();}}>Remove key</button><button disabled={snapshot.busy} onClick={()=>setConfirmRemove(false)}>Keep key</button></>:<button disabled={snapshot.busy} onClick={()=>setConfirmRemove(true)}>Remove key…</button>)}</details>}
      {/* Android shows Restart beside the connected resident below; browser development reconnects here. */}
      {!(isAndroid&&snapshot.session&&snapshot.kind==='resident')&&<button disabled={snapshot.busy || localPackaging!=='available'} onClick={() => void connectionController.startLocal()}>{snapshot.session&&snapshot.kind==='resident'?'Restart local agent':'Start local agent'}</button>}
      {localPackaging==='checking' && <p role="status">Checking local agent availability…</p>}
      {localPackaging==='unavailable' && <p>{RESIDENT_UNPACKAGED}</p>}
    </section>
    {snapshot.session && <section className="alpha-connection-current"><strong>{snapshot.name}</strong><span>Connected · {snapshot.kind === 'resident' ? (isAndroid ? 'On this device' : 'On this computer · development') : testMocksEnabled ? (snapshot.kind === 'cloud' ? serviceName : snapshot.kind === 'local' ? 'Local development' : 'Remote agent') : 'Unsupported connection'}</span>{!(residentAlwaysPresent && snapshot.kind==='resident')&&<button disabled={snapshot.busy} onClick={() => void connectionController.disconnect()}>Disconnect agent</button>}{isAndroid && snapshot.kind==='resident' && <button disabled={snapshot.busy} onClick={()=>void connectionController.restartLocal()}>Restart local agent</button>}</section>}
    {!isAndroid&&<button disabled={snapshot.busy} onClick={()=>void recoverConversationChoice()}>Conversation selection recovery</button>}
    {conversations}
    {snapshot.session && snapshot.phoneCapabilityReason && <p role="status">{snapshot.phoneCapabilityReason}</p>}
    {actionReview}
    {snapshot.replyNotice && <p role="status">{snapshot.replyNotice}</p>}
    <div role="status" aria-live="polite">{snapshot.message}</div>
    {snapshot.error && <p role="alert" className="alpha-connection-error">{snapshot.error}</p>}
    {snapshot.busy && <button className="alpha-connection-cancel" onClick={() => connectionController.cancel()}>{snapshot.cloudPersonal?.view?'Stop waiting':'Cancel'}</button>}
    {testMocksEnabled&&<details><summary>Development Cloud agent infrastructure</summary><p>Connect your personal Eliza. Dedicated hosting requires a reviewed setup before it starts.</p>
      {cloudAccountControls}
      {!browserOnly&&<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudList(env())}>Refresh agent status</button>}
      {snapshot.cloudAccount&&Capacitor.getPlatform()!=='android'&&<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudPersonalRecovery()}>Cloud setup intent recovery</button>}
      {snapshot.cloudPersonal&&<CloudPersonalSetup setup={snapshot.cloudPersonal} busy={snapshot.busy} onAccept={()=>void connectionController.cloudPersonalAccept()} onDecline={()=>connectionController.cloudPersonalDecline()} onPoll={()=>void connectionController.cloudPersonalPoll()} onFinalize={()=>void connectionController.cloudPersonalFinalize()} onConnect={()=>void connectionController.cloudPersonalConnect()}/>}
      <button disabled={snapshot.busy} onClick={()=>void connectionController.cloudManage(env())}>Manage Cloud account</button>
    </details>}
    {pairingOptions}
    {testMocksEnabled&&<details><summary>Subscription gate QA</summary><p>Run the production {serviceName} sign-in and plan gate (sign-in, plan check, Redeem code, Choose a plan) against the chosen environment. Staging stops at plan admission; the on-device agent's inference binding is production-only.</p><label>Gate environment<select aria-label="Gate environment" ref={qaEnvironment} defaultValue="staging" disabled={snapshot.busy}><option value="staging">Staging</option><option value="production">Production</option></select></label><button disabled={snapshot.busy} onClick={()=>connectionController.setResidentQa(qaEnvironment.current?.value==='production'?'production':'staging')}>Start subscription gate QA</button></details>}
    {testMocksEnabled&&<details><summary>Mock mode</summary><p>Explore the prototype with simulated data and actions. No live agent connection is used.</p><button disabled={snapshot.busy} onClick={() => connectionController.mock()}>Enter mock mode</button></details>}
    {/* Test mocks only, where no resident runs: return to the fixture's offline state. */}
    {testMocksEnabled&&!isAndroid&&!residentAlwaysPresent&&<button className="alpha-connection-offline" disabled={snapshot.busy} onClick={() => void connectionController.offline()}>Continue offline</button>}
  </div></div>;
}

function ResidentRecoveryPanel({snapshot}:{snapshot:ConnectionSnapshot}) {
  return snapshot.residentRecoveryReason==='ipc-recovery-retention-limit'&&!snapshot.session&&<section aria-label="Agent recovery">
        <p>Your notes, chats and sign-in stay unchanged.</p>
        {snapshot.residentRecovery?.step==='review'?<>
          <p>Alpha will keep {snapshot.residentRecovery.review.retainedCount} old startup records, then restart your agent.</p>
          <div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.confirmRecovery()}>Keep records and restart</button><button disabled={snapshot.busy} onClick={()=>connectionController.cancelRecoveryReview()}>Cancel</button></div>
        </>:<>
          {snapshot.residentRecovery?.step==='unavailable'&&<p role="status">Recovery could not be checked. Your records were kept. Review again later.</p>}
          {snapshot.residentRecovery?.step==='partial'&&<p role="status">Recovery did not finish. Your records were kept. Review again before restarting.</p>}
          <button disabled={snapshot.busy} onClick={()=>void connectionController.reviewRecovery()}>Review recovery</button>
        </>}
      </section>;
}
