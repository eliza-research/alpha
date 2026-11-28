// spec/app/notes/index.md, "Story: See my notes"; spec/app/notes/index.md, "The agent opens the one note the owner named, as the list last read it, once for the owner's current request, and is told whether it opened"
import { parseNoteFormat } from "@elizaos/plugin-notes-client";
import type { NotesSnapshot, StickyNote } from "@elizaos/plugin-notes-client";
import { Schema } from "effect";
import { type Faked, rejection } from "./phone.ts";
import type { Route } from "./routes.ts";

/** The recording Android's Notes recorder holds, as its `status` reports it. */
export interface Tape {
  state: "idle" | "recording" | "paused" | "stopped";
  recordingId?: string;
  binding?: { readonly ownerDigest: string; readonly folderId: string | null };
  stopReason?: string;
  /** The audio heard so far; a journey moves it on as the microphone hears. */
  durationMs: number;
  segments: { readonly segmentId: string; readonly durationMs: number }[];
}

/** The agent's notes store as the fake agent holds it; a journey changes it between steps. */
export interface NotesScene {
  notes: StickyNote[];
  revision: number;
  owner: string;
  ownerIdentity: string;
  trash: NonNullable<NotesSnapshot["trash"]>;
  creations: Map<string, string>;
  readonly audio: Map<string, { readonly noteId: string; readonly durationMs: number }>;
  /** Android's Notes recorder: the tape it holds across restarts of Alpha, and each start or command it was given, in order. */
  tape: Tape;
  readonly told: string[];
  /** Reports the tape as it is now, as Android's recorder does when it changes by itself. */
  tapeChanged: () => void;
  /** The owner presses Pause or Resume in the recording's notification, which Android carries out without Alpha. */
  notification: (action: "Pause" | "Resume", publish?: boolean) => void;
  /** Android's recorder hears `heardMs` more and closes the segment being written, as it does every 27 s while recording, also with Alpha closed. */
  rollover: (heardMs: number) => void;
  playing?: { readonly audioId: string; readonly noteId: string; readonly offsetMs: number };
  /** Whether a read of the store fails, as an agent without its notes answers. */
  failing: boolean;
  /** Whether a write to the store fails while reads still answer, as an agent that cannot change its notes answers. */
  refusing: boolean;
  deleteAtRevision?: boolean;
  refuseDiscardId?: string;
  deleteRequests?: Array<{ readonly id: string; readonly expectedRevision: number | undefined }>;
  /** The note a claim of a prepared saved-note editor names, as eliza's view host hands it to the renderer it is bound to. */
  target?: string;
  interactGate?: Promise<void>;
  /** Holds each command Android's recorder is given until it settles, as a phone that has not yet carried it out. */
  commandGate?: Promise<void>;
  statusGate?: Promise<void>;
  /** Holds each deletion sent to the store, in place of `interactGate`, until it settles. */
  discardGate?: Promise<void>;
  /** Holds each read of the store until it settles. */
  stateGate?: Promise<void>;
  viewClaimGate?: Promise<void>;
  /** Each claim and result a renderer sent eliza's views routes, in order. */
  readonly views: { readonly path: "claim" | "result"; readonly body: Record<string, unknown> }[];
}

/** What a VIEWS action that prepared a navigation for `clientId` hands back in a reply (`.eliza/packages/agent/src/views/show-action.vibe`). */
export function prepared(clientId: string, viewId: string, saved: boolean) {
  const navigationBinding = { requestId: `request-${viewId}`, clientId, viewId, viewType: "gui", installationId: "alpha" };
  return { action: "VIEWS", data: { actionName: "VIEWS", values: { mode: "show", viewId, ...(saved ? { subview: "saved-note-v1" } : {}), completedActionDelivered: false, completedActionHandoffId: navigationBinding.requestId, navigationPrepared: true, navigationBinding } } };
}

const hour = 3_600_000;
const day = 24 * hour;
const iso = (at: number) => new Date(Math.floor(at / 1000) * 1000).toISOString();

/** A note of the store, made and last changed at `at`. */
/** The recording the dev server's "Design sync" keeps, on the agent and on the fake phone alike, so it plays. */
export const developedRecording = { noteId: "sync", audioId: "sync-recording", durationMs: 408_000 } as const;

export function note(id: string, title: string, body: string, at: number, format?: StickyNote["format"]): StickyNote {
  return { id, title, body, color: "yellow", ...(format === undefined ? {} : { format }), createdAt: iso(at), updatedAt: iso(at) };
}

/** The reference phone's notes, newest first as its list shows them, with the times placed back from `now`. */
export function notesScene(now = Date.now()): NotesScene {
  const lastYear = new Date(now).getMonth() < 8 ? 1 : 0;
  const september = new Date(new Date(now).getFullYear() - lastYear, 8, 22, 18, 30).getTime();
  return {
    revision: 6,
    failing: false,
    refusing: false,
    views: [],
    owner: "agent-owner",
    ownerIdentity: "cloud-owner",
    trash: [],
    creations: new Map(),
    audio: new Map(),
    tape: { state: "idle", durationMs: 0, segments: [] },
    told: [],
    tapeChanged: () => {},
    notification: () => {},
    rollover: () => {},
    notes: [
      note("enclave", "Enclave launch", "Confirm attestation flow\nShip the keys-on-device doc\nDry run Friday", now - 20 * 60_000, { kind: "text", data: { pinned: true } }),
      note("sync", "Design sync", "", now - hour, {
        kind: "voice",
        data: {
          audio: { durationMs: 408_000 },
          lines: [
            { s: "Maya Chen", t: "Okay, lock screen first. Notifications stay as icons until you unlock.", at: 0 },
            { s: "me", t: "Agreed. Voice still works locked, but the answers stay vague.", at: 42 },
            { s: "Sam Okafor", t: "What about the chat over other apps?", at: 90 },
            { s: "Maya Chen", t: "Four heights. Pill, input, half, full. You drag between them.", at: 125 },
            { s: "me", t: "Let's cut the mark button from the recorder. Nobody used it.", at: 190 },
            { s: "Sam Okafor", t: "I'll wire the new recorder into Notes by Thursday.", at: 242 },
            { s: "Maya Chen", t: "I'll send the prototype to the team tonight.", at: 315 },
            { s: "me", t: "And I'll book a review with Jordan for next week.", at: 390 },
          ],
          summary: ["Notifications stay as icons until unlock", "Voice works while locked; answers stay vague", "Chat has four heights: pill, input, half, full", "The recorder drops the mark button"],
          actions: [{ t: "Sam · wire the recorder into Notes by Thursday", done: false }, { t: "Maya · send the prototype to the team tonight", done: true }, { t: "Book a review with Jordan next week", done: false }],
        },
      }),
      note("groceries", "Groceries", "", now - 2 * hour, {
        kind: "list",
        data: { items: [{ t: "Oat milk", done: true }, { t: "Espresso beans", done: false }, { t: "Lemons", done: false }, { t: "Sourdough from Tartine", done: false }] },
      }),
      note("agents", "The case for on-device agents", "", now - 3 * day, {
        kind: "link",
        data: {
          url: "https://news.example/on-device-agents",
          domain: "news.example",
          clips: ["Keys held on the device change what an assistant can be trusted with.", "Latency drops below the threshold where talking feels like thinking.", "The phone becomes the agent's body, not just its screen."],
        },
      }),
      note("gifts", "Gift ideas · Priya", "Film camera, ceramics class.\nShe mentioned the print show at SFMOMA.", now - 4 * day),
      note("landlord", "Radiator", "Call the landlord Friday. Bedroom radiator clanks all night.", september),
    ],
  };
}

/**
 * The retained Notes recordings as the Android host reports them. As `AlphaNoteRecorder.java` does, it refuses a Start
 * while a recording is open, until that one is discarded (line 136), and reports each change it makes to the tape before
 * answering (`publish()` at lines 146, 221, 231, 237 and 268, sent on by `AlphaNotesPlugin.java` line 84); it discards
 * only the recording it holds (`AlphaNotesPlugin.java` line 165). The notification's Pause pauses a recording that is
 * recording, and its Resume goes on with a paused one only while no call holds the phone's audio
 * (`AlphaNoteRecordingService.java` lines 82-86 and 101-104, `AlphaNotesPlugin.java` lines 67-72), each through the
 * recorder's own pause or resume, which writes the segment so far on a pause and reports the change
 * (`AlphaNoteRecorder.java` lines 221 and 229-231). The fake's phone is unlocked, has the microphone granted, holds the
 * notification for the recording it shows and has no save of it unconfirmed, so the service's other checks pass. A
 * rollover closes the segment being written only while recording and reports it (`AlphaNoteRecorder.java` lines 169-176),
 * and the recorder and its notification outlive Alpha, so what they do while Alpha is closed is reported to no one.
 */
export function alphaNotes(scene: NotesScene, calling: () => boolean): Faked {
  return (emit, onUnplug) => {
    let finish: ((result: { ok: boolean }) => void) | undefined;
    let plugged = true;
    const reading = () => scene.tape.state === "idle" ? { state: "idle" } : structuredClone(scene.tape);
    const changed = () => {
      if (plugged) emit("recordingChanged", reading());
    };
    const written = () => {
      const heard = scene.tape.durationMs - scene.tape.segments.reduce((sum, one) => sum + one.durationMs, 0);
      if (heard > 0) scene.tape.segments.push({ segmentId: `${scene.tape.recordingId}-${scene.tape.segments.length + 1}`, durationMs: heard });
    };
    const told = (recordingId: string, command: string, change: () => void) => {
      const carry = () => {
        if (recordingId !== scene.tape.recordingId || scene.tape.state === "idle") return Promise.reject(rejection("No such recording"));
        scene.told.push(command);
        const before = scene.tape.state;
        change();
        if (command === "End" || scene.tape.state !== before) changed();
        return Promise.resolve(reading());
      };
      return scene.commandGate === undefined ? carry() : scene.commandGate.then(carry);
    };
    const notified = (action: "Pause" | "Resume", publish = true) => {
      if (scene.tape.state !== (action === "Pause" ? "recording" : "paused") || action === "Resume" && calling()) return;
      if (action === "Pause") written();
      scene.tape.state = action === "Pause" ? "paused" : "recording";
      if (publish) changed();
    };
    const rolled = (heardMs: number) => {
      if (scene.tape.state !== "recording") return;
      scene.tape.durationMs += heardMs;
      written();
      changed();
    };
    scene.tapeChanged = changed;
    scene.notification = notified;
    scene.rollover = rolled;
    onUnplug?.(() => {
      plugged = false;
    });
    return {
      permission: () => Promise.resolve({ grant: "granted" }),
      requestMicrophone: () => Promise.resolve({ grant: "granted" }),
      status: () => scene.statusGate === undefined ? Promise.resolve(reading()) : scene.statusGate.then(reading),
      start: ({ ownerDigest, folderId }: { ownerDigest: string; folderId?: string }) => {
        if (scene.tape.state !== "idle") return Promise.reject(rejection("A recording is already open"));
        scene.told.push("Start");
        scene.tape = { state: "recording", recordingId: `recording-${scene.told.length}`, binding: { ownerDigest, folderId: folderId ?? null }, durationMs: 0, segments: [] };
        changed();
        return Promise.resolve(reading());
      },
      command: ({ recordingId, command }: { recordingId: string; command: "Pause" | "Resume" | "End" }) => told(recordingId, command, () => {
        if (command !== "Resume") written();
        scene.tape.state = command === "Pause" ? "paused" : command === "Resume" ? "recording" : "stopped";
        if (command === "End") scene.tape.stopReason = "user";
      }),
      retain: ({ recordingId, noteId }: { recordingId: string; noteId: string }) => {
        if (recordingId !== scene.tape.recordingId) return Promise.reject(rejection("No such recording"));
        scene.audio.set(recordingId, { noteId, durationMs: scene.tape.durationMs });
        return Promise.resolve({ audioId: recordingId, noteId, durationMs: scene.tape.durationMs });
      },
      discard: ({ recordingId }: { recordingId: string }) => {
        if (recordingId !== scene.tape.recordingId) return Promise.reject(rejection("The recording changed"));
        scene.tape = { state: "idle", durationMs: 0, segments: [] };
        changed();
        return Promise.resolve();
      },
      consumeOpen: () => Promise.resolve({ open: false }),
      previousExists: () => Promise.resolve({ present: false }),
      describe: ({ audioId }: { audioId: string }) => {
        const recording = scene.audio.get(audioId);
        return recording === undefined ? Promise.reject(rejection("No such recording")) : Promise.resolve({ ...recording, audioId });
      },
      play: ({ audioId, noteId, offsetMs }: NonNullable<NotesScene["playing"]>) => {
        if (scene.audio.get(audioId)?.noteId !== noteId) return Promise.resolve({ ok: false });
        finish?.({ ok: false });
        scene.playing = { audioId, noteId, offsetMs };
        return new Promise<{ ok: boolean }>((resolve) => { finish = resolve; });
      },
      halt: () => {
        delete scene.playing;
        finish?.({ ok: true });
        finish = undefined;
        return Promise.resolve({ ok: true });
      },
    };
  };
}

const Interact = Schema.Struct({
  capability: Schema.Literals(["create-note", "update-note", "delete-note", "restore-note"]),
  params: Schema.Struct({
    id: Schema.optionalKey(Schema.String),
    content: Schema.optionalKey(Schema.String),
    format: Schema.optionalKey(Schema.Unknown),
    expectedRevision: Schema.optionalKey(Schema.Int),
    creationId: Schema.optionalKey(Schema.String),
  }),
});
const decoded = Schema.decodeUnknownOption(Interact);

function snapshot(scene: NotesScene): NotesSnapshot {
  return { notes: scene.notes, revision: scene.revision, trash: scene.trash };
}

function result(scene: NotesScene, row: StickyNote) {
  return Response.json({ requestId: "notes-fake", success: true, result: { success: true, text: row.title, state: snapshot(scene), data: { note: row } } });
}

function refused(status: number) {
  return Response.json({ error: "The Notes operation was refused" }, { status });
}

function contentOf(text: string): Pick<StickyNote, "title" | "body"> {
  const line = text.indexOf("\n");
  return line < 0 ? { title: text, body: "" } : { title: text.slice(0, line), body: text.slice(line) };
}

function interact(scene: NotesScene, input: unknown, now: () => number): Response {
  const found = decoded(input);
  if (found._tag === "None") return refused(400);
  const { capability, params } = found.value;
  if (scene.failing || scene.refusing) return refused(503);
  if (params.expectedRevision !== undefined && params.expectedRevision !== scene.revision) return refused(409);
  const at = Date.now();
  const format = parseNoteFormat(params.format);
  if (capability === "create-note") {
    const oldId = params.creationId === undefined ? undefined : scene.creations.get(params.creationId);
    const old = scene.notes.find((item) => item.id === oldId);
    if (old !== undefined) return result(scene, old);
    const words = contentOf(params.content ?? "");
    const made = note(`fake-note-${scene.revision + 1}`, words.title, words.body, at, format);
    if (params.creationId !== undefined) scene.creations.set(params.creationId, made.id);
    scene.notes.unshift(made);
    scene.revision += 1;
    return result(scene, made);
  }
  const present = scene.notes.find((item) => item.id === params.id);
  if (capability === "restore-note") {
    const row = scene.trash.find((entry) => entry.note.id === params.id);
    if (row === undefined) return refused(404);
    scene.notes.unshift(row.note);
    scene.trash = scene.trash.filter((entry) => entry !== row);
    scene.revision += 1;
    return result(scene, row.note);
  }
  if (present === undefined) return refused(404);
  if (capability === "delete-note") {
    scene.deleteRequests?.push({ id: present.id, expectedRevision: params.expectedRevision });
    if (present.id === scene.refuseDiscardId) return refused(409);
    scene.notes = scene.notes.filter((item) => item !== present);
    /** The store and the phone share one clock, as the resident agent does on the device: a deletion is stamped at the world's time. */
    const deletedAt = iso(now());
    scene.trash.push({ note: present, deletedAt });
    scene.revision += 1;
    return result(scene, present);
  }
  const edited: StickyNote = {
    ...present,
    ...(params.content === undefined ? {} : contentOf(params.content)),
    ...(format === undefined ? {} : { format }),
    updatedAt: iso(at),
  };
  scene.notes = scene.notes.map((item) => item === present ? edited : item);
  scene.revision += 1;
  return result(scene, edited);
}

/** The resident agent's Notes and owner routes. */
export function notesRoutes(scene: NotesScene, now: () => number): Route[] {
  return [
    (request, url) => {
      if (request.method === "GET" && url.pathname === "/api/auth/me") {
        return Response.json({ identity: { kind: "owner", id: scene.owner }, access: { role: "OWNER", mode: "local" } });
      }
      if (request.method === "GET" && url.pathname === "/api/client-devices/capabilities") {
        return Response.json({ protocol: 1, agentId: scene.owner, identityId: scene.ownerIdentity,
          deviceActions: { protocol: 1, capabilities: [] } });
      }
      if (request.method === "GET" && url.pathname === "/api/notes/state") {
        const answer = () => {
          const advertised = scene.deleteAtRevision === false ? {} : { deleteAtRevision: true };
          return scene.failing ? refused(503) : Response.json({ success: true, data: { ...snapshot(scene), ...advertised } });
        };
        return scene.stateGate === undefined ? answer() : scene.stateGate.then(answer);
      }
      if (request.method === "GET" && url.pathname === "/api/notes/trash/recordings") return Response.json({ success: true, data: [] });
      if (request.method === "POST" && url.pathname === "/api/notes/interact") {
        return request.json().then((body: unknown) => {
          const found = decoded(body);
          const gate = scene.discardGate !== undefined && found._tag === "Some" && found.value.capability === "delete-note" ? scene.discardGate : scene.interactGate;
          return gate === undefined ? interact(scene, body, now) : gate.then(() => interact(scene, body, now));
        });
      }
      if (request.method === "POST" && url.pathname === "/api/views/interact-claim") {
        return request.json().then(async (body: Record<string, unknown>) => {
          const gate = scene.viewClaimGate;
          const claimId = `claim-${scene.views.length + 1}`;
          scene.views.push({ path: "claim", body });
          await gate;
          const saved = body.targetProtocol === "saved-note-v1" && scene.target !== undefined;
          return Response.json({ claimId, ...(saved ? { target: { kind: "saved-note", noteId: scene.target } } : {}) });
        });
      }
      if (request.method === "POST" && url.pathname === "/api/views/interact-result") {
        return request.json().then((body: Record<string, unknown>) => {
          scene.views.push({ path: "result", body });
          return Response.json({ ok: true, accepted: true });
        });
      }
      return undefined;
    },
  ];
}
