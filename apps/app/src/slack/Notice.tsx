// spec/app/slack/notices.md, "Visible read withdraws matching target notices, and tapping a posted notice deep-links to its workspace, channel and thread"
import { Button, Toast } from "@repo/ui";
import { useSyncExternalStore } from "react";
import { useMachine } from "../../gen/app__shell.react.ts";
import { showing } from "../../gen/app__shell.ts";
import type { Resident, Shown } from "../runtime/ui.tsx";
import { SlackLedger } from "./ledger.vibe";
import { openSlackNotice } from "./notice-targets.vibe";
import type { SlackRuntime } from "./Slack.tsx";

export function useSlackLedger(runtime: SlackRuntime) {
  const ledger = runtime.runSync(SlackLedger);
  useSyncExternalStore((listener) => ledger.subscribe(listener), ledger.snapshot, ledger.snapshot);
  return ledger;
}

export function SlackNotice({ runtime }: Shown<Resident>) {
  const { state } = useMachine(runtime);
  const latest = useSlackLedger(runtime).noticesList().at(-1);
  if (!state || showing(state, "Slack") || !latest) return null;
  return (
    <Toast>
      <Button variant="ghost" className="h-auto whitespace-normal text-left text-inherit" onClick={() => void runtime.runPromise(openSlackNotice(latest.destination))}>
        {latest.title} · {latest.body}
      </Button>
    </Toast>
  );
}
