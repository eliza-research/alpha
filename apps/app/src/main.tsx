import { Alert, StartupMark } from "@repo/ui";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { boot } from "./boot.tsx";
import { deliverSlackReturn } from "./platform/slack-return.vibe";
import { native } from "./platform/device.vibe";
import { browserPlatform, phonePlatform } from "./platform/platform.vibe";
import { single } from "./runtime/single.ts";
import "./main.css";

const root = createRoot(document.getElementById("root")!);

root.render(<StrictMode><StartupMark className="fixed inset-0 z-sheet" /></StrictMode>);
if (deliverSlackReturn()) root.render(<main className="p-6">Return to Alpha to finish connecting Slack.</main>);
else if (await single()) root.render(<StrictMode><App alpha={boot(native() ? phonePlatform() : browserPlatform(location.origin), undefined, native())} /></StrictMode>);
else root.render(
  <StrictMode>
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 pt-[max(--spacing(6),var(--alpha-safe-top))] pb-[max(--spacing(6),var(--alpha-safe-bottom))] text-foreground">
      <Alert variant="warn" className="max-w-sm">Alpha is open in another window</Alert>
    </main>
  </StrictMode>,
);
