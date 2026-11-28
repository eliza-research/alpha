// spec/app/platform/index.md, "Story: Reach the phone's native capabilities"
import type { CapacitorConfig } from "@capacitor/cli";
import { elizaCloudRoutes, hostedDeployments } from "@repo/cloud";

interface Hosted { readonly kind: "hosted"; readonly cloud: string; readonly appLinkHost: string }

const deployments: Record<"production" | "staging", Hosted> = hostedDeployments;

export const identity = { appId: "ai.alphacompute.alphaphone", appName: "Alpha Phone" } as const;
export const androidPaths = { project: "android", web: "dist" } as const;
export const signInCallbackPath = "/alphaphone/auth/callback";
export const production = deployments.production;
export const updateManifestUrl = "https://github.com/eliza-research/alpha/releases/download/app-stable-alphacompute/alpha-update-stable.json";

const testMocks = process.env.ELIZA_DEV_ALLOW_TEST_MOCKS === "1";

function environment(name: "production" | "staging") {
  const row = deployments[name];
  return { name, apiOrigin: row.cloud, appLinkHost: row.appLinkHost, redirectPath: signInCallbackPath };
}

const config: CapacitorConfig = {
  appId: identity.appId,
  appName: identity.appName,
  webDir: androidPaths.web,
  loggingBehavior: "none",
  plugins: {
    AlphaSlackOAuth: { cloudOrigin: production.cloud, callbackPath: "/oauth/callback" },
    ElizaSecureStore: {
      nativeOnly: ["device", "device-execution", "action-journal", "assistant-draft"],
      slots: [
        { pattern: "notes-draft:[1-9][0-9]*", access: "writable", limit: 256 * 1024 },
        { pattern: "notes-folders:[1-9][0-9]*", access: "writable", limit: 64 * 1024 },
        { pattern: "messaging-sessions:(v1|telegram:v2|slack:v2)", access: "exchangeable", limit: 256 * 1024 },
        { pattern: "inbox-saved-bodies", access: "writable", limit: 2 * 1024 * 1024 },
        { pattern: "sms-draft:v2:(new|thread:[1-9][0-9]{0,18}|recipients:[0-9a-f]{64})", access: "exchangeable", limit: 2 * 1024 * 1024 },
        { pattern: "sms-outgoing:v2:device", access: "exchangeable", limit: 64 * 1024 },
      ],
    },
    ElizaSignIn: {
      clientId: identity.appId,
      googleMode: "browser",
      testEnvironments: testMocks,
      environments: testMocks ? [environment("production"), environment("staging")] : [environment("production")],
    },
    ElizaCloud: {
      routes: elizaCloudRoutes,
    },
  },
  server: { androidScheme: "https" },
  android: { path: androidPaths.project, allowMixedContent: false, webContentsDebuggingEnabled: false },
};

export default config;
