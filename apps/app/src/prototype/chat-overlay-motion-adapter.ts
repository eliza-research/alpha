import {
	clamp01,
	OVERLAY_EASE,
} from "../../../../.eliza/client-features/packages/ui/src/components/shell/chat-overlay-motion.ts";
import { resolveChatPanelLayout } from "../../../../.eliza/client-features/packages/ui/src/components/shell/chat-panel-layout.ts";
import {
	DEFAULT_PULL_DISTANCE,
	TAP_SLOP,
} from "../../../../.eliza/client-features/packages/ui/src/gestures/constants";
import { isEditing, keyboardFreeHeight } from "../runtime/canvas-geometry";
import { visibleDocks } from "../runtime/dock-clearance";

const SHEET_EASE = `cubic-bezier(${OVERLAY_EASE.join(",")})`;
const PANEL_TRANSITION = `height .42s ${SHEET_EASE}, border-radius .42s, opacity .2s`;
/** A tap opening or closing from the bar changes height only; the sheet is opaque throughout. */
const RESIZE_TRANSITION = `height .42s ${SHEET_EASE}, border-radius .42s, opacity .12s linear`;
/** How long a tap close keeps the sheet's composer, then fades it to show the bar in its place. */
const CLOSE_MS = 400;
const CLOSE_FADE_MS = 120;
/** Android may deliver the click in a later gesture task after pointerup. */
const SCRIM_CLICK_WAIT_MS = 350;
type Shell = any;
type ScrimPress = {
	id: number;
	x: number;
	y: number;
	moved: boolean;
	dock?: {
		owner: HTMLElement;
		released: boolean;
		timer?: ReturnType<typeof setTimeout>;
		current(): boolean;
		dispose(): void;
	};
};

function clearScrimPress(shell: Shell) {
	const press: ScrimPress | undefined = shell.chatScrimPress;
	shell.chatScrimPress = undefined;
	press?.dock?.dispose();
}

function watchDockScrimPress(shell: Shell, owner: HTMLElement, press: ScrimPress) {
	const check = (records: MutationRecord[]) => {
		if (shell.chatScrimPress !== press) return false;
		// An inert removal records earlier coverage even if the dialog opened
		// and closed before this observer or a late event could run.
		const lost = records.some(record => record.attributeName === "inert" &&
			record.oldValue !== null && (record.target as Element).contains(owner));
		if (owner.isConnected && owner.dataset.alphaDockScrim === "true" &&
			!owner.closest("[inert]") && !document.querySelector("dialog:modal") && !lost)
			return true;
		clearScrimPress(shell);
		if (!document.activeElement?.matches("[data-alpha-composer]")) shell.chatInputFocused = false;
		return false;
	};
	const observer = new MutationObserver(check);
	// showModal focuses inside the top layer synchronously, including when the
	// dialog closes in the same task. A nonmodal open does not take this lease.
	const focus = () => { check(observer.takeRecords()); };
	const dock: NonNullable<ScrimPress["dock"]> = {
		owner,
		released: false,
		current: () => check(observer.takeRecords()),
		dispose() {
			observer.disconnect();
			document.removeEventListener("focusin", focus, true);
			clearTimeout(dock.timer);
			if (owner.hasPointerCapture(press.id)) owner.releasePointerCapture(press.id);
		},
	};
	observer.observe(document.documentElement, {
		subtree: true,
		attributeOldValue: true,
		attributeFilter: ["inert", "open"],
	});
	document.addEventListener("focusin", focus, true);
	return dock;
}

// chat-release:begin (dependency-free)
type Mode = "hidden" | "input" | "sheet" | "full";
type Sample = { y: number; t: number };
/** How close to the collapsed form or the top a release must land to snap there, in canvas pixels. */
export const CHAT_SNAP_ZONE = 120;
/** Finger speed at release, in canvas pixels per millisecond, that makes a drag a flick. */
export const CHAT_FLICK_VELOCITY = 1;
/** Only this much of the end of a drag counts toward its release speed. */
const FLICK_WINDOW_MS = 100;
/** A finger held still this long before lifting has not flicked, however fast it got there. */
const FLICK_HOLD_MS = 80;
/** A remembered sheet never rests shorter than this: the keyboard can shrink its screen. */
const SHEET_MIN_HEIGHT = 200;

/**
 * The end of a drag that counts toward its release speed: how far the finger rose, in pixels, over
 * how many milliseconds. The run is zero when the finger had stopped or nothing older was sampled.
 */
export function flickSpan(track: Sample[], time: number): { rise: number; run: number } {
	//@ verify
	//@ ensures \result.run >= 0
	//@ ensures \result.run === 0 ==> \result.rise === 0
	//@ ensures track.length === 0 ==> \result.run === 0
	//@ ensures track.length > 0 && time - track[track.length - 1].t > 80 ==> \result.run === 0
	//@ ensures track.length > 0 && forall(k, 0 <= k && k < track.length ==> track[k].t >= track[track.length - 1].t) ==> \result.run === 0
	//@ ensures \result.run > 0 ==> \result.run <= 100
	//@ ensures \result.run > 0 ==> exists(k, 0 <= k && k < track.length && \result.run === track[track.length - 1].t - track[k].t && \result.rise === track[k].y - track[track.length - 1].y)
	const last: Sample | undefined = track[track.length - 1];
	if (!last || time - last.t > FLICK_HOLD_MS) return { rise: 0, run: 0 };
	const end = last.t;
	const first = track.find((sample) => end - sample.t <= FLICK_WINDOW_MS);
	return first && end > first.t ? { rise: first.y - last.y, run: end - first.t } : { rise: 0, run: 0 };
}

/** Upward speed at release in pixels per millisecond; zero when the finger had stopped. */
export function releaseVelocity(track: Sample[], time: number): number {
	const { rise, run } = flickSpan(track, time);
	return run > 0 ? rise / run : 0;
}

/** The open sheet's resting height: the share of the screen it was left at, else the default. */
export function restingHeight(share: number | undefined, full: number, half: number): number {
	if (!share) return half;
	return clampSheetHeight(Math.round(share * full), full, half);
}

/** A remembered height held between the shortest usable sheet and the full screen. */
export function clampSheetHeight(rounded: number, full: number, half: number): number {
	//@ verify
	//@ requires 0 < half && half <= full
	//@ ensures \result <= full
	//@ ensures \result >= 200 || \result >= half
	//@ ensures half <= 200 ==> \result >= half
	//@ ensures half >= 200 ==> \result >= 200
	//@ ensures rounded >= 200 && rounded <= full ==> \result === rounded
	//@ ensures rounded > full ==> \result === full
	return Math.min(full, Math.max(rounded, Math.min(SHEET_MIN_HEIGHT, half)));
}

/**
 * Where a released chat goes. An open chat stays at the released height unless it is near the
 * collapsed form or the top; a flick jumps. From the collapsed form a pull down dismisses, and a
 * pull up opens at the released height, or at the remembered one (no height) if it is still low.
 * Home always keeps its bar: there every collapse, and a pull down on the bar itself, settles on
 * the input bar and never on the pill.
 */
type ReleaseOptions = {
	mode: Mode;
	direction: "up" | "down";
	height: number;
	floor: number;
	full: number;
	flick: boolean;
	/** Home is shown, with its own chat bar. */
	home: boolean;
};
export function chatRelease(options: ReleaseOptions): { chat: "hidden" | "input" | "sheet" | "full"; height?: number } {
	//@ verify
	//@ requires options.floor <= options.full
	//@ ensures \result.chat === "hidden" || \result.chat === "input" || \result.chat === "sheet" || \result.chat === "full"
	//@ ensures options.home ==> \result.chat !== "hidden"
	//@ ensures \result.chat === "input" ==> options.home
	//@ ensures (options.mode === "input" || options.mode === "hidden") && options.direction === "down" && !options.home ==> \result.chat === "hidden"
	//@ ensures (options.mode === "input" || options.mode === "hidden") && options.direction === "down" && options.home ==> \result.chat === "input"
	//@ ensures (options.mode === "input" || options.mode === "hidden") && options.direction === "up" ==> \result.chat !== "hidden"
	//@ ensures (options.mode === "sheet" || options.mode === "full") && options.flick && options.direction === "up" ==> \result.chat === "full"
	//@ ensures (options.mode === "sheet" || options.mode === "full") && options.flick && options.direction === "down" && !options.home ==> \result.chat === "hidden"
	//@ ensures (options.mode === "sheet" || options.mode === "full") && options.flick && options.direction === "down" && options.home ==> \result.chat === "input"
	//@ ensures \result.height !== undefined ==> \result.chat === "sheet" && \result.height === options.height
	//@ ensures \result.height !== undefined ==> options.floor < options.height && options.height < options.full
	//@ ensures \result.height !== undefined ==> options.height > options.floor + 120 || options.height > options.floor + (options.full - options.floor) / 3
	//@ ensures \result.height !== undefined ==> options.height < options.full - 120 || options.height < options.full - (options.full - options.floor) / 3
	//@ ensures (options.mode === "sheet" || options.mode === "full") && !options.flick && options.height > options.floor + 120 && options.height < options.full - 120 ==> \result.chat === "sheet" && \result.height !== undefined
	//@ ensures (options.mode === "input" || options.mode === "hidden") && options.direction === "up" && !options.flick && options.height > options.floor + 120 && options.height < options.full - 120 ==> \result.chat === "sheet" && \result.height !== undefined
	const { mode, direction, height, floor, full, flick, home } = options;
	// The form a collapse settles in: Home's bar stays, any other surface may go to the pill.
	const collapsed = home ? "input" : "hidden";
	// The snap zone is the smaller of CHAT_SNAP_ZONE and a third of the travel.
	const third = (full - floor) / 3,
		roomy = CHAT_SNAP_ZONE < third;
	const nearTop = roomy ? height >= full - CHAT_SNAP_ZONE : height >= full - third,
		nearFloor = roomy ? height <= floor + CHAT_SNAP_ZONE : height <= floor + third;
	if (mode === "sheet" || mode === "full") {
		if (flick) return { chat: direction === "up" ? "full" : collapsed };
		if (nearFloor) return { chat: collapsed };
		return nearTop ? { chat: "full" } : { chat: "sheet", height };
	}
	if (direction === "down") return { chat: collapsed };
	if (nearTop) return { chat: "full" };
	return flick || nearFloor ? { chat: "sheet" } : { chat: "sheet", height };
}
// chat-release:end
type Drag = {
	id: number;
	owner: HTMLElement;
	mode: Mode;
	view: unknown;
	screen: unknown;
	/** The drag began on Home, whose bar stays in place when pulled down. */
	home: boolean;
	offset: number;
	y: number;
	scale: number;
	start: number;
	height: number;
	full: number;
	half: number;
	floor: number;
	track: Sample[];
	flick?: "up" | "down";
	moved: boolean;
	/** The sheet opacity last rendered, which a direct paint must be restored to. */
	renderedOpacity?: string;
	tap?: () => void;
};
/** The sheet never paints shorter than its composer, which stays where the bar rests. */
function paintedHeight(d: Drag): number {
	return d.height > 0 ? Math.max(d.height, d.floor) : 0;
}
/**
 * How far an open chat dragged toward its collapsed form has handed over to it, 0 to 1. It
 * runs across the release's snap zone, so any visible bar or pill means release collapses.
 */
function collapseShare(d: Drag): number {
	if (d.mode !== "sheet" && d.mode !== "full") return 0;
	const zone = Math.min(CHAT_SNAP_ZONE, (d.full - d.floor) / 3);
	return clamp01((d.floor + zone - d.height) / Math.max(1, zone));
}
/** Sheet rows above the composer that appear only once the sheet has room for all of them. */
const SHEET_ROWS = "[data-alpha-chat-header],[data-alpha-chat-suggestions]";
/** Travel over which a row that has just fit fades in, in canvas pixels. */
const ROW_REVEAL = 16;
/**
 * The pinned composer leaves rows above it to clip at the sheet's top edge. Each row stays
 * hidden until it fits below that edge, so the header is never shown cut off.
 */
function revealRows(panel: HTMLElement, scale: number) {
	const top = panel.getBoundingClientRect().top;
	// The header rests under the status-bar spacer; once it fits, the transcript below it takes
	// any further height, so that is the room it has been given since.
	const spacer =
		panel.querySelector<HTMLElement>("[data-alpha-chat-top]")?.offsetHeight ?? 0;
	const transcript =
		panel.querySelector<HTMLElement>("[data-alpha-transcript]")?.offsetHeight ?? 0;
	for (const row of panel.querySelectorAll<HTMLElement>(SHEET_ROWS)) {
		const header = row.matches("[data-alpha-chat-header]");
		let room = (row.getBoundingClientRect().top - top) / scale - (header ? spacer : 0);
		if (header && room > -0.5) room = transcript;
		row.style.opacity = String(clamp01(room / ROW_REVEAL));
	}
}
/** The sheet's composer block, from its top to the sheet's bottom edge, in canvas pixels. */
function composerBlock(panel: HTMLElement, scale: number): number {
	const composer = panel.querySelector<HTMLElement>(".alpha-chat-composer");
	if (!composer) return 0;
	return (
		(panel.getBoundingClientRect().bottom -
			composer.getBoundingClientRect().top) /
		scale
	);
}
/**
 * Keeps sheet rows hidden until they fit while the sheet's height animates, then hands them
 * back to the template once an open sheet has settled.
 */
function revealWhileResizing(shell: Shell, scale: number) {
	const token = (shell.chatRevealToken = (shell.chatRevealToken || 0) + 1);
	const end = performance.now() + 480;
	const frame = () => {
		const panel = document.querySelector<HTMLElement>(
			'[data-alpha-layer="conversation"]',
		);
		if (!panel || shell.chatRevealToken !== token || shell.chatMotion) return;
		if (performance.now() < end) {
			revealRows(panel, scale);
			requestAnimationFrame(frame);
			return;
		}
		const mode = shell.S().chat;
		if (mode === "sheet" || mode === "full")
			for (const row of panel.querySelectorAll<HTMLElement>(SHEET_ROWS))
				row.style.removeProperty("opacity");
	};
	const panel = document.querySelector<HTMLElement>(
		'[data-alpha-layer="conversation"]',
	);
	if (panel) revealRows(panel, scale);
	requestAnimationFrame(frame);
}
/** Direct style for the bar or pill while a drag is moving. */
function dockStyle(d: Drag): Record<string, string> {
	const still = { transition: "none", animation: "none" };
	// Pulling the bar down dismisses it to the pill: the bar follows the finger out.
	// Home's bar is never dismissed, so it stays where it rests.
	if (d.mode === "input" && d.height === 0 && !d.home) {
		const down = -d.offset / d.scale;
		return {
			...still,
			transform: `translateY(${down}px)`,
			opacity: String(1 - clamp01(Math.abs(down) / Math.max(80, d.half))),
		};
	}
	if (d.mode === "input" || d.mode === "hidden")
		return { ...still, transform: "none", opacity: d.height > 0 ? "0" : "1" };
	return { ...still, transform: "none", opacity: String(collapseShare(d)) };
}
/** The nearest ancestor that scrolls vertically and has somewhere to scroll to. */
function scrollParent(element: HTMLElement): HTMLElement | null {
	for (let node = element.parentElement; node; node = node.parentElement) {
		const overflow = getComputedStyle(node).overflowY;
		if (
			(overflow === "auto" || overflow === "scroll") &&
			node.scrollHeight > node.clientHeight
		)
			return node;
	}
	return null;
}
/** Product gesture binding over shared pure geometry; never owns transcript or editable-control gestures. */
export function installChatOverlayMotion(Component: Shell) {
	const p = Component.prototype,
		render = p.renderVals,
		mount = p.componentDidMount,
		update = p.componentDidUpdate,
		unmount = p.componentWillUnmount;
	function bounds() {
		const screen = document.querySelector<HTMLElement>("[data-screen]");
		const viewportH = screen?.clientHeight || window.innerHeight;
		// Shared layout supplies the viewport ceiling; retain its 200px short-panel preference.
		const full = resolveChatPanelLayout({
			viewportH,
			bottomPad: 0,
			keyboardInset: 0,
			effectiveKeyboardInset: 0,
			safeAreaTopPx: 0,
			fullBleed: true,
		}).panelMaxH;
		const inset = resolveChatPanelLayout({
			viewportH,
			bottomPad: 0,
			keyboardInset: 0,
			effectiveKeyboardInset: 0,
			safeAreaTopPx: 0,
			fullBleed: false,
		}).panelMaxH;
		return {
			full,
			half: Math.min(inset, Math.max(200, Math.round(viewportH * 0.6))),
			scale: screen ? screen.getBoundingClientRect().height / viewportH : 1,
		};
	}
	function sheetHeight(shell: Shell, geometry: ReturnType<typeof bounds>) {
		return restingHeight(shell.chatSheetShare, geometry.full, geometry.half);
	}
	/**
	 * A tap between the bar and the sheet resizes the sheet from or to the bar's own place, with
	 * the composer pinned there, the way a drag does: the bar is never left showing behind it,
	 * and no blank frame or ghosted header shows between the two.
	 */
	function resizeForTap(shell: Shell, change: { from: Mode; to: Mode; tap: boolean }) {
		// Navigation can pass through the pill before reopening. Every mode change
		// retires the previous resize, including changes that do not animate the bar.
		const token = (shell.chatResizeToken = (shell.chatResizeToken || 0) + 1);
		const panel = document.querySelector<HTMLElement>(
			'[data-alpha-layer="conversation"]',
		);
		const scale = bounds().scale || 1;
		const open = (mode: Mode) => mode === "sheet" || mode === "full";
		if (panel && change.tap && change.from === "input" && open(change.to)) {
			const target = panel.style.height;
			panel.style.transition = "none";
			panel.style.opacity = "1";
			panel.style.height = `${composerBlock(panel, scale)}px`;
			panel.getBoundingClientRect();
			panel.style.transition = RESIZE_TRANSITION;
			panel.style.height = target;
			setTimeout(() => {
				if (shell.chatResizeToken === token)
					panel.style.transition = PANEL_TRANSITION;
			}, 460);
		}
		if (panel && change.tap && open(change.from) && change.to === "input") {
			panel.style.transition = RESIZE_TRANSITION;
			panel.style.opacity = "1";
			panel.style.height = `${composerBlock(panel, scale)}px`;
			setTimeout(() => {
				if (shell.chatResizeToken === token) panel.style.opacity = "0";
			}, CLOSE_MS - CLOSE_FADE_MS);
			setTimeout(() => {
				if (shell.chatResizeToken !== token || shell.live === false) return;
				shell.chatClosingUntil = 0;
				// Back to the template's closed values before the composer leaves.
				panel.style.height = "0px";
				panel.style.transition = PANEL_TRANSITION;
				shell.setState({});
			}, CLOSE_MS);
		}
		revealWhileResizing(shell, scale);
	}
	function retire(shell: Shell, redraw = true) {
		const drag: Drag | undefined = shell.chatMotion;
		shell.chatMotion = undefined;
		if (!drag) return;
		if (drag.moved) {
			shell.chatDraggedAt = Date.now();
			shell.swallow = Date.now();
			// Cancellation can precede React's first preview commit; restore direct
			// paints explicitly instead of relying on an unchanged virtual style diff.
			const panel = document.querySelector<HTMLElement>(
					'[data-alpha-layer="conversation"]',
				),
				geometry = bounds(),
				mode = shell.S().chat;
			if (panel) {
				panel.style.height = `${mode === "full" ? geometry.full : mode === "sheet" ? sheetHeight(shell, geometry) : 0}px`;
				if (drag.renderedOpacity !== undefined)
					panel.style.opacity = drag.renderedOpacity;
				panel.style.transition = PANEL_TRANSITION;
			}
			revealWhileResizing(shell, geometry.scale || 1);
			// The bar or pill was already in place: replaying its entrance would drop it and rise again.
			shell.chatDockShown = true;
			for (const dock of document.querySelectorAll<HTMLElement>(
				'[data-alpha-input-bar],[data-alpha-layer="pill"]>div',
			)) {
				for (const name of ["transform", "opacity", "transition"])
					dock.style.removeProperty(name);
				dock.style.animation = "none";
			}
		}
		if (drag.owner.hasPointerCapture(drag.id))
			drag.owner.releasePointerCapture(drag.id);
		if (redraw && shell.live !== false) shell.setState({});
	}
	p.componentDidMount = function () {
		mount?.call(this);
		this.cancelChatMotion = () => retire(this);
		this.chatMotionVisibility = () => {
			if (document.hidden) retire(this);
		};
		window.addEventListener("resize", this.cancelChatMotion);
		window.addEventListener("blur", this.cancelChatMotion);
		window.addEventListener("pagehide", this.cancelChatMotion);
		document.addEventListener("visibilitychange", this.chatMotionVisibility);
		// Back can hide Android's IME without blurring its text field. Use the native visibility
		// transition, including floating keyboards and a renderer mounted with the IME already up.
		// Browsers without native insets retain the viewport fallback.
		const free = keyboardFreeHeight();
		const releaseComposer = () => {
			const active = document.activeElement;
			if (!(active instanceof HTMLElement) || !active.matches("[data-alpha-composer]")) return;
			this.chatScrimPress = undefined;
			active.blur();
			this.chatInputFocused = false;
		};
		const initialVisibility = document.documentElement.dataset.alphaKeyboardVisible;
		let nativeKeyboardVisible: boolean | undefined = initialVisibility === undefined ? undefined : initialVisibility === "true" || document.documentElement.dataset.alphaKeyboardHandoff === "true";
		this.dockNativeKeyboardWatch = (event: CustomEvent<{ visible: boolean; handoff?: boolean }>) => {
			const visible = event.detail?.visible;
			if (typeof visible !== "boolean") return;
			const open = visible || event.detail.handoff === true;
			if (nativeKeyboardVisible === true && !open) releaseComposer();
			nativeKeyboardVisible = open;
		};
		window.addEventListener("alpha-keyboard-visibility", this.dockNativeKeyboardWatch);
		const visible = () => {
			const width = document.documentElement.clientWidth || window.innerWidth,
				layout = document.documentElement.clientHeight || window.innerHeight;
			return {
				width,
				layout,
				height: Math.min(layout, window.visualViewport?.height || layout),
			};
		};
		const seed = visible();
		free(seed.width, seed.layout, false);
		let keyboardOpen = false;
		this.dockKeyboardWatch = () => {
			const now = visible(),
				covered =
					free(now.width, now.layout, isEditing(document.activeElement)) -
						now.height >
					150;
			if (nativeKeyboardVisible === undefined && keyboardOpen && !covered) releaseComposer();
			keyboardOpen = covered;
		};
		window.visualViewport?.addEventListener("resize", this.dockKeyboardWatch);
		window.addEventListener("resize", this.dockKeyboardWatch);
		// Leaving the app ends typing: the keyboard is gone when it returns.
		this.dockHiddenWatch = () => {
			if (!document.hidden) return;
			releaseComposer();
			this.chatInputFocused = false;
			clearScrimPress(this);
		};
		document.addEventListener("visibilitychange", this.dockHiddenWatch);
	};
	p.componentDidUpdate = function (...args: Shell[]) {
		update?.apply(this, args);
		const drag: Drag | undefined = this.chatMotion,
			s = this.S();
		// The bar's composer unmounts without a blur event: its focus ends with it.
		const previousView = args[1]?.view;
		if ((s.chat !== "input" || (args[1] && previousView !== s.view)) && (this.chatInputFocused || this.chatScrimPress)) {
			this.chatInputFocused = false;
			clearScrimPress(this);
		}
		if (
			drag &&
			(s.view !== drag.view ||
				s.screen !== drag.screen ||
				s.chat !== drag.mode ||
				s.voice !== "off")
		)
			retire(this);
		const change = this.chatChange;
		if (change?.pending) {
			change.pending = false;
			resizeForTap(this, change);
		}
	};
	p.componentWillUnmount = function () {
		clearScrimPress(this);
		retire(this, false);
		window.removeEventListener("resize", this.cancelChatMotion);
		window.removeEventListener("blur", this.cancelChatMotion);
		window.removeEventListener("pagehide", this.cancelChatMotion);
		document.removeEventListener("visibilitychange", this.chatMotionVisibility);
		window.visualViewport?.removeEventListener("resize", this.dockKeyboardWatch);
		window.removeEventListener("resize", this.dockKeyboardWatch);
		window.removeEventListener("alpha-keyboard-visibility", this.dockNativeKeyboardWatch);
		document.removeEventListener("visibilitychange", this.dockHiddenWatch);
		unmount?.call(this);
	};

	p.tapChatMotion = function () {
		const d: Drag | undefined = this.chatMotion;
		if (!d) return;
		const action = d.tap;
		retire(this, false);
		if (action) {
			action();
			this.swallow = Date.now();
		} else this.setState({});
	};
	p.paintChatMotion = function (offset: number) {
		const d: Drag | undefined = this.chatMotion;
		if (!d || this.live === false || document.hidden) return;
		const shell = this,
			delta = -offset / d.scale;
		if (!d.moved && Math.abs(delta) < TAP_SLOP) return;
		const firstMove = !d.moved;
		d.moved = true;
		d.offset = offset;
		d.height =
			d.mode === "input" && delta > 0
				? 0
				: clamp01((d.start - delta) / Math.max(1, d.full)) * d.full;
		// The shared hook coalesces these direct paints once per frame; rebuilding the app
		// per movement would put React work between the finger and the sheet.
		const panel = document.querySelector<HTMLElement>(
			'[data-alpha-layer="conversation"]',
		);
		const share = collapseShare(d);
		if (panel) {
			panel.style.transition = "none";
			panel.style.height = `${paintedHeight(d)}px`;
			if (d.mode === "sheet" || d.mode === "full")
				panel.style.opacity = String(1 - share);
			revealRows(panel, d.scale);
		}
		// The open sheet and the collapsed bar or pill are one control in two places that line up:
		// opening hides the dock at once, and closing hands back to it in place, never moved.
		const dock = dockStyle(d);
		const pill = document.querySelector<HTMLElement>(
			'[data-alpha-layer="pill"]>div',
		);
		const input = document.querySelector<HTMLElement>("[data-alpha-input-bar]");
		for (const element of [pill, input])
			if (element)
				for (const [name, value] of Object.entries(dock))
					element.style.setProperty(name, value);
		if (firstMove) shell.setState({});
	};
	p.settleChatMotion = function (direction: "up" | "down", free = false) {
		const d: Drag | undefined = this.chatMotion;
		if (!d) return;
		const travel = Math.abs(d.offset / d.scale),
			collapsed = d.mode === "input" || d.mode === "hidden",
			reach = d.mode === "input" ? 24 : DEFAULT_PULL_DISTANCE;
		if (travel < TAP_SLOP || (free && collapsed && travel < reach)) {
			retire(this);
			return;
		}
		const next = chatRelease({
			mode: d.mode,
			// A flick goes where it was aimed, even against the drag's net travel.
			direction: d.flick ?? direction,
			height: d.height,
			floor: d.floor,
			full: d.full,
			flick: !!d.flick,
			home: d.home,
		});
		if (next.height !== undefined)
			this.chatSheetShare = next.height / Math.max(1, d.full);
		retire(this, false);
		this.swallow = Date.now();
		this.chatSettledByDrag = true;
		if (this.props.assistantSurface && !this.S().view && next.chat === "hidden") return this.closeAssistant();
		// An open chat collapses to its resting form; only the bar itself dismisses to the pill,
		// and never on Home.
		this.setState({
			chat: next.chat === "hidden" && !collapsed ? this.rest() : next.chat,
		});
	};
	p.renderVals = function () {
		const out = render.call(this),
			shell = this,
			s = this.S(),
			geometry = bounds(),
			drag: Drag | undefined = this.chatMotion;
		out.panelH =
			(drag && paintedHeight(drag)) ??
			(s.chat === "full"
				? geometry.full
				: s.chat === "sheet"
					? sheetHeight(shell, geometry)
					: 0);
		out.panelTransition = drag?.moved ? "none" : PANEL_TRANSITION;
		// As in OG's scroll clearance, reserve the resting sheet's footprint and
		// reveal focused app controls without changing the sheet or focus owner.
		// The same holds for the floating dock (composer bar or pill): a control
		// that takes focus while part of it is under the dock is scrolled wholly
		// above it, so keyboard and switch focus is never left half covered.
		out.focusAppContent = (event: FocusEvent) => {
			const target = event.target;
			if (
				!(target instanceof HTMLElement) ||
				target.closest('[inert],[role="dialog"]') ||
				document.querySelector("dialog[open]")
			)
				return;
			const scroll = target.closest<HTMLElement>(
				'[data-alpha-app-scroll],[data-installed-apps-scroll],[data-alpha-layer="home"],.calendar-timeline,.calendar-draft-fields',
			) ?? scrollParent(target);
			if (!scroll || target === scroll) return;
			const box = target.getBoundingClientRect();
			const sheet = shell.S().chat === "sheet";
			// Under the dock only focus that did not come from a pointer is moved:
			// scrolling a pressed control out from under the finger would lose the tap.
			if (!sheet && !target.matches(":focus-visible")) return;
			const covers =
				sheet
					? Array.from(
							document.querySelectorAll<HTMLElement>(
								'[data-alpha-layer="conversation"]',
							),
						)
					: visibleDocks();
			let hidden = 0;
			for (const cover of covers) {
				const over = cover.getBoundingClientRect();
				// A dock beside the page (landscape) covers nothing of it.
				if (over.right <= box.left || over.left >= box.right) continue;
				// Focus can arrive before the opening transition reaches its target.
				// Keep it above both the painted sheet and its destination; a live drag owns its actual bounds.
				const top = sheet && !shell.chatMotion
					? Math.min(over.top, over.bottom - sheetHeight(shell, geometry) * geometry.scale)
					: over.top;
				hidden = Math.max(hidden, box.bottom - top + 12);
			}
			if (hidden > 0) scroll.scrollTop += hidden / geometry.scale;
		};
		const isOpen = (mode: unknown) => mode === "sheet" || mode === "full";
		if (shell.chatRenderedMode !== s.chat) {
			const from = shell.chatRenderedMode;
			shell.chatRenderedMode = s.chat;
			if (from !== undefined && !drag) {
				const tap = !shell.chatSettledByDrag && s.voice === "off";
				shell.chatChange = { from, to: s.chat, tap, pending: true };
				if (tap && isOpen(from) && s.chat === "input")
					shell.chatClosingUntil = Date.now() + CLOSE_MS;
			}
			shell.chatSettledByDrag = false;
			if (isOpen(s.chat)) {
				shell.chatDockShown = false;
				shell.chatClosingUntil = 0;
			}
		} else if (!drag) shell.chatSettledByDrag = false;
		if (isOpen(s.chat)) shell.chatSuggestions = out.showSugg;
		// A tap close keeps the sheet's composer while the sheet shrinks onto the bar, which is
		// already in place under it and so skips its entrance.
		if (s.chat === "input" && Date.now() < (shell.chatClosingUntil || 0)) {
			out.panelComposer = true;
			out.showSugg = shell.chatSuggestions;
			shell.chatDockShown = true;
		}
		const dock = drag?.moved
			? Object.entries(dockStyle(drag))
					.map(([name, value]) => `${name}:${value}`)
					.join(";")
			: shell.chatDockShown
				? "animation:none"
				: "";
		out.pillDragStyle = dock;
		out.inputDragStyle = dock;
		if (drag?.moved && (drag.mode !== "input" || drag.height > 0)) {
			out.conversationHidden = false;
			out.panelComposer = true;
			out.panelOp = 1 - collapseShare(drag);
			drag.renderedOpacity = String(out.panelOp);
			out.panelPE = "auto";
			out.panelR = drag.height >= drag.full ? "0px" : "30px 30px 0 0";
		}
		// An open chat dragged down hands over to the form it collapses to, drawn under it in place.
		if (drag?.moved && (drag.mode === "sheet" || drag.mode === "full") && s.voice === "off") {
			const rest = shell.rest();
			if (rest === "input") out.showComposer = true;
			if (rest === "hidden") out.showPill = true;
		}
		const binding = shell.props.chatPullBinding;
		const handlers = {
			down(event: PointerEvent) {
				if (
					shell.chatMotion ||
					event.isPrimary === false ||
					event.button !== 0 ||
					!["hidden", "input", "sheet", "full"].includes(shell.S().chat)
				)
					return;
				// Empty placeholder text is also a handle. Authored text, Send and Talk
				// retain their native editing and activation behavior.
				const emptyInput =
					event.target instanceof HTMLTextAreaElement &&
					event.target.value.length === 0 &&
					String(out.draft || "").length === 0;
				if (
					shell.S().chat === "input" &&
					!emptyInput &&
					(!(event.target instanceof Element) ||
						!event.target.closest(
							"[data-alpha-input-drag-background],[data-alpha-input-drag-alpha]",
						))
				)
					return;
				if (
					!binding ||
					document.hidden ||
					shell.live === false ||
					shell.S().voice !== "off"
				)
					return;
				event.stopPropagation();
				if (emptyInput) event.preventDefault();
				const g = bounds(),
					mode = shell.S().chat as Mode,
					rest = sheetHeight(shell, g),
					floor =
						(document.querySelector<HTMLElement>("[data-alpha-input-bar]")
							?.clientHeight || 62) + 28,
					owner = event.currentTarget as HTMLElement,
					label = (event.target as Element)
						?.closest("button")
						?.getAttribute("aria-label"),
					tap = emptyInput
						? () => owner.focus()
						: label === "Open conversation"
							? out.openSheet
							: label === "Type"
								? out.toInput
								: label === "Talk"
									? out.startVoice
									: label === "Resize chat"
										? () => out.grabTap({ detail: 1 })
										: undefined;
				shell.swallow = 0;
				shell.chatMotion = {
					id: event.pointerId,
					owner,
					mode,
					view: shell.S().view,
					screen: shell.S().screen,
					// The assistant surface has no Home bar: its conversation closes instead.
					home: !shell.S().view && !shell.props.assistantSurface,
					offset: 0,
					y: event.clientY,
					scale: g.scale || 1,
					start:
						mode === "full"
							? g.full
							: mode === "sheet"
								? rest
								: Math.min(mode === "input" ? floor : 80, g.half),
					height: mode === "full" ? g.full : mode === "sheet" ? rest : 0,
					full: g.full,
					half: g.half,
					floor,
					track: [{ y: event.clientY, t: event.timeStamp }],
					moved: false,
					tap,
				} satisfies Drag;
				shell.props.configureChatPull({ scale: g.scale || 1 });
				binding.onPointerDown(event);
			},
			move(event: PointerEvent) {
				const d: Drag | undefined = shell.chatMotion;
				if (d?.id !== event.pointerId) return;
				event.stopPropagation();
				d.track.push({ y: event.clientY, t: event.timeStamp });
				if (d.track.length > 32) d.track.shift();
				binding.onPointerMove(event);
			},
			up(event: PointerEvent) {
				if (shell.chatMotion?.id !== event.pointerId) return;
				event.stopPropagation();
				// A browser can coalesce every move into release. Supply the product's
				// final paint; the shared hook still owns release intent and settlement.
				const d: Drag = shell.chatMotion;
				if (!d.moved) shell.paintChatMotion(d.y - event.clientY);
				// A touch release can report a stale position; only a mouse's is a real sample.
				if (event.pointerType !== "touch")
					d.track.push({ y: event.clientY, t: event.timeStamp });
				const speed = releaseVelocity(d.track, event.timeStamp) / d.scale;
				if (Math.abs(speed) >= CHAT_FLICK_VELOCITY)
					d.flick = speed > 0 ? "up" : "down";
				binding.onPointerUp(event);
			},
			cancel(event: PointerEvent) {
				binding?.onPointerCancel(event);
			},
			lost(event: PointerEvent) {
				binding?.onLostPointerCapture(event);
			},
		};
		out.grabSw = handlers;
		out.pillSw = handlers;
		out.inputSw = handlers;
		out.inputComposerTouchAction =
			String(out.draft || "").length === 0 ? "none" : "pan-y";
		out.inputComposerPointer = (event: PointerEvent) => {
			if (
				event.target instanceof HTMLTextAreaElement &&
				event.target.value.length === 0 &&
				String(out.draft || "").length === 0
			)
				handlers.down(event);
			else out.composerPointer(event);
		};
		// A captured drag may end over a former pill button. It must not synthesize
		// a second action (including Type/Talk) after committing its detent.
		for (const name of ["openSheet", "toInput", "startVoice"]) {
			const action = out[name];
			out[name] = (...args: unknown[]) => {
				if (!shell.swallowed()) return action?.(...args);
			};
		}
		const grabTap = out.grabTap;
		out.grabTap = (event: MouseEvent) => {
			// A new toolbar tap must not be swallowed by the preceding Open tap.
			// Retain suppression for a compatibility click produced by a real drag.
			const toolbar=event.currentTarget instanceof HTMLElement&&event.currentTarget.hasAttribute('data-alpha-chat-size');
			if (event.detail === 0 || toolbar&&Date.now()-(shell.chatDraggedAt||0)>350) {
				retire(shell, false);
				const next = shell.S().chat === "full" ? "sheet" : "full";
				shell.setState({ chat: next }, () => {
					// Full screen removes the grabber: keyboard focus moves to the size control.
					if (next === "full" && document.activeElement === document.body)
						document
							.querySelector<HTMLElement>("[data-alpha-chat-size]")
							?.focus();
				});
			} else grabTap(event);
		};
		out.closeChat = () => {
			retire(shell, false);
			if (shell.props.assistantSurface && !shell.S().view) return shell.closeAssistant();
			// A voice session in the chat keeps its controls on the pill.
			shell.setState({
				chat: document.querySelector("[data-alpha-chat-recorder]")
					? "hidden"
					: shell.rest(),
			});
		};
		if (!out.showComposer) shell.chatInputFocused = false;
		const setInputFocus = (focused: boolean) => {
			if (!focused && shell.chatScrimPress || !!shell.chatInputFocused === focused) return;
			shell.chatInputFocused = focused;
			shell.setState({});
		};
		out.inputComposerFocus = () => setInputFocus(true);
		out.inputComposerBlur = () => setInputFocus(false);
		const dockScrim =
			s.chat === "input" && !!out.showComposer && !s.shade &&
			s.voice === "off" && !shell.props.assistantSurface &&
			(shell.chatInputFocused || shell.rest() === "hidden");
		out.dockScrim = dockScrim;
		out.scrimZ = dockScrim ? 39 : 45;
		const settleScrim = () => {
			clearScrimPress(shell);
			const active = document.activeElement;
			if (dockScrim && active instanceof HTMLElement && active.matches("[data-alpha-composer]"))
				active.blur();
			out.closeChat();
		};
		out.scrimTap = (event: MouseEvent & {nativeEvent?: MouseEvent}) => {
			if (dockScrim) {
				const press: ScrimPress | undefined = shell.chatScrimPress;
				// React forwards click as a mouse event even when the browser
				// supplies a pointer ID on the native event.
				const pointerId = ((event.nativeEvent ?? event) as Partial<PointerEvent>).pointerId;
				if (!press?.dock?.released || press.dock.owner !== event.currentTarget ||
					(typeof pointerId === "number" && pointerId > 0 && pointerId !== press.id) ||
					!press.dock.current())
					return;
			}
			settleScrim();
		};
		// An outside tap lowers the sheet or dock without activating what it uncovers.
		// A drag has no click, so it collapses on release. Assistive technology can
		// still activate app controls directly.
		out.scrimPE =
			dockScrim || s.chat === "sheet" && s.voice === "off" && !shell.props.assistantSurface
				? "auto"
				: "none";
		const ownedPress = (event: PointerEvent) => {
			const press: ScrimPress | undefined = shell.chatScrimPress;
			if (press?.id !== event.pointerId) return undefined;
			if (press.dock && (press.dock.owner !== event.currentTarget || !press.dock.current()))
				return undefined;
			return press;
		};
		out.scrimSw = {
			down(event: PointerEvent) {
				event.stopPropagation();
				// Keep focus until the scrim receives the click. An early blur would
				// otherwise uncover the app between pointer down and pointer up.
				if (dockScrim) event.preventDefault();
				if (event.isPrimary === false) return;
				clearScrimPress(shell);
				const press: ScrimPress = {
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					moved: false,
				};
				shell.chatScrimPress = press;
				if (dockScrim) {
					press.dock = watchDockScrimPress(shell, event.currentTarget as HTMLElement, press);
					press.dock.current();
				}
			},
			// Captured only once it is a drag: a captured press never produces the tap's click,
			// and a drag may end over the sheet.
			move(event: PointerEvent) {
				const press = ownedPress(event);
				if (
					!press ||
					press.moved ||
					press.dock?.released ||
					Math.hypot(event.clientX - press.x, event.clientY - press.y) <
						TAP_SLOP * geometry.scale
				)
					return;
				press.moved = true;
				(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			},
			up(event: PointerEvent) {
				event.stopPropagation();
				const press = ownedPress(event);
				if (!press || press.dock?.released) return;
				if (press.moved) settleScrim();
				else {
					const timer = setTimeout(() => {
						if (shell.chatScrimPress === press && (!press.dock || press.dock.current()))
							settleScrim();
					}, SCRIM_CLICK_WAIT_MS);
					if (press.dock) {
						press.dock.released = true;
						press.dock.timer = timer;
					}
				}
			},
			cancel(event: PointerEvent) {
				if (ownedPress(event)) settleScrim();
			},
		};
		return out;
	};
}
