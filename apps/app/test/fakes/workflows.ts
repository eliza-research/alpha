import type { NotificationsNativePlugin, PendingNoticeTap } from "@elizaos/os-bridges";
import { Effect } from "effect";
import { type DigestResult, type WorkflowPhoneReview, workflowSha } from "@elizaos/plugin-workflow-client";
import type { NativeDigestSnapshot } from "../../src/platform/hosted-digests.vibe";
import { answered, type Faked, rejection } from "./phone.ts";
import { type Route, readJsonBody } from "./routes.ts";
import { textReview } from "./text-review.ts";

const record = {
  id: "monthly-statement",
  versionId: "monthly-statement-v3",
  name: "Monthly statement",
  description: "",
  active: false,
  removed: false,
  steps: [{ label: "Supplied text" }],
};
const removed = {
  ...record,
  id: "retired-brief",
  versionId: "retired-brief-v2",
  name: "Retired brief",
  removed: true,
  triggerCleanup: "complete",
};
const startedAt = "2026-11-24T07:00:00.000Z";
const receipt = {
  id: "monthly-statement-r1", workflowId: record.id, workflowVersionId: record.versionId,
  status: "finished", startedAt, finished: true, output: "Your statement is ready.",
};

type Statement = typeof record & { triggerCleanup?: "complete" };

/** What this agent offers the typed builder: a manual or timed trigger and the four steps Alpha authors. */
const catalog = {
  specVersion: 1, maximumSteps: 32, maximumSpecBytes: 65_536, catalogRevision: "fake-catalog-1", compilerRevision: "fake-compiler-1",
  triggers: [{ kind: "manual", available: true }, { kind: "time", available: true }],
  palette: [
    { kind: "Read", operations: [{ id: "supplied_text", available: true }] },
    { kind: "If", operations: [{ id: "contains", available: true }] },
    { kind: "Write", operations: [{ id: "compose_draft", available: true }, { id: "model_draft", available: true }] },
  ],
};

async function digest(spec: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(spec) ?? ""));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const approvalNode = "preview";
const approvalDigest = "a".repeat(64);
const executionPath = `/api/workflow/executions/${receipt.id}`;

export async function workflowNoteOffer(world: WorkflowsScene, agentId: string) {
  return workflowPhoneOffer(world, agentId, "create_note");
}

export async function workflowPhoneOffer(world: WorkflowsScene, agentId: string, kind: "create_note" | "post_notification" | "speak_text") {
  const words = "A reviewed note.";
  const title = kind === "post_notification" ? "A reviewed notification" : "Statement saved by Workflows";
  const operation = kind === "speak_text" ? { type: kind, text: words } as const : { type: kind, title, body: words };
  const offer = textReview(agentId, kind === "create_note" ? "workflow-note-proposal" : "workflow-" + kind + "-proposal", operation);
  const { installationId, enrollmentId } = offer.proposal.payload;
  const step = kind === "post_notification" ? { id: approvalNode, kind: "Notify", operation: "app_notification", source: "source", title } as const
    : kind === "speak_text" ? { id: approvalNode, kind: "Speak", operation: "read_aloud", source: "source" } as const
    : { id: approvalNode, kind: "Write", operation: "save_note", source: "source", title } as const;
  const spec: WorkflowPhoneReview["spec"] = {
    device: { installationId, enrollmentId },
    version: 1, name: record.name, description: "", trigger: { kind: "manual" },
    steps: [{ id: "source", kind: "Read", operation: "supplied_text", text: words }, step],
  };
  const specDigest = await Effect.runPromise(workflowSha(spec));
  const scope = { runId: receipt.id, workflowId: record.id, versionId: record.versionId, specDigest };
  world.phoneReview = { ...scope, spec, status: "running", finished: false, cancellationRequestedAt: null };
  const settled = Promise.withResolvers<void>();
  world.deviceReceipt = settled.promise;
  offer.workflow = { binding: { ...scope, stepId: approvalNode }, offered: () => world.stage === "Device", answered: settled.resolve };
  return offer;
}

type PromptTiming =
  | { triggerType: "once"; scheduledAtIso: string }
  | { triggerType: "cron"; cronExpression: string }
  | { triggerType: "event"; eventKind: string };

type Prompt = PromptTiming & {
  id: string;
  displayName: string;
  instructions: string;
  enabled: boolean;
  revision: number;
  timezone: string;
};

type PostApprovalNotice = Parameters<NotificationsNativePlugin["postWorkflowApproval"]>[0];
type PostResultNotice = Parameters<NotificationsNativePlugin["postWorkflow"]>[0];

export interface NativeApprovalNotices {
  readonly posted: PostApprovalNotice[];
  readonly results: PostResultNotice[];
  readonly consumed: string[];
  readonly withdrawn: string[];
  pending?: PendingNoticeTap;
  tap(request: PostApprovalNotice): void;
  tapResult(request: PostResultNotice, question?: boolean): void;
}

export function nativeApprovalNotices(): NativeApprovalNotices {
  return { posted: [], results: [], consumed: [], withdrawn: [], tap() {}, tapResult() {} };
}

// spec/app/workflows/approvals.md, "Story: Open the run a notice names"
type WorkflowHostScope = { kind: "signedOut" } | { kind: "owned"; userId: string; organizationId: string; agentId: string; epoch: number };

/**
 * The Workflow notice calls of Alpha's `ElizaNotifications`, which the native plugin always declares. A journey without
 * `scene` gets them unimplemented: Capacitor reads a plugin's methods once for the life of the page, and Alpha keeps
 * that registration across the journeys of a file, so the methods are declared all the same.
 */
export const workflowNoticesHost = (scene: NativeApprovalNotices | undefined, scope: () => WorkflowHostScope): Faked => (emit) => {
  if (scene === undefined) {
    const declared = workflowNoticesHost(nativeApprovalNotices(), scope)(emit) as Record<string, unknown>;
    return Object.fromEntries(Object.keys(declared).map((method) =>
      [method, () => Promise.reject(rejection(`ElizaNotifications.${method} is not implemented`, "UNIMPLEMENTED"))]));
  }
  scene.tap = (request) => {
    scene.pending = { ...request.route, operationId: request.id, bindingHash: request.bindingHash, token: "tap-1", retained: true };
    emit("pendingWorkflowTap", {});
  };
  scene.tapResult = (request, question = false) => {
    const pending = { ...request.route, operationId: request.operationId, bindingHash: request.bindingHash, retained: true };
    scene.pending = question ? {
      ...pending, token: "tap-result-question", question: true,
      notice: { id: request.operationId, revision: "native-result-revision", source: "alpha", appLabel: "Alpha", title: "Workflow finished", text: "Open the run to see its result." },
    } : { ...pending, token: "tap-result" };
    emit("pendingWorkflowTap", {});
  };
  return {
    workflowApprovalScope: () => Promise.resolve(scope()),
    workflowPresentationCapabilities: () => Promise.resolve({ protocol: 2 }),
    noticeOwner: () => Promise.resolve({ withdrawn: 0, suspended: [] }),
    postWorkflowApproval: (notice: PostApprovalNotice) => {
      if (!/^[a-f0-9]{64}$/.test(notice.route.scope)) return Promise.reject(rejection("Invalid notice scope"));
      if (!scene.posted.some(({ id }) => id === notice.id)) scene.posted.push(notice);
      return Promise.resolve({ status: "succeeded" });
    },
    postWorkflow: (notice: PostResultNotice) => {
      if (!scene.results.some(({ operationId }) => operationId === notice.operationId)) scene.results.push(notice);
      return Promise.resolve({ status: "succeeded" });
    },
    withdrawWorkflowApproval: ({ id }: { id: string }) => { scene.withdrawn.push(id); return Promise.resolve(); },
    pendingWorkflowTap: () => Promise.resolve(scene.pending ?? {}),
    consumeWorkflowTap: ({ token, noticeRevision, unavailable }: { token: string; noticeRevision?: string; unavailable?: boolean }) => {
      if (scene.pending?.token !== token || (!unavailable && scene.pending.notice?.revision !== noticeRevision)) {
        return Promise.reject(rejection("Workflow tap changed"));
      }
      delete scene.pending;
      scene.consumed.push(token);
      return Promise.resolve();
    },
  };
};

export interface NativeDigestScene {
  snapshot: NativeDigestSnapshot;
  incoming: readonly DigestResult[] | undefined;
  readonly manualLeases: string[];
}

// spec/app/digests/index.md, "Android supplies one verified view of retained results and background checks"
export const alphaHostedDigests = (native: NativeDigestScene): Faked => (emit) => ({
  read: () => Promise.resolve({ snapshot: native.snapshot }),
  peekNotice: () => Promise.resolve({ notice: null }),
  syncManual: ({ lease }: { lease: string }) => answered(() => {
    if (lease !== native.snapshot.lease) throw rejection("Digest lease changed");
    native.manualLeases.push(lease);
    if (native.incoming !== undefined) {
      native.snapshot = { ...native.snapshot, rows: native.incoming };
      native.incoming = undefined;
      emit("changed", {});
    }
  }),
});

/** A scheduled item the agent keeps for the owner, as `/api/scheduled-tasks` serves it. */
interface ScheduledTask {
  taskId: string;
  kind: string;
  ownerVisible: boolean;
  promptInstructions: string;
  state: { status: string; firedAt?: string; lastDecisionLog?: string };
  trigger: { kind: "once"; atIso: string } | { kind: "cron"; expression: string; tz: string };
  metadata: { recordKey?: string; checkin?: string };
}

export interface WorkflowsScene {
  readonly prompts: Map<string, Prompt>;
  readonly tasks: ScheduledTask[];
  readonly taskActions: Array<{ taskId: string; verb: string }>;
  failTaskFire?: string;
  readonly promptEdits: Record<string, unknown>[];
  readonly admissions: Array<{ submission: string; version: string }>;
  /** Each lifecycle change the agent applied, in order: what it did and the version it was asked on. */
  readonly changes: Array<{ operation: string; version: string }>;
  /** Monthly statement as the agent has it now. */
  statement: Statement;
  /** Workflows the typed builder saved, as the agent lists them, and each save's receipt by its mutation. */
  readonly created: Statement[];
  readonly saves: Map<string, Record<string, unknown>>;
  readonly decisions: Array<{ version: string; digest: string; approved: boolean }>;
  run: boolean;
  stage: "Running" | "Waiting" | "Device" | "Done";
  phoneReview?: WorkflowPhoneReview;
  deviceReceipt?: Promise<void>;
  receiptReads: number;
  approvalTitle: string;
  failingPrompts: boolean;
  hosted?: { entries: DigestResult[]; reads: number; acknowledgements: string[] };
  nativeDigests?: NativeDigestScene;
  nativeNotices?: NativeApprovalNotices;
}

export const workflowsScene = (): WorkflowsScene => ({
  prompts: new Map([["desk-check", {
    id: "desk-check", displayName: "Desk check", instructions: "Check the desk", enabled: true, revision: 1,
    triggerType: "cron", cronExpression: "0 9 * * *", timezone: "UTC",
  }], ["doc-review", {
    id: "doc-review", displayName: "Document review", instructions: "Review the supplied text only.", enabled: false, revision: 1,
    triggerType: "cron", cronExpression: "0 9 * * 1", timezone: "UTC",
  }]]),
  // spec/app/workflows/list.md, "Story: Find a workflow"
  tasks: [{
    taskId: "check-the-draft", kind: "personal-assistant.reminder", ownerVisible: true, promptInstructions: "Check the draft",
    state: { status: "scheduled" }, trigger: { kind: "once", atIso: "2026-12-01T10:00:00.000Z" }, metadata: {},
  }, {
    taskId: "weekly", kind: "recap", ownerVisible: true, promptInstructions: "Weekly review",
    state: { status: "scheduled" }, trigger: { kind: "cron", expression: "0 8 * * *", tz: "UTC" }, metadata: { recordKey: "weekly-review" },
  }],
  taskActions: [],
  promptEdits: [],
  admissions: [], changes: [], statement: { ...record }, created: [], saves: new Map(), decisions: [], run: false, stage: "Done", receiptReads: 0, approvalTitle: "Review the statement preview", failingPrompts: false,
});

function execution(world: WorkflowsScene) {
  return {
    ...receipt,
    finished: world.stage === "Done",
    status: world.stage === "Done" ? "finished" : world.stage === "Waiting" ? "waiting-approval" : "running",
    output: world.stage === "Done" ? receipt.output : "",
    ...(world.stage === "Done" ? {
      stoppedAt: "2026-11-24T07:02:00.000Z",
      events: [{
        type: "NodeFinished", timestamp: "2026-11-24T07:01:00.000Z", nodeId: approvalNode,
        runId: receipt.id, workflowId: record.id,
      }],
    } : {}),
  };
}

function review(world: WorkflowsScene) {
  return {
    runId: receipt.id, workflowId: record.id, workflowVersionId: record.versionId,
    finished: world.stage === "Done", cancellationRequested: false,
    approvals: [{
      runId: receipt.id, workflowId: record.id, workflowVersionId: record.versionId,
      nodeId: approvalNode, iteration: 0, requestDigest: approvalDigest,
      status: world.stage === "Done" || world.stage === "Device" ? "approved" : "pending", expiresAt: 60_000,
      title: world.approvalTitle, operation: "Show preview", summary: "Review this month's statement preview.",
      target: "Monthly statement", account: "This phone", supported: true,
    }],
  };
}

/**
 * The boundaries exercised by Workflows, with one current definition, removed history and an agent-run receipt. Of the
 * notice inbox it answers only the Workflow read (eliza's workflowApprovalOffers) and leaves every other read to the
 * routes after it, such as Reminders'.
 */
export function workflowRoutes(world: WorkflowsScene): Route[] {
  return [
    (request, url) => {
      if (request.method !== "GET") return;
      const runs = /^\/api\/triggers\/([^/]+)\/runs$/.exec(url.pathname);
      if (runs && world.prompts.has(decodeURIComponent(runs[1] ?? ""))) return Response.json({ runs: [] });
      const task = world.tasks.find((one) => url.pathname === `/api/scheduled-tasks/${one.taskId}`);
      if (task !== undefined) return Response.json({ task });
      const prompt = url.pathname.startsWith("/api/triggers/") ? world.prompts.get(decodeURIComponent(url.pathname.slice("/api/triggers/".length))) : undefined;
      if (prompt !== undefined) return Response.json({ trigger: prompt });
      switch (url.pathname) {
        case "/api/notifications": {
          if (url.searchParams.get("nativeTransport") !== "true" || world.nativeNotices === undefined) return;
          const route = { workflowId: record.id, runId: receipt.id, versionId: record.versionId };
          const notifications = world.run && world.stage === "Waiting" ? [{
            category: "workflow", expiresAt: 60_000, data: { ...route, kind: "approval", proposalId: `${approvalNode}:0` },
          }] : world.run && world.stage === "Done" ? [{
            category: "workflow", title: "Monthly statement finished", body: "Open the run to see what it did.",
            data: { ...route, kind: "result" },
          }] : [];
          return Response.json({ serviceStatus: "ready", nativeEpoch: "workflow-fixture", throughSequence: notifications.length,
            nextSequence: notifications.length, complete: true, notifications });
        }
        case "/api/workflow/status": return Response.json({
          engine: "eliza-typed", status: "ready", manualSubmissionProtocol: 1, lifecycleMutationProtocol: 1,
          typedAuthoringProtocol: 1, typedScheduleProtocol: 1, metadataMutationProtocol: 1, approvalReceiptProtocol: 1,
          ...(world.hosted === undefined ? {} : { hostedDigestProtocol: 1 }),
        });
        case "/api/workflow/hosted/loops": return world.hosted && Response.json({ loops: [] });
        case "/api/workflow/hosted/sources": return world.hosted && Response.json({ sources: [] });
        case "/api/workflow/hosted/results": {
          if (world.hosted === undefined) return;
          world.hosted.reads += 1;
          return Response.json({ entries: world.hosted.entries.filter((row) => !world.hosted?.acknowledgements.includes(row.runId)) });
        }
        case "/api/triggers": return world.failingPrompts ? Response.json({}, { status: 503 }) : Response.json({ triggers: [...world.prompts.values()] });
        case "/api/scheduled-tasks": return Response.json({ tasks: world.tasks });
        case "/api/workflow/workflows": return Response.json({ workflows: [...world.statement.removed ? [] : [world.statement], ...world.created] });
        case "/api/workflow/phone/catalog": return Response.json(catalog);
        case "/api/workflow/removed-workflows": return Response.json({ workflows: world.statement.removed ? [world.statement, removed] : [removed] });
        case `/api/workflow/workflows/${record.id}`: return Response.json(world.statement);
        case `/api/workflow/workflows/${removed.id}`: return Response.json(removed);
        case `/api/workflow/workflows/${record.id}/executions`: return Response.json({ executions: world.run ? [execution(world)] : [] });
        case `/api/workflow/workflows/${removed.id}/executions`: return Response.json({ executions: [] });
        case executionPath:
          world.receiptReads += 1;
          return Response.json({ execution: execution(world) });
        case `${executionPath}/approvals`: return Response.json(review(world));
        case `${executionPath}/phone-review`: return world.phoneReview === undefined ? Response.json({}, { status: 404 }) : Response.json(world.phoneReview);
      }
      const saved = world.created.find((one) => url.pathname === `/api/workflow/workflows/${one.id}`);
      if (saved !== undefined) return Response.json(saved);
      if (world.created.some((one) => url.pathname === `/api/workflow/workflows/${one.id}/executions`)) return Response.json({ executions: [] });
      const mutation = url.pathname.startsWith("/api/workflow/phone/mutations/") ? url.pathname.slice("/api/workflow/phone/mutations/".length) : undefined;
      if (mutation !== undefined) return Response.json({ mutationId: mutation, receipt: world.saves.get(mutation) ?? null });
    },
    (request, url) => {
      if (request.method !== "PUT" || !url.pathname.startsWith("/api/triggers/")) return;
      const id = decodeURIComponent(url.pathname.slice("/api/triggers/".length));
      const current = world.prompts.get(id);
      if (!current) return Response.json({}, { status: 404 });
      return readJsonBody(request).then((body) => {
        world.promptEdits.push(body);
        if (current.revision !== body.expectedRevision) return Response.json({}, { status: 409 });
        if (typeof body.enabled === "boolean" && Object.keys(body).length === 2) {
          const trigger = { ...current, enabled: body.enabled, revision: current.revision + 1 };
          world.prompts.set(id, trigger);
          return Response.json({ trigger });
        }
        const timing: PromptTiming | undefined =
          body.triggerType === "once" && typeof body.scheduledAtIso === "string" ? { triggerType: "once", scheduledAtIso: body.scheduledAtIso }
            : body.triggerType === "cron" && typeof body.cronExpression === "string" ? { triggerType: "cron", cronExpression: body.cronExpression }
              : body.triggerType === "event" && typeof body.eventKind === "string" ? { triggerType: "event", eventKind: body.eventKind }
                : undefined;
        if (!timing || typeof body.displayName !== "string" || typeof body.instructions !== "string" || typeof body.timezone !== "string") {
          return Response.json({}, { status: 400 });
        }
        const trigger = {
          id, displayName: body.displayName, instructions: body.instructions, timezone: body.timezone,
          enabled: current.enabled, revision: current.revision + 1, ...timing,
        };
        world.prompts.set(id, trigger);
        return Response.json({ trigger });
      });
    },
    (request, url) => {
      if (request.method !== "POST") return;
      const taskHit = /^\/api\/scheduled-tasks\/([^/]+)\/(fire|reopen|snooze|complete|dismiss|skip)$/.exec(url.pathname);
      if (taskHit !== null) {
        const id = decodeURIComponent(taskHit[1] ?? "");
        const verb = taskHit[2] ?? "";
        const task = world.tasks.find((one) => one.taskId === id);
        if (task === undefined) return Response.json({ error: "not_found" }, { status: 404 });
        world.taskActions.push({ taskId: id, verb });
        if (verb === "fire") {
          if (task.state.status !== "scheduled") return Response.json({ fire: { kind: "raced" } });
          if (world.failTaskFire !== undefined) {
            task.state = { status: "failed", lastDecisionLog: `dispatch_failed: ${world.failTaskFire}` };
            return Response.json({ fire: { kind: "dispatch_failed", task, error: world.failTaskFire } });
          }
          task.state = { status: "fired", firedAt: "2026-11-27T13:05:00.000Z", lastDecisionLog: "fired" };
          return Response.json({ fire: { kind: "fired", task } });
        }
        if (verb === "reopen") {
          if (task.state.status === "dismissed" || task.state.status === "scheduled") return Response.json({ error: "not_applicable" }, { status: 409 });
          task.state = { status: "scheduled", lastDecisionLog: "reopened" };
          return Response.json({ task });
        }
        if (verb === "snooze") {
          task.state = { status: "scheduled", firedAt: "2026-11-27T13:15:00.000Z", lastDecisionLog: "snoozed" };
          return Response.json({ task });
        }
        const next = verb === "complete" ? "completed" : verb === "dismiss" ? "dismissed" : "skipped";
        task.state = { status: next, lastDecisionLog: next };
        return Response.json({ task });
      }
      if (url.pathname === "/api/workflow/hosted/results/ack" && world.hosted !== undefined) {
        const hosted = world.hosted;
        return readJsonBody(request).then((body) => {
          const result = hosted.entries.find((row) => row.runId === body.runId && row.cursor === body.cursor);
          if (result === undefined || typeof body.clientId !== "string") return Response.json({}, { status: 404 });
          hosted.acknowledgements.push(result.runId);
          return Response.json({ acknowledged: result.cursor });
        });
      }
      // spec/app/workflows/builder.md, "Story: Save a workflow on the agent once"
      if (url.pathname === "/api/workflow/phone/validate") {
        return readJsonBody(request).then(async (body) => {
          if (body.catalogRevision !== catalog.catalogRevision || body.compilerRevision !== catalog.compilerRevision) return Response.json({}, { status: 409 });
          return Response.json({ spec: body.spec, specDigest: await digest(body.spec), catalogRevision: catalog.catalogRevision, compilerRevision: catalog.compilerRevision, active: false });
        });
      }
      if (url.pathname === "/api/workflow/phone/workflows") {
        return readJsonBody(request).then(async (body) => {
          const spec = body.spec as { name?: unknown; description?: unknown } | undefined;
          if (typeof body.mutationId !== "string" || typeof spec?.name !== "string" || body.compilerRevision !== catalog.compilerRevision) return Response.json({}, { status: 400 });
          const specDigest = await digest(body.spec);
          const existing = world.saves.get(body.mutationId);
          if (existing !== undefined) return Response.json({ receipt: existing });
          const id = `saved-${world.created.length + 1}`;
          const versionId = `${id}-v1`;
          world.created.push({ ...record, id, versionId, name: spec.name, description: typeof spec.description === "string" ? spec.description : "", active: false, removed: false });
          const receipt = {
            mutationId: body.mutationId, workflowId: id, operation: "create", previousVersionId: null, versionId,
            specDigest, compilerRevision: catalog.compilerRevision, appliedAt: "2026-11-24T09:00:00.000Z",
          };
          world.saves.set(body.mutationId, receipt);
          return Response.json({ receipt });
        });
      }
      if (url.pathname === `${executionPath}/approvals/${approvalNode}/0`) {
        return readJsonBody(request).then(async (body) => {
          if (world.stage !== "Waiting" || body.expectedVersionId !== record.versionId || body.requestDigest !== approvalDigest || typeof body.approved !== "boolean") {
            return Response.json({}, { status: 409 });
          }
          world.decisions.push({ version: body.expectedVersionId, digest: body.requestDigest, approved: body.approved });
          if (!body.approved) {
            world.stage = "Done";
            const out = review(world);
            const first = out.approvals[0];
            if (first !== undefined) first.status = "rejected";
            return Response.json(out, { status: 202 });
          }
          world.stage = world.phoneReview === undefined ? "Done" : "Device";
          await world.deviceReceipt;
          return Response.json(review(world), { status: 202 });
        });
      }
      if (url.pathname !== `/api/workflow/workflows/${record.id}/run`) return;
      return readJsonBody(request).then((body) => {
        if (typeof body.submissionId !== "string" || body.expectedVersionId !== world.statement.versionId || world.statement.removed) return Response.json({}, { status: 409 });
        world.admissions.push({ submission: body.submissionId, version: body.expectedVersionId });
        world.run = true;
        return Response.json({ submissionId: body.submissionId, execution: execution(world) });
      });
    },
    (request, url) => {
      if (request.method !== "POST" || url.pathname !== `/api/workflow/workflows/${record.id}/lifecycle`) return;
      return readJsonBody(request).then((body) => {
        const { mutationId, expectedVersionId, operation } = body;
        if (typeof mutationId !== "string" || (operation !== "remove" && operation !== "restore")) return Response.json({}, { status: 400 });
        const before = world.statement;
        if (expectedVersionId !== before.versionId || (operation === "remove") === before.removed) {
          return Response.json({ code: "WORKFLOW_LIFECYCLE_NOT_APPLIED", workflowId: record.id, mutationId, expectedVersionId }, { status: 409 });
        }
        const versionId = `${record.id}-v${4 + world.changes.length}`;
        world.changes.push({ operation, version: expectedVersionId });
        world.statement = operation === "remove"
          ? { ...before, versionId, active: false, removed: true, triggerCleanup: "complete" }
          : { ...record, versionId, active: false, removed: false };
        return Response.json({
          mutationId,
          receipt: { workflowId: record.id, previousVersionId: expectedVersionId, mutationId, operation, versionId, appliedAt: "2026-11-24T08:00:00.000Z" },
        });
      });
    },
  ];
}
