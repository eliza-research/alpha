import {
	clamp01,
	OVERLAY_EASE,
} from "../../../../.eliza/client-features/packages/ui/src/components/shell/chat-overlay-motion.ts";
import { resolveChatPanelLayout } from "../../../../.eliza/client-features/packages/ui/src/components/shell/chat-panel-layout.ts";
import {
	DEFAULT_PULL_DISTANCE,
	TAP_SLOP,
} from "../../../../.eliza/client-features/packages/ui/src/gestures/constants";
import { visibleDocks } from "../runtime/dock-clearance";

const SHEET_EASE = `cubic-bezier(${OVERLAY_EASE.join(",")})`;
const PANEL_TRANSITION = `height .42s ${SHEET_EASE}, border-radius .42s, opacity .2s`;
/** A tap opening or closing from the bar changes height only; the sheet is opaque throughout. */
const RESIZE_TRANSITION = `height .42s ${SHEET_EASE}, border-radius .42s, opacity .12s linear`;
/** How long a tap close keeps the sheet's composer, then fades it to show the bar in its place. */
const CLOSE_MS = 400;
const CLOSE_FADE_MS = 120;
type Shell = any;
// chat-release:begin (dependency-free; exercised by test/chat-release.test.mjs)
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

/** Upward speed at release in pixels per millisecond; zero when the finger had stopped. */
export function releaseVelocity(track: Sample[], time: number): number {
	const last = track[track.length - 1];
	if (!last || time - last.t > FLICK_HOLD_MS) return 0;
	const first = track.find((sample) => last.t - sample.t <= FLICK_WINDOW_MS);
	return first && last.t > first.t
		? (first.y - last.y) / (last.t - first.t)
		: 0;
}

/** The open sheet's resting height: the share of the screen it was left at, else the default. */
export function restingHeight(share: number | undefined, full: number, half: number): number {
	if (!share) return half;
	return Math.min(full, Math.max(Math.round(share * full), Math.min(SHEET_MIN_HEIGHT, half)));
}

/**
 * Where a released chat goes. An open chat stays at the released height unless it is near the
 * collapsed form or the top; a flick jumps. From the collapsed form a pull down dismisses, and a
 * pull up opens at the released height, or at the remembered one (no height) if it is still low.
 */
export function chatRelease(options: {
	mode: Mode;
	direction: "up" | "down";
	height: number;
	floor: number;
	full: number;
	flick: boolean;
}): { chat: "hidden" | "sheet" | "full"; height?: number } {
	const { mode, direction, height, floor, full, flick } = options;
	const zone = Math.min(CHAT_SNAP_ZONE, (full - floor) / 3);
	const nearTop = height >= full - zone,
		nearFloor = height <= floor + zone;
	if (mode === "sheet" || mode === "full") {
		if (flick) return { chat: direction === "up" ? "full" : "hidden" };
		if (nearFloor) return { chat: "hidden" };
		return nearTop ? { chat: "full" } : { chat: "sheet", height };
	}
	if (direction === "down") return { chat: "hidden" };
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
	if (d.mode === "input" && d.height === 0) {
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
		// Android can close the keyboard itself (its hide key, Back) and leave the composer
		// focused. Keyboard up and composer focus are one state here, so the composer lets go.
		// MainActivity uses adjustResize, so the WebView itself shrinks with the keyboard: compare
		// against the tallest height seen at this width (as keyboardFreeHeight does), not innerHeight.
		// The baseline is taken now, before any keyboard can have shrunk the window.
		let keyboardOpen = false, base = { width: window.innerWidth, height: Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight) };
		this.dockKeyboardWatch = () => {
			const width = window.innerWidth,
				height = Math.min(window.innerHeight, window.visualViewport?.height ?? window.innerHeight);
			if (width !== base.width || height > base.height) base = { width, height: Math.max(height, width === base.width ? base.height : 0) };
			const covered = base.height - height > 150;
			if (keyboardOpen && !covered && this.dockComposerFocused) {
				const active = document.activeElement;
				if (active instanceof HTMLElement && active.matches("[data-alpha-composer]"))
					active.blur();
			}
			keyboardOpen = covered;
		};
		window.visualViewport?.addEventListener("resize", this.dockKeyboardWatch);
		window.addEventListener("resize", this.dockKeyboardWatch);
		// Leaving the app ends typing: the keyboard is gone when it returns.
		this.dockHiddenWatch = () => {
			if (!document.hidden) return;
			const active = document.activeElement;
			if (active instanceof HTMLElement && active.matches("[data-alpha-composer]")) active.blur();
			this.dockComposerFocused = false;
			this.dockGuardPress = undefined;
		};
		document.addEventListener("visibilitychange", this.dockHiddenWatch);
	};
	p.componentDidUpdate = function (...args: Shell[]) {
		update?.apply(this, args);
		const drag: Drag | undefined = this.chatMotion,
			s = this.S();
		// The bar's composer unmounts without a blur event: its focus ends with it.
		const previousView = args[1]?.view;
		if ((s.chat !== "input" || (args[1] && previousView !== s.view)) && (this.dockComposerFocused || this.dockGuardPress)) {
			this.dockComposerFocused = false;
			this.dockGuardPress = undefined;
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
		retire(this, false);
		window.removeEventListener("resize", this.cancelChatMotion);
		window.removeEventListener("blur", this.cancelChatMotion);
		window.removeEventListener("pagehide", this.cancelChatMotion);
		document.removeEventListener("visibilitychange", this.chatMotionVisibility);
		window.visualViewport?.removeEventListener("resize", this.dockKeyboardWatch);
		window.removeEventListener("resize", this.dockKeyboardWatch);
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
		});
		if (next.height !== undefined)
			this.chatSheetShare = next.height / Math.max(1, d.full);
		retire(this, false);
		this.swallow = Date.now();
		this.chatSettledByDrag = true;
		// An open chat collapses to its resting form; only the bar itself dismisses to the pill.
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
				hidden = Math.max(hidden, box.bottom - over.top + 12);
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
			// A voice session in the chat keeps its controls on the pill.
			shell.setState({
				chat: document.querySelector("[data-alpha-chat-recorder]")
					? "hidden"
					: shell.rest(),
			});
		};
		out.scrimTap = out.closeChat;
		// One rule for every raised dock (docs/ui-refresh-2026-11, tla/ChatInput.tla): the bar
		// above a pill view's resting form, or any composer bar with the keyboard up, takes the
		// first touch outside it. That touch lowers the dock to its resting form, closes the
		// keyboard and reaches nothing underneath; the next touch is ordinary. The draft stays.
		const raisedBar =
			s.chat === "input" &&
			!!out.showComposer &&
			s.voice === "off" &&
			!shell.props.assistantSurface &&
			(shell.rest() === "hidden" || !!shell.dockComposerFocused);
		out.dockGuardPE = raisedBar ? "auto" : "none";
		out.dockComposerFocus = () => {
			if (shell.dockComposerFocused) return;
			shell.dockComposerFocused = true;
			shell.setState({});
		};
		out.dockComposerBlur = () => {
			// A press on the guard keeps the dock raised until its click lowers it, so the
			// click cannot fall through to what the guard covers.
			if (shell.dockGuardPress || !shell.dockComposerFocused) return;
			shell.dockComposerFocused = false;
			shell.setState({});
		};
		const lowerDock = () => {
			shell.dockGuardPress = undefined;
			shell.dockComposerFocused = false;
			const active = document.activeElement;
			if (active instanceof HTMLElement && active.matches("[data-alpha-composer]"))
				active.blur();
			retire(shell, false);
			shell.setState({ chat: shell.rest() });
		};
		out.dockGuardMenu = (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			lowerDock();
		};
		out.dockGuardTap = (event: MouseEvent) => {
			event.stopPropagation();
			lowerDock();
		};
		out.dockGuardSw = {
			down(event: PointerEvent) {
				event.stopPropagation();
				// No focus change and no compatibility mouse events: the click alone lowers.
				event.preventDefault();
				if (event.isPrimary === false) return;
				shell.dockGuardPress = {
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					moved: false,
				};
			},
			move(event: PointerEvent) {
				const press = shell.dockGuardPress;
				if (
					press?.id !== event.pointerId ||
					press.moved ||
					Math.hypot(event.clientX - press.x, event.clientY - press.y) <
						TAP_SLOP * geometry.scale
				)
					return;
				press.moved = true;
				(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			},
			up(event: PointerEvent) {
				event.stopPropagation();
				const press = shell.dockGuardPress;
				// A drag has no click: it lowers on release.
				if (press?.id === event.pointerId && press.moved) lowerDock();
				// A tap lowers on its click; a press that sends no click (long-press) lowers here instead.
				else if (press?.id === event.pointerId) setTimeout(() => { if (shell.dockGuardPress === press) lowerDock(); }, 0);
			},
			cancel() {
				shell.dockGuardPress = undefined;
			},
		};
		// Any touch outside the open sheet collapses it and reaches nothing underneath. A tap
		// collapses on its click, so no compatibility click can land on what the sheet uncovers;
		// a drag has no click, so it collapses on release. Assistive technology activates
		// controls directly and keeps reaching the app.
		out.scrimPE =
			s.chat === "sheet" && s.voice === "off" && !shell.props.assistantSurface
				? "auto"
				: "none";
		out.scrimSw = {
			down(event: PointerEvent) {
				event.stopPropagation();
				if (event.isPrimary === false) return;
				shell.chatScrimPress = {
					id: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					moved: false,
				};
			},
			// Captured only once it is a drag: a captured press never produces the tap's click,
			// and a drag may end over the sheet.
			move(event: PointerEvent) {
				const press = shell.chatScrimPress;
				if (
					press?.id !== event.pointerId ||
					press.moved ||
					Math.hypot(event.clientX - press.x, event.clientY - press.y) <
						TAP_SLOP * geometry.scale
				)
					return;
				press.moved = true;
				(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
			},
			up(event: PointerEvent) {
				event.stopPropagation();
				const press = shell.chatScrimPress;
				shell.chatScrimPress = undefined;
				if (press?.id === event.pointerId && press.moved) out.scrimTap();
			},
			cancel() {
				shell.chatScrimPress = undefined;
			},
		};
		return out;
	};
}
