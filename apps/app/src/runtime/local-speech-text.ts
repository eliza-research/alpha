const credentialLike = /`|-----BEGIN|\b(?:csk-|sk[-_]|gh[pousr]_|xox[baprs]-|AKIA|ASIA)[A-Za-z0-9_-]{8,}|\b(?:password|passphrase|api[_ -]?key|access[_ -]?token|secret|recovery[_ -]?(?:code|phrase)|seed phrase)\s*(?::|=|is\b)|\b[A-Za-z0-9_-]{32,}\b|(?:\d[ -]?){12,19}/i;
const unsupportedSpeech = /[^A-Za-z0-9\s'.,!?;:()]/;

/** The refusal every read-aloud route applies before any audio request: a bounded
 * passage with no link, email address, code, credential or card number. */
export function screenSpeechText(input: string): void {
  if (typeof input !== 'string' || !input.trim() || input.length > 16000) throw new Error('Listening supports a message up to 16,000 characters. Copy a shorter passage into a note to listen.');
  if (/(?:https?:\/\/|www\.|mailto:)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(input)) throw new Error("This message has a link or email address, so it can't be read aloud.");
  if (credentialLike.test(input)) throw new Error("This message may contain a password or code, so it can't be read aloud.");
}

/** The one refusal a spoken conversation reply keeps: a likely password, key or card number.
 * Screen the whole reply, since sentence splitting can separate 'password is:' from the value. */
export function screenConversationSpeech(input: string): void {
  if (credentialLike.test(input)) throw Object.assign(new Error("This reply may contain a password or code, so it wasn't read aloud."), { code: 'speech-refused' });
}

const currency: Record<string, string> = { $: 'dollar', '£': 'pound', '€': 'euro' };
/** Times, money and ranges as a person reads them; digits never come out as 'colon' or 'dash'. */
function speakNumbers(text: string): string {
  return text
    .replace(/(\d),(?=\d{3}(?!\d))/g, '$1')
    .replace(/([$£€])\s?(\d+)(?:\.(\d{1,2}))?(?!\d|\.\d)/g, (_, sign: string, whole: string, cents?: string) => `${whole} ${currency[sign]}${whole === '1' ? '' : 's'}${cents && Number(cents) ? ` ${cents.padEnd(2, '0')}` : ''}`)
    // A range of short numbers or clock times; part of a longer run (phone, ISO date) is not a range.
    .replace(/(?<![\d:-])(\d{1,2}(?::\d{2})?)-(\d{1,2}(?::\d{2})?)(?![\d:-])/g, '$1 to $2')
    // Phone numbers and dates keep their groups as pauses; a plain space would let a date and
    // time run together into a card-length string of digits.
    .replace(/(\d)-(?=\d)/g, '$1, ')
    .replace(/\b(\d{1,2}):(\d{2})\b(\s*[AaPp]\.?[Mm]\b)?/g, (_, hour: string, minute: string, meridiem = '') => `${hour}${minute === '00' ? (meridiem ? '' : " o'clock") : minute[0] === '0' ? ` oh ${minute[1]}` : ` ${minute}`}${meridiem}`);
}

/** Plan an entire local read before any native audio request. 'listen' (explicit Listen
 * and Read) refuses links, credentials and unsupported characters. 'conversation' (spoken
 * replies) refuses only credential-like text, with code 'speech-refused', and folds
 * everything else it can't say; a reply with nothing left to say plans no chunks. */
export function planLocalSpeech(input: string, options: { mode?: 'listen' | 'conversation' } = {}): string[] {
  const conversation = options.mode === 'conversation';
  if (conversation) {
    if (typeof input !== 'string') return [];
    screenConversationSpeech(input);
  } else screenSpeechText(input);
  let text = conversation
    ? input.normalize('NFD').replace(/\p{M}+/gu, '').replace(/([A-Za-z])\/(?=[A-Za-z])/g, '$1 ').replace(/\b(?:https?:\/\/|mailto:)|\bwww\./gi, '')
    : input;
  text = speakNumbers(text.normalize('NFC')
    .replace(/[‘’]/g, "'").replace(/[“”"]/g, '').replace(/…/g, '...')
    .replace(/[—–]/g, '; ').replace(/−/g, '-')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    // A former bullet stays its own sentence once line breaks collapse.
    .replace(/^[ \t]*[-*+][ \t]+([A-Za-z0-9*_'"].*?)[ \t]*$/gm, (_, item: string) => /[.!?;:,]$/.test(item) ? item : `${item}.`)
    .replace(/^[ \t]*>[ \t]?/gm, ''))
    .replace(/(\*\*|__)([^\n]+?)\1/g, '$2')
    .replace(/(^|[\s(])([*_])([^\n]+?)\2(?=$|[\s).,!?;:])/g, '$1$3')
    .replace(/(^|[^A-Za-z0-9])\-\s*(?=\d)/g, '$1minus ')
    .replace(/([A-Za-z])-([A-Za-z])/g, '$1 $2')
    .replace(/-/g, ' dash ')
    .replace(/(\d)\.(?=\d)/g, '$1 point ')
    .replace(/(\d):(?=\d)/g, '$1 colon ')
    .replace(/(\d)\/(?=\d)/g, '$1 slash ')
    .replace(/&/g, ' and ').replace(/%/g, ' percent ').replace(/\+/g, ' plus ').replace(/=/g, ' equals ')
    .replace(/\$/g, ' dollars ').replace(/£/g, ' pounds ').replace(/€/g, ' euros ')
    .replace(/\.{2,}/g, '.').replace(/\s+/g, ' ').trim();
  if (conversation) {
    // Anything still unsayable (another script, a symbol) becomes a pause, never a refusal.
    text = text.replace(new RegExp(unsupportedSpeech.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
    if (!/[A-Za-z0-9]/.test(text)) return [];
    // Native playback re-plans each chunk as a Listen; folding must not have made a new match.
    screenConversationSpeech(text);
  } else if (!/[A-Za-z0-9]/.test(text) || unsupportedSpeech.test(text)) throw new Error("This message has characters that can't be read aloud.");
  const chunks: string[] = [];
  // Keep the first audio response sentence-sized instead of waiting for an
  // entire multi-sentence passage. Preflight above still covers every character.
  // The 300-character cap also bounds native spelling expansion.
  while (text) {
    let boundary = -1;
    for (const match of text.slice(0, 301).matchAll(/[.!?;]\s/g)) {
      // Avoid tiny fragments such as titles and initials.
      if (match.index! >= 20) { boundary = match.index! + 1; break; }
    }
    if (boundary < 0) boundary = text.length <= 300 ? text.length : text.lastIndexOf(' ', 300);
    if (boundary < 1) {
      if (!conversation) throw new Error('A word is too long for local listening. Edit a copy in Notes; nothing has been read.');
      boundary = 300;
    }
    const chunk = text.slice(0, boundary).trim();
    text = text.slice(boundary).trim();
    if (!/[A-Za-z0-9]/.test(chunk)) { if (conversation) continue; throw new Error('Unsupported punctuation-only passage. Nothing has been read.'); }
    chunks.push(chunk);
  }
  return chunks;
}
