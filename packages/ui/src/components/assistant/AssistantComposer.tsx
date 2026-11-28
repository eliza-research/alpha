import { type ComponentProps, type PointerEvent, type ReactNode, type Ref, useCallback, useRef, useState } from "react";
import { ArrowUp, Keyboard, Mic } from "lucide-react";
import { cn } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { Mark } from "../Mark.tsx";
import { AssistantChatActions } from "./AssistantChatActions.tsx";
import { Textarea } from "../Textarea.tsx";
import { AssistantDraftNotice, type AssistantDraftNoticeProps } from "./AssistantDraftNotice.tsx";
import type { AssistantAttachment } from "./AssistantAttachmentChip.tsx";
import { AssistantPendingAttachments } from "./AssistantPendingAttachments.tsx";
import { AssistantQuoteBar } from "./AssistantQuoteBar.tsx";
import { type AssistantPull, useAssistantPull } from "./assistant-pull.ts";
import tokens from "@repo/design-system/tokens.json" with { type: "json" };

/** The design system's rise (tokens.json `animate.rise`, `keyframes.rise`) as a Web Animation, so the bar and the pill can replay it on the one element they share. */
const rise = (() => {
  const [, duration = "460", easing = "ease"] = /(\d+)ms\s+(cubic-bezier\([^)]*\)|\S+)/.exec(tokens.animate.rise) ?? [];
  const [, from = "1.75rem"] = /translateY\(([^)]+)\)/.exec(tokens.keyframes.rise) ?? [];
  return {
    keyframes: [{ opacity: 0, transform: `translateY(${from})` }, { opacity: 1, transform: "none" }],
    options: { duration: Number(duration), easing },
  };
})();

export type AssistantComposerProps = Omit<ComponentProps<"div">, "children" | "onChange"> & {
  /** Where the composer sits: in the Ask Alpha bar, raised on its own, or at the foot of the conversation sheet. */
  variant?: "bar" | "sheet";
  /** The text being written. */
  value: string;
  /** Called with the text as it is typed. */
  onValueChange: (value: string) => void;
  /** The draft's slot is not open yet, or could not be: the field takes no typing. */
  closed?: boolean;
  /** The bar or pill is already in place, as after a drag: it changes between the two without an entrance (v119 45f6bed30 chat-overlay-motion-adapter.ts:637-646). */
  still?: boolean;
  /** The draft's slot opening, or a draft too long to send, above the field and with no words on show. */
  notice?: AssistantDraftNoticeProps;
  /** Why nothing can be sent now: Alpha cannot be reached, or the screen is sensitive and is never sent. Said to a screen reader only; no text is written by the composer. */
  unavailable?: "away" | "sensitive";
  /** What waits to go with the message. */
  attachments?: AssistantAttachment[];
  /** How many files the upload allows. */
  limit?: number;
  /** The message the next send quotes. */
  quote?: string;
  /** The message being written is an earlier one edited to send again. */
  editing?: boolean;
  /** Raises the composer above the keyboard and the navigation bar by this many pixels while typing. */
  lift?: number;
  /** Sends what is written; offered only when the message can be asked of the conversation. */
  onSend?: () => void;
  /** Stops the reply in flight, or takes back a message nothing was heard of. */
  onStop?: () => void;
  /** Stop was asked and the bridge has not yet said whether the message had left. */
  stopping?: boolean;
  /** Opens the picker for photos and documents, from the chat actions; offered while the composer has room. */
  onAttach?: () => void;
  /** Opens search across every conversation, from the chat actions. */
  onSearch?: () => void;
  /** Starts a spoken turn; the voice area owns it. */
  onTalk?: () => void;
  /** Shows the Talk control at rest when the current host has no speech bridge. */
  showUnavailableTalk?: boolean;
  /** Records a transcript the owner can edit before it enters the draft; its mic stands where Talk does, only where Talk is not offered. */
  onDictate?: () => void;
  /** Takes the field's place while a voice conversation owns the composer. */
  voice?: ReactNode;
  /** Opens the conversation from the bar. */
  onOpen?: () => void;
  /** Presents the resting controls as a pill with a separate Type button. */
  onType?: () => void;
  /** The other target when Ask Alpha is open above a call or a conversation. */
  leading?: ReactNode;
  /** The mark in the closed dock when it also acts as the gesture handle. */
  opener?: ReactNode;
  /** The target or action named in the field. */
  placeholder?: string;
  /** Called when the field takes focus: on the bar this raises Ask Alpha to typing, in place. */
  onFocusField?: () => void;
  /** Ref to the composer field so a tap on the resting bar can focus it synchronously. */
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** Allows a pull to start on the editable field when the dock admits it. */
  fieldPull?: AssistantPull;
  /** Removes a pending attachment. */
  onRemoveAttachment?: (id: string) => void;
  /** Opens a pending image over the conversation. */
  onPreviewAttachment?: (id: string) => void;
  /** Takes the quote off. */
  onUnquote?: () => void;
  /** Takes the editing mark off while keeping the text in the field. */
  onStopEditing?: () => void;
};

const reasons = { away: "Alpha cannot be reached", sensitive: "This screen is private and is never sent" };

function keepComposerFocus(event: PointerEvent<HTMLButtonElement>) {
  event.stopPropagation();
  if (event.button === 0 && event.currentTarget.ownerDocument.activeElement?.matches("textarea[data-alpha-composer]")) event.preventDefault();
}

/**
 * The composer: the draft's field with what waits to go with it, the chat actions behind + before it, and Send, Stop
 * reply or Talk at its end. On the bar it is the floating pill, in the sheet the field at its foot. It keeps no rule;
 * each control is shown as its handler is given.
 * @model spec/app/assistant/composer.md
 */
export function AssistantComposer({
  variant = "sheet", still = false, value, onValueChange, closed = false, notice, unavailable, attachments = [], limit = 4, quote, editing = false, lift,
  onSend, onStop, stopping = false, onAttach, onSearch, onTalk, onDictate, showUnavailableTalk = false, voice, onOpen, onType, leading, opener, placeholder, onFocusField, fieldRef, fieldPull, onRemoveAttachment, onPreviewAttachment, onUnquote, onStopEditing, className, style, ...props
}: AssistantComposerProps) {
  const written = value.trim() !== "" || attachments.length > 0;
  // spec/app/assistant/dock.md, "A press does one thing: a tap is never also a drag, and a late click never taps"
  const draggable = value.length === 0;
  const bar = variant === "bar";
  const compact = bar && onType !== undefined;
  const targeting = !bar && placeholder !== undefined;
  /**
   * spec/app/assistant/dock.md, "Story: Drag Ask Alpha where I want it": the bar's, the pill's and the sheet's Stop and Talk are
   * each their own button, as v119 drew them (45f6bed30 template.html:4751, :4796), so a sheet put away never fades its
   * black Talk into the bar's.
   */
  const look = compact ? "pill" : bar ? "bar" : targeting ? "target" : "sheet";
  const pickedFiles = attachments.every(({ kind }) => kind === "image" || kind === "file");
  const frame = bar ? "mx-4 [--alpha-composer-rest:1.75rem]" : "mx-3 [--alpha-composer-rest:1.875rem]";
  const pull = useAssistantPull<HTMLTextAreaElement>(fieldPull, true);
  const [seen, setSeen] = useState({ bar, compact, enter: 0 });
  if (seen.bar !== bar || seen.compact !== compact) {
    const toggledAtBar = seen.bar && bar && seen.compact !== compact;
    setSeen({ bar, compact, enter: toggledAtBar && !voice && !still ? seen.enter + 1 : seen.enter });
  }
  const enter = seen.enter;
  const playedRef = useRef(0);
  const dockRef = useCallback((node: HTMLDivElement | null) => {
    if (!node || enter === 0 || playedRef.current === enter || typeof node.animate !== "function") return;
    playedRef.current = enter;
    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const motion = node.animate(rise.keyframes, rise.options);
    motion.finished.catch(() => undefined);
    return () => { motion.cancel(); };
  }, [enter]);
  return (
    <div role={compact ? "group" : undefined} aria-label={compact ? "Assistant controls" : undefined} data-alpha-compact-dock={compact ? "" : undefined} data-host-chrome={bar ? "" : undefined} className={cn("flex shrink-0 flex-col gap-2", frame, !compact && !targeting && !voice && "not-in-data-[alpha-native]:[--alpha-composer-fit:clamp(0px,calc((412px_-_100vw)_/_11),2px)]", "mb-[max(calc(var(--alpha-composer-rest)_-_var(--alpha-composer-fit,0px)),calc(var(--alpha-safe-bottom)_+_0.75rem))]", className)} style={lift ? { marginBottom: lift, ...style } : style} {...props}>
      {notice ? <AssistantDraftNotice {...notice} /> : null}
      {unavailable ? <span role="status" className="sr-only">{reasons[unavailable]}</span> : null}
      {!compact && attachments.length ? (
        <AssistantPendingAttachments attachments={attachments} limit={limit}
          className={pickedFiles ? cn("-mb-2", !bar && "-mx-3") : undefined}
          onRemove={onRemoveAttachment} onPreview={onPreviewAttachment} />
      ) : null}
      {!compact && quote ? <AssistantQuoteBar kind="quote" text={quote} onRemove={onUnquote} /> : null}
      {!compact && editing ? <AssistantQuoteBar kind="editing" onRemove={onStopEditing} /> : null}
      {voice}
      <div ref={dockRef} data-alpha-input-bar={bar && !compact ? "" : undefined} data-alpha-pill={compact ? "" : undefined} hidden={Boolean(voice)} className={cn("items-center bg-secondary", voice ? "hidden" : "flex", compact ? "touch-none gap-0.5 self-center rounded-dock-compact p-1.25 shadow-dock-compact dark:shadow-dock-compact-dark" : bar ? cn("min-h-[calc(--spacing(18.5)_-_2_*_var(--alpha-composer-fit,0px))] gap-1 rounded-dock py-1.5 pr-2 pl-2.25 shadow-dock dark:shadow-dock-dark", draggable ? "touch-none" : "touch-pan-y") : cn("min-h-[calc(--spacing(17)_-_2_*_var(--alpha-composer-fit,0px))] touch-pan-y gap-1.5 rounded-sheet py-1.5 pr-1.5", targeting ? "pl-1.5 ring-[1.5px] ring-primary ring-inset" : "pl-5"))}>
        {leading}
        {bar ? opener ?? (onOpen ? (
          <Button size="icon" aria-label="Open conversation" data-alpha-input-drag-alpha="" className="overflow-hidden bg-alpha text-alpha-foreground hover:bg-alpha/90" onClick={onOpen}><Mark aria-hidden className="size-full scale-[1.18]" /></Button>
        ) : null) : null}
        {compact ? <Button variant="ghost" size="icon" aria-label="Type" disabled={closed} onClick={onType}><Keyboard aria-hidden /></Button> : (
          <AssistantChatActions placement={bar ? "bar" : "sheet"} disabled={closed} onAttach={onAttach} onSearch={onSearch} />
        )}
        <Textarea
          ref={fieldRef}
          data-alpha-composer=""
          aria-label={targeting ? placeholder : "Message Alpha"}
          placeholder={placeholder ?? (bar ? "Ask Alpha" : "Message Alpha")}
          rows={1}
          hidden={compact}
          value={value}
          disabled={closed}
          onChange={(event) => onValueChange(event.target.value)}
          onFocus={onFocusField}
          data-alpha-pull={fieldPull ? "" : undefined}
          {...pull}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!event.repeat && !closed && !onStop && !stopping) onSend?.();
          }}
          className={cn("max-h-[min(10.5rem,28dvh)] min-h-11 min-w-0 flex-1 rounded-panel border-0 bg-transparent px-3 py-2.75 text-body leading-field", fieldPull || (bar && draggable) ? "touch-none" : bar ? "touch-pan-y" : "touch-auto", compact && "hidden")}
        />
        {onStop || stopping ? (
          <Button key={`${look}-stop`} variant={compact ? "ghost" : undefined} size="icon" aria-label="Stop reply" loading={stopping} className={compact ? undefined : "bg-foreground text-background hover:bg-foreground/90"} onClick={onStop}><svg aria-hidden viewBox="0 0 24 24" className="size-5.5"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" /></svg></Button>
        ) : written && !compact ? (
          <Button
            size="icon"
            aria-label="Send"
            className="bg-alpha text-alpha-foreground hover:bg-alpha/90"
            disabled={closed || !onSend}
            onPointerDown={keepComposerFocus}
            onClick={onSend}
          ><ArrowUp aria-hidden /></Button>
        ) : onTalk ? (
          <Button key={`${look}-talk`} variant="ghost" size="icon" aria-label="Talk" className={bar || targeting ? undefined : "bg-foreground text-background hover:bg-foreground/90"} onPointerDown={keepComposerFocus} onClick={onTalk}><Mic aria-hidden /></Button>
        ) : !compact && onDictate ? (
          <Button variant="ghost" size="icon" aria-label="Dictate" onPointerDown={keepComposerFocus} onClick={onDictate}><Mic aria-hidden /></Button>
        ) : compact || showUnavailableTalk ? (
          <Button key={`${look}-talk`} variant="ghost" size="icon" aria-label="Talk" className={!bar && !targeting ? "bg-foreground text-background" : undefined} disabled><Mic aria-hidden /></Button>
        ) : null}
      </div>
    </div>
  );
}
