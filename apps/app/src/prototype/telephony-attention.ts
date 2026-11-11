/**
 * Home's Messages and Phone cards on the verified Alpha image (specs/quint/native/TelephonyAttention.qnt).
 * A card exists only while its source was read and has something new: unread threads, or new missed
 * calls and voicemail. Rows are read through the shared telephony profile's bounded, unlocked,
 * foreground-only reads while Home is in front, kept in memory only, and dropped when Home is left
 * or hidden. A card is one target that opens the view; nothing here calls, sends, plays or marks read.
 */
import {registerPlugin} from '../platform-plugins';
import {aospImage} from '../runtime/aosp-image';
import {createAospTelephony, type AlphaTelephonyPlugin, type AospTelephony} from '../runtime/aosp-telephony';
import {isIncompleteSmsRow} from '../../../../.eliza/client-features/packages/contracts/src/native-telephony.ts';
import {watchReturnToApp} from './native-adapter';
import {isMvpView} from './mvp-features';
import {emptyTelephonyAttention, numberKey, presentTelephonyAttention, type TelephonyAttention} from './telephony-presenters';
export {emptyTelephonyAttention, presentTelephonyAttention, type TelephonyAttention};

type Bag = Record<string, any>;
const REFRESH_MS = 30_000;

/** One bounded read of every source the owner has granted. A refused or failed source stays null. */
export async function readTelephonyAttention(client: AospTelephony, isCurrent:()=>boolean=()=>true): Promise<TelephonyAttention> {
  const read = emptyTelephonyAttention(), status = await client.status();
  if(!isCurrent())throw new DOMException('Read retired','AbortError');
  const attempt = async <T,>(run: () => Promise<T>): Promise<T | null> => { try { return await run(); } catch { return null; } };
  const [threads, calls, voicemail, contacts] = await Promise.all([
    status.permissions.sms === 'granted' ? attempt(() => client.listThreads(20)) : null,
    status.permissions.callLog === 'granted' ? attempt(() => client.recentCalls(50)) : null,
    attempt(async () => { const page = await (client as Bag).listVoicemail?.(20); return page && page.state === 'ready' ? page.voicemails as NonNullable<TelephonyAttention['voicemail']> : null; }),
    status.permissions.contacts === 'granted' ? attempt(() => client.searchContacts('', 100)) : null,
  ]);
  read.threads = threads ? threads.filter(row => !isIncompleteSmsRow(row)) as NonNullable<TelephonyAttention['threads']> : null;
  read.calls = calls; read.voicemail = voicemail;
  for (const card of contacts || []) for (const number of card.phoneNumbers) {
    const key = numberKey(number);
    if (key && card.displayName && !read.names.has(key)) read.names.set(key, card.displayName);
  }
  return read;
}

export function installTelephonyAttention(Component: any, client: AospTelephony | null = aospImage ? createAospTelephony(registerPlugin<AlphaTelephonyPlugin>('AlphaTelephony'), true) : null) {
  if (!client) return;
  const p = Component.prototype, render = p.renderVals, mount = p.componentDidMount, update = p.componentDidUpdate, unmount = p.componentWillUnmount;
  let owner: any, active = false, epoch = 0, read = emptyTelephonyAttention(), timer: ReturnType<typeof setInterval> | undefined;
  const changed = () => owner?.setState({telephonyAttentionRevision: Date.now()});
  const available = () => !!owner && (owner.S().view || 'home') === 'home' && !document.hidden;
  async function refresh() {
    const token = ++epoch;
    if (!available()) return;
    try { const next = await readTelephonyAttention(client!,()=>token===epoch&&available()); if (token === epoch && available()) { read = next; changed(); } }
    catch { if (token === epoch) { read = emptyTelephonyAttention(); changed(); } }
  }
  const sync = () => {
    const next = available();
    if (next === active) return;
    active = next; clearInterval(timer); timer = undefined;
    if (next) { void refresh(); timer = setInterval(() => void refresh(), REFRESH_MS); }
    else { epoch++; read = emptyTelephonyAttention(); changed(); }
  };
  p.renderVals = function () {
    const out = render.call(this), self = this;
    if (!active) return out;
    const cards = presentTelephonyAttention(read, Date.now());
    return {...out,
      homeMessagesAttention: isMvpView('messages') ? cards.messages : null,
      homePhoneAttention: isMvpView('phone') ? cards.phone : null,
      goMessagesAttention: () => self.openView('messages', cards.messagesThread ? {openThread: cards.messagesThread} : null),
      goPhoneAttention: () => self.openView('phone', {tab: cards.phoneTab})};
  };
  p.componentDidMount = function () {
    mount?.call(this); owner = this;
    this.telephonyAttentionReturn = watchReturnToApp(() => { if (active) void refresh(); });
    this.telephonyAttentionHide = () => sync();
    document.addEventListener('visibilitychange', this.telephonyAttentionHide);
    sync();
  };
  p.componentDidUpdate = function (...args: any[]) { update?.apply(this, args); sync(); };
  p.componentWillUnmount = function () {
    this.telephonyAttentionReturn?.(); document.removeEventListener('visibilitychange', this.telephonyAttentionHide);
    if (owner === this) { owner = null; active = false; epoch++; clearInterval(timer); timer = undefined; read = emptyTelephonyAttention(); }
    unmount?.call(this);
  };
}
