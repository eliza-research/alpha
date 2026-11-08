/**
 * Assistant replies for screen readers.
 *
 * The transcript is a plain scrolling list and focus deliberately stays on the composer after Send,
 * so a TalkBack user heard nothing when Alpha began replying, replied or failed. One visually
 * hidden polite status region, outside the conversation layer (which is inert while the chat is
 * closed), says "Alpha is replying" when a turn starts and then the settled reply once, never each
 * streamed token. The region is mounted empty before any text, because a live region that
 * arrives together with its text is not announced reliably. A voice conversation speaks its own
 * replies, so nothing is written while one is active. Focus never moves.
 */
import { workflowReplyText } from '../runtime/action-message-presentation';
type Shell = any;
const REPLYING = 'Alpha is replying';
const LIMIT = 600;

let region: HTMLElement | null = null, frame = 0;
function say(text: string) {
  if (!region || !region.isConnected) {
    region = document.createElement('div');
    region.setAttribute('role', 'status');
    region.setAttribute('aria-live', 'polite');
    region.setAttribute('aria-atomic', 'true');
    region.setAttribute('data-alpha-reply-announcer', '');
    region.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap';
    document.body.append(region);
  }
  // Cleared now and written on the next frame, so the same words said twice are announced twice.
  region.textContent = '';
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => { frame = 0; if (region) region.textContent = text; });
}
const bounded = (text: string) => text.length > LIMIT ? text.slice(0, LIMIT - 1).trimEnd() + '…' : text;
const agentTail = (msgs: Shell[]) => { const last = msgs.at(-1); return last?.from === 'agent' ? last : undefined; };

export function installReplyAnnouncer(Component: any) {
  const originalMount = Component.prototype.componentDidMount;
  Component.prototype.componentDidMount = function (...args: any[]) {
    originalMount?.apply(this, args);
    if (!region) say('');
  };
  const originalUpdate = Component.prototype.componentDidUpdate;
  Component.prototype.componentDidUpdate = function (...args: any[]) {
    originalUpdate?.apply(this, args);
    const previous: Shell = args[1] || {}, state: Shell = this.S();
    if (this.voiceConversationActive?.()) return;
    const before: Shell[] = previous.msgs || [], after: Shell[] = state.msgs || [];
    const was = agentTail(before), last = agentTail(after);
    const started = (!!state.turnStatus && !previous.turnStatus) || (!!state.typing && !previous.typing) || (!!last?.streaming && !was?.streaming);
    if (started && !this.replyAnnounced) { this.replyAnnounced = true; say(REPLYING); }
    if (!last || last.streaming || last.id === this.replyAnnouncedId) { if (!state.typing && !state.turnStatus && !last?.streaming) this.replyAnnounced = false; return; }
    // A streamed reply settling (its id may change on settlement), or one new agent row: a reply
    // delivered whole or a failed-turn notice. A history load replaces many rows and is not read.
    const known = new Set(before.map(message => message.id)), added = after.filter(message => !known.has(message.id));
    const settled = !!was?.streaming && !after.some(message => message.streaming);
    const arrived = before.length > 0 && added.length === 1 && added[0] === last;
    if (!settled && !arrived) { if (!state.typing && !state.turnStatus) this.replyAnnounced = false; return; }
    const text = workflowReplyText(String(last.text || last.card?.title || '')).text.trim();
    this.replyAnnouncedId = last.id; this.replyAnnounced = false;
    if (text) say(bounded(text));
  };
}
