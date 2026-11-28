import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** One of the 18 canonical Alpha NEXT standalone app views with its showcase domain group. */
export interface WalkthroughViewDescriptor {
  readonly view: string;
  readonly id: string;
  readonly packageName: string;
  readonly group: "Communications" | "Productivity" | "Web, Media & Maps" | "Agent & System";
}

/** Authoritative 18 standalone Alpha NEXT views grouped for showcase capture and motion rendering. */
export const WALKTHROUGH_VIEWS: readonly WalkthroughViewDescriptor[] = [
  { view: "Phone", id: "phone", packageName: "ai.alphacompute.phone", group: "Communications" },
  { view: "Messages", id: "messages", packageName: "ai.alphacompute.messages", group: "Communications" },
  { view: "Contacts", id: "contacts", packageName: "ai.alphacompute.contacts", group: "Communications" },
  { view: "Inbox", id: "inbox", packageName: "ai.alphacompute.inbox", group: "Communications" },
  { view: "Telegram", id: "telegram", packageName: "ai.alphacompute.telegram", group: "Communications" },
  { view: "Slack", id: "slack", packageName: "ai.alphacompute.slack", group: "Communications" },
  { view: "Calendar", id: "calendar", packageName: "ai.alphacompute.calendar", group: "Productivity" },
  { view: "Clock", id: "clock", packageName: "ai.alphacompute.clock", group: "Productivity" },
  { view: "Reminders", id: "reminders", packageName: "ai.alphacompute.reminders", group: "Productivity" },
  { view: "Notes", id: "notes", packageName: "ai.alphacompute.notes", group: "Productivity" },
  { view: "Files", id: "files", packageName: "ai.alphacompute.files", group: "Productivity" },
  { view: "Browser", id: "browser", packageName: "ai.alphacompute.browser", group: "Web, Media & Maps" },
  { view: "Camera", id: "camera", packageName: "ai.alphacompute.camera", group: "Web, Media & Maps" },
  { view: "Photos", id: "photos", packageName: "ai.alphacompute.photos", group: "Web, Media & Maps" },
  { view: "Maps", id: "maps", packageName: "ai.alphacompute.maps", group: "Web, Media & Maps" },
  { view: "Workflows", id: "workflows", packageName: "ai.alphacompute.workflows", group: "Agent & System" },
  { view: "Wallet", id: "wallet", packageName: "ai.alphacompute.wallet", group: "Agent & System" },
  { view: "Settings", id: "settings", packageName: "ai.alphacompute.settings", group: "Agent & System" },
] as const;

/** A single motion chapter in the 1080p Alpha NEXT walkthrough storyboard. */
export interface WalkthroughChapterSpec {
  readonly id: string;
  readonly index: number;
  readonly title: string;
  readonly subtitle: string;
  readonly eyebrow: string;
  readonly durationSec: number;
  readonly theme: "dark" | "light";
  readonly kind: "intro" | "launcher" | "gallery" | "overlay" | "control" | "outro";
  readonly badges: readonly string[];
  readonly screens: readonly {
    readonly label: string;
    readonly source: string;
    readonly imagePath: string | null;
    readonly backdropPath?: string | null;
  }[];
}

/** Video stream metadata verified via `ffprobe`. */
export interface WalkthroughVideoMetadata {
  readonly videoPath: string;
  readonly width: number;
  readonly height: number;
  readonly fps: number;
  readonly codec: string;
  readonly audioCodec: string | null;
  readonly durationSec: number;
  readonly sizeBytes: number;
}

/** Result of rendering the 1080p motion-graphic video and QA contact sheets. */
export interface WalkthroughRenderReport {
  readonly video: WalkthroughVideoMetadata;
  readonly chapters: readonly { readonly id: string; readonly title: string; readonly durationSec: number }[];
  readonly contactSheets: readonly string[];
  readonly reportPath: string;
}

const VIDEO_WIDTH = 1920;
const VIDEO_HEIGHT = 1080;
const VIDEO_FPS = 30;
const XFADE_SECONDS = 0.4;

function resolveCaptureImage(outDir: string, preferredPaths: readonly string[]): { readonly path: string | null; readonly source: string } {
  for (const rel of preferredPaths) {
    const abs = path.join(outDir, rel);
    if (fs.existsSync(abs)) {
      const source = rel.startsWith("captures/android/") ? "Live Android 35" : "Web Surface 2x";
      return { path: abs, source };
    }
  }
  return { path: null, source: "Synthetic Placeholder" };
}

/** Assemble the deterministic 8-chapter Alpha NEXT storyboard from available Android and Web captures. */
export function buildWalkthroughStoryboard(outDir: string): readonly WalkthroughChapterSpec[] {
  const launcherHome = resolveCaptureImage(outDir, ["captures/android/launcher3-home.png", "captures/web/monolith-home.png"]);
  const launcherDrawer = resolveCaptureImage(outDir, ["captures/android/launcher3-drawer.png", "captures/web/monolith-home.png"]);
  const androidThinApp = resolveCaptureImage(outDir, ["captures/android/app-notes.png", "captures/android/app-browser.png", "captures/web/app-notes.png"]);

  const groupScreens = (group: WalkthroughViewDescriptor["group"]) =>
    WALKTHROUGH_VIEWS.filter((entry) => entry.group === group).map((entry) => {
      const found = resolveCaptureImage(outDir, [
        `captures/web/app-${entry.id}.png`,
        `captures/android/app-${entry.id}.png`,
      ]);
      return { label: entry.view, source: found.source, imagePath: found.path };
    });

  const overlayBar = resolveCaptureImage(outDir, ["captures/web/overlay-bar.png"]);
  const overlaySheet = resolveCaptureImage(outDir, ["captures/web/overlay-sheet.png", "captures/web/overlay-full.png"]);
  const overlayVoice = resolveCaptureImage(outDir, ["captures/web/overlay-voice.png", "captures/web/overlay-typing.png"]);
  const notesBackdrop = resolveCaptureImage(outDir, ["captures/web/app-notes.png", "captures/android/app-notes.png"]);
  const calendarBackdrop = resolveCaptureImage(outDir, ["captures/web/app-calendar.png", "captures/android/app-calendar.png"]);

  const chromeControl = resolveCaptureImage(outDir, ["captures/android/third-party-browser.png", "captures/web/app-browser.png"]);
  const controlBanner = resolveCaptureImage(outDir, ["captures/web/overlay-control-banner.png"]);
  const blockedSettings = resolveCaptureImage(outDir, ["captures/android/blocked-settings.png", "captures/web/app-settings.png"]);

  return [
    {
      id: "01-intro",
      index: 1,
      eyebrow: "ALPHA COMPUTE • AOSP ARCHITECTURE",
      title: "Alpha NEXT",
      subtitle: "Native AOSP Launcher3, 18 Standalone Android Apps, System-Wide Ask Alpha & Proved Third-Party Control",
      durationSec: 5,
      theme: "dark",
      kind: "intro",
      badges: ["Android 15/17 AOSP", "18 Standalone APKs", "Resident Eliza Node 26", "42/42 Dafny Proofs"],
      screens: [],
    },
    {
      id: "02-launcher3",
      index: 2,
      eyebrow: "CHAPTER 01 • NATIVE LAUNCHER3",
      title: "Stock AOSP Launcher3, Branded for Alpha",
      subtitle: "All 18 standalone Alpha apps with custom adaptive icons alongside native third-party apps on Android 35",
      durationSec: 8,
      theme: "light",
      kind: "launcher",
      badges: ["AlphaLauncher3Overlay RRO", "18 Adaptive Vector Icons", "Native 3rd-Party Apps", "19 Signed APKs (1 Cert)"],
      screens: [
        { label: "Android 35 Home", source: launcherHome.source, imagePath: launcherHome.path },
        { label: "App Drawer (18+ Apps)", source: launcherDrawer.source, imagePath: launcherDrawer.path },
        { label: "Standalone Notes APK", source: androidThinApp.source, imagePath: androidThinApp.path },
      ],
    },
    {
      id: "03-apps-comms",
      index: 3,
      eyebrow: "CHAPTER 02 • COMMUNICATIONS SUITE (6/18 APPS)",
      title: "Every View Is a Real Android App",
      subtitle: "Independent packages, distinct Linux UIDs, signature-guarded AIDL Binder IPC to AlphaCore",
      durationSec: 6,
      theme: "light",
      kind: "gallery",
      badges: ["ai.alphacompute.permission.AGENT_IPC", "Distinct Linux UIDs", "Shared Debug/Release Cert"],
      screens: groupScreens("Communications"),
    },
    {
      id: "04-apps-productivity",
      index: 4,
      eyebrow: "CHAPTER 03 • PRODUCTIVITY SUITE (5/18 APPS)",
      title: "Shared Preferences, Instant Cross-App Context",
      subtitle: "AlphaPreferencesProvider syncs appearance & text scale live while AlphaContextRegistry feeds Ask Alpha",
      durationSec: 6,
      theme: "dark",
      kind: "gallery",
      badges: ["AlphaPreferencesProvider", "AlphaContextRegistry", "Zero Loopback HTTP"],
      screens: groupScreens("Productivity"),
    },
    {
      id: "05-apps-media-system",
      index: 5,
      eyebrow: "CHAPTER 04 • WEB, MEDIA, MAPS & AGENT (7/18 APPS)",
      title: "All 18 Views With Full Native Parity",
      subtitle: "On-device OCR assets scoped strictly to Camera & Files; Sandboxed Play ready for third-party installs",
      durationSec: 7,
      theme: "light",
      kind: "gallery",
      badges: ["Scoped OCR Assets", "Sandboxed Play Ready", "18/18 Standalone Views"],
      screens: [...groupScreens("Web, Media & Maps"), ...groupScreens("Agent & System")],
    },
    {
      id: "06-overlay-voice",
      index: 6,
      eyebrow: "CHAPTER 05 • ASK ALPHA OVERLAY & VOICE",
      title: "System-Wide Overlay, Bidirectional LLM & Voice",
      subtitle: "VoiceInteractionSession floats transparently over Launcher3, Alpha apps, and third-party browsers",
      durationSec: 8,
      theme: "dark",
      kind: "overlay",
      badges: ["AlphaVoiceInteractionService", "Bidirectional VIEWS Handoff", "Streaming LLM + Voice", "Signed ACTION_AGENT_OPEN"],
      screens: [
        { label: "Overlay on Launcher3", source: overlayBar.source, imagePath: overlayBar.path, backdropPath: launcherHome.path },
        { label: "Ask Alpha over Notes", source: overlaySheet.source, imagePath: overlaySheet.path, backdropPath: notesBackdrop.path },
        { label: "Voice over Calendar", source: overlayVoice.source, imagePath: overlayVoice.path, backdropPath: calendarBackdrop.path },
      ],
    },
    {
      id: "07-control-safety",
      index: 7,
      eyebrow: "CHAPTER 06 • NATIVE THIRD-PARTY CONTROL",
      title: "Scoped Leases, Kill-Switch & Hard Refusals",
      subtitle: "AlphaAccessibilityService observes live third-party apps while AlphaControlPolicy refuses Settings & secure views",
      durationSec: 8,
      theme: "light",
      kind: "control",
      badges: ["Chrome Observed (nodes > 0)", "One-Tap Stop Kill-Switch", "Settings Hard Refused", "CAPTURE_SECURE_LAYERS = false"],
      screens: [
        { label: "3rd-Party Browser", source: chromeControl.source, imagePath: chromeControl.path },
        { label: "Kill-Switch on Chrome", source: controlBanner.source, imagePath: controlBanner.path, backdropPath: chromeControl.path },
        { label: "Settings Refused", source: blockedSettings.source, imagePath: blockedSettings.path },
      ],
    },
    {
      id: "08-outro",
      index: 8,
      eyebrow: "VERIFIED END-TO-END • ALPHA COMPUTE",
      title: "Six Pillars. One Verified Phone.",
      subtitle: "Quint + Dafny Formal Specs • Stock Launcher3 RRO • 18 Standalone APKs • System Overlay • Proved Control • Sandboxed Play",
      durationSec: 5,
      theme: "dark",
      kind: "outro",
      badges: ["100% Alpha Compute Tokens", "Real Android 35 Verified", "Zero Proprietary Play APKs", "alpha-next"],
      screens: [],
    },
  ];
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileToDataUri(filePath: string, mime: string): string {
  if (!fs.existsSync(filePath)) return "";
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

interface StoryboardPalette {
  readonly isDark: boolean;
  readonly bg: string;
  readonly fg: string;
  readonly muted: string;
  readonly surface: string;
  readonly border: string;
  readonly accent: string;
  readonly accentSoft: string;
}

function buildStoryboardCss(
  chapter: WalkthroughChapterSpec,
  palette: StoryboardPalette,
  publicSansUri: string,
  frauncesUri: string,
): string {
  const isWideHero = chapter.kind === "intro" || chapter.kind === "outro";
  const galleryDense = chapter.screens.length >= 5;
  const phoneWidth = chapter.screens.length >= 7
    ? "214px"
    : chapter.screens.length >= 5
      ? "244px"
      : chapter.screens.length === 3
        ? "286px"
        : "304px";
  return `
  @font-face {
    font-family: "Public Sans";
    src: url("${publicSansUri}") format("woff2");
    font-weight: 100 900;
    font-display: block;
  }
  @font-face {
    font-family: "Fraunces";
    src: url("${frauncesUri}") format("truetype");
    font-style: italic;
    font-weight: 400;
    font-display: block;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    width: ${String(VIDEO_WIDTH)}px;
    height: ${String(VIDEO_HEIGHT)}px;
    overflow: hidden;
    background: ${palette.bg};
    color: ${palette.fg};
    font-family: "Public Sans", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    position: relative;
    width: 100%;
    height: 100%;
    padding: 58px 76px;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
  }
  .grid-bg {
    position: absolute;
    inset: 0;
    background-image:
      linear-gradient(to right, ${palette.isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)"} 1px, transparent 1px),
      linear-gradient(to bottom, ${palette.isDark ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.035)"} 1px, transparent 1px);
    background-size: 64px 64px;
    pointer-events: none;
  }
  .accent-bar { position: absolute; top: 0; left: 0; height: 6px; width: 0%; background: ${palette.accent}; }
  .topbar { position: relative; z-index: 2; display: flex; align-items: center; justify-content: space-between; }
  .brand-wordmark { height: 34px; color: ${palette.fg}; }
  .brand-wordmark svg { height: 34px; width: auto; display: block; }
  .eyebrow { font-size: 16px; font-weight: 600; letter-spacing: 0.16em; color: ${palette.accentSoft}; }
  .header-block {
    position: relative;
    z-index: 2;
    margin-top: ${isWideHero ? "40px" : "18px"};
    max-width: ${isWideHero ? "1480px" : "1660px"};
  }
  .title {
    font-family: "Fraunces", serif;
    font-style: italic;
    font-weight: 400;
    font-size: ${isWideHero ? "108px" : "60px"};
    line-height: 1.04;
    letter-spacing: -0.02em;
    opacity: 0;
    transform: translateY(24px);
  }
  .subtitle {
    margin-top: ${isWideHero ? "24px" : "10px"};
    font-size: ${isWideHero ? "28px" : "22px"};
    line-height: 1.38;
    color: ${palette.muted};
    max-width: 1320px;
    opacity: 0;
    transform: translateY(18px);
  }
  .hero-mark {
    position: absolute;
    right: 88px;
    top: 50%;
    width: 340px;
    height: 340px;
    color: ${palette.accent};
    opacity: 0;
    transform: translateY(-50%) scale(0.92);
  }
  .hero-mark svg { width: 100%; height: 100%; display: block; }
  .phones-row {
    position: relative;
    z-index: 2;
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: ${galleryDense ? "20px" : "44px"};
    margin: 18px 0;
  }
  .phone-card { display: flex; flex-direction: column; align-items: center; opacity: 0; transform: translateY(34px); }
  .phone-frame {
    position: relative;
    width: ${phoneWidth};
    aspect-ratio: 412 / 915;
    border-radius: ${galleryDense ? "26px" : "34px"};
    padding: 8px;
    background: ${palette.isDark ? "#181818" : "#111111"};
    border: 2px solid ${palette.isDark ? "rgba(255,255,255,0.22)" : "rgba(0,0,0,0.85)"};
    box-shadow: 0 24px 60px ${palette.isDark ? "rgba(0,0,255,0.18)" : "rgba(0,0,0,0.18)"};
  }
  .phone-notch {
    position: absolute;
    top: 12px;
    left: 50%;
    transform: translateX(-50%);
    width: 48px;
    height: 8px;
    border-radius: 999px;
    background: #000000;
    z-index: 3;
  }
  .phone-screen {
    position: relative;
    width: 100%;
    height: 100%;
    border-radius: ${galleryDense ? "19px" : "26px"};
    overflow: hidden;
    background: ${palette.surface};
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .phone-screen img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .phone-screen img.overlay-layer { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; z-index: 2; }
  .placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    font-weight: 600;
    color: ${palette.muted};
    border: 1px dashed ${palette.border};
  }
  .phone-meta { margin-top: 12px; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .phone-label { font-size: 18px; font-weight: 700; color: ${palette.fg}; }
  .phone-source { font-size: 13px; font-weight: 500; color: ${palette.accentSoft}; letter-spacing: 0.04em; }
  .pillars-grid {
    position: relative;
    z-index: 2;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    margin: 28px 0;
  }
  .pillar {
    padding: 24px 26px;
    border-radius: 18px;
    background: ${palette.surface};
    border: 1px solid ${palette.border};
    opacity: 0;
    transform: translateY(20px);
  }
  .pillar-num { font-size: 14px; font-weight: 700; color: ${palette.accentSoft}; letter-spacing: 0.14em; }
  .pillar-name { margin-top: 8px; font-size: 24px; font-weight: 700; }
  .pillar-desc { margin-top: 8px; font-size: 16px; line-height: 1.4; color: ${palette.muted}; }
  .arch-flow {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin-bottom: 10px;
  }
  .arch-node {
    padding: 10px 18px;
    border-radius: 999px;
    border: 1px solid ${palette.border};
    background: ${palette.surface};
    font-size: 15px;
    font-weight: 600;
  }
  .arch-node.accent { background: ${palette.accent}; border-color: ${palette.accent}; color: #FFFFFF; }
  .arch-wire {
    position: relative;
    width: 68px;
    height: 3px;
    background: ${palette.border};
    overflow: hidden;
    border-radius: 999px;
  }
  .arch-wire .pulse { position: absolute; top: 0; left: -24px; width: 24px; height: 100%; background: ${palette.accentSoft}; }
  .footer {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-top: 14px;
    border-top: 1px solid ${palette.border};
  }
  .badges { display: flex; gap: 12px; flex-wrap: wrap; }
  .badge {
    padding: 8px 16px;
    border-radius: 999px;
    border: 1px solid ${palette.border};
    background: ${palette.surface};
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
    opacity: 0;
    transform: translateY(10px);
  }
  .chapter-meter { font-size: 14px; font-weight: 600; color: ${palette.muted}; letter-spacing: 0.1em; }`;
}

function buildStoryboardScript(durationSec: number): string {
  return `
    const DURATION = ${String(durationSec)};
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
    window.__seek = (t) => {
      const progress = clamp01(t / DURATION);
      const bar = document.getElementById("accentBar");
      if (bar) bar.style.width = (progress * 100).toFixed(2) + "%";
      const titleE = easeOutCubic(t / 0.65);
      const title = document.getElementById("title");
      if (title) {
        title.style.opacity = titleE.toFixed(3);
        title.style.transform = "translateY(" + ((1 - titleE) * 24).toFixed(2) + "px)";
      }
      const subE = easeOutCubic((t - 0.18) / 0.65);
      const sub = document.getElementById("subtitle");
      if (sub) {
        sub.style.opacity = subE.toFixed(3);
        sub.style.transform = "translateY(" + ((1 - subE) * 18).toFixed(2) + "px)";
      }
      const mark = document.getElementById("heroMark");
      if (mark) {
        const mE = easeOutCubic((t - 0.25) / 0.9);
        const rot = (t * 8).toFixed(2);
        mark.style.opacity = (mE * 0.92).toFixed(3);
        mark.style.transform = "translateY(-50%) scale(" + (0.92 + mE * 0.08).toFixed(3) + ") rotate(" + rot + "deg)";
      }
      document.querySelectorAll(".phone-card").forEach((el) => {
        const idx = Number(el.getAttribute("data-idx") || "0");
        const enter = easeOutCubic((t - 0.25 - idx * 0.12) / 0.65);
        const drift = Math.sin((t + idx * 0.7) * 1.15) * 5;
        el.style.opacity = enter.toFixed(3);
        el.style.transform = "translateY(" + (((1 - enter) * 36) + drift).toFixed(2) + "px)";
      });
      document.querySelectorAll(".pillar").forEach((el) => {
        const idx = Number(el.getAttribute("data-idx") || "0");
        const enter = easeOutCubic((t - 0.25 - idx * 0.1) / 0.55);
        el.style.opacity = enter.toFixed(3);
        el.style.transform = "translateY(" + ((1 - enter) * 20).toFixed(2) + "px)";
      });
      document.querySelectorAll(".badge").forEach((el) => {
        const idx = Number(el.getAttribute("data-idx") || "0");
        const enter = easeOutCubic((t - 0.5 - idx * 0.1) / 0.45);
        el.style.opacity = enter.toFixed(3);
        el.style.transform = "translateY(" + ((1 - enter) * 10).toFixed(2) + "px)";
      });
      document.querySelectorAll(".arch-wire .pulse").forEach((el, idx) => {
        const phase = ((t * 1.4 + idx * 0.33) % 1) * 92 - 24;
        el.style.left = phase.toFixed(1) + "px";
      });
    };
    window.__seek(0);`;
}

/** Build the self-contained 1920x1080 HTML5/CSS/SVG motion stage driven deterministically via `window.__seek(t)`. */
export function buildStoryboardHtml(
  chapter: WalkthroughChapterSpec,
  rootDir: string,
): string {
  const publicSansUri = fileToDataUri(path.join(rootDir, "packages/design-system/fonts/public-sans-latin.woff2"), "font/woff2");
  const frauncesUri = fileToDataUri(path.join(rootDir, "packages/design-system/fonts/fraunces-italic-400.ttf"), "font/ttf");
  const wordmarkSvg = fs.existsSync(path.join(rootDir, "packages/design-system/brand/wordmark.svg"))
    ? fs.readFileSync(path.join(rootDir, "packages/design-system/brand/wordmark.svg"), "utf8")
    : "";
  const markSvg = fs.existsSync(path.join(rootDir, "packages/design-system/brand/mark.svg"))
    ? fs.readFileSync(path.join(rootDir, "packages/design-system/brand/mark.svg"), "utf8")
    : "";

  const isDark = chapter.theme === "dark";
  const palette: StoryboardPalette = {
    isDark,
    bg: isDark ? "#000000" : "#FFFFFF",
    fg: isDark ? "#FFFFFF" : "#000000",
    muted: isDark ? "#A3A3A3" : "#666666",
    surface: isDark ? "#111111" : "#FAFAFA",
    border: isDark ? "rgba(255,255,255,0.14)" : "rgba(0,0,0,0.12)",
    accent: "#0000FF",
    accentSoft: isDark ? "#7687FF" : "#0000FF",
  };

  const cardsHtml = chapter.screens.map((screen, idx) => {
    const imgUri = screen.imagePath ? fileToDataUri(screen.imagePath, "image/png") : "";
    const backdropUri = screen.backdropPath ? fileToDataUri(screen.backdropPath, "image/png") : "";
    let mediaHtml: string;
    if (imgUri && backdropUri) {
      mediaHtml = `<img src="${backdropUri}" alt="${escapeHtml(screen.label)} backdrop" /><img class="overlay-layer" src="${imgUri}" alt="${escapeHtml(screen.label)}" />`;
    } else if (imgUri) {
      mediaHtml = `<img src="${imgUri}" alt="${escapeHtml(screen.label)}" />`;
    } else {
      mediaHtml = `<div class="placeholder"><span>${escapeHtml(screen.label)}</span></div>`;
    }
    return `
      <div class="phone-card" data-idx="${String(idx)}">
        <div class="phone-frame">
          <div class="phone-notch"></div>
          <div class="phone-screen">${mediaHtml}</div>
        </div>
        <div class="phone-meta">
          <span class="phone-label">${escapeHtml(screen.label)}</span>
          <span class="phone-source">${escapeHtml(screen.source)}</span>
        </div>
      </div>`;
  }).join("\n");

  const badgesHtml = chapter.badges.map((badge, idx) =>
    `<span class="badge" data-idx="${String(idx)}">${escapeHtml(badge)}</span>`,
  ).join("\n");

  const pillarsHtml = chapter.kind === "outro"
    ? [
      ["01", "Launcher3 RRO", "Stock AOSP home + Alpha Compute tokens, fonts & widgets"],
      ["02", "18 Standalone APKs", "Independent packages with distinct Linux UIDs"],
      ["03", "Signature Binder IPC", "Zero-localhost AIDL brokers + AlphaPreferencesProvider"],
      ["04", "Ask Alpha Overlay", "Transparent VoiceInteractionSession + LLM & Voice"],
      ["05", "Proved Control", "42/42 Dafny proofs, kill-switch & Settings hard refusal"],
      ["06", "Sandboxed Play", "Zero proprietary APKs; verified GmsCompat staging"],
    ].map(([num, name, desc], idx) => `
      <div class="pillar" data-idx="${String(idx)}">
        <div class="pillar-num">${num}</div>
        <div class="pillar-name">${name}</div>
        <div class="pillar-desc">${desc}</div>
      </div>`).join("\n")
    : "";

  const archStripHtml = chapter.kind === "overlay"
    ? `
      <div class="arch-flow">
        <div class="arch-node">Thin App (UID B)</div>
        <div class="arch-wire"><span class="pulse"></span></div>
        <div class="arch-node accent">AGENT_IPC Binder</div>
        <div class="arch-wire"><span class="pulse"></span></div>
        <div class="arch-node">Resident Eliza Agent</div>
        <div class="arch-wire"><span class="pulse"></span></div>
        <div class="arch-node accent">Voice + Overlay</div>
      </div>`
    : "";

  const css = buildStoryboardCss(chapter, palette, publicSansUri, frauncesUri);
  const script = buildStoryboardScript(chapter.durationSec);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<style>${css}</style>
</head>
<body>
  <div class="stage">
    <div class="grid-bg"></div>
    <div class="accent-bar" id="accentBar"></div>
    <div class="topbar">
      <div class="brand-wordmark">${wordmarkSvg}</div>
      <div class="eyebrow">${escapeHtml(chapter.eyebrow)}</div>
    </div>
    <div class="header-block">
      <h1 class="title" id="title">${escapeHtml(chapter.title)}</h1>
      <p class="subtitle" id="subtitle">${escapeHtml(chapter.subtitle)}</p>
    </div>
    ${chapter.kind === "intro" ? `<div class="hero-mark" id="heroMark">${markSvg}</div>` : ""}
    ${chapter.screens.length > 0 ? `<div class="phones-row">${cardsHtml}</div>` : ""}
    ${pillarsHtml ? `<div class="pillars-grid">${pillarsHtml}</div>` : ""}
    ${archStripHtml}
    <div class="footer">
      <div class="badges">${badgesHtml}</div>
      <div class="chapter-meter">CHAPTER 0${String(chapter.index)} / 08</div>
    </div>
  </div>
  <script>${script}</script>
</body>
</html>`;
}

async function renderChapterVideo(
  chapter: WalkthroughChapterSpec,
  segmentPath: string,
  rootDir: string,
  ffmpegPath: string,
  page: {
    readonly setContent: (html: string, opts?: { readonly waitUntil?: "load" | "domcontentloaded" | "networkidle" }) => Promise<void>;
    readonly evaluate: <T>(fn: (arg: number) => T, arg: number) => Promise<T>;
    readonly screenshot: (opts: { readonly type: "png" }) => Promise<Buffer>;
  },
): Promise<void> {
  const html = buildStoryboardHtml(chapter, rootDir);
  await page.setContent(html, { waitUntil: "load" });
  const totalFrames = Math.max(1, Math.round(chapter.durationSec * VIDEO_FPS));

  const encoder = spawn(ffmpegPath, [
    "-y",
    "-f",
    "image2pipe",
    "-vcodec",
    "png",
    "-r",
    String(VIDEO_FPS),
    "-i",
    "-",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(VIDEO_FPS),
    segmentPath,
  ], { stdio: ["pipe", "ignore", "pipe"] });

  let stderrBuf = "";
  encoder.stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });

  const closed = new Promise<void>((resolve, reject) => {
    encoder.once("error", reject);
    encoder.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg segment ${chapter.id} failed (${String(code)}): ${stderrBuf.slice(-400)}`));
    });
  });

  for (let frame = 0; frame < totalFrames; frame++) {
    const t = frame / VIDEO_FPS;
    await page.evaluate((timeSec) => {
      const win = globalThis as unknown as { readonly __seek?: (time: number) => void };
      win.__seek?.(timeSec);
    }, t);
    const png = await page.screenshot({ type: "png" });
    if (!encoder.stdin.write(png)) {
      await new Promise<void>((resolve) => {
        encoder.stdin.once("drain", resolve);
      });
    }
  }
  encoder.stdin.end();
  await closed;
}

function stitchChaptersWithXfade(
  ffmpegPath: string,
  segments: readonly { readonly path: string; readonly durationSec: number }[],
  outputPath: string,
): void {
  const inputArgs: string[] = [];
  for (const segment of segments) {
    inputArgs.push("-i", segment.path);
  }
  inputArgs.push("-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000");

  const filters: string[] = [];
  let prevLabel = "[0:v]";
  let elapsed = segments[0]?.durationSec ?? 0;
  for (let idx = 1; idx < segments.length; idx++) {
    const seg = segments[idx];
    if (!seg) continue;
    const offset = Math.max(0, elapsed - XFADE_SECONDS);
    const outLabel = idx === segments.length - 1 ? "[vout]" : `[vx${String(idx)}]`;
    filters.push(
      `${prevLabel}[${String(idx)}:v]xfade=transition=fade:duration=${XFADE_SECONDS.toFixed(2)}:offset=${offset.toFixed(2)}${outLabel}`,
    );
    prevLabel = outLabel;
    elapsed = offset + seg.durationSec;
  }
  if (segments.length === 1) {
    filters.push("[0:v]copy[vout]");
  }

  const audioInputIdx = segments.length;
  execFileSync(ffmpegPath, [
    "-y",
    ...inputArgs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    `${String(audioInputIdx)}:a`,
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputPath,
  ], { stdio: ["ignore", "pipe", "pipe"] });
}

function probeVideo(ffprobePath: string, videoPath: string): WalkthroughVideoMetadata {
  const raw = execFileSync(ffprobePath, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const parsed = JSON.parse(raw) as {
    readonly streams?: readonly {
      readonly codec_type?: string;
      readonly codec_name?: string;
      readonly width?: number;
      readonly height?: number;
      readonly avg_frame_rate?: string;
    }[];
    readonly format?: { readonly duration?: string };
  };
  const vStream = parsed.streams?.find((stream) => stream.codec_type === "video");
  const aStream = parsed.streams?.find((stream) => stream.codec_type === "audio");
  const [numStr = "30", denStr = "1"] = (vStream?.avg_frame_rate ?? "30/1").split("/");
  const fps = Math.round((Number(numStr) / Math.max(1, Number(denStr))) * 100) / 100;
  return {
    videoPath,
    width: vStream?.width ?? 0,
    height: vStream?.height ?? 0,
    fps,
    codec: vStream?.codec_name ?? "unknown",
    audioCodec: aStream?.codec_name ?? null,
    durationSec: Math.round(Number(parsed.format?.duration ?? "0") * 100) / 100,
    sizeBytes: fs.statSync(videoPath).size,
  };
}

function buildQaContactSheets(
  outDir: string,
  videoPath: string,
  durationSec: number,
  ffmpegPath: string,
  magickPath: string | null,
): readonly string[] {
  const sheets: string[] = [];
  if (!magickPath) return sheets;

  const viewInputs: string[] = [];
  for (const descriptor of WALKTHROUGH_VIEWS) {
    const found = resolveCaptureImage(outDir, [
      `captures/web/app-${descriptor.id}.png`,
      `captures/android/app-${descriptor.id}.png`,
    ]);
    if (found.path) {
      viewInputs.push("-label", descriptor.view, found.path);
    }
  }
  if (viewInputs.length > 0) {
    const all18Sheet = path.join(outDir, "contact-sheet-all-18-views.png");
    execFileSync(magickPath, [
      "montage",
      ...viewInputs,
      "-tile",
      "6x3",
      "-geometry",
      "240x532+14+14",
      "-background",
      "#000000",
      "-fill",
      "#FFFFFF",
      "-pointsize",
      "18",
      all18Sheet,
    ], { stdio: ["ignore", "pipe", "pipe"] });
    sheets.push(all18Sheet);
  }

  const framesDir = path.join(outDir, ".frames-qa");
  fs.rmSync(framesDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });
  const sampleCount = 12;
  const framePaths: string[] = [];
  try {
    for (let idx = 0; idx < sampleCount; idx++) {
      const ts = Math.max(0.5, ((idx + 0.5) / sampleCount) * Math.max(1, durationSec - 0.5));
      const frameFile = path.join(framesDir, `kf-${String(idx + 1).padStart(2, "0")}.png`);
      execFileSync(ffmpegPath, [
        "-y",
        "-ss",
        ts.toFixed(2),
        "-i",
        videoPath,
        "-frames:v",
        "1",
        frameFile,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      if (fs.existsSync(frameFile)) {
        framePaths.push("-label", `${ts.toFixed(1)}s`, frameFile);
      }
    }
    if (framePaths.length > 0) {
      const chapterSheet = path.join(outDir, "contact-sheet-video-chapters.png");
      execFileSync(magickPath, [
        "montage",
        ...framePaths,
        "-tile",
        "4x3",
        "-geometry",
        "480x270+10+10",
        "-background",
        "#000000",
        "-fill",
        "#FFFFFF",
        "-pointsize",
        "18",
        chapterSheet,
      ], { stdio: ["ignore", "pipe", "pipe"] });
      sheets.push(chapterSheet);
    }
  } finally {
    fs.rmSync(framesDir, { recursive: true, force: true });
  }
  return sheets;
}

/** Render the 1080p 30fps Alpha Compute motion-graphic walkthrough MP4 and QA contact sheets. */
export async function renderWalkthroughVideo(
  outDir: string,
  rootDir: string,
  ffmpegPath: string,
  ffprobePath: string,
  magickPath: string | null,
): Promise<WalkthroughRenderReport> {
  fs.mkdirSync(outDir, { recursive: true });
  const segmentsDir = path.join(outDir, ".segments");
  fs.rmSync(segmentsDir, { recursive: true, force: true });
  fs.mkdirSync(segmentsDir, { recursive: true });

  const chapters = buildWalkthroughStoryboard(outDir);
  const playwrightMod = await import("playwright");
  const browser = await playwrightMod.chromium.launch({ headless: true });
  const renderedSegments: { readonly path: string; readonly durationSec: number }[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: VIDEO_WIDTH, height: VIDEO_HEIGHT }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    for (const chapter of chapters) {
      const segPath = path.join(segmentsDir, `${chapter.id}.mp4`);
      await renderChapterVideo(chapter, segPath, rootDir, ffmpegPath, page);
      renderedSegments.push({ path: segPath, durationSec: chapter.durationSec });
    }
    await context.close();
  } finally {
    await browser.close();
  }

  const videoPath = path.join(outDir, "alpha-next-walkthrough.mp4");
  try {
    stitchChaptersWithXfade(ffmpegPath, renderedSegments, videoPath);
  } finally {
    fs.rmSync(segmentsDir, { recursive: true, force: true });
  }

  const video = probeVideo(ffprobePath, videoPath);
  const contactSheets = buildQaContactSheets(outDir, videoPath, video.durationSec, ffmpegPath, magickPath);
  const reportPath = path.join(outDir, "walkthrough-report.json");
  const report: WalkthroughRenderReport = {
    video,
    chapters: chapters.map((chapter) => ({ id: chapter.id, title: chapter.title, durationSec: chapter.durationSec })),
    contactSheets,
    reportPath,
  };
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}
