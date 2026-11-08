import fs from "node:fs";
import path from "node:path";
import { verifyCommittedWorkspace } from "../vendor/eliza/packages/app/scripts/lib/immutable-workspace-source.mjs";

/** Authenticate vendor bytes before resolving or compiling consumer source. */
export function verifyPinnedUpstream(root) {
	const { commit } = JSON.parse(
		fs.readFileSync(path.join(root, "upstream.lock.json"), "utf8"),
	);
	const directory = path.join(root, "vendor/eliza");
	verifyCommittedWorkspace(directory, commit, {
		// These six Gradle projects are modules of android/consumer-host.json. Tracked
		// files are always authenticated, including files inside output directories.
		generatedDirectories: [
			"system",
			"camera",
			"location",
			"network-policy",
			"calendar",
			"reminders",
		].map((name) => `plugins/plugin-native-${name}/android/build`),
	});
	return { directory, commit };
}

export const REACHABILITY_RECORD = "scripts/ci/upstream-reachability.json";
const sha40 = /^[0-9a-f]{40}$/;

/**
 * Judge a recorded GitHub compare of `<base>...<pin>` without the network.
 * The pin is reachable from develop only when the compare is "identical" or
 * "behind" (aheadBy 0): every pinned commit is then already on develop.
 */
export function assessDevelopReachability(record, pin) {
	if (!record || typeof record !== "object")
		return { ok: false, reachable: false, reason: "missing", message: `No recorded develop compare in ${REACHABILITY_RECORD}.` };
	const valid =
		record.schema === 1 &&
		typeof record.base === "string" && record.base &&
		sha40.test(record.head ?? "") &&
		sha40.test(record.mergeBase ?? "") &&
		["identical", "behind", "ahead", "diverged"].includes(record.status) &&
		Number.isInteger(record.aheadBy) && record.aheadBy >= 0 &&
		Number.isInteger(record.behindBy) && record.behindBy >= 0 &&
		Array.isArray(record.pinOnlyCommits) &&
		record.pinOnlyCommits.every((row) => sha40.test(row?.sha ?? "") && typeof row.subject === "string");
	if (!valid)
		return { ok: false, reachable: false, reason: "invalid", message: `${REACHABILITY_RECORD} is malformed.` };
	const consistent =
		(record.status === "identical") === (record.aheadBy === 0 && record.behindBy === 0) &&
		(record.aheadBy === 0) === ["identical", "behind"].includes(record.status) &&
		// Merge commits are not listed, so an ahead pin may have no non-merge commits.
		(record.aheadBy > 0 || record.pinOnlyCommits.length === 0) &&
		record.pinOnlyCommits.length <= record.aheadBy;
	if (!consistent)
		return { ok: false, reachable: false, reason: "invalid", message: `${REACHABILITY_RECORD} status, counts and commit list disagree.` };
	if (record.head !== pin)
		return {
			ok: false, reachable: false, reason: "stale",
			message: `Recorded ${record.base} compare is for ${record.head.slice(0, 12)}, not the pin ${pin.slice(0, 12)}; rerun node scripts/verify-upstream.mjs --record-reachability.`,
		};
	if (record.aheadBy === 0)
		return { ok: true, reachable: true, reason: "reachable", message: `${record.base} reaches the pin ${pin.slice(0, 12)} (${record.status}, recorded ${record.recordedAt ?? "unknown date"}).` };
	const list = record.pinOnlyCommits.map((row) => `  ${row.sha.slice(0, 10)} ${row.subject}`).join("\n");
	return {
		ok: false, reachable: false, reason: "unreachable",
		message: `${record.base} cannot reach the pin ${pin.slice(0, 12)}: ${record.status}, ${record.aheadBy} pin-only commit(s) (${record.pinOnlyCommits.length} non-merge), ${record.behindBy} behind (recorded ${record.recordedAt ?? "unknown date"}).\n${list}`,
	};
}

/** "fail", "warn" (default) or "off", from --upstream-reachability=<mode> or ELIZA_UPSTREAM_REACHABILITY. */
export function reachabilityMode(argv = [], env = {}) {
	const flag = argv.find((arg) => arg.startsWith("--upstream-reachability="));
	const value = flag ? flag.slice("--upstream-reachability=".length) : env.ELIZA_UPSTREAM_REACHABILITY || "warn";
	if (!["fail", "warn", "off"].includes(value))
		throw new Error(`Upstream reachability mode must be fail, warn or off, not ${JSON.stringify(value)}`);
	return value;
}

export function readReachabilityRecord(root) {
	const file = path.join(root, REACHABILITY_RECORD);
	if (!fs.existsSync(file)) return null;
	try {
		return JSON.parse(fs.readFileSync(file, "utf8"));
	} catch {
		return {};
	}
}
