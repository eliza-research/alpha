/** The refusal every read-aloud route applies before any audio request: a bounded
 * passage with no link, email address, code, credential or card number. */
export function screenSpeechText(input: string): void {
  if (typeof input !== 'string' || !input.trim() || input.length > 16000) throw new Error('Listening supports a message up to 16,000 characters. Copy a shorter passage into a note to listen.');
  if (/(?:https?:\/\/|www\.|mailto:)|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(input)) throw new Error('This message contains a link or email address. Edit a copy in Notes before listening; nothing has been read.');
  if (/`|-----BEGIN|\b(?:csk-|sk[-_]|gh[pousr]_|xox[baprs]-|AKIA|ASIA)[A-Za-z0-9_-]{8,}|\b(?:password|passphrase|api[_ -]?key|access[_ -]?token|secret|recovery[_ -]?(?:code|phrase)|seed phrase)\s*(?::|=|is\b)|\b[A-Za-z0-9_-]{32,}\b|(?:\d[ -]?){12,19}/i.test(input)) throw new Error('This message contains code or credential-like content. Edit a copy in Notes before listening; nothing has been read.');
}

/** Plan an entire explicit local read before any native audio request. */
export function planLocalSpeech(input: string): string[] {
  screenSpeechText(input);
  let text = input.normalize('NFC')
    .replace(/[‘’]/g, "'").replace(/[“”"]/g, '').replace(/…/g, '...')
    .replace(/[—–]/g, '; ').replace(/−/g, '-')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+(?=[A-Za-z*_'"])/gm, 'Item: ')
    .replace(/^\s*>\s?/gm, 'Quote: ')
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
  if (!/[A-Za-z0-9]/.test(text) || /[^A-Za-z0-9\s'.,!?;:()]/.test(text)) throw new Error('This message contains unsupported characters or formatting. Edit a copy in Notes before listening; nothing has been read.');
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
    if (boundary < 1) throw new Error('A word is too long for local listening. Edit a copy in Notes; nothing has been read.');
    const chunk = text.slice(0, boundary).trim();
    if (!/[A-Za-z0-9]/.test(chunk)) throw new Error('Unsupported punctuation-only passage. Nothing has been read.');
    chunks.push(chunk); text = text.slice(boundary).trim();
  }
  return chunks;
}
