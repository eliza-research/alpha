// @vitest-environment happy-dom
// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"; spec/app/control/index.md, "Story: Enforce formal safety guarantees over external app control"
import { request as nodeRequest } from "node:http";
import { owned } from "@repo/eliza-harness";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { Machine as Ask } from "../gen/app__ask.effect.vibe";
import ask from "../src/ask/index.tsx";
import { askExample, askExampleLines, closeAll, fill, openOver, press, underAct, until } from "./alpha.tsx";
import { elizaWorld } from "./eliza/world.vibe";

type OwnedHarness = Awaited<ReturnType<typeof owned>>;
let mine: OwnedHarness;

interface ControlStatePayload {
  readonly tier: string;
  readonly foreground: {
    readonly snapId: number;
    readonly packageName: string;
    readonly webUri: string | null;
    readonly targetKind: string;
    readonly protection: string;
  };
  readonly lease: {
    readonly leaseId: number;
    readonly packageName: string;
    readonly maxOps: number;
    readonly usedOps: number;
    readonly status: string;
  };
  readonly leaseRequest: {
    readonly packageName: string;
    readonly requestedOp: string;
    readonly requestedAt: number;
  } | null;
  readonly pending: {
    readonly opId: number;
    readonly boundSnapId: number;
    readonly expectedPackage: string;
    readonly op: { readonly type: string };
  } | null;
  readonly killed: boolean;
  readonly recentReceipts: readonly {
    readonly opId: number;
    readonly outcome: string;
    readonly postSnapshotId?: number;
  }[];
}

underAct();
afterEach(closeAll);
beforeAll(async () => {
  // spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease": provision a real local cloud account and resident Node 26 agent.
  mine = await owned("control");
}, 600_000);

async function agentRequest(method: "GET" | "POST", route: string, body?: unknown): Promise<{ readonly status: number; readonly body: unknown }> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = nodeRequest(
      `${mine.agent.origin}${route}`,
      {
        method,
        headers: {
          authorization: `Bearer ${mine.agent.token}`,
          ...(payload === undefined ? {} : { "content-type": "application/json", "content-length": String(Buffer.byteLength(payload)) }),
        },
      },
      (res) => {
        let text = "";
        res.setEncoding("utf8").on("data", (chunk: string) => { text += chunk; }).on("end", () => {
          resolve({ status: res.statusCode ?? 0, body: text === "" ? undefined : JSON.parse(text) as unknown });
        });
      },
    );
    req.once("error", reject).end(payload);
  });
}

function flattenedMessageText(messages: readonly { readonly role: string; readonly content?: unknown }[]): string {
  return messages
    .map((entry) => (typeof entry.content === "string" ? entry.content : JSON.stringify(entry.content ?? "")))
    .join("\n");
}

// spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease"
it('runs the resident agent DEVICE_CONTROL loop with alpha_device_control context, lease approval, postSnapshotId receipt, and safety refusals (spec/app/control/index.md, "Story: Control a third-party app within an owner-approved lease")', async () => {
  const { alpha } = await openOver(elizaWorld(mine), askExample);
  const asking = ask.runtime(alpha);
  await until(alpha, asking, Ask, (state) => state.conversation !== "");

  const obs1 = await mine.agentSays<{ readonly snapshotId: number }>("/api/alpha-control/observe", {
    tier: "TierAccessibility",
    capabilities: ["ui.observe.v1", "ui.act.v1", "app.launch.v1", "ui.screenshot.throttled.v1"],
    packageName: "org.mozilla.firefox",
    activityName: "org.mozilla.fenix.HomeActivity",
    webUri: "https://example.org",
    protection: "ScreenClear",
    windowCount: 1,
    nodes: [
      {
        nodeId: "w1_n0",
        role: "Link",
        text: "More information",
        bounds: { left: 24, top: 320, right: 420, bottom: 392 },
        clickable: true,
        editable: false,
        scrollable: false,
        sensitive: false,
      },
    ],
  });
  const snap1 = obs1.snapshotId;
  expect(snap1).toBeGreaterThan(0);

  const initialState = await mine.agentSays<ControlStatePayload>("/api/alpha/control/state");
  expect(initialState).toMatchObject({
    tier: "TierAccessibility",
    foreground: {
      snapId: snap1,
      packageName: "org.mozilla.firefox",
      webUri: "https://example.org/",
      targetKind: "AllowedApp",
      protection: "ScreenClear",
    },
    leaseRequest: null,
  });

  const prompt1 = "Click More information in Firefox.";
  const reply1 = "I could not click that yet because Firefox needs your permission first.";
  await mine.script({
    kind: "tool",
    name: "DEVICE_CONTROL",
    input: { op: { type: "ui_click", snapshotId: snap1, expectedPackage: "org.mozilla.firefox", nodeId: "w1_n0" } },
  }, prompt1);
  await mine.script({
    kind: "text",
    parts: [`[answer] ${reply1} [reported #1: "${reply1}"]`],
  }, prompt1);
  await fill("Ask Alpha", prompt1);
  await press("Send");
  await until(alpha, asking, Ask, (state) => state.turn.outcome === "Confirmed");

  const askedAfterFirst = await mine.asked();
  const afterLeaseRequired = await mine.agentSays<ControlStatePayload>("/api/alpha/control/state");
  expect(askExampleLines()).toContain(reply1);
  expect(afterLeaseRequired.leaseRequest).toMatchObject({
    packageName: "org.mozilla.firefox",
    requestedOp: "ui_click",
  });

  const sawControlContext = askedAfterFirst.some((messages) => {
    const joined = flattenedMessageText(messages);
    return joined.includes("org.mozilla.firefox")
      && joined.includes("https://example.org/")
      && joined.includes(`snapshotId=${snap1}`)
      && joined.includes("w1_n0")
      && joined.includes("More information");
  });
  expect(sawControlContext).toBe(true);
  expect(afterLeaseRequired.pending).toBeNull();

  const granted = await mine.agentSays<{ readonly lease: ControlStatePayload["lease"] }>("/api/alpha/control/lease", {
    packageName: "org.mozilla.firefox",
    maxOps: 4,
    durationMs: 60_000,
  });
  expect(granted.lease).toMatchObject({
    packageName: "org.mozilla.firefox",
    maxOps: 4,
    status: "LeaseActive",
  });
  const afterGrantState = await mine.agentSays<ControlStatePayload>("/api/alpha/control/state");
  expect(afterGrantState.leaseRequest).toBeNull();

  const prompt2 = "Go ahead and click More information now.";
  await mine.script({
    kind: "tool",
    name: "DEVICE_CONTROL",
    input: { op: { type: "ui_click", snapshotId: snap1, expectedPackage: "org.mozilla.firefox", nodeId: "w1_n0" } },
  }, prompt2);
  await mine.script({
    kind: "text",
    parts: ["[answer] I clicked More information in Firefox."],
  }, prompt2);

  let observedOpId = 0;
  let postSnapshotId = 0;
  const nativeExecutor = vi.waitFor(async () => {
    const next = await mine.agentSays<{ readonly op: ControlStatePayload["pending"] }>("/api/alpha-control/next");
    expect(next.op).not.toBeNull();
    const queued = next.op!;
    expect(queued.expectedPackage).toBe("org.mozilla.firefox");
    expect(queued.boundSnapId).toBe(snap1);
    expect(queued.op.type).toBe("ui_click");
    observedOpId = queued.opId;

    const refreshed = await mine.agentSays<{ readonly snapshotId: number }>("/api/alpha-control/observe", {
      tier: "TierAccessibility",
      capabilities: ["ui.observe.v1", "ui.act.v1", "app.launch.v1", "ui.screenshot.throttled.v1"],
      packageName: "org.mozilla.firefox",
      activityName: "org.mozilla.fenix.HomeActivity",
      webUri: "https://www.iana.org/help/example-domains",
      protection: "ScreenClear",
      windowCount: 1,
      nodes: [
        {
          nodeId: "w1_n1",
          role: "TextView",
          text: "IANA Example Domains",
          bounds: { left: 24, top: 180, right: 640, bottom: 240 },
          clickable: false,
          editable: false,
          scrollable: false,
          sensitive: false,
        },
      ],
    });
    postSnapshotId = refreshed.snapshotId;

    const receipt = await mine.agentSays<{ readonly receipt: { readonly opId: number; readonly postSnapshotId?: number } }>("/api/alpha-control/receipt", {
      opId: queued.opId,
      outcome: "done",
      postSnapshotId,
    });
    expect(receipt.receipt.postSnapshotId).toBe(postSnapshotId);
  }, { timeout: 30_000, interval: 50 });

  await fill("Ask Alpha", prompt2);
  await press("Send");
  await nativeExecutor;
  await until(alpha, asking, Ask, (state) => state.turn.outcome === "Confirmed");
  expect(askExampleLines()).toContain("I clicked More information in Firefox.");

  const afterClickState = await mine.agentSays<ControlStatePayload>("/api/alpha/control/state");
  expect(afterClickState.pending).toBeNull();
  expect(afterClickState.lease.usedOps).toBe(1);
  expect(afterClickState.foreground.snapId).toBe(postSnapshotId);
  expect(afterClickState.recentReceipts).toContainEqual(expect.objectContaining({
    opId: observedOpId,
    outcome: "done",
    postSnapshotId,
  }));

  // spec/app/control/index.md, "Protected screens, blocked apps, stale snapshots, exhausted leases, and engaged kill-switches always refuse dispatch"
  const blockedSettings = await agentRequest("POST", "/api/alpha/control/lease", {
    packageName: "com.android.settings",
    maxOps: 2,
    durationMs: 60_000,
  });
  expect(blockedSettings.status).toBe(403);
  expect(blockedSettings.body).toEqual({ error: "BLOCKED_PACKAGE" });

  const blockedPermissions = await agentRequest("POST", "/api/alpha/control/lease", {
    packageName: "com.android.permissioncontroller",
    maxOps: 2,
    durationMs: 60_000,
  });
  expect(blockedPermissions.status).toBe(403);
  expect(blockedPermissions.body).toEqual({ error: "BLOCKED_PACKAGE" });

  const privateObs = await mine.agentSays<{ readonly snapshotId: number }>("/api/alpha-control/observe", {
    tier: "TierAccessibility",
    capabilities: ["ui.observe.v1", "ui.act.v1"],
    packageName: "org.mozilla.firefox",
    activityName: "org.mozilla.fenix.HomeActivity",
    webUri: "https://private.example.org",
    protection: "PrivateTab",
    windowCount: 1,
    nodes: [],
  });
  const prompt3 = "Click the link in the private tab.";
  const reply3 = "I cannot act while a private tab is showing.";
  await mine.script({
    kind: "tool",
    name: "DEVICE_CONTROL",
    input: { op: { type: "ui_click", snapshotId: privateObs.snapshotId, expectedPackage: "org.mozilla.firefox", nodeId: "w1_n0" } },
  }, prompt3);
  await mine.script({
    kind: "text",
    parts: [`[answer] ${reply3} [reported #1: "${reply3}"]`],
  }, prompt3);
  await fill("Ask Alpha", prompt3);
  await press("Send");
  await until(alpha, asking, Ask, (state) => state.turn.outcome === "Confirmed");
  expect(askExampleLines()).toContain(reply3);
  expect((await mine.agentSays<{ readonly op: unknown }>("/api/alpha-control/next")).op).toBeNull();

  // spec/app/control/index.md, "The kill-switch immediately revokes any active lease, clears any in-flight operation, and signals the native bridge and overlay"
  const clearObs = await mine.agentSays<{ readonly snapshotId: number }>("/api/alpha-control/observe", {
    tier: "TierAccessibility",
    capabilities: ["ui.observe.v1", "ui.act.v1"],
    packageName: "org.mozilla.firefox",
    activityName: "org.mozilla.fenix.HomeActivity",
    webUri: "https://www.iana.org/help/example-domains",
    protection: "ScreenClear",
    windowCount: 1,
    nodes: [],
  });
  const stopped = await mine.agentSays<ControlStatePayload>("/api/alpha/control/stop", { reason: "owner_stop" });
  expect(stopped.killed).toBe(true);
  expect(stopped.lease.status).toBe("LeaseRevoked");
  expect(stopped.pending).toBeNull();
  expect(stopped.leaseRequest).toBeNull();

  const prompt4 = "Scroll down in Firefox.";
  const reply4 = "I stopped acting in Firefox after you pressed stop.";
  await mine.script({
    kind: "tool",
    name: "DEVICE_CONTROL",
    input: { op: { type: "ui_scroll", snapshotId: clearObs.snapshotId, expectedPackage: "org.mozilla.firefox", direction: "down" } },
  }, prompt4);
  await mine.script({
    kind: "text",
    parts: [`[answer] ${reply4} [reported #1: "${reply4}"]`],
  }, prompt4);
  await fill("Ask Alpha", prompt4);
  await press("Send");
  await until(alpha, asking, Ask, (state) => state.turn.outcome === "Confirmed");
  expect(askExampleLines()).toContain(reply4);
  expect((await mine.agentSays<{ readonly op: unknown }>("/api/alpha-control/next")).op).toBeNull();
}, 300_000);
