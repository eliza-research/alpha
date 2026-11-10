import type {ChildProcess} from 'node:child_process';

/** Attach ownership to an exact spawned child before publishing launch metadata. */
export function superviseLauncherChild(child: ChildProcess, closeLog: () => void, reportError: (error: Error) => void) {
 const forwards = {SIGINT: () => child.kill('SIGINT'), SIGTERM: () => child.kill('SIGTERM')};
 const closed = new Promise<void>(resolve => child.once('close', () => {
  for (const [signal, listener] of Object.entries(forwards)) process.off(signal, listener);
  closeLog();
  resolve();
 }));
 child.on('error', error => {
  reportError(error);
  process.exitCode = 1;
 });
 for (const [signal, listener] of Object.entries(forwards)) process.on(signal, listener);
 child.once('exit', code => {process.exitCode = code ?? 1;});

 return async function retireFailedHandoff() {
  let force;
  if (child.pid) {
   child.kill('SIGTERM');
   force = setTimeout(() => child.kill('SIGKILL'), 5000);
  }
  try {await closed;} finally {clearTimeout(force);}
 };
}
