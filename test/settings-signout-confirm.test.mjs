import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(process.env.ALPHA_CONNECTION_SOURCE || "apps/app/src/runtime/connection-ui.tsx", "utf8");
const confirm = source.match(
	/className="alpha-account-confirm"[^>]*onClick=\{(\(\)=>\{[^\n]+?\})\}>Sign out<\/button>/,
)?.[1];
const close = source.match(
	/aria-label="Close Account" onClick=\{(\(\)=>\{[^\n]+?\})\}>/,
)?.[1];
assert.ok(confirm, "Account sheet sign-out confirmation handler");
assert.ok(close, "Account sheet close handler");

const account = {
	environment: "production",
	userId: "owner",
	organizationId: "org",
	credentialId: "credential",
	sessionId: "session",
};
function fixture(current = account) {
	const calls = [];
	const state = {
		signOutAccount: account,
		setSignOutAccount(value) {
			state.signOutAccount = value;
		},
		dismiss() {
			calls.push("dismiss");
		},
		connectionController: {
			getSnapshot: () => ({ cloudAccount: current }),
			cloudSignOut: () => {
				calls.push("sign-out");
			},
		},
	};
	return {
		calls,
		state,
		run: (callback) => vm.runInNewContext(`(${callback})`, state)(),
	};
}

test("closing sign-out confirmation keeps the account", () => {
	const f = fixture();
	f.run(close);
	assert.equal(f.state.signOutAccount, null);
	assert.deepEqual(f.calls, []);
});

test("confirmation signs out the reviewed account once", () => {
	const f = fixture();
	f.run(confirm);
	f.run(confirm);
	assert.equal(f.state.signOutAccount, null);
	assert.deepEqual(f.calls, ["sign-out"]);
});

for (const field of Object.keys(account)) {
	test(`a changed ${field} preserves the current account`, () => {
		const f = fixture({ ...account, [field]: "replacement" });
		f.run(confirm);
		assert.deepEqual(f.calls, []);
	});
}

test("an absent current account is not signed out again", () => {
	const f = fixture(null);
	f.run(confirm);
	assert.deepEqual(f.calls, []);
});
