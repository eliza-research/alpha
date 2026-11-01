import {isCalendarReadFailureCode} from "../../../../.eliza/client-features/packages/contracts/src/calendar.ts";
import {SingleFlightMemo} from "@elizaos/core/read-memo";
import {parseCloudServiceInfo} from './cloud-service-info';
import {productionCloud, stagingCloud} from './cloud-deployment.generated.ts';
import {browserCloudResidentEnabled,browserCloudResidentEnvironment,browserResidentCall} from './browser-cloud-resident';
import {appRecordInvalidations} from './app-record-completion';
import {normalizeEffectReceipts} from '../../../../.eliza/client-features/packages/core/src/types/effects.ts';
import {assertAppRecordRequestAllowed,type AppRecordMethod,type AppRecordPort} from './app-record-route-policy';
import {AUTOMATIONS_COMMITTED_EVENT,automationsCommitted} from './automation-completion';
import {OWNER_REMINDER_LIST,OWNER_REMINDER_READBACK,ownerReminderRoute,reminderReadPath,type ReminderNotificationBinding} from './owner-reminder-notification-protocol';
import {CAMERA_CAPTURE_CAPABILITY} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/camera-contract.ts';
import {sanitizeCloudInferenceFailure,type CloudInferenceFailure} from './crash-log';
import {residentRecoveryReason,residentRecoveryMessage,residentRecoveryCopy,RESIDENT_RECOVERY_PENDING,type ResidentRecoveryReason,type ResidentRecoveryView} from './resident-recovery';
import {anyAbortSignal} from './abort-signal';
import {CALENDAR_APPROVAL_READ_PATH,calendarApprovalFromList,calendarApprovalId} from './calendar-approval';
import {readDevicePreferences} from '../browser/device-preferences';
import {resolveCloudEnvironment} from './cloud-environment-selection';
import { withResidentMapsNavigation } from '../maps/resident-relay.ts';
import {aospImage} from './aosp-image';
import {SMS_SEND_CAPABILITY} from './sms-agent-contract';
import {PHONE_DIAL_CAPABILITY,telephonyDeviceCapabilities} from './phone-dial-contract';
import {assertAutomationRequestAllowed, AutomationRequestNotDispatchedError, type AutomationsMethod} from './automations-route-policy.ts';
import {iconStyle} from '../icon-style';
import {validateUuid} from '../../../../vendor/eliza/packages/core/src/utils/uuid';
import type {ConversationMessageTarget, ChatChannel, VoiceConversationBinding,VoiceTurnSignal,ReadReplyBinding,NativeNotesReadReplyHint} from './alpha-client';
import {ViewNavigationClient,type NavigationAttempt} from './view-navigation';
import {captureConversationChoice,selectConversation,conversationSelectionDocument,type ConversationChoice} from './conversation-selection';
import {developmentDigestDocument} from '../browser/development-digest-document';
import {developmentExecutionDocument} from '../browser/development-execution-document';
import {developmentAgentDocument} from '../browser/development-agent-document';
import {openDomainRecovery} from '../browser/domain-recovery';
import {retireClockReviews} from './clock-agent-review';
import { negotiateEnabledViews } from './device-view-profile';
import { registerWorkflowDevice, workflowDeviceProtocol } from './workflow-presentation';
import {ClientObservationSupportSession} from './client-observation-support';
import {clockHandoffCapabilities} from './clock-contract';
import {developmentIdentity,readDevelopmentIdentity,verifyDevelopmentIdentity,developmentOwnerRecovery,assertDevelopmentIdentity,developmentProfiles,type DevelopmentProfile} from '../browser/development-identity';
import {developmentCloudKey} from '../browser/development-cloud';
import {DevelopmentCloudSetup} from '../browser/development-cloud-ui';
import {developmentCredential,developmentJournal,authorDevelopmentAction} from '../browser/development-actions';
import {browserDevProfile as devProfileQuery} from '../browser/dev-profile';
import {testMocksEnabled,devSurfacesEnabled,privateLocalPreviewEnabled} from '../build-flags';
import {developmentBridge,developmentName,developmentReply,saveDevelopmentReply} from '../browser/development-connection';
import {Capacitor} from '@capacitor/core';
import {personalIntentDocument,type PersonalIntent} from './cloud-personal-intent';
import { CloudPersonalSetup, personalIntent, savePersonalIntent, clearPersonalIntent, type PersonalSetupState } from './cloud-personal-setup';
import { PersonalProtocolError, type CloudPersonalProtocol, type PersonalView, type PersonalOwner } from './cloud-personal-protocol';
import { holdPhoneInert } from './modal-inert';
import { pauseHostedBackground } from './hosted-background';
import {developmentDeviceStore,developmentActionJournal} from './local-agent-storage';
import { reviewLocalRecovery,archiveLocalRecovery,stopLocalAgent, configureLocalProvider, bindResidentCloudProvider, LocalCloudProviderStopUnconfirmed, LocalAgentProtocol, localAgentPackaged, browserLocalAgentEnabled, localProviderStatus, clearLocalProvider, clearLocalProviderIfCurrent, providerStatusLabel, LOCAL_PROVIDER_MODEL, type LocalProviderStatus } from './local-agent';
import { presentDeviceRecordOperation } from './device-record-presentation';
import { succeededBrowserDestination } from './action-message-presentation';
import type { MessagePage } from './remote-protocol';
import type {DeviceRecovery,CurrentDeviceActionRequest} from "./device-actions";
import type { WorkflowPhoneReview } from './workflow-device-contract';
import { AlphaClientError } from './alpha-client';
import { WorkflowProtocol, WorkflowHttpError } from './workflow-protocol';
import { registerPlugin } from '../platform-plugins';
import { DailyApps } from '../daily';
import { DeviceActions, actionScope, type DeviceCredential, type DeviceExecutor, type ForegroundReviewExecutor, type ActionJournal } from './device-actions';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { isAndroid } from '../native';
import type { AgentReply, ActionProposal, OperationReceipt, ContextEnvelope, VerifiedSession } from './alpha-client';
import { CloudResidentBindingController, CloudResidentBindingError, ResidentRebindQueue, parseResidentPlanAdmission, recentResidentPlanAdmission, type ResidentPlanAdmissionRecord } from '../../../../.eliza/client-features/packages/auth/src/auth/cloud-resident-binding.ts';
import { cloudServiceName, cloudSignInHandOffAvailable, CloudProtocol, CloudProtocolError, type CloudAgent, type CloudEnvironment } from './cloud-protocol';
import { googleOutcome as signInOutcome, type CloudSignInGoogleOutcome, CloudSignInError, normalizeSignInCode, signInFailureMessage as formatSignInFailureMessage, signInReadiness, validSignInEmail, validSignInPhone, type CloudSignInAuthenticated } from './cloud-sign-in';
import { DevelopmentCloudAgentProtocol, type CloudPhoneTarget } from './development-cloud-agents';
import { checkEntitlement, clearEntitlementKeyCache, describeSubscription, EntitlementError, EntitlementRefresher, isEntitlementSignInFailure, CHOOSE_PLAN_LABEL, MANAGE_PLAN_LABEL, planAdmission, readServiceLimit, redeemFailureMessage, redeemSuccessMessage, serviceLimitMessage, subscriptionSummary, SubscriptionRedeemError, type ServiceLimit, type SubscriptionView } from './subscription-entitlement';
import { RemoteProtocol, RemoteProtocolError } from './remote-protocol';
import { phoneContextMessage } from './phone-context';
import {calendarSource,calendarTarget} from '../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/calendar-contract.ts';
import { CloudSignInPanel } from './cloud-sign-in-ui';
import { cloudCredentialStore, cloudSelfRevocationSupported, cloudSignIn, cloudSignInPhone, remoteCredentialStore, nativeCloudRequest, nativeRemoteRequest, openConnectionBrowser, removeStoredCloudCredential, secureConnectionStore } from './native-connection';
import { findStoppedUserTurn, type StoppedUserTurn as StoppedTurn } from '../../../../.eliza/client-features/packages/ui/src/api/conversation-turn-controller.ts';
import './connection-ui.css';
import {CloudMembershipControls,BillingAccountReview,FUNDING_NEEDED,fundingRefusedReply,type MembershipBalance} from './cloud-membership-ui';

/** `offline` and `none` exist only where no resident agent runs (test-mocks builds and the flag-off
 * web preview). Android production and browser development migrate them to `resident` on read
 * (decision P-43: the resident agent is always present). */
type Selection = {kind:'development';profile:DevelopmentProfile;account?:string} | { kind: 'resident' } | { kind: 'offline' } | { kind: 'none' } | { kind: 'mock' } | { kind: 'remote' | 'local'; origin: string } | { kind: 'cloud'; environment: CloudEnvironment; agentId: string; ownerId?: string };
export interface CloudServiceSession { environment: CloudEnvironment; userId: string; organizationId?: string; sessionId: string; credentialId: string; email?: string;
  /** When this phone's Cloud sign-in key expires (from the in-app sign-in), if Cloud reported it. */
  expiresAt?: number }
export interface RestoredMessage { id: string; from: 'user' | 'agent'; text: string; deviceReceipt?:true; browserDestination?:string; inReplyTo?:string }
export interface ConnectionSnapshot {
  /** Automatic session restoration has completed; null is now a resolved no-session state. */
  startupResolved?: boolean;
  /** Saved startup restoration is quiet; explicit settings and real failures remain visible. */
  automaticRestore?: boolean;
  /** Subscription plan state from a verified Cloud entitlement; never a credit balance. */
  residentSubscription?: SubscriptionView | null;
  membershipBalance?: MembershipBalance;
  membershipCredits?: {usd:string;observedAt:number}|null;
  membershipPlan?: SubscriptionView|null;
  /** The latest Cloud limit a turn reported (rate limit, period allowance, no plan), with when it was seen; shown with its retry time in the account panel. */
  lastServiceLimit?: (ServiceLimit&{observedAt:number})|null;
  billingReviewEmail?: string;
  membershipDismissed?: boolean;
  /**
   * Cloud declined a turn of this account for billing (insufficient credits). The Membership &
   * credits sheet offers its credits and membership code actions until a code is redeemed, a later
   * turn succeeds or the Cloud account changes. Only a Cloud refusal sets it.
   */
  fundingRefused?: boolean;
  /** Ephemeral explicit code entry, retired when its current account or panel changes. */
  membershipCodeEntry?: boolean;
  residentSavedCredential?: boolean;
  legacySignInRecovery?: boolean;
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
  residentInference?: 'direct' | 'cloud' | 'unavailable' | 'unknown' | null;
  /** When the current plan or redeemed grant ends, if Cloud reported it. */
  planEndsAt?: number | null;
  /** Outcome of the last subscription code submission. Never contains the code. */
  redeemNotice?: string; redeemError?: string;
  cloudPersonal?: PersonalSetupState;
  phoneActionsAvailable: boolean; phoneCapabilityReason: string;
  conversations: Array<{ id: string; title: string }>;
  history: { sessionId: string; conversationId: string; revision: number; messages: RestoredMessage[]; automatic: boolean; deliveryRevisionAtStart?:number } | null;
  historyError?: string;
  /** One transient delivery batch; the visible transcript remains the only message collection. */
  conversationDelivery?:{sessionId:string;conversationId:string;messages:RestoredMessage[];revision:number};
  conversationEvents?:'connected'|'unavailable';
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
  purpose?:'agent'|'cloud-account'|'plan'|'provider';
  open: boolean; busy: boolean; message: string; error: string;
  /** Completed sign-out outcome survives automatic readiness probes until another account is verified. */
  signOutNotice?: string;
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
type Active = ({ kind: 'resident'; remote: LocalAgentProtocol; origin: string; actions?: DeviceActions; workflowProtocol?: 1|2|3 } | { kind: 'remote' | 'local'; remote: RemoteProtocol; origin: string; actions?: DeviceActions; workflowProtocol?: 1|2|3 } | { kind: 'cloud'; cloud: DevelopmentCloudAgentProtocol; agentId: string; actions?: DeviceActions; workflowProtocol?: 1|2|3; phoneTarget?: CloudPhoneTarget; voiceExpiresAt?: number }) & Enrollment & { request?:DeviceRequest; viewNavigation?:ViewNavigationClient; userTextFormatVersion?:1 };
const SELECTION = 'alpha.connection.selection.v1';
// The development chooser exists only on an explicitly flagged development server.
const browserDevProfile = devSurfacesEnabled && devProfileQuery;
/** Production builds offer only the production Cloud environment. */
const cloudEnvironmentPolicy = {development: import.meta.env.DEV, testMocks: testMocksEnabled, android: isAndroid, previewEnvironment: import.meta.env.VITE_ALPHA_CLOUD_ENVIRONMENT, cloudResident:browserCloudResidentEnabled};
const cloudEnvironmentAllowed = (environment: unknown): environment is CloudEnvironment => browserCloudResidentEnabled ? environment===browserCloudResidentEnvironment : environment === 'production' || (testMocksEnabled && environment === 'staging');
/** Eliza Cloud admits no request from the production web origin, so no Cloud route is started there. */
// Pending device actions already named in a reply, per actions client (one per session).
const announcedProposals=new WeakMap<object,Set<string>>();
const webCloudUnavailable = () => !testMocksEnabled && !isAndroid && !browserLocalAgentEnabled;
/** Decision P-43 (owner, 2026-10-13): the agent always runs locally. On Android production and in
 * browser development with the local agent there is never a "no agent" state: before the resident
 * has a session the connection is `starting` or `recovering`, never offline. */
export const residentAlwaysPresent = (isAndroid && !testMocksEnabled) || (!isAndroid && browserLocalAgentEnabled);
const RESIDENT_NAME = isAndroid ? 'On this device' : 'On this computer';
export const RESIDENT_STARTING = 'Starting your agent…';
/** Shown wherever a session is needed while the resident starts or recovers; nothing was sent. */
export const RESIDENT_STARTING_NOTICE = privateLocalPreviewEnabled ? 'Connecting to the agent on this computer. Nothing was sent.' : 'Your agent is starting. Nothing was sent.';
export const RESIDENT_RECOVERING_NOTICE = privateLocalPreviewEnabled ? 'The agent connection is unavailable. Retry in Settings › Agent connection. Nothing was sent.' : 'Your agent stopped. Retry in Settings › Agent connection. Nothing was sent.';
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
  if(snapshot.residentRecoveryReason)return residentRecoveryMessage(snapshot.residentRecoveryReason);
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
function ownProviderSelected(snapshot: Pick<ConnectionSnapshot,'providerStatus'>=state): boolean { return snapshot.providerStatus?.selected===true&&snapshot.providerStatus.provider==='cerebras'; }
function residentSignInRequired(): boolean { return !ownProviderSelected()&&residentCloudFlow() && !state.cloudAccount && state.residentPlanNotice !== 'offline' && !state.residentStarting; }
function residentEnvironment(): CloudEnvironment { return browserCloudResidentEnabled?browserCloudResidentEnvironment:residentQa() ?? 'production'; }
/** The on-device agent's Cloud inference binding is production-only (native reads cloud:production). */
function residentBindable(): boolean { return browserCloudResidentEnabled || isAndroid && residentEnvironment() === 'production'; }
/** Warn this long before this phone's Cloud sign-in key expires (CLI keys last 90 days). */
export const CLOUD_KEY_EXPIRY_WARNING_MS = 14 * 24 * 60 * 60 * 1000;
/**
 * A verified Cloud billing mode within the shared controller's OFFLINE_PLAN_GRACE_MS (7 days) keeps
 * its inference binding while Cloud is unreachable (the agent runs either way); see
 * `@elizaos/auth/auth/cloud-resident-binding`. An engineering bound for offline use, not a billing
 * decision: Cloud enforces authentication, credits and quota on every request. The record keeps its
 * installed storage key.
 */
const PLAN_ADMISSION = 'alpha.connection.plan-admission.v1';
export const PLAN_RECHECK_INTERVAL_MS = 60_000;
let lastPlanRecheck = -Infinity, lastRefusalRecheck = -Infinity;
let planManagementReturn = false;
type PlanAdmissionRecord = ResidentPlanAdmissionRecord<CloudEnvironment>;
/** The stored record, parsed by the shared controller's rules; installed data keeps its key. */
function readPlanAdmission(): PlanAdmissionRecord | null {
  try { return parseResidentPlanAdmission(JSON.parse(localStorage.getItem(PLAN_ADMISSION) || 'null'), cloudEnvironmentAllowed); }
  catch { return null; }
}
function writePlanAdmission(record: PlanAdmissionRecord | null) { try { if (record) localStorage.setItem(PLAN_ADMISSION, JSON.stringify(record)); else localStorage.removeItem(PLAN_ADMISSION); } catch { /* Offline grace is a convenience; the gate still checks Cloud. */ } }
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
/** A verified $0 account without a membership: nothing is sent, and the Subscription sheet is offered again
 * once the refusal reached the composer (opening it first would cancel the request it explains). */
function fundingNeeded(){setTimeout(()=>{if(state.cloudAccount&&state.membershipBalance==='zero')update({membershipDismissed:false});},0);return Object.assign(new AlphaClientError('transport-failed',FUNDING_NEEDED),{notDispatched:true,refusedBeforeTurn:true});}
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
// Unsupported peers keep the ordinary context; optional fields require a current process handshake.
let clientObservationSession:ClientObservationSupportSession|undefined;
function clearClientObservationSupport(){clientObservationSession?.clear();clientObservationSession=undefined;}
let sending: AbortController | null = null;
/** Pre-warm debounce: at most one agent inference warm per interval, reset by a new connection. */
export const INFERENCE_WARM_INTERVAL_MS = 60_000;
let lastInferenceWarm = Number.NEGATIVE_INFINITY;
let developmentVoiceExpiresAt=0;
const appRequests = new Set<AbortController>();
const conversationMemory = new Map<string, string>();
let closeConversationEvents:(()=>void)|undefined,conversationEventRead:AbortController|undefined,conversationResync=false;
function retireConversationEvents(){closeConversationEvents?.();closeConversationEvents=undefined;conversationEventRead?.abort();conversationEventRead=undefined;conversationResync=false;}
function deliverConversationMessages(selected:Active,session:VerifiedSession,id:string,rows:Record<string,unknown>[]){
  if(active!==selected||state.session!==session||conversationMemory.get(conversationKey(session))!==id)return;
  const messages=restoredMessages(rows);if(messages.length)update({conversationDelivery:{sessionId:session.sessionId,conversationId:id,messages,revision:(state.conversationDelivery?.revision||0)+1}});
}
/** A journaled effect belongs to its conversation even when its own navigation retires chat. */
function deliverRequestedActionReceipts(selected:Active,session:VerifiedSession,generation:number,id:string,requestMessageId:string,receipts:OperationReceipt[],reviewed:ReadonlyArray<{proposal:ActionProposal|null}>){
  if(generation!==epoch||active!==selected||state.session!==session||conversationMemory.get(conversationKey(session))!==id)return;
  const messages:RestoredMessage[]=receipts.map(receipt=>{
    const browserDestination=succeededBrowserDestination(reviewed.find(item=>item.proposal?.id===receipt.proposalId)?.proposal,receipt);
    return {id:`device-receipt:${receipt.proposalId}`,from:'agent',text:receipt.summary,deviceReceipt:true,inReplyTo:requestMessageId,...(browserDestination?{browserDestination}:{})};
  });
  if(messages.length)update({conversationDelivery:{sessionId:session.sessionId,conversationId:id,messages,revision:(state.conversationDelivery?.revision||0)+1}});
}
/** Coalesced reconnect/foreground-settlement reconciliation through the existing history API. */
async function flushConversationEvents(){
  if(!conversationResync||conversationEventRead||sending||operation)return;
  const selected=active,session=state.session;if(!selected||!session||selected.kind!=='resident')return;
  const id=conversationMemory.get(conversationKey(session));if(!id)return;
  const generation=epoch,controller=new AbortController();conversationEventRead=controller;conversationResync=false;
  const current=()=>{controller.signal.throwIfAborted();if(epoch!==generation||active!==selected||state.session!==session||conversationMemory.get(conversationKey(session))!==id)throw Error('Conversation event binding changed');};
  try{const result=await readConversation(selected,id,controller.signal,current);current();if(sending||operation){conversationResync=true;return;}deliverConversationMessages(selected,session,id,result.messages);}
  catch{if(!controller.signal.aborted&&active===selected&&state.session===session)update({conversationEvents:'unavailable'});}
  finally{if(conversationEventRead===controller)conversationEventRead=undefined;}
}
function startConversationEvents(selected:Active,session:VerifiedSession){
  if(selected.kind!=='resident')return;
  if(typeof selected.remote.subscribeConversationEvents!=='function'){update({conversationEvents:'unavailable'});return;}
  const generation=epoch,current=()=>epoch===generation&&active===selected&&state.session===session;
  closeConversationEvents=selected.remote.subscribeConversationEvents(value=>{
    if(!current()||!value||typeof value!=='object'||Array.isArray(value))return;
    const event=value as Record<string,unknown>,message=event.message;
    if(event.type!=='proactive-message'||event.agentId!==session.agentId||typeof event.conversationId!=='string'||conversationMemory.get(conversationKey(session))!==event.conversationId||!message||typeof message!=='object'||Array.isArray(message))return;
    const row=message as Record<string,unknown>;
    if(row.role!=='assistant'||typeof row.id!=='string'||!row.id||row.id.length>128||typeof row.text!=='string'||row.text.length>200000)return;
    deliverConversationMessages(selected,session,event.conversationId,[row]);
  },(status,resync)=>{if(!current())return;if(resync)conversationResync=true;update({conversationEvents:status});});
}
/** Insert canonical delivery IDs around known history anchors without cancelling or replacing drafts/streams. */
export function mergeConversationDelivery<T extends{id:string}>(current:T[],delivered:T[]):T[]{
  const seen=new Set(current.map(message=>message.id));let result=current,previous:string|undefined;
  for(let i=0;i<delivered.length;i++){
    const message=delivered[i];if(seen.has(message.id)){previous=message.id;continue;}
    if(result===current)result=[...current];let index=-1;
    // A failed stream can end without the saved id; the saved copy replaces its unconfirmed local bubble.
    const sent=message as {from?:unknown;text?:unknown},twin=sent.from==='user'?result.findIndex(item=>{const local=item as {from?:unknown;text?:unknown;messageBinding?:unknown};return local.from==='user'&&!local.messageBinding&&local.text===sent.text&&!delivered.some(other=>other.id===item.id);}):-1;
    if(twin>=0){result[twin]=message;seen.add(message.id);previous=message.id;continue;}
    for(let j=i+1;j<delivered.length;j++){index=result.findIndex(item=>item.id===delivered[j].id);if(index>=0)break;}
    if(index<0&&previous!==undefined){const anchor=result.findIndex(item=>item.id===previous);if(anchor>=0)index=anchor+1;}
    result.splice(index<0?result.length:index,0,message);seen.add(message.id);previous=message.id;
  }
  return result;
}

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
const runForegroundReview: ForegroundReviewExecutor = (op, id, context, signal, bindingHash, journalIdentity, capabilities) => foregroundExecutor ? foregroundExecutor(op, id, context, signal, bindingHash, journalIdentity, capabilities) : Promise.resolve({ status: 'failed', summary: 'This review is unavailable on this phone. Nothing was shared.' });
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
type CalendarAgendaSourceObservation={sourceId:string;sourceRevision:string};
const calendarAgendaObservations=new WeakMap<DeviceActions,SingleFlightMemo<CalendarAgendaSourceObservation>>();
let calendarAgendaObservationEpoch=0;
if(typeof window!=='undefined')for(const event of ['alpha:calendar-sync-source-changed','alpha:calendar-document-changed'])window.addEventListener(event,()=>{calendarAgendaObservationEpoch++;});
/** Source observation cached per requesting owner session/source epoch; no event content is sent. */
async function calendarAgendaObservation(actions:DeviceActions,context:ContextEnvelope,current?:()=>void):Promise<CalendarAgendaSourceObservation|undefined>{
 if(Capacitor.isNativePlatform()||!actions.supportsCalendarAgenda||context.view!=='calendar'||context.sensitive!==false)return;
 // Only the captured typed native selection owns this separate browser store.
 // Canonical, retained and unknown sources must not initialize a legacy document.
 const selected=context.selectedObject;
 let requested:CalendarAgendaSourceObservation;
 try{
  if(selected?.kind==='calendar-source'){
   requested=calendarSource({sourceId:selected.id,sourceRevision:selected.revision});
   if(selected.accountId!==requested.sourceId||selected.sourceRevision!==requested.sourceRevision)return;
  }else if(selected?.kind==='calendar-event'){
   const target=calendarTarget({sourceId:selected.accountId,sourceRevision:selected.sourceRevision,eventId:selected.id,revision:selected.revision});
   requested={sourceId:target.sourceId,sourceRevision:target.sourceRevision};
  }else return;
 }catch{return;}
 // AlphaCalendar's browser adapter owns only its local source.
 if(requested.sourceId!=='local')return;
 current?.();
 const sourceEpoch=calendarAgendaObservationEpoch;
 let memo=calendarAgendaObservations.get(actions);
 if(!memo){memo=new SingleFlightMemo<CalendarAgendaSourceObservation>(Infinity,1);calendarAgendaObservations.set(actions,memo);}
 const key=JSON.stringify([sourceEpoch,requested.sourceId,requested.sourceRevision]);
 const value=memo.peek(key)?.promise??memo.put(key,undefined,Promise.resolve().then(()=>{current?.();return registerPlugin<{prepareAgentSource():Promise<CalendarAgendaSourceObservation>}>('AlphaCalendar').prepareAgentSource();}).then(source=>calendarSource({sourceId:source.sourceId,sourceRevision:source.sourceRevision})));
 try{
  const source=await value;current?.();
  return sourceEpoch===calendarAgendaObservationEpoch&&source.sourceId===requested.sourceId&&source.sourceRevision===requested.sourceRevision?source:undefined;
 }catch{return undefined;}
}
async function deviceCapabilities(offered:unknown):Promise<string>{
  const agent:unknown[]=Array.isArray(offered)?offered:[],android=Capacitor.getPlatform()==='android';
  const capabilities=['calendar.local-event.v1','notes.local-record.v1'];
  if(agent.includes(CAMERA_CAPTURE_CAPABILITY)&&(Capacitor.isPluginAvailable('ElizaCamera')||!android&&typeof navigator!=='undefined'&&typeof navigator.mediaDevices?.getUserMedia==='function'))capabilities.push(CAMERA_CAPTURE_CAPABILITY);
  if(agent.includes('reminders.local-record.v2'))capabilities.push('reminders.local-record.v2');else if(agent.includes('reminders.local-record.v1'))capabilities.push('reminders.local-record.v1');
  // Browser chat reminders use the runtime scheduler; do not offer a second device-creation lifecycle.
  for(const capability of [...(!Capacitor.isNativePlatform()?['calendar.agenda-read.v1']:[]),'notes.query.v1',...(Capacitor.isNativePlatform()?['reminders.create.v1']:[]),'calendar.create.v1',...(android||!Capacitor.isNativePlatform()?['calendar.next-read.v1']:[]),'maps.selected-read.v1'])if(agent.includes(capability))capabilities.push(capability);
  if(availabilityNegotiated(agent))capabilities.push(CALENDAR_AVAILABILITY_CAPABILITY);
  if((android||!Capacitor.isNativePlatform())&&typeof foregroundExecutor==='function'&&agent.includes('calendar.named-read.v1'))capabilities.push('calendar.named-read.v1');
  // One shared external-handoff policy for every brand: never clock.alarms.v1 (P-17).
  capabilities.push(...clockHandoffCapabilities({offered:agent,handler:android,repeatDays:android&&agent.includes('clock.handoff.v2')&&await clockRepeatDaysSupported()}));
  // SMS sending is negotiated only on the AOSP image, where Alpha holds the SMS role.
  if(aospImage&&agent.includes(SMS_SEND_CAPABILITY))capabilities.push(SMS_SEND_CAPABILITY);
  // The reviewed dial handoff only with the native telephony profile (the verified image). The
  // on-device contact lookup waits for an owner number picker in the review, so it is not offered.
  capabilities.push(...telephonyDeviceCapabilities({present:aospImage,dial:agent.includes(PHONE_DIAL_CAPABILITY),contactLookup:false}));
  return capabilities.join(',');
}
let deviceReadReview:((proposal:ActionProposal,context:ContextEnvelope,signal:AbortSignal)=>Promise<void>)|undefined;
const actionJournal = registerPlugin<ActionJournal>('AlphaActionJournal');
let savedCloudEnvironment: unknown;
try { savedCloudEnvironment = localStorage.getItem(CLOUD_SERVICE); } catch { /* Use the explicit public preview default when storage is unavailable. */ }
let cloud = makeCloud(resolveCloudEnvironment(cloudEnvironmentPolicy, savedCloudEnvironment));
type CloudServiceConnection = { client: CloudProtocol; identity: CloudServiceSession; credentialReference?: string };
let service: CloudServiceConnection | null = null;
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
/**
 * The shared rebind rule (`ResidentRebindQueue`): at most one rebind of the running agent runs and
 * one more waits behind it. A plan change that arrives while another connection step or a reply
 * runs is applied when that step ends.
 */
let residentRebindQueue: ResidentRebindQueue | null = null;
const residentRebinds = () => residentRebindQueue ??= new ResidentRebindQueue();
const residentRebindBlocked = () => !!operation || !!sending;
/** Every Cloud detach ends background plan refresh, so no request goes out under a stale admission. */
function stopEntitlementRefresh(){entitlementRefresher?.stop();entitlementRefresher=null;clearEntitlementKeyCache();}
function detachService() { stopEntitlementRefresh(); retireReadReplies();for(const request of appRequests)request.abort(new DOMException('Cloud account changed','AbortError')); clearPersonalSetup(); membershipRead?.abort();membershipRead=null;pendingBillingReview=null;service = null; update({ cloudAccount: null,membershipBalance:undefined,membershipCredits:null,membershipPlan:null,lastServiceLimit:null,planEndsAt:null,billingReviewEmail:undefined,membershipDismissed:false,fundingRefused:false }); }
async function verifyService(client: CloudProtocol, signal: AbortSignal, expected?:{credentialId:string;credentialReference?:string;userId?:string;organizationId?:string}) {
  const credential = await cloudCredentialStore.read(client.environment); signal.throwIfAborted();
  if(expected&&(credential?.credentialId!==expected.credentialId||(expected.credentialReference!==undefined&&credential?.credentialReference!==expected.credentialReference)))throw new Error('Cloud account changed. Try again.');
  if(residentCloudFlow())update({residentSavedCredential:!!credential?.credentialId});
  if (!credential?.credentialId) throw new Error('Cloud credentials are unavailable. Sign in again.');
  const identity = await client.identity(signal); signal.throwIfAborted();
  if(expected?.userId&&(identity.userId!==expected.userId||identity.organizationId!==expected.organizationId))throw new CloudProtocolError('account-changed');
  const current=await cloudCredentialStore.read(client.environment);
  if (current?.credentialId !== credential.credentialId || current?.credentialReference !== credential.credentialReference || expected?.credentialReference!==undefined&&current?.credentialReference!==expected.credentialReference) throw new Error('Cloud account changed. Try again.');
  signal.throwIfAborted();
  const same = service?.identity.environment === client.environment && service.identity.userId === identity.userId && service.identity.organizationId === identity.organizationId && service.identity.credentialId === credential.credentialId && service.credentialReference === credential.credentialReference;
  const account = { ...identity, credentialId: credential.credentialId, environment: client.environment, sessionId: same ? service!.identity.sessionId : crypto.randomUUID(), ...(Number.isFinite(credential.expiresAt) ? { expiresAt: credential.expiresAt } : {}) };
  localStorage.setItem(CLOUD_SERVICE, client.environment);
  if(!same){membershipRead?.abort();membershipRead=null;pendingBillingReview=null;}
  service = { client, identity: account, credentialReference:credential.credentialReference }; update({ cloudAccount: account,signOutNotice:undefined,...(!same?{membershipBalance:'checking' as const,membershipCredits:null,membershipPlan:null,lastServiceLimit:null,planEndsAt:null,billingReviewEmail:undefined,membershipDismissed:false,fundingRefused:false}:{}) });
  if(!same||membershipRead)void refreshMembershipBalance();
  return identity;
}
let pendingBillingReview:{account:CloudServiceConnection;open:boolean;purpose:ConnectionSnapshot['purpose']}|null=null;
let membershipRead:AbortController|null=null;
/** Development diagnostics contain only fixed classifications, never credentials or response bodies. */
export function membershipReadDiagnostic(error:unknown){
 const row=error&&typeof error==='object'?error as {code?:unknown;status?:unknown}:null;
 const known=['invalid-response','http','expired','credentials-missing','credential-consumed','login-active','account-changed'];
 const protocol=typeof row?.code==='string'&&known.includes(row.code)?row.code:null;
 const status=typeof row?.status==='number'&&Number.isInteger(row.status)&&row.status>=100&&row.status<=599?row.status:undefined;
 const code=protocol??(error instanceof TypeError?'client-type-error':error instanceof DOMException&&error.name==='AbortError'?'cancelled':'read-failed');
 return {code,...(status!==undefined?{status}:{}),message:code==='credentials-missing'?'No credential was returned for this environment.':code==='account-changed'?'The credential changed during the read.':code==='client-type-error'?'The active client could not run the membership method.':code==='http'?'The membership request received an HTTP error.':code==='invalid-response'?'The membership response was not understood.':'The membership read did not complete.'};
}

function reportMembershipReadFailure(stage:'credits'|'refresh',error:unknown){
 if(import.meta.env.DEV)console.warn('[Alpha membership]',{stage,...membershipReadDiagnostic(error)});
}
async function refreshMembershipBalance(){
  const account=service;
  if(!account){
    if(import.meta.env.DEV)console.warn('[Alpha membership]',{stage:'account',code:'service-unbound',message:'No current Cloud service is attached; checking the saved account.'});
    const expected=state.cloudAccount;if(!expected)return;
    membershipRead?.abort();const recovery=new AbortController();membershipRead=recovery;const deadline=setTimeout(()=>recovery.abort(),10000);
    if(!['funded','member'].includes(state.membershipBalance??''))update({membershipBalance:'checking',membershipCredits:null});
    try{await verifyService(makeCloud(expected.environment),recovery.signal,{credentialId:expected.credentialId,userId:expected.userId,organizationId:expected.organizationId});}
    catch(error){reportMembershipReadFailure('refresh',error);if(state.cloudAccount===expected)update({membershipBalance:'unavailable',membershipCredits:null,membershipPlan:{kind:'unavailable',reason:'outage'}});}
    finally{clearTimeout(deadline);if(membershipRead===recovery)membershipRead=null;}
    return;
  }
  membershipRead?.abort();const controller=new AbortController();membershipRead=controller;const timer=setTimeout(()=>controller.abort(),10000);
  // The balance last read, kept before a $0 or unknown balance is cleared to "checking" below.
  const before=state.membershipCredits;
  if(!['funded','member'].includes(state.membershipBalance??''))update({membershipBalance:'checking',membershipCredits:null});
  try{
    const [credits,checked]=await Promise.all([
      account.client.membershipCredits(controller.signal).catch(error=>{reportMembershipReadFailure('credits',error);return {state:'unavailable' as const,usd:null,observedAt:null};}),
      checkEntitlement(account.client.entitlementSource(),{userId:account.identity.userId,organizationId:account.identity.organizationId??null},controller.signal),
    ]);
    controller.signal.throwIfAborted();
    let balance:MembershipBalance=credits.state;
    if(checked.view.kind==='active')balance='member';
    else if(balance!=='funded'&&!['inactive','credits'].includes(checked.view.kind))balance='unavailable';
    // Credits that rose since Cloud declined a turn for billing (added in Cloud's billing page) end that refusal.
    const raised=!!state.fundingRefused&&before!=null&&credits.usd!==null&&Number(credits.usd)>Number(before.usd);
    if(membershipRead===controller&&service===account)update({membershipBalance:balance,...(raised?{fundingRefused:false}:{}),membershipCredits:credits.usd!==null&&credits.observedAt!==null?{usd:credits.usd,observedAt:credits.observedAt}:null,membershipPlan:checked.view,...(checked.entitlement?.planEndsAt!==undefined?{planEndsAt:checked.entitlement.planEndsAt}:checked.view.kind==='active'&&checked.view.source==='billing-limits'&&checked.view.expiresAt>0?{planEndsAt:checked.view.expiresAt}:checked.view.kind==='inactive'?{planEndsAt:null}:{})});
  }catch(error){reportMembershipReadFailure('refresh',error);if(membershipRead===controller&&service===account)update({membershipBalance:'unavailable',membershipCredits:null,membershipPlan:{kind:'unavailable',reason:'outage'}});}
  finally{clearTimeout(timer);if(membershipRead===controller)membershipRead=null;}
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
async function loadSignInService(environment: CloudEnvironment) {
 if (!cloudSignIn?.serviceInfo) throw new Error('Service information unavailable');
 return parseCloudServiceInfo(await cloudSignIn.serviceInfo({environment}));
}
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
/** A later operation retires the optional result even when it leaves the chooser mounted. */
let signInReadinessOwner: AbortSignal | null = null;
/** Whether the last ready host offered Google (it needs this phone's verified App Link return). */
let inAppGoogle = false, inAppPhone = false, inAppEmail = true;
/**
 * The verified optional sign-in methods, or null when the readiness probe is unavailable. The host
 * (AlphaCloudSignInPlugin) runs a cheap, cached readiness probe: the native client registration,
 * Steward's redirect allowlist and providers, /.well-known/assetlinks.json listing this app's
 * package and signing certificate, and Android's verification of the return host. Fail-safe: no
 * host, an error or a malformed answer hides Google. A slow answer initially offers email;
 * a validated late answer can update only the same still-current chooser.
 */
async function inAppSignInMethods(environment: CloudEnvironment, signal: AbortSignal, refreshNegative = false, onLateReady?: (methods: NonNullable<ReturnType<typeof signInReadiness>>) => void): Promise<{ google: boolean; phone: boolean; email: boolean } | null> {
  const port = cloudSignIn;
  if (!port?.status) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let timedOut = false;
  try {
    signal.throwIfAborted();
    const cancelled = new Promise<null>(resolve => { abort = () => resolve(null); signal.addEventListener('abort', abort, { once: true }); });
    const pending = port.status({ environment, ...(refreshNegative ? { refreshNegative: true } : {}) });
    const value = await Promise.race([pending, cancelled, new Promise<null>(resolve => { timer = setTimeout(() => { timedOut = true; resolve(null); }, SIGN_IN_READINESS_WAIT_MS); })]);
    if (timedOut) void pending.then(result => {
      if (signal.aborted) return;
      const methods = signInReadiness(result);
      if (methods) onLateReady?.(methods);
    }).catch(() => { /* Optional readiness remains unavailable; email is still offered. */ });
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
    message: outcome.method === 'totp' ? 'Enter the six-digit code from your authenticator app.' : outcome.method === 'sms' ? 'Enter the six-digit code sent to your phone.' : '',
    error: outcome.method === 'passkey' ? signInFailureMessage('mfa-unsupported') : '' });
}
/** A verified interactive sign-in finishes through setup, not the account/plan modal underneath it. */
function showPostSignInSetup() {
  if (state.cloudAccount||ownProviderSelected()) update({open: false, purpose: 'agent', setupRevision: (state.setupRevision ?? 0) + 1});
}
/**
 * A verified sign-in on the resident flow (the in-app code or Google step, or the browser hand-off).
 * The verified step stays on screen, as "Signing in…", only while the stored key is admitted
 * (identity and plan reads). Access setup then opens at once and the agent restarts behind it with
 * the key bound, shown as starting: setup never waits for the agent's first boot. Failures keep the
 * earlier rules: a failed start recovers and the caller's ensureResident() starts it again (P-43),
 * and a key Cloud refused right after issuing it is removed rather than kept for a retry that cannot work.
 */
async function residentSignedIn(signal: AbortSignal, unconfirmed: boolean) {
  const issued = (await cloudCredentialStore.read(residentEnvironment()))?.credentialId;
  signal.throwIfAborted(); retire();
  // The retired agent's AI binding no longer applies; the restarted agent reports its own (connectResident).
  update({ residentInference: null, message: 'Signing in…' });
  let refused = false, setup = false;
  try {
    const admission = await admitCloudResident(signal);
    if(ownProviderSelected()&&issued&&state.cloudAccount){await bindResidentCloudProvider(issued);signal.throwIfAborted();}
    refused = !state.cloudAccount && state.residentPlanNotice !== 'offline' && !!issued && (await cloudCredentialStore.read(residentEnvironment()).catch(() => null))?.credentialId === issued;
    signal.throwIfAborted();
    update({ signIn: null, message: '', ...(refused ? {} : { residentStarting: true }) });
    if (!refused) { showPostSignInSetup(); setup = true; }
    await connectResident(signal, admission);
    // A binding notice the start reported stays within setup (it shows connection errors), not over it.
    if (setup && state.cloudAccount) update({ open: false, purpose: 'agent' });
  } catch (error) { if (residentAlwaysPresent && !active) update({ kind: 'recovering' }); update({ signIn: null }); if (!setup) showPostSignInSetup(); throw error; }
  if (refused) {
    await cloudCredentialStore.clear(residentEnvironment());
    update({ residentSavedCredential: false, open: true, error: `${cloudServiceName(cloud.environment)} refused this sign-in. Your agent keeps running; sign in again to turn AI on.` });
  } else if (unconfirmed) update({ message: `Signed in. ${cloudServiceName(cloud.environment)} did not confirm revoking the sign-in this phone used before.` });
}
/** The key is stored; the existing identity, entitlement and agent paths take over unchanged. */
async function signedIn(client: CloudProtocol, outcome: CloudSignInAuthenticated, signal: AbortSignal) {
  const created = outcome.accountCreated === true;
  prepareSignInReplacement();
  const unconfirmed = outcome.previousSignIn === 'unconfirmed';
  if (residentCloudFlow()) { update({ accountCreated: created }); await residentSignedIn(signal, unconfirmed); return; }
  update({ signIn: null, accountCreated: created });
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
  if(next.purpose!=='plan'||patch.open===false||next.cloudAccount?.sessionId!==state.cloudAccount?.sessionId)next.membershipCodeEntry=false;
  // Modal ownership follows production presentation. Automatic restore only suppresses rendering
  // temporarily; it must not erase an explicitly opened account or plan panel.
  state = isAndroid && !testMocksEnabled ? { ...next, open: connectionChooserVisible({ ...next, automaticRestore: false },!!sending) } : next;
  if (!developmentPageSuspended) listeners.forEach(listener => listener());
  void flushConversationEvents();
}
// P-43: where the resident is always present no "no agent" choice is ever stored.
function save(selection: Selection) { localStorage.setItem(SELECTION, JSON.stringify(residentAlwaysPresent && (selection.kind === 'none' || selection.kind === 'offline') ? { kind: 'resident' } : selection)); }
function retire(name?: string) {
  clearClientObservationSupport();
  retireConversationEvents();
  retireReadReplies();
  const retirement=Promise.allSettled([state.session?pauseHostedBackground(state.session.sessionId):Promise.resolve(),retireClockReviews()]).then(results=>{const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;});
  void retirement.catch(()=>update({error:'Background delivery could not be retired. Reconnect to reset it.'}));
  if (testMocksEnabled && active?.kind === 'cloud') { active.cloud.setPhoneTarget(null); if (state.session) void secureConnectionStore.remove(`cloud-runtime:${state.session.sessionId}`).catch(()=>{}); }
  active?.viewNavigation?.dispose();
  actionReceipts.clear();
  conversationMemory.clear();
  cancelStoppedReply();
  for(const request of appRequests)request.abort(new DOMException('The connection changed','AbortError'));
  epoch++;
  sending?.abort(new DOMException('The connection changed.', 'AbortError'));
  sending = null;
  active = null;
  update({ phoneActionsAvailable:false, phoneCapabilityReason:'', session: null, kind: residentAlwaysPresent ? 'starting' : 'offline', name: name ?? (residentAlwaysPresent ? RESIDENT_NAME : 'Offline'), conversations: [], history: null, conversationDelivery:undefined,conversationEvents:'unavailable', historyError:'', historyPartial:false, replyNotice:'', actionHistory: [] });
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
async function work(message: string, action: (signal: AbortSignal) => Promise<void>, background = false, openOnError = false, preserveError = false) {
  if (operation) return;
  const controller = new AbortController(); signInReadinessOwner = null; operation = controller; residentStartInBackground = background;
  update({ busy: true, ...(background ? {} : { open: true }), message, error: preserveError ? state.error : '' });
  try { await action(controller.signal); }
  catch (error) {
    const recovery=residentRecoveryReason(error);if(recovery&&!active)update({residentRecoveryReason:recovery});
    if(controller.signal.aborted&&(!state.open||error===controller.signal.reason)){update({error:'',message:''});return;}
    if(background&&!openOnError&&!state.open){update({error:errorMessage(error),message:''});return;}
    if (testMocksEnabled && expired(error) && active?.kind === 'cloud' && active.cloud.environment === cloud.environment) {
      const previous = active; retire('Sign-in required'); detachService();
      try { await previous.cloud.disconnect(); }
      catch { update({ error: 'The expired connection is detached, but its stored credential could not be removed.', open: true, message: '' }); return; }
    }
    update({ error: errorMessage(error), ...(background&&!state.open?{purpose:residentCloudFlow()?'agent' as const:'cloud-account' as const}:{}), open: true, message: '' });
  }
  // A resident start ends with its operation, in one update: setup shown behind the start never
  // sees a still-busy connection that is no longer starting.
  finally { if (operation === controller) { operation = null; residentStartInBackground = false; } update({ busy: false, residentStarting: false, ...(background&&!state.open?{message:''}:{}) }); runQueuedResidentRebind(); runQueuedSignInReturn(); }
}
/** Start (or restart) the resident. A failure leaves the `recovering` state with a Retry, never "no agent". */
async function startResident(message = RESIDENT_STARTING, background = true) {
  await work(message, async signal => {
    update({ residentStarting: true, ...(active ? {} : { kind: 'starting' as const, name: RESIDENT_NAME }) });
    try { await connectResident(signal); }
    catch (error) { if (residentAlwaysPresent && !active) update({ kind: 'recovering' }); throw error; }
    // A start the owner asked for (Retry, Check plan again) keeps the dialog open while AI is not ready.
    if (!background && isAndroid && !testMocksEnabled && state.residentInference !== 'cloud'&&state.residentInference!=='direct') update({ open: true });
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
  update({ open: open || state.open, message: message || (state.session ? '' : state.message), error: error && !startFailed ? error : state.error || (state.session && startFailed ? '' : error) });
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
  clearClientObservationSupport();
  retireConversationEvents();
  retireReadReplies();
  active?.viewNavigation?.dispose();
  actionReceipts.clear();
  conversationMemory.clear();
  cancelStoppedReply();
  for(const request of appRequests)request.abort(new DOMException('The connection changed','AbortError'));
  epoch++; sending?.abort(new DOMException('The connection changed.', 'AbortError')); sending = null; active = next;
  update({ residentRecoveryReason:undefined,residentRecovery:undefined,phoneActionsAvailable:!!next.actions, conversations: [], history: null, conversationDelivery:undefined,conversationEvents:'unavailable', historyError: '', historyPartial:false, replyNotice:'', actionHistory: [], kind: next.kind, name, session, open: false, message: next.kind === 'resident' && state.inferenceOffline ? '' : 'Connected', error: '' });
  // Canonical app Calendar records currently belong to this resident transport only.
  // Read the existing allowed authenticated status route, never a native auth/status expansion.
  if(next.kind==='resident'){
    const generation=epoch,controller=new AbortController();appRequests.add(controller);
    const peer=new ClientObservationSupportSession({...session,connectionEpoch:generation},()=>epoch===generation&&active===next&&state.session===session,signal=>next.remote.request('/api/status',undefined,signal));
    clientObservationSession=peer;
    void peer.handshake(controller.signal).catch(()=>{}).finally(()=>appRequests.delete(controller));
  }
  startConversationEvents(next,session);
  lastInferenceWarm=Number.NEGATIVE_INFINITY;
  if(typeof document!=='undefined'&&!document.hidden)connectionController.warmInference();
}
/**
 * Applies a plan change to the running on-device agent: re-admits the account, binds or unbinds
 * Eliza Cloud inference, and reconnects (attaching when the process already matches, otherwise a
 * clean restart; conversation history lives in the agent and is restored). The agent is never
 * left stopped because of plan state. At most one rebind runs; one more is queued behind it.
 */
function queueResidentRebind(interruptReply=false) {
  if (!residentCloudFlow()||state.residentRecoveryReason) return;
  void residentRebinds().request(rebindResident, interruptReply ? () => !!operation : residentRebindBlocked).catch(() => {});
}
function rebindResident() {
  if(state.residentRecoveryReason)return Promise.resolve();
  // An outcome the open dialog is showing (a sign-out, a cancelled sign-in) stays visible after the rebind.
  const shown = state.open ? { message: state.message, error: state.error, startFailed: !!state.error && state.error === residentStartFailure } : null;
  const signIn = state.signIn;
  return work('Updating your agent…', async signal => {
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
function runQueuedResidentRebind() { if (residentRebindQueue?.pending && residentCloudFlow()) void residentRebindQueue.resume(rebindResident, residentRebindBlocked)?.catch(() => {}); }
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
  let userTextFormatVersion:1|undefined;
  let reason = "";
  const enrollment: Enrollment = {};
  let workflowProtocol:1|2|3=await workflowDeviceProtocol(signal);
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
    const admitted = await registerWorkflowDevice(workflowProtocol, protocol => request('/api/client-devices/register', { label: 'Alpha Phone', workflowProtocol: protocol }, signal), signal);
    workflowProtocol = admitted.workflowProtocol;
    const registered = admitted.registered as { installationId: string; enrollmentId: string; capabilities?: string[]; viewProfileVersion?: unknown; userTextFormatVersion?:unknown };
    if (registered.installationId !== credential.installationId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId)) throw new Error('Device registration was not verified');
    if(registered.userTextFormatVersion===1)userTextFormatVersion=1;
    reason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);
    headers["X-Eliza-Device-Capabilities"]=await deviceCapabilities(registered.capabilities);
    credential.enrollmentId = registered.enrollmentId;
    await secureConnectionStore.write(slot, credential); signal.throwIfAborted();
    deviceHeaders = headers;
    enrollment.deviceHeaders = headers;
    credential.capabilities=headers["X-Eliza-Device-Capabilities"].split(",");
    actions = new DeviceActions(session, credential, await actionScope(JSON.stringify([baseScope, credential.installationId])), request, actionJournal, (op, id, context, effectSignal, bindingHash, workflowRoute, journalIdentity, agendaSource) => deviceExecutor(op, id, context, effectSignal, bindingHash, workflowRoute, journalIdentity, agendaSource),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:"unknown"}),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    deviceRequest=request;
  } catch { signal.throwIfAborted(); reason = "Chat connected. Phone action enrollment was not confirmed. Reconnect to review its status."; }
  save({ kind, origin: remote.origin });
  activate({ kind, remote, origin: remote.origin, actions, workflowProtocol, ...enrollment, request:deviceRequest, ...(userTextFormatVersion?{userTextFormatVersion}:{}) }, session, agent.name);
  if (reason) update({phoneCapabilityReason: reason});
  await restoreSavedHistory(signal);

}
async function connectDevelopment(profile:DevelopmentProfile,signal:AbortSignal){
 if(!browserDevProfile)throw Error('Development mode required.');
 // This explicitly gated browser fixture implements reminder v2; real peers still negotiate it.
 const identity=await readDevelopmentIdentity(profile,signal);const client=new LocalAgentProtocol(developmentBridge(profile,identity));const {session,name}=await client.connect(signal);signal.throwIfAborted();const credential=developmentCredential(profile,identity),scope=await actionScope(JSON.stringify([client.origin,session.ownerId,session.agentId,credential.installationId]));const actions=new DeviceActions(session,credential,scope,(path,body,signal)=>client.request(path,body,signal),developmentJournal(profile,identity),(op,id,context,signal,binding,workflowRoute,journalIdentity,agendaSource)=>deviceExecutor(op,id,context,signal,binding,workflowRoute,journalIdentity,agendaSource),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:'unknown'}),true,true);await retire();signal.throwIfAborted();await verifyDevelopmentIdentity(identity,signal);const workflowProtocol=3 as const;save({kind:'development',profile,...(identity.account?{account:identity.account}:{})});developmentVoiceExpiresAt=Date.now()+3600000;activate({kind:'resident',remote:client,origin:client.origin,actions,workflowProtocol},session,name);
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
  let account:NonNullable<typeof service>|null=null,checked:Awaited<ReturnType<typeof checkEntitlement>>|null=null;
  const binding=residentBindingController(environment,client,{verified:value=>{account=value;},checked:value=>{checked=value;}});
  const admission=await binding.admit(signal);
  switch(admission.reason){
    case 'signed-out':
      // First run or signed out: sign-in is required (the dialog cannot be dismissed), and the agent
      // runs meanwhile without Cloud inference.
      if(service)detachService();
      update({residentSavedCredential:false,residentSubscription:null,residentPlanNotice:null,planEndsAt:null});
      return {binding:'unbound',notice:{open:true}};
    case 'offline':
      // Offline or a Cloud outage: a plan verified recently for this sign-in keeps its binding
      // (Cloud still decides each AI request once reachable); otherwise inference is unbound.
      update({residentPlanNotice:'offline',residentSubscription:{kind:'unavailable',reason:'outage'},planEndsAt:admission.recent?.endsAt??null});
      return {binding:admission.binding,notice:{message:OFFLINE_NOTICE}};
    case 'sign-in-rejected':
    case 'account-changed':
      // A rejected or unreadable sign-in, an entitlement for another account or a changed account:
      // no Cloud inference until the owner signs in again.
      // A changed account before the identity was verified leaves the connection as it is: a newer
      // sign-in may own it, and only a rejected read of this sign-in detaches it.
      // The shared controller's own account-changed fence (a newer credential replaced this one
      // during admission) carries code 'account-changed', which the entitlement classifier reads
      // as an auth failure; it is not a refusal of this sign-in, so it never detaches. Detaching
      // there would put the required sign-in page over the running resident (P-43).
      if(!admission.identity){if(admission.reason==='sign-in-rejected'&&service)detachService();}
      else if(!(admission.error instanceof CloudResidentBindingError)&&isEntitlementSignInFailure(admission.error)&&account&&service===account)detachService();
      update({residentPlanNotice:null,residentSubscription:null,planEndsAt:null});
      return {binding:'unbound',notice:{error:errorMessage(admission.error),open:true}};
    case 'plan-unavailable':
      update({residentPlanNotice:'needs-plan',residentSubscription:{kind:'unavailable',reason:'outage'},planEndsAt:null});
      return {binding:'unbound'};
    default:
      break;
  }
  const admitted=account as NonNullable<typeof service>|null,plan=admission.plan,result=checked as Awaited<ReturnType<typeof checkEntitlement>>|null;
  if(!admitted||!plan||!result)return {binding:'unbound',notice:{error:'Cloud account changed. Sign in again.',open:true}};
  if(admission.reason==='needs-plan'){
    // No admissible plan: the agent runs without Cloud inference; the plan notice offers Redeem
    // code / Choose a plan / Check plan again. Nothing is bound.
    update({residentSubscription:plan.view,residentPlanNotice:'needs-plan',planEndsAt:null});
    return {binding:'unbound',account:admitted};
  }
  const endsAt=admission.endsAt??null,identity=admission.identity!;
  update({residentSubscription:plan.view,residentPlanNotice:null,planEndsAt:endsAt});
  // Background refresh: it updates what the owner sees, never interrupts a turn, and unbinds Cloud
  // inference (the agent keeps running) when Cloud reports the plan ended. Revocation is enforced
  // by Cloud immediately.
  const expected={userId:identity.userId,organizationId:identity.organizationId};
  entitlementRefresher=new EntitlementRefresher({entitlement:result.entitlement,fallbackActive:result.view.kind==='credits'||result.view.kind==='active'&&result.view.source==='billing-limits',retry:result.view.kind==='unavailable'&&result.view.reason!=='not-published',
    check:refreshSignal=>checkEntitlement(client.entitlementSource(),expected,refreshSignal),
    onView:next=>{if(service!==admitted)return;update({residentSubscription:next,...(next.kind==='active'&&next.planEndsAt!==undefined?{planEndsAt:next.planEndsAt}:next.kind==='credits'?{planEndsAt:null}:{})});
      const nextDecision=planAdmission(next);
      if(next.kind==='credits')binding.recordAdmission(identity,{status:'credit-funded',planName:`${cloudServiceName(environment)} credits`},null);
      else if(next.kind==='active'&&!next.refreshFailed)binding.recordAdmission(identity,{status:next.status,planName:next.planName},state.planEndsAt??null);
      if(nextDecision==='needs-plan')residentPlanEnded(admitted,next);},
    onAuthFailure:error=>{if(service===admitted)residentRefreshRefused(admitted,error);}});
  return {binding:'cloud',credentialId:identity.credentialId,account:admitted};
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
  // Credential revocation still retires the current reply immediately.
  queueResidentRebind(true);
}
/**
 * Reads the account and plan again without opening the dialog (the owner returned to Alpha, or
 * the network came back). The running agent is rebound only when its binding must change; a start
 * that failed is retried. Never stops the agent because of plan state.
 */
async function recheckResidentPlan(){
  if(operation||state.residentRecoveryReason)return;
  if(ownProviderSelected()){void restoreOwnProviderCloudServices();return;}
  if(!state.session||active?.kind!=='resident'){queueResidentRebind();return;}
  const controller=new AbortController();signInReadinessOwner=null;operation=controller;
  try{
    const admission=await admitCloudResident(controller.signal);
    const target=residentBindable()?admission.binding:residentBinding;
    if(target!=='kept'&&target!==residentBinding)residentRebinds().queue();
    else if(admission.notice?.open||admission.notice?.error)update({open:true,purpose:state.purpose==='plan'||state.purpose==='cloud-account'?state.purpose:'agent',message:'',error:admission.notice.error??''});
  }catch{/* The next return checks again; the agent keeps running as it is. */}
  finally{if(operation===controller)operation=null;runQueuedResidentRebind();}
}
/** Bind or unbind Eliza Cloud inference before the agent starts. Returns the binding in effect. */
async function applyResidentBinding(admission:ResidentAdmission,signal:AbortSignal):Promise<{binding:'cloud'|'unbound'|'kept'|'unknown';error?:string}> {
  if(!residentBindable())return {binding:admission.binding};
  const bindingEpoch=epoch;
  const controller=residentBindingController(residentEnvironment(),cloud,{account:admission.account});
  try{
    const result=await controller.apply({binding:admission.binding,...(admission.binding==='cloud'&&admission.credentialId&&admission.account?{identity:{credentialId:admission.credentialId,userId:admission.account.identity.userId,organizationId:admission.account.identity.organizationId??null}}:{})},signal);
    if(result.binding==='cloud'||result.binding==='kept')return {binding:result.binding};
    // The agent always starts. It is reported unbound only after native confirms removal;
    // otherwise its inference state is unconfirmed (native still gates a Cloud binding on a
    // valid production credential at use time) and the owner can retry in Settings.
    if(result.failure?.kind==='bind-failed'){
      const why=errorMessage(result.failure.cause),serviceName=cloudServiceName(cloud.environment);
      return result.binding==='unknown'?{binding:'unknown',error:`AI could not be connected to your ${serviceName} plan: ${why} ${RESIDENT_UNBIND_UNCONFIRMED}`}
        :{binding:'unbound',error:`AI could not be connected to your ${serviceName} plan: ${why} Your agent is running; check your plan again in Settings.`};
    }
    // A removal native cannot confirm never stops the agent from starting; it is shown as unconfirmed.
    if(result.failure?.kind==='unbind-unconfirmed')return {binding:'unknown',error:RESIDENT_UNBIND_UNCONFIRMED};
    return {binding:'unbound'};
  }catch(error){
    if(error instanceof LocalCloudProviderStopUnconfirmed){
      // No bind was attempted. Retire only this operation's still-current
      // renderer client; never expose an old owner's resident as ready, and
      // never retire a newer connection that superseded this operation.
      if(epoch===bindingEpoch){
        if(active||state.session)retire();
        update({residentInference:'unknown'});
      }
      signal.throwIfAborted();
    }
    throw error;
  }
}
/**
 * The shared resident binding controller (`@elizaos/auth/auth/cloud-resident-binding`) wired to
 * this renderer: the secure credential store, the Cloud identity read, the shared entitlement
 * check, the native provider bind/clear and the installed plan admission record. The controller
 * owns the binding rules (account fences, the 7-day offline rule, bind confirmation); this file
 * maps its outcome to the owner's notices.
 */
function residentBindingController(environment:CloudEnvironment,client:CloudProtocol,hooks:{verified?:(account:NonNullable<typeof service>)=>void;checked?:(checked:Awaited<ReturnType<typeof checkEntitlement>>)=>void;account?:ResidentAdmission['account']}={}){
  return new CloudResidentBindingController<SubscriptionView,CloudEnvironment>(environment,{
    readCredential:async signal=>{const saved=await cloudCredentialStore.read(environment);signal.throwIfAborted();if(hooks.account&&service!==hooks.account)throw new CloudResidentBindingError('account-changed');return saved?.credentialId?{credentialId:saved.credentialId}:null;},
    verifyIdentity:async signal=>{
      await verifyService(client,signal);
      const account=service;
      if(!account||account.client!==client)throw new CloudResidentBindingError('account-changed');
      hooks.verified?.(account);
      return {credentialId:account.identity.credentialId,userId:account.identity.userId,organizationId:account.identity.organizationId??null};
    },
    // One entitlement read at admission; turns never wait on billing.
    checkPlan:async(identity,signal)=>{
      const account=service;
      const checked=await checkEntitlement(client.entitlementSource(),{userId:identity.userId,organizationId:identity.organizationId},signal);
      signal.throwIfAborted();
      if(service!==account)throw Error('Cloud account changed. Sign in again.');
      hooks.checked?.(checked);
      const view=checked.view;
      // End of the plan window when Cloud reported one: the billing snapshot's period end, a redeemed grant's end, or the last known.
      const reported=checked.entitlement?.planEndsAt!==undefined?checked.entitlement.planEndsAt:view.kind==='credits'?null:view.kind==='active'&&view.source==='billing-limits'&&view.expiresAt>0?view.expiresAt:undefined;
      const recent=recentResidentPlanAdmission(readPlanAdmission(),environment,identity.credentialId,identity.userId,Date.now());
      return {decision:planAdmission(view),view,outage:view.kind==='unavailable'&&view.reason==='outage',
        record:view.kind==='credits'?{status:'credit-funded',planName:`${cloudServiceName(environment)} credits`}:view.kind==='active'?{status:view.status,planName:view.planName}:null,
        endsAt:reported!==undefined?reported:recent?.endsAt??(state.cloudAccount?.credentialId===identity.credentialId?state.planEndsAt??null:null)};
    },
    // Return the native guard before the shared controller performs post-bind
    // cancellation and account checks, so only that binding can be cleaned up.
    bindProvider:(credentialId,_signal)=>bindResidentCloudProvider(credentialId),
    clearProviderIfCurrent:(bindingGuard,signal)=>clearLocalProviderIfCurrent(bindingGuard,signal),
    // A plain unbind is a no-op (no restart) when no binding is stored.
    clearProvider:async(_signal,reason)=>{await clearLocalProvider(reason==='unbound');},
    readAdmission:readPlanAdmission,
    writeAdmission:writePlanAdmission,
    isUnreachable:cloudUnreachable,
    // An entitlement for another account, a rejected sign-in or a changed account: nothing is bound.
    isSignInRejected:error=>isEntitlementSignInFailure(error)||(error instanceof EntitlementError&&error.code==='account-mismatch')||(error instanceof Error&&error.message==='Cloud account changed. Sign in again.'),
    isFatalBindError:error=>error instanceof LocalCloudProviderStopUnconfirmed,
  });
}
/** The packaged-runtime refusal. Android production without the runtime is a non-distributable
 * developer build (--allow-unpackaged-runtime); browser development needs the host agent running. */
const RESIDENT_UNPACKAGED = !testMocksEnabled ? 'This developer build does not include the on-device agent.' : !isAndroid && browserLocalAgentEnabled ? 'The local agent on this computer is not running. Start it with bun run dev.' : webCloudUnavailable() ? 'The local agent is unavailable here. Alpha runs its agent on the phone; this preview needs the local agent.' : 'The local agent is unavailable in this version. Connect a remote agent or sign in with Cloud.';
/** Restore optional Cloud services independently of owner-provided inference. Neither an
 * absent account nor a failed read may unbind, restart, or delay the resident agent. */
let ownCloudServiceRestore:AbortController|null=null;
async function restoreOwnProviderCloudServices():Promise<void>{
  const selected=active,session=state.session,generation=epoch;
  if(!selected||!session||!ownProviderSelected()||state.residentRecoveryReason)return;
  ownCloudServiceRestore?.abort();
  const controller=ownCloudServiceRestore=new AbortController();appRequests.add(controller);
  const previousService=service;
  const timer=setTimeout(()=>controller.abort(new DOMException('Cloud service check timed out','AbortError')),10000);
  const current=()=>ownCloudServiceRestore===controller&&epoch===generation&&active===selected&&state.session===session&&ownProviderSelected();
  let credentialId:string|undefined,credentialReference:string|undefined;
  try{
    const client=makeCloud(residentEnvironment());
    const credential=await cloudCredentialStore.read(client.environment);
    if(!current()||controller.signal.aborted)return;
    if(!credential?.credentialId){if(service&&service===previousService)detachService();return;}
    credentialId=credential.credentialId;credentialReference=credential.credentialReference;
    await verifyService(client,controller.signal,{credentialId,credentialReference:credential.credentialReference});
  }catch{
    // Keep the saved credential for an explicit retry. An older request cannot
    // clear a newer account; direct inference remains selected throughout.
    if(current()&&!controller.signal.aborted&&service&&service===previousService&&service.identity.credentialId===credentialId&&service.credentialReference===credentialReference)detachService();
  }finally{clearTimeout(timer);appRequests.delete(controller);if(ownCloudServiceRestore===controller)ownCloudServiceRestore=null;}
}
/** `admitted`: the admission a sign-in just made for this start (residentSignedIn); otherwise it is read here. */
async function connectResident(signal: AbortSignal, admitted?: ResidentAdmission) {
  let admission:ResidentAdmission|null=null,bound:Awaited<ReturnType<typeof applyResidentBinding>>|null=null;
  if(isAndroid||browserCloudResidentEnabled){const status=await localProviderStatus();signal.throwIfAborted();update({providerStatus:status});}
  const ownProvider=ownProviderSelected();
  // A prior Cloud plan may not rebind a resident now using its own keys.
  if(ownProvider){stopEntitlementRefresh();residentBinding='unbound';}
  if(residentCloudFlow()&&!ownProvider){
    admission=admitted??await admitCloudResident(signal);
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
  let workflowProtocol:1|2|3=await workflowDeviceProtocol(signal);
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
    const admitted=await registerWorkflowDevice(workflowProtocol,protocol=>request('/api/client-devices/register',{label:isAndroid?'Alpha Phone':'Alpha browser development',workflowProtocol:protocol},signal),signal);
    workflowProtocol=admitted.workflowProtocol;const registered=admitted.registered;
    if(registered.installationId!==credential.installationId||typeof registered.enrollmentId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId))throw Error('Device registration was not verified');
    if(registered.userTextFormatVersion===1)userTextFormatVersion=1;
    reason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);
    headers['X-Eliza-Device-Capabilities']=await deviceCapabilities(registered.capabilities);
    credential.enrollmentId=registered.enrollmentId;await store.write(slot,credential);signal.throwIfAborted();
    // Cost: one authenticated read after durable enrollment, not per message.
    // Its existing native enrollment entry wakes notifications only after the complete slot exists.
    if(isAndroid){
      const committedDevice=await request('/api/client-devices/context',undefined,signal);signal.throwIfAborted();
      if(committedDevice.subjectUserId!==session.ownerId||committedDevice.agentId!==session.agentId||committedDevice.installationId!==credential.installationId||committedDevice.enrollmentId!==credential.enrollmentId)throw Error('Committed device enrollment changed');
    }
    client.deviceHeaders=headers;
    credential.capabilities=headers["X-Eliza-Device-Capabilities"].split(",");
    actions=new DeviceActions(session,credential,await actionScope(JSON.stringify([baseScope,credential.installationId])),request,journal,(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity,agendaSource)=>deviceExecutor(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity,agendaSource),(op,id,binding,recoverySignal)=>deviceRecovery?deviceRecovery(op,id,binding,recoverySignal):Promise.resolve({status:'unknown'}),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
    deviceRequest=request;
  } catch(error) {signal.throwIfAborted();reason='Local chat connected. Device actions are unavailable: '+(error instanceof Error?error.message:'Enrollment failed.');}
  save({kind:'resident'});
  activate({kind:'resident',remote:client,origin:client.origin,actions,workflowProtocol,request:deviceRequest,...(userTextFormatVersion?{userTextFormatVersion}:{})},session,name);
  if(reason)update({phoneCapabilityReason:reason});
  if(ownProvider){update({residentInference:'direct',residentPlanNotice:null});void restoreOwnProviderCloudServices();}
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
  }else if(browserLocalAgentEnabled||ownProvider)await restoreSavedHistory(signal);
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
  const workflowProtocol=await workflowDeviceProtocol(signal);
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
    const admitted=await registerWorkflowDevice(workflowProtocol,protocol=>request('/api/client-devices/register',{label:'Alpha Phone',workflowProtocol:protocol},signal),signal);
    next.workflowProtocol=admitted.workflowProtocol;const registered=admitted.registered;
    if (registered.installationId!==credential.installationId || typeof registered.enrollmentId!=='string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(registered.enrollmentId)) throw new Error('Cloud device registration was not verified');
    if(registered.userTextFormatVersion===1)next.userTextFormatVersion=1;
    const profileReason = await negotiateEnabledViews(registered.viewProfileVersion, request, signal);

    credential.enrollmentId=registered.enrollmentId; await secureConnectionStore.write(slot,credential); signal.throwIfAborted();
    credential.capabilities=target.headers["X-Eliza-Device-Capabilities"].split(",");
    next.actions=new DeviceActions(session,credential,await actionScope(JSON.stringify([baseScope,credential.installationId])),request,actionJournal,(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity,agendaSource)=>deviceExecutor(op,id,context,effectSignal,bindingHash,workflowRoute,journalIdentity,agendaSource),(op,id,binding,signal)=>deviceRecovery?deviceRecovery(op,id,binding,signal):Promise.resolve({status:"unknown"}),target.headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.local-record.v2"),target.headers["X-Eliza-Device-Capabilities"].split(",").includes("reminders.create.v1"),runForegroundReview);
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
 if(typeof id!=='string'||!id)id=await createSelectedConversation(selected,key,cached,signal,current);
 if(!conversationMemory.has(key)){current();conversationMemory.set(key,id);}
 return id;
}
async function createSelectedConversation(selected:Active,key:string,expected:ConversationChoice|null,signal:AbortSignal,current:()=>void,requireSaved=false):Promise<string>{
 const created=selected.kind==='cloud'?await selected.cloud.createConversation(selected.agentId,'Alpha Phone',signal):await selected.remote.createConversation('Alpha Phone',signal);current();
 let saved=true;try{await selectConversation(key,expected,created.id,signal,current);}catch(error){if(requireSaved)throw error;saved=false;}
 current();conversationMemory.set(key,created.id);update({});
 if(!saved)update({message:'Conversation is connected for this session. Its selection could not be saved for restart.'});
 return created.id;
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
    return {id:item.id,from:item.role==='user'?'user':'agent',text:item.role==='user'?restoredText(item.text,item.userTextFormat):item.interrupted===true&&!item.text?'This reply did not finish.':item.text};
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
/** Shown beside the composer while the resident is connected and the phone has no network. */
export const INFERENCE_OFFLINE_NOTICE = 'Your agent is running; AI needs a connection. Nothing is sent until this phone is back online.';
const RATE_LIMITED = 'The agent provider is rate-limiting requests. Wait before sending again. Alpha Phone did not retry your message.';
/** A turn that failed after its action committed: the owner is told the action went through, never the generic failure. */
export const EFFECT_APPLIED_INTERRUPTED = 'The requested action went through, but the reply was cut off before it finished. Check the app it changed. Nothing was run again.';
/** Upstream's post-commit interruption (`TURN_INTERRUPTED_AFTER_EFFECT`), or an effect receipt the reply proves applied and not rolled back. */
function effectAppliedBeforeFailure(reply:{terminalFailure?:unknown;actionResults?:unknown}):boolean {
  const code=reply.terminalFailure&&typeof reply.terminalFailure==='object'?(reply.terminalFailure as {code?:unknown}).code:undefined;
  if(code==='TURN_INTERRUPTED_AFTER_EFFECT')return true;
  if(!Array.isArray(reply.actionResults))return false;
  const receipts=reply.actionResults.flatMap(result=>{if(!result||typeof result!=='object'||!('effectReceipts' in result))return [];try{return [...normalizeEffectReceipts((result as {effectReceipts:unknown}).effectReceipts)];}catch{return [];}});
  const reverted=new Set(receipts.flatMap(receipt=>receipt.outcome==='rolled_back'?receipt.rollback.revertedReceiptIds:[]));
  return receipts.some(receipt=>receipt.outcome==='applied'&&!reverted.has(receipt.receiptId));
}
/** Owner-facing states for upstream's CHAT_FAILURE_KINDS (pinned contracts `chat.ts`). Each says
 * what happened and what to do next; none retries the message. Unlisted kinds keep the generic text. */
export const REPLY_FAILURES = {
  hosted_unreachable: 'Alpha’s AI service could not complete this reply. Nothing was resent.',
  provider_unreachable: 'Alpha’s AI service could not complete this reply. Nothing was resent.',
  no_provider_resident: 'Your agent answered without its AI connection. Check the connection again; nothing was retried.',
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
  if(kind==='interrupted')return Object.assign(new AlphaClientError('transport-failed','This reply did not finish. Nothing was resent. Your conversation is saved.'),{failureKind:kind});
  if(selected.kind==='resident'&&(limit?.kind==='subscription-required'||limit?.kind==='billing-refused'))connectionController.recheckPlanAfterRefusal();
  // A billing refusal of a signed-in account: one answer in the chat, and the Subscription
  // sheet with its credits and membership code actions opens with a fresh balance once the turn ends.
  const funding=limit?.kind==='billing-refused'&&!!state.cloudAccount;
  if(limit)update({lastServiceLimit:{...limit,observedAt:Date.now()},...(funding?{fundingRefused:true,membershipDismissed:false}:{})});
  if(funding){void refreshMembershipBalance();return Object.assign(new AlphaClientError('transport-failed',fundingRefusedReply(cloudServiceName(cloud.environment))),{failureKind:kind??limit.kind,serviceLimit:limit.kind,planAction:'funding'});}
  if(limit)return Object.assign(new AlphaClientError('transport-failed',serviceLimitMessage(limit, Date.now(), cloudServiceName(cloud.environment))),{failureKind:kind??limit.kind,serviceLimit:limit.kind});
  if(kind==='rate_limited')return new AlphaClientError('transport-failed',RATE_LIMITED);
  // The on-device agent without Eliza Cloud inference (no plan, offline, signed out): the same honest
  // answer as a recorded provider-less reply, with its plan action. Nothing is retried or purchased.
  if(kind==='no_provider'&&selected.kind==='resident'&&residentCloudFlow()){
    // Bound to an admitted plan, yet the agent ran without a provider: say so and offer a recheck.
    if(state.residentInference==='cloud')return Object.assign(new AlphaClientError('transport-failed',REPLY_FAILURES.no_provider_resident),{failureKind:kind,planAction:'retry'});
    const notice=state.residentPlanNotice??null,signedIn=!!state.cloudAccount;
    return Object.assign(new AlphaClientError('transport-failed',inferenceUnavailableReply(notice,signedIn)),{failureKind:kind,planAction:notice==='offline'?'retry':signedIn?'plan':'sign-in'});
  }
  const resident=selected.kind==='resident'&&isAndroid;
  // insufficient_credits is a Cloud billing refusal (readServiceLimit above), never a mapped kind here.
  const text=kind==='provider_issue'||kind==='generation_timeout'?(resident?REPLY_FAILURES.hosted_unreachable:REPLY_FAILURES.provider_unreachable)
    :kind==='no_provider'?(resident?REPLY_FAILURES.no_provider_resident:REPLY_FAILURES.no_provider):undefined;
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
      update({ history: { sessionId: session.sessionId, conversationId, revision: (state.history?.revision || 0) + 1, messages: restoredMessages(result.messages), automatic: true,deliveryRevisionAtStart:result.deliveryRevisionAtStart }, historyPartial: result.partial, replyNotice: '', message: 'The agent finished the stopped reply.' });
    } catch { if (current()) update({ replyNotice: 'The stopped reply could not be checked. Load conversations from Agent connection to see it.' }); }
    finally { if (stoppedReply?.controller === controller) stoppedReply = null; }
  })(); }, delay);
  stoppedReply = { timer, controller };
}
async function conversationList(selected: Active, signal: AbortSignal) {
  const list = selected.kind === 'cloud' ? await selected.cloud.listConversations(selected.agentId, signal) : await selected.remote.listConversations(signal);
  return list.map(item => ({ id: item.id, title: typeof item.title === 'string' && item.title ? item.title : 'Conversation' }));
}

async function restoreConversationHistory(id:string,signal:AbortSignal,automatic:boolean,afterConnect=false,fallbackExpected?:ConversationChoice,canCommit?:()=>boolean) {
  const selected=active,session=state.session,generation=epoch;
  if(!selected||!session)throw noSessionError(NO_SESSION_FALLBACK);
  const account=selected.kind==='resident'&&residentCloudFlow()?service:null;
  // P-43: a signed-out resident still owns its history and actions; a bound Cloud account must stay the same one.
  const assertCurrent=()=>{signal.throwIfAborted();if(canCommit&&!canCommit())throw new DOMException('Notification navigation interrupted','AbortError');if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId||account&&(service!==account||state.cloudAccount?.sessionId!==account.identity.sessionId))throw Error('The agent or account changed.');};
  const assertAccount=async()=>{
    assertCurrent();
    if(account){const credential=await cloudCredentialStore.read(account.identity.environment);assertCurrent();if(credential?.credentialId!==account.identity.credentialId||credential.expiresAt!==undefined&&credential.expiresAt<=Date.now())throw Error('Cloud account changed or expired.');}
  };
  const key=conversationKey(session),expected=await captureConversationChoice(key,signal);
  await assertAccount();
  if(fallbackExpected&&JSON.stringify(expected)!==JSON.stringify(fallbackExpected))throw Error('Saved conversation selection changed.');
  if(automatic&&expected?.id!==id)throw Error('Saved conversation selection changed.');
  const list=await conversationList(selected,signal);await assertAccount();
  if(!list.some(item=>item.id===id))throw new ConversationMissing(list[0]?.id);
  const result=await readConversation(selected,id,signal,assertCurrent);
  assertCurrent();
  const messages=restoredMessages(result.messages);
  if(selected.actions){
    try{
      const receipts=await selected.actions.conversationReceipts(new Set(messages.filter(m=>m.from==='user').map(m=>m.id)),signal);
      assertCurrent();
      for(const receipt of receipts){
        const request=messages.findIndex(m=>m.from==='user'&&m.id===receipt.requestMessageId);
        if(request<0||messages.some(m=>m.id===receipt.id))continue;
        const next=messages.findIndex((m,index)=>index>request&&m.from==='user');
        messages.splice(next<0?messages.length:next,0,{id:receipt.id,from:'agent',text:receipt.summary,deviceReceipt:true,...(receipt.browserDestination?{browserDestination:receipt.browserDestination}:{})});
      }
    }catch{assertCurrent();/* Canonical chat still loads when receipt history is unavailable. */}
  }
  await assertAccount();
  let saved=true;
  if(!automatic)try{await selectConversation(key,expected,id,signal,assertCurrent);}catch(error){if(fallbackExpected)throw error;saved=false;}
  await assertAccount();
  if(automatic){
    const current=await captureConversationChoice(key,signal);
    assertCurrent();
    if(JSON.stringify(current)!==JSON.stringify(expected))throw Error('Saved conversation selection changed.');
  }
  conversationMemory.set(key,id);
  const older=result.partial?' Older messages remain on the agent.':'';
  // An explicit reload already shows whether a stopped reply finished; the pending check is retired.
  if(!automatic)cancelStoppedReply();
  update({history:{sessionId:session.sessionId,conversationId:id,revision:(state.history?.revision||0)+1,messages,automatic,deliveryRevisionAtStart:result.deliveryRevisionAtStart},historyError:'',historyPartial:result.partial,...(automatic?{}:{open:false,replyNotice:''}),message:automatic?older.trim():(saved?'Conversation restored.':'History restored for this session; restart selection could not be saved.')+older});
  const last=result.messages.at(-1);
  if(afterConnect&&selected.kind==='resident'&&last?.role==='user'&&typeof last.text==='string'&&typeof last.timestamp==='number'&&last.timestamp>Date.now()-RESTORED_REPLY_WINDOW_MS)
    scheduleStoppedReply(selected,session,id,{text:restoredText(last.text,last.userTextFormat),sentAt:last.timestamp,...(typeof last.clientMessageId==='string'?{clientMessageId:last.clientMessageId}:{})},STOPPED_REPLY_CHECK_MS,false);
}
class ConversationMissing extends Error{constructor(readonly latest?:string){super('This conversation is no longer available to this agent.');}}
/** Restored chats are bounded; anything older stays on the agent and is reported as partial. */
const HISTORY_LIMIT=2000, HISTORY_PAGE=200;
/** Reads the recent window, then pages older messages with ?before=<createdAt>&beforeId=<id> until
 * the agent reports hasMore:false. A server that does not report hasMore for an older page (or
 * rejects the cursor) ends paging without duplicating messages. Messages stay oldest first. */
async function readConversation(selected:Active,id:string,signal:AbortSignal,assertCurrent:()=>void):Promise<{messages:Record<string,unknown>[];partial:boolean;deliveryRevisionAtStart:number}> {
  const deliveryRevisionAtStart=state.conversationDelivery?.revision||0;
  const first=selected.kind==='cloud'?await selected.cloud.messages(selected.agentId,id,signal):await selected.remote.messages(id,signal);
  assertCurrent();
  let messages=first.messages.slice(),partial=false;
  const seen=new Set(messages.map(item=>item.id));
  // Cloud's adapter does not expose the older-page cursor yet; a full recent window may be partial.
  if(selected.kind==='cloud')return {messages:messages.slice(-HISTORY_LIMIT),partial:messages.length>=HISTORY_PAGE,deliveryRevisionAtStart};
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
  return {messages,partial,deliveryRevisionAtStart};
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
    if(saved)await restoreConversationHistory(saved.id,signal,true,true).catch(async(error:unknown)=>{
      // As in stock eliza, a saved conversation the agent no longer has falls back to its most
      // recent conversation, or to a new one; otherwise every send fails with HTTP 404.
      if(!(error instanceof ConversationMissing))throw error;
      const latest=error.latest;
      const stillSelected=await captureConversationChoice(conversationKey(session),signal);signal.throwIfAborted();
      if(JSON.stringify(stillSelected)!==JSON.stringify(saved))throw Error('Saved conversation selection changed.');
      if(latest)await restoreConversationHistory(latest,signal,false,true,saved);
      else {
        const id=await createSelectedConversation(selected,conversationKey(session),saved,signal,()=>{signal.throwIfAborted();if(generation!==epoch||selected!==active||state.session!==session)throw Error('The agent changed.');},true);
        update({history:{sessionId:session.sessionId,conversationId:id,revision:(state.history?.revision||0)+1,messages:[],automatic:true}});
      }
      update({historyError:'',message:latest?'The saved conversation is no longer on the agent. Its most recent conversation is shown.':'The saved conversation is no longer on the agent. A new conversation was started.'});
    });
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
    // Action history is available in Settings on every platform. Background reads
    // retain every outcome without changing the current panel or connection message.
    update({actionHistory:entries});
  }catch{signal.throwIfAborted();/* The history stays available from Phone action history. */}
}
let viewInteractionExecutor:((view:string,capability:string,params:unknown,signal:AbortSignal,current:()=>void)=>Promise<unknown>)|undefined;
function boundNavigation():ViewNavigationClient|undefined {
 const selected=active,session=state.session,generation=epoch;
 if(!selected||!session||!navigationContext)return undefined;
 // Basic view delivery uses the owner session even when device enrollment fails.
 // DeviceActions remains unavailable; claim/result endpoints retain server custody.
 const request=selected.request??((selected.kind==='resident'||selected.kind==='remote'||selected.kind==='local')
   ? (path:string,body:unknown,signal:AbortSignal)=>selected.remote.viewNavigationRequest(path,body,signal)
   : undefined);
 if(!request)return undefined;
 const subscribe=isAndroid&&selected.kind==='resident'?(clientId:string,listener:(frame:unknown)=>void,ended:()=>void)=>selected.remote.subscribeViewEvents(clientId,listener,ended):undefined;
 const execute=(view:string,capability:string,params:unknown,signal:AbortSignal,current:()=>void)=>{if(!viewInteractionExecutor)throw Error('Native view executor unavailable');return viewInteractionExecutor(view,capability,params,signal,current);};
 if(!selected.viewNavigation)return selected.viewNavigation=new ViewNavigationClient(request,()=>active===selected&&state.session===session&&epoch===generation&&!state.open&&!state.busy,()=>navigationContext?.()??null,subscribe,execute);
 selected.viewNavigation.connectRenderer();return selected.viewNavigation;
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
  catch(error){if(kept)residentRebinds().queue();throw error;}
  // Admission binds the new sign-in: native attaches when the process already matches, otherwise
  // it restarts the agent once (a process bound to the replaced key is stopped by the write).
  await residentSignedIn(signal,login.previousSignIn==='unconfirmed');
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



let ownerReminderBindingCache:{selected:Active;session:VerifiedSession;generation:number;port:ReminderNotificationBinding}|undefined;
async function restoreOptionalBrowserCloudAccount():Promise<boolean>{
 // A selected development host can restore its existing Mac-owned Cloud account.
 // The server returns only a reference; canonical identity still owns readiness.
 if(cloudCredentialStore.acceptsReferences&&!isAndroid&&!browserDevProfile&&!browserCloudResidentEnabled&&selection()?.kind!=='offline'&&new URLSearchParams(location.search).get('mode')!=='mock'){
   const restoreEpoch=epoch;
   const canRestore=()=>restoreEpoch===epoch&&!operation&&!state.open&&selection()?.kind!=='offline';
   try{
     const credential=await cloudCredentialStore.read('production');
     // A user choice retires this automatic account check.
     if(!canRestore())return false;
     // An optional empty host store is not an account onboarding action.
     if(credential?.credentialReference&&credential.credentialId){
       const expected={credentialId:credential.credentialId,credentialReference:credential.credentialReference};
       await work('Checking your Cloud account…',async signal=>{
         const current=await cloudCredentialStore.read('production');signal.throwIfAborted();
         if(restoreEpoch!==epoch||current?.credentialId!==expected.credentialId||current?.credentialReference!==expected.credentialReference)throw Error('Cloud account changed. Try again.');
         await verifyService(makeCloud('production'),signal,expected);
       },true,true);
       if(restoreEpoch!==epoch||state.error||service?.identity.credentialId!==expected.credentialId)return false;
     }
   }catch(error){if(canRestore())await work('Checking your Cloud account…',async()=>{throw error;},true,true);return false;}
 }
 return true;
}

export const connectionController = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot() { return state; },
  getSelectedConversationId(){return active&&state.session?conversationMemory.get(conversationKey(state.session)):undefined;},
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
  async performVoiceRequestedActions(binding:VoiceConversationBinding,messageId:string,signal:AbortSignal,operationType?:'camera_capture_photo',proof?:CurrentDeviceActionRequest){
    const selected=active,expected=navigationContext?.();
    if(!selected?.actions||!expected||!validateUuid(messageId)||!proof||proof.messageId!==messageId||!proof.text.trim())return [];
    const context=structuredClone(expected);
    const current=()=>{signal.throwIfAborted();proof.current();if(active!==selected||!this.voiceConversationCurrent(binding)||context.sensitive||JSON.stringify(navigationContext?.())!==JSON.stringify(context))throw Error('Voice action context changed');};
    const allowed=async()=>{current();const preferences=await readDevicePreferences(signal);current();return !preferences.askBeforeAgentActions;};
    if(!await allowed())return [];
    await selected.actions.pendingReview(context,signal,proof);current();
    const receipts=await selected.actions.performRequested(messageId,context,signal,allowed,operationType,proof);current();
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
  observeCommittedView(){return boundNavigation()?.observeCommittedView()??Promise.resolve(false);},
  captureViewNavigation(context:ContextEnvelope){const client=boundNavigation();return client?{client,attempt:client.capture(context)}:undefined;},
  setViewInteractionExecutor(executor:typeof viewInteractionExecutor){viewInteractionExecutor=executor;},
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
  getWorkflowPresentationProtocol():1|2 { return active?.actions && (active.workflowProtocol ?? 1) >= 2 ? 2 : 1; },
  /** Registered workflow device protocol: 3 adds the selected-reminders read. */
  getWorkflowDeviceProtocol():1|2|3 { return active?.actions ? active.workflowProtocol ?? 1 : 1; },
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
  /** Passive notifications use only the already-admitted resident owner. No account or voice admission. */
  getOwnerReminderNotificationBinding():ReminderNotificationBinding|null {
    const selected=active,session=state.session,generation=epoch;
    if(Capacitor.isNativePlatform()||!browserLocalAgentEnabled||selected?.kind!=='resident'||!session)return null;
    const cached=ownerReminderBindingCache;
    if(cached?.selected===selected&&cached.session===session&&cached.generation===generation)return cached.port;
    const current=()=>generation===epoch&&selected===active&&session===state.session;
    const check=(signal:AbortSignal)=>{signal.throwIfAborted();if(!current()||state.open||document.hidden)throw new DOMException('Reminder owner changed','AbortError');};
    const request=async(path:string,method:'GET'|'POST',signal:AbortSignal)=>{
      if(!ownerReminderRoute(path,method,undefined))throw Error('Unsupported reminder request');
      const bounded=anyAbortSignal([signal,AbortSignal.timeout(2500)]);check(bounded);
      const result=await selected.remote.request(path,undefined,bounded,{},method);check(bounded);return result;
    };
    const port:ReminderNotificationBinding={
      // Ephemeral nonce is bound to the full captured identity/object tuple; never a credential.
      key:crypto.randomUUID(),identity:{origin:session.origin,ownerId:session.ownerId,agentId:session.agentId,sessionId:session.sessionId,generation},current,
      passiveAllowed:()=>current()&&!state.open&&!state.busy&&!document.hidden,actionAllowed:()=>current()&&!state.open&&!document.hidden,
      listUnread:signal=>request(OWNER_REMINDER_LIST,'GET',signal),readback:signal=>request(OWNER_REMINDER_READBACK,'GET',signal),
      markRead:(id,signal)=>request(reminderReadPath(id),'POST',signal),
      async openConversation(conversationId,messageId,signal){
        if(!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(conversationId)||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(messageId)||state.open||state.busy||document.hidden)throw Error('Reminder source unavailable');
        check(signal);let opened=false;
        await work('Opening reminder…',async own=>{const bounded=anyAbortSignal([signal,own]);check(bounded);await restoreConversationHistory(conversationId,bounded,false);check(bounded);
          if(state.history?.sessionId!==session.sessionId||state.history.conversationId!==conversationId||!state.history.messages.some(row=>row.id===messageId))throw Error('The reminder message could not be restored');opened=true;
        });
        check(signal);if(!opened)throw Error('Reminder source did not open');return {opened:true};
      },
    };
    ownerReminderBindingCache={selected,session,generation,port};return port;
  },
  /** Canonical app records belong to the same resident agent as chat, on Android and in DEV. */
  getAppRecordClient():AppRecordPort|null {
    const selected=active,session=state.session,generation=epoch;
    if(selected?.kind!=='resident'||!session)return null;
    const current=()=>generation===epoch&&selected===active&&session===state.session;
    return {sessionId:session.sessionId,scope:selected.actions?.scope,identity:session,current,
      request:async(path:string,method:AppRecordMethod,body:unknown|undefined,signal:AbortSignal):Promise<unknown>=>{
        assertAppRecordRequestAllowed(path,method,body);
        signal.throwIfAborted();if(!current())throw new DOMException('The app record connection changed','AbortError');
        const controller=new AbortController(),bounded=anyAbortSignal([signal,controller.signal]);appRequests.add(controller);
        try{const result=await selected.remote.request(path,body,bounded,{},method);bounded.throwIfAborted();if(!current())throw new DOMException('The app record connection changed','AbortError');return result;}
        finally{appRequests.delete(controller);}
      }};
  },
  getAutomationsClient(): {sessionId:string;scope?:string;preflight:(path:string,method:AutomationsMethod,body:unknown|undefined,signal:AbortSignal)=>void;request:(path:string,method:AutomationsMethod,body:unknown|undefined,signal:AbortSignal)=>Promise<unknown>} | null {
    const selected=active,session=state.session,generation=epoch;
    if(!selected||!session||(testMocksEnabled&&selected.kind==='cloud'&&!selected.phoneTarget))return null;
    const preflight=(path:string,method:AutomationsMethod,body:unknown|undefined,signal:AbortSignal)=>{
      assertAutomationRequestAllowed(path,method,body);
      if(signal.aborted||generation!==epoch||selected!==active||session!==state.session)throw new AutomationRequestNotDispatchedError('The automation connection changed. Nothing was sent.');
      if(selected.kind!=='resident'&&!hosted)throw new AutomationRequestNotDispatchedError('Your agent runs on this phone. Nothing was sent.');
    };
    return {sessionId:session.sessionId,scope:selected.actions?.scope,preflight,request:async(path,method,body,signal)=>{
      preflight(path,method,body,signal);
      const controller=new AbortController(),bounded=anyAbortSignal([signal,controller.signal]);appRequests.add(controller);
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
      finally{appRequests.delete(controller);}
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
  /** Pre-warm: the resident agent opens its Cloud inference connection with one no-model request
   * (POST /api/cloud/warm) when the owner is about to talk: foreground, chat opened, typing started,
   * Talk, or a new connection while visible. Once per INFERENCE_WARM_INTERVAL_MS; advisory, so a failure is ignored
   * and nothing is retried or scheduled. Skipped while offline, while the resident has no Cloud
   * binding (signed out or a plan notice), and while a turn is in flight, so it never queues
   * ahead of the owner's own request. */
  warmInference(){
    const selected=active,now=Date.now();
    if(selected?.kind!=='resident'||!state.session||now-lastInferenceWarm<INFERENCE_WARM_INTERVAL_MS)return;
    if(sending||state.inferenceOffline||state.residentPlanNotice||(residentCloudFlow()&&!state.cloudAccount))return;
    lastInferenceWarm=now;
    void selected.remote.request('/api/cloud/warm',{},AbortSignal.timeout(10000)).catch(()=>{});
  },
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
  openProviderSettings(){update({open:true,automaticRestore:false,purpose:'provider',error:'',message:''});void connectionController.refreshProviderStatus();},
  open() { update({ open: true, automaticRestore:false, purpose:'agent', error: state.kind === 'recovering' ? state.error : '' }); },
  /** Window online/offline events. Offline retracts readiness and refuses sends to the resident;
   * local apps are untouched. Coming back online clears only the notice. */
  networkChanged(online: boolean) {
    if (online === !state.inferenceOffline) return;
    update({ inferenceOffline: !online });
    if (!online) retractReadiness();
  },
  openCloudAccount(){
    update({open:true,automaticRestore:false,purpose:'cloud-account',membershipDismissed:false,message:'',error:''});
    if(state.cloudAccount)void refreshMembershipBalance();
    // Production Android: whether a Cloud sign-in is kept on this phone decides if the panel offers
    // "Retry saved connection". A local keystore read; no Cloud request and nothing is restored.
    if(residentCloudFlow()&&!state.cloudAccount)void cloudCredentialStore.read(residentEnvironment()).then(credential=>{if(state.open&&state.purpose==='cloud-account'&&!state.cloudAccount)update({residentSavedCredential:!!credential?.credentialId});}).catch(()=>{/* Sign-in stays available. */});
  },
  /** Settings › Eliza Cloud account & plan: the plan panel with Redeem code, Manage plan and Sign out. */
  openPlan({codeEntry=false}:{codeEntry?:boolean}={}){ update({open:true,automaticRestore:false,purpose:'plan',membershipDismissed:false,membershipCodeEntry:codeEntry,message:'',error:'',redeemError:'',redeemNotice:''});if(state.cloudAccount)void refreshMembershipBalance(); },
  refreshMembershipBalance,
  /** The chat's offer after a Cloud billing refusal: the same Subscription sheet while the
   * refusal applies (it closes by itself once Cloud admits the account again), else the plan panel. */
  openFunding(){
    if(!state.cloudAccount||!state.fundingRefused){connectionController.openPlan();return;}
    update({membershipDismissed:false,membershipCodeEntry:false,error:'',redeemError:'',redeemNotice:''});void refreshMembershipBalance();
  },
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
    const inference=state.residentInference==='direct'?'Cerebras · own API key':state.residentInference==='unknown'?'Status unconfirmed':state.residentInference==='cloud'?serviceName:state.residentPlanNotice==='offline'?'Unavailable · Cloud unreachable':state.residentInference==='unavailable'?(account?(view?.kind==='inactive'?'Unavailable · check Cloud account':'Unavailable · Cloud status unconfirmed'):'Unavailable · sign in'):state.kind==='recovering'?'Unavailable · agent not running':'Starting…';
    if(state.residentPlanNotice==='offline'&&!account){const recent=readPlanAdmission();return {signedIn:false,offline:true,account:null,plan:recent?`${recent.planName} · offline`:'Offline',status:recent?.status??null,endsAt:state.planEndsAt??null,allowance:null,limit:null,keyExpiresAt:null,keyExpiring:false,inference};}
    // The plan allowance Cloud reports and the latest Cloud limit with its remaining wait (#410, P-26).
    const summary=account?subscriptionSummary(view,{lastLimit:state.lastServiceLimit??null,lastLimitAt:state.lastServiceLimit?.observedAt??null,serviceName}):null;
    return {signedIn:!!account,offline:false,inference,account:account?(account.email||`Account ${account.userId.slice(0,8)}`):null,
      plan:plan?.headline??(account?'Checking plan…':'Not signed in'),
      status:view?.kind==='active'?view.status:view?.kind==='inactive'?view.status:null,
      endsAt:state.planEndsAt??null,allowance:summary?.allowance??null,limit:summary?.limit??null,keyExpiresAt:expiresAt,keyExpiring:expiresAt!==null&&expiresAt-Date.now()<=CLOUD_KEY_EXPIRY_WARNING_MS};
  },
  // P-43: the resident always exists, so the dialog closes; a start in progress keeps running in the
  // background and Home shows its starting state. Only the Eliza Cloud sign-in that every Alpha
  // Phone needs (signed out, or a sign-in Cloud rejected) keeps the dialog open; the agent runs meanwhile.
  close() {
    // The in-app sign-in screen closes back to where it was opened; a pending attempt is cancelled.
    if(pendingBillingReview){connectionController.cancelBillingReview();return;}
    if(state.cloudAccount&&(state.membershipBalance==='zero'||state.fundingRefused)){update({open:false,purpose:'agent',membershipDismissed:true});return;}
    if(state.signIn){connectionController.cancelSignIn();return;}
    if(residentSignInRequired()){if((state.purpose==='cloud-account'||state.purpose==='plan')&&!state.busy)update({purpose:'agent',message:'',error:'',redeemError:'',redeemNotice:''});return;}
    if (!state.busy || residentStartInBackground || state.residentStarting) {if(state.purpose!=='cloud-account'&&state.purpose!=='plan')clearPersonalSetup();update({ open: false,purpose:'agent',redeemError:'',redeemNotice:'' });}
  },
  cancel() { operation?.abort(new DOMException('Cancelled', 'AbortError')); cloud.cancelLogin();update({membershipCodeEntry:false}); },
  async initialize() {
    if (startup) return startup;
    update({automaticRestore:!state.open});
    startup = (async () => {
      // Attach to the existing host-paired owner before unrelated Cloud discovery or
      // legacy selection migrations. A transient reconnect stays out of the user's way.
      if(privateLocalPreviewEnabled){
        let attached=false;
        await work('Connecting to Alpha…',async signal=>{try{await connectResident(signal);attached=true;}catch(error){if(!active)update({kind:'recovering'});throw error;}},true);
        if(attached)await restoreOptionalBrowserCloudAccount();
        return;
      }
      // A development profile whose account changed is not restored; where the resident is always
      // present, startup continues to it (P-43) instead of leaving no agent.
      if(browserDevProfile){const saved=selection();if(saved?.kind==='development'){if(saved.account!==(await readDevelopmentIdentity(saved.profile)).account){save({kind:'none'});if(!residentAlwaysPresent)return;}else{await work('Restoring development agent…',signal=>connectDevelopment(saved.profile,signal));return;}}}
      if(!await restoreOptionalBrowserCloudAccount())return;
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
  async configureLocal(apiKey:string,model:string=LOCAL_PROVIDER_MODEL,cartesiaKey?:string) { await work('Checking the key with Cerebras…',async signal=>{await configureLocalProvider(apiKey,model,cartesiaKey,signal);signal.throwIfAborted();const providerStatus=await localProviderStatus();signal.throwIfAborted();update({providerStatus,signIn:null,residentPlanNotice:null});showPostSignInSetup();await retire();await connectResident(signal);update({message:isAndroid?'Cerebras key verified and saved in Android Keystore. Own API keys selected.':'Cerebras key verified. Own keys are active for this host session only.'});}); },
  async selectCloudProvider(){await work('Switching to Cloud…',async signal=>{if(browserCloudResidentEnabled)await browserResidentCall('residentCloud',undefined,undefined,undefined,signal);else await clearLocalProvider(false,signal);signal.throwIfAborted();const providerStatus=await localProviderStatus();signal.throwIfAborted();update({providerStatus});await retire();await connectResident(signal);});},
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
  /** Explicit owner action only: obtain a fresh native review before the existing guarded restart. */
  async restartRecovery() {
    if(operation||document.hidden||state.residentRecoveryReason!=='ipc-recovery-retention-limit'||state.session)return;
    const generation=epoch;
    await connectionController.reviewRecovery();
    if(generation!==epoch||document.hidden||operation||state.residentRecoveryReason!=='ipc-recovery-retention-limit'||state.session||state.residentRecovery?.step!=='review')return;
    await connectionController.confirmRecovery();
  },
  cancelRecoveryReview(){if(!operation)update({residentRecovery:undefined});},
  async confirmRecovery() {
    if(operation||state.residentRecoveryReason!=='ipc-recovery-retention-limit'||state.residentRecovery?.step!=='review'||state.session)return;
    const review=state.residentRecovery.review;let archived=false;
    await work('Restarting Alpha…',async signal=>{
      update({residentRecovery:{step:'archiving'}});
      try{
        const result=await archiveLocalRecovery(review.reviewToken);signal.throwIfAborted();
        if(result.status!=='archived'||result.retainedCount!==0||result.archivedCount!==review.retainedCount){update({message:'',residentRecovery:{step:result.status==='partial'?'partial':'unavailable'}});return;}
        archived=true;update({residentRecoveryReason:undefined,residentRecovery:undefined,error:'',message:'Restarting Alpha…'});
      }catch(error){update({residentRecovery:{step:'unavailable'}});throw error;}
    });
    if(archived)await connectionController.startLocal();
  },
  async restoreSavedSignIn() {
    if(!isAndroid||!residentCloudFlow()||residentEnvironment()!=='production'||(state.signIn&&state.signIn.environment!=='production')||operation||state.cloudAccount||!cloudSignIn?.restoreSavedSignIn)return;
    await work('Restoring saved sign-in…',async signal=>{
      signal.throwIfAborted();
      const cancel=()=>{void cloudSignIn!.cancel().catch(()=>{});};
      signal.addEventListener('abort',cancel,{once:true});
      try{
        const outcome=await cloudSignIn!.restoreSavedSignIn!();signal.throwIfAborted();
        if(outcome.restored!==true)throw Error('Saved sign-in is no longer available. Sign in to continue.');
        update({legacySignInRecovery:false,residentSavedCredential:true,signIn:null});
      }finally{signal.removeEventListener('abort',cancel);}
      if(state.residentRecoveryReason){update({open:true,purpose:'agent',error:residentRecoveryMessage(state.residentRecoveryReason)});return;}
      // Keep the same owned operation through normal admission. Releasing busy/operation
      // between the native commit and this start lets automatic chooser readiness steal it.
      retire();
      await connectResident(signal);
    });
    if(residentAlwaysPresent&&!active&&state.kind==='starting')update({kind:'recovering'});
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
  async beginSignIn(environment: CloudEnvironment = residentCloudFlow() ? residentEnvironment() : cloud.environment, refreshNegative = true, automatic = false) {
    if (operation || !cloudEnvironmentAllowed(environment)) return;
    // An automatic readiness probe must not erase why the saved sign-in was refused.
    // A new attempt explicitly started by the owner still clears the earlier error.
    // Readiness may take six seconds on a fresh install. Keep that wait cancellable and prevent
    // repeated taps from starting competing probes or opening a browser after the owner cancelled.
    const readinessEpoch = epoch;
    let chooser: SignInView | null = null, probeSignal: AbortSignal | undefined;
    let lateMethods: NonNullable<ReturnType<typeof signInReadiness>> | null = null;
    const adoptLate = () => {
      if (!lateMethods || !probeSignal || probeSignal.aborted || signInReadinessOwner !== probeSignal
        || epoch !== readinessEpoch || operation || !state.open || state.cloudAccount
        || !chooser || state.signIn !== chooser || chooser.step !== 'choose'
        || chooser.environment !== environment || cloud.environment !== environment) return;
      inAppGoogle = lateMethods.google; inAppPhone = lateMethods.phone; inAppEmail = lateMethods.email;
      lateMethods = null;
      update({});
    };
    await work(`Checking ${cloudServiceName(environment)} sign-in…`, async signal => {
      probeSignal = signal; signInReadinessOwner = signal;
      const methods = await inAppSignInMethods(environment, signal, refreshNegative, ready => { lateMethods = ready; adoptLate(); });
      signal.throwIfAborted();
      // Email stays inside Alpha even when readiness is unavailable. Its native request
      // reports the actual failure; missing Google/App Link setup never opens hosted login.
      if (!cloudSignIn) throw new CloudSignInError('unavailable');
      inAppGoogle = methods?.google === true;
      inAppPhone = methods?.phone === true;
      inAppEmail = methods === null || methods.email !== false;
      if (cloud.environment !== environment) cloud = makeCloud(environment);
      cloud.cancelLogin();
      chooser = { step: 'choose', environment };
      update({ open: true, ...(residentCloudFlow() && state.purpose !== 'cloud-account' ? { purpose: 'agent' as const } : {}), signIn: chooser, message: '' });
    }, false, false, automatic);
    adoptLate();
    // Readiness does not stop the agent and must not retry a blocked startup.
    if (!automatic) await ensureResident();
  },
  /** Leaves the sign-in screen for the chooser and burns the pending attempt. Stored sign-in stays unchanged. */
  cancelSignIn() {
    const view = state.signIn;
    const pending = !!operation;
    // Back on the required top-level chooser has nowhere to go; keep its controls usable.
    if (!pending && view?.step === 'choose' && productionCloudSignInRequired(state)) return;
    const closeExplicitEntry=!pending&&(!view||view.step==='choose')&&explicitSignedOutCloudEntry(state);
    connectionController.cancel();
    update({ signIn: view && (pending || view.step !== 'choose') ? { step: 'choose', environment: view.environment } : null, message: '', error: '' });
    if(closeExplicitEntry)connectionController.close();
  },
  /** Google's external browser flow, followed by the existing native session exchange. */
  async signInGoogle() {
    const view = state.signIn; if (!view) return;
    await work('Choose your Google account to sign in to Alpha.', async signal => {
      update({ signIn: { step: 'google', environment: view.environment } });
      const client = signInClient(view.environment);
      let outcome: CloudSignInGoogleOutcome;
      try { outcome = await client.signInWithGoogle(signal); signal.throwIfAborted(); }
      catch (error) { signal.throwIfAborted(); signInFailed(view.environment); throw error; }
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
      const started = await signInClient(view.environment).startEmailSignIn(address, signal).catch(error => { signal.throwIfAborted(); throw error; });
      signal.throwIfAborted();
      update({ signIn: { step: 'code', environment: view.environment, email: address, ...started }, message: `We sent a six-digit code to ${address}. Enter it here.` });
    });
    if (state.error && state.signIn?.step !== 'code') update({ signIn: { step: 'choose', environment: view.environment } });
  },
  async signInPhone(phone: string) {
    const view = state.signIn; if (!view || !cloudSignInPhone || !inAppPhone) return;
    const number = phone.trim();
    if (!validSignInPhone(number)) { update({ error: signInFailureMessage('invalid-phone') }); return; }
    await work('Sending your code…', async signal => {
      const started = await signInClient(view.environment).startPhoneSignIn(number, signal);
      update({ signIn: { step: 'code', environment: view.environment, email: '', phone: number, ...started }, message: `We sent a six-digit code to ${number}. Enter it here.` });
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
          signal.throwIfAborted();
          if (codeOutcome.status === 'mfa') {
            signInFailed(view.environment, true);
            update({ signIn: { step: 'mfa', environment: view.environment, email: view.email, attemptId: view.attemptId, method: codeOutcome.method, expiresAt: codeOutcome.expiresAt },
              message: codeOutcome.method === 'totp' ? 'Enter the six-digit code from your authenticator app.' : codeOutcome.method === 'sms' ? 'Enter the six-digit code sent to your phone.' : '' });
            if (codeOutcome.method === 'passkey') throw new CloudSignInError('mfa-unsupported');
            return;
          }
          outcome = codeOutcome;
        }
      } catch (error) {
        signal.throwIfAborted();
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
   * Product bundles fold it away (`cloudSignInHandOffAvailable`): the in-app sign-in is the only path.
   */
  async signInBrowser(environment: CloudEnvironment = state.signIn?.environment ?? (residentCloudFlow() ? residentEnvironment() : cloud.environment)) {
    if (operation) return;
    if (!cloudSignInHandOffAvailable) { update({ open: true, error: signInFailureMessage('unavailable'), message: '' }); return; }
    else {
    update({ signIn: null });
    if (residentCloudFlow()) await connectionController.residentBrowserLogin();
    else await connectionController.browserCloudLogin(environment);
    }
  },
  async residentBrowserLogin() {
    if (!cloudSignInHandOffAvailable) { update({ open: true, error: signInFailureMessage('unavailable'), message: '' }); return; }
    else {
    await work(`Opening ${cloudServiceName(cloud.environment)} sign-in…`, residentBrowserLoginAction);
    // A cancelled or failed sign-in never leaves the phone without its agent (P-43).
    await ensureResident();
    }
  },
  /** The hosted browser has its own login. Review the intended Alpha account before opening it. */
  async residentManagePlan() {
    if(operation)return;
    const account=service;
    if(!account?.identity.email){update({open:true,error:'Check your Alpha account email before opening billing.'});return;}
    pendingBillingReview={account,open:state.open,purpose:state.purpose};
    update({open:true,automaticRestore:false,billingReviewEmail:account.identity.email,error:'',message:''});
  },
  cancelBillingReview(){
    if(operation)return;const review=pendingBillingReview;pendingBillingReview=null;
    update({billingReviewEmail:undefined,...(review?{open:review.open,purpose:review.purpose}:{})});
  },
  async openReviewedBilling(){
    const review=pendingBillingReview;
    if(operation||!review)return;
    if(service!==review.account||state.billingReviewEmail!==review.account.identity.email){pendingBillingReview=null;update({billingReviewEmail:undefined,error:'Your Alpha account changed. Review billing again.'});return;}
    await work('Opening billing…',async signal=>{
      if(service!==review.account||pendingBillingReview!==review)throw Error('Your Alpha account changed. Review billing again.');
      await review.account.client.openSubscriptionManagement(signal);
      signal.throwIfAborted();
      if(service!==review.account||pendingBillingReview!==review)throw Error('Your Alpha account changed. Review billing again.');
      pendingBillingReview=null;planManagementReturn=true;
      update({billingReviewEmail:undefined,open:review.open,purpose:review.purpose,message:`Before paying, check the billing page is signed in as ${review.account.identity.email}. Subscription changes apply to the account shown in the browser.`});
    });
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
      // A redeemed code changes the plan: an earlier limit (a used-up allowance) no longer describes it.
      update({planEndsAt:result.planEndsAt,lastServiceLimit:null,fundingRefused:false});
      update({redeemNotice:redeemSuccessMessage(result)});
      const endsAt=result.planEndsAt;
      // Bind Eliza Cloud inference into the agent: attaches when the process already matches,
      // otherwise a clean restart. Conversation history stays in the agent and is restored.
      const notice=state.redeemNotice;
      if(residentCloudFlow()){retire();try{await connectResident(signal);}catch(error){if(residentAlwaysPresent&&!active)update({kind:'recovering'});throw error;}}
      else {await verifyService(account.client,signal);if(service?.identity.credentialId!==account.identity.credentialId||service.identity.userId!==account.identity.userId||service.identity.organizationId!==account.identity.organizationId||service.identity.environment!==account.identity.environment||service.credentialReference!==account.credentialReference)throw Error('Cloud account changed. Sign in again.');}
      await refreshMembershipBalance();
      if(endsAt!==null){const record=readPlanAdmission();if(record&&record.credentialId===account.identity.credentialId){writePlanAdmission({...record,endsAt});update({planEndsAt:endsAt});}}
      // The code was redeemed from the plan panel: show its outcome there beside the running agent.
      if(!state.error)update({open:true,purpose:'plan',redeemNotice:notice,message:''});
    });
    return redeemed;
  },
  /** Checks the plan again after the owner returns from Eliza Cloud (resume or visibility). */
  recheckPlanOnReturn(explicit=false) {
    if(!residentCloudFlow()||operation||sending||state.busy||state.residentRecoveryReason)return;
    const now=Date.now();
    if(!explicit&&!planManagementReturn&&now-lastPlanRecheck<PLAN_RECHECK_INTERVAL_MS)return;
    planManagementReturn=false;lastPlanRecheck=now;
    if(ownProviderSelected()){void restoreOwnProviderCloudServices();return;}
    // Without bound Cloud inference (no plan, offline, signed out) or without a running agent, the
    // account and plan are read again; the agent is rebound or restarted only when that changes.
    if(!state.session||residentBinding!=='cloud'){void recheckResidentPlan();return;}
    entitlementRefresher?.refreshNow();
  },
  /**
   * A Cloud limit seen outside a chat turn (a Cloud speech 429, cloud-voice.ts) becomes the account
   * panel's latest limit with its retry time, the same record a refused turn writes. Only for the
   * Cloud session the request was made with; a late refusal for an earlier account is dropped.
   */
  noteCloudServiceLimit(limit: ServiceLimit | null, sessionId: string | undefined) {
    if(!limit||!sessionId||!service||service.identity.sessionId!==sessionId)return false;
    update({lastServiceLimit:{...limit,observedAt:Date.now()}});return true;
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
    if (!cloudSignInHandOffAvailable) { update({ open: true, error: signInFailureMessage('unavailable'), message: '' }); return; }
    else await work(`Opening ${cloudServiceName(cloud.environment)} sign-in…`, signal => browserCloudLoginAction(environment, signal));
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
        if(residentBindable()&&!ownProviderSelected())try{await clearLocalProvider();residentBinding='unbound';update({residentInference:'unavailable'});}catch{/* Retried by the restart below, which reports an unconfirmed removal. */}
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
      update({ agents: [], residentSavedCredential:false, ...(residentCloudFlow()?{purpose:'agent' as const}:{}), message, signOutNotice:message });
      // The agent keeps running: reconnected (or restarted) without Cloud inference, and the
      // sign-in dialog asks for an account again.
      // A cancelled sign-out still removed the local key above; the agent is then started by the queued rebind.
      if(residentCloudFlow()){if(signal.aborted)residentRebinds().queue();else{retire();try{await connectResident(signal);}catch(error){if(residentAlwaysPresent&&!active)update({kind:'recovering'});throw error;}update({message,open:true,...(state.residentInference==='unknown'?{error:RESIDENT_UNBIND_UNCONFIRMED}:{})});}}
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
  async restoreHistory(id: string, canCommit?:()=>boolean) {
    if (sending) { update({ error: 'Wait for the current reply before restoring history.' }); return; }
    await work('Verifying and restoring conversation…',async signal=>{
      try{await restoreConversationHistory(id,signal,false,false,undefined,canCommit);}
      catch(error){if(canCommit&&!canCommit()&&error instanceof DOMException&&error.name==='AbortError')return;throw error;}
    },!!canCommit);
  },
  async retrySavedHistory(){if(sending)return;await work('Checking saved conversation…',signal=>restoreSavedHistory(signal));},
  messageTargetCurrent(target:ConversationMessageTarget) {
    return !!active&&!!state.session&&!state.open&&!state.busy&&!sending&&!operation&&validateUuid(target.messageId)&&target.conversationId===conversationMemory.get(conversationKey(state.session))&&JSON.stringify(target.session)===JSON.stringify(state.session);
  },
  canEditMessages(){return !!active&&active.kind!=='cloud';},
  async truncateMessage(target:ConversationMessageTarget):Promise<void> {
    if(!this.messageTargetCurrent(target)||target.from!=='user'||!active||active.kind==='cloud'||document.hidden)throw Error('This message cannot be edited in the current connection.');
    const selected=active,session=state.session!,generation=epoch,controller=new AbortController(),contextKey=JSON.stringify(navigationContext?.());signInReadinessOwner=null;operation=controller;update({busy:true});let dispatched=false;
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
    if(!ownProviderSelected()&&state.cloudAccount&&state.membershipBalance==='zero')throw fundingNeeded();
    if(operation||sending||state.open||state.busy||document.hidden)throw Error('Finish the current connection or conversation operation first.');
    const selected=active,session=state.session,generation=epoch;
    if(!selected||!session)throw noSessionError(NO_AGENT_VOICE);
    if((selected.kind==='remote'||selected.kind==='local')&&(!selected.remote.session||selected.remote.session.expiresAt<=Date.now()))throw Error('Your session expired. Pair again before starting voice.');
    const controller=new AbortController(),cancel=()=>controller.abort(signal.reason);signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();signInReadinessOwner=null;operation=controller;
    const current=()=>{controller.signal.throwIfAborted();if(document.hidden||state.open||generation!==epoch||selected!==active||JSON.stringify(state.session)!==JSON.stringify(session))throw Error('The voice conversation changed.');};
    try{current();const conversationId=await ensureSelectedConversation(selected,session,controller.signal,current);current();return {conversationId,session:{...session},connectionEpoch:generation};}
    finally{signal.removeEventListener('abort',cancel);if(operation===controller)operation=null;}
  },
  async send(text: string, context: ContextEnvelope, requestId: string, signal: AbortSignal, onText?:(text:string)=>void,replyTo?:ConversationMessageTarget,onReplyReady?:(results:readonly unknown[]|undefined)=>void,channelType:ChatChannel='DM',expectedConversationId?:string,voiceTurnSignal?:VoiceTurnSignal): Promise<{ messageId?:string;userMessageId?:string;messageBinding?:{conversationId:string;session:VerifiedSession};text: string; proposals?: ActionProposal[]; actionResults?:readonly unknown[]; planAction?: 'plan' | 'retry' | 'sign-in' }> {
    if(!ownProviderSelected()&&state.cloudAccount&&state.membershipBalance==='zero')throw fundingNeeded();
    // P-43: before the resident has a session, say it is starting (or recovering); nothing is sent.
    if (!active && residentAlwaysPresent) throw noSessionError('');
    if (operation) throw new Error('Finish the connection or history operation before sending.');
    if(replyTo&&!this.messageTargetCurrent(replyTo))throw Error('The reply target belongs to a different conversation.');
    const authoredRequestText=text;
    let message = phoneContextMessage(text,{...context,calendarDay:undefined});
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
      // Hosted inference needs the network. Nothing leaves the phone while it reports none.
      if (selected.kind === 'resident' && isAndroid && (state.inferenceOffline || navigator.onLine === false)) throw new Error(INFERENCE_OFFLINE_NOTICE);
      if (selected.kind === 'remote' || selected.kind === 'local') {
        if (!selected.remote.session || selected.remote.session.expiresAt <= Date.now()) throw Object.assign(new Error('Your session has expired. Pair again.'), { code: 'session_expired' });
      }
      const assertCurrent=()=>{requestSignal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId||(expectedConversationId!==undefined&&conversationMemory.get(conversationKey(session))!==expectedConversationId))throw Error('The connection or conversation changed.');};
      const observationSession=clientObservationSession;
      // Legacy text/alphaPhone projections remain day-free; plain-v1 alone never admits the field.
      if(context.calendarDay&&selected.userTextFormatVersion===1&&observationSession){
        const admitted=await observationSession.context(context,requestSignal);assertCurrent();
        message=phoneContextMessage(text,admitted);
      }
      const id=await ensureSelectedConversation(selected,session,requestSignal,assertCurrent);
      if(expectedConversationId!==undefined&&id!==expectedConversationId)throw Error('The voice conversation changed.');
      if(replyTo&&(!validateUuid(replyTo.messageId)||replyTo.conversationId!==id||JSON.stringify(replyTo.session)!==JSON.stringify(session)))throw Error('The reply target belongs to a different conversation.');
      if(replyTo){const history=selected.kind==='cloud'?await selected.cloud.messages(selected.agentId,id,requestSignal):await selected.remote.messages(id,requestSignal);assertCurrent();const row=history.messages.find(row=>row.id===replyTo.messageId);if(!row||row.role!==(replyTo.from==='user'?'user':'assistant')||typeof row.text!=='string'||(replyTo.from==='user'?restoredText(row.text,row.userTextFormat):row.text)!==replyTo.text)throw Error('The reply target changed. Reload its conversation before replying.');}
      // Verified peers negotiate the same canonical request format on browser
      // and Android. The legacy text envelope is a development compatibility surface:
      // only test-mocks builds send it to an unnegotiated peer. A product build sends the authored
      // text; the observation travels only in metadata, never as a client-authored banner.
      const canonicalProse=selected.userTextFormatVersion===1;
      const wireText=canonicalProse||!testMocksEnabled?text:message.text;
      const actionPreferences=await readDevicePreferences(requestSignal).catch(()=>{requestSignal.throwIfAborted();return {askBeforeAgentActions:true};});assertCurrent();
      const directRequestedActions=!actionPreferences.askBeforeAgentActions;
      const calendarAgendaSource=!message.context.sensitive&&selected.actions?await calendarAgendaObservation(selected.actions,message.context,assertCurrent):undefined;
      requestSignal.throwIfAborted();assertCurrent();
      await boundNavigation()?.observeCommittedView(true);
      requestSignal.throwIfAborted();assertCurrent();
      const options = { signal: requestSignal, clientMessageId: requestId, channelType, metadata: { ...(directRequestedActions?{agentActionMode:'direct-request-v1'}:{}), ...(channelType==='VOICE_DM'&&voiceTurnSignal?{voiceTurnSignal}:{}), ...(replyTo?{replyToMessageId:replyTo.messageId}:{}), ...(message.context.timeZone===undefined?{}:{uiTimeZone:message.context.timeZone}), clientDevice: { context: message.context,...(calendarAgendaSource?{calendarAgendaSource:{sourceId:calendarAgendaSource.sourceId,sourceRevision:calendarAgendaSource.sourceRevision}}:{}) }, ...boundNavigation()?.metadata(context), ...(canonicalProse?{userTextFormat:'plain-v1'}:{alphaPhone:{context:message.context}}) } };
      dispatched = { conversationId: id, at: Date.now() };
      const progress=(value:string)=>{requestSignal.throwIfAborted();if(generation!==epoch||selected!==active||state.session?.sessionId!==session.sessionId)throw Error('The connection changed.');onText?.(value);};
      const replyReady=(results:readonly unknown[]|undefined)=>{assertCurrent();onReplyReady?.(results);};
      const reply = selected.kind === 'cloud' ? await selected.cloud.send(selected.agentId, id, wireText, options) : selected.kind==='resident'?await withResidentMapsNavigation(selected.request,id,requestSignal,()=>selected.remote.send(id,wireText,{...options,onText:progress,onReplyReady:replyReady})):await selected.remote.send(id, wireText, options);
      requestSignal.throwIfAborted();
      assertCurrent();
      // Action callbacks (calendar receipts, approval cards) commit rows outside the streamed reply;
      // the deferred update after this send re-reads the conversation.
      if('historyRefreshRequired' in reply&&reply.historyRefreshRequired===true)conversationResync=true;
      if(channelType==='VOICE_DM' && (('interrupted' in reply && reply.interrupted===true)||('noResponseReason' in reply && reply.noResponseReason==='ignored')))throw Error('The voice response did not complete. Check conversation history before speaking again.');
      let responseFailure: Error | undefined;
      const failed = ('interrupted' in reply && reply.interrupted===true) || ('failureKind' in reply && !!reply.failureKind) || ('terminalFailure' in reply && !!reply.terminalFailure);
      const effectApplied=failed&&effectAppliedBeforeFailure(reply);
      // A completed Calendar read can truthfully fail its coverage guard. Its
      // visible answer and durable message identity remain usable; this is not
      // a transport failure and must not gain a retry prompt or extra card.
      const calendarFailure = 'terminalFailure' in reply && reply.terminalFailure && typeof reply.terminalFailure === 'object' ? reply.terminalFailure as {kind?:unknown;code?:unknown;transient?:unknown} : undefined;
      const visibleCalendarFailure = calendarFailure?.kind === 'reply_generation_error' && calendarFailure.transient === false && isCalendarReadFailureCode(calendarFailure.code) && (!('failureKind' in reply) || reply.failureKind === undefined || reply.failureKind === 'reply_generation_error') && typeof reply.text === 'string' && !!reply.text.trim() && !('interrupted' in reply && reply.interrupted === true);
      // The on-device agent answered without Eliza Cloud inference (no plan, offline or signed
      // out): its turn is recorded in the conversation, and the owner gets an honest answer with
      // the plan actions instead of a generic failure. Nothing is retried or purchased.
      if (failed && selected.kind === 'resident' && !ownProviderSelected() && residentCloudFlow() && (state.residentInference === 'unavailable' || ('failureKind' in reply && reply.failureKind === 'no_provider' && state.residentInference !== 'cloud'))) {
        const notice = state.residentPlanNotice ?? null, signedIn = !!state.cloudAccount;
        return { text: inferenceUnavailableReply(notice, signedIn), planAction: notice === 'offline' ? 'retry' : signedIn ? 'plan' : 'sign-in', ...(typeof reply.messageId === 'string' && validateUuid(reply.messageId) ? { messageId: reply.messageId } : {}), ...(typeof reply.userMessageId === 'string' && validateUuid(reply.userMessageId) ? { userMessageId: reply.userMessageId } : {}), messageBinding: { conversationId: id, session: { ...session } } };
      }
      if (failed && !visibleCalendarFailure) {
        // Cloud's own refusal (rate limit, used allowance, no active plan) carries its retry
        // information; the phone presents it and never retries, upgrades or buys anything.
        // A structured period-allowance reset (`resetAt`, ISO 8601) or wait (`retryAfterSeconds`)
        // on the failed turn is read like a direct HTTP refusal's; absent, nothing is invented.
        const timing = reply as { resetAt?: unknown; retryAfterSeconds?: unknown };
        responseFailure = replyFailure(failureKindOf(reply)??('interrupted' in reply&&reply.interrupted===true?'interrupted':undefined), selected, readServiceLimit({ failureKind: 'failureKind' in reply ? reply.failureKind : undefined, terminalFailure: 'terminalFailure' in reply ? reply.terminalFailure : undefined, resetAt: timing.resetAt, retryAfterSeconds: timing.retryAfterSeconds }));
        // The turn failed after its action committed (a calendar event exists, say): the owner is
        // told the action went through and the reply was cut off. A mapped provider or Cloud limit
        // keeps its own retry information after that; the generic and plain interrupted texts do not.
        if(effectApplied){const mapped=responseFailure instanceof AlphaClientError?responseFailure as AlphaClientError&{failureKind?:unknown;serviceLimit?:unknown;planAction?:unknown}:undefined;responseFailure=Object.assign(new AlphaClientError('transport-failed',mapped&&mapped.failureKind!=='interrupted'?`${EFFECT_APPLIED_INTERRUPTED} ${mapped.message}`:EFFECT_APPLIED_INTERRUPTED),{failureKind:typeof mapped?.failureKind==='string'?mapped.failureKind:failureKindOf(reply)??'interrupted'},mapped?.serviceLimit===undefined?{}:{serviceLimit:mapped.serviceLimit},mapped?.planAction===undefined?{}:{planAction:mapped.planAction});}
        if ('failureKind' in responseFailure) retractReadiness();
      }
      for(const key of ['messageId','userMessageId'] as const)if(reply[key]!==undefined&&!validateUuid(reply[key]))throw Error('The agent returned an invalid message identity.');
      if (typeof reply.text !== 'string') throw new Error('The agent returned an invalid response.');
      let proposals: ActionProposal[] | undefined, notices: string[] = [];
      const completedReads:NonNullable<AgentReply['completedReads']>=[];
      const completedActions:OperationReceipt[]=[];
      if (selected.actions) {
        // A pending action that does not fit this screen, time zone or negotiated support is
        // named to the owner instead of being dropped; it stays unapprovable.
        try { const authoredRequest=typeof reply.userMessageId==='string'&&validateUuid(reply.userMessageId)?{messageId:reply.userMessageId,text:authoredRequestText,current:assertCurrent}:undefined;
          let items = await selected.actions.pendingReview(context, requestSignal,authoredRequest);
          if(!failed&&directRequestedActions&&typeof reply.userMessageId==='string'&&validateUuid(reply.userMessageId)){
            const performed=await selected.actions.performRequested(reply.userMessageId,context,requestSignal,async()=>!(await readDevicePreferences(requestSignal)).askBeforeAgentActions,undefined,authoredRequest);
            // Publish existing outcomes before self-navigation's cancelled foreground wait.
            deliverRequestedActionReceipts(selected,session,generation,id,reply.userMessageId,performed,items);
            assertCurrent();
            if(performed.length){
              completedActions.push(...performed);
              for(const receipt of performed){const proposal=items.find(item=>item.proposal?.id===receipt.proposalId)?.proposal;if(receipt.status==='succeeded'&&receipt.readReply&&proposal?.readReply)completedReads.push({proposal,receipt});}
              items=await selected.actions.pendingReview(message.context,requestSignal,authoredRequest);
            }
          }
          // A pending action joins the first reply after it appears; later replies do not repeat it.
          const shown=announcedProposals.get(selected.actions)??new Set<string>();announcedProposals.set(selected.actions,shown);
          const turnItems=items.filter(item=>!item.proposalId||!shown.has(item.proposalId));for(const item of items)if(item.proposalId)shown.add(item.proposalId);
          proposals = turnItems.flatMap(item => item.proposal ? [item.proposal] : []); notices.push(...turnItems.flatMap(item => item.notice ? [item.notice.slice(0, 500)] : []));notices=[...new Set(notices)].slice(0,5); }
        catch { update({ message: 'Reply received. Phone action proposals could not be checked; use action history.' }); }
      }
      requestSignal.throwIfAborted();
      assertCurrent();
      // These events refresh records only. A later reply failure cannot undo a recorded effect.
      for(const invalidation of appRecordInvalidations(reply.actionResults))window.dispatchEvent(new CustomEvent(invalidation.event,{detail:{sessionId:session.sessionId,...(invalidation.revision===undefined?{}:{revision:invalidation.revision})}}));
      // The agent recorded the user turn even when the reply failed: its identity rides on the
      // failure so the sent bubble adopts it, and a later conversation re-read merges onto that
      // bubble instead of adding a second copy. The failed assistant row keeps the phone's own text.
      const messageBinding={conversationId:id,session:{...session}},recorded=typeof reply.userMessageId==='string'?{userMessageId:reply.userMessageId,messageBinding}:{};
      // A failed reply can follow a durably recorded proposal. Recover only the
      // existing identity/context-bound review; never retry chat or execute it.
      if (responseFailure && !proposals?.length) throw Object.assign(responseFailure,recorded);
      if(!failed&&directRequestedActions&&message.context.view==='home'&&cameraNavigation&&cameraAttempt&&typeof reply.userMessageId==='string'&&Array.isArray(reply.actionResults)){
        requestedCameraContinuation={messageId:reply.userMessageId,selected,session,generation,conversationId:id,client:cameraNavigation,attempt:cameraAttempt,expiresAt:Date.now()+30_000};
      }
      if(!failed&&automationsCommitted(reply.actionResults))window.dispatchEvent(new CustomEvent(AUTOMATIONS_COMMITTED_EVENT,{detail:{sessionId:session.sessionId}}));
      // A reply that got through means the last Cloud limit no longer applies.
      if(!failed&&(state.lastServiceLimit||state.fundingRefused))update({lastServiceLimit:null,fundingRefused:false});
      return { text: responseFailure
        ? `${responseFailure.message} Pending phone actions are available for separate review.${effectApplied?'':' Nothing has been approved or performed automatically.'}`
        : reply.text, ...(completedReads.length?{completedReads}:{}), ...(completedActions.length?{completedActions}:{}), ...(notices.length ? { notices } : {}), ...(!responseFailure?{...(typeof reply.messageId==='string'?{messageId:reply.messageId}:{}),messageBinding}:{}), ...recorded, ...(proposals ? { proposals } : {}), ...(!failed&&Array.isArray(reply.actionResults)?{actionResults:reply.actionResults}:{}) };
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
      if (refused && error && typeof error === 'object' && 'status' in error && error.status === 403) {
        const failure=Object.assign(new AlphaClientError('transport-failed','The agent did not accept this message. Your draft is saved. Check its connection before trying again.'),{refusedBeforeTurn:true});
        mark(failure);throw failure;
      }
      if (error && typeof error === 'object' && 'status' in error && error.status === 429) {
        // A limit on the request itself is also the account panel's latest Cloud limit, with its retry time.
        const limit = refused ? null : readServiceLimit(error);
        if (limit) update({ lastServiceLimit: { ...limit, observedAt: Date.now() } });
        const limited = refused ? Object.assign(new AlphaClientError('transport-failed', 'The agent is busy and did not accept this message. Wait, then send it again.'), { refusedBeforeTurn: true }) : new AlphaClientError('transport-failed', serviceLimitMessage(limit, Date.now(), cloudServiceName(cloud.environment)));
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
    } finally { signal.removeEventListener('abort', cancel); if (sending === controller) { sending = null; /* Let the caller commit this reply before a deferred plan rebind. */ setTimeout(()=>{update({});runQueuedResidentRebind();},0); } }
  },
};

// A Google sign-in that native finished after Alpha restarted arrives as a retained event.
if (cloudSignIn?.addListener) Promise.resolve(cloudSignIn.addListener('signInCompleted', outcome => { void connectionController.signInReturned(outcome); })).catch(() => { /* No retained return. */ });
if (cloudSignIn?.addListener) Promise.resolve(cloudSignIn.addListener('signInMfaRequired', outcome => { void connectionController.signInReturned(outcome); })).catch(() => { /* No retained challenge. */ });
if (cloudSignIn?.addListener) Promise.resolve(cloudSignIn.addListener('signInIncomplete', value => { connectionController.signInIncomplete(value); })).catch(() => { /* No retained return. */ });
export function productionCloudSignInRequired(snapshot: Pick<ConnectionSnapshot,'cloudAccount'|'error'>&Partial<Pick<ConnectionSnapshot,'startupResolved'|'residentSavedCredential'|'residentPlanNotice'|'providerStatus'>>): boolean {
  // A null account before saved-session restoration finishes is not signed out.
  // Do not let the automatic readiness probe compete with that restoration.
  if(ownProviderSelected(snapshot))return false;
  if(snapshot.startupResolved===false&&!snapshot.error)return false;
  // Unreachable identity is unverified, not signed out. Local use stays available;
  // admission still leaves Cloud inference unbound or under its existing grace rule.
  const retainedOfflineIdentity=!snapshot.cloudAccount&&snapshot.residentSavedCredential===true&&snapshot.residentPlanNotice==='offline'&&!snapshot.error;
  return isAndroid&&!testMocksEnabled&&!retainedOfflineIdentity&&(!snapshot.cloudAccount||snapshot.error===errorMessage({status:401})||(snapshot.cloudAccount.expiresAt!==undefined&&snapshot.cloudAccount.expiresAt<=Date.now()));
}
/** Explicit account/plan and settled first-sign-in entries use Alpha's existing sign-in screen. */
export function explicitSignedOutCloudEntry(
  snapshot: Pick<ConnectionSnapshot,'open'|'cloudAccount'|'purpose'> &
    Partial<Pick<ConnectionSnapshot,'startupResolved'|'residentSavedCredential'|'residentStarting'|'residentRecoveryReason'|'residentPlanNotice'|'providerStatus'|'error'>>,
): boolean {
  // Browser resident previews use the same approved form, without imposing Android's
  // required-sign-in policy or replacing genuine restore/offline/recovery controls.
  const firstBrowserResidentSignIn =
    !isAndroid && browserCloudResidentEnabled && snapshot.purpose==='agent' &&
    snapshot.startupResolved===true && snapshot.residentSavedCredential===false &&
    !snapshot.residentStarting && !snapshot.residentRecoveryReason &&
    snapshot.residentPlanNotice!=='offline' && !snapshot.error;
  if(ownProviderSelected(snapshot)&&snapshot.purpose==='agent')return false;
  return snapshot.open&&!snapshot.cloudAccount&&(
    snapshot.purpose==='cloud-account'||snapshot.purpose==='plan'||firstBrowserResidentSignIn
  );
}
export function connectionChooserVisible(snapshot: Pick<ConnectionSnapshot,'open'|'automaticRestore'|'busy'|'error'>&Partial<Pick<ConnectionSnapshot,'cloudAccount'|'purpose'|'signIn'|'membershipBalance'|'fundingRefused'|'billingReviewEmail'|'membershipDismissed'|'startupResolved'|'residentSavedCredential'|'residentPlanNotice'|'providerStatus'>>,foregroundReply=false): boolean {
  if(snapshot.billingReviewEmail)return true;
  if(!ownProviderSelected(snapshot)&&snapshot.cloudAccount&&!snapshot.membershipDismissed&&(snapshot.membershipBalance==='zero'||snapshot.fundingRefused)&&!foregroundReply)return true;
  if(isAndroid&&!testMocksEnabled&&'cloudAccount' in snapshot){
    if(productionCloudSignInRequired({cloudAccount:snapshot.cloudAccount??null,error:snapshot.error,startupResolved:snapshot.startupResolved,residentSavedCredential:snapshot.residentSavedCredential,residentPlanNotice:snapshot.residentPlanNotice,providerStatus:snapshot.providerStatus}))return true;
    // Agent state and controls live in Settings, never in an automatic sheet.
    if(!snapshot.signIn&&snapshot.purpose!=='cloud-account'&&snapshot.purpose!=='plan'&&snapshot.purpose!=='provider')return false;
  }
  return snapshot.open && !(snapshot.automaticRestore && snapshot.busy && !snapshot.error);
}
export function ConnectionChooser() {
  const snapshot = useSyncExternalStore(connectionController.subscribe, connectionController.getSnapshot);
  // Production Android always enters through sign-in while signed out.
  // Only the explicit test-mocks build retains developer bypass behavior.
  const productionSignInRequired=productionCloudSignInRequired(snapshot);
  const explicitSignInEntry=explicitSignedOutCloudEntry(snapshot);
  const signInEntryRequired=snapshot.purpose!=='provider'&&(productionSignInRequired||explicitSignInEntry);
  const automaticSignInProbe = useRef(false);
  useEffect(() => {
    if (!signInEntryRequired) { automaticSignInProbe.current = false; return; }
    if (snapshot.signIn) { automaticSignInProbe.current = false; return; }
    if (automaticSignInProbe.current || snapshot.busy || snapshot.startupResolved===false || snapshot.automaticRestore) return;
    automaticSignInProbe.current = true;
    // Readiness only: neither email nor Google starts until the owner chooses it.
    // Automatic probes preserve a genuine saved-sign-in or startup refusal.
    void connectionController.beginSignIn(residentEnvironment(), false, true);
  }, [signInEntryRequired, snapshot.busy, snapshot.signIn, snapshot.startupResolved, snapshot.automaticRestore]);
  useEffect(()=>{
    if(!isAndroid||!signInEntryRequired||(snapshot.signIn?.environment??residentEnvironment())!=='production'||snapshot.cloudAccount||!cloudSignIn?.savedSignInRecoveryStatus)return;
    let current=true;
    void cloudSignIn.savedSignInRecoveryStatus().then(result=>{if(current)update({legacySignInRecovery:result.eligible===true});}).catch(()=>{if(current)update({legacySignInRecovery:false});});
    return()=>{current=false;};
  },[signInEntryRequired,snapshot.signIn?.environment,snapshot.cloudAccount,snapshot.signOutNotice]);
  const visible=connectionChooserVisible(snapshot,!!sending);
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

  const qaEnvironment=useRef<HTMLSelectElement>(null);
  const [confirmRemove,setConfirmRemove]=useState(false);
  // The plan notice beside the running agent can be dismissed until the notice changes.
  const [dismissedNotice,setDismissedNotice]=useState<string|null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const remoteOrigin = useRef<HTMLInputElement>(null), remoteCode = useRef<HTMLInputElement>(null);
  const localOrigin = useRef<HTMLInputElement>(null), localCode = useRef<HTMLInputElement>(null);
  const environment = useRef<HTMLSelectElement>(null);
  useEffect(() => { void connectionController.initialize(); }, []);
  useEffect(()=>{const offline=()=>connectionController.networkChanged(false),online=()=>connectionController.networkChanged(true);window.addEventListener('offline',offline);window.addEventListener('online',online);return()=>{window.removeEventListener('offline',offline);window.removeEventListener('online',online);};},[]);
  // Plan state is checked again when the owner returns (for example from Eliza Cloud's plan page).
  useEffect(()=>{const visible=()=>{if(!document.hidden){if(service)void refreshMembershipBalance();if(residentCloudFlow())connectionController.recheckPlanOnReturn();}};document.addEventListener('visibilitychange',visible);window.addEventListener('pageshow',visible);window.addEventListener('online',visible);return()=>{document.removeEventListener('visibilitychange',visible);window.removeEventListener('pageshow',visible);window.removeEventListener('online',visible);};},[]);
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
    if (!visible) return;
    const previous = document.activeElement as HTMLElement | null;
    const phone = document.querySelector<HTMLElement>('.os');
    const releaseInert = holdPhoneInert(phone);
    return () => { releaseInert(); previous?.focus(); };
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    const phone = document.querySelector<HTMLElement>('.os');
    if (phone && panel.current) {
      const theme = getComputedStyle(phone);
      // The dialog's accent colours text and focus rings, so it takes the theme's text accent
      // (--acct): the fill accent (--acc) is 2.4:1 against the dark background.
      for (const key of ['bg', 'fg', 's2', 'line', 'mut', 'acc']) panel.current.style.setProperty(`--connection-${key}`, theme.getPropertyValue(key === 'acc' ? '--acct' : `--${key}`));
    }
    // A child form restores its input after verification. Updating the trap for busy state must
    // preserve that focus, rather than moving it back to the dialog and dismissing the keyboard.
    if (!panel.current?.contains(document.activeElement)) panel.current?.focus();
    const dismiss = () => {
      if (connectionController.getSnapshot().signIn) connectionController.cancelSignIn();
      else if (snapshot.busy) connectionController.cancel();
      else connectionController.close();
    };
    const back = (event: Event) => { if(document.querySelector("dialog[open]"))return; event.preventDefault(); event.stopImmediatePropagation(); dismiss(); };
    window.addEventListener('alpha-back', back, true);
    const key = (event: KeyboardEvent) => {
      if(document.querySelector("dialog[open]"))return;
      if (event.key === 'Escape') { event.preventDefault(); dismiss(); }
      if (event.key === 'Tab' && panel.current) {
        const items = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary')).filter(item => item.getClientRects().length);
        const first = items[0], last = items.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); window.removeEventListener('alpha-back', back, true); };
  }, [visible, snapshot.busy,snapshot.purpose,snapshot.billingReviewEmail]);
  const env = (): CloudEnvironment => resolveCloudEnvironment(cloudEnvironmentPolicy, environment.current?.value ?? snapshot.signIn?.environment ?? cloud.environment);
  const serviceName=cloudServiceName(env());
  const browserOnly = !testMocksEnabled && !isAndroid && !browserLocalAgentEnabled;
  const cloudAccountControls=<>
    {browserOnly&&<p>{WEB_CLOUD_UNAVAILABLE}</p>}
    {snapshot.cloudAccount&&<section className="alpha-connection-current alpha-cloud-account-summary"><strong>{snapshot.cloudAccount.email||`Signed in to ${serviceName}`}</strong>{!snapshot.cloudAccount.email&&<span>Account {snapshot.cloudAccount.userId}</span>}<button disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Sign out of {serviceName}</button></section>}
    {browserCloudResidentEnabled&&<p role="status">Cloud environment: {browserCloudResidentEnvironment==='staging'?'Staging QA':'Production'}. Your agent runs on this computer.</p>}
    {testMocksEnabled&&snapshot.purpose!=='cloud-account'&&<label>Environment<select aria-label="Environment" ref={environment} disabled={snapshot.busy} defaultValue={resolveCloudEnvironment(cloudEnvironmentPolicy, snapshot.signIn?.environment ?? cloud.environment)} onChange={()=>connectionController.cloudEnvironment(env())}><option value="production">Production</option><option value="staging">Staging</option></select></label>}
    {!browserOnly&&(!snapshot.cloudAccount||snapshot.purpose!=='cloud-account')&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.cloudLogin(env())}>Sign in</button></div>}
  </>;
  if(visible&&snapshot.billingReviewEmail)return <div className="alpha-connection-scrim" data-alpha-billing-overlay="true"><div className="alpha-connection" role="dialog" aria-modal="true" aria-label="Review billing account" data-alpha-membership-panel="true" tabIndex={-1} ref={panel}><BillingAccountReview key={snapshot.billingReviewEmail} email={snapshot.billingReviewEmail} busy={snapshot.busy} error={snapshot.error} onOpen={()=>void connectionController.openReviewedBilling()} onCancel={()=>connectionController.cancelBillingReview()}/></div></div>;
  if (!visible) {
    // Never a gate: the agent is running. A non-blocking notice offers the plan actions.
    const notice=residentCloudFlow()&&snapshot.session?(snapshot.residentPlanNotice==='offline'?'offline':snapshot.residentPlanNotice==='needs-plan'&&snapshot.cloudAccount?'needs-plan':null):null;
    if(!notice||dismissedNotice===notice)return null;
    return <aside className="alpha-plan-notice" role="region" aria-label={`${serviceName} plan notice`}>
      <p role="status">{notice==='offline'?OFFLINE_NOTICE:NEEDS_PLAN_NOTICE}</p>
      <div className="alpha-plan-notice-actions">
        {notice==='needs-plan'?<>
          <button disabled={snapshot.busy} onClick={()=>connectionController.openPlan({codeEntry:true})}>Redeem code</button>
          <button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{CHOOSE_PLAN_LABEL}</button>
        </>:<button disabled={snapshot.busy} onClick={()=>connectionController.recheckPlanOnReturn(true)}>Try again</button>}
        <button aria-label="Dismiss plan notice" onClick={()=>setDismissedNotice(notice)}>×</button>
      </div>
    </aside>;
  }
  const providerChoice=<OwnProviderChoice busy={snapshot.busy} status={snapshot.providerStatus} onSave={(key,voice)=>connectionController.configureLocal(key,LOCAL_PROVIDER_MODEL,voice)} onCloud={()=>connectionController.selectCloudProvider()}/>;
  if(snapshot.purpose==='provider')return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-connection-native" role="dialog" aria-modal="true" aria-labelledby="provider-title" tabIndex={-1} ref={panel}><header><h1 id="provider-title">AI provider</h1><button aria-label="Close AI provider settings" disabled={snapshot.busy} onClick={()=>connectionController.close()}>×</button></header>{providerChoice}{snapshot.error&&<p role="alert">{snapshot.error}</p>}{snapshot.message&&<p role="status">{snapshot.message}</p>}</div></div>;
  const requiredSignInView: SignInView = snapshot.signIn ?? { step: 'choose', environment: residentEnvironment() };
  if (snapshot.signIn || signInEntryRequired) return <div className={productionSignInRequired?'alpha-auth-page':'alpha-connection-scrim'}><div className={`alpha-connection alpha-connection-native alpha-cloud-sign-in${productionSignInRequired?' alpha-auth-content':''}`} role={productionSignInRequired?'main':'dialog'} aria-modal={productionSignInRequired?undefined:true} aria-labelledby="cloud-sign-in-title" aria-busy={snapshot.busy||undefined} tabIndex={-1} ref={panel}>
    {providerChoice}
    <CloudSignInPanel serviceLoader={loadSignInService} phone={cloudSignInPhone && inAppPhone} emailEnabled={inAppEmail} view={requiredSignInView} busy={snapshot.busy} ready={!!snapshot.signIn} dismissible={!productionSignInRequired} google={inAppGoogle} message={snapshot.message} error={snapshot.error} errorIsNotice={snapshot.error===RESIDENT_UNPACKAGED}
      actions={{phone:number=>void connectionController.signInPhone(number),google:()=>void connectionController.signInGoogle(),email:address=>void connectionController.signInEmail(address),verify:code=>void connectionController.verifySignInCode(code),resend:()=>void connectionController.resendSignInCode(),cancel:()=>connectionController.cancelSignIn(),retry:()=>void connectionController.beginSignIn(requiredSignInView.environment,true)}}
      extra={signInEntryRequired && !snapshot.signIn && !snapshot.busy
        ? <button onClick={()=>void connectionController.beginSignIn(residentEnvironment(),true)}>Retry sign-in</button>
        : testMocksEnabled?<button disabled={snapshot.busy} onClick={()=>void connectionController.signInBrowser()}>Browser sign-in (diagnostic)</button>:undefined}/>
    {!snapshot.cloudAccount&&snapshot.legacySignInRecovery&&requiredSignInView.step==='choose'&&requiredSignInView.environment==='production'&&<details aria-label="Sign-in troubleshooting"><summary>Trouble signing in?</summary><button disabled={snapshot.busy} onClick={()=>void connectionController.restoreSavedSignIn()}>Restore saved sign-in</button></details>}
    {snapshot.signOutNotice && snapshot.signOutNotice!==snapshot.message && <p role="status">{snapshot.signOutNotice}</p>}
    {productionSignInRequired && <ResidentRecoveryPanel snapshot={snapshot}/>}
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
  const membershipControls=snapshot.cloudAccount&&<CloudMembershipControls key={`${snapshot.cloudAccount.environment}:${snapshot.cloudAccount.userId}:${snapshot.cloudAccount.organizationId}:${snapshot.cloudAccount.credentialId}`} email={snapshot.cloudAccount.email} plan={snapshot.membershipPlan} endsAt={snapshot.planEndsAt} lastLimit={snapshot.fundingRefused&&snapshot.lastServiceLimit?.kind==='billing-refused'?null:snapshot.lastServiceLimit} refused={!!snapshot.fundingRefused} serviceName={serviceName} codeEntry={snapshot.membershipCodeEntry} balance={snapshot.membershipBalance??'unavailable'} busy={snapshot.busy} error={snapshot.redeemError} connectionError={snapshot.error} notice={snapshot.redeemNotice} onRedeem={code=>connectionController.residentRedeem(code)} onManagePlan={()=>void connectionController.residentManagePlan()} onRefresh={()=>void connectionController.refreshMembershipBalance()}/>;
  const fundingRequired=!ownProviderSelected()&&!!snapshot.cloudAccount&&(snapshot.membershipBalance==='zero'||!!snapshot.fundingRefused);
  if((fundingRequired||snapshot.purpose==='plan'&&!residentCloudFlow())&&snapshot.cloudAccount)return <div className="alpha-connection-scrim" data-alpha-billing-overlay="true" data-alpha-membership-sheet="true"><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="alpha-membership-title" tabIndex={-1} ref={panel} data-alpha-membership-panel="true"><div className="alpha-membership-drag-handle" aria-hidden="true"/><header><h1 id="alpha-membership-title" className="serif">Subscription</h1><button aria-label="Close membership settings" disabled={snapshot.busy} onClick={()=>connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>{accountCreatedNotice}{membershipControls}<footer className="alpha-membership-footer"><button type="button" disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Use another account</button></footer>{snapshot.busy&&<button onClick={()=>connectionController.cancel()}>Cancel</button>}</div></div>;
  if(snapshot.purpose==='cloud-account')return <div className="alpha-connection-scrim" {...(snapshot.cloudAccount?{'data-alpha-billing-overlay':'true','data-alpha-membership-sheet':'true'}:{})}><div className="alpha-connection" role="dialog" aria-modal="true" aria-labelledby="cloud-account-title" tabIndex={-1} ref={panel} data-alpha-membership-panel={snapshot.cloudAccount?'true':undefined}>
    {snapshot.cloudAccount&&<div className="alpha-membership-drag-handle" aria-hidden="true"/>}<header><h1 id="cloud-account-title" className="serif">{snapshot.cloudAccount?'Subscription':serviceName}</h1><button aria-label="Close Cloud account" disabled={snapshot.busy} onClick={()=>connectionController.close()}><span aria-hidden="true" data-alpha-icon="/icons/lucide/x.svg" style={iconStyle("x")}/></button></header>
    {accountCreatedNotice}
    {!snapshot.cloudAccount&&<p>{savedSignInOffered?'Retry your saved connection or sign in again to use connected services such as Gmail.':'Sign in to use connected services such as Gmail.'}</p>}
    {savedSignInOffered&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button></div>}
    {savedSignInOffered&&snapshot.residentPlanNotice==='offline'&&<p role="status">{OFFLINE_NOTICE}</p>}
    {!snapshot.cloudAccount&&cloudAccountControls}
    {snapshot.cloudAccount&&browserCloudResidentEnabled&&<p role="status">Cloud environment: {browserCloudResidentEnvironment==='staging'?'Staging QA':'Production'}. Your agent runs on this computer.</p>}
    {membershipControls}
    {snapshot.cloudAccount&&<footer className="alpha-membership-footer"><button type="button" disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Use another account</button></footer>}
    {snapshot.message&&<p role="status">{snapshot.message}</p>}{!membershipControls&&snapshot.error&&<p role="alert" className="alpha-connection-error">{residentCloudFlow()&&savedSignInRejected?'Your saved Cloud sign-in is no longer valid.':snapshot.error}</p>}

    {snapshot.busy&&<button className="alpha-connection-cancel" onClick={()=>connectionController.cancel()}>Cancel</button>}
  </div></div>;

  // P-43 (owner, 2026-10-13): the agent always runs on this device. This dialog is its status
  // (Starting / Running on this device / Not running, with Retry) and its Eliza Cloud AI: sign-in
  // (which every Alpha Phone needs), plan, redeem code and sign-out. Plan state never stops the agent.
  const residentSignInRejected=snapshot.error===errorMessage({status:401});
  const residentStatus=snapshot.session?'Running on this device':snapshot.residentRecoveryReason?(snapshot.residentRecoveryReason==='ipc-recovery-retention-limit'?'Restart needed':'Needs attention'):snapshot.kind==='recovering'?'Not running':'Starting…';
  const residentNeedsPlan=snapshot.residentPlanNotice==='needs-plan'&&!!snapshot.cloudAccount&&!residentSignInRejected;
  const residentOffline=snapshot.residentPlanNotice==='offline'&&!snapshot.cloudAccount;
  // Only a required sign-in (first run, or a sign-in Cloud rejected) cannot be dismissed. The agent runs either way.
  const residentMustSignIn=!ownProviderSelected()&&residentCloudFlow()&&!snapshot.cloudAccount&&snapshot.residentPlanNotice!=='offline'&&!snapshot.residentStarting;
  // Required sign-in stays focused; a recovery error retains the full connection controls.
  const residentFirstSignIn=residentMustSignIn&&!snapshot.residentSavedCredential&&!residentSignInRejected&&!snapshot.residentRecoveryReason&&!snapshot.error;
  const planPanel=snapshot.purpose==='plan';
  const residentMembershipVisible=!!snapshot.cloudAccount&&!residentSignInRejected&&(residentNeedsPlan||planPanel);
  // A check that ended without a view (identity or transport failure) is "unavailable", never a stale gate.
  const residentPlanView=snapshot.residentSubscription;
  const residentPlanUnchecked=!residentPlanView||residentPlanView.kind==='checking';
  const residentPlanDescribed=residentPlanUnchecked&&!snapshot.busy?{headline:'Plan status unavailable',detail:'Try again.',manage:false,manageLabel:''}:describeSubscription(residentPlanView,serviceName);
  const residentPlan=residentNeedsPlan&&residentPlanView?.kind==='unavailable'&&residentPlanView.reason!=='not-published'
    ?{...residentPlanDescribed,detail:`${serviceName} could not confirm a plan for this account right now. Check again, redeem a subscription code or choose a plan. Your data on this phone is kept.`}:residentPlanDescribed;
  const residentPlanRecheck=residentPlanUnchecked||residentPlanView.kind==='inactive'||residentPlanView.kind==='unavailable';
  // A signed-in agent that is starting has no AI binding yet: a calm starting state, never "AI is off"
  // or plan and billing copy (owner report 2026-10-30). The plan panel keeps its account controls.
  const residentAiStarting=!!snapshot.cloudAccount&&!residentSignInRejected&&!snapshot.session&&snapshot.kind==='starting'&&!snapshot.residentRecoveryReason&&!planPanel;
  const residentAiOff=residentFirstSignIn?`Sign in to ${serviceName} to use AI. Your agent keeps running on this phone.`:snapshot.residentSavedCredential?`AI is off. Retry your saved ${serviceName} sign-in or sign in again.`:`AI is off. Sign in to ${serviceName} for AI.`;
  const keyExpiresAt=snapshot.cloudAccount?.expiresAt;
  const keyExpiring=keyExpiresAt!==undefined&&keyExpiresAt-Date.now()<=CLOUD_KEY_EXPIRY_WARNING_MS;
  const day=(at:number)=>new Date(at).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  if(residentCloudFlow())return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-connection-native alpha-connection-resume" role="dialog" aria-modal="true" aria-labelledby="connection-title" aria-busy={snapshot.residentStarting||undefined} tabIndex={-1} ref={panel}>
    <header><h1 id="connection-title" className="serif">{planPanel&&snapshot.cloudAccount?`${serviceName} account & plan`:'Your agent'}</h1>{!residentMustSignIn&&<button aria-label="Close connection settings" disabled={snapshot.busy&&!snapshot.residentStarting} onClick={()=>connectionController.close()}>×</button>}</header>
    {/* Owner decision (2026-10-30): the plan sheet shows only account, plan and billing. Agent
        status, recovery, conversation history and phone-action receipts stay in Settings › Agent connection. */}
    {!planPanel&&<section aria-label="Agent status"><p role="status"><strong>{residentStatus}</strong>{!snapshot.session&&snapshot.kind!=='recovering'?' · Your agent runs on this device.':''}</p>
      {snapshot.kind==='recovering'&&!snapshot.session&&!snapshot.residentRecoveryReason&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry</button></div>}
      <ResidentRecoveryPanel snapshot={snapshot}/>
      {snapshot.session&&!residentFirstSignIn&&<div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Reconnect agent</button></div>}
    </section>}
    {!planPanel&&providerChoice}
    <section aria-label="AI inference" hidden={ownProviderSelected()&&!planPanel}>{!planPanel&&<h3>AI</h3>}{!planPanel&&!residentFirstSignIn&&<p>{snapshot.residentRecoveryReason?'AI is unavailable while your agent needs recovery.':residentAiStarting?'Waiting for your agent to start.':snapshot.cloudAccount&&!residentSignInRejected?(snapshot.residentInference==='cloud'?`Your agent uses ${serviceName} for AI.`:snapshot.residentInference==='unavailable'?`AI is off. Your saved ${serviceName} sign-in is retained; check the connection below.`:!snapshot.session&&snapshot.kind==='recovering'?'AI is unavailable while your agent is not running.':'AI connection is not confirmed. Your agent still runs on this device.'):`Your agent runs with AI off until you sign in to ${serviceName}.`}</p>}
      {residentAiStarting?accountCreatedNotice:snapshot.cloudAccount&&!residentSignInRejected?<>
        {accountCreatedNotice}
        {!residentMembershipVisible&&(planPanel||residentNeedsPlan)&&<p>{snapshot.cloudAccount.email||`Account ${snapshot.cloudAccount.userId}`}</p>}
        {!residentMembershipVisible&&<section aria-label={`${serviceName} plan`}><p><strong>{residentPlan.headline}</strong></p>{residentPlan.detail&&<p>{residentPlan.detail}</p>}{snapshot.planEndsAt&&!residentNeedsPlan?<p>Plan runs until {day(snapshot.planEndsAt)}.</p>:null}</section>}
        {residentNeedsPlan&&!residentMembershipVisible&&<p role="status">{NEEDS_PLAN_NOTICE}</p>}
        {keyExpiring&&<section aria-label={`${serviceName} sign-in`}><p role="status">{keyExpiresAt<=Date.now()?`Your ${serviceName} sign-in on this phone has expired.`:`Your ${serviceName} sign-in on this phone expires ${day(keyExpiresAt)}.`} Approve this phone again to keep AI available.</p><button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Approve this phone again</button></section>}
        {residentMembershipVisible&&membershipControls}
        {!residentMembershipVisible&&snapshot.redeemError&&<p id="alpha-redeem-error" role="alert" className="alpha-connection-error">{snapshot.redeemError}</p>}
        {!residentMembershipVisible&&snapshot.redeemNotice&&<p role="status">{snapshot.redeemNotice}</p>}
      </>:<p>{residentSignInRejected?(snapshot.error?`Sign in to ${serviceName} again to turn AI back on.`:'Your saved Cloud sign-in is no longer valid.'):residentAiOff}</p>}
      {residentOffline&&<p role="status">{OFFLINE_NOTICE}</p>}
      <div className="alpha-connection-actions">
      {residentAiStarting?null:snapshot.cloudAccount&&!residentSignInRejected ? <>
        {!residentMembershipVisible&&(residentNeedsPlan?<button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{CHOOSE_PLAN_LABEL}</button>:(residentPlan.manage||planPanel)&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentManagePlan()}>{residentPlan.manageLabel||MANAGE_PLAN_LABEL}</button>)}
        {!snapshot.residentRecoveryReason&&(residentPlanRecheck||residentNeedsPlan)?<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Check plan again</button>:planPanel&&<button disabled={snapshot.busy} onClick={()=>connectionController.close()}>Done</button>}
        <button disabled={snapshot.busy} onClick={()=>void connectionController.cloudSignOut()}>Sign out</button>
      </>:<>
        {residentOffline&&!snapshot.residentRecoveryReason&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Try again</button>}
        {snapshot.residentSavedCredential&&!residentSignInRejected&&!residentOffline&&!snapshot.residentRecoveryReason&&<button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>Retry saved connection</button>}
        {!residentOffline&&<button disabled={snapshot.busy} onClick={()=>void connectionController.residentCloudLogin()}>Sign in with {serviceName}</button>}
      </>}
      </div>
    </section>
    {!planPanel&&snapshot.replyNotice&&<p role="status">{snapshot.replyNotice}</p>}
    {snapshot.message&&<p role="status">{snapshot.message}</p>}
    {!(snapshot.cloudAccount&&!residentSignInRejected&&(residentNeedsPlan||planPanel))&&snapshot.error&&<p role="alert">{snapshot.error===errorMessage({status:401})?'Your saved Cloud sign-in is no longer valid.':snapshot.error}</p>}
    {!planPanel&&snapshot.historyError&&<><p role="status">{snapshot.historyError}</p><button disabled={snapshot.busy} onClick={()=>void connectionController.retrySavedHistory()}>Retry saved conversation</button></>}
    {!planPanel&&!residentFirstSignIn&&conversations}
    {!planPanel&&!residentFirstSignIn&&actionReview}
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
  if(privateLocalPreviewEnabled)return <div className="alpha-connection-scrim"><div className="alpha-connection alpha-connection-native alpha-connection-resume" role="dialog" aria-modal="true" aria-labelledby="private-connection-title" aria-busy={snapshot.busy||undefined} tabIndex={-1} ref={panel}>
    <header><h1 id="private-connection-title" className="serif">Alpha connection</h1><button aria-label="Close connection settings" disabled={snapshot.busy} onClick={()=>connectionController.close()}>×</button></header>
    <p role="status">{snapshot.session?'Connected to the agent on this computer.':snapshot.busy?'Connecting…':'Alpha couldn’t connect to the agent on this computer.'}</p>
    {snapshot.error&&<p role="alert" className="alpha-connection-error">{snapshot.error}</p>}
    <div className="alpha-connection-actions"><button disabled={snapshot.busy} onClick={()=>void connectionController.startLocal()}>{snapshot.session?'Reconnect':'Try again'}</button></div>
    {conversations}
  </div></div>;
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
  const reason=snapshot.residentRecoveryReason,recovery=snapshot.residentRecovery;
  return reason&&!snapshot.session&&<section aria-label="Restart Alpha">
    <p role="status">{residentRecoveryCopy(reason,recovery)}</p>
    {reason==='ipc-recovery-retention-limit'&&<button disabled={snapshot.busy} onClick={()=>void connectionController.restartRecovery()}>Restart Alpha</button>}
    <details><summary>Details</summary>
      <p>Reason: {reason}</p>
      {recovery&&<p>Stage: {recovery.step}</p>}
      {recovery?.step==='review'&&<p>Startup records to keep: {recovery.review.retainedCount}</p>}
    </details>
  </section>;
}

/** One explicit choice; key values live only in the submitted form and native credential vault. */
function OwnProviderChoice({busy,status,onSave,onCloud}:{busy:boolean;status?:LocalProviderStatus|null;onSave:(key:string,voice?:string)=>Promise<void>;onCloud:()=>Promise<void>}){
 const [editing,setEditing]=useState(false),[switching,setSwitching]=useState(false);
 const ai=useRef<HTMLInputElement>(null),speech=useRef<HTMLInputElement>(null);
 const own=status?.selected===true&&status.provider==='cerebras';
 const native=Capacitor.isNativePlatform(),host=native||browserCloudResidentEnabled;
 return <section aria-label="AI provider">
  <h3>AI provider</h3>
  <p>{own?'Own API keys · Cerebras':status?.provider==='elizacloud'?'Cloud':'Choose Cloud or your own API keys.'}</p>
  <div className="alpha-connection-actions">
   <button type="button" disabled={busy} aria-pressed={!own&&!editing} onClick={()=>{setEditing(false);if(own)setSwitching(true);}}>Cloud</button>
   <button type="button" disabled={busy} aria-pressed={own||editing} onClick={()=>{setSwitching(false);setEditing(true);}}>Own API keys</button>
  </div>
  {switching&&<div><p>Switch to your saved Cloud account? Your conversations and phone data stay. You will need to enter your own keys again to switch back.</p><button disabled={busy} onClick={()=>{setSwitching(false);void onCloud();}}>Switch to Cloud</button><button disabled={busy} onClick={()=>setSwitching(false)}>Keep own keys</button></div>}
  {own&&!editing&&<p>{status.voiceConfigured?'Voice uses your Cartesia key when you start the microphone.':'Voice is off. Add a Cartesia key to configure voice.'}</p>}
  {editing&&<>
   <p>Cerebras receives prompts and selected context. Optional Cartesia voice receives recordings and reply text. Provider charges use your own accounts. Switching is manual; failed requests never switch providers.</p>
   {!host?<p role="status">Own API keys need Android secure storage. This browser cannot save or activate provider keys.</p>:<form onSubmit={event=>{event.preventDefault();const key=ai.current?.value||'',voice=speech.current?.value||'';if(ai.current)ai.current.value='';if(speech.current)speech.current.value='';void onSave(key,voice||undefined);}}>
    <label>Cerebras API key<input ref={ai} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} required disabled={busy}/></label>
    <label>Cartesia API key (optional)<input ref={speech} type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
    <p>{native?'Keys are stored with Android Keystore.':'Keys stay in this host session memory only and are lost when the host closes. They are not saved in the browser.'} Save checks the Cerebras model list; it does not send a chat or a voice request. Cartesia is saved without a live check.</p>
    <button disabled={busy}>Save and use own keys</button><button type="button" disabled={busy} onClick={()=>{if(ai.current)ai.current.value='';if(speech.current)speech.current.value='';setEditing(false);}}>Cancel</button>
   </form>}
  </>}
 </section>;
}
