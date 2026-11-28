// @vitest-environment happy-dom
import { CALENDAR_AVAILABILITY_CAPABILITY, CALENDAR_CAPABILITY } from "@elizaos/plugin-calendar-client";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import assistant from "../src/assistant/index.tsx";
import { MediaReview } from "../src/assistant/media-review.vibe";
import { closeAll, only, openOver, underAct } from "./alpha.tsx";
import { type Answering, readJsonBody } from "./fakes/routes.ts";
import { alphaImage, type Scene, services } from "./fakes/scene.ts";
import { fakeWorld } from "./fakes/world.vibe";

underAct();
afterEach(async () => {
  await closeAll();
});

const ENROLLMENT_KEY = "a".repeat(64);
const ENROLLMENT_ID = "persisted-phone-enrollment";
const OFFERED_CAPABILITIES = [
  "camera.capture-photo.v1",
  "notes.organize.v1",
  CALENDAR_CAPABILITY,
  CALENDAR_AVAILABILITY_CAPABILITY,
  "maps.selected-read.v1",
  "browser.open-direct.v1",
] as const;

interface StatefulDeviceAgent {
  enrolled: boolean;
  enrolledKey: string | undefined;
  bridgeCapabilities: string[];
  calls: string[];
  registeredPayloads: Array<{ capabilities: string[]; workflowProtocol?: number }>;
  revokeStatus: number | undefined;
  registerStatus: number | undefined;
  offerCalendarAvailability(): { ok: true } | { ok: false; code: "device_capability_unavailable" };
  agent: Answering;
}

/**
 * Stateful fake agent matching eliza's `registerDevice` and `revokeEnrollment` behavior:
 * re-registering with the same key while already enrolled leaves `bridgeCapabilities` unchanged,
 * whereas revoking disconnects the bridge so the subsequent register refreshes capabilities.
 */
function createStatefulDeviceAgent(
  world: Scene,
  initial: { enrolled: boolean; bridgeCapabilities: readonly string[] },
): StatefulDeviceAgent {
  const agentId = world.notes.owner;
  const subjectUserId = world.notes.ownerIdentity;
  const fallback = services(world).agent;
  const state: StatefulDeviceAgent = {
    enrolled: initial.enrolled,
    enrolledKey: initial.enrolled ? ENROLLMENT_KEY : undefined,
    bridgeCapabilities: [...initial.bridgeCapabilities],
    calls: [],
    registeredPayloads: [],
    revokeStatus: undefined,
    registerStatus: undefined,
    offerCalendarAvailability() {
      return state.enrolled && state.bridgeCapabilities.includes(CALENDAR_AVAILABILITY_CAPABILITY)
        ? { ok: true }
        : { ok: false, code: "device_capability_unavailable" };
    },
    agent: async (request) => {
      const url = new URL(request.url);
      const prefix = "/api/client-devices/";
      if (!url.pathname.startsWith(prefix)) return fallback(request);
      const resource = url.pathname.slice(prefix.length);
      if (request.method === "GET" && resource === "capabilities") {
        state.calls.push("GET capabilities");
        return Response.json({
          protocol: 1,
          agentId,
          identityId: subjectUserId,
          deviceActions: { protocol: 1, capabilities: [...OFFERED_CAPABILITIES] },
        });
      }
      const headerId = request.headers.get("x-eliza-device-id");
      const headerKey = request.headers.get("x-eliza-device-key");
      const authorized = headerId === agentId && headerKey === ENROLLMENT_KEY;
      if (request.method === "GET" && resource === "context") {
        state.calls.push("GET context");
        if (!authorized || !state.enrolled || state.enrolledKey !== headerKey) {
          return Response.json({ error: "device_unauthorized" }, { status: 401 });
        }
        return Response.json({ agentId, installationId: agentId, enrollmentId: ENROLLMENT_ID, subjectUserId });
      }
      if (request.method === "POST" && resource === "revoke") {
        state.calls.push("POST revoke");
        if (state.revokeStatus !== undefined) {
          return Response.json({ error: "revoke_failed" }, { status: state.revokeStatus });
        }
        if (!authorized || !state.enrolled || state.enrolledKey !== headerKey) {
          return Response.json({ error: "device_unauthorized" }, { status: 401 });
        }
        state.enrolled = false;
        state.bridgeCapabilities = [];
        return Response.json({ revoked: true });
      }
      if (request.method === "POST" && resource === "register") {
        state.calls.push("POST register");
        if (state.registerStatus !== undefined) {
          return Response.json({ error: "register_failed" }, { status: state.registerStatus });
        }
        if (!authorized) {
          return Response.json({ error: "device_unauthorized" }, { status: 401 });
        }
        const body = await readJsonBody(request);
        const sentCapabilities = Array.isArray(body.capabilities)
          ? body.capabilities.filter((item): item is string => typeof item === "string")
          : [];
        const workflowProtocol = typeof body.workflowProtocol === "number" ? body.workflowProtocol : undefined;
        state.registeredPayloads.push({ capabilities: sentCapabilities, workflowProtocol });
        if (!state.enrolled || state.enrolledKey !== headerKey) {
          state.enrolled = true;
          state.enrolledKey = headerKey ?? undefined;
          state.bridgeCapabilities = [...sentCapabilities];
        }
        return Response.json({ installationId: agentId, enrollmentId: ENROLLMENT_ID });
      }
      if (request.method === "GET" && resource === "proposals") {
        state.calls.push("GET proposals");
        if (!authorized || !state.enrolled || state.enrolledKey !== headerKey) {
          return Response.json({ error: "device_unauthorized" }, { status: 401 });
        }
        return Response.json({ proposals: [] });
      }
      return Response.json({ error: "no such route" }, { status: 404 });
    },
  };
  return state;
}

function phoneScene(): Scene {
  const world = alphaImage();
  world.telephony.enrollment = { journal: new Map() };
  return world;
}

function syncedCapabilityKeys() {
  const keys: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (key !== null && key.startsWith("alpha/assistant/device-capabilities/")) {
      keys.push(key);
    }
  }
  return keys;
}

async function openAssistantSession(world: Scene, agent: Answering) {
  const mounts = only("home", "assistant", "view:Calendar");
  const opened = await openOver(fakeWorld(world, { agent }), mounts, world);
  const session = await assistant.runtime(opened.alpha).runPromise(
    Effect.flatMap(MediaReview, (media) => media.session()),
  );
  return { opened, session };
}

async function expectSteadyRestartSkipsRevoke(
  world: Scene,
  deviceAgent: StatefulDeviceAgent,
  prior: Awaited<ReturnType<typeof openAssistantSession>>,
) {
  await prior.opened.close();
  deviceAgent.calls.length = 0;
  const restarted = await openAssistantSession(world, deviceAgent.agent);
  expect(restarted.session).toBeDefined();
  expect(deviceAgent.calls.filter((entry) => entry === "POST revoke")).toHaveLength(0);
  expect(deviceAgent.offerCalendarAvailability()).toEqual({ ok: true });
}

describe('Device capability re-enrollment on upgrade (spec/app/assistant/context.md, "Story: Be offered only what this phone can do")', () => {
  it("revokes and re-registers a persisted enrollment missing synced capabilities, then skips revoke on steady-state restart", async () => {
    const world = phoneScene();
    const deviceAgent = createStatefulDeviceAgent(world, {
      enrolled: true,
      bridgeCapabilities: ["camera.capture-photo.v1", CALENDAR_CAPABILITY],
    });
    expect(deviceAgent.offerCalendarAvailability()).toEqual({ ok: false, code: "device_capability_unavailable" });

    const first = await openAssistantSession(world, deviceAgent.agent);
    expect(first.session).toBeDefined();
    expect(first.session?.capabilities.has(CALENDAR_AVAILABILITY_CAPABILITY)).toBe(true);
    expect(deviceAgent.calls.filter((entry) => entry === "POST revoke")).toHaveLength(1);
    expect(deviceAgent.calls.indexOf("POST revoke")).toBeLessThan(deviceAgent.calls.indexOf("POST register"));
    expect(deviceAgent.bridgeCapabilities).toContain(CALENDAR_AVAILABILITY_CAPABILITY);
    expect(deviceAgent.offerCalendarAvailability()).toEqual({ ok: true });

    const storedKeys = syncedCapabilityKeys();
    expect(storedKeys).toHaveLength(1);
    const storedKey = storedKeys[0];
    expect(storedKey).not.toContain(ENROLLMENT_KEY);
    expect(localStorage.getItem(storedKey)).toContain(CALENDAR_AVAILABILITY_CAPABILITY);
    expect(localStorage.getItem(storedKey)).not.toContain(ENROLLMENT_KEY);

    await expectSteadyRestartSkipsRevoke(world, deviceAgent, first);
  });

  it("revokes and re-registers when stored synced capabilities differ from the current capability list", async () => {
    const world = phoneScene();
    const deviceAgent = createStatefulDeviceAgent(world, {
      enrolled: true,
      bridgeCapabilities: ["camera.capture-photo.v1", CALENDAR_CAPABILITY],
    });

    const seed = await openAssistantSession(world, deviceAgent.agent);
    const [storedKey] = syncedCapabilityKeys();
    expect(storedKey).toBeDefined();
    await seed.opened.close();

    deviceAgent.enrolled = true;
    deviceAgent.bridgeCapabilities = ["camera.capture-photo.v1", CALENDAR_CAPABILITY];
    deviceAgent.calls.length = 0;
    localStorage.setItem(storedKey, `${CALENDAR_CAPABILITY},camera.capture-photo.v1`);
    expect(deviceAgent.offerCalendarAvailability()).toEqual({ ok: false, code: "device_capability_unavailable" });

    const upgraded = await openAssistantSession(world, deviceAgent.agent);
    expect(upgraded.session).toBeDefined();
    expect(deviceAgent.calls.filter((entry) => entry === "POST revoke")).toHaveLength(1);
    expect(deviceAgent.bridgeCapabilities).toContain(CALENDAR_AVAILABILITY_CAPABILITY);
    expect(deviceAgent.offerCalendarAvailability()).toEqual({ ok: true });

    await expectSteadyRestartSkipsRevoke(world, deviceAgent, upgraded);
  });

  it("does not mark capabilities synced on transient revoke or register failure and safely retries without losing identity", async () => {
    const world = phoneScene();
    const deviceAgent = createStatefulDeviceAgent(world, {
      enrolled: true,
      bridgeCapabilities: ["camera.capture-photo.v1", CALENDAR_CAPABILITY],
    });
    deviceAgent.revokeStatus = 503;

    const mounts = only("home", "assistant", "view:Calendar");
    const opened = await openOver(fakeWorld(world, { agent: deviceAgent.agent }), mounts, world);
    const runtime = assistant.runtime(opened.alpha);

    const failedRevoke = await runtime.runPromise(Effect.flatMap(MediaReview, (media) => media.session()));
    expect(failedRevoke).toBeUndefined();
    expect(syncedCapabilityKeys()).toHaveLength(0);
    expect(deviceAgent.enrolled).toBe(true);
    expect(deviceAgent.enrolledKey).toBe(ENROLLMENT_KEY);

    deviceAgent.revokeStatus = undefined;
    deviceAgent.registerStatus = 500;
    const failedRegister = await runtime.runPromise(Effect.flatMap(MediaReview, (media) => media.session()));
    expect(failedRegister).toBeUndefined();
    expect(syncedCapabilityKeys()).toHaveLength(0);
    expect(deviceAgent.enrolled).toBe(false);

    deviceAgent.registerStatus = undefined;
    deviceAgent.calls.length = 0;
    const recovered = await runtime.runPromise(Effect.flatMap(MediaReview, (media) => media.session()));
    expect(recovered).toBeDefined();
    expect(deviceAgent.calls.filter((entry) => entry === "POST revoke")).toHaveLength(0);
    expect(deviceAgent.calls.filter((entry) => entry === "POST register")).toHaveLength(1);
    expect(deviceAgent.enrolled).toBe(true);
    expect(deviceAgent.enrolledKey).toBe(ENROLLMENT_KEY);
    expect(deviceAgent.bridgeCapabilities).toContain(CALENDAR_AVAILABILITY_CAPABILITY);
    expect(deviceAgent.offerCalendarAvailability()).toEqual({ ok: true });
    expect(syncedCapabilityKeys()).toHaveLength(1);
  });

  it("skips revoke on fresh enrollment and persists synced capabilities after registration", async () => {
    const world = phoneScene();
    const deviceAgent = createStatefulDeviceAgent(world, {
      enrolled: false,
      bridgeCapabilities: [],
    });

    const first = await openAssistantSession(world, deviceAgent.agent);
    expect(first.session).toBeDefined();
    expect(deviceAgent.calls.filter((entry) => entry === "POST revoke")).toHaveLength(0);
    expect(deviceAgent.calls.filter((entry) => entry === "POST register")).toHaveLength(1);
    expect(deviceAgent.bridgeCapabilities).toContain(CALENDAR_AVAILABILITY_CAPABILITY);
    expect(syncedCapabilityKeys()).toHaveLength(1);

    await expectSteadyRestartSkipsRevoke(world, deviceAgent, first);
  });
});
