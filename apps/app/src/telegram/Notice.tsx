// spec/app/telegram/notices.md, "Visible chat read withdraws posted notices for that chat, and tapping a posted notice deep-links to its chat"
import { Button, Toast } from "@repo/ui";
import { showing } from "../../gen/app__shell.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import type { Resident, Shown } from "../runtime/ui.tsx";
import { useSyncExternalStore } from "react";
import type { ManagedRuntime } from "effect";
import { TelegramStore } from "./store.vibe";
import { openTelegramNotice } from "./notices.vibe";

export function useTelegramSnapshot(runtime: ManagedRuntime.ManagedRuntime<TelegramStore, unknown>) {
  const store = runtime.runSync(TelegramStore);
  return useSyncExternalStore((listener) => store.subscribe(listener), () => store.snapshot(), () => store.snapshot());
}

/** The latest Telegram notice opens its original chat from elsewhere in Alpha. */
export function TelegramNotice({ runtime }: Shown<Resident>) {
  const shell = useShell(runtime);
  const notice = useTelegramSnapshot(runtime).notices.at(-1);
  if (!shell.state || showing(shell.state, "Telegram") || !notice) return null;
  return (
    <Toast>
      <Button variant="ghost" className="h-auto whitespace-normal text-left text-inherit" onClick={() => void runtime.runPromise(openTelegramNotice(notice.scope, notice.peerKey))}>
        Telegram · {notice.title}: {notice.excerpt}
      </Button>
    </Toast>
  );
}
