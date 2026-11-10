import type {ChildProcess, StdioOptions} from 'node:child_process';
import {
  preparePrivateRuntimeProfile as prepareProfile,
  runtimeEnvironment as buildEnvironment,
  startPrivateRuntimeProcess as startProcess,
  writePrivateRuntimeJson as writeJson,
} from '../vendor/eliza/packages/agent/native-host/private-runtime-launch.mjs';

export interface ResidentConfig extends Record<string, unknown> {
  cloud?: {enabled?: boolean; apiKey?: string};
  serviceRouting?: {
    llmText?: {backend?: string; transport?: string; smallModel?: string; largeModel?: string};
    embeddings?: unknown;
  };
  plugins?: {entries?: Record<string, {enabled?: boolean}>};
  linkedAccounts?: Record<string, unknown>;
}

export interface ResidentLaunchOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  stdio?: StdioOptions;
  recordLaunch?: (receipt: {pid: number | undefined; launchedAt: number}) => void | Promise<void>;
}

interface ResidentExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  error: Error | null;
}

export const preparePrivateRuntimeProfile: (input: {
  tokenPath: string;
  configPath: string;
  initialConfig: ResidentConfig;
  createToken?: () => string;
}) => Promise<{token: string; config: ResidentConfig}> = prepareProfile;

export const writePrivateRuntimeJson: (file: string, value: unknown) => Promise<void> = writeJson;

// The pinned JavaScript helper accepts arbitrary environment keys to remove.
export const runtimeEnvironment = buildEnvironment as unknown as (input: {
  inherited: NodeJS.ProcessEnv;
  allow: readonly string[];
  settings: NodeJS.ProcessEnv;
  owned: NodeJS.ProcessEnv;
  remove?: readonly string[];
}) => NodeJS.ProcessEnv;

// The helper forwards Node's full stdio option to spawn and recordLaunch is optional.
export const startPrivateRuntimeProcess = startProcess as unknown as (input: ResidentLaunchOptions) => Promise<{
  child: ChildProcess;
  completion: Promise<ResidentExit>;
  stop(signal?: NodeJS.Signals): Promise<ResidentExit>;
}>;
