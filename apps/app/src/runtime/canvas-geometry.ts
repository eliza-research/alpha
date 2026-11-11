import { DEFAULT_SURFACE_LAYOUT, keyboardFreeHeight, raisesSoftKeyboard, sameSurfaceLayout, surfaceLayout as sharedSurfaceLayout, type SurfaceLayout } from '../../../../.eliza/client-features/packages/ui/src/components/shell/responsive-layout.ts';
/**
 * How the phone canvas is fitted to the window (issue #411).
 *
 * Layout is decided from measured window geometry, not from the screen's orientation:
 *
 * - The wide (landscape) arrangement is used when the window is wider than it is tall without the
 *   software keyboard. A keyboard only shortens the window while a text field has focus and the
 *   width is unchanged, so that shorter height is not taken as a rotation: typing in a portrait
 *   window never flips the page into the wide arrangement, and a landscape window on a portrait
 *   screen (freeform or split windows) still gets it.
 * - A standalone touch window is drawn at its own density: never magnified (a tablet does not get
 *   a doubled-up phone), and in the wide arrangement never shrunk either, so 44px controls stay
 *   44px when a small phone turns sideways. Surfaces bound their own reading width instead.
 * - From a canvas WIDE_CANVAS px wide, reading surfaces centre a bounded column (`alpha-wide`).
 * - The launcher presentation and the desktop browser preview keep their fitted 412px canvas.
 */
export type CanvasInput = {
  width: number;
  /** The window's layout height; the software keyboard may have shortened it. */
  layoutHeight: number;
  /** The usable visual height (keyboard excluded) and the space taken above the canvas. */
  available: number;
  /** A desktop pointer window: the 412x915 preview. */
  desktop: boolean;
  /** Drawn at the window's own density (Android standalone, or a touch browser). */
  fluid: boolean;
  /** The launcher presentation, fitted by its shorter side. */
  launcher: boolean;
  /** The screen's shorter side; only the launcher presentation still uses it. */
  screenShort: number;
  /** A text field has focus, so a shorter window may be the keyboard. */
  editing: boolean;
};
export type CanvasGeometry = { landscape: boolean; wide: boolean; scale: number; width: string; height: number; left: number; top: number };

const REFERENCE_WIDTH = 412, REFERENCE_HEIGHT = 915;
/** Canvas width from which lists, settings and readers hold a bounded reading column (phone.css). */
export const WIDE_CANVAS = 760;

/**
 * The window height without the soft keyboard for the current width, shared with Eliza
 * (packages/ui/src/components/shell/responsive-layout.ts): Android keeps a focused field and its
 * keyboard through a rotation, so a swap of the sides while editing is a rotation, not a keyboard.
 */
export { keyboardFreeHeight };

export type CanvasScale = { landscape: boolean; wide: boolean; scale: number };
// The proof (specs/lemma) reads lengths and the scale as reals, not integers.
//@ declare-type CanvasInput { width: real, layoutHeight: real, available: real, desktop: boolean, fluid: boolean, launcher: boolean, screenShort: real, editing: boolean }
//@ declare-type CanvasScale { landscape: boolean, wide: boolean, scale: real }

/**
 * The numeric decision of canvasGeometry: the arrangement and the scale. Proved for positive
 * lengths in specs/lemma. Minimum and maximum are written as comparisons because the prover has
 * no real-valued Math.min/Math.max; they select the same value for every input, NaN included.
 */
export function canvasScale(input: CanvasInput, freeHeight: number): CanvasScale {
  //@ verify
  //@ type freeHeight real
  //@ requires input.width > 0 && input.available > 0 && input.screenShort > 0
  //@ ensures \result.scale > 0
  //@ ensures \result.landscape <==> !input.desktop && input.width > freeHeight
  //@ ensures input.desktop ==> !\result.landscape && !\result.wide && \result.scale <= 1
  //@ ensures input.fluid && !input.launcher ==> \result.scale <= 1
  //@ ensures input.fluid && !input.launcher && \result.landscape ==> \result.scale === 1
  //@ ensures !(input.fluid && !input.launcher) && \result.landscape ==> \result.scale >= 0.1
  //@ ensures \result.wide <==> !input.desktop && input.width >= WIDE_CANVAS * \result.scale
  const { width, available, desktop, fluid, launcher } = input;
  const landscape = !desktop && width > freeHeight;
  // 1 as a quotient, so the prover types every branch of the scale as a real.
  const unscaled = REFERENCE_WIDTH / REFERENCE_WIDTH;
  const fitted = width / REFERENCE_WIDTH, tall = available / REFERENCE_HEIGHT;
  const short = (width <= input.screenShort ? width : input.screenShort) / REFERENCE_WIDTH;
  const scale = desktop ? (unscaled <= tall ? unscaled : tall)
    : fluid && !launcher ? (landscape ? unscaled : unscaled <= fitted ? unscaled : fitted)
    : landscape ? (0.1 >= short ? 0.1 : short) : fitted;
  const wide = !desktop && width / scale >= WIDE_CANVAS;
  return { landscape, wide, scale };
}

/** Space above the canvas: the banner, and the desktop preview's 24px margin. */
export function canvasTop(banner: number, desktop: boolean): number {
  //@ verify
  //@ type banner real
  //@ type \result real
  //@ ensures \result >= banner
  //@ ensures !desktop ==> \result === banner
  return banner + (desktop ? 24 : 0);
}

export function canvasGeometry(input: CanvasInput, freeHeight: number, banner = 0): CanvasGeometry {
  const { width, available, desktop, fluid, launcher } = input;
  const { landscape, wide, scale } = canvasScale(input, freeHeight);
  const canvasWidth = landscape ? `calc(100vw / ${scale})` : `${fluid && !launcher ? width / scale : REFERENCE_WIDTH}px`;
  return {
    landscape, wide, scale, width: canvasWidth,
    height: desktop ? REFERENCE_HEIGHT : available / scale,
    left: desktop ? (width - REFERENCE_WIDTH * scale) / 2 : 0,
    top: canvasTop(banner, desktop),
  };
}

/** Text entry that raises the software keyboard. */
export const isEditing = raisesSoftKeyboard;

/** Canvas width from which Inbox, Notes and Files show the open item beside their list. */
export const SPLIT_CANVAS = 1000;
/** Narrowest readable Calendar day column at 100% text; the time gutter takes 76px. */
const DAY_COLUMN = 240;
/**
 * Large text (the largest in-app size, 150%, and any larger system font): the list-detail split
 * returns to one pane and Calendar shows the selected day as an agenda list instead of timed blocks
 * (responsive-surface matrix: "keep agenda fallback at large text").
 */
export const LARGE_TEXT = 1.5;

/** Layout choices that change what a surface renders, not only how CSS places it. */
export type { SurfaceLayout };
/** Alpha's responsive-matrix breakpoints for the shared surface layout policy. */
export function surfaceLayout(canvasWidth: number, textScale: number, desktop = false): SurfaceLayout {
  return sharedSurfaceLayout(canvasWidth, textScale, { desktop, splitWidth: SPLIT_CANVAS, dayColumn: DAY_COLUMN, timeGutter: 76, largeText: LARGE_TEXT });
}
let published: SurfaceLayout = { ...DEFAULT_SURFACE_LAYOUT };
/** The layout surfaces render from; main.tsx publishes it from measured canvas and text size. */
export const currentSurfaceLayout = (): SurfaceLayout => published;
/** Returns true when the layout changed and surfaces must render again. */
export function publishSurfaceLayout(next: SurfaceLayout): boolean {
  if (sameSurfaceLayout(next, published)) return false;
  published = next;
  return true;
}
