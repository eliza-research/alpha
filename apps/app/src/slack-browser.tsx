// spec/app/slack/auth.md, "Story: Connect and manage my Slack workspaces with user tokens only"
import { Alert } from "@repo/ui";
import { Layer, ManagedRuntime } from "effect";
import { createRoot } from "react-dom/client";
import { hostedSlackPlatform } from "./platform/platform.vibe";
import { whole } from "./runtime/reactor.vibe";
import { single } from "./runtime/single.ts";
import { slackResident } from "./slack/resident.vibe";
import { SlackScreen } from "./slack/Slack.tsx";
import "./main.css";

const root = createRoot(document.getElementById("root")!);
if (await single()) {
  const runtime = ManagedRuntime.make(Layer.provideMerge(whole(slackResident), hostedSlackPlatform(location.origin)));
  root.render(<main className="mx-auto flex h-dvh max-w-(--breakpoint-md) flex-col bg-background text-foreground"><SlackScreen runtime={runtime} /></main>);
} else {
  root.render(<main className="p-6"><Alert variant="warn">Slack is open in another window.</Alert></main>);
}
