import type { ComponentProps } from "react";
import { Spinner } from "../Spinner.tsx";

export type AssistantDraftNoticeProps = Omit<ComponentProps<"div">, "children"> & {
  /** What the draft is doing: its slot is being opened, or the text is longer than a message may hold and is kept as a draft. */
  status: "opening" | "long";
};

/**
 * The draft's state above the field, with no words on show: a slot opening shows only a spinner, and a draft too long
 * to send is said to a screen reader only, as Send is disabled. Anything Alpha cannot settle by itself is told in the
 * conversation, never here.
 * @model spec/app/assistant/composer.md
 */
export function AssistantDraftNotice({ status, ...props }: AssistantDraftNoticeProps) {
  if (status === "opening") return <div {...props}><Spinner size="sm" label="Opening your draft" /></div>;
  return <span role="status" className="sr-only" {...props}>Too long to send</span>;
}
