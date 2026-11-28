import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import vibelang from "vibelang-vite";
import { type Plugin, defineConfig } from "vite";
import { eliza } from "@repo/eliza-harness";
import deployments from "@repo/deployment/deployments.json" with { type: "json" };
import { fakePhone, fakes } from "./test/fakes/serve.ts";
import { localOcrAssets } from "./scripts/ocr-assets.ts";
import { type AlphaSurface, allowsPlace, needsLocalOcr, parseSurface } from "./src/surface.ts";

/**
 * `pnpm dev` serves the page over eliza's agent and cloud; the explore stage, and `ALPHA_FAKES=1 pnpm dev`, over the
 * journeys' fakes as a browser reaches them, and `ALPHA_FAKES=phone pnpm dev` as an Alpha image's plugins do.
 * `ALPHA_PHONE=1 pnpm dev` serves eliza's agent and cloud through the fake phone's plugins, as an Alpha image reaches them.
 */
const faked = process.env.SPEC_TESTS !== undefined || (process.env.ALPHA_FAKES ?? "") !== "";
const phoned = process.env.ALPHA_PHONE === "1";
const buildSurface = parseSurface({ envSurface: process.env.VITE_ALPHA_SURFACE, envView: process.env.VITE_ALPHA_VIEW });

/** The version this build of Alpha is made as: the release's `ELIZAOS_VERSION_NAME`, as the Android package takes it, or the app's own. */
const version = process.env.ELIZAOS_VERSION_NAME || (JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as { readonly version: string }).version;

/**
 * The built page's Content-Security-Policy, the first element of its head (spec/app/platform/index.md, "A built page
 * runs only its own scripts"): its own scripts and WebAssembly only, no plugin object and no base element. A
 * test-mocks build may also reach a development agent on the machine; the development server is not held to it.
 */
function policy(testMocks: boolean): string {
  const connect = ["'self'", "data:", "blob:", "https:", "wss://*.web.telegram.org", ...(testMocks ? ["http://10.0.2.2:*", "http://127.0.0.1:*", "http://localhost:*"] : [])];
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "worker-src 'self' blob:",
    `connect-src ${connect.join(" ")}`,
    "img-src 'self' data: blob: https:",
    "media-src 'self' data: blob:",
    "font-src 'self' data:",
    "frame-src 'self' blob: data: https:",
    "style-src 'self' 'unsafe-inline'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join("; ");
}

const guarded: Plugin = {
  name: "alpha-content-security-policy",
  apply: "build",
  transformIndexHtml: () => [{ tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: policy(process.env.ELIZA_DEV_ALLOW_TEST_MOCKS === "1") }, injectTo: "head-prepend" }],
};

/** Camera and Files recognize text offline, from the worker, model and supported engine cores in this build. */
function localOcr(surface: AlphaSurface): Plugin {
  let cached: ReturnType<typeof localOcrAssets> | undefined;
  const load = () => (cached ??= localOcrAssets());
  return {
    name: "alpha-local-ocr",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        if (!url.startsWith("/ocr/") || request.method !== "GET" && request.method !== "HEAD") return next();
        const file = load().get(url.slice(5));
        if (file === undefined) return next();
        response.writeHead(200, { "Content-Type": file.type, "Content-Length": file.bytes.length, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache" });
        response.end(request.method === "HEAD" ? undefined : file.bytes);
      });
    },
    generateBundle() {
      if (!needsLocalOcr(surface)) return;
      for (const [name, file] of load()) this.emitFile({ type: "asset", fileName: `ocr/${name}`, source: file.bytes });
    },
  };
}

/** Prune unreachable `areas.ts` mount entries during targeted overlay or single-app builds so thin APKs stay lean. */
function pruneSurfaceMounts(surface: AlphaSurface): Plugin {
  return {
    name: "alpha-prune-surface-mounts",
    apply: "build",
    transform(code, id) {
      if (surface.mode === "monolith") return null;
      const normalized = id.replace(/\\/g, "/");
      if (!normalized.endsWith("/src/areas.ts")) return null;
      const filteredLines = code.split("\n").filter((line) => {
        if (line.trim() === 'import home from "./home/index.tsx";') return allowsPlace(surface, "home");
        const entry = line.match(/^\s*(?:at|first)\("([^"]+)"/);
        if (entry === null) return true;
        return allowsPlace(surface, entry[1] ?? "");
      });
      return { code: filteredLines.join("\n"), map: null };
    },
  };
}

export default defineConfig(({ mode }) => ({
  build: { rolldownOptions: { input: [mode === "hosted-slack" ? "slack.html" : "index.html", "alpha-slack-return.html"].map((page) => fileURLToPath(new URL(page, import.meta.url))) } },
  plugins: [vibelang(), react(), tailwindcss(), guarded, localOcr(buildSurface), pruneSurfaceMounts(buildSurface), ...(faked ? [fakes(process.env.ALPHA_AGENT, process.env.ALPHA_FAKES === "phone")] : [eliza(), ...(phoned ? [fakePhone()] : [])])],
  /** eliza's clients are linked from their own checkout, whose Effect and Capacitor are this one's versions: one copy of each in the page. */
  resolve: { dedupe: ["effect", "vibelang-runtime", "@capacitor/core"] },
  // spec/app/platform/index.md, "Mocks, fixtures and developer surfaces exist only when the build allows test mocks": the page reads the build's allowance as `import.meta.env.ELIZA_DEV_ALLOW_TEST_MOCKS`.
  envPrefix: ["VITE_", "ELIZA_DEV_ALLOW_TEST_MOCKS"],
  // spec/app/settings/facts.md, "Facts hold the newest asking, which facts and accesses its answer reported, the roles, and Set as Home in flight": About names the version this build was made as where the phone names none.
  define: { "import.meta.env.VITE_ALPHA_VERSION": JSON.stringify(version),
    "import.meta.env.VITE_ALPHA_CLOUD_API_ORIGIN": JSON.stringify(deployments.production.cloud),
    "import.meta.env.VITE_ALPHA_SLACK_BROWSER_APIS": JSON.stringify(mode === "hosted-slack"
      ? Object.fromEntries([deployments.production, deployments.staging].map((row) => [`https://${row.appLinkHost}`, row.cloud]))
      : {}),
    "import.meta.env.VITE_TELEGRAM_API_ID": JSON.stringify(process.env.TELEGRAM_API_ID ?? ""),
    "import.meta.env.VITE_TELEGRAM_API_HASH": JSON.stringify(process.env.TELEGRAM_API_HASH ?? ""),
  },
}));
