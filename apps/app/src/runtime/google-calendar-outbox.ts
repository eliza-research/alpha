import { anyAbortSignal } from './abort-signal.ts';
import { browserDeletionClock, claimDeletion, deletionDeadline, deletionWindow, type DeletionClock, type DeletionDeadline, type PendingDeletion } from './deletion-window.ts';
import type { GoogleCalendarEvent, GoogleCalendarRange } from './cloud-protocol.ts';
import { googleCalendarRevision, type GoogleCalendarRead, type GoogleCalendarRecord, type GoogleCalendarResponse } from './google-calendar.ts';
import { GOOGLE_CALENDAR_WRITE_CAPABILITIES, planGoogleCalendarWrite, sendGoogleCalendarWrite, type GoogleCalendarRsvp, type GoogleCalendarScope, type GoogleCalendarWriteCapabilities, type GoogleCalendarWriteClient, type GoogleCalendarWriteFields, type GoogleCalendarWriteOperation, type GoogleCalendarWriteResult } from './google-calendar-writer.ts';

/**
 * Local outbox for Google Calendar changes made in the Calendar view, one durable document per
 * Cloud account. Changes show at once (overlay), are sent one at a time while online, and a delete
 * waits out the Undo window (DELETE_UNDO_MS) before anything is sent.
 *
 * API used by the Calendar view adapter:
 * - `openGoogleCalendarOutbox(owner, deps)`: the shared outbox for one Cloud account.
 * - `enqueue(change)`: create / update / delete (scope this|following|all) / rsvp (yes|no|maybe).
 *   Answers `{status:'queued', id, undoUntil?}` or why nothing was queued.
 * - `undo(id)`: cancels a change that has not been sent (a delete only inside its Undo window).
 * - `resolvePaused(id, 'send'|'keep')`: a delete whose Undo window could not be timed after a restart.
 * - `resolveConflict(id, 'mine'|'google')`: Google's copy changed first ("Keep mine" / "Keep Google's").
 * - `resolveUncertain(id, 'send'|'drop')`: a create whose answer was lost and no match was found.
 * - `dismiss(id)`: removes a failed change.
 * - `flush()`, `attach()`: sending triggers (online, visible again, end of an Undo window, a retry
 *   falling due). The detach `attach()` returns stops a running send when the last view leaves.
 * - `overlay(rows)` / `overlayGoogleCalendarRows(rows, ops)`: rows as the owner should see them.
 * - `subscribe(listener)`: called with the operations after every change.
 * No linked-sync state is read or written here.
 */
export type GoogleCalendarOutboxPhase = 'queued' | 'paused' | 'dispatching' | 'uncertain' | 'conflict' | 'failed' | 'done';
export type GoogleCalendarOutboxKind = 'create' | 'update' | 'delete' | 'rsvp';
/** The event as the owner last saw it; a change is sent only while Google still has this revision. */
export interface GoogleCalendarOutboxBase { revision: string; begin: number; end: number }
export type GoogleCalendarOutboxError = Exclude<GoogleCalendarWriteResult, { status: 'done' }>;
export interface GoogleCalendarOutboxOp {
  id: string; kind: GoogleCalendarOutboxKind;
  sourceId: string; connectionId: string; calendarId: string;
  /** The occurrence the owner changed (a series change uses `recurringEventId`). Absent for a create
   * and for a change to a create that has not been sent (`localId`). */
  eventId?: string; recurringEventId?: string | null;
  scope: GoogleCalendarScope; allDay?: boolean;
  fields: GoogleCalendarWriteFields; response?: GoogleCalendarRsvp;
  base: GoogleCalendarOutboxBase | null;
  /** Local row id of a create (`<sourceId>:local:<localId>`), and of changes made to it before it was sent. */
  localId?: string;
  phase: GoogleCalendarOutboxPhase;
  deadline?: DeletionDeadline;
  attempts: number; error?: GoogleCalendarOutboxError;
  createdAt: number; updatedAt: number;
  /** Google's version after a change went through, or after a conflict was found (null: gone). */
  result?: { eventId: string; revision: string; begin: number; end: number };
  remote?: GoogleCalendarOutboxBase | null;
  holder?: string;
  /** Wall time before which a change that failed for a passing reason (429, 5xx, network) is not sent again. */
  retryAt?: number;
}
/** A row a change applies to: a Google row, or a local create row from the overlay. */
export type GoogleCalendarOutboxTarget = Pick<GoogleCalendarRecord, 'calendarId' | 'connectionId' | 'providerCalendarId' | 'providerEventId' | 'recurringEventId' | 'revision' | 'begin' | 'end'> & { allDay?: boolean; localId?: string };
export type GoogleCalendarChange =
  | { kind: 'create'; sourceId: string; connectionId: string; calendarId: string; fields: GoogleCalendarWriteFields & { title: string; startAt: string; endAt: string; timeZone: string }; allDay?: boolean }
  | { kind: 'update'; row: GoogleCalendarOutboxTarget; scope: GoogleCalendarScope; fields: GoogleCalendarWriteFields }
  | { kind: 'delete'; row: GoogleCalendarOutboxTarget; scope: GoogleCalendarScope }
  | { kind: 'rsvp'; row: GoogleCalendarOutboxTarget; response: GoogleCalendarRsvp };
export type GoogleCalendarEnqueueResult =
  | { status: 'queued'; id: string; localId?: string; /** Wall time the Undo window of a delete closes. */ undoUntil?: number }
  | { status: 'cancelled' }
  | { status: 'unsupported'; reason: Extract<GoogleCalendarWriteResult, { status: 'unsupported' }>['reason'] }
  | { status: 'invalid' }
  | { status: 'busy' }
  | { status: 'full' };
export type GoogleCalendarOverlayRow = GoogleCalendarRecord & {
  /** Waiting to sync (the dot). */
  pending: boolean;
  outboxId?: string; outboxPhase?: GoogleCalendarOutboxPhase; localId?: string;
};
/** Durable storage: the whole document is exchanged only if it still equals `before`. */
export interface GoogleCalendarOutboxStore { read(): Promise<unknown>; exchange(before: unknown, value: unknown): Promise<'saved' | 'conflict'> }
export interface GoogleCalendarOutboxDeps {
  /** Identity of the Cloud account the document belongs to. */
  owner: string;
  store: GoogleCalendarOutboxStore;
  client: GoogleCalendarWriteClient;
  /** Reads one calendar (GoogleCalendarReader.readMany for that source) to check a change is still current. */
  read: (sourceId: string, range: GoogleCalendarRange, signal: AbortSignal) => Promise<GoogleCalendarRead>;
  clock?: () => DeletionClock; now?: () => number; online?: () => boolean;
  capabilities?: GoogleCalendarWriteCapabilities; id?: () => string;
}

export const GOOGLE_CALENDAR_OUTBOX_LIMIT = 200;
const MAX_BYTES = 240 * 1024, DAY = 86_400_000, DONE_KEEP_MS = 10 * 60_000, DISPATCH_STALE_MS = 2 * 60_000;
/** Wait before sending again after a passing failure: 5 s, doubling per attempt, at most 5 min. */
const RETRY_BASE_MS = 5_000, RETRY_MAX_MS = 5 * 60_000;
export const googleCalendarRetryDelay = (attempts: number) => Math.min(RETRY_BASE_MS * 2 ** Math.max(0, Math.min(attempts, 20) - 1), RETRY_MAX_MS);
const PHASES: readonly string[] = ['queued', 'paused', 'dispatching', 'uncertain', 'conflict', 'failed', 'done'];
const KINDS: readonly string[] = ['create', 'update', 'delete', 'rsvp'];
const REPLY: Record<GoogleCalendarRsvp, GoogleCalendarResponse> = { yes: 'accepted', no: 'declined', maybe: 'tentative' };
const open = (op: GoogleCalendarOutboxOp) => op.phase !== 'done';
/** Two operations change the same event (or the same unsent create). */
const sameEvent = (a: GoogleCalendarOutboxOp, b: { sourceId: string; eventId?: string; localId?: string }) =>
  a.sourceId === b.sourceId && (a.localId !== undefined && a.localId === b.localId || a.eventId !== undefined && a.eventId === b.eventId);
type Document = { version: 1; owner: string; ops: GoogleCalendarOutboxOp[] };

function validOp(value: unknown): value is GoogleCalendarOutboxOp {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const op = value as Record<string, unknown>;
  return typeof op.id === 'string' && KINDS.includes(op.kind as string) && PHASES.includes(op.phase as string)
    && typeof op.sourceId === 'string' && typeof op.connectionId === 'string' && typeof op.calendarId === 'string'
    && ['this', 'following', 'all'].includes(op.scope as string) && !!op.fields && typeof op.fields === 'object'
    && Number.isFinite(op.attempts) && Number.isFinite(op.createdAt) && Number.isFinite(op.updatedAt)
    && (op.base === null || !!op.base && typeof (op.base as GoogleCalendarOutboxBase).revision === 'string');
}

export class GoogleCalendarOutbox {
  private ops: GoogleCalendarOutboxOp[] = [];
  private readonly listeners = new Set<(ops: readonly GoogleCalendarOutboxOp[]) => void>();
  private sending: Promise<void> | null = null;
  private loaded: Promise<readonly GoogleCalendarOutboxOp[]> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attached = 0;
  /** Aborted when the last view detaches (the Cloud account switched): a running send stops. */
  private lifetime: AbortController | null = null;
  private sendingSignal: AbortSignal | null = null;
  private readonly holder: string;
  constructor(private readonly deps: GoogleCalendarOutboxDeps) { this.holder = this.newId(); }

  private clock() { return (this.deps.clock ?? browserDeletionClock)(); }
  private now() { return (this.deps.now ?? Date.now)(); }
  private newId() { return (this.deps.id ?? (() => crypto.randomUUID()))(); }
  private online() { return this.deps.online ? this.deps.online() : typeof navigator === 'undefined' || navigator.onLine !== false; }
  private capabilities() { return this.deps.capabilities ?? GOOGLE_CALENDAR_WRITE_CAPABILITIES; }

  /** Operations from the last load or change (synchronous, for rendering). */
  get operations(): readonly GoogleCalendarOutboxOp[] { return this.ops; }
  subscribe(listener: (ops: readonly GoogleCalendarOutboxOp[]) => void): () => void {
    this.listeners.add(listener); listener(this.ops);
    return () => { this.listeners.delete(listener); };
  }
  overlay(rows: readonly GoogleCalendarRecord[]): GoogleCalendarOverlayRow[] { return overlayGoogleCalendarRows(rows, this.ops); }

  private decode(raw: unknown): GoogleCalendarOutboxOp[] {
    if (raw == null) return [];
    const doc = raw as Document;
    if (!doc || typeof doc !== 'object' || doc.version !== 1 || doc.owner !== this.deps.owner || !Array.isArray(doc.ops)) throw new Error('Calendar changes waiting to sync could not be read.');
    return doc.ops.filter(validOp).slice(0, GOOGLE_CALENDAR_OUTBOX_LIMIT).map(op => structuredClone(op));
  }
  private publish(ops: GoogleCalendarOutboxOp[]) {
    this.ops = ops;
    for (const listener of [...this.listeners]) { try { listener(this.ops); } catch { /* A view's failure never blocks the outbox. */ } }
    this.schedule();
  }
  /** One durable transaction. `change` may run again on fresh data, so it must only edit `ops`. */
  private async edit<T>(change: (ops: GoogleCalendarOutboxOp[]) => T): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = await this.deps.store.read();
      const ops = this.decode(raw), result = change(ops), now = this.now();
      const kept = ops.filter(op => op.phase !== 'done' || now - op.updatedAt < DONE_KEEP_MS);
      const next: Document | null = kept.length ? { version: 1, owner: this.deps.owner, ops: kept } : null;
      if (next && new TextEncoder().encode(JSON.stringify(next)).length > MAX_BYTES) throw new OutboxFull();
      if (JSON.stringify(raw ?? null) === JSON.stringify(next)) { this.publish(kept); return result; }
      if (await this.deps.store.exchange(raw ?? null, next) === 'saved') { this.publish(kept); return result; }
    }
    throw new Error('Calendar changes could not be saved.');
  }

  /** Loads the document and recovers from an interrupted send: a create may have reached Google
   * (uncertain); an update or delete is checked again before it is sent. A delete whose Undo window
   * can no longer be timed waits for the owner (paused). */
  load(): Promise<readonly GoogleCalendarOutboxOp[]> {
    this.loaded ??= this.edit(ops => {
      const now = this.now(), clock = this.clock();
      this.recoverStale(ops, now);
      for (const op of ops) {
        if (op.kind === 'delete' && op.phase === 'queued' && op.deadline && deletionWindow(op.deadline, clock) === 'clock-changed') { op.phase = 'paused'; op.updatedAt = now; }
      }
      return ops;
    }).then(() => this.ops).catch(error => { this.loaded = null; throw error; });
    return this.loaded;
  }
  /** A send another holder (an earlier run of the app) left unfinished for DISPATCH_STALE_MS is
   * taken back: a create may have reached Google (uncertain); anything else is checked again. */
  private recoverStale(ops: GoogleCalendarOutboxOp[], now: number) {
    for (const op of ops) {
      if (op.phase === 'dispatching' && op.holder !== this.holder && now - op.updatedAt >= DISPATCH_STALE_MS) {
        op.phase = op.kind === 'create' ? 'uncertain' : 'queued'; op.updatedAt = now; delete op.holder;
      }
    }
  }

  /** Queues one change, merging it with unsent changes to the same event. */
  async enqueue(change: GoogleCalendarChange): Promise<GoogleCalendarEnqueueResult> {
    await this.load();
    const preflight = planFor(change, this.capabilities());
    if (preflight) return preflight;
    try {
      return await this.edit(ops => this.apply(ops, change));
    } catch (error) { if (error instanceof OutboxFull) return { status: 'full' }; throw error; }
  }
  private apply(ops: GoogleCalendarOutboxOp[], change: GoogleCalendarChange): GoogleCalendarEnqueueResult {
    const now = this.now();
    if (change.kind === 'create') {
      if (ops.filter(open).length >= GOOGLE_CALENDAR_OUTBOX_LIMIT) return { status: 'full' };
      const id = this.newId(), localId = this.newId();
      ops.push({ id, kind: 'create', sourceId: change.sourceId, connectionId: change.connectionId, calendarId: change.calendarId, scope: 'this',
        ...(change.allDay ? { allDay: true } : {}), fields: { ...change.fields }, base: null, localId, phase: 'queued', attempts: 0, createdAt: now, updatedAt: now });
      return { status: 'queued', id, localId };
    }
    const row = change.row, sourceId = row.calendarId;
    let eventId: string | undefined = row.localId ? undefined : row.providerEventId;
    let base: GoogleCalendarOutboxBase | null = row.localId ? null : { revision: row.revision, begin: row.begin, end: row.end };
    // A change to an unsent create edits or cancels that create.
    if (row.localId) {
      const create = ops.find(op => op.kind === 'create' && op.localId === row.localId);
      if (!create) return { status: 'invalid' };
      if (create.phase === 'queued' || create.phase === 'failed') {
        if (change.kind === 'delete') { for (let i = ops.length - 1; i >= 0; i--) if (ops[i].localId === row.localId) ops.splice(i, 1); return { status: 'cancelled' }; }
        if (change.kind === 'rsvp') return { status: 'invalid' };
        create.fields = { ...create.fields, ...change.fields }; create.phase = 'queued'; delete create.error; create.updatedAt = now;
        return { status: 'queued', id: create.id, localId: create.localId };
      }
      if (create.phase !== 'done' || !create.result) return { status: 'busy' };
      // Sent already: change the event Google created.
      eventId = create.result.eventId; base = { revision: create.result.revision, begin: create.result.begin, end: create.result.end };
    }
    // After the owner's own earlier change went through, the row may still show the old version: start from Google's new one.
    const finished = ops.filter(op => op.phase === 'done' && op.result && op.scope === 'this' && op.kind !== 'delete' && sameEvent(op, { sourceId, eventId }) && op.base?.revision === base?.revision).at(-1);
    const startBase = finished?.result ? { revision: finished.result.revision, begin: finished.result.begin, end: finished.result.end } : base;
    if (change.kind === 'update') {
      const earlier = ops.find(op => op.kind === 'update' && op.scope === change.scope && ['queued', 'paused', 'conflict', 'failed'].includes(op.phase) && sameEvent(op, { sourceId, eventId }));
      if (earlier) {
        earlier.fields = { ...earlier.fields, ...change.fields }; earlier.updatedAt = now;
        if (earlier.phase === 'failed' || earlier.phase === 'paused') { earlier.phase = 'queued'; delete earlier.error; }
        return { status: 'queued', id: earlier.id };
      }
    }
    if (change.kind === 'delete') {
      // A delete replaces unsent changes to the same event.
      for (let i = ops.length - 1; i >= 0; i--) {
        const op = ops[i];
        if (op.kind !== 'create' && op.kind !== 'delete' && ['queued', 'paused', 'conflict', 'failed'].includes(op.phase) && sameEvent(op, { sourceId, eventId })) ops.splice(i, 1);
      }
      const existing = ops.find(op => op.kind === 'delete' && open(op) && op.phase !== 'failed' && sameEvent(op, { sourceId, eventId }));
      if (existing) return { status: 'queued', id: existing.id, ...(existing.deadline ? { undoUntil: existing.deadline.expiresAt } : {}) };
    }
    if (ops.filter(open).length >= GOOGLE_CALENDAR_OUTBOX_LIMIT) return { status: 'full' };
    const id = this.newId();
    const op: GoogleCalendarOutboxOp = { id, kind: change.kind, sourceId: row.calendarId, connectionId: row.connectionId, calendarId: row.providerCalendarId,
      ...(eventId !== undefined ? { eventId } : {}), recurringEventId: row.recurringEventId ?? null,
      scope: change.kind === 'rsvp' ? 'this' : change.scope, ...(row.allDay ? { allDay: true } : {}),
      fields: change.kind === 'update' ? { ...change.fields } : {}, ...(change.kind === 'rsvp' ? { response: change.response } : {}),
      base: startBase, phase: 'queued', attempts: 0, createdAt: now, updatedAt: now };
    if (change.kind === 'delete') op.deadline = deletionDeadline(this.clock());
    ops.push(op);
    return { status: 'queued', id, ...(op.deadline ? { undoUntil: op.deadline.expiresAt } : {}) };
  }

  /** Cancels a change that has not been sent. A delete can be undone only inside its Undo window
   * (or while paused); once its window closed it may already be on its way. */
  async undo(id: string): Promise<boolean> {
    await this.load();
    return this.edit(ops => {
      const op = ops.find(item => item.id === id);
      if (!op) return false;
      if (op.kind === 'delete') {
        if (!op.deadline) { if (op.phase !== 'paused') return false; }
        else {
          const shim: PendingDeletion<null> = { version: 1, id: op.id, owner: this.deps.owner, target: null, deadline: op.deadline, phase: op.phase === 'paused' ? 'paused' : op.phase === 'queued' ? 'queued' : 'dispatching' };
          if (!claimDeletion(shim, this.deps.owner, this.clock(), 'undo')) return false;
        }
      } else if (!['queued', 'paused', 'conflict', 'failed'].includes(op.phase)) return false;
      ops.splice(ops.indexOf(op), 1);
      if (op.kind === 'create') for (let i = ops.length - 1; i >= 0; i--) if (ops[i].localId === op.localId && ops[i].phase !== 'done') ops.splice(i, 1);
      return true;
    });
  }
  /** After a restart the Undo window cannot be timed: the owner chooses Send or Keep. */
  async resolvePaused(id: string, choice: 'send' | 'keep'): Promise<boolean> {
    await this.load();
    const changed = await this.edit(ops => {
      const op = ops.find(item => item.id === id && item.phase === 'paused');
      if (!op) return false;
      if (choice === 'keep') { ops.splice(ops.indexOf(op), 1); return true; }
      op.phase = 'queued'; op.deadline = undefined; delete op.retryAt; op.updatedAt = this.now(); return true;
    });
    if (changed && choice === 'send') void this.flush().catch(() => {});
    return changed;
  }
  /** "Keep mine" sends the change again on Google's new version; "Keep Google's" drops it. */
  async resolveConflict(id: string, choice: 'mine' | 'google'): Promise<boolean> {
    await this.load();
    const changed = await this.edit(ops => {
      const op = ops.find(item => item.id === id && item.phase === 'conflict');
      if (!op) return false;
      if (choice === 'google' || op.remote === null) { ops.splice(ops.indexOf(op), 1); return true; }
      if (op.remote) op.base = { ...op.remote };
      op.phase = 'queued'; delete op.remote; delete op.error; delete op.retryAt; op.updatedAt = this.now();
      if (op.kind === 'delete') op.deadline = undefined;
      return true;
    });
    if (changed && choice === 'mine') void this.flush().catch(() => {});
    return changed;
  }
  /** A create whose answer was lost and that was not found in Google: send again, or drop it. */
  async resolveUncertain(id: string, choice: 'send' | 'drop'): Promise<boolean> {
    await this.load();
    const changed = await this.edit(ops => {
      const op = ops.find(item => item.id === id && item.phase === 'uncertain');
      if (!op) return false;
      if (choice === 'drop') { ops.splice(ops.indexOf(op), 1); for (let i = ops.length - 1; i >= 0; i--) if (ops[i].localId === op.localId && ops[i].phase !== 'done') ops.splice(i, 1); return true; }
      op.phase = 'queued'; delete op.error; delete op.retryAt; op.updatedAt = this.now(); return true;
    });
    if (changed && choice === 'send') void this.flush().catch(() => {});
    return changed;
  }
  /** Removes a failed change (the owner has seen why). */
  async dismiss(id: string): Promise<boolean> {
    await this.load();
    return this.edit(ops => {
      const op = ops.find(item => item.id === id && (item.phase === 'failed' || item.phase === 'done'));
      if (!op) return false;
      ops.splice(ops.indexOf(op), 1); return true;
    });
  }

  /** Milliseconds until the next Undo window closes, a retry is due, or a send another holder left
   * unfinished can be taken back; null when nothing is waiting on time. */
  nextWake(): number | null {
    const clock = this.clock(), now = this.now();
    let wait: number | null = null;
    const at = (left: number) => { wait = wait === null ? left : Math.min(wait, left); };
    for (const op of this.ops) {
      // Only future times: an op already due either sends at the next flush or waits on another change.
      if (op.phase === 'queued' && typeof op.retryAt === 'number' && op.retryAt > now) at(op.retryAt - now);
      if (op.phase === 'dispatching' && op.holder !== this.holder && op.updatedAt + DISPATCH_STALE_MS > now) at(op.updatedAt + DISPATCH_STALE_MS - now);
      if (op.kind !== 'delete' || op.phase !== 'queued' || !op.deadline || deletionWindow(op.deadline, clock) !== 'open') continue;
      at(Math.max(0, op.deadline.expiresElapsed - clock.elapsed));
    }
    return wait;
  }
  private schedule() {
    if (!this.attached || typeof setTimeout === 'undefined') return;
    if (this.timer) clearTimeout(this.timer);
    const wait = this.nextWake();
    this.timer = wait === null ? null : setTimeout(() => { this.timer = null; void this.flush().catch(() => {}); }, wait + 50);
  }
  /** Sends when the phone comes online, becomes visible again, when an Undo window ends and when a
   * retry is due. Detaching the last view stops a send in progress before its next change. */
  attach(target: Pick<Window, 'addEventListener' | 'removeEventListener'> | null = typeof window === 'undefined' ? null : window): () => void {
    const flush = () => { void this.flush().catch(() => {}); };
    const visible = () => { if (typeof document === 'undefined' || document.visibilityState !== 'hidden') flush(); };
    if (this.attached++ <= 0 || !this.lifetime) this.lifetime = new AbortController();
    let detached = false;
    target?.addEventListener('online', flush);
    target?.addEventListener('focus', visible);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visible);
    void this.load().then(() => { this.schedule(); flush(); }, () => {});
    return () => {
      if (detached) return;
      detached = true;
      target?.removeEventListener('online', flush);
      target?.removeEventListener('focus', visible);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visible);
      if (--this.attached <= 0) {
        this.attached = 0;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.lifetime?.abort(); this.lifetime = null;
      }
    };
  }

  /** Sends queued changes one at a time while online, until one must wait. While a view is
   * attached, the send also stops when the last view detaches. */
  flush(callerSignal: AbortSignal = new AbortController().signal): Promise<void> {
    // A send stopped by a detach finishes first; a later request then runs on its own.
    if (this.sending) return this.sendingSignal?.aborted && !callerSignal.aborted ? this.sending.then(() => this.flush(callerSignal)) : this.sending;
    const signal = this.lifetime ? anyAbortSignal([callerSignal, this.lifetime.signal]) : callerSignal;
    this.sendingSignal = signal;
    const run = (async () => {
      await this.load();
      if (!this.online()) return;
      await this.matchUncertain(signal);
      for (let sent = 0; sent < GOOGLE_CALENDAR_OUTBOX_LIMIT; sent++) {
        if (!this.online() || signal.aborted) return;
        if (!await this.sendOne(signal)) return;
      }
    })();
    this.sending = run.finally(() => { this.sending = null; this.sendingSignal = null; });
    return this.sending;
  }

  /** A create whose answer was lost is never sent again by itself: a feed event with the same title
   * and start means it went through; otherwise it waits for the owner. */
  private async matchUncertain(signal: AbortSignal) {
    for (const op of this.ops.filter(item => item.kind === 'create' && item.phase === 'uncertain')) {
      const begin = Date.parse(op.fields.startAt ?? ''), end = Date.parse(op.fields.endAt ?? '');
      if (!Number.isFinite(begin) || !Number.isFinite(end)) continue;
      let read: GoogleCalendarRead;
      try { read = await this.deps.read(op.sourceId, { timeMin: new Date(begin - DAY).toISOString(), timeMax: new Date(Math.max(end, begin + 1) + DAY).toISOString(), timeZone: 'UTC' }, signal); }
      catch { if (signal.aborted) return; continue; }
      if (read.status !== 'ready') continue;
      const title = (op.fields.title ?? '').trim();
      const match = read.events.find(row => row.title === title && row.begin === begin);
      if (!match) continue;
      await this.edit(ops => {
        const current = ops.find(item => item.id === op.id && item.phase === 'uncertain');
        if (!current) return;
        current.phase = 'done'; current.updatedAt = this.now();
        current.result = { eventId: match.providerEventId, revision: match.revision, begin: match.begin, end: match.end };
        rebaseAfter(ops, current);
      });
    }
  }

  /** Claims, checks and sends the first sendable change. False when nothing more can be sent now. */
  private async sendOne(signal: AbortSignal): Promise<boolean> {
    const claimed = await this.edit(ops => this.claim(ops));
    if (!claimed) return false;
    const op = claimed;
    // Check Google still has the version the owner changed.
    if (op.kind !== 'create') {
      const base = op.base!;
      let read: GoogleCalendarRead;
      try { read = await this.deps.read(op.sourceId, { timeMin: new Date(base.begin - DAY).toISOString(), timeMax: new Date(Math.max(base.end, base.begin + 1) + DAY).toISOString(), timeZone: 'UTC' }, signal); }
      catch { await this.settle(op, { status: 'retryable', applied: 'no' }, !signal.aborted); return false; }
      if (signal.aborted) { await this.settle(op, { status: 'retryable', applied: 'no' }, false); return false; }
      if (read.status === 'not-connected') { await this.settle(op, { status: 'signed-out' }); return false; }
      if (read.status === 'permission-required') { await this.settle(op, { status: 'needs-permission' }); return true; }
      if (read.status !== 'ready') { await this.settle(op, { status: 'retryable', applied: 'no' }); return false; }
      const current = read.events.find(row => row.providerEventId === op.eventId);
      if (!current) {
        // The occurrence is gone, but a whole-series delete still has a series to delete: it is sent,
        // and Google answering "gone" finishes it.
        if (op.kind === 'delete' && !(op.scope === 'all' && op.recurringEventId)) { await this.finish(op); return true; }
        if (op.kind !== 'delete') { await this.conflict(op, null); return true; }
      } else if (current.revision !== base.revision) { await this.conflict(op, { revision: current.revision, begin: current.begin, end: current.end }); return true; }
    }
    // Stopped (detached) before sending: nothing reached Google.
    if (signal.aborted) { await this.settle(op, { status: 'retryable', applied: 'no' }, false); return false; }
    let result: GoogleCalendarWriteResult;
    try { result = await sendGoogleCalendarWrite(this.deps.client, writeOperation(op), signal, this.capabilities()); }
    catch { await this.settle(op, op.kind === 'create' ? { status: 'retryable', applied: 'unknown' } : { status: 'retryable', applied: 'no' }, false); return false; }
    if (result.status === 'done') { await this.finish(op, result.event); return true; }
    if (result.status === 'gone') { if (op.kind === 'delete') await this.finish(op); else await this.conflict(op, null); return true; }
    if (result.status === 'conflict') { await this.conflict(op, undefined); return true; }
    await this.settle(op, result);
    return !['signed-out', 'retryable'].includes(result.status);
  }
  private claim(ops: GoogleCalendarOutboxOp[]): GoogleCalendarOutboxOp | null {
    const clock = this.clock(), now = this.now();
    // A send an earlier run left unfinished would otherwise hold its event until the next cold start.
    this.recoverStale(ops, now);
    // The sort is stable: changes made in the same millisecond keep the order they were queued in.
    const ordered = [...ops].sort((a, b) => a.createdAt - b.createdAt);
    for (let index = 0; index < ordered.length; index++) {
      const op = ordered[index];
      if (op.phase !== 'queued') continue;
      // Earlier unfinished changes to the same event go first; a conflict holds the event.
      const waiting = ordered.some((other, i) => i < index && other.phase !== 'done' && other.phase !== 'failed'
        && (sameEvent(other, op) || op.localId !== undefined && other.kind === 'create' && other.localId === op.localId));
      if (waiting) continue;
      if (typeof op.retryAt === 'number' && op.retryAt > now) continue;
      if (op.kind === 'delete' && op.deadline) {
        const shim: PendingDeletion<null> = { version: 1, id: op.id, owner: this.deps.owner, target: null, deadline: op.deadline, phase: 'queued' };
        const window = deletionWindow(op.deadline, clock);
        if (window === 'open') continue;
        if (window === 'clock-changed') { op.phase = 'paused'; op.updatedAt = now; continue; }
        if (!claimDeletion(shim, this.deps.owner, clock, 'dispatch')) continue;
      }
      if (op.kind !== 'create' && !op.eventId) {
        const create = ops.find(item => item.kind === 'create' && item.localId === op.localId);
        if (!create?.result) continue;
        op.eventId = create.result.eventId;
        op.base = { revision: create.result.revision, begin: create.result.begin, end: create.result.end };
      }
      op.phase = 'dispatching'; op.attempts++; op.holder = this.holder; op.updatedAt = now; delete op.retryAt;
      return structuredClone(op);
    }
    return null;
  }
  private finish(op: GoogleCalendarOutboxOp, event?: GoogleCalendarEvent) {
    return this.edit(ops => {
      const current = ops.find(item => item.id === op.id);
      if (!current) return;
      current.phase = 'done'; delete current.error; delete current.holder; current.updatedAt = this.now();
      if (event) current.result = { eventId: event.externalId, revision: googleCalendarRevision(event), begin: Date.parse(event.startAt), end: Date.parse(event.endAt) };
      rebaseAfter(ops, current);
    });
  }
  private conflict(op: GoogleCalendarOutboxOp, remote: GoogleCalendarOutboxBase | null | undefined) {
    return this.edit(ops => {
      const current = ops.find(item => item.id === op.id);
      if (!current) return;
      current.phase = 'conflict'; current.error = { status: 'conflict' }; delete current.holder; current.updatedAt = this.now();
      if (remote !== undefined) current.remote = remote; else delete current.remote;
    });
  }
  /** `backoff` false: the send was stopped here (detached), not refused, so it may go again at once. */
  private settle(op: GoogleCalendarOutboxOp, error: GoogleCalendarOutboxError, backoff = true) {
    return this.edit(ops => {
      const current = ops.find(item => item.id === op.id);
      if (!current) return;
      const now = this.now();
      delete current.holder; delete current.retryAt; current.updatedAt = now; current.error = error;
      if (error.status === 'retryable') current.phase = op.kind === 'create' && error.applied === 'unknown' ? 'uncertain' : 'queued';
      else if (error.status === 'signed-out') current.phase = 'queued';
      else current.phase = 'failed';
      if (error.status === 'retryable' && current.phase === 'queued' && backoff) current.retryAt = now + googleCalendarRetryDelay(current.attempts);
      // A delete sent back to the queue has passed its Undo window already.
      if (current.kind === 'delete' && current.phase === 'queued') current.deadline = undefined;
    });
  }
}
class OutboxFull extends Error {}

/** Later changes to an event start from the version a finished change produced, so they do not
 * conflict with the owner's own earlier change. */
function rebaseAfter(ops: GoogleCalendarOutboxOp[], done: GoogleCalendarOutboxOp) {
  const result = done.result;
  if (!result || done.kind === 'delete') return;
  for (const op of ops) {
    if (op === done || op.phase === 'done' || op.createdAt < done.createdAt) continue;
    if (done.kind === 'create' && op.localId === done.localId && op.kind !== 'create') {
      op.eventId = result.eventId; op.base = { revision: result.revision, begin: result.begin, end: result.end };
    } else if (done.scope === 'this' && done.eventId && op.sourceId === done.sourceId && op.eventId === done.eventId && op.base?.revision === done.base?.revision) {
      op.base = { revision: result.revision, begin: result.begin, end: result.end };
    }
  }
}

function writeOperation(op: GoogleCalendarOutboxOp): GoogleCalendarWriteOperation {
  const target = { connectionId: op.connectionId, calendarId: op.calendarId };
  if (op.kind === 'create') return { ...target, kind: 'create', fields: op.fields, ...(op.allDay ? { allDay: true } : {}) };
  if (op.kind === 'rsvp') return { ...target, kind: 'rsvp', eventId: op.eventId!, response: op.response! };
  if (op.kind === 'delete') return { ...target, kind: 'delete', eventId: op.eventId!, recurringEventId: op.recurringEventId ?? null, scope: op.scope };
  return { ...target, kind: 'update', eventId: op.eventId!, recurringEventId: op.recurringEventId ?? null, scope: op.scope, allDay: !!op.allDay, fields: op.fields };
}
/** Refuses before queuing what the writer could never send. */
function planFor(change: GoogleCalendarChange, capabilities: GoogleCalendarWriteCapabilities): GoogleCalendarEnqueueResult | null {
  const row = change.kind === 'create' ? null : change.row;
  const eventId = row?.localId ? 'local_check' : row?.providerEventId ?? '';
  const op: GoogleCalendarWriteOperation = change.kind === 'create'
    ? { kind: 'create', connectionId: change.connectionId, calendarId: change.calendarId, fields: change.fields, ...(change.allDay ? { allDay: true } : {}) }
    : change.kind === 'rsvp' ? { kind: 'rsvp', connectionId: row!.connectionId, calendarId: row!.providerCalendarId, eventId, response: change.response }
    : change.kind === 'delete' ? { kind: 'delete', connectionId: row!.connectionId, calendarId: row!.providerCalendarId, eventId, recurringEventId: row!.recurringEventId ?? null, scope: change.scope }
    : { kind: 'update', connectionId: row!.connectionId, calendarId: row!.providerCalendarId, eventId, recurringEventId: row!.recurringEventId ?? null, scope: change.scope, allDay: !!row!.allDay, fields: change.fields };
  const plan = planGoogleCalendarWrite(op, capabilities);
  return plan.status === 'ready' ? null : plan;
}

/** Rows as the owner should see them: queued and unsent changes applied, deletes hidden, local
 * creates added, `pending` set for the "waiting to sync" dot. A finished change keeps showing
 * until the reader's rows catch up. A failed change is not applied; its row is flagged instead. */
export function overlayGoogleCalendarRows(rows: readonly GoogleCalendarRecord[], ops: readonly GoogleCalendarOutboxOp[]): GoogleCalendarOverlayRow[] {
  let out: GoogleCalendarOverlayRow[] = rows.map(row => ({ ...row, pending: false }));
  const targets = (op: GoogleCalendarOutboxOp) => out.filter(row => row.calendarId === op.sourceId && (
    op.localId !== undefined && row.localId === op.localId
    || op.scope === 'all' && !!op.recurringEventId && row.recurringEventId === op.recurringEventId
    || op.eventId !== undefined && row.providerEventId === op.eventId));
  for (const op of [...ops].sort((a, b) => a.createdAt - b.createdAt)) {
    const pending = op.phase !== 'done' && op.phase !== 'failed', mark = { pending, outboxId: op.id, outboxPhase: op.phase };
    if (op.kind === 'create') {
      if (op.phase === 'done' && op.result && out.some(row => row.calendarId === op.sourceId && row.providerEventId === op.result!.eventId)) continue;
      const begin = Date.parse(op.fields.startAt ?? ''), end = Date.parse(op.fields.endAt ?? '');
      if (!Number.isFinite(begin) || !Number.isFinite(end)) continue;
      out.push({ id: `${op.sourceId}:local:${op.localId}`, calendarId: op.sourceId, connectionId: op.connectionId, providerCalendarId: op.calendarId,
        providerEventId: op.result?.eventId ?? '', title: (op.fields.title ?? '').trim() || 'Untitled event', body: op.fields.description ?? '', location: op.fields.location ?? '',
        begin, end, allDay: false, timeZone: op.fields.timeZone ?? 'UTC', revision: op.result?.revision ?? `local:${op.id}`, source: 'google', writable: true,
        recurringEventId: null, htmlLink: null, conferenceLink: null,
        attendees: (op.fields.attendees ?? []).map(email => ({ email, displayName: null, responseStatus: 'needsAction', self: false, organizer: false, optional: false })),
        selfResponse: null, organizerSelf: true, localId: op.localId, ...mark });
      continue;
    }
    const hit = targets(op);
    if (!hit.length) continue;
    if (op.phase === 'failed') { for (const row of hit) Object.assign(row, { outboxId: op.id, outboxPhase: op.phase }); continue; }
    // A finished change shows until the reader returns the changed event.
    if (op.phase === 'done' && hit.every(row => !row.localId && row.revision !== op.base?.revision)) continue;
    if (op.kind === 'delete') { const hidden = new Set(hit); out = out.filter(row => !hidden.has(row)); continue; }
    for (const row of hit) {
      if (op.kind === 'rsvp' && op.response) {
        const answer = REPLY[op.response];
        row.selfResponse = answer; row.attendees = row.attendees.map(guest => guest.self ? { ...guest, responseStatus: answer } : guest);
      } else {
        const f = op.fields;
        if (f.title !== undefined) row.title = f.title.trim() || row.title;
        if (f.description !== undefined) row.body = f.description;
        if (f.location !== undefined) row.location = f.location;
        if (!row.allDay && (op.scope === 'this' || row.localId)) {
          const begin = f.startAt !== undefined ? Date.parse(f.startAt) : NaN, end = f.endAt !== undefined ? Date.parse(f.endAt) : NaN;
          if (Number.isFinite(begin)) row.begin = begin;
          if (Number.isFinite(end)) row.end = end;
          if (f.timeZone !== undefined) row.timeZone = f.timeZone;
        }
      }
      Object.assign(row, mark);
    }
  }
  return out.sort((a, b) => a.begin - b.begin || a.id.localeCompare(b.id));
}

/** The Cloud account an outbox belongs to (one document each). */
export interface GoogleCalendarOutboxOwner { environment: string; userId: string; organizationId: string }
const outboxes = new Map<string, Promise<GoogleCalendarOutbox>>();
/** The shared outbox of one Cloud account: the encrypted secure store on Android, a browser
 * document otherwise. The first caller's `deps` are kept for the account. */
export function openGoogleCalendarOutbox(owner: GoogleCalendarOutboxOwner, deps: Omit<GoogleCalendarOutboxDeps, 'owner' | 'store'>): Promise<GoogleCalendarOutbox> {
  if ([owner.environment, owner.userId, owner.organizationId].some(value => typeof value !== 'string' || !value || value.length > 1024)) return Promise.reject(new Error('Calendar changes need a signed-in Cloud account.'));
  const identity = JSON.stringify([owner.environment, owner.userId, owner.organizationId]);
  let result = outboxes.get(identity);
  if (result) return result;
  result = (async () => {
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity))), v => v.toString(16).padStart(2, '0')).join(''), slot = 'google-calendar-outbox:v1:' + hash;
    const { Capacitor } = await import('@capacitor/core');
    let store: GoogleCalendarOutboxStore;
    if (Capacitor.isNativePlatform()) {
      const { secureConnectionStore } = await import('./native-connection');
      store = { read: () => secureConnectionStore.read(slot), exchange: async (before, value) => (await secureConnectionStore.compareExchange(slot, before, value)).status };
    } else {
      const { BrowserJsonDomainDocument } = await import('../browser/json-domain-document');
      const document = new BrowserJsonDomainDocument('alpha.browser.' + slot);
      store = { read: () => document.readJson(), exchange: async (before, value) => { let saved = false; await document.editJson(actual => { if (JSON.stringify(actual) !== JSON.stringify(before)) return actual; saved = true; return value; }); return saved ? 'saved' : 'conflict'; } };
    }
    return new GoogleCalendarOutbox({ ...deps, owner: identity, store });
  })();
  outboxes.set(identity, result);
  result.catch(() => outboxes.delete(identity));
  return result;
}
