/** Display only. Stored messages, proposals and journal receipts are never rewritten. */
type Message = Record<string, any>;
const REVIEW_TEXT = 'Review this request on your phone before it can run.';
export function browserNavigationSummary(url: string): string {
  const destination = new URL(url);
  if (destination.protocol !== 'https:') throw Error('Expected an HTTPS destination');
  return `Opened ${destination.host}.`;
}
function browserCardUrl(description: unknown): string | undefined {
  const prefix = 'Open browser destination ';
  if (typeof description !== 'string' || !description.startsWith(prefix)) return;
  const url = description.slice(prefix.length);
  try { if (new URL(url).protocol === 'https:') return url; } catch { /* Keep unrecognized content intact. */ }
}
/** The destination of a browser proposal whose receipt succeeded with exactly the Browser summary
 * (no pending server receipt or other note), else undefined. */
export function succeededBrowserDestination(card: {description: string} | null | undefined, receipt: {status: string; summary: string}): string | undefined {
  const url = browserCardUrl(card?.description);
  if (url && receipt.status === 'succeeded' && receipt.summary === browserNavigationSummary(url)) return url;
}
function cardDestination(message: Message): string | undefined {
  if (message.from === 'agent' && message.card?.proposalId) return browserCardUrl(message.text);
}
export function projectActionMessages(rendered: Message[], source: Message[]): Message[] {
  const byId = new Map(source.map(message => [message.id, message]));
  const hidden = new Set<string>();
  const renderedIds = new Set(rendered.map(message => message.id));
  const completedResults = new Map<string, string>();
  for (const message of source) {
    if (renderedIds.has(message.id) && message.from === 'agent' && message.card?.proposalId && message.card.done && typeof message.card.sub === 'string' && message.card.sub.trim()) {
      completedResults.set(`device-receipt:${message.card.proposalId}`, message.card.sub);
    }
  }
  for (const message of source) {
    // A queued proposal may precede the request and its receipt may follow the reply. Collapse
    // only the same result already shown by that exact proposal in the current rendered history.
    if (message.from === 'agent' && message.deviceReceipt === true && !message.card && completedResults.has(message.id) && completedResults.get(message.id) === message.text) hidden.add(message.id);
  }
  let turn: Message[] = [];
  const finish = () => {
    const actions = turn.filter(message => message.from === 'agent' && (message.card?.proposalId || message.deviceReceipt));
    if (!actions.length) return;
    for (const message of turn) if (message.from === 'agent' && message.text === REVIEW_TEXT) hidden.add(message.id);
    // A shown agent reply already answers a requested Browser open. Only a succeeded browser receipt
    // carries browserDestination; failures and other device receipts stay visible.
    if (!turn.some(message => renderedIds.has(message.id) && message.from === 'agent' && !message.deviceReceipt && !message.card && !message.interrupted && message.text !== REVIEW_TEXT && typeof message.text === 'string' && message.text.trim())) return;
    for (const message of turn) if (message.from === 'agent' && message.deviceReceipt === true && !message.card && message.browserDestination) hidden.add(message.id);
  };
  for (const message of source) { if (message.from === 'user') { finish(); turn = []; } turn.push(message); } finish();
  return rendered.filter(message => !hidden.has(message.id)).map(message => {
    const stored = byId.get(message.id);
    if (!stored || stored.from !== 'agent') return message;
    const destination = cardDestination(stored);
    if (stored.card?.proposalId && stored.card.done) {
      const displayText = destination && stored.card.title === 'Completed' ? browserNavigationSummary(destination) : stored.card.sub;
      if (typeof displayText !== 'string' || !displayText.trim()) return message;
      return {...message, cGeneric:false, cDigest:false, displayText, hasCalendarText:true};
    }
    if (stored.deviceReceipt && stored.browserDestination) {
      try { return {...message, displayText:browserNavigationSummary(stored.browserDestination), hasCalendarText:true}; } catch { return message; }
    }
    if (destination && message.cDigest && message.rows?.length) {
      return {...message,hasCalendarText:false,rows:message.rows.map((row:Message,index:number)=>index===0?{...row,who:`Open ${new URL(destination).host}?`,text:'Open in Browser.'}:row)};
    }
    return message;
  });
}
