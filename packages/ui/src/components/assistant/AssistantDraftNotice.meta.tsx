import type { ComponentMeta } from "vibestack/stories";
import type { AssistantDraftNoticeProps } from "./AssistantDraftNotice.tsx";

export const meta: ComponentMeta<AssistantDraftNoticeProps> = {
  args: { status: "opening" },
  examples: {
    Long: { status: "long" },
  },
};
