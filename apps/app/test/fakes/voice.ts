// spec/app/voice/index.md, "Story: Hold a spoken conversation"; spec/app/voice/index.md, "The speech pipeline warms on startup, foreground return and account readiness without opening the microphone"
import type { ElizaSignInPlugin, CloudStreamEvent, ElizaCloudSpeechPlugin } from "@elizaos/os-bridges";
import { type Faked, type MailLeaseScene, plugin, rejection } from "./phone.ts";

export interface SpokenSentence {
  readonly text: string;
  readonly append: boolean;
  readonly replace: boolean;
  readonly channel: "local" | "cloud";
}

type NoteWindow = { readonly requestId: string; readonly recordingId: string; readonly noteId: string; readonly offsetMs: number; readonly durationMs: number };

export interface VoiceScene {
  permission: "granted" | "denied" | "prompt";
  grantOnRequest: boolean;
  localReady: boolean;
  recognitionReady?: boolean;
  recognitionProbeGate?: () => Promise<void>;
  liveCaptureAvailable: boolean;
  nativeTransport: boolean;
  transcriptionFailures: number;
  dictationInFront: boolean;
  refuseRecordingStop: boolean;
  recordingStartGate?: () => Promise<void>;
  recordingCancelGate?: () => Promise<void>;
  finishRecording?: () => void;
  readonly dictationClips: string[];
  voicemailTranscription: ((id: string, requestId: string) => Promise<string>) | undefined;
  noteTranscription?: (window: NoteWindow) => Promise<string>;
  readonly canceledVoicemailTranscriptions: string[];
  probeGate: (() => Promise<void>) | undefined;
  warmSpeechOutputCalls: number;
  localSpeechStatusCalls: number;
  liveCaptureStatusCalls: number;
  holdEngineCalls: number;
  releaseEngineHoldCalls: number;
  engineHeld: boolean;
  startLiveCaptureCalls: number;
  /** Whether each live capture asked the phone's recognizer to hear the owner over Alpha's own voice. */
  readonly liveCaptureBargeIn: boolean[];
  stopLiveCaptureCalls: number;
  /** Whether the agent acknowledges closing a live capture's speech session, as it cannot once the phone lost its connection. */
  agentClosesLiveCapture: boolean;
  /** Whether stopping the microphone itself fails, so `LiveCaptureController.java` keeps holding it. */
  liveCaptureReleaseFails: boolean;
  /** Held while the phone is asked to stop a live capture, as a slow `stopAndWait` answers it. */
  liveCaptureStopGate?: () => Promise<void>;
  startCloudSpeechCalls: number;
  cloudStartGate?: () => Promise<void>;
  /** Held while the relay is asked to unmute its microphone, as a slow phone answers it. */
  cloudUnmuteGate?: () => Promise<void>;
  readonly cloudStarts: { readonly environment: string; readonly credentialId: string }[];
  readonly relayWarmups: string[];
  relayWarmupHangs: boolean;
  onDevice: boolean;
  /** Whether the phone has the Cloud speech plugin; with neither it and `onDevice`, speech is unavailable. */
  cloudSpeech: boolean;
  credentialId: string;
  organizationId: string;
  streamTiming: unknown;
  stopCloudSpeechCalls: number;
  /** Whether the relay rejects being asked to stop its session. */
  cloudStopFails: boolean;
  hushCalls: number;
  /** Each local playback the phone was asked to stop, by request, or `undefined` for all of its speech. */
  readonly playbackStops: (string | undefined)[];
  /** Whether the phone rejects being asked to stop its speech. */
  playbackStopFails: boolean;
  speakerMuted: boolean;
  speakerGainGate?: (muted: boolean) => Promise<void>;
  synthesisGate?: () => Promise<void>;
  /** While set, a local playback is reported ended only once this settles, as a long line plays out. */
  playbackHold?: () => Promise<void>;
  /** What the local speaker started playing, in order, and when. */
  readonly played: { readonly text: string; readonly at: number }[];
  readonly speakerGainRequests: boolean[];
  readonly speakerMutedAtPlayback: boolean[];
  readonly spoken: SpokenSentence[];
  readonly spokenPages: { readonly readingToken: string; readonly ownerId: string; readonly sessionId: string; readonly requestId: string }[];
  holdPagePlayback?: boolean;
  activeMicSession: string | undefined;
  emitLocal?: (event: string, data: unknown) => void;
  emitCloud?: (event: CloudStreamEvent) => void;
  startupSignIn?: Partial<Pick<ElizaSignInPlugin, "startEmail" | "startPhone" | "startGoogle" | "reauthenticate" | "verify" | "resend" | "cancel" | "sendFactorCode" | "status">>;
  /** The phone's sign-in settling on the account whose key is `credentialId` now, as `ElizaSignInPlugin.java` tells it. */
  signedInHere?: () => void;
  billingVerified?: string;
}

export function voiceScene(): VoiceScene {
  return {
    permission: "granted",
    grantOnRequest: true,
    localReady: true,
    liveCaptureAvailable: true,
    nativeTransport: true,
    transcriptionFailures: 0,
    dictationInFront: true,
    refuseRecordingStop: false,
    dictationClips: [],
    voicemailTranscription: undefined,
    canceledVoicemailTranscriptions: [],
    probeGate: undefined,
    warmSpeechOutputCalls: 0,
    localSpeechStatusCalls: 0,
    liveCaptureStatusCalls: 0,
    holdEngineCalls: 0,
    releaseEngineHoldCalls: 0,
    engineHeld: false,
    startLiveCaptureCalls: 0,
    liveCaptureBargeIn: [],
    stopLiveCaptureCalls: 0,
    agentClosesLiveCapture: true,
    liveCaptureReleaseFails: false,
    startCloudSpeechCalls: 0,
    cloudStarts: [],
    relayWarmups: [],
    relayWarmupHangs: false,
    onDevice: true,
    cloudSpeech: true,
    credentialId: "cred-1",
    organizationId: "org-1",
    streamTiming: { format: "alpha-cloud-stream-timing-v1", records: [] },
    stopCloudSpeechCalls: 0,
    cloudStopFails: false,
    hushCalls: 0,
    playbackStops: [],
    playbackStopFails: false,
    speakerMuted: false,
    speakerGainRequests: [],
    speakerMutedAtPlayback: [],
    spoken: [],
    spokenPages: [],
    played: [],
    activeMicSession: undefined,
  };
}

export function alphaVoiceCloud(voice: VoiceScene): Faked {
  return (emit) => {
    voice.emitLocal = emit;
    let playbackSeq = 0;
    let pagePlaybackId: string | undefined;
    const texts = new Map<string, string>();
    let recordingSeq = 0;
    const agentSessions = new Set<string>();
    let activeRecording: string | undefined;
    let finishedRecording: string | undefined;
    const finish = () => {
      if (activeRecording === undefined) throw new Error("No recording is active");
      const recordingId = activeRecording;
      finishedRecording = recordingId;
      activeRecording = undefined;
      return { recordingId, status: "recorded", durationMs: 59_000 };
    };
    voice.finishRecording = () => emit("recordingStopped", finish());
    return {
      checkPermissions: () => Promise.resolve({ microphone: voice.permission }),
      requestPermissions: () => {
        voice.permission = voice.grantOnRequest ? "granted" : "denied";
        return Promise.resolve({ microphone: voice.permission });
      },
      warmSpeechOutput: () => {
        voice.warmSpeechOutputCalls += 1;
        return Promise.resolve({ warmed: true });
      },
      localSpeechStatus: async ({ ttsOnly }: { ttsOnly?: boolean }) => {
        voice.localSpeechStatusCalls += 1;
        if (voice.probeGate !== undefined) await voice.probeGate();
        if (!ttsOnly) await voice.recognitionProbeGate?.();
        return { ready: ttsOnly ? voice.localReady : (voice.recognitionReady ?? voice.localReady), ttsReady: voice.localReady };
      },
      holdSpeechEngine: () => {
        voice.holdEngineCalls += 1;
        voice.engineHeld = true;
        return Promise.resolve({ held: true });
      },
      releaseSpeechEngineHold: () => {
        voice.releaseEngineHoldCalls += 1;
        voice.engineHeld = false;
        return Promise.resolve({});
      },
      liveCaptureStatus: async () => {
        voice.liveCaptureStatusCalls += 1;
        if (voice.probeGate !== undefined) await voice.probeGate();
        return { available: voice.liveCaptureAvailable, nativeTransport: voice.nativeTransport };
      },
      startLiveCapture: ({ captureId, nativeAsr, bargeIn }: { captureId: string; nativeAsr: boolean; bargeIn?: boolean }) => {
        voice.startLiveCaptureCalls += 1;
        if (voice.activeMicSession !== undefined && voice.liveCaptureReleaseFails) return Promise.reject(rejection("Microphone release is unconfirmed", "capture"));
        voice.liveCaptureBargeIn.push(bargeIn === true);
        voice.activeMicSession = captureId;
        if (nativeAsr) agentSessions.add(captureId);
        return Promise.resolve({ captureId, nativeAsr, echoCancelled: true });
      },
      stopLiveCapture: async ({ captureId }: { captureId: string }) => {
        voice.stopLiveCaptureCalls += 1;
        const gate = voice.liveCaptureStopGate;
        if (gate !== undefined) await gate();
        const held = voice.activeMicSession === captureId && voice.liveCaptureReleaseFails;
        if (voice.activeMicSession === captureId && !held) voice.activeMicSession = undefined;
        const piped = agentSessions.delete(captureId);
        return { captureId, durationMs: 0, serverClosed: !held && (!piped || voice.agentClosesLiveCapture) };
      },
      synthesizeLocal: async ({ text, append, replace }: { requestId: string; text: string; append?: boolean; replace?: boolean }) => {
        voice.spoken.push({ text, append: append === true, replace: replace !== false, channel: "local" });
        const playbackId = `pb-${++playbackSeq}`;
        texts.set(playbackId, text);
        await voice.synthesisGate?.();
        return { playbackId };
      },
      synthesizeLocalBrowserReading: (reading: VoiceScene["spokenPages"][number]) => {
        const { readingToken, ownerId, sessionId, requestId } = reading;
        voice.spokenPages.push({ readingToken, ownerId, sessionId, requestId });
        pagePlaybackId = `pb-${++playbackSeq}`;
        return Promise.resolve({ execution: "device", playbackId: pagePlaybackId });
      },
      play: ({ playbackId }: { playbackId: string }) => {
        voice.speakerMutedAtPlayback.push(voice.speakerMuted);
        voice.played.push({ text: texts.get(playbackId) ?? "", at: Date.now() });
        const hold = voice.playbackHold;
        if (voice.holdPagePlayback && playbackId === pagePlaybackId) return Promise.resolve({});
        if (hold === undefined) void Promise.resolve().then(() => emit("playbackEnded", { playbackId }));
        else void hold().then(() => emit("playbackEnded", { playbackId }));
        return Promise.resolve({});
      },
      setSpeechOutputMuted: async ({ muted }: { muted: boolean }) => {
        voice.speakerGainRequests.push(muted);
        await voice.speakerGainGate?.(muted);
        voice.speakerMuted = muted;
      },
      stopPlayback: ({ requestId }: { requestId?: string }) => {
        voice.hushCalls += 1;
        voice.playbackStops.push(requestId);
        return voice.playbackStopFails ? Promise.reject(rejection("Playback could not be stopped")) : Promise.resolve({});
      },
      cancel: () => Promise.resolve({}),
      transcribeSavedNote: async (window: NoteWindow) => {
        if (voice.noteTranscription === undefined) throw rejection("No saved note transcription");
        return { text: await voice.noteTranscription(window), local: true };
      },
      startRecording: async () => {
        const recordingId = `rec-${++recordingSeq}`;
        activeRecording = recordingId;
        finishedRecording = undefined;
        await voice.recordingStartGate?.();
        return { recordingId };
      },
      stopRecording: () => {
        if (voice.refuseRecordingStop) {
          activeRecording = undefined;
          return Promise.reject(new Error("Recording could not be saved"));
        }
        return Promise.resolve().then(finish);
      },
      dictationForeground: () => Promise.resolve({ available: voice.dictationInFront }),
      cancelRecording: async () => {
        await voice.recordingCancelGate?.();
        activeRecording = undefined;
        finishedRecording = undefined;
        return {};
      },
      transcribeLocalRecording: ({ recordingId }: { recordingId: string }) => {
        voice.dictationClips.push(recordingId);
        if (finishedRecording !== recordingId) return Promise.reject(new Error("Recording unavailable"));
        if (voice.transcriptionFailures > 0) {
          voice.transcriptionFailures -= 1;
          return Promise.reject(new Error("Recognition failed"));
        }
        return Promise.resolve({ text: "Dictated note" });
      },
      transcribeVoicemail: async ({ id, requestId }: { id: string; requestId: string }) => {
        if (!voice.voicemailTranscription) throw rejection("Voicemail recognizer unavailable", "unavailable");
        return { text: await voice.voicemailTranscription(id, requestId) };
      },
      cancelVoicemailTranscription: ({ requestId }: { requestId: string }) => {
        voice.canceledVoicemailTranscriptions.push(requestId);
        return Promise.resolve({});
      },
    };
  };
}

/** What `SpeechStreamBridgePlugin.java` answers beyond eliza's TypeScript definition: the relay's warm-up and its timing records. */
type RelayExtras = {
  prewarmCloudSpeech(input: { environment: string }): Promise<unknown>;
  cloudStreamTiming(input: Record<string, never>): Promise<unknown>;
};

export function elizaCloudSpeech(voice: VoiceScene): Faked {
  return plugin<ElizaCloudSpeechPlugin & RelayExtras, { cloudSpeechEvent: CloudStreamEvent }>((emit) => {
    voice.emitCloud = (event) => emit("cloudSpeechEvent", event);
    const cancelled = new Set<string>();
    return {
      prewarmCloudSpeech: ({ environment }) => {
        voice.relayWarmups.push(environment);
        return voice.relayWarmupHangs ? new Promise<never>(() => undefined) : Promise.resolve();
      },
      cloudStreamTiming: () => Promise.resolve(voice.streamTiming),
      startCloudSpeech: async ({ sessionId, environment, credentialId }) => {
        voice.cloudStarts.push({ environment, credentialId });
        if (credentialId !== voice.credentialId) throw rejection("Voice is already active or unavailable");
        voice.startCloudSpeechCalls += 1;
        voice.activeMicSession = sessionId;
        try {
          await voice.cloudStartGate?.();
        } catch (refused) {
          if (voice.activeMicSession === sessionId) voice.activeMicSession = undefined;
          throw refused;
        }
        return { sessionId, sampleRate: 16000, echoCancelled: true };
      },
      stopCloudSpeech: ({ sessionId }) => {
        voice.stopCloudSpeechCalls += 1;
        if (voice.cloudStopFails) return Promise.reject(rejection("Cloud speech could not be stopped"));
        if (voice.activeMicSession === sessionId) voice.activeMicSession = undefined;
        return Promise.resolve({});
      },
      setCloudSpeechOutputMuted: ({ muted }) => {
        voice.speakerMuted = muted;
        return Promise.resolve({});
      },
      setCloudSpeechMuted: async ({ muted }) => {
        if (!muted) await voice.cloudUnmuteGate?.();
        return {};
      },
      speakCloudSpeech: ({ sessionId, utteranceId, text }) => {
        voice.spoken.push({ text, append: false, replace: false, channel: "cloud" });
        void Promise.resolve().then(() => {
          if (utteranceId !== undefined && cancelled.has(utteranceId)) {
            cancelled.delete(utteranceId);
            return;
          }
          emit("cloudSpeechEvent", { sessionId, type: "audio-start", utteranceId });
          emit("cloudSpeechEvent", { sessionId, type: "audio-end", utteranceId });
        });
        return Promise.resolve({});
      },
      cancelCloudSpeech: ({ sessionId, utteranceId }) => {
        voice.hushCalls += 1;
        if (utteranceId !== undefined) cancelled.add(utteranceId);
        emit("cloudSpeechEvent", { sessionId, type: "audio-end", utteranceId, interrupted: "cancelled" });
        return Promise.resolve({});
      },
    };
  });
}

/** `ElizaSignInPlugin.java`'s `status`, the registered cloud's readiness and the account its key belongs to, and its `signInSettled` receipt, as the wire carries it. */
export function elizaSignIn(voice: VoiceScene, signedIn: () => boolean, lease: MailLeaseScene): Faked {
  return plugin<Pick<ElizaSignInPlugin, "status" | "upgradeMailLease" | Overridable>, { signInSettled: unknown }>((emit) => {
    voice.signedInHere = () => emit("signInSettled", { request: 1, attempt: 1, verdict: "signed-in-as", credentialId: voice.credentialId, google: "not-requested" });
    return {
      upgradeMailLease() {
        if (!signedIn() || lease.held) return Promise.reject(rejection("rejected"));
        lease.asked += 1;
        if (lease.answer === "Cancels") return Promise.resolve({ request: lease.asked, attempt: lease.asked, verdict: "ended", problem: "cancelled" });
        lease.held = true;
        return Promise.resolve({ request: lease.asked, attempt: lease.asked, verdict: "signed-in-as", credentialId: voice.credentialId, google: "not-requested" });
      },
      status: ({ environment }) => Promise.resolve({
        environment, methodsKnown: true, email: true, sms: false, google: false, googleMode: "browser",
        account: signedIn()
          ? { signedIn: true, userId: "user-1", organizationId: voice.organizationId, credentialId: voice.credentialId, keyExpiresAt: 4_102_444_800_000 }
          : { signedIn: false },
      }),
      ...unanswered,
      ...voice.startupSignIn,
    };
  });
}

type Overridable = Exclude<keyof NonNullable<VoiceScene["startupSignIn"]>, "status">;
/**
 * Each method a scene may answer, declared in every phone's header as the Java plugin declares it. Capacitor reads a
 * plugin's header once, when the page first registers it, so a method one world leaves out would stay missing for
 * the later worlds of the same file. One no scene answers fails as the bridge fails a method it lacks.
 */
const refused = (method: Overridable) => () => Promise.reject(rejection(`ElizaSignIn.${method} is not implemented`, "UNIMPLEMENTED"));
const unanswered: Pick<ElizaSignInPlugin, Overridable> = {
  startEmail: refused("startEmail"), startPhone: refused("startPhone"), startGoogle: refused("startGoogle"), reauthenticate: refused("reauthenticate"),
  verify: refused("verify"), resend: refused("resend"), cancel: refused("cancel"), sendFactorCode: refused("sendFactorCode"),
};
