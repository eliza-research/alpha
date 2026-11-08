import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const root = resolve(import.meta.dirname, "../..");
const compile = (path: string) =>
	stripTypeScriptTypes(readFileSync(resolve(root, path), "utf8"), {
		mode: "transform",
	}).replace(/^import[\s\S]*?;\n/gm, "");
const source = [
	".eliza/client-features/packages/core/src/events.ts",
	".eliza/client-features/packages/core/src/views/view-interact-protocol.ts",
	".eliza/client-features/packages/core/src/views/view-action-handoff.ts",
	".eliza/client-features/packages/core/src/views/completed-action-navigation.ts",
	"apps/app/src/runtime/alpha-client.ts",
	"apps/app/src/runtime/aosp-image.ts",
	"apps/app/src/prototype/mvp-features.ts",
	"apps/app/src/runtime/view-navigation.ts",
]
	.map(compile)
	.join("\n");
async function setup(page: import("@playwright/test").Page) {
	// Native WebView and localhost are secure contexts; about:blank is not.
	await page.route('**/__navigation-fixture',route=>route.fulfill({contentType:'text/html',body:'<main id="screen">Home</main>'}));
	await page.goto('/__navigation-fixture');
	// Targets resolve through Alpha's real product view registry, served by the dev server.
	await page.evaluate(async () => {
		const views = await import("/src/product/alpha-product.ts");
		Object.assign(window, { alphaCanonicalViewId: views.alphaCanonicalViewId, alphaViewKey: views.alphaViewKey, alphaViewPaths: views.alphaViewPaths });
	});
	await page.addScriptTag({
		type: "module",
		content:
			"const browserDevProfile=false; const Capacitor={getPlatform:()=>\"web\",PluginHeaders:[]}; const TELEPHONY_PROFILE_METHOD=\"imageCapability\"; const detectTelephonyProfile=()=>false;\n" +
			source +
			"\nwindow.ViewNavigationClient=ViewNavigationClient;",
	});
	await page.evaluate(() => {
		const win = window as any;
		win.active = true;
		win.current = { view: "home", revision: 1, sensitive: false };
		win.requests = [];
		win.switches = 0;
		win.client = new win.ViewNavigationClient(
			async (path: string, body: unknown) => {
				win.requests.push({ path, body });
				if (path.endsWith("claim")) return { claimId: "owned-claim" };
				return { ok: true, accepted: win.accept !== false };
			},
			() => win.active,
			() => win.current,
		);
		win.attempt = win.client.capture(win.current);
		win.summary = (id = "notes", extra = {}) => ({
			actionName: "VIEWS",
			success: true,
			values: {
				mode: "show",
				viewId: id,
				viewPath: id === "chat" ? "/chat" : `/${id}`,
				viewType: "gui",
				label: id === "chat" ? "Chat" : "Notes",
				completedActionDelivered: false,
				completedActionHandoffId: "owned-handoff",
				navigationPrepared: true,
				navigationBinding: {
					requestId: "owned-handoff",
					clientId: win.client.clientId,
					viewId: id,
					viewType: "gui",
					installationId: "owned-installation",
				},
				...extra,
			},
		});
		win.navigate = async (view: string, current: () => void) => {
			current();
			win.switches++;
			win.current = {
				view,
				revision: win.current.revision + 1,
				sensitive: false,
			};
			document.getElementById("screen")!.textContent =
				view === "home" ? "Home" : "Notes PRIVATE_PERSONAL_CONTENT";
			return true;
		};
	});
}
test("claimed Notes navigation displays the view and reports only IDs and a confirmed switch", async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const win = window as any;
		return win.client.deliver([win.summary()], win.attempt, win.navigate);
	});
	expect(result).toEqual({ status: "delivered", label: "Notes" });
	await expect(page.locator("#screen")).toHaveText(
		"Notes PRIVATE_PERSONAL_CONTENT",
	);
	const state = await page.evaluate(() => {
		const win = window as any;
		return {
			requests: win.requests,
			switches: win.switches,
			metadata: win.client.metadata(win.current),
		};
	});
	expect(state.switches).toBe(1);
	expect(state.requests.map((r: any) => r.path)).toEqual([
		"/api/views/interact-claim",
		"/api/views/interact-result",
	]);
	expect(state.requests[1].body).toMatchObject({
		success: true,
		result: { switched: true },
		claimId: "owned-claim",
	});
	expect(JSON.stringify(state.requests)).not.toContain(
		"PRIVATE_PERSONAL_CONTENT",
	);
	expect(Object.keys(state.metadata).sort()).toEqual([
		"uiView",
		"viewClientId",
		"viewDelivery",
	]);
	const duplicate = await page.evaluate(async () => {
		const win = window as any;
		try {
			await win.client.deliver([win.summary()], win.attempt, win.navigate);
		} catch {}
		return win.switches;
	});
	expect(duplicate).toBe(1);
});
test("Home is an internal destination; a missing acknowledgment never claims delivered", async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const win = window as any;
		win.current = { view: "notes", revision: 2, sensitive: false };
		win.attempt = win.client.capture(win.current);
		win.accept = false;
		return win.client.deliver([win.summary("chat")], win.attempt, win.navigate);
	});
	expect(result).toEqual({ status: "unknown" });
	await expect(page.locator("#screen")).toHaveText("Home");
	expect(await page.evaluate(() => (window as any).switches)).toBe(1);
});
for (const scenario of [
	"owner-change",
	"same-view-new-epoch",
	"cancelled",
	"credential-surface",
	"wrong-client",
	"record-parameters",
	"unavailable-view",
])
	test(`navigation refuses ${scenario} before an effect`, async ({ page }) => {
		await setup(page);
		const state = await page.evaluate(async (scenario) => {
			const win = window as any;
			let summary = win.summary();
			if (scenario === "owner-change") win.active = false;
			if (scenario === "same-view-new-epoch")
				win.current = { ...win.current, revision: 3 };
			if (scenario === "cancelled") win.client.cancel();
			if (scenario === "credential-surface")
				win.current = { ...win.current, sensitive: true };
			if (scenario === "wrong-client")
				summary.values.navigationBinding.clientId = "other-client";
			if (scenario === "record-parameters")
				summary = win.summary("notes", {
					recordId: "private-note",
					condition: "read this first",
				});
			if (scenario === "unavailable-view") summary = win.summary("wallet");
			let refused = false;
			try {
				await win.client.deliver([summary], win.attempt, win.navigate);
			} catch {
				refused = true;
			}
			return { refused, switches: win.switches, requests: win.requests };
		}, scenario);
		expect(state.refused).toBe(true);
		expect(state.switches).toBe(0);
		expect(state.requests).toHaveLength(0);
		await expect(page.locator("#screen")).toHaveText("Home");
	});
test("an owner change while claiming cannot switch or acknowledge under a new session", async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const win = window as any;
		const client = new win.ViewNavigationClient(
			async () => {
				win.active = false;
				return { claimId: "old-session" };
			},
			() => win.active,
			() => win.current,
		);
		const attempt = client.capture(win.current),
			summary = win.summary();
		summary.values.navigationBinding.clientId = client.clientId;
		let refused = false;
		try {
			await client.deliver([summary], attempt, win.navigate);
		} catch {
			refused = true;
		}
		return { refused, switches: win.switches };
	});
	expect(result).toEqual({ refused: true, switches: 0 });
});

test("a shell switch failure settles the exact claim without claiming delivery", async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const win = window as any;
		const receipt = await win.client.deliver(
			[win.summary()],
			win.attempt,
			async () => {
				throw Error("private shell failure");
			},
		);
		return { receipt, requests: win.requests, switches: win.switches };
	});
	expect(result.receipt).toEqual({ status: "unknown" });
	expect(result.switches).toBe(0);
	expect(result.requests[1].body).toMatchObject({
		success: false,
		result: { switched: false },
		claimId: "owned-claim",
	});
	expect(JSON.stringify(result.requests)).not.toContain(
		"private shell failure",
	);
});

test("an owner change during acknowledgment cannot report delivery in the replacement session", async ({
	page,
}) => {
	await setup(page);
	const result = await page.evaluate(async () => {
		const win = window as any;
		const client = new win.ViewNavigationClient(
			async (path: string) => {
				if (path.endsWith("claim")) return { claimId: "owned-claim" };
				win.active = false;
				return { ok: true, accepted: true };
			},
			() => win.active,
			() => win.current,
		);
		const attempt = client.capture(win.current),
			summary = win.summary();
		summary.values.navigationBinding.clientId = client.clientId;
		return client.deliver([summary], attempt, win.navigate);
	});
	expect(result).toEqual({ status: "unknown" });
});

for (const [registered, local] of [["inbox","inbox"],["calendar","calendar"],["browser","browser"],["camera","camera"],["photos","photos"],["maps","maps"],["notes","notes"],["files","files"],["automations","workflows"],["settings","settings"]])
 test(`canonical ${registered} handoff retains its binding and opens Alpha ${local}`, async ({page}) => {
  await setup(page);
  const value=await page.evaluate(async ({registered})=>{const win=window as any;const summary=win.summary(registered);const result=await win.client.deliver([summary],win.attempt,win.navigate);return {result,view:win.current.view,metadata:win.client.metadata(win.current),requests:win.requests};},{registered});
  expect(value.result.status).toBe('delivered');expect(value.view).toBe(local);expect(value.metadata.uiView).toBe(registered);expect(value.requests[0].body.viewId).toBe(registered);expect(value.requests[1].body).toMatchObject({viewId:registered,success:true,result:{switched:true}});
 });
for (const path of ['/workflows','/automations/extra','https://unexpected.invalid/automations'])
 test(`Automations alias still refuses noncanonical path ${path}`,async ({page})=>{
  await setup(page);const result=await page.evaluate(async path=>{const win=window as any;let refused=false;try{await win.client.deliver([win.summary('automations',{viewPath:path})],win.attempt,win.navigate);}catch{refused=true;}return {refused,requests:win.requests,switches:win.switches};},path);expect(result).toEqual({refused:true,requests:[],switches:0});
 });
for(const id of ['phone','messages','contacts','wallet'])
 test(`canonical navigation keeps deferred MVP ${id} unavailable`,async({page})=>{
  await setup(page);const result=await page.evaluate(async id=>{const win=window as any;let refused=false;try{await win.client.deliver([win.summary(id)],win.attempt,win.navigate);}catch{refused=true;}return {refused,requests:win.requests,switches:win.switches};},id);expect(result).toEqual({refused:true,requests:[],switches:0});
 });
