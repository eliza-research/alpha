/** Read a checked-in policy module without evaluating workspace source. */
export function parseBuildPolicy<T = unknown>(bytes: string | Buffer): T {
  const source = bytes.toString().trim();
  const prefix = 'export default ';
  if (!source.startsWith(prefix) || !source.endsWith(';')) throw Error('Invalid build policy source');
  return JSON.parse(source.slice(prefix.length, -1));
}
