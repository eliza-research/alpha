/**
 * What a failure may say in a toast.
 *
 * A caught value is whatever a lower layer threw: a platform exception ("Cannot read properties of
 * undefined"), a bridge refusal, or a sentence this app wrote for the owner. Only the last kind is
 * shown. Anything else, and any sentence that carries implementation vocabulary or code, is
 * replaced by the caller's plain fallback.
 *
 * Use with the toast's failure kind so it is announced assertively:
 *   api.toast(errorNotice(error, 'Couldn’t share. Try again.'), ERROR_TOAST);
 */
export const ERROR_TOAST = Object.freeze({kind: 'error' as const});

const LIMIT = 200;
// Words that describe how the app works, not what happened.
const INTERNAL = /\b(receipts?|reconcil\w*|admission|admitted|revisions?|resident|canonical|epoch|nonce|digest|payload|schema|runtime|undefined|null|NaN|JSON|HTTP|errno|stack|exception)\b/i;
// Code, markup, addresses and identifiers.
const CODE = /[{}<>[\]`\\|=]|\w\(|\b\w+_\w+\b|https?:\/\/|\b0x[0-9a-f]+\b|\b[0-9a-f]{16,}\b/i;

function candidate(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  // TypeError, RangeError, DOMException and the like are the platform speaking, never the app.
  const name = 'name' in value && typeof value.name === 'string' ? value.name : '';
  if (name && name !== 'Error') return '';
  return 'message' in value && typeof value.message === 'string' ? value.message : '';
}

/** The sentence to show for `error`: its own message when that is plain owner copy, else `fallback`. */
export function errorNotice(error: unknown, fallback: string): string {
  const text = candidate(error).trim();
  if (!text || text.length > LIMIT || /[\r\n]/.test(text) || INTERNAL.test(text) || CODE.test(text)) return fallback;
  return text;
}
