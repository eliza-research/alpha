// spec/app/account/provider.md, "Story: See where my requests go"; spec/app/account/provider.md, "Story: Use my own key"; spec/app/account/provider.md, "Story: Choose Cloud or my key"
import { Banner, Button, Card, CardTitle, ConfirmDialog, Input, Label, ListGroup, ListRow, StatusDot } from "@repo/ui";
import { useState } from "react";
import { sends, shows, type Offer, type Trouble } from "../../gen/app__account__provider.ts";
import { useMachine as useProvider } from "../../gen/app__account__provider.react.ts";
import type { LocalLlmModel } from "../platform/index.vibe";
import { untimed } from "../runtime/index.vibe";
import {
  type AccountRuntime,
  type LocalLlmController,
  setAccountAiMode,
  useAccountShelf,
  useAccountTimed,
  useLocalLlmCatalog,
} from "./useAccount.ts";

const troubleText: Partial<Record<Trouble, string>> = {
  KeyRefused: "That API key was refused. Your saved keys were kept.",
  KeyUnchecked: "Couldn’t verify that key. Try again later.",
  CheckWithdrawn: "Key check cancelled. Your saved keys were kept.",
  NotUsed: "Couldn’t save that key. Status refreshed.",
  NotSelected: "Couldn’t switch provider. Status refreshed.",
  NotRemoved: "Couldn’t remove that key.",
  Interrupted: "Alpha restarted during a provider change.",
  Unconfirmed: "The provider change timed out and is being rechecked.",
};

function offerDescription(offer: Offer): string {
  const details = shows(offer);
  if (details.recipient === "AlphaCloud") return "Requests and allowed context will be sent to Alpha Cloud under your plan.";
  if (details.recipient === "Cerebras") return "Requests and allowed context will be sent directly to Cerebras using your own key.";
  if (details.recipient === "VoiceProvider") return "Spoken audio will be sent to your voice provider using your voice key. Your Cerebras key is unchanged.";
  return "No AI requests will be sent until a provider is chosen.";
}

function formatGigabytes(bytes: number): string {
  if (bytes <= 0) return "0 MB";
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

function fitBadge(model: LocalLlmModel): { readonly status: "ok" | "warn" | "off"; readonly label: string } {
  if (model.active) return { status: "ok", label: "Active" };
  if (model.installPhase === "downloading") return { status: "warn", label: `${model.downloadProgress ?? 0}%` };
  if (model.installPhase === "verifying") return { status: "warn", label: "Verifying" };
  if (model.downloaded) return { status: "ok", label: "Ready" };
  if (model.fit === "insufficient") return { status: "off", label: "Needs more RAM" };
  if (model.fit === "tight") return { status: "warn", label: "Tight RAM" };
  return { status: "ok", label: "Fits" };
}

/** Curated on-device GGUF model catalog and download/activation controls. */
function LocalModelsSection({
  runtime,
  localLlm,
}: {
  readonly runtime: AccountRuntime;
  readonly localLlm: LocalLlmController;
}) {
  const { status: llmStatus, models } = localLlm.catalog;
  return (
    <>
      {localLlm.notice ? (
        <Banner
          variant={localLlm.meteredPromptModelId ? "warn" : "info"}
          action={(
            <div className="flex flex-wrap gap-2">
              {localLlm.meteredPromptModelId ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const target = localLlm.meteredPromptModelId;
                    if (target) void localLlm.download(target, true);
                  }}
                >
                  Download on cellular
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onClick={localLlm.dismissNotice}>
                Dismiss
              </Button>
            </div>
          )}
        >
          {localLlm.notice}
        </Banner>
      ) : null}

      <ListGroup heading="On-device models">
        {llmStatus.totalRamMb > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-caption text-muted-foreground">
            <span>
              Device memory: {(llmStatus.totalRamMb / 1024).toFixed(1)} GB RAM · {(llmStatus.freeDiskMb / 1024).toFixed(1)} GB free
            </span>
            {llmStatus.metered ? <span>Metered network (Wi-Fi recommended)</span> : null}
          </div>
        ) : null}
        {models.map((model) => {
          const badge = fitBadge(model);
          const busy = localLlm.busyModelId === model.id;
          const downloading = model.installPhase === "downloading" || model.installPhase === "verifying";
          const detailParts = [
            formatGigabytes(model.sizeBytes),
            model.license,
            model.recommended ? "Recommended" : model.role === "embedding" ? "Embeddings" : undefined,
            model.fitReason ?? model.summary,
          ].filter(Boolean);
          return (
            <div key={model.id} className="border-t border-border first:border-t-0">
              <ListRow
                title={model.name}
                detail={detailParts.join(" · ")}
                trailing={<StatusDot status={badge.status} label={badge.label} showLabel />}
              />
              {model.lastError ? (
                <p className="px-4 pb-1 text-caption text-status-error">{model.lastError}</p>
              ) : null}
              <div className="flex flex-wrap gap-2 px-4 pb-3">
                {downloading ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => { void localLlm.cancelDownload(model.id); }}
                  >
                    Cancel download
                  </Button>
                ) : !model.downloaded ? (
                  <Button
                    size="sm"
                    variant={model.recommended ? "primary" : "secondary"}
                    loading={busy}
                    disabled={busy || model.fit === "insufficient"}
                    onClick={() => { void localLlm.download(model.id, false); }}
                  >
                    {model.installPhase === "partial" || model.installPhase === "cancelled" ? "Resume download" : "Download"}
                  </Button>
                ) : (
                  <>
                    {!model.active && model.role === "chat" ? (
                      <Button
                        size="sm"
                        loading={busy}
                        disabled={busy}
                        onClick={() => {
                          void localLlm.activate(model.id).then((ok) => {
                            if (ok) void setAccountAiMode(runtime, "local", model.id);
                          });
                        }}
                      >
                        Activate
                      </Button>
                    ) : null}
                    {model.active ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busy}
                        disabled={busy}
                        onClick={() => { void localLlm.unload(); }}
                      >
                        Unload
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => { void localLlm.remove(model.id); }}
                    >
                      Delete
                    </Button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </ListGroup>
    </>
  );
}

/** AI execution mode switcher (On-Device Gemma 4 / Alpha Cloud / Own Key), local GGUF catalog, and API key management UI. */
export function ProviderView({ runtime }: { readonly runtime: AccountRuntime }) {
  const provider = useAccountTimed(runtime, useProvider);
  const shelf = useAccountShelf(runtime);
  const localLlm = useLocalLlmCatalog(runtime);
  const [keyInput, setKeyInput] = useState("");
  const state = provider.state;
  if (!state) return null;

  const activeSends = sends(state.mode);
  const currentError = troubleText[state.trouble];
  const openTextEvent = { type: "openKeyForm", kind: "TextKey" } as const;
  const openVoiceEvent = { type: "openKeyForm", kind: "VoiceKey" } as const;
  const useCloudEvent = { type: "offer", what: "UseCloud", origin: "ByOwner" } as const;
  const useOwnEvent = { type: "offer", what: "UseText", origin: "ByOwner" } as const;
  const removeTextEvent = { type: "removeKey", kind: "TextKey", busy: false, origin: "ByOwner", now: untimed } as const;
  const removeVoiceEvent = { type: "removeKey", kind: "VoiceKey", busy: false, origin: "ByOwner", now: untimed } as const;

  const aiMode = shelf.aiMode;
  const activeSummary = aiMode === "local"
    ? `Running locally on this phone with ${shelf.localModel}. No Alpha Cloud sign-in required.`
    : activeSends.recipient === "Cerebras" || aiMode === "own-key"
      ? "Sending requests directly to Cerebras with your own key."
      : activeSends.recipient === "AlphaCloud" || aiMode === "cloud"
        ? "Sending requests to Alpha Cloud."
        : "No AI provider selected yet.";

  const activeDotLabel = aiMode === "local"
    ? "On-device"
    : aiMode === "own-key"
      ? "Own key"
      : "Alpha Cloud";

  return (
    <div className="space-y-3">
      {currentError ? <Banner variant="destructive">{currentError}</Banner> : null}

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>AI Mode</CardTitle>
          <StatusDot status="ok" label={activeDotLabel} showLabel />
        </div>
        <p className="text-sm text-muted-foreground">{activeSummary}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant={aiMode === "local" ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              void setAccountAiMode(runtime, "local", shelf.localModel).then(() => { localLlm.refresh(); });
            }}
          >
            On-Device (No Sign-In)
          </Button>
          <Button
            variant={aiMode === "cloud" ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              void setAccountAiMode(runtime, "cloud").then(() => { localLlm.refresh(); });
              if (provider.can(useCloudEvent)) void provider.send(useCloudEvent);
            }}
          >
            Alpha Cloud
          </Button>
          <Button
            variant={aiMode === "own-key" ? "primary" : "secondary"}
            size="sm"
            onClick={() => {
              if (state.text) {
                void setAccountAiMode(runtime, "own-key").then(() => { localLlm.refresh(); });
                if (provider.can(useOwnEvent)) void provider.send(useOwnEvent);
              } else if (provider.can(openTextEvent)) {
                setKeyInput("");
                void provider.send(openTextEvent);
              }
            }}
          >
            Own API Key
          </Button>
        </div>
      </Card>

      <LocalModelsSection runtime={runtime} localLlm={localLlm} />

      <ListGroup heading="Saved keys">
        <ListRow
          title="Cerebras text key"
          detail={state.text ? "Saved on this device" : "Not set"}
          trailing={<StatusDot status={state.text ? "ok" : "off"} label={state.text ? "Saved" : "None"} showLabel />}
        />
        <div className="flex flex-wrap gap-2 px-4 py-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!provider.can(openTextEvent)}
            onClick={() => { setKeyInput(""); void provider.send(openTextEvent); }}
          >
            {state.text ? "Replace Cerebras key" : "Add Cerebras key"}
          </Button>
          {state.text ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!provider.can(removeTextEvent)}
              onClick={() => { void provider.send(removeTextEvent); }}
            >
              Remove Cerebras key
            </Button>
          ) : null}
        </div>

        <ListRow
          title="Voice key"
          detail={state.voice ? "Saved independently of Cerebras key" : "Not set"}
          trailing={<StatusDot status={state.voice ? "ok" : "off"} label={state.voice ? "Saved" : "None"} showLabel />}
        />
        <div className="flex flex-wrap gap-2 px-4 py-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={!provider.can(openVoiceEvent)}
            onClick={() => { setKeyInput(""); void provider.send(openVoiceEvent); }}
          >
            {state.voice ? "Change voice key" : "Add voice key"}
          </Button>
          {state.voice ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={!provider.can(removeVoiceEvent)}
              onClick={() => { void provider.send(removeVoiceEvent); }}
            >
              Remove voice key
            </Button>
          ) : null}
        </div>
      </ListGroup>

      {state.form ? (
        <Card className="space-y-3 p-4">
          <CardTitle>{state.kind === "VoiceKey" ? "Enter voice key" : "Enter Cerebras key"}</CardTitle>
          <div className="space-y-1.5">
            <Label htmlFor="account-provider-key">
              {state.kind === "VoiceKey" ? "Voice API key" : "Cerebras API key"}
            </Label>
            <Input
              id="account-provider-key"
              type="password"
              placeholder={state.kind === "VoiceKey" ? "vk-..." : "csk-..."}
              value={keyInput}
              onChange={(event) => setKeyInput(event.target.value)}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              loading={state.work === "CheckingKey"}
              disabled={keyInput.trim() === "" || !provider.can({ type: "enterKey", key: keyInput })}
              onClick={() => {
                const value = keyInput;
                setKeyInput("");
                void provider.send({ type: "enterKey", key: value });
              }}
            >
              Check key
            </Button>
            {state.work === "CheckingKey" ? (
              <Button variant="secondary" onClick={() => { void provider.send({ type: "withdrawKey" }); }}>
                Back
              </Button>
            ) : (
              <Button variant="secondary" onClick={() => { setKeyInput(""); void provider.send({ type: "closeKeyForm" }); }}>
                Cancel
              </Button>
            )}
          </div>
        </Card>
      ) : null}

      {state.work === "Waiting" ? (
        <Banner
          variant="info"
          action={<Button size="sm" variant="secondary" onClick={() => { void provider.send({ type: "stopWaiting" }); }}>Cancel</Button>}
        >
          Stopping the resident agent to apply your provider change…
        </Banner>
      ) : null}

      <ConfirmDialog
        open={state.choice.showing}
        title={state.offer === "UseCloud" ? "Switch to Alpha Cloud?" : state.offer === "UseVoice" ? "Save voice key?" : state.offer === "SaveText" ? "Save Cerebras key beside Cloud?" : "Use your Cerebras key?"}
        confirmLabel={state.offer === "UseVoice" ? "Save voice key" : state.offer === "SaveText" ? "Save key" : "Confirm"}
        onConfirm={() => { void provider.send({ type: "choose", busy: false, origin: "ByOwner", now: untimed }); }}
        onCancel={() => { void provider.send({ type: "decline" }); }}
      >
        <div className="space-y-2">
          <p>{offerDescription(state.offer)}</p>
          {provider.can({ type: "saveOnly" }) ? (
            <Button size="sm" variant="secondary" onClick={() => { void provider.send({ type: "saveOnly" }); }}>
              Save without switching from Cloud
            </Button>
          ) : null}
        </div>
      </ConfirmDialog>
    </div>
  );
}
