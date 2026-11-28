import { createRoot } from "react-dom/client";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import { AssistantCard } from "./AssistantCard.tsx";
import { AssistantCardFrame } from "./AssistantCardFrame.tsx";
import { AssistantTranscript, type AssistantTranscriptProps } from "./AssistantTranscript.tsx";

const onRetry = fn();
const long = Array.from({ length: 12 }, (_, at) => ({ id: `long-${at}`, author: at % 2 === 0 ? "owner" as const : "alpha" as const, text: `Message ${at + 1}: what was said, long enough to wrap onto a second line in a narrow sheet.` }));
/** The scroll of the log, `below` how far its end is out of view. */
const scrollOf = (log: HTMLElement) => ({ top: log.scrollTop, below: log.scrollHeight - log.scrollTop - log.clientHeight });
/** Move the log to `top` and wait for Chromium to deliver the resulting scroll event. */
const moveScroll = async (log: HTMLElement, top: number) => {
  const scrolled = new Promise<void>((done) => log.addEventListener("scroll", () => done(), { once: true }));
  log.scrollTop = top;
  await scrolled;
};
/** More text arriving at the end of the log, as a reply growing does. */
const arrive = (log: HTMLElement) => log.firstElementChild?.append(Object.assign(document.createElement("div"), { style: "height: 300px; flex-shrink: 0" }));
const onReturnToOriginal = fn();
/** A reply long enough to fill the 160-point log several times over, to the one question of a new conversation. */
const replyText = Array.from({ length: 14 }, (_, at) => `Line ${at + 1} of the reply, long enough to wrap in a narrow sheet.`).join(" ");
const asked = [{ id: "asked", author: "owner" as const, text: "Tell me a long story." }];
/**
 * A transcript of its own, drawn as a reply finishes: the streamed words leave in one change and the stored message
 * arrives in the next, with the page measured between them as the app's own reads of layout do. Between them the
 * question alone fits the log, so the browser has no place to keep; the size the observer sees at the end is the size
 * it saw before, so it never reports the moment between.
 */
function finishingReply(canvasElement: HTMLElement) {
  const host = canvasElement.appendChild(Object.assign(document.createElement("div"), { style: "height: 160px; display: flex; flex-direction: column" }));
  const root = createRoot(host);
  const draw = (props: Partial<AssistantTranscriptProps>) => root.render(<AssistantTranscript messages={asked} className="h-full" {...props} />);
  draw({ liveMessages: [{ id: "reply", author: "alpha", text: replyText }] });
  return {
    host,
    async finish(log: HTMLElement) {
      draw({ liveMessages: [] });
      await waitFor(() => expect(within(host).queryByText(replyText)).toBeNull());
      void log.scrollTop;
      draw({ messages: [...asked, { id: "stored", author: "alpha", text: replyText }] });
      await waitFor(() => expect(within(host).queryByText(replyText)).not.toBeNull());
    },
    done: () => { root.unmount(); host.remove(); },
  };
}

export const meta: ComponentMeta<AssistantTranscriptProps> = {
  args: {
    messages: [
      { id: "1", author: "owner", text: "What is on my calendar on Friday?" },
      {
        id: "2",
        author: "alpha",
        text: "Lunch with Ana at 12:30, and the dentist at 16:00.",
        children: <AssistantCard card={{ kind: "agenda", title: "Friday", rows: [{ id: "1", time: "12:30", title: "Lunch with Ana" }, { id: "2", time: "16:00", title: "Dentist" }] }} onOpen={fn()} />,
      },
      { id: "3", author: "owner", text: "Move the dentist to Tuesday." },
    ],
    onRetry: undefined,
    onEarlier: undefined,
    onLater: undefined,
    onReturnToOriginal: undefined,
  },
  examples: {
    Replying: { turn: { status: "replying" } },
    "May not have arrived": { turn: { status: "unknown", onCheck: fn() } },
    Fork: { onReturnToOriginal },
    "Around a message": { onEarlier: fn(), onLater: fn() },
    Failed: { messages: [], status: "failed", onRetry },
    "A card standing after messages failed": { messages: [], status: "failed", onRetry, standing: <AssistantCardFrame icon={null} title="Alpha cannot keep your draft" /> },
    Empty: { messages: [] },
    "Following the end": { messages: long },
    "A reply finishing": { messages: [] },
  },
  play: {
    // spec/app/assistant/chats.md, "The conversation keeps its newest message in view until the owner scrolls up from it"
    "Following the end": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const log = within(canvasElement).getByRole("log");
      log.style.height = "160px";
      if (log.clientHeight === 0) return;
      // spec/app/assistant/dock.md, "Story: Drag Ask Alpha where I want it": a drag that reaches the conversation's end moves nothing else
      await expect(getComputedStyle(log).overscrollBehaviorY).toBe("contain");
      await waitFor(() => expect(scrollOf(log).below).toBeLessThan(2));
      arrive(log);
      log.dispatchEvent(new Event("scroll"));
      await waitFor(() => expect(scrollOf(log).below).toBeLessThan(2));
      await moveScroll(log, log.scrollTop - 200);
      await waitFor(() => expect(scrollOf(log).below).toBeGreaterThan(150));
      const reading = scrollOf(log).top;
      arrive(log);
      await waitFor(() => expect(scrollOf(log).below).toBeGreaterThan(400));
      await expect(scrollOf(log).top).toBe(reading);
      await moveScroll(log, log.scrollHeight);
      await waitFor(() => expect(scrollOf(log).below).toBeLessThan(2));
      arrive(log);
      await waitFor(() => expect(scrollOf(log).below).toBeLessThan(2));
    },
    // spec/app/assistant/chats.md, "The conversation keeps its newest message in view until the owner scrolls up from it": a finished reply swapped for its stored message neither leaves the end nor moves the owner
    "A reply finishing": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const following = finishingReply(canvasElement);
      const followingLog = await within(following.host).findByRole("log");
      if (followingLog.clientHeight === 0) {
        following.done();
        return;
      }
      await waitFor(() => expect(scrollOf(followingLog).below).toBeLessThan(2));
      await following.finish(followingLog);
      await waitFor(() => expect(scrollOf(followingLog).below).toBeLessThan(2));
      following.done();
      const reading = finishingReply(canvasElement);
      const readingLog = await within(reading.host).findByRole("log");
      await waitFor(() => expect(scrollOf(readingLog).below).toBeLessThan(2));
      await moveScroll(readingLog, readingLog.scrollTop - 200);
      await waitFor(() => expect(scrollOf(readingLog).below).toBeGreaterThan(150));
      const place = readingLog.scrollTop;
      await reading.finish(readingLog);
      await waitFor(() => expect(readingLog.scrollTop).toBe(place));
      reading.done();
    },
    Failed: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      onRetry.mockClear();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Try again" }));
      await expect(onRetry.mock.calls.length).toBe(1);
    },
    "A card standing after messages failed": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const log = within(canvasElement).getByRole("log");
      await expect(within(log).getByText("Messages did not load")).toBeVisible();
      await expect(within(log).getByText("Alpha cannot keep your draft")).toBeVisible();
    },
    Fork: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      onReturnToOriginal.mockClear();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Original chat" }));
      await expect(onReturnToOriginal.mock.calls.length).toBe(1);
    },
  },
};
