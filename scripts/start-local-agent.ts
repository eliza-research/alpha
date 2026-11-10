#!/usr/bin/env node
// Start the real pinned Eliza backend using an owner-only external credential.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import {AGENT_MODEL} from './agent-model.ts';
const keyFile = process.env.ALPHA_CEREBRAS_KEY_FILE || join(homedir(), '.config/alphaphone/cerebras-key');
const stat = statSync(keyFile);
if (!stat.isFile() || (stat.mode & 0o077)) throw new Error('Cerebras credential file must be owner-only.');
const key = readFileSync(keyFile, 'utf8').trim();
if (!key) throw new Error('Cerebras credential file is empty.');
const child = spawn('bun', ['scripts/dev-agent.ts'], {
  stdio: 'inherit',
  env: { ...process.env, CEREBRAS_API_KEY: key, CEREBRAS_BASE_URL: 'https://api.cerebras.ai/v1',
    ALPHA_AGENT_BACKEND: 'eliza', ALPHA_DEV_MODEL: process.env.ALPHA_DEV_MODEL || AGENT_MODEL },
});
for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>child.kill(signal));
child.on('exit', code=>{process.exitCode=code ?? 1;});
child.on('error', ()=>{console.error('Unable to launch the local Eliza runtime.');process.exitCode=1;});
