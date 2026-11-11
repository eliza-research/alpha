import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { checkTraces, qset } from "../check-traces.mjs";
import {
	boundInputs,
	call,
	captureSources,
	checkpoint,
	read,
	trace,
} from "./support.mjs";

const driver = fileURLToPath(import.meta.url);
export async function checkAccountSheet(extraSources = []) {
	const source = "apps/app/src/runtime/connection-ui.tsx";
	const text = read(source);
	const sources = [driver, source, ...extraSources];
	captureSources(sources);
	const handlers = {
		confirm: text.match(
			/className="alpha-account-confirm"[^>]*onClick=\{(\(\)=>\{[^\n]+?\})\}>Sign out<\/button>/,
		)?.[1],
		close: text.match(
			/aria-label="Close Account" onClick=\{(\(\)=>\{[^\n]+?\})\}>/,
		)?.[1],
		askSignOut: text.match(
			/className="alpha-account-signout"[^>]*onClick=\{([^\n]+?)\}>Sign out<\/button>/,
		)?.[1],
		provider: text.match(
			/onClick=\{(\(\)=>\{setAccountSection\('provider'\);[^\n]+?\})\}>/,
		)?.[1],
		back: text.match(
			/aria-label="Back to Account" onClick=\{([^\n]+?)\}>/,
		)?.[1],
		reset: text.match(
			/useEffect\(\(\)=>\{(setAccountSection\(null\);setSignOutAccount\(null\);)\}/,
		)?.[1],
	};
	for (const [name, value] of Object.entries(handlers))
		assert.ok(value, `Current ${name} handler`);
	const traces = [];
	function scenario(name, actions) {
		let owner = 0,
			open = false,
			section = null,
			review = null;
		const removed = [];
		const accounts = [0, 1].map((id) => ({
			environment: "production",
			userId: String(id),
			organizationId: "org",
			credentialId: "key",
			sessionId: `session-${id}`,
		}));
		const state = {
			get signOutAccount() {
				return review;
			},
			get snapshot() {
				return { cloudAccount: accounts[owner] };
			},
			setAccountSection(value) {
				section = value;
			},
			setSignOutAccount(value) {
				review = value;
			},
			dismiss() {
				open = false;
			},
			connectionController: {
				getSnapshot: () => state.snapshot,
				cloudSignOut: () => removed.push(owner),
				refreshProviderStatus() {},
			},
		};
		const execute = (name) =>
			vm.runInNewContext(
				name === "reset" ? `(()=>{${handlers.reset}})` : `(${handlers[name]})`,
				state,
			)();
		const observe = () => ({
			"s.owner": owner,
			"s.open": open,
			"s.section": section ?? "account",
			"s.review": review ? Number(review.userId) : -1,
			"s.removed": qset(removed),
		});
		let capturedConfirm;
		const t = trace(name, observe());
		for (const action of actions) {
			if (action === "show") {
				open = true;
				execute("reset");
			} else if (action === "switchOwner") {
				owner = 1 - owner;
				execute("reset");
			} else if (action === "cancel") execute("close");
			else {
				execute(action);
				if (action === "close") execute("reset");
			}
			if (action === "askSignOut")
				capturedConfirm = vm.runInNewContext(`(${handlers.confirm})`, {
					...state,
					signOutAccount: review,
				});
			checkpoint(t, action, call(action), observe());
			if (action === "switchOwner" && capturedConfirm) {
				capturedConfirm();
				assert.deepEqual(removed, []);
				checkpoint(
					t,
					"stale confirmation cannot sign out the replacement owner",
					null,
					observe(),
				);
			}
		}
		traces.push(t);
	}
	scenario("shared account sections use the current handlers", [
		"show",
		"provider",
		"back",
		"close",
	]);
	scenario("cancel keeps reviewed account", ["show", "askSignOut", "cancel"]);
	scenario("confirmation removes only the reviewed owner", [
		"show",
		"askSignOut",
		"confirm",
	]);
	scenario("account change cancels the previous review", [
		"show",
		"askSignOut",
		"switchOwner",
	]);
	return checkTraces(
		boundInputs({
			model: "AccountSheet",
			sources,
			traces,
			scope: "bounded-component",
			assumptions: [
				"Execute exact current React callbacks and account-change effect against controlled props and state setters. Show and close supply visibility transitions from the host.",
				"Observe account identity, section, review and sign-out dispatch. DOM layout, mode switching, key persistence and billing are separate integration obligations.",
			],
		}),
	);
}
