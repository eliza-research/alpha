// spec/agent/index.md, "Story: Run Alpha's agent on the phone"
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { type AgentRoute, asRecord, readString } from "./types.ts";

/** Supported AI provider routing modes on Alpha. */
export type LocalAiMode = "local" | "cloud" | "own-key";

/** Optional companion GGUF artifact entry. */
export interface LocalLlmCompanionArtifact {
  readonly role: "mtp" | "vision";
  readonly relativePath: string;
  readonly fileName: string;
  readonly url: string;
  readonly sizeBytes: number;
  readonly sha256: string;
}

/** Curated on-device GGUF catalog entry pinned by SHA-256. */
export interface LocalLlmCatalogEntry {
  readonly id: string;
  readonly displayName: string;
  readonly family: "gemma4" | "qwen35" | "embedding";
  readonly role: "chat" | "embedding";
  readonly license: string;
  readonly repo: string;
  readonly fileName: string;
  readonly url: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly minRamMb: number;
  readonly contextLength: number;
  readonly recommended: boolean;
  readonly optionalArtifacts: readonly LocalLlmCompanionArtifact[];
  readonly description: string;
}

/** Parsed structured tool call returned to eliza's agent planner. */
export interface LocalToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: Record<string, unknown> | string;
}

/** Token usage metadata returned by local inference. */
export interface LocalTokenUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

/** OpenAI/eliza-compatible completion envelope returned by local inference. */
export interface LocalGenerateResult {
  readonly text: string;
  readonly toolCalls: readonly LocalToolCall[];
  readonly finishReason: string;
  readonly usage?: LocalTokenUsage;
}

/** Persisted and live status returned by {@code GET /api/alpha/local-llm/status}. */
export interface LocalLlmStatus {
  readonly mode: LocalAiMode;
  readonly activeModelId: string;
  readonly activeStatus: "idle" | "ready" | "failed";
  readonly transport: "uds" | "loopback-http" | "none";
  readonly engineReady: boolean;
  readonly localScopeActive: boolean;
  readonly lastError: string | null;
  readonly models: readonly LocalLlmCatalogEntry[];
}

/** Default recommended on-device chat model identifier. */
export const LOCAL_LLM_DEFAULT_MODEL_ID = "gemma-4-e2b-it-q4";

/** Pinned Apache-2.0 and MIT GGUF catalog shared with {@code AlphaLocalLlmCatalog}. */
export const LOCAL_LLM_CATALOG: readonly LocalLlmCatalogEntry[] = [
  {
    id: LOCAL_LLM_DEFAULT_MODEL_ID,
    displayName: "Gemma 4 E2B IT (Q4_0)",
    family: "gemma4",
    role: "chat",
    license: "Apache-2.0",
    repo: "ggml-org/gemma-4-E2B-it-GGUF",
    fileName: "gemma-4-E2B-it-Q4_0.gguf",
    url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_0.gguf",
    sizeBytes: 2_841_481_184,
    sha256: "8e30dff3ac4c8434c49a7036fa15564bdbb6044e42bf04550bf1a096ad7e6a52",
    minRamMb: 6144,
    contextLength: 131_072,
    recommended: true,
    optionalArtifacts: [
      {
        role: "mtp",
        relativePath: "mtp/mtp-gemma-4-E2B-it-Q4_0.gguf",
        fileName: "mtp-gemma-4-E2B-it-Q4_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/mtp-gemma-4-E2B-it-Q4_0.gguf",
        sizeBytes: 59_235_872,
        sha256: "718d3a44057924d5840c65a0aeedf7929366adeeda92a2006955ccabaf645ef4",
      },
      {
        role: "vision",
        relativePath: "vision/mmproj-gemma-4-E2B-it-Q8_0.gguf",
        fileName: "mmproj-gemma-4-E2B-it-Q8_0.gguf",
        url: "https://huggingface.co/ggml-org/gemma-4-E2B-it-GGUF/resolve/main/mmproj-gemma-4-E2B-it-Q8_0.gguf",
        sizeBytes: 557_368_096,
        sha256: "042cc2561806cd3b5cb5efb25cab76911e3100c43cc09d854904f921924b1429",
      },
    ],
    description: "Recommended default for 8 GB phones: 2.3B effective parameters with compact KV cache, native tool calling, optional MTP drafter, and vision.",
  },
  {
    id: "qwen3.5-4b-q4",
    displayName: "Qwen 3.5 4B (Q4_K_M)",
    family: "qwen35",
    role: "chat",
    license: "Apache-2.0",
    repo: "unsloth/Qwen3.5-4B-GGUF",
    fileName: "Qwen3.5-4B-Q4_K_M.gguf",
    url: "https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/resolve/main/Qwen3.5-4B-Q4_K_M.gguf",
    sizeBytes: 2_740_937_888,
    sha256: "00fe7986ff5f6b463e62455821146049db6f9313603938a70800d1fb69ef11a4",
    minRamMb: 6144,
    contextLength: 262_144,
    recommended: false,
    optionalArtifacts: [],
    description: "High-precision structured JSON and multi-step tool-calling alternative in a compact 2.74 GB footprint.",
  },
  {
    id: "gemma-4-e4b-it-q2xl",
    displayName: "Gemma 4 E4B IT (UD-Q2_K_XL)",
    family: "gemma4",
    role: "chat",
    license: "Apache-2.0",
    repo: "unsloth/gemma-4-E4B-it-GGUF",
    fileName: "gemma-4-E4B-it-UD-Q2_K_XL.gguf",
    url: "https://huggingface.co/unsloth/gemma-4-E4B-it-GGUF/resolve/main/gemma-4-E4B-it-UD-Q2_K_XL.gguf",
    sizeBytes: 3_757_419_648,
    sha256: "cc92186419be169e992a1df01978828a0d4cf3a5962379ff403c8d55f6faff78",
    minRamMb: 7168,
    contextLength: 131_072,
    recommended: false,
    optionalArtifacts: [],
    description: "High-capacity opt-in Gemma 4 E4B tier (4.5B effective parameters) for devices with at least 8 GB RAM.",
  },
  {
    id: "bge-small-en-v1.5",
    displayName: "BGE Small EN v1.5 (F16)",
    family: "embedding",
    role: "embedding",
    license: "MIT",
    repo: "CompendiumLabs/bge-small-en-v1.5-gguf",
    fileName: "bge-small-en-v1.5-f16.gguf",
    url: "https://huggingface.co/CompendiumLabs/bge-small-en-v1.5-gguf/resolve/d32f8c040ea3b516330eeb75b72bcc2d3a780ab7/bge-small-en-v1.5-f16.gguf",
    sizeBytes: 67_308_128,
    sha256: "f0b2fef971e8366438bfd2d9aefea1b0115919389448806d290237f638bae999",
    minRamMb: 2048,
    contextLength: 512,
    recommended: true,
    optionalArtifacts: [],
    description: "Compact 384-dimensional CLS embedding model matching Alpha Cloud vector space for offline memory search.",
  },
];

const VALID_MODES = new Set<LocalAiMode>(["local", "cloud", "own-key"]);
const GEMMA_THOUGHT = /<\|thought\|?>[\s\S]*?<\|?thought\|?>/g;
const QWEN_THINK = /<think>[\s\S]*?<\/think>/g;
const GEMMA_WRAPPED_CALL = /<\|tool_call>\s*call:([A-Za-z0-9_.-]+)(\{[\s\S]*?\})\s*<tool_call\|>/g;
const GEMMA_DIRECT_CALL = /<\|call:([A-Za-z0-9_.-]+)(\{[\s\S]*?\})\|>/g;
const QWEN_TOOL_BLOCK = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const QWEN_FUNCTION_BLOCK = /^<function=([^>\s]+)>([\s\S]*?)<\/function>$/;
const QWEN_PARAMETER = /<parameter=([^>\s]+)>([\s\S]*?)<\/parameter>/g;
const GEMMA_QUOTED = /<\|"\|>([\s\S]*?)<\|"\|>/g;
const UNQUOTED_KEY = /([{,]\s*)([A-Za-z_][A-Za-z0-9_-]*)\s*:/g;

interface LocalModelParams {
  readonly system?: string;
  readonly prompt?: string;
  readonly messages?: readonly Record<string, unknown>[];
  readonly tools?: readonly {
    readonly name: string;
    readonly description?: string;
    readonly parameters?: unknown;
    readonly strict?: boolean;
  }[];
  readonly toolChoice?: unknown;
  readonly responseSchema?: unknown;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly stream?: boolean;
  readonly signal?: AbortSignal;
  readonly onStreamChunk?: (chunk: string, messageId?: string, accumulated?: string) => void | Promise<void>;
  readonly providerOptions?: {
    readonly eliza?: {
      readonly onToolCalls?: (text: string, calls: readonly LocalToolCall[]) => void | Promise<void>;
    };
  };
}

interface RegisterableRuntime {
  registerModel?: (
    modelType: string,
    handler: (runtime: unknown, params: unknown) => Promise<unknown>,
    provider: string,
    priority?: number,
    metadata?: Record<string, unknown>,
  ) => void;
}

function isLocalAiMode(value: unknown): value is LocalAiMode {
  return typeof value === "string" && VALID_MODES.has(value as LocalAiMode);
}

function catalogEntryById(modelId: string | undefined): LocalLlmCatalogEntry | undefined {
  if (modelId === undefined) return undefined;
  return LOCAL_LLM_CATALOG.find((entry) => entry.id === modelId);
}

function isLoopbackUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    return parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "::1" || parsed.hostname === "[::1]";
  } catch {
    return false;
  }
}

function parseJsonRecord(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function parseGemmaArgs(raw: string): Record<string, unknown> | undefined {
  const direct = parseJsonRecord(raw.trim());
  if (direct !== undefined) return direct;
  const quoted = raw.trim().replace(GEMMA_QUOTED, (_m, inner: string) => JSON.stringify(inner));
  const jsonified = quoted.replace(UNQUOTED_KEY, '$1"$2":');
  return parseJsonRecord(jsonified);
}

function parsePrimitive(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (trimmed === "null") return null;
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      return JSON.parse(trimmed) as unknown;
    } catch {
      return raw;
    }
  }
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(trimmed)) {
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) return parsed;
  }
  return raw;
}

/** Parses Gemma 4 and Qwen 3.5 raw local model output into structured text and tool calls. */
export function parseLocalModelOutput(
  rawText: string,
  allowedToolNames?: ReadonlySet<string>,
  usage?: LocalTokenUsage,
): LocalGenerateResult {
  let cleaned = rawText
    .replace(/<end_of_turn>[\s\S]*$/u, "")
    .replace(/<eos>[\s\S]*$/u, "")
    .replace(/<\|im_end\|>[\s\S]*$/u, "")
    .replace(GEMMA_THOUGHT, "")
    .replace(QWEN_THINK, "");

  const toolCalls: LocalToolCall[] = [];
  const acceptTool = (name: string) => allowedToolNames === undefined || allowedToolNames.size === 0 || allowedToolNames.has(name);

  const replaceGemma = (pattern: RegExp, input: string) =>
    input.replace(pattern, (whole, name: string, rawArgs: string) => {
      if (!acceptTool(name)) return whole;
      const args = parseGemmaArgs(rawArgs);
      if (args === undefined) return whole;
      toolCalls.push({ id: `call_local_${randomUUID()}`, name, arguments: args });
      return "";
    });

  cleaned = replaceGemma(GEMMA_WRAPPED_CALL, cleaned);
  cleaned = replaceGemma(GEMMA_DIRECT_CALL, cleaned);

  cleaned = cleaned.replace(QWEN_TOOL_BLOCK, (whole, body: string) => {
    const inner = body.trim();
    const fnMatch = QWEN_FUNCTION_BLOCK.exec(inner);
    if (fnMatch !== null) {
      const name = fnMatch[1]?.trim() ?? "";
      if (!acceptTool(name)) return whole;
      const args: Record<string, unknown> = {};
      const paramsBody = fnMatch[2] ?? "";
      paramsBody.replace(QWEN_PARAMETER, (_p, key: string, rawValue: string) => {
        args[key.trim()] = parsePrimitive(rawValue.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));
        return "";
      });
      toolCalls.push({ id: `call_local_${randomUUID()}`, name, arguments: args });
      return "";
    }
    const parsed = parseJsonRecord(inner);
    const name = typeof parsed?.name === "string" ? parsed.name.trim() : "";
    if (name === "" || !acceptTool(name)) return whole;
    const rawArgs = parsed?.arguments;
    const args = typeof rawArgs === "string"
      ? parseJsonRecord(rawArgs) ?? {}
      : typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    toolCalls.push({ id: `call_local_${randomUUID()}`, name, arguments: args });
    return "";
  });

  const text = cleaned.trim();
  return {
    text,
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
    ...(usage === undefined ? {} : { usage }),
  };
}

function wireMessagesOf(params: LocalModelParams): readonly Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  if (typeof params.system === "string" && params.system.trim() !== "") {
    out.push({ role: "system", content: params.system });
  }
  const messageList = params.messages;
  if (messageList !== undefined && messageList.length > 0) {
    for (const rawMsg of messageList) {
      const msg = asRecord(rawMsg);
      const role = typeof msg.role === "string" ? msg.role : "user";
      const rawContent = msg.content;
      const content = typeof rawContent === "string"
        ? rawContent
        : Array.isArray(rawContent)
          ? rawContent
              .map((part: unknown) => {
                const p = asRecord(part);
                return p.type === "text" && typeof p.text === "string" ? p.text : "";
              })
              .join("")
          : "";
      const rawCalls: readonly unknown[] = Array.isArray(msg.toolCalls) ? (msg.toolCalls as readonly unknown[]) : [];
      const calls = rawCalls.map((call) => {
        const c = asRecord(call);
        const rawArgs = c.arguments;
        return {
          id: typeof c.id === "string" ? c.id : `call_${randomUUID()}`,
          type: "function",
          function: {
            name: typeof c.name === "string" ? c.name : "",
            arguments: typeof rawArgs === "string" ? rawArgs : JSON.stringify(rawArgs ?? {}),
          },
        };
      });
      out.push({
        role,
        content,
        ...(typeof msg.name === "string" ? { name: msg.name } : {}),
        ...(typeof msg.toolCallId === "string" ? { tool_call_id: msg.toolCallId } : {}),
        ...(calls.length > 0 ? { tool_calls: calls } : {}),
      });
    }
    return out;
  }
  if (typeof params.prompt === "string" && params.prompt !== "") {
    out.push({ role: "user", content: params.prompt });
  }
  return out;
}

function wireToolsOf(params: LocalModelParams): readonly Record<string, unknown>[] {
  const toolList = params.tools;
  if (toolList === undefined || toolList.length === 0) return [];
  return toolList.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === undefined ? {} : { description: tool.description }),
      parameters: tool.parameters ?? { type: "object", properties: {} },
    },
  }));
}

function parseWireToolCalls(rawCalls: unknown): LocalToolCall[] {
  if (!Array.isArray(rawCalls)) return [];
  const out: LocalToolCall[] = [];
  for (const item of rawCalls) {
    const rec = asRecord(item);
    const fn = asRecord(rec.function);
    const name = typeof fn.name === "string" ? fn.name : typeof rec.name === "string" ? rec.name : "";
    if (name === "") continue;
    const rawArgs = fn.arguments !== undefined ? fn.arguments : rec.arguments;
    const parsedArgs = typeof rawArgs === "string"
      ? (parseJsonRecord(rawArgs) ?? rawArgs)
      : typeof rawArgs === "object" && rawArgs !== null && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : {};
    out.push({
      id: typeof rec.id === "string" && rec.id !== "" ? rec.id : `call_local_${randomUUID()}`,
      name,
      arguments: parsedArgs,
    });
  }
  return out;
}

function parseUsageRecord(raw: unknown): LocalTokenUsage | undefined {
  const rec = asRecord(raw);
  const prompt = typeof rec.promptTokens === "number" ? rec.promptTokens : typeof rec.prompt_tokens === "number" ? rec.prompt_tokens : undefined;
  const completion = typeof rec.completionTokens === "number" ? rec.completionTokens : typeof rec.completion_tokens === "number" ? rec.completion_tokens : undefined;
  if (prompt === undefined || completion === undefined) return undefined;
  const total = typeof rec.totalTokens === "number" ? rec.totalTokens : typeof rec.total_tokens === "number" ? rec.total_tokens : prompt + completion;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

/** Coordinates local LLM state, UDS/loopback inference calls, and Settings routes inside {@code apps/agent}. */
export class AlphaLocalLlmController {
  private readonly stateFile: string | undefined;
  private readonly socketPath: string | undefined;
  private readonly loopbackUrl: string | undefined;
  private currentMode: LocalAiMode;
  private currentModelId: string;
  private currentStatus: "idle" | "ready" | "failed";
  private lastErrorMessage: string | null = null;

  constructor(options: {
    readonly stateDirectory?: string;
    readonly launchBackend?: string;
    readonly environment?: Readonly<Record<string, string>>;
  } = {}) {
    this.stateFile = options.stateDirectory === undefined ? undefined : path.join(options.stateDirectory, "alpha-local-llm.json");
    const envSocket = options.environment?.ALPHA_LOCAL_LLM_SOCKET?.trim();
    const envUrl = options.environment?.ALPHA_LOCAL_LLM_URL?.trim();
    this.socketPath = envSocket !== undefined && envSocket !== "" ? envSocket : undefined;
    this.loopbackUrl = envUrl !== undefined && envUrl !== "" && isLoopbackUrl(envUrl) ? envUrl.replace(/\/+$/, "") : undefined;
    const envMode = options.environment?.ALPHA_AI_MODE?.trim();
    const envModel = options.environment?.ALPHA_LOCAL_MODEL?.trim();

    this.currentMode = isLocalAiMode(envMode)
      ? envMode
      : options.launchBackend === "none" && (this.socketPath !== undefined || this.loopbackUrl !== undefined)
        ? "local"
        : options.launchBackend === "own-key"
          ? "own-key"
          : "cloud";
    this.currentModelId = catalogEntryById(envModel)?.id ?? LOCAL_LLM_DEFAULT_MODEL_ID;
    this.currentStatus = this.currentMode === "local" && this.hasLocalTransport() ? "ready" : "idle";
    this.loadPersistedState();
  }

  /** Returns the active AI routing mode. */
  mode(): LocalAiMode {
    return this.currentMode;
  }

  /** Returns the active curated local model identifier. */
  activeModelId(): string {
    return this.currentModelId;
  }

  /** True when either a private Unix socket or loopback HTTP inference harness is configured. */
  hasLocalTransport(): boolean {
    return this.socketPath !== undefined || this.loopbackUrl !== undefined;
  }

  /** True when the resident agent should register local text model handlers. */
  shouldServeLocalText(): boolean {
    return this.currentMode === "local" && this.hasLocalTransport();
  }

  /** Returns the current status snapshot, probing the UDS host when configured. */
  async status(): Promise<LocalLlmStatus> {
    let engineReady = this.loopbackUrl !== undefined;
    if (this.socketPath !== undefined) {
      const probe = await this.udsExchange({ id: randomUUID(), op: "status" }).catch(() => undefined);
      engineReady = probe !== undefined && probe.ok === true;
    }
    return {
      mode: this.currentMode,
      activeModelId: this.currentModelId,
      activeStatus: this.currentStatus,
      transport: this.socketPath !== undefined ? "uds" : this.loopbackUrl !== undefined ? "loopback-http" : "none",
      engineReady,
      localScopeActive: this.currentMode === "local",
      lastError: this.lastErrorMessage,
      models: LOCAL_LLM_CATALOG,
    };
  }

  /** Updates persisted AI mode and optional model selection. */
  setMode(mode: LocalAiMode, modelId?: string): LocalLlmStatus {
    if (modelId !== undefined) {
      const entry = catalogEntryById(modelId);
      if (entry === undefined) throw new Error(`Unknown model: ${modelId}`);
      this.currentModelId = entry.id;
    }
    this.currentMode = mode;
    this.currentStatus = mode === "local" && this.hasLocalTransport() ? "ready" : "idle";
    this.lastErrorMessage = null;
    this.persistState();
    return {
      mode: this.currentMode,
      activeModelId: this.currentModelId,
      activeStatus: this.currentStatus,
      transport: this.socketPath !== undefined ? "uds" : this.loopbackUrl !== undefined ? "loopback-http" : "none",
      engineReady: this.hasLocalTransport(),
      localScopeActive: this.currentMode === "local",
      lastError: this.lastErrorMessage,
      models: LOCAL_LLM_CATALOG,
    };
  }

  /** Activates {@code modelId}, asking the local UDS inference host to load it when present. */
  async activate(modelId: string): Promise<{ readonly ok: boolean; readonly activeModelId: string; readonly activeStatus: "idle" | "ready" | "failed" }> {
    const entry = catalogEntryById(modelId);
    if (entry === undefined) throw new Error(`Unknown model: ${modelId}`);
    if (this.socketPath !== undefined) {
      const reply = await this.udsExchange({ id: randomUUID(), op: "load", modelId: entry.id });
      if (reply.ok !== true) {
        this.currentStatus = "failed";
        this.lastErrorMessage = typeof reply.error === "string" ? reply.error : "LOAD_FAILED";
        this.persistState();
        return { ok: false, activeModelId: this.currentModelId, activeStatus: this.currentStatus };
      }
    }
    this.currentModelId = entry.id;
    this.currentStatus = "ready";
    this.lastErrorMessage = null;
    this.persistState();
    return { ok: true, activeModelId: this.currentModelId, activeStatus: this.currentStatus };
  }

  /** Unloads and clears active state for {@code modelId}. */
  async deleteModel(modelId: string): Promise<{ readonly ok: boolean; readonly deletedModelId: string; readonly activeModelId: string }> {
    const entry = catalogEntryById(modelId);
    if (entry === undefined) throw new Error(`Unknown model: ${modelId}`);
    if (this.socketPath !== undefined && this.currentModelId === entry.id) {
      await this.udsExchange({ id: randomUUID(), op: "unload", modelId: entry.id }).catch(() => undefined);
    }
    if (this.currentModelId === entry.id) {
      this.currentStatus = "idle";
      this.persistState();
    }
    return { ok: true, deletedModelId: entry.id, activeModelId: this.currentModelId };
  }

  /** Executes one local chat completion over UDS or loopback HTTP, honoring streaming and tool calling. */
  async generate(rawParams: unknown): Promise<string | LocalGenerateResult> {
    const params = asRecord(rawParams) as LocalModelParams;
    const messages = wireMessagesOf(params);
    const tools = wireToolsOf(params);
    const allowedToolNames = new Set((params.tools ?? []).map((tool) => tool.name));
    const wantsResult = (params.tools?.length ?? 0) > 0
      || (typeof params.toolChoice === "object" && params.toolChoice !== null)
      || params.responseSchema !== undefined;

    const rawResult = this.socketPath !== undefined
      ? await this.generateOverUds(messages, tools, allowedToolNames, params)
      : this.loopbackUrl !== undefined
        ? await this.generateOverLoopbackHttp(messages, tools, allowedToolNames, params)
        : undefined;

    if (rawResult === undefined) {
      throw new Error("Local LLM transport is not configured");
    }
    if (rawResult.toolCalls.length > 0 && params.providerOptions?.eliza?.onToolCalls !== undefined) {
      await params.providerOptions.eliza.onToolCalls(rawResult.text, rawResult.toolCalls);
    }
    return wantsResult ? rawResult : rawResult.text;
  }

  private async generateOverUds(
    messages: readonly Record<string, unknown>[],
    tools: readonly Record<string, unknown>[],
    allowedToolNames: ReadonlySet<string>,
    params: LocalModelParams,
  ): Promise<LocalGenerateResult> {
    const socket = this.socketPath;
    if (socket === undefined) throw new Error("Local LLM socket is not configured");
    const streamed = params.stream === true || params.onStreamChunk !== undefined;
    const reqId = randomUUID();
    const request = {
      id: reqId,
      op: streamed ? "generate_stream" : "generate",
      modelId: this.currentModelId,
      messages,
      ...(tools.length > 0 ? { tools } : {}),
      ...(params.maxTokens === undefined ? {} : { maxTokens: params.maxTokens }),
      ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
    };

    return new Promise<LocalGenerateResult>((resolve, reject) => {
      const conn = net.createConnection(socket);
      let buffer = "";
      let accumulated = "";
      let settled = false;

      const onAbort = () => {
        if (settled) return;
        settled = true;
        conn.destroy();
        reject(new Error("The local model call was aborted"));
      };
      if (params.signal?.aborted) {
        onAbort();
        return;
      }
      params.signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        params.signal?.removeEventListener("abort", onAbort);
        conn.end();
        fn();
      };

      const processLines = async () => {
        for (let idx = buffer.indexOf("\n"); idx >= 0; idx = buffer.indexOf("\n")) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (line === "") continue;
          const frame = asRecord(JSON.parse(line) as unknown);
          const event = readString(frame, "event");
          if (event === "delta") {
            const delta = typeof frame.text === "string" ? frame.text : "";
            if (delta !== "") {
              accumulated += delta;
              if (params.onStreamChunk !== undefined) {
                await params.onStreamChunk(delta, undefined, accumulated);
              }
            }
            continue;
          }
          if (event === "error" || frame.ok === false) {
            const errMsg = typeof frame.error === "string" ? frame.error : "Local inference failed";
            finish(() => reject(new Error(errMsg)));
            return;
          }
          if (event === "done" || !streamed) {
            const wireCalls = parseWireToolCalls(frame.toolCalls);
            const rawText = typeof frame.text === "string" ? frame.text : accumulated;
            const usage = parseUsageRecord(frame.usage);
            if (wireCalls.length > 0) {
              finish(() => resolve({
                text: rawText,
                toolCalls: wireCalls,
                finishReason: typeof frame.finishReason === "string" ? frame.finishReason : "tool_calls",
                ...(usage === undefined ? {} : { usage }),
              }));
              return;
            }
            const parsed = parseLocalModelOutput(rawText, allowedToolNames, usage);
            finish(() => resolve(parsed));
            return;
          }
        }
      };

      let queue = Promise.resolve();
      conn.setEncoding("utf8");
      conn.on("connect", () => {
        conn.write(`${JSON.stringify(request)}\n`);
      });
      conn.on("data", (chunk: string) => {
        buffer += chunk;
        queue = queue.then(() => processLines()).catch((err: unknown) => {
          finish(() => reject(err instanceof Error ? err : new Error(String(err))));
        });
      });
      conn.on("error", (err) => finish(() => reject(err)));
      conn.on("close", () => {
        void queue.finally(() => {
          if (!settled) {
            finish(() => reject(new Error("Local inference socket closed before completion")));
          }
        });
      });
    });
  }

  private async generateOverLoopbackHttp(
    messages: readonly Record<string, unknown>[],
    tools: readonly Record<string, unknown>[],
    allowedToolNames: ReadonlySet<string>,
    params: LocalModelParams,
  ): Promise<LocalGenerateResult> {
    const baseUrl = this.loopbackUrl;
    if (baseUrl === undefined || !isLoopbackUrl(baseUrl)) {
      throw new Error("Local LLM loopback URL is missing or non-loopback");
    }
    const streamed = params.stream === true || params.onStreamChunk !== undefined;
    const payload = JSON.stringify({
      model: this.currentModelId,
      messages,
      stream: streamed,
      ...(tools.length > 0 ? { tools } : {}),
      ...(params.maxTokens === undefined ? {} : { max_tokens: params.maxTokens }),
      ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
    });

    return new Promise<LocalGenerateResult>((resolve, reject) => {
      const req = http.request(
        `${baseUrl}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "content-length": String(Buffer.byteLength(payload)),
          },
          signal: params.signal,
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const contentType = String(res.headers["content-type"] ?? "");
          if (status < 200 || status >= 300) {
            let errBody = "";
            res.setEncoding("utf8").on("data", (d: string) => { errBody += d; }).on("end", () => {
              reject(new Error(`Local loopback LLM answered ${status}: ${errBody}`));
            });
            return;
          }
          if (streamed && contentType.startsWith("text/event-stream")) {
            let pending = "";
            let text = "";
            let finishReason = "stop";
            let usage: LocalTokenUsage | undefined;
            const callAcc: { id: string; name: string; arguments: string }[] = [];
            let queue = Promise.resolve();

            const drain = async () => {
              for (let idx = pending.indexOf("\n"); idx >= 0; idx = pending.indexOf("\n")) {
                const rawLine = pending.slice(0, idx).trim();
                pending = pending.slice(idx + 1);
                if (!rawLine.startsWith("data:")) continue;
                const data = rawLine.slice(5).trim();
                if (data === "[DONE]") continue;
                const parsed = asRecord(JSON.parse(data) as unknown);
                usage = parseUsageRecord(parsed.usage) ?? usage;
                const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
                const first = asRecord(choices[0]);
                if (typeof first.finish_reason === "string") finishReason = first.finish_reason;
                const delta = asRecord(first.delta);
                if (typeof delta.content === "string" && delta.content !== "") {
                  text += delta.content;
                  if (params.onStreamChunk !== undefined) {
                    await params.onStreamChunk(delta.content, undefined, text);
                  }
                }
                if (Array.isArray(delta.tool_calls)) {
                  for (const pieceRaw of delta.tool_calls) {
                    const piece = asRecord(pieceRaw);
                    const index = typeof piece.index === "number" ? piece.index : 0;
                    const entry = callAcc[index] ?? { id: "", name: "", arguments: "" };
                    callAcc[index] = entry;
                    if (typeof piece.id === "string" && piece.id !== "") entry.id = piece.id;
                    const fn = asRecord(piece.function);
                    if (typeof fn.name === "string") entry.name += fn.name;
                    if (typeof fn.arguments === "string") entry.arguments += fn.arguments;
                  }
                }
              }
            };

            res.setEncoding("utf8");
            res.on("data", (chunk: string) => {
              pending += chunk;
              queue = queue.then(() => drain());
            });
            res.on("end", () => {
              void queue.then(() => {
                if (callAcc.length > 0) {
                  const calls: LocalToolCall[] = callAcc.map((c) => ({
                    id: c.id === "" ? `call_local_${randomUUID()}` : c.id,
                    name: c.name,
                    arguments: parseJsonRecord(c.arguments) ?? c.arguments,
                  }));
                  resolve({ text: text.trim(), toolCalls: calls, finishReason: "tool_calls", ...(usage === undefined ? {} : { usage }) });
                  return;
                }
                const parsed = parseLocalModelOutput(text, allowedToolNames, usage);
                resolve({ ...parsed, finishReason: parsed.toolCalls.length > 0 ? "tool_calls" : finishReason });
              }, reject);
            });
            return;
          }

          let body = "";
          res.setEncoding("utf8").on("data", (chunk: string) => { body += chunk; }).on("end", () => {
            try {
              const decoded = asRecord(JSON.parse(body) as unknown);
              const choices = Array.isArray(decoded.choices) ? decoded.choices : [];
              const first = asRecord(choices[0]);
              const message = asRecord(first.message);
              const rawContent = typeof message.content === "string" ? message.content : "";
              const usage = parseUsageRecord(decoded.usage);
              const wireCalls = parseWireToolCalls(message.tool_calls);
              if (wireCalls.length > 0) {
                resolve({
                  text: rawContent,
                  toolCalls: wireCalls,
                  finishReason: typeof first.finish_reason === "string" ? first.finish_reason : "tool_calls",
                  ...(usage === undefined ? {} : { usage }),
                });
                return;
              }
              resolve(parseLocalModelOutput(rawContent, allowedToolNames, usage));
            } catch (err) {
              reject(err instanceof Error ? err : new Error(String(err)));
            }
          });
        },
      );
      req.once("error", reject).end(payload);
    });
  }

  private udsExchange(frame: Record<string, unknown>): Promise<Record<string, unknown>> {
    const socket = this.socketPath;
    if (socket === undefined) return Promise.reject(new Error("No local LLM socket"));
    return new Promise((resolve, reject) => {
      const conn = net.createConnection(socket);
      let buf = "";
      let done = false;
      conn.setEncoding("utf8");
      conn.on("connect", () => conn.write(`${JSON.stringify(frame)}\n`));
      conn.on("data", (chunk: string) => {
        buf += chunk;
        const idx = buf.indexOf("\n");
        if (idx >= 0 && !done) {
          done = true;
          conn.end();
          try {
            resolve(asRecord(JSON.parse(buf.slice(0, idx)) as unknown));
          } catch (err) {
            reject(err instanceof Error ? err : new Error(String(err)));
          }
        }
      });
      conn.on("error", (err) => {
        if (!done) {
          done = true;
          reject(err);
        }
      });
      conn.on("close", () => {
        if (!done) {
          done = true;
          reject(new Error("Local LLM socket closed before answering"));
        }
      });
    });
  }

  private loadPersistedState(): void {
    if (this.stateFile === undefined || !fs.existsSync(this.stateFile)) return;
    try {
      const parsed = asRecord(JSON.parse(fs.readFileSync(this.stateFile, "utf8")) as unknown);
      if (isLocalAiMode(parsed.mode)) this.currentMode = parsed.mode;
      const savedModel = readString(parsed, "activeModelId");
      if (catalogEntryById(savedModel) !== undefined && savedModel !== undefined) {
        this.currentModelId = savedModel;
      }
      if (parsed.activeStatus === "idle" || parsed.activeStatus === "ready" || parsed.activeStatus === "failed") {
        this.currentStatus = parsed.activeStatus;
      }
    } catch {
      return;
    }
  }

  private persistState(): void {
    if (this.stateFile === undefined) return;
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true, mode: 0o700 });
      const temp = `${this.stateFile}.tmp`;
      fs.writeFileSync(
        temp,
        `${JSON.stringify({ mode: this.currentMode, activeModelId: this.currentModelId, activeStatus: this.currentStatus }, null, 2)}\n`,
        { mode: 0o600 },
      );
      fs.renameSync(temp, this.stateFile);
    } catch {
      return;
    }
  }
}

/** Registers local {@code TEXT_SMALL} and {@code TEXT_LARGE} handlers when Local AI mode is active. */
export function registerLocalLlmModels(runtime: unknown, controller: AlphaLocalLlmController): boolean {
  if (!controller.shouldServeLocalText()) return false;
  const target = runtime as RegisterableRuntime | undefined;
  if (typeof target?.registerModel !== "function") return false;
  const handler = (_agent: unknown, params: unknown) => controller.generate(params);
  const metadata = { local: true, streamable: true, displayModel: controller.activeModelId() };
  target.registerModel("TEXT_SMALL", handler, "alpha-local-llm", 100, metadata);
  target.registerModel("TEXT_LARGE", handler, "alpha-local-llm", 100, metadata);
  return true;
}

/** Page HTTP routes served by the resident agent for on-device Local LLM management. */
export function localLlmRoutes(controller: AlphaLocalLlmController): readonly AgentRoute[] {
  const requireCatalogModelId = (body: unknown): { readonly ok: true; readonly modelId: string } | { readonly ok: false; readonly response: { readonly status: number; readonly body: { readonly error: string } } } => {
    const modelId = readString(asRecord(body), "modelId");
    if (modelId === undefined) return { ok: false, response: { status: 400, body: { error: "MODEL_ID_REQUIRED" } } };
    if (catalogEntryById(modelId) === undefined) return { ok: false, response: { status: 404, body: { error: "UNKNOWN_MODEL" } } };
    return { ok: true, modelId };
  };
  return [
    {
      method: "GET",
      path: "/api/alpha/local-llm/status",
      handler: async () => ({ status: 200, body: await controller.status() }),
    },
    {
      method: "GET",
      path: "/api/alpha/local-llm/catalog",
      handler: () => ({
        status: 200,
        body: {
          defaultModelId: LOCAL_LLM_DEFAULT_MODEL_ID,
          models: LOCAL_LLM_CATALOG,
        },
      }),
    },
    {
      method: "POST",
      path: "/api/alpha/local-llm/mode",
      maxBodyBytes: 1024,
      handler: ({ body }) => {
        const input = asRecord(body);
        const mode = input.mode;
        if (!isLocalAiMode(mode)) {
          return { status: 400, body: { error: "INVALID_MODE" } };
        }
        const modelId = readString(input, "modelId");
        if (modelId !== undefined && catalogEntryById(modelId) === undefined) {
          return { status: 404, body: { error: "UNKNOWN_MODEL" } };
        }
        const status = controller.setMode(mode, modelId);
        return { status: 200, body: { ok: true, mode: status.mode, activeModelId: status.activeModelId, status } };
      },
    },
    {
      method: "POST",
      path: "/api/alpha/local-llm/activate",
      maxBodyBytes: 1024,
      handler: async ({ body }) => {
        const checked = requireCatalogModelId(body);
        if (!checked.ok) return checked.response;
        try {
          const result = await controller.activate(checked.modelId);
          return { status: result.ok ? 200 : 503, body: result };
        } catch (err) {
          return { status: 503, body: { ok: false, error: err instanceof Error ? err.message : "ACTIVATE_FAILED" } };
        }
      },
    },
    {
      method: "POST",
      path: "/api/alpha/local-llm/delete",
      maxBodyBytes: 1024,
      handler: async ({ body }) => {
        const checked = requireCatalogModelId(body);
        if (!checked.ok) return checked.response;
        const result = await controller.deleteModel(checked.modelId);
        return { status: 200, body: result };
      },
    },
  ];
}
