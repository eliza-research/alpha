import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { checkTraces } from "../check-traces.mjs";
import {
	boundInputs,
	call,
	captureSources,
	checkpoint,
	read,
	trace,
} from "./support.mjs";

const driver = fileURLToPath(import.meta.url);
export async function checkVoiceTranscriptFollow(extraSources = []) {
	const source = "apps/app/src/prototype/model.js",
		text = read(source);
	const start = text.indexOf("  beginVoiceScrollFollow() {"),
		end = text.indexOf("  componentDidUpdate(", start);
	assert.ok(start >= 0 && end > start);
	const marker = "    var newTurn = voiceTurn ||";
	const methods = text
		.slice(start, end)
		.replace(marker, "    port.voiceTurn = Boolean(voiceTurn);\n" + marker);
	assert.notEqual(methods, text.slice(start, end));
	const sources = [driver, source, ...extraSources];
	captureSources(sources);
	const traces = [];
	function scenario(name, actions) {
		const port = { voiceTurn: false };
		let atBottom = false,
			selecting = false,
			current = true,
			follows = 0;
		const list = {
			scrollHeight: 1000,
			clientHeight: 200,
			get scrollTop() {
				return atBottom ? 800 : 0;
			},
			querySelectorAll: () => [],
			getBoundingClientRect: () => ({ top: 0, height: 200 }),
		};
		const context = {
			port,
			document: { querySelector: () => list },
			window: { getSelection: () => ({ isCollapsed: !selecting }) },
		};
		const Shell = vm.runInNewContext("(class {" + methods + "})", context);
		const shell = new Shell();
		shell.state = { chat: "input", msgs: [] };
		shell.S = () => shell.state;
		let previous = structuredClone(shell.state);
		const observe = () => ({
			"s.open": ["sheet", "full"].includes(shell.state.chat),
			"s.pending": !!shell.voiceScrollPending,
			"s.opened": !!shell.voiceScrollOpened,
			"s.current": current,
			"s.selecting": selecting,
			"s.follows": follows,
			"s.follow": port.voiceTurn,
		});
		const t = trace(name, observe());
		for (const action of actions) {
			port.voiceTurn = false;
			if (action.startsWith("begin")) {
				shell.state.chat = action === "beginMinimized" ? "input" : "sheet";
				atBottom = action === "beginAtBottom";
				shell.beginVoiceScrollFollow();
				shell.state.chat = "sheet";
				previous = structuredClone(shell.state);
			}
			if (action === "accept")
				shell.followVoiceTurn("conversation", "spoken words");
			if (action.startsWith("deliver"))
				shell.state.msgs = [
					{
						from: "user",
						id: "new",
						text:
							action === "deliverOtherText" ? "other words" : "spoken words",
						messageBinding: {
							conversationId:
								action === "deliverOtherConversation"
									? "other"
									: "conversation",
						},
					},
				];
			if (action === "readHistory" || action === "selectText") {
				atBottom = false;
				selecting = action === "selectText";
				shell.cancelVoiceScrollFollow();
			}
			if (action === "changeAccount") {
				current = false;
				shell.cancelVoiceScrollFollow();
			}
			if (action === "close") {
				shell.state.chat = "input";
				shell.cancelVoiceScrollFollow();
			}
			if (action === "render") {
				shell.getSnapshotBeforeUpdate({}, previous);
				if (port.voiceTurn) follows++;
				previous = structuredClone(shell.state);
			}
			checkpoint(t, action, call(action), observe());
		}
		traces.push(t);
	}
	scenario("acceptance precedes delivery", [
		"beginMinimized",
		"accept",
		"render",
		"deliver",
		"render",
	]);
	scenario("delivery precedes acceptance", [
		"beginMinimized",
		"deliver",
		"render",
		"accept",
		"render",
	]);
	scenario("one accepted turn scrolls once", [
		"beginAtBottom",
		"accept",
		"deliver",
		"render",
		"render",
	]);
	scenario("manual reading before acceptance", [
		"beginMinimized",
		"readHistory",
		"accept",
		"deliver",
		"render",
	]);
	scenario("text selection after acceptance", [
		"beginMinimized",
		"accept",
		"selectText",
		"deliver",
		"render",
	]);
	scenario("history reader keeps position", [
		"beginInHistory",
		"accept",
		"deliver",
		"render",
	]);
	scenario("another conversation is ignored", [
		"beginMinimized",
		"accept",
		"deliverOtherConversation",
		"render",
	]);
	scenario("other text is ignored", [
		"beginMinimized",
		"accept",
		"deliverOtherText",
		"render",
	]);
	scenario("changed account retires intent", [
		"beginMinimized",
		"accept",
		"changeAccount",
		"deliver",
		"render",
	]);
	scenario("closed chat retires intent", [
		"beginMinimized",
		"accept",
		"close",
		"deliver",
		"render",
	]);
	return checkTraces(
		boundInputs({
			model: "VoiceTranscriptFollow",
			sources,
			traces,
			scope: "bounded-component",
			assumptions: [
				"Execute actual shell voice-follow and snapshot methods. An observation-only seam records the computed voiceTurn before ordinary scrolling is combined with it.",
				"Controlled transcript geometry, selection, delivery order and lifecycle cancellation. Audio recognition, React commits, real focus and physical scrolling need separate browser evidence.",
			],
		}),
	);
}
