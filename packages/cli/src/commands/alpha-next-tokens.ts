import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliContext, CommandResult } from "../runner.ts";

/** Validated uppercase `#RRGGBB` sRGB color string. */
export type HexColor = string & { readonly __brand: "HexColor" };

/** Validated Android density-independent pixel string such as `22dp`. */
export type DpLength = string & { readonly __brand: "DpLength" };

/** Supported Android resource generation targets for Alpha NEXT tokens. */
export type TokenSyncTarget = "launcher3" | "ipc";

/** Parsed and validated subset of `packages/design-system/tokens.json` required for Android resources. */
export interface ParsedDesignTokens {
  readonly light: ReadonlyMap<string, HexColor>;
  readonly dark: ReadonlyMap<string, HexColor>;
  readonly radius: DpLength;
  readonly rounded: ReadonlyMap<string, DpLength>;
  readonly fonts: ReadonlyMap<string, string>;
}

/** One deterministic generated Android XML file. */
export interface GeneratedResource {
  readonly target: TokenSyncTarget;
  readonly relativePath: string;
  readonly content: string;
  readonly sha256: string;
  readonly entryCount: number;
}

/** Summary of a bundled design-system font file's Android readiness. */
export interface FontAssetStatus {
  readonly file: string;
  readonly format: "woff2" | "woff" | "ttf" | "otf";
  readonly sha256: string;
  readonly androidReady: boolean;
}

/** One derived Android font or XML font-config output produced by `sync-fonts`. */
export interface GeneratedFontAsset {
  readonly relativePath: string;
  readonly sourcePath: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly kind: "ttf" | "xml";
}

/** Structured output of `pnpm cli alpha-next sync-fonts`. */
export interface SyncFontsReport {
  readonly subcommand: "sync-fonts";
  readonly mode: "dry-run" | "write" | "check";
  readonly decompressor: string;
  readonly files: readonly GeneratedFontAsset[];
  readonly missing: readonly string[];
  readonly stale: readonly string[];
}

/** Structured output of `pnpm cli alpha-next sync-tokens`. */
export interface SyncTokensReport {
  readonly subcommand: "sync-tokens";
  readonly mode: "dry-run" | "write" | "check";
  readonly tokensPath: string;
  readonly targets: readonly TokenSyncTarget[];
  readonly colorCounts: { readonly light: number; readonly dark: number };
  readonly radiusCount: number;
  readonly files: readonly GeneratedResource[];
  readonly fonts: readonly FontAssetStatus[];
  readonly fontSync?: SyncFontsReport;
  readonly missing: readonly string[];
  readonly stale: readonly string[];
}

/** Shared CLI flags consumed by token and font synchronization commands. */
export interface TokenSyncFlags {
  readonly check: boolean;
  readonly write: boolean;
  readonly withFonts: boolean;
  readonly target: string | undefined;
  readonly out: string | undefined;
  readonly tokens: string | undefined;
}

const OKLCH_PATTERN = /^oklch\(\s*([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s+([0-9]*\.?[0-9]+)\s*\)$/;
const LENGTH_PATTERN = /^([0-9]*\.?[0-9]+)(rem|px)$/;
const REM_TO_DP = 16;

/** Repository-relative Launcher3 RRO resource directory. */
export const LAUNCHER3_RES_ROOT = "apps/app/aosp/launcher3/overlay/res";

/** Repository-relative shared Android IPC library resource directory. */
export const IPC_RES_ROOT = "apps/app/android/alpha-ipc/src/main/res";

/** Repository-relative design tokens JSON file path. */
export const DEFAULT_TOKENS_PATH = "packages/design-system/tokens.json";

const DEFAULT_FONTS_DIR = "packages/design-system/fonts";
const PUBLIC_SANS_WOFF2 = `${DEFAULT_FONTS_DIR}/public-sans-latin.woff2`;
const FRAUNCES_TTF = `${DEFAULT_FONTS_DIR}/fraunces-italic-400.ttf`;
const WOFF2_DECOMPRESS_CANDIDATES = ["/usr/bin/woff2_decompress", "/usr/local/bin/woff2_decompress", "woff2_decompress"] as const;

const REQUIRED_LIGHT_COLORS = [
  "background",
  "foreground",
  "card",
  "secondary",
  "muted",
  "accent",
  "primary",
  "alpha",
] as const;

const REQUIRED_DARK_COLORS = [
  "background",
  "foreground",
  "card",
  "secondary",
  "accent",
  "primary",
] as const;

const REQUIRED_RADII = [
  "tile",
  "sheet",
  "home-card",
  "drawer-icon",
  "dock",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampUnit(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

function linearToSrgb(channel: number): number {
  const clamped = clampUnit(channel);
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * (clamped ** (1 / 2.4)) - 0.055;
}

function toHexByte(channel: number): string {
  const byte = Math.round(clampUnit(channel) * 255);
  return byte.toString(16).toUpperCase().padStart(2, "0");
}

function isHexColor(value: string): value is HexColor {
  return /^#[0-9A-F]{6}$/.test(value);
}

function isDpLength(value: string): value is DpLength {
  return /^[0-9]+(?:\.[0-9]+)?dp$/.test(value);
}

/** Compute lowercase SHA-256 hex digest of UTF-8 text or binary bytes. */
export function sha256Hex(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/** Convert an opaque CSS `oklch(L C H)` color string to an uppercase sRGB `#RRGGBB` hex string. */
export function oklchToHex(input: string): HexColor {
  const match = OKLCH_PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid oklch color value: "${input}"`);
  }
  const lValue = Number(match[1]);
  const chroma = Number(match[2]);
  const hue = Number(match[3]);
  if (!Number.isFinite(lValue) || lValue < 0 || lValue > 1 || !Number.isFinite(chroma) || chroma < 0 || !Number.isFinite(hue) || hue < 0 || hue > 360) {
    throw new Error(`Out-of-range oklch color value: "${input}"`);
  }
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lValue + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lValue - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lValue - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const r = linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s);
  const g = linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s);
  const bl = linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s);
  const candidate = `#${toHexByte(r)}${toHexByte(g)}${toHexByte(bl)}`;
  if (!isHexColor(candidate)) {
    throw new Error(`Failed to format hex color for "${input}"`);
  }
  return candidate;
}

/** Convert a CSS `rem` or `px` length token to an Android `dp` dimension string. */
export function cssLengthToDp(input: string): DpLength {
  const match = LENGTH_PATTERN.exec(input.trim());
  if (!match) {
    throw new Error(`Invalid CSS length value: "${input}"`);
  }
  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`Out-of-range CSS length value: "${input}"`);
  }
  const dp = unit === "rem" ? amount * REM_TO_DP : amount;
  const rounded = Math.round(dp * 100) / 100;
  const formatted = `${String(rounded)}dp`;
  if (!isDpLength(formatted)) {
    throw new Error(`Failed to format dp length for "${input}"`);
  }
  return formatted;
}

function toAndroidResourceKey(name: string): string {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!/^[a-z][a-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid Android resource token name: "${name}"`);
  }
  return normalized;
}

function parseColorMap(input: unknown, label: string): Map<string, HexColor> {
  if (!isRecord(input)) {
    throw new Error(`Expected object at ${label}`);
  }
  const result = new Map<string, HexColor>();
  for (const key of Object.keys(input).sort()) {
    const raw = input[key];
    if (typeof raw !== "string") {
      throw new Error(`Expected string color at ${label}.${key}`);
    }
    result.set(key, oklchToHex(raw));
  }
  return result;
}

function parseLengthMap(input: unknown, label: string): Map<string, DpLength> {
  if (!isRecord(input)) {
    throw new Error(`Expected object at ${label}`);
  }
  const result = new Map<string, DpLength>();
  for (const key of Object.keys(input).sort()) {
    const raw = input[key];
    if (typeof raw !== "string") {
      throw new Error(`Expected string length at ${label}.${key}`);
    }
    result.set(key, cssLengthToDp(raw));
  }
  return result;
}

function parseStringMap(input: unknown, label: string): Map<string, string> {
  if (!isRecord(input)) {
    throw new Error(`Expected object at ${label}`);
  }
  const result = new Map<string, string>();
  for (const key of Object.keys(input).sort()) {
    const raw = input[key];
    if (typeof raw !== "string" || raw.trim() === "") {
      throw new Error(`Expected non-empty string at ${label}.${key}`);
    }
    result.set(key, raw);
  }
  return result;
}

function requireFromMap<T>(map: ReadonlyMap<string, T>, key: string, group: string): T {
  const found = map.get(key);
  if (found === undefined) {
    throw new Error(`Missing required token ${group}.${key}`);
  }
  return found;
}

/** Validate and convert raw parsed JSON from `packages/design-system/tokens.json`. */
export function parseAlphaDesignTokens(raw: unknown): ParsedDesignTokens {
  if (!isRecord(raw)) {
    throw new Error("Design tokens root must be a JSON object");
  }
  if (!isRecord(raw.color)) {
    throw new Error("Design tokens must define a color object");
  }
  const light = parseColorMap(raw.color.light, "color.light");
  const dark = parseColorMap(raw.color.dark, "color.dark");
  if (typeof raw.radius !== "string") {
    throw new Error("Design tokens must define a string radius");
  }
  const radius = cssLengthToDp(raw.radius);
  const rounded = parseLengthMap(raw.rounded, "rounded");
  const fonts = parseStringMap(raw.font, "font");

  for (const key of REQUIRED_LIGHT_COLORS) {
    requireFromMap(light, key, "color.light");
  }
  for (const key of REQUIRED_DARK_COLORS) {
    requireFromMap(dark, key, "color.dark");
  }
  for (const key of REQUIRED_RADII) {
    requireFromMap(rounded, key, "rounded");
  }
  return { light, dark, radius, rounded, fonts };
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function renderXmlEntries(
  tag: "color" | "dimen",
  entries: readonly (readonly [string, string])[],
): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Generated from packages/design-system/tokens.json by pnpm cli alpha-next sync-tokens -->",
    "<resources>",
    ...entries.map(([name, value]) => `  <${tag} name="${escapeXml(name)}">${escapeXml(value)}</${tag}>`),
    "</resources>",
    "",
  ];
  return lines.join("\n");
}

function buildResource(
  target: TokenSyncTarget,
  relativePath: string,
  tag: "color" | "dimen",
  entries: readonly (readonly [string, string])[],
): GeneratedResource {
  const content = renderXmlEntries(tag, entries);
  return {
    target,
    relativePath,
    content,
    sha256: sha256Hex(content),
    entryCount: entries.length,
  };
}

function buildAlphaColorEntries(colors: ReadonlyMap<string, HexColor>): readonly (readonly [string, string])[] {
  return [...colors.entries()].map(([name, hex]) => [`alpha_color_${toAndroidResourceKey(name)}`, hex] as const);
}

function buildAlphaRadiusEntries(tokens: ParsedDesignTokens): readonly (readonly [string, string])[] {
  return [
    ["alpha_radius", tokens.radius] as const,
    ...[...tokens.rounded.entries()].map(([name, dp]) => [`alpha_radius_${toAndroidResourceKey(name)}`, dp] as const),
  ];
}

function generateIpcResources(tokens: ParsedDesignTokens): readonly GeneratedResource[] {
  return [
    buildResource("ipc", `${IPC_RES_ROOT}/values/colors.xml`, "color", buildAlphaColorEntries(tokens.light)),
    buildResource("ipc", `${IPC_RES_ROOT}/values-night/colors.xml`, "color", buildAlphaColorEntries(tokens.dark)),
    buildResource("ipc", `${IPC_RES_ROOT}/values/dimens.xml`, "dimen", buildAlphaRadiusEntries(tokens)),
  ];
}

function generateLauncher3Resources(tokens: ParsedDesignTokens): readonly GeneratedResource[] {
  const lightBg = requireFromMap(tokens.light, "background", "color.light");
  const lightFg = requireFromMap(tokens.light, "foreground", "color.light");
  const lightCard = requireFromMap(tokens.light, "card", "color.light");
  const lightSecondary = requireFromMap(tokens.light, "secondary", "color.light");
  const lightMuted = requireFromMap(tokens.light, "muted", "color.light");
  const lightPrimary = requireFromMap(tokens.light, "primary", "color.light");
  const alphaBlue = requireFromMap(tokens.light, "alpha", "color.light");

  const darkBg = requireFromMap(tokens.dark, "background", "color.dark");
  const darkFg = requireFromMap(tokens.dark, "foreground", "color.dark");
  const darkCard = requireFromMap(tokens.dark, "card", "color.dark");
  const darkSecondary = requireFromMap(tokens.dark, "secondary", "color.dark");
  const darkAccent = requireFromMap(tokens.dark, "accent", "color.dark");
  const darkPrimary = requireFromMap(tokens.dark, "primary", "color.dark");

  const tileRadius = requireFromMap(tokens.rounded, "tile", "rounded");
  const drawerIconRadius = requireFromMap(tokens.rounded, "drawer-icon", "rounded");
  const dockRadius = requireFromMap(tokens.rounded, "dock", "rounded");
  const homeCardRadius = requireFromMap(tokens.rounded, "home-card", "rounded");
  const sheetRadius = requireFromMap(tokens.rounded, "sheet", "rounded");

  const launcherLight: readonly (readonly [string, string])[] = [
    ...buildAlphaColorEntries(tokens.light),
    ["all_apps_bg_hand_off", lightBg],
    ["all_apps_label_text", lightFg],
    ["all_apps_tabs_background", lightSecondary],
    ["folder_background_light", lightCard],
    ["folder_dot_color", alphaBlue],
    ["launcher_accent_color", lightPrimary],
    ["material_color_primary", lightPrimary],
    ["notification_dot_color", alphaBlue],
    ["popup_color_background", lightBg],
    ["popup_color_primary_light", lightCard],
    ["popup_color_secondary_light", lightSecondary],
    ["popup_color_tertiary_light", lightMuted],
    ["surface", lightBg],
    ["widget_picker_surface", lightSecondary],
    ["workspace_text_color", lightFg],
  ];

  const launcherDark: readonly (readonly [string, string])[] = [
    ...buildAlphaColorEntries(tokens.dark),
    ["all_apps_bg_hand_off", darkBg],
    ["all_apps_label_text", darkFg],
    ["all_apps_tabs_background", darkSecondary],
    ["folder_background_dark", darkCard],
    ["folder_dot_color", alphaBlue],
    ["launcher_accent_color", darkPrimary],
    ["material_color_primary", darkPrimary],
    ["notification_dot_color", alphaBlue],
    ["popup_color_background", darkBg],
    ["popup_color_primary_dark", darkCard],
    ["popup_color_secondary_dark", darkSecondary],
    ["popup_color_tertiary_dark", darkAccent],
    ["surface", darkBg],
    ["widget_picker_surface", darkSecondary],
    ["workspace_text_color", darkFg],
  ];

  const launcherDimens: readonly (readonly [string, string])[] = [
    ...buildAlphaRadiusEntries(tokens),
    ["all_apps_header_pill_corner_radius", dockRadius],
    ["bg_round_rect_radius", tileRadius],
    ["dialogCornerRadius", tileRadius],
    ["enforced_rounded_corner_max_radius", homeCardRadius],
    ["folder_preview_corner_radius", drawerIconRadius],
    ["popup_single_item_radius", tileRadius],
    ["qsb_widget_radius", dockRadius],
    ["task_corner_radius_override", sheetRadius],
  ];

  return [
    buildResource("launcher3", `${LAUNCHER3_RES_ROOT}/values/colors.xml`, "color", launcherLight),
    buildResource("launcher3", `${LAUNCHER3_RES_ROOT}/values-night/colors.xml`, "color", launcherDark),
    buildResource("launcher3", `${LAUNCHER3_RES_ROOT}/values/dimens.xml`, "dimen", launcherDimens),
  ];
}

/** Generate deterministic Android XML resources from validated Alpha design tokens. */
export function generateAndroidResources(
  tokens: ParsedDesignTokens,
  targets: readonly TokenSyncTarget[] = ["launcher3", "ipc"],
): readonly GeneratedResource[] {
  const resources: GeneratedResource[] = [];
  for (const target of targets) {
    if (target === "launcher3") {
      resources.push(...generateLauncher3Resources(tokens));
    } else if (target === "ipc") {
      resources.push(...generateIpcResources(tokens));
    } else {
      const _exhaustive: never = target;
      throw new Error(`Unsupported target: ${String(_exhaustive)}`);
    }
  }
  return resources;
}

function inspectFonts(rootDir: string): readonly FontAssetStatus[] {
  const fontsDir = path.join(rootDir, DEFAULT_FONTS_DIR);
  if (!fs.existsSync(fontsDir)) return [];
  const results: FontAssetStatus[] = [];
  for (const name of fs.readdirSync(fontsDir).sort()) {
    const ext = path.extname(name).toLowerCase().slice(1);
    if (ext !== "woff2" && ext !== "woff" && ext !== "ttf" && ext !== "otf") continue;
    const filePath = path.join(fontsDir, name);
    if (!fs.statSync(filePath).isFile()) continue;
    results.push({
      file: `${DEFAULT_FONTS_DIR}/${name}`,
      format: ext,
      sha256: sha256Hex(fs.readFileSync(filePath)),
      androidReady: ext === "ttf" || ext === "otf",
    });
  }
  return results;
}

function findWoff2Decompressor(): string | undefined {
  for (const candidate of WOFF2_DECOMPRESS_CANDIDATES) {
    if (candidate.startsWith("/")) {
      if (fs.existsSync(candidate)) return candidate;
      continue;
    }
    try {
      const resolved = execFileSync("which", [candidate], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      if (resolved !== "" && fs.existsSync(resolved)) return resolved;
    } catch {
      continue;
    }
  }
  return undefined;
}

function decompressWoff2ToBuffer(decompressor: string, sourceFile: string): Buffer {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "alpha-next-font-"));
  try {
    const base = path.basename(sourceFile);
    const workInput = path.join(tmpDir, base);
    fs.copyFileSync(sourceFile, workInput);
    execFileSync(decompressor, [workInput], { stdio: ["ignore", "pipe", "pipe"] });
    const outputFile = workInput.replace(/\.woff2$/i, ".ttf");
    if (!fs.existsSync(outputFile)) {
      throw new Error(`woff2_decompress produced no .ttf output for ${sourceFile}`);
    }
    return fs.readFileSync(outputFile);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

/** Render deterministic Android XML font-mapping config referencing staged Launcher3 font assets. */
export function renderAlphaFontsXml(): string {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    "<!-- Generated from packages/design-system/fonts by pnpm cli alpha-next sync-fonts -->",
    '<alpha-fonts xmlns:android="http://schemas.android.com/apk/res/android">',
    '  <family name="public-sans" android:font="@font/alpha_public_sans" weight="400" style="normal" />',
    '  <family name="fraunces-display" android:font="@font/fraunces_italic_400" weight="400" style="italic" />',
    "</alpha-fonts>",
    "",
  ].join("\n");
}

interface BuiltFontOutput {
  readonly asset: GeneratedFontAsset;
  readonly payload: Buffer;
}

/** Derive Android `.ttf` fonts and `alpha_fonts.xml` for Launcher3 without modifying `packages/design-system/fonts/`. */
export function runSyncFonts(
  flags: Pick<TokenSyncFlags, "check" | "write" | "out">,
  ctx: CliContext,
): CommandResult<SyncFontsReport> {
  if (flags.check && flags.write) {
    return { ok: false, message: "Cannot combine --check and --write.", exitCode: 2 };
  }
  const decompressor = findWoff2Decompressor();
  if (!decompressor) {
    return {
      ok: false,
      message: "woff2_decompress not found on PATH or at /usr/bin/woff2_decompress. Install woff2 tools to derive Android .ttf fonts.",
    };
  }
  const publicSansSource = path.join(ctx.rootDir, PUBLIC_SANS_WOFF2);
  const frauncesSource = path.join(ctx.rootDir, FRAUNCES_TTF);
  if (!fs.existsSync(publicSansSource)) {
    return { ok: false, message: `Missing source font: ${PUBLIC_SANS_WOFF2}` };
  }
  if (!fs.existsSync(frauncesSource)) {
    return { ok: false, message: `Missing source font: ${FRAUNCES_TTF}` };
  }

  const publicSansBytes = decompressWoff2ToBuffer(decompressor, publicSansSource);
  const frauncesBytes = fs.readFileSync(frauncesSource);
  const xmlBytes = Buffer.from(renderAlphaFontsXml(), "utf8");

  const outputs: readonly BuiltFontOutput[] = [
    {
      payload: publicSansBytes,
      asset: {
        relativePath: `${LAUNCHER3_RES_ROOT}/font/alpha_public_sans.ttf`,
        sourcePath: PUBLIC_SANS_WOFF2,
        bytes: publicSansBytes.byteLength,
        sha256: sha256Hex(publicSansBytes),
        kind: "ttf",
      },
    },
    {
      payload: frauncesBytes,
      asset: {
        relativePath: `${LAUNCHER3_RES_ROOT}/font/fraunces_italic_400.ttf`,
        sourcePath: FRAUNCES_TTF,
        bytes: frauncesBytes.byteLength,
        sha256: sha256Hex(frauncesBytes),
        kind: "ttf",
      },
    },
    {
      payload: xmlBytes,
      asset: {
        relativePath: `${LAUNCHER3_RES_ROOT}/xml/alpha_fonts.xml`,
        sourcePath: DEFAULT_FONTS_DIR,
        bytes: xmlBytes.byteLength,
        sha256: sha256Hex(xmlBytes),
        kind: "xml",
      },
    },
  ];

  const outRoot = flags.out ? path.resolve(ctx.cwd, flags.out) : ctx.rootDir;
  const mode: SyncFontsReport["mode"] = flags.check ? "check" : flags.write ? "write" : "dry-run";
  const missing: string[] = [];
  const stale: string[] = [];

  for (const item of outputs) {
    const dest = path.join(outRoot, item.asset.relativePath);
    if (mode === "write") {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, item.payload);
    } else if (mode === "check") {
      if (!fs.existsSync(dest)) {
        missing.push(item.asset.relativePath);
      } else if (!fs.readFileSync(dest).equals(item.payload)) {
        stale.push(item.asset.relativePath);
      }
    }
  }

  const report: SyncFontsReport = {
    subcommand: "sync-fonts",
    mode,
    decompressor,
    files: outputs.map((item) => item.asset),
    missing,
    stale,
  };

  if (mode === "check" && (missing.length > 0 || stale.length > 0)) {
    const details = [
      ...(missing.length > 0 ? [`missing: ${missing.join(", ")}`] : []),
      ...(stale.length > 0 ? [`stale: ${stale.join(", ")}`] : []),
    ].join("; ");
    return {
      ok: false,
      message: `Android font resources are out of sync (${details}). Run "pnpm cli alpha-next sync-fonts --write".`,
      data: report,
    };
  }

  const lines = [
    `alpha-next sync-fonts (${mode})  decompressor:${decompressor}`,
    ...report.files.map((file) => `  ${file.relativePath}  (${String(file.bytes)} B, sha256:${file.sha256.slice(0, 12)})`),
  ];
  return { ok: true, data: report, lines };
}

function resolveTargets(rawTarget: string | undefined): readonly TokenSyncTarget[] | undefined {
  if (rawTarget === undefined || rawTarget === "all") return ["launcher3", "ipc"];
  if (rawTarget === "launcher3" || rawTarget === "ipc") return [rawTarget];
  return undefined;
}

/** Execute `pnpm cli alpha-next sync-tokens`, optionally chaining font derivation when `--with-fonts` is set. */
export function runSyncTokens(flags: TokenSyncFlags, ctx: CliContext): CommandResult<SyncTokensReport> {
  if (flags.check && flags.write) {
    return { ok: false, message: "Cannot combine --check and --write.", exitCode: 2 };
  }
  const targets = resolveTargets(flags.target);
  if (!targets) {
    return { ok: false, message: `Invalid --target "${flags.target ?? ""}". Expected: all, launcher3, or ipc.`, exitCode: 2 };
  }
  const tokensPath = flags.tokens ? path.resolve(ctx.cwd, flags.tokens) : path.join(ctx.rootDir, DEFAULT_TOKENS_PATH);
  if (!fs.existsSync(tokensPath)) {
    return { ok: false, message: `Design tokens file not found: ${tokensPath}` };
  }
  const parsedJson: unknown = JSON.parse(fs.readFileSync(tokensPath, "utf8"));
  const tokens = parseAlphaDesignTokens(parsedJson);
  const files = generateAndroidResources(tokens, targets);
  const fonts = inspectFonts(ctx.rootDir);
  const outRoot = flags.out ? path.resolve(ctx.cwd, flags.out) : ctx.rootDir;
  const mode: SyncTokensReport["mode"] = flags.check ? "check" : flags.write ? "write" : "dry-run";
  const missing: string[] = [];
  const stale: string[] = [];

  for (const resource of files) {
    const dest = path.join(outRoot, resource.relativePath);
    if (mode === "write") {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, resource.content, "utf8");
    } else if (mode === "check") {
      if (!fs.existsSync(dest)) {
        missing.push(resource.relativePath);
      } else if (fs.readFileSync(dest, "utf8") !== resource.content) {
        stale.push(resource.relativePath);
      }
    }
  }

  let fontSyncResult: CommandResult<SyncFontsReport> | undefined;
  if (flags.withFonts) {
    fontSyncResult = runSyncFonts(flags, ctx);
    if (!fontSyncResult.ok && fontSyncResult.data === undefined) {
      return { ok: false, message: fontSyncResult.message, ...(fontSyncResult.exitCode !== undefined ? { exitCode: fontSyncResult.exitCode } : {}) };
    }
  }

  const fontSyncData = fontSyncResult?.data;
  const report: SyncTokensReport = {
    subcommand: "sync-tokens",
    mode,
    tokensPath: path.relative(ctx.rootDir, tokensPath).split(path.sep).join("/"),
    targets,
    colorCounts: { light: tokens.light.size, dark: tokens.dark.size },
    radiusCount: tokens.rounded.size + 1,
    files,
    fonts,
    ...(fontSyncData !== undefined ? { fontSync: fontSyncData } : {}),
    missing: [...missing, ...(fontSyncData?.missing ?? [])],
    stale: [...stale, ...(fontSyncData?.stale ?? [])],
  };

  if (mode === "check" && (report.missing.length > 0 || report.stale.length > 0)) {
    const details = [
      ...(report.missing.length > 0 ? [`missing: ${report.missing.join(", ")}`] : []),
      ...(report.stale.length > 0 ? [`stale: ${report.stale.join(", ")}`] : []),
    ].join("; ");
    return {
      ok: false,
      message: `Android design token resources are out of sync (${details}). Run "pnpm cli alpha-next sync-tokens --write${flags.withFonts ? " --with-fonts" : ""}".`,
      data: report,
    };
  }

  const lines = [
    `alpha-next sync-tokens (${mode})  targets:${targets.join(",")}  light:${String(tokens.light.size)}  dark:${String(tokens.dark.size)}  radii:${String(tokens.rounded.size + 1)}`,
    ...files.map((file) => `  ${file.relativePath}  (${String(file.entryCount)} entries, sha256:${file.sha256.slice(0, 12)})`),
    ...(fontSyncResult?.ok && fontSyncResult.lines ? fontSyncResult.lines : []),
    `fonts: ${String(fonts.filter((font) => font.androidReady).length)}/${String(fonts.length)} android-ready (.ttf/.otf)`,
  ];
  return { ok: true, data: report, lines };
}
