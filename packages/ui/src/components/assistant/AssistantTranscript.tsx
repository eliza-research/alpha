import { type ComponentProps, type ReactNode, memo, useCallback, useRef } from "react";
import { cn, focusRing } from "../../lib/cn.ts";
import { Button } from "../Button.tsx";
import { EmptyState } from "../EmptyState.tsx";
import { Skeleton } from "../Skeleton.tsx";
import { AssistantMessage, type AssistantMessageProps } from "./AssistantMessage.tsx";
import { AssistantTurnNote, type AssistantTurnNoteProps } from "./AssistantTurnNote.tsx";
import type { MessageHold } from "./messagePress.ts";

type TranscriptMessage = AssistantMessageProps & { id: string };

export type AssistantTranscriptProps = Omit<ComponentProps<"div">, "children"> & {
  /** The messages of the conversation showing, oldest first, each with a key that stays its own. */
  messages: readonly TranscriptMessage[];
  /** Messages from a new turn shown after the Later boundary of an older page. */
  messagesAfterLater?: readonly TranscriptMessage[];
  /** Arms a hold on recorded message text. */
  holdMessage?: MessageHold;
  /** Facts from the current screen shown in the transcript without Alpha's signature. */
  briefing?: ReactNode;
  /** The reply being written or its failure, after recorded messages. */
  liveMessages?: readonly TranscriptMessage[];
  /** A card drawn last whatever the page's state, while its messages load or after they failed, such as the one about the owner's draft. */
  standing?: ReactNode;
  interim?: ReactNode;
  /** The page being read, with the message that a history or search request opened it around. */
  position?: { page: string; around?: string; earlier?: string; later?: string };
  /** Whether the transcript is laid out in the open conversation. */
  visible?: boolean;
  /** Whether the page of messages is being read, was read, or could not be. */
  status?: "loading" | "loaded" | "failed";
  /** Where the last turn stands, below the last message. */
  turn?: AssistantTurnNoteProps;
  /** Reads the page again after it failed. */
  onRetry?: () => void;
  /** Reads older messages around the first one showing. */
  onEarlier?: () => void;
  /** Reads newer messages around the last one showing. */
  onLater?: () => void;
  /** Goes back to the conversation this one was forked from; offered only in a fork. */
  onReturnToOriginal?: () => void;
};

/**
 * Where the conversation is read from: whether it follows the end, the size it had when last seen, against which the end
 * is judged, and the place the owner was reading at when it does not follow.
 */
type TranscriptScroll = { page?: string; follows: boolean; seen: { height: number; view: number }; top: number; paging?: { id: string; offset: number } };

function messageRow(content: HTMLElement, id: string) {
  return Array.from(content.querySelectorAll<HTMLElement>("[data-alpha-message-id]"))
    .find((row) => row.dataset.alphaMessageId === id);
}

function topIn(viewport: HTMLElement, row: HTMLElement) {
  return row.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
}

// spec/app/assistant/chats.md, "The conversation keeps its newest message in view until the owner scrolls up from it"
/**
 * Keeps the end in view while the conversation follows it; otherwise puts back the owner's place where a change that
 * left the conversation shorter for a moment, as a finished reply put in place of its streamed words, drew it earlier.
 */
function followEnd(viewport: HTMLElement, reading: TranscriptScroll) {
  const selection = viewport.ownerDocument.getSelection();
  if (reading.follows && !(selection?.anchorNode && !selection.isCollapsed && viewport.contains(selection.anchorNode))) viewport.scrollTop = viewport.scrollHeight;
  else if (!reading.follows && viewport.scrollTop < reading.top) viewport.scrollTop = reading.top;
  if (reading.follows || viewport.scrollHeight - viewport.clientHeight >= reading.top) {
    reading.seen = { height: viewport.scrollHeight, view: viewport.clientHeight };
  }
}

/** v119's measure (45f6bed30 model.js:5585): within 80 points of the end as the conversation was last seen. */
const atSeenEnd = (reading: TranscriptScroll, top: number) => reading.seen.height - top - reading.seen.view < 80;

const MessageRows = memo(function MessageRows({ messages, hold }: { messages: readonly TranscriptMessage[]; hold?: MessageHold }) {
  return messages.map(({ id, ...message }) => (
    <div key={id} data-alpha-message-id={id}><AssistantMessage {...message} hold={hold} /></div>
  ));
});

/**
 * The conversation as it was being read. New replies follow the end while it is in view; a history page or a search
 * hit opens around the message requested. A drag that reaches its end moves nothing else, as v119's page did not
 * (45f6bed30 phone.css:1), so the sheet around it never stretches with the finger.
 * @model spec/app/assistant/chats.md
 */
export function AssistantTranscript({ messages, messagesAfterLater, holdMessage, briefing, liveMessages, standing, interim, position, visible = true, status = "loaded", turn, onRetry, onEarlier, onLater, onReturnToOriginal, className, onScroll, ...props }: AssistantTranscriptProps) {
  const scrollRef = useRef<TranscriptScroll>({ follows: true, seen: { height: 0, view: 0 }, top: 0 });
  const contentRef = useRef<HTMLDivElement | null>(null);
  const page = position?.page;
  const around = position?.around;
  const placed = useCallback((content: HTMLDivElement | null) => {
    contentRef.current = content;
    const viewport = content?.parentElement;
    if (!content || !viewport || !visible || status !== "loaded") return;
    const reading = scrollRef.current;
    if (reading.page !== page) {
      const row = around === undefined ? undefined : messageRow(content, around);
      if (row && around !== undefined) {
        const offset = reading.paging?.id === around ? reading.paging.offset : (viewport.clientHeight - row.offsetHeight) / 2;
        viewport.scrollTop += topIn(viewport, row) - offset;
      }
      reading.page = page;
      reading.follows = !row;
      reading.top = viewport.scrollTop;
      reading.paging = undefined;
    }
    const follow = () => followEnd(viewport, reading);
    follow();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(follow);
    observer.observe(viewport);
    observer.observe(content);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each change to what the conversation shows is followed as it is drawn, as v119 did (45f6bed30 model.js:5561-5576), so a size the observer never sees still keeps the end
  }, [around, page, status, visible, messages, messagesAfterLater, briefing, liveMessages, standing, interim, turn]);
  const pageFrom = (id: string | undefined, load: () => void) => {
    const content = contentRef.current;
    const viewport = content?.parentElement;
    const row = content && id !== undefined ? messageRow(content, id) : undefined;
    if (viewport && row && id !== undefined) scrollRef.current.paging = { id, offset: topIn(viewport, row) };
    load();
  };
  const body = () => {
    if (status === "loading") return <><div role="status" aria-label="Loading messages" aria-busy className="flex flex-col gap-4"><Skeleton className="h-10 w-2/3 self-end" /><Skeleton className="h-16 w-4/5" /><Skeleton className="h-10 w-1/2 self-end" /></div>{standing}</>;
    if (status === "failed") return <><EmptyState title="Messages did not load">{onRetry ? <Button variant="secondary" onClick={onRetry}>Try again</Button> : null}</EmptyState>{standing}</>;
    return (
      <>
        {onEarlier ? <Button variant="ghost" size="sm" className="min-h-11 self-center" onClick={() => pageFrom(position?.earlier ?? messages[0]?.id, onEarlier)}>Earlier</Button> : null}
        <MessageRows messages={messages} hold={holdMessage} />
        {onLater ? <Button variant="ghost" size="sm" className="min-h-11 self-center" onClick={() => pageFrom(position?.later ?? messages.at(-1)?.id, onLater)}>Later</Button> : null}
        {messagesAfterLater?.length ? <MessageRows messages={messagesAfterLater} hold={holdMessage} /> : null}
        {briefing}
        {liveMessages?.length ? <MessageRows messages={liveMessages} /> : null}
        {standing}
        {interim}
        {turn ? <AssistantTurnNote {...turn} /> : null}
      </>
    );
  };
  return (
    <div
      role="log"
      aria-label="Conversation"
      tabIndex={0}
      className={cn(focusRing, "min-h-0 touch-pan-y overflow-y-auto overscroll-contain px-5 pt-2 pb-3.5 select-text focus-visible:-outline-offset-focus", className)}
      onScroll={(event) => {
        const viewport = event.currentTarget;
        const reading = scrollRef.current;
        if (visible && status === "loaded") {
          const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
          if (reading.follows || maxScroll >= reading.top || viewport.scrollTop < maxScroll - 1) {
            reading.follows = atSeenEnd(reading, viewport.scrollTop);
            reading.top = viewport.scrollTop;
          }
        }
        onScroll?.(event);
      }}
      {...props}
    >
      <div ref={placed} className="flex min-h-full flex-col gap-5">
        {onReturnToOriginal ? <Button variant="ghost" size="sm" className="self-start" onClick={onReturnToOriginal}>Original chat</Button> : null}
        {body()}
      </div>
    </div>
  );
}
