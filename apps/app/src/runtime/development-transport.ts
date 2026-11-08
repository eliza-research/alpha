import { validateDeviceOperation as validatePreparedDeviceOperation } from "./device-actions";
import { validateReminderCreate, type ReminderCreateOperation } from "../../../../.eliza/client-features/plugins/plugin-assistant/src/services/device-actions/reminder-create-contract.ts";
import { findViewActionHandoff } from "../../../../.eliza/client-features/packages/core/src/views/view-action-handoff.ts";
import { DEVELOPMENT_PROPOSAL_VIEWS } from "./development-view-contract.ts";
import { sanitizePhoneContext } from './phone-context';
import { registerPlugin } from '../platform-plugins';
import { testMocksEnabled } from '../build-flags';
import type {
  ActionProposal,
  AlphaView,
  ContextEnvelope,
  VerifiedSessionTransport,
} from "./alpha-client";

export type DevelopmentLocalOperation =
  | { type: "create_note"; title: string; body: string }
  | ReminderCreateOperation
  | { type: "open_view"; view: AlphaView };
export type DevelopmentLocalDispatcher = (
  operation: DevelopmentLocalOperation,
) =>
  | Promise<{ status: "succeeded" | "failed"; summary: string }>
  | { status: "succeeded" | "failed"; summary: string };
export interface DevelopmentAgentStatus {
  available: boolean;
  configured: boolean;
  connected: boolean;
  message?: string;
  mode?: string;
  sessionId?: string;
  model?: string;
  providerOrigin?: string;
}
interface WireProposal extends ActionProposal {
  operation: DevelopmentLocalOperation;
  simulated?: boolean;
  navigation?: unknown;
}
const DevelopmentAgent = registerPlugin<{
  status(): Promise<DevelopmentAgentStatus>;
  chat(input: {
    requestId: string;
    text: string;
    context: ContextEnvelope;
  }): Promise<{ text: string; requestId: string; proposals: WireProposal[] }>;
  cancel(input: { requestId: string }): Promise<{ cancelled: boolean }>;
}>("DevelopmentAgent");
const allowedViews = new Set<AlphaView>(DEVELOPMENT_PROPOSAL_VIEWS);
function validateOperation(
  operation: DevelopmentLocalOperation,
): DevelopmentLocalOperation {
  if (operation?.type === "create_note") return validatePreparedDeviceOperation(operation) as Extract<DevelopmentLocalOperation,{type:"create_note"}>;
  if (operation?.type === "reminder_create") return validateReminderCreate(operation);
  if (operation?.type === "open_view" && allowedViews.has(operation.view))
    return { type: "open_view", view: operation.view };
  throw new Error("Unsupported local action proposal.");
}
export async function developmentAgentStatus(): Promise<DevelopmentAgentStatus> {
  if (!testMocksEnabled) return { available: false, configured: false, connected: false, message: "Development agent is unavailable in this build." };
  try {
    return await DevelopmentAgent.status();
  } catch {
    return {
      available: false,
      configured: false,
      connected: false,
      message:
        "Development agent is available only in a configured Android debug build.",
    };
  }
}

/** Native debug bridge only; credentials never enter JavaScript. Local operations
 * require both a registered dispatcher and approval of the exact retained proposal. */
export async function createDevelopmentTransport(
  dispatch?: DevelopmentLocalDispatcher,
): Promise<VerifiedSessionTransport> {
  // Test-mocks builds only (ELIZA_DEV_ALLOW_TEST_MOCKS=1); product builds never
  // fall back to the debug transport.
  if (!testMocksEnabled) throw new Error("Choose an agent connection to send a message.");
  const status = await developmentAgentStatus();
  if (
    !status.available ||
    !status.configured ||
    !status.connected ||
    status.mode !== "development" ||
    !status.sessionId ||
    !status.providerOrigin
  ) {
    throw new Error(
      "Start and configure the emulator development agent first.",
    );
  }
  const origin = new URL(status.providerOrigin);
  if (origin.protocol !== "https:" || origin.origin !== status.providerOrigin)
    throw new Error("Invalid development provider metadata.");
  const active = new Set<string>();
  const pending = new Map<
    string,
    { proposal: ActionProposal; operation: DevelopmentLocalOperation }
  >();
  return {
    session: {
      ownerId: "emulator-development-owner",
      agentId: `development:${status.model || "model"}`,
      sessionId: status.sessionId,
      origin: status.providerOrigin,
    },
    async send({ requestId, text, context, signal }) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      pending.clear();
      active.add(requestId);
      const cancel = () => {
        void DevelopmentAgent.cancel({ requestId }).catch(() => {});
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const result = await DevelopmentAgent.chat({
          requestId,
          text,
          context: context.selectedObject?.kind.startsWith('map-') ? sanitizePhoneContext(context) : context,
        });
        if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
        if (
          result.requestId !== requestId ||
          typeof result.text !== "string" ||
          !Array.isArray(result.proposals) ||
          result.proposals.length > 4
        )
          throw new Error("Invalid development agent response.");
        const proposals: ActionProposal[] = [];
        for (const wire of result.proposals) {
          const operation = validateOperation(wire.operation);
          if (
            !wire.id ||
            typeof wire.id !== "string" ||
            pending.has(wire.id) ||
            typeof wire.title !== "string" ||
            typeof wire.description !== "string" ||
            !Number.isFinite(wire.expiresAt) ||
            wire.expiresAt <= Date.now() ||
            wire.contextRevision !== context.revision
          )
            throw new Error("Invalid development action binding.");
          if (wire.navigation !== undefined) {
            const handoff=findViewActionHandoff([wire.navigation]);
            const view=handoff?.viewId==='chat'?'home':handoff?.viewId==='automations'?'workflows':handoff?.viewId;
            if(operation.type!=='open_view'||view!==operation.view||handoff?.navigationPrepared!==true||handoff.completedActionHandoffId!==wire.id)throw Error('Invalid development navigation preparation');
          }
          const record:{title:string;body:string;at?:number}=operation.type==='reminder_create'?{title:operation.fields.title,body:operation.fields.body,at:operation.fields.schedule.at}:operation.type==='open_view'?{title:'',body:''}:operation;
          // Build the review text from the exact validated action, not model prose.
          const proposal: ActionProposal = {
            id: wire.id,
            expiresAt: wire.expiresAt,
            contextRevision: wire.contextRevision,
            title:
              operation.type === "open_view" ? "Open " + operation.view : "Preview " + (operation.type === "create_note" ? "note: " : "reminder: ") + record.title,
            description: operation.type === "open_view" ? "Open the " + operation.view + " local view after review. No records are read or changed." : "Development simulation only. Review the exact operation; no note will be saved and no reminder will be scheduled.\n\nTitle: " + record.title + "\n\n" + record.body + (record.at!==undefined ? "\nExact instant: " + new Date(record.at).toISOString() : ""),
          };
          pending.set(proposal.id, { proposal, operation });
          proposals.push({ ...proposal });
        }
        return { text: result.text, proposals };
      } finally {
        active.delete(requestId);
        signal.removeEventListener("abort", cancel);
      }
    },
    async execute({ proposal, context, signal }) {
      const stored = pending.get(proposal.id);
      if (
        !stored ||
        signal.aborted ||
        stored.proposal.expiresAt <= Date.now() ||
        stored.proposal.contextRevision !== context.revision ||
        JSON.stringify(stored.proposal) !== JSON.stringify(proposal)
      )
        throw new Error("Local action is not available for approval.");
      pending.delete(proposal.id); // consume before dispatch; never retry an ambiguous write
      const operation=validateOperation({ ...stored.operation });
      if(operation.type!=="open_view") return {proposalId:proposal.id,status:"failed",summary:"Development simulation reviewed. No note was saved and no reminder was scheduled."};
      if(!dispatch)throw Error("Local view navigation is unavailable");
      const result = await dispatch(operation);
      if (
        !result ||
        !["succeeded", "failed"].includes(result.status) ||
        typeof result.summary !== "string"
      )
        throw new Error("Local action did not return a verified result.");
      return {
        proposalId: proposal.id,
        status: result.status,
        summary: result.summary,
      };
    },
    close() {
      for (const requestId of active)
        void DevelopmentAgent.cancel({ requestId }).catch(() => {});
      active.clear();
      pending.clear();
    },
  };
}
