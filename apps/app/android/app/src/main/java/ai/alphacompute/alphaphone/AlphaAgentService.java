// spec/agent/index.md, "Story: Run Alpha's agent on the phone"; spec/app/platform/adoption.md, "The earlier store is brought in only for the account that signed in to the earlier Alpha"; spec/app/settings/preferences.md, "The agent is launched allowed to change Gmail and Calendar exactly as the phone last read or saved, allowed neither once it could not read them, and Alpha says nothing of it before the first answer"
package ai.alphacompute.alphaphone;

import ai.alphacompute.alphaphone.ipc.AlphaPreferencesProvider;
import ai.alphacompute.alphaphone.overlay.AlphaControlRuntimeBridge;
import ai.alphacompute.alphaphone.runtime.RuntimeUpdatePause;
import ai.alphacompute.ipc.AlphaIpcContract;
import ai.alphacompute.localllm.AlphaLocalInferenceHost;
import ai.alphacompute.localllm.AlphaLocalLlmCatalog;
import ai.alphacompute.localllm.AlphaLocalModelManager;
import ai.eliza.os.agent.AgentConfig;
import ai.eliza.os.agent.AgentCredentials;
import ai.eliza.os.agent.AgentService;
import ai.eliza.os.agent.inference.InferenceHost;
import ai.eliza.voice.LocalInferenceHost;
import ai.eliza.voice.VoiceAssets;
import android.content.Context;
import android.content.SharedPreferences;
import java.io.File;
import java.io.IOException;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

public final class AlphaAgentService extends AgentService {
  private static final String STORE = "alpha-agent";
  private static final String GMAIL = "google-gmail-changes";
  private static final String CALENDAR = "google-calendar-edits";

  private static final String SPEECH_SOCKET = "ALPHA_LOCAL_SPEECH_SOCKET";
  private static final String LOCAL_LLM_SOCKET = "ALPHA_LOCAL_LLM_SOCKET";
  private static final String AI_MODE_ENV = "ALPHA_AI_MODE";
  private static final String LOCAL_MODEL_ENV = "ALPHA_LOCAL_MODEL";
  private static final Object CONSENT_LOCK = new Object();
  private static final Object AI_MODE_LOCK = new Object();
  private static final AtomicReference<AlphaAgentService> speechService = new AtomicReference<>();
  private final Object speechLock = new Object();
  private SpeechHost speech;
  private boolean retiring;

  private record SpeechHost(String name, InferenceHost host) {}

  private AgentCredentials.Account launchAccount() {
    try {
      AgentCredentials.Active active = credentials().current();
      return active == null ? null : active.account();
    } catch (Exception unavailable) {
      return null;
    }
  }

  @Override public void onCreate() {
    super.onCreate();
    AlphaControlRuntimeBridge.attach(this);
  }

  @Override protected void configureLaunch(Map<String, String> variables) {
    RuntimeUpdatePause.beforeStart();
    synchronized (speechLock) {
      if (retiring) return;
    }
    AlphaLegacyAgentArchive.prepareLaunch(this, launchAccount(), variables);
    configureLocalLlm(variables);
    synchronized (speechLock) {
      if (retiring) return;
      if (speech != null) {
        variables.put(SPEECH_SOCKET, speech.name());
        return;
      }
    }
    SpeechHost started;
    try {
      String name = "alpha-talk-" + UUID.randomUUID();
      File models = new File(getNoBackupFilesDir(), "resident-speech-models");
      if (!models.isDirectory() && !models.mkdirs()) return;
      started = new SpeechHost(name, LocalInferenceHost.start(this, name, VoiceAssets.install(this), models));
    } catch (IOException | IllegalStateException | LinkageError unavailable) {
      return;
    }
    synchronized (speechLock) {
      if (!retiring && speech == null) {
        speech = started;
        speechService.set(this);
        variables.put(SPEECH_SOCKET, started.name());
        return;
      }
      if (!retiring && speech != null) {
        variables.put(SPEECH_SOCKET, speech.name());
      }
    }
    started.host().stop();
  }

  private void configureLocalLlm(Map<String, String> variables) {
    AlphaLocalModelManager manager = AlphaLocalModelManager.shared(this);
    String prefMode = AlphaPreferencesProvider.readForCore(this, AlphaIpcContract.KEY_AI_MODE);
    String prefModel = AlphaPreferencesProvider.readForCore(this, AlphaIpcContract.KEY_LOCAL_MODEL);
    String aiMode = prefMode != null && AlphaLocalModelManager.VALID_MODES.contains(prefMode.trim())
      ? prefMode.trim()
      : manager.mode();
    String localModel = prefModel != null && !prefModel.isBlank()
      ? prefModel.trim()
      : manager.activeModelId();
    if (localModel == null || localModel.isBlank()) {
      localModel = AlphaLocalLlmCatalog.DEFAULT_MODEL_ID;
    }
    if (!aiMode.equals(manager.mode()) || !localModel.equals(manager.activeModelId())) {
      try {
        manager.setMode(aiMode, AlphaLocalLlmCatalog.byId(localModel) != null ? localModel : null);
      } catch (Exception ignored) {
      }
    }
    variables.put(AI_MODE_ENV, aiMode);
    variables.put(LOCAL_MODEL_ENV, localModel);
    try {
      AlphaLocalInferenceHost localHost = AlphaLocalInferenceHost.shared(this);
      localHost.start();
      variables.put(LOCAL_LLM_SOCKET, localHost.socketPath().toString());
    } catch (IOException | RuntimeException unavailable) {
    }
  }

  /** Synchronizes {@code AlphaLocalModelManager} and restarts a running agent when {@code alpha.aiMode} or {@code alpha.localModel} changes. */
  public static void onAiPreferenceChanged(Context context) {
    if (context == null) return;
    Context appContext = context.getApplicationContext();
    synchronized (AI_MODE_LOCK) {
      AlphaLocalModelManager manager = AlphaLocalModelManager.shared(appContext);
      String prefMode = AlphaPreferencesProvider.readForCore(appContext, AlphaIpcContract.KEY_AI_MODE);
      String prefModel = AlphaPreferencesProvider.readForCore(appContext, AlphaIpcContract.KEY_LOCAL_MODEL);
      String resolvedMode = prefMode != null && AlphaLocalModelManager.VALID_MODES.contains(prefMode.trim())
        ? prefMode.trim()
        : "cloud";
      String resolvedModel = prefModel != null && AlphaLocalLlmCatalog.byId(prefModel.trim()) != null
        ? prefModel.trim()
        : manager.activeModelId();
      try {
        manager.setMode(resolvedMode, resolvedModel);
      } catch (Exception ignored) {
      }
      String state = AgentService.status(appContext).optString("state");
      if ("running".equals(state) || "starting".equals(state)) {
        try {
          AgentService.restart(appContext);
        } catch (IllegalStateException ignored) {
        }
      }
    }
  }

  @Override public void onTrimMemory(int level) {
    super.onTrimMemory(level);
    AlphaLocalInferenceHost.shared(this).onTrimMemory(level);
  }

  static boolean localSpeechHostReady() {
    return speechService.get() != null;
  }

  @Override public void onDestroy() {
    AlphaControlRuntimeBridge.detach();
    SpeechHost stopped;
    synchronized (speechLock) {
      retiring = true;
      stopped = speech;
      speech = null;
      speechService.compareAndSet(this, null);
    }
    AlphaLocalInferenceHost.shared(this).stop();
    super.onDestroy();
    if (stopped != null) {
      Thread worker = new Thread(stopped.host()::stop, "AlphaResidentSpeechStop");
      worker.setDaemon(true);
      worker.start();
    }
  }

  /** The consent the owner's Settings last gave, in place of the host file's; none until Settings first read the owner's choice. */
  @Override protected AgentConfig.GoogleConsent googleConsent() { return kept(this); }

  /**
   * Keeps {@code consent} for every launch from now on, restarting an agent that runs or is starting with another. Whether it is kept:
   * where it cannot be saved, or a running agent cannot be restarted with it, what was kept before stays, so the agent and Settings agree.
   */
  static boolean keep(Context context, AgentConfig.GoogleConsent consent) {
    synchronized (CONSENT_LOCK) {
      AgentConfig.GoogleConsent before = kept(context);
      if (Objects.equals(consent, before)) return true;
      if (!save(context, consent)) return false;
      String state = AgentService.status(context).optString("state");
      if (!state.equals("running") && !state.equals("starting")) return true;
      try { AgentService.restart(context); return true; }
      catch (IllegalStateException refused) { save(context, before); return false; }
    }
  }

  /** Saves {@code consent}, or forgets the one saved where it is null. */
  private static boolean save(Context context, AgentConfig.GoogleConsent consent) {
    SharedPreferences.Editor edit = context.getSharedPreferences(STORE, Context.MODE_PRIVATE).edit();
    if (consent == null) edit.remove(GMAIL).remove(CALENDAR);
    else edit.putBoolean(GMAIL, consent.gmailChanges()).putBoolean(CALENDAR, consent.calendarEdits());
    return edit.commit();
  }

  private static AgentConfig.GoogleConsent kept(Context context) {
    SharedPreferences store = context.getSharedPreferences(STORE, Context.MODE_PRIVATE);
    if (!store.contains(GMAIL) || !store.contains(CALENDAR)) return null;
    return new AgentConfig.GoogleConsent(store.getBoolean(GMAIL, false), store.getBoolean(CALENDAR, false));
  }
}
