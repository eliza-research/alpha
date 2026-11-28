import type { ComponentProps } from "react";
import { cn, focusRing } from "../lib/cn.ts";

export type ToastRegionProps = Omit<ComponentProps<"div">, "role" | "aria-live">;
export type ToastProps = ComponentProps<"div"> & {
  /** Takes back what the notice reports; the Undo button is shown only with it, and then only that button takes a tap. */
  onUndo?: () => void;
  /** The words on the Undo button. */
  undoLabel?: string;
};

/**
 * Where notices appear, over the top of the screen: render it once in the app shell, empty, and put each `Toast` in
 * it, so a screen reader announces the words that arrive. It stays heard and pressable while a sheet or a dialog is
 * open, though focus stays inside that sheet or dialog.
 */
export function ToastRegion({ className, ...props }: ToastRegionProps) {
  return (
    <div
      data-alpha-toast-region=""
      role="status"
      aria-live="polite"
      className={cn("pointer-events-none fixed inset-x-4 top-[max(--spacing(12),calc(var(--alpha-safe-top)+--spacing(3)))] z-toast flex flex-col items-center gap-2", className)}
      {...props}
    />
  );
}

/**
 * A short notice about what just happened, inside a `ToastRegion`. It keeps no time: it shows for as long as its parent renders it.
 * With Undo, a tap anywhere but on the button reaches what is under the notice.
 */
export function Toast({ onUndo, undoLabel = "Undo", className, children, ...props }: ToastProps) {
  return (
    <div
      data-host-chrome=""
      className={cn(
        "flex min-h-12 w-fit max-w-full items-center gap-3.5 rounded-panel bg-foreground pl-4.5 text-sm leading-plain font-semibold text-background shadow-md motion-safe:animate-drop dark:shadow-md-dark",
        onUndo ? "pointer-events-none pr-1.25" : "pointer-events-auto pr-4.5",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 flex-1 py-2 wrap-anywhere">{children}</span>
      {onUndo ? (
        <button type="button" onClick={onUndo} className={cn(focusRing, "pointer-events-auto relative min-h-10 min-w-11 shrink-0 rounded-xl bg-background/14 px-3.5 font-bold transition-colors duration-fast ease-standard before:absolute before:inset-x-0 before:-inset-y-0.5 hover:bg-background/20 focus-visible:-outline-offset-focus focus-visible:outline-background active:bg-background/30 motion-reduce:transition-none")}>
          {undoLabel}
        </button>
      ) : null}
    </div>
  );
}
