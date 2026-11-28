import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import type {} from "@vitest/browser-playwright";
import type { BrowserCommandContext } from "vitest/node";
import { project } from "vibestack/testing/vitest";
import { defineConfig, mergeConfig } from "vitest/config";
import { production } from "./capacitor.config.ts";

const base = project({ root: import.meta.dirname, plugins: [tailwindcss()] });
/** Where the linked eliza packages really are: Vitest runs their files as this package's own, and not as a dependency Node loads. */
const eliza = new RegExp(`^${fs.realpathSync.native(path.join(import.meta.dirname, "../../.eliza")).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`);

/**
 * The journeys over eliza's real agent and cloud ask the run's setup for them (@repo/eliza-harness/owned). eliza's clients are
 * linked from their own checkout: as in the page (vite.config.ts), they run on this package's one copy of Effect and
 * of Capacitor, so that a schema or an error of theirs is one Alpha's code can read. Chromium's page connects only once
 * Vite's first dependency optimization has scanned and bundled every browser journey's imports, which compiles the
 * project's `.vibe` sources once; on a cold cache and a busy CI runner that takes over Vitest's minute (72 s in run
 * 45913123689), so the browser journeys wait up to three minutes for it.
 */
export default defineConfig(async (env) => mergeConfig(typeof base === "function" ? await base(env) : await base, {
  define: { "import.meta.env.VITE_ALPHA_CLOUD_API_ORIGIN": JSON.stringify(production.cloud) },
  optimizeDeps: { include: ["@mtcute/web", "@mtcute/web/utils.js"] },
  resolve: { dedupe: ["effect", "vibelang-runtime", "@capacitor/core"] },
  test: {
    env: { ELIZA_DEV_ALLOW_TEST_MOCKS: "1" },
    globalSetup: [fileURLToPath(import.meta.resolve("@repo/eliza-harness"))],
    setupFiles: ["./test/fakes/system-startup.ts"],
    server: { deps: { inline: [eliza] } },
    browser: {
      connectTimeout: 180_000,
      commands: {
        async approveSlackWorkspace({ context, iframe }: BrowserCommandContext) {
          const [consent] = await Promise.all([context.waitForEvent("page"), iframe.getByRole("link", { name: "Open Slack in your browser" }).click()]);
          await Promise.all([
            consent.waitForEvent("close", { timeout: 15_000 }),
            consent.getByRole("button", { name: "Allow" }).click(),
          ]);
        },
      },
    },
  },
}));
