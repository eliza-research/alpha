import { isTelegramApplicationId } from "@repo/deployment";

declare global {
  interface ImportMetaEnv {
    readonly VITE_ALPHA_CLOUD_API_ORIGIN: string;
    readonly VITE_ALPHA_SLACK_BROWSER_APIS: Readonly<Record<string, string>>;
  }
}

/** The API origin selected for the packaged phone by its build configuration. */
export const cloudApiOrigin: string = import.meta.env.VITE_ALPHA_CLOUD_API_ORIGIN;

/** Select the reviewed API paired with the browser's App Link origin. @throws {never} */
export function browserCloudOrigin(origin: string): string {
  return import.meta.env.VITE_ALPHA_SLACK_BROWSER_APIS?.[origin] ?? cloudApiOrigin;
}

/** Whether this build was made with `ELIZA_DEV_ALLOW_TEST_MOCKS=1` (vite.config.ts exposes it to the page). @throws {never} */
export const allowsTestMocks = (): boolean => import.meta.env.ELIZA_DEV_ALLOW_TEST_MOCKS === "1";

/** Whether this runs under the development/test server or a build made with `ELIZA_DEV_ALLOW_TEST_MOCKS=1`. @throws {never} */
export const allowsTestOrigin = (): boolean => import.meta.env.DEV || allowsTestMocks();

/** Whether the page was opened with the explicit `?tools=1` query, which alone admits nothing (spec/app/platform/index.md). */
export const toolsAsked = (): boolean => new URLSearchParams(globalThis.location?.search ?? "").get("tools") === "1";

/** The version this build of Alpha was made as (vite.config.ts names it), or empty where the build names none. */
export function appVersion(): string {
  const named: unknown = import.meta.env.VITE_ALPHA_VERSION;
  return typeof named === "string" ? named : "";
}

/** The Telegram application identity built into this public client. */
export function telegramRegistration(): { id: number; hash: string } | undefined {
  const id = Number(import.meta.env.VITE_TELEGRAM_API_ID);
  const hash: unknown = import.meta.env.VITE_TELEGRAM_API_HASH;
  return isTelegramApplicationId(id) && typeof hash === "string" && /^[0-9a-f]{32}$/i.test(hash) ? { id, hash } : undefined;
}
