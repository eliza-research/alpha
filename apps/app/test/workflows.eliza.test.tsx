// @vitest-environment happy-dom
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { Effect, Schema } from "effect";
import { afterEach, beforeAll, expect, it } from "vitest";
import { owned } from "@repo/eliza-harness";
import { Machine as Listing } from "../gen/app__workflows__list.effect.vibe";
import { Machine as Automations } from "../gen/app__workflows__automations.effect.vibe";
import { Machine as Home } from "../gen/app__home.effect.vibe";
import home from "../src/home/index.tsx";
import { Agent } from "../src/platform/index.vibe";
import workflows from "../src/workflows/index.tsx";
import { button, closeAll, drawn, only, openOver, press, underAct, until } from "./alpha.tsx";
import { elizaWorld } from "./eliza/world.vibe";

let elizaHandle: Awaited<ReturnType<typeof owned>>;

underAct();
beforeAll(async () => {
  // spec/app/workflows/automations.md, "Story: Act on an automation": run Morning check-in against the real resident agent and cloud.
  elizaHandle = await owned("workflows");
}, 600_000);
afterEach(closeAll);

const workflowButtons = () => [...document.querySelectorAll<HTMLButtonElement>("ul[aria-label=Workflows] li > button")];
const openWorkflow = (title: string) => drawn(() => {
  const target = workflowButtons().find((item) => item.textContent?.startsWith(title));
  if (target === undefined) throw new Error(`Missing workflow row: ${title}`);
  target.click();
});

const NoticePage = Schema.Struct({
  serviceStatus: Schema.Literal("ready"),
  notifications: Schema.Array(Schema.Struct({ title: Schema.String, body: Schema.String })),
});

// spec/app/workflows/list.md, "Story: Find a workflow"; spec/app/workflows/automations.md, "Story: Act on an automation"; spec/agent/index.md, "The page names the query values each gated route can receive"
it("Runs Morning check-in end-to-end against the real resident agent and delivers its notification", async () => {
  const { alpha } = await openOver(elizaWorld(elizaHandle), only("home", "view:Workflows", "notice"));
  await until(alpha, home.runtime(alpha), Home, (state) => state.tiles.load.status === "Loaded");
  await press("Workflows");
  const area = workflows.runtime(alpha);
  await until(alpha, area, Listing, (state) => state.list.status === "Loaded" && state.complete);

  expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
  expect(workflowButtons().some((item) => item.textContent?.startsWith("Morning check-in"))).toBe(true);

  await openWorkflow("Morning check-in");
  await until(alpha, area, Automations, (state) => state.present && state.list.status === "Loaded" && state.status === "Scheduled");
  expect(button("Run now")).toBeDefined();

  await press("Run now");
  await press("Confirm Run now");
  const dispatched = (state: { list: { status: string }; fired: string; change: { attempt: { outcome: string } } }) =>
    state.list.status === "Loaded" && state.fired === "Dispatched" && state.change.attempt.outcome === "Confirmed";
  await until(alpha, area, Automations, dispatched);

  const rawNotices = await alpha.runtime.runPromise(Effect.flatMap(Agent, (agent) =>
    agent.call(HttpClientRequest.get("/api/notifications?nativeTransport=true"))));
  const page = Schema.decodeUnknownSync(NoticePage)(rawNotices);
  expect(page.notifications.some((notice) => notice.title === "Morning check-in" && notice.body.trim() !== "")).toBe(true);
}, 300_000);
