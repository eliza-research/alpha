import type { Server } from 'node:http';

export async function startLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP listener');
  return `http://127.0.0.1:${address.port}`;
}

export function stopLoopback(server: Server): Promise<void> {
  // Bun's closeAllConnections() also stops the listener, so a following close() reports a server
  // that is no longer running; that is the state this asks for.
  const stopped = (error: unknown) => (error as NodeJS.ErrnoException | undefined)?.code === 'ERR_SERVER_NOT_RUNNING';
  return new Promise((resolve, reject) => {
    try { server.close(error => error && !stopped(error) ? reject(error) : resolve()); }
    catch (error) { if (stopped(error)) resolve(); else reject(error); }
  });
}
