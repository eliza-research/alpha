import { spawn } from 'node:child_process';
import type { SpawnOptions } from 'node:child_process';

const forwardedSignals = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const;

interface ChildExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export async function runChild(command: string, args: string[], options: SpawnOptions): Promise<ChildExit> {
  const child = spawn(command, args, options);
  const forward = (signal: NodeJS.Signals) => {
    if (!child.killed) child.kill(signal);
  };

  for (const signal of forwardedSignals) process.on(signal, forward);
  try {
    return await new Promise<ChildExit>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
  } finally {
    for (const signal of forwardedSignals) process.off(signal, forward);
  }
}

export function exitFromChild({ code, signal }: ChildExit): void {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
}
