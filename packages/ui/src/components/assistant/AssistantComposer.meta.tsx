import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import type { ComponentMeta } from "vibestack/stories";
import type { AssistantComposerProps } from "./AssistantComposer.tsx";

const onValueChange = fn();
const onSend = fn();
const onStop = fn();
const onAttach = fn();
const onFocusField = fn();

export const meta: ComponentMeta<AssistantComposerProps> = {
  args: {
    value: "",
    onValueChange,
    onAttach,
    onTalk: fn(),
    onSearch: fn(),
    onFocusField,
    onSend: undefined,
    onStop: undefined,
    onOpen: undefined,
    onRemoveAttachment: undefined,
    onPreviewAttachment: undefined,
    onUnquote: undefined,
  },
  examples: {
    Writing: { value: "What is on my calendar on Friday?", onSend },
    "Send not offered": { value: "What is on my calendar on Friday?" },
    "Reply in flight": { value: "", onStop },
    Stopping: { value: "", stopping: true },
    Bar: { variant: "bar", value: "", onOpen: fn() },
    "Files and a quote": {
      value: "Summarise these",
      onSend,
      quote: "Friday works. Lunch with Ana is at 12:30.",
      attachments: [{ id: "1", kind: "mail", name: "Invoice from Bruno" }, { id: "2", kind: "file", name: "Lease.pdf" }],
      onRemoveAttachment: fn(),
      onUnquote: fn(),
    },
    Editing: { value: "What is on Friday?", editing: true, onSend },
    "Too long": { value: "Ask Ana about lunch", notice: { status: "long" } },
    Closed: { value: "", closed: true },
  },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      onValueChange.mockClear();
      onFocusField.mockClear();
      await userEvent.type(within(canvasElement).getByRole("textbox", { name: "Message Alpha" }), "Hi");
      await expect([onValueChange.mock.calls.length, onFocusField.mock.calls.length]).toEqual([2, 1]);
      const actions = within(canvasElement).getByRole("button", { name: "Chat actions" });
      await userEvent.click(actions);
      await expect((await within(canvasElement.ownerDocument.body).findAllByRole("menuitem")).map((item) => item.textContent)).toEqual(["Attach media", "Search chat"]);
      await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("menuitem", { name: "Search chat" }));
      await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-aria-hidden]")).toBeNull());
      if (actions.getBoundingClientRect().width === 0) return;
      // spec/app/assistant/chats.md, "The list of conversations is read whenever it is shown": the + a touch opened keeps its focus without a ring once its menu closes, and one opened from the keyboard, or whose menu Escape closed, keeps its ring
      await expect([canvasElement.ownerDocument.activeElement === actions, actions.matches(":focus-visible")]).toEqual([true, false]);
      for (const open of [() => userEvent.click(actions), () => userEvent.keyboard("{Enter}")]) {
        await open();
        await within(canvasElement.ownerDocument.body).findAllByRole("menuitem");
        await userEvent.keyboard("{Escape}");
        await waitFor(() => expect(canvasElement.ownerDocument.querySelector("[data-aria-hidden]")).toBeNull());
        await expect([canvasElement.ownerDocument.activeElement === actions, actions.matches(":focus-visible")]).toEqual([true, true]);
      }
    },
    Writing: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      onSend.mockClear();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Send" }));
      await expect(onSend.mock.calls.length).toBe(1);
    },
    "Send not offered": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("button", { name: "Send" })).toBeDisabled();
    },
    "Reply in flight": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      onStop.mockClear();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: "Send" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Stop reply" }));
      await expect(onStop.mock.calls.length).toBe(1);
    },
    Stopping: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("button", { name: "Stop reply" })).toHaveAttribute("aria-busy", "true");
    },
    Closed: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).getByRole("textbox", { name: "Message Alpha" })).toBeDisabled();
    },
  },
};
