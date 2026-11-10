/** Attach ownership to an exact spawned child before publishing launch metadata. */
export function superviseLauncherChild(child: any, closeLog: any, reportError: any) {
 const forwards = {SIGINT: () => child.kill('SIGINT'), SIGTERM: () => child.kill('SIGTERM')};
 const closed = new Promise((resolve: any) => child.once('close', () => {
  for (const [signal, listener] of Object.entries(forwards)) process.off(signal, listener);
  closeLog();
  resolve();
 }));
 child.on('error', (error: any) => {
  reportError(error);
  process.exitCode = 1;
 });
 for (const [signal, listener] of Object.entries(forwards)) process.on(signal, listener);
 child.once('exit', (code: any) => {process.exitCode = code ?? 1;});

 return async function retireFailedHandoff() {
  let force;
  if (child.pid) {
   child.kill('SIGTERM');
   force = setTimeout(() => child.kill('SIGKILL'), 5000);
  }
  try {await closed;} finally {clearTimeout(force);}
 };
}
