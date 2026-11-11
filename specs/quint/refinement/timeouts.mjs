/** Subprocess deadlines for refinement drivers. CI keeps them exact (scale 1); a heavily loaded
 * developer host can set ALPHA_TIMEOUT_SCALE (1-10) so a slow but live checker is not reported
 * as a failure. A real hang still fails at the scaled deadline. */
export function scaledTimeout(milliseconds) {
  const raw = process.env.ALPHA_TIMEOUT_SCALE;
  const scale = raw === undefined || raw === '' ? 1 : Number(raw);
  if (!Number.isFinite(scale) || scale < 1 || scale > 10) throw new Error('ALPHA_TIMEOUT_SCALE must be a number from 1 to 10');
  return Math.round(milliseconds * scale);
}
