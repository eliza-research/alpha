// spec/app/slack/notices.md, "Story: Hear about Slack DMs, mentions and thread replies per workspace"; spec/app/telegram/notices.md, "Story: Hear about new Telegram messages without noise"
import { ToastRegion } from "@repo/ui";
import { Layer } from "effect";
import { MessagingNotices } from "../platform/index.vibe";
import { area, type Resident, type Shown } from "../runtime/ui.tsx";
import { SlackNotice } from "../slack/Notice.tsx";
import { TelegramNotice } from "../telegram/Notice.tsx";

function MessagingActivity(shown: Shown<Resident>) {
  if (shown.runtime.runSync(MessagingNotices).native) return null;
  return (
    <ToastRegion aria-label="Messaging notifications" className="top-auto empty:hidden bottom-[calc(max(var(--alpha-dock-overlap,5.75rem),var(--alpha-safe-bottom))+--spacing(3))]">
      <SlackNotice {...shown} />
      <TelegramNotice {...shown} />
    </ToastRegion>
  );
}

export default area(Layer.empty, MessagingActivity);
