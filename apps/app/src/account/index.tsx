// spec/app/account/billing.md, "The plans and their prices are read from Cloud, and only the newest reading is taken"; spec/app/settings/index.md, "Each page links to what another area owns there"; spec/app/shell/layers.md, "Story: Keep a sheet or a dialog above the phone"; spec/kit/read.md, "Story: Read from outside"
import { AuthMark, Button, cn, Dialog, DialogContent, DialogTitle, Input, Sheet, SheetContent, Spinner, StatusDot } from "@repo/ui";
import { ChevronDown, RotateCw, Ticket, X } from "lucide-react";
import { normalizeSubscriptionCode, type SnapshotSubscription } from "@elizaos/cloud";
import { Effect, Exit, Layer } from "effect";
import { type ReactNode, useCallback, useRef, useState, useSyncExternalStore } from "react";
import type * as Billing from "../../gen/app__account__billing.effect.vibe";
import { useMachine as useCodes } from "../../gen/app__account__codes.react.ts";
import { useMachine as useBilling } from "../../gen/app__account__billing.react.ts";
import { useMachine as useSettings } from "../../gen/app__settings.react.ts";
import { useMachine } from "../../gen/app__shell__layers.react.ts";
import { listed, top } from "../../gen/app__shell__layers.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import { showing } from "../../gen/app__shell.ts";
import {
  AI_MODE_KEY,
  type AiMode,
  parseAiMode,
  readStoredAiMode,
  subscribeSharedPreferences,
} from "../platform/index.vibe";
import { area, type Alpha, type Area, type Resident, type Shown } from "../runtime/ui.tsx";
import { AccountPanel } from "./AccountPanel.tsx";
import { accountMachines } from "./account.vibe";
import { checkout, choosePurchase, recheckPlan, tierOf } from "./billing.vibe";
import { accountAccess, checkCodePlan, codes, readReferral, referralCode, submitCode } from "./codes.vibe";
import { managePlan } from "./change.vibe";
import { ManagePlan } from "./ManagePlan.tsx";
import { type AccountWrites, accountLayer, accountWrites, closeCatalog, openCatalog, type Catalog, type Profile, type ProfileShelf, profileLive, profileShelf, settingsIsInFront } from "./profile.vibe";

const usd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" });
const planDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
type CodeRuntime = Layer.Success<ReturnType<typeof codes>> | AccountWrites;

const credits = (micros: number) => usd.format(micros / 1_000_000);
const roundUsd = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const price = (cents: number) => (cents % 100 === 0 ? roundUsd : usd).format(cents / 100);

/** Account balance and allowance as returned by the current Cloud plan read. */
function AccountPlan({ plan }: { plan: NonNullable<Extract<Profile, { tag: "Read" }>["plan"]> }) {
  if (plan.tag === "CheckingPlan") return <Spinner label="Reading Cloud plan" className="text-muted-foreground" />;
  if (plan.tag === "PlanUnavailable") return <p role="status" className="text-sm text-muted-foreground">Cloud plan unavailable</p>;
  return (
    <dl aria-label="Cloud plan" className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
      <div>
        <dt className="text-muted-foreground">Balance</dt>
        <dd className="text-base font-semibold">{credits(plan.balanceMicros)}</dd>
      </div>
      <div>
        <dt className="text-muted-foreground">Plan</dt>
        <dd className="text-base font-semibold">{plan.name}
          {plan.paymentDue ? <span className="block text-sm font-normal text-muted-foreground">Payment due</span> : null}
        </dd>
      </div>
      {plan.allowance ? <div className="col-span-2">
        <dt className="text-muted-foreground">Usage</dt>
        <dd>{credits(plan.allowance.availableMicros)} remaining · Resets {planDate.format(plan.allowance.resetsAt)}</dd>
      </div> : null}
    </dl>
  );
}

/** The account read in the open sheet, in the form Cloud confirmed. */
function AccountDetails({ profile }: { profile: Profile }) {
  if (profile.tag === "Reading") return <Spinner label="Reading account" className="text-muted-foreground" />;
  if (profile.tag === "SignInRequired") return <p role="status" className="text-sm text-muted-foreground">Sign-in required</p>;
  if (profile.tag === "Unavailable") return <p role="status" className="text-sm text-muted-foreground">Couldn’t read your account</p>;
  return (
    <div className="min-w-0 wrap-anywhere">
      <p className="text-sm text-muted-foreground">{profile.contact || profile.name || "Signed in"}</p>
      {profile.contact && profile.name && profile.contact !== profile.name ? <p className="text-sm text-muted-foreground">{profile.name}</p> : null}
      {profile.plan ? <AccountPlan plan={profile.plan} /> : null}
    </div>
  );
}

/** The offers the owner can inspect in the open Account sheet. */
type CheckoutRuntime = Layer.Success<ReturnType<typeof checkout>>;
type PlanRuntime = Layer.Success<ReturnType<typeof managePlan>>;

function Plans({ runtime, shelf, canSubscribe, subscription }: {
  runtime: Shown<Resident | CheckoutRuntime | CodeRuntime | PlanRuntime>["runtime"];
  shelf: ProfileStore;
  canSubscribe: boolean;
  subscription: SnapshotSubscription | undefined;
}) {
  const { state, can, send } = useBilling(runtime);
  const catalog = useSyncExternalStore(shelf.subscribe, shelf.catalog, shelf.catalog);
  const offers = catalog && state?.offers.status === "Loaded" && state.offers.ticket === catalog.ticket ? catalog.offers : undefined;
  const failed = state?.offers.status === "Failed";
  const selected = state?.review;
  const shown = catalog && selected?.tag === "PurchaseReview" && catalog.ticket === selected.ticket
    ? offers?.find((offer) => tierOf(offer) === selected.tier) : undefined;
  const closeReview = { type: "closePurchaseReview" } as const;
  return (
    <details aria-busy={state?.offers.status === "Loading" || undefined} className="group mt-4 border-t border-border pt-3" onToggle={(event) => {
      runtime.runFork(event.currentTarget.open ? openCatalog() : closeCatalog(shelf.publishCatalog));
    }}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        View plans
        <ChevronDown aria-hidden className="size-4 group-open:rotate-180" />
      </summary>
      {offers?.length ? (
        <ul aria-label="Plans" className="grid gap-3 pb-1">
          {offers.map((offer) => {
            const review = { type: "reviewPlan", tier: tierOf(offer), ticket: catalog?.ticket ?? 0 } as const;
            const allowance = /^\d+(?:\.\d+)?$/.test(offer.allowance.amountUsd) ? Number(offer.allowance.amountUsd) : Number.NaN;
            return (
              <li key={offer.key} className="grid gap-1 rounded-tile border border-border p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <strong className="text-lg font-semibold">{offer.name}</strong>
                  <span className="text-sm">{price(offer.amountCents)}<span className="text-muted-foreground">/month</span></span>
                </div>
                {Number.isFinite(allowance) ? <p className="text-sm text-muted-foreground">{price(Math.round(allowance * 100))} of AI usage each month</p> : null}
                {canSubscribe && catalog?.buyer && !shown && can(review)
                  ? <Button className="mt-2" aria-label={`Review ${offer.name} subscription`} onClick={() => void send(review)}>Subscribe</Button> : null}
              </li>
            );
          })}
        </ul>
      ) : failed || offers ? <p role="status" className="text-sm text-muted-foreground">{failed ? "Plans unavailable" : "No plans available"}</p>
        : <Spinner label="Reading plans" className="text-muted-foreground" />}
      {subscription && catalog?.buyer && offers ? <ManagePlan key={subscription.id} runtime={runtime} subscription={subscription} offers={offers} refresh={shelf.refresh} /> : null}
      {canSubscribe && shown && catalog && selected?.tag === "PurchaseReview" ? (
        <section aria-label="Review subscription" className="mt-3 grid gap-2 rounded-tile border border-border p-4">
          <p className="text-sm font-medium">{shown.name} · {price(shown.amountCents)}/month</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => void send(closeReview)}>Not now</Button>
            <Button onClick={() => runtime.runFork(choosePurchase(catalog, shown, selected.number, shelf.refresh))}>Continue to Stripe</Button>
          </div>
        </section>
      ) : null}
    </details>
  );
}

const notices: Record<Billing.Notice, string> = {
  Quiet: "",
  PlanActive: "Payment confirmed",
  NotYetPaid: "Payment not yet confirmed",
  CheckoutExpired: "Checkout expired",
  ConfirmUnknown: "Payment status unconfirmed",
  CheckoutUnavailable: "Checkout unavailable",
};

function PurchaseStatus({ runtime }: { runtime: Shown<Resident | CheckoutRuntime>["runtime"] }) {
  const { state, can, send } = useBilling(runtime);
  if (!state) return null;
  const stop = { type: "stopWaiting", now: 0 } as const;
  const check = { type: "checkPayment", now: 0 } as const;
  if (!state.visit.open && !notices[state.notice] && !can(check)) return null;
  return (
    <div className="mt-2 grid gap-1">
      {notices[state.notice] ? <p role="status" className="text-sm">{notices[state.notice]}</p> : null}
      {state.visit.open && state.notice === "Quiet"
        ? <p role="status" className="text-sm">{state.checkout.session ? "Waiting for Stripe" : "Opening Stripe"}</p> : null}
      {can(stop) ? <Button variant="ghost" onClick={() => void send(stop)}>Stop waiting</Button> : null}
      {can(check) ? <Button variant="ghost" onClick={() => void send(check)}>Check payment status</Button> : null}
      {state.unsettled ? <Button variant="ghost" onClick={() => runtime.runFork(recheckPlan())}>Refresh plan</Button> : null}
    </div>
  );
}
const readingProfile: Profile = { tag: "Reading" };

interface ProfileStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => Profile;
  readonly catalog: () => Catalog | undefined;
  readonly refresh: () => void;
  readonly publishCatalog: (value: Catalog | undefined) => void;
}

const profileStores = new WeakMap<Alpha, ProfileStore>();

function profileStoreFor(alpha: Alpha): ProfileStore {
  let held = profileStores.get(alpha);
  if (held !== undefined) return held;
  const listeners = new Set<() => void>();
  let live: ProfileShelf | undefined;
  let unsubscribeLive: (() => void) | undefined;
  let connecting = false;
  let currentProfile: Profile = readingProfile;
  let currentCatalog: Catalog | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const attach = (shelf: ProfileShelf) => {
    live = shelf;
    currentProfile = shelf.snapshot();
    currentCatalog = shelf.catalog();
    unsubscribeLive?.();
    unsubscribeLive = shelf.subscribe(() => {
      currentProfile = shelf.snapshot();
      currentCatalog = shelf.catalog();
      notify();
    });
    notify();
  };

  const immediate = alpha.runtime.runSyncExit(profileShelf);
  if (Exit.isSuccess(immediate)) {
    attach(immediate.value);
  }

  const ensureConnected = () => {
    if (live !== undefined || connecting) return;
    connecting = true;
    void alpha.runtime.runPromise(profileShelf).then(
      (shelf) => {
        connecting = false;
        attach(shelf);
      },
      () => {
        connecting = false;
      },
    );
  };

  held = {
    subscribe: (listener) => {
      listeners.add(listener);
      ensureConnected();
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot: () => (live ? live.snapshot() : currentProfile),
    catalog: () => (live ? live.catalog() : currentCatalog),
    refresh: () => {
      if (live) {
        live.refresh();
      } else {
        void alpha.runtime.runPromise(profileShelf).then((shelf) => {
          attach(shelf);
          shelf.refresh();
        }, () => undefined);
      }
    },
    publishCatalog: (value) => {
      currentCatalog = value;
      live?.publishCatalog(value);
    },
  };
  profileStores.set(alpha, held);
  return held;
}

interface AiModeStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => AiMode | undefined;
}

const aiModeStores = new WeakMap<Alpha, AiModeStore>();

function aiModeStoreFor(alpha: Alpha): AiModeStore {
  let held = aiModeStores.get(alpha);
  if (held !== undefined) return held;
  const listeners = new Set<() => void>();
  let current: AiMode | undefined;
  let hydrated = false;
  let stopPrefs: (() => void) | undefined;

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const syncMode = alpha.runtime.runSyncExit(readStoredAiMode());
  if (Exit.isSuccess(syncMode)) {
    current = syncMode.value;
    hydrated = true;
  }

  held = {
    subscribe: (listener) => {
      listeners.add(listener);
      if (!hydrated) {
        hydrated = true;
        void alpha.runtime.runPromise(readStoredAiMode()).then((mode) => {
          if (mode !== current) {
            current = mode;
            notify();
          }
        }, () => undefined);
      }
      if (stopPrefs === undefined) {
        stopPrefs = subscribeSharedPreferences((change) => {
          if (change.key !== AI_MODE_KEY) return;
          const next = parseAiMode(change.value);
          if (next !== current) {
            current = next;
            notify();
          }
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopPrefs?.();
          stopPrefs = undefined;
        }
      };
    },
    snapshot: () => current,
  };
  aiModeStores.set(alpha, held);
  return held;
}

/** The verified account shown below the Account row in Settings. */
export function AccountStatus({ alpha }: { alpha: Alpha }) {
  const shelf = profileStoreFor(alpha);
  const modeStore = aiModeStoreFor(alpha);
  const current = useSyncExternalStore(shelf.subscribe, shelf.snapshot, shelf.snapshot);
  const aiMode = useSyncExternalStore(modeStore.subscribe, modeStore.snapshot, modeStore.snapshot);
  if (current.tag === "Reading") return null;
  const localActive = current.tag === "SignInRequired" && aiMode === "local";
  const ok = current.tag === "Read" || localActive;
  const label = current.tag === "Read"
    ? current.contact || "Signed in"
    : localActive
      ? "On-device AI"
      : current.tag === "SignInRequired"
        ? "Signed out"
        : "Account unavailable";
  return <StatusDot status={ok ? "ok" : "off"} label={label} showLabel
    className={cn("flex gap-3 text-caption leading-normal text-muted-foreground [&_circle]:fill-current [&_circle]:stroke-none [&_svg]:size-2 [&_svg]:text-current", ok && "[&_svg]:text-status-ok")} />;
}

/** The browser's account recovery page is contained in Alpha's phone canvas. */
function BrowserAccount({ open, reading, inbox, retry, close }: { open: boolean; reading: boolean; inbox: boolean; retry: () => void; close: () => void }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const openerRef = useRef<Element | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const connect = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      const document = node.ownerDocument;
      const page = document.querySelector("[data-alpha-shell-page]");
      const active = document.activeElement;
      const connectCloud = '[data-focus-key="inbox-connect-cloud"]';
      openerRef.current = inbox && active?.matches(`${connectCloud}, input[type=search]`) && page?.contains(active) ? active
        : page?.querySelector(inbox ? connectCloud : 'button[data-settings-row="account"]') ?? null;
    }
    setHost(node);
  }, [inbox]);
  return (
    <div ref={connect} className="pointer-events-none absolute inset-0 z-sheet">
      {host && <Dialog open={open} onOpenChange={(shown) => { if (!shown) close(); }}>
        <DialogContent ref={panelRef} container={host} overlayClassName="absolute bg-black/24 dark:bg-black/24"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => { event.preventDefault(); panelRef.current?.focus({ preventScroll: true }); }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            const opener = openerRef.current;
            if (opener instanceof HTMLElement && opener.isConnected && opener.ownerDocument.activeElement === opener.ownerDocument.body && !opener.closest("[inert], [hidden]")) {
              opener.focus({ preventScroll: true });
            }
          }}
          className="absolute inset-x-0 top-auto bottom-0 max-h-full max-w-120 translate-y-0 gap-0 overflow-auto rounded-t-sheet rounded-b-none bg-background px-5.5 pt-5 pb-7 text-foreground">
          <AuthMark className="mb-6" />
          <DialogTitle className="mb-7 font-sans text-panel-title font-semibold">Alpha</DialogTitle>
          {reading
            ? <Spinner label="Reading account" className="mb-3 text-muted-foreground" />
            : <p role="alert" className="mb-3 rounded-sm bg-status-error/12 p-3 text-sm leading-status text-status-error">Unavailable</p>}
          <Button variant="ghost" className="h-11.5 w-full gap-3 rounded-lg px-3 py-2.5 text-base leading-snug font-medium text-primary hover:bg-transparent"
            onClick={retry} disabled={reading}><RotateCw aria-hidden className="size-5.5" />Try again</Button>
          <Button variant="ghost" className="mt-5 h-11 w-full rounded-full text-base leading-snug font-medium text-muted-foreground hover:bg-transparent" onClick={close}>Back</Button>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

// spec/app/account/codes.md, "Story: Redeem a code"
function AccountCodes({ runtime }: Pick<Shown<Resident | CheckoutRuntime | CodeRuntime | PlanRuntime>, "runtime">) {
  const { state } = useCodes(runtime);
  const billing = useBilling(runtime).state;
  if (state === undefined || billing === undefined) return null;
  const sending = state.redeem.outcome === "Sent" || state.apply.outcome === "Sent";
  const ownCodeExit = state.referral.status === "Loaded" ? runtime.runSyncExit(referralCode(state.authority)) : undefined;
  const ownCode = ownCodeExit && Exit.isSuccess(ownCodeExit) ? ownCodeExit.value : undefined;
  const busy = sending || state.unsettled || billing.unsettled || billing.pending || billing.visit.open || billing.visit.orphan;
  const message = state.notice === "Redeemed" ? "Code redeemed" : state.notice === "NotRedeemed" ? "The code couldn’t be redeemed."
    : state.notice === "ReferralApplied" ? "Referral applied."
    : state.notice === "ReferralInvalid" ? "That referral code is invalid."
    : state.notice === "ReferralUsed" ? "A referral was already applied."
    : state.notice === "ReferralRefused" ? "The referral couldn’t be applied."
    : state.notice === "OutcomeUnknown" ? "Alpha couldn’t confirm the outcome. Check your plan before using another code." : "";
  return (
    <details className="rounded-lg border px-3 py-2">
      <summary className="flex min-h-9 cursor-pointer items-center gap-2 rounded-sm text-sm font-medium">
        <Ticket aria-hidden className="size-4" />Redeem code
      </summary>
      <form className="flex flex-col gap-3 pt-2" onSubmit={(event) => {
        event.preventDefault();
        const input = event.currentTarget.elements.namedItem("subscriptionCode");
        if (!(input instanceof HTMLInputElement)) return;
        const code = normalizeSubscriptionCode(input.value);
        if (code === null) {
          input.setCustomValidity("Enter a valid redemption code.");
          input.reportValidity();
          return;
        }
        const entered = input.value;
        void runtime.runPromise(submitCode(code)).then((sent) => { if (sent && input.value === entered) input.value = ""; });
      }}>
        <label className="flex flex-col gap-1 text-sm">
          Code
          <Input aria-label="Redemption code" name="subscriptionCode" maxLength={64} autoComplete="off" spellCheck={false} required disabled={busy}
            onInput={(event) => event.currentTarget.setCustomValidity("")} />
        </label>
        <Button type="submit" disabled={busy}>{sending ? "Redeeming…" : "Redeem"}</Button>
        {message !== "" && <p role="status" className="text-sm text-muted-foreground">{message}</p>}
        {state.unsettled && <Button type="button" variant="ghost" onClick={() => runtime.runFork(checkCodePlan())}>Check plan</Button>}
      </form>
      <details className="mt-4 border-t pt-3">
        <summary className="min-h-9 cursor-pointer rounded-sm text-sm font-medium">Referral</summary>
        {ownCode !== undefined ? <p className="select-all text-sm">Your referral code <strong>{ownCode}</strong></p> : (
          <Button type="button" variant="ghost" onClick={() => runtime.runFork(readReferral())} disabled={state.referral.status === "Loading"}>
            {state.referral.status === "Loading" ? "Reading referral…" : "Show my referral code"}
          </Button>
        )}
        {state.referral.status === "Failed" && <p role="status" className="text-sm">Referral unavailable</p>}
        <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => {
          event.preventDefault();
          const input = event.currentTarget.elements.namedItem("referral");
          if (!(input instanceof HTMLInputElement)) return;
          const entered = input.value;
          void runtime.runPromise(submitCode(entered, "applyReferral")).then((sent) => { if (sent && input.value === entered) input.value = ""; });
        }}>
          <label className="flex flex-col gap-1 text-sm">Friend’s code<Input name="referral" maxLength={100} autoComplete="off" required disabled={busy} /></label>
          <Button type="submit" variant="secondary" disabled={busy}>Apply referral</Button>
        </form>
      </details>
    </details>
  );
}

/** Styled bottom sheet container hosting the Account area above Settings or Inbox. */
export function AccountSheetFrame({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <SheetContent
        title="Account"
        className="max-h-dvh max-w-105 gap-2.5 before:hidden bg-background px-6.5 pt-9 pb-[max(--spacing(7),var(--alpha-safe-bottom))] text-foreground [&_h2]:flex [&_h2]:min-h-12 [&_h2]:items-center [&_h2]:text-title"
        actions={<Button variant="secondary" className="mt-2 rounded-lg" onClick={onClose}>Done</Button>}
      >
        <span aria-hidden className="absolute inset-x-0 top-3 mx-auto h-1 w-8 rounded-full bg-border" />
        <Button variant="ghost" size="icon" aria-label="Close Account" className="absolute top-9 right-6.5 size-12" onClick={onClose}><X /></Button>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** The account sheet above Settings or Inbox, drawing the details the account read returned. */
export default {
  open(alpha, place) {
    const profile = profileStoreFor(alpha);
    function AccountSheet({ runtime }: Shown<Resident | CheckoutRuntime | CodeRuntime | PlanRuntime>) {
      const { state, can, send } = useMachine(runtime);
      const { state: settings } = useSettings(runtime);
      const { state: shell } = useShell(runtime);
      const shown = useSyncExternalStore(profile.subscribe, profile.snapshot, profile.snapshot);
      if (!state || !listed(state, accountLayer)) return null;
      const close = { type: "closeLayer", id: accountLayer } as const;
      const onClose = () => { if (can(close)) void send(close); };
      const open = top(state).id === accountLayer;
      const settingsAccount = shell !== undefined && settings !== undefined && settingsIsInFront(shell, settings);
      if (settingsAccount && alpha.slot("settings/account") !== undefined) return null;
      if (settings?.told && !settings.phone && shown.tag !== "Read") {
        return <BrowserAccount open={open} reading={shown.tag === "Reading"} inbox={shell !== undefined && showing(shell, "Inbox")} retry={profile.refresh} close={onClose} />;
      }
      return (
        <AccountSheetFrame open={open} onClose={onClose}>
          <AccountDetails profile={shown} />
          {settingsAccount && shown.tag === "Read" && shown.purchase === "Matches" ? <PurchaseStatus runtime={runtime} /> : null}
          {settingsAccount && shown.tag === "Read" ? <Plans runtime={runtime} shelf={profile}
            canSubscribe={shown.plan?.tag === "PlanRead" && shown.plan.name === "No plan"}
            subscription={shown.plan?.tag === "PlanRead" ? shown.plan.subscription : undefined}
          /> : null}
          {settingsAccount && shown.tag === "Read" && shown.codesAvailable ? <AccountCodes runtime={runtime} /> : null}
        </AccountSheetFrame>
      );
    }
    const accountLayerLive = Layer.unwrap(Effect.map(profileShelf, (liveProfile) => Layer.provideMerge(
      profileLive(liveProfile.publish, liveProfile.publishCatalog, liveProfile.refreshed, accountAccess),
      Layer.mergeAll(
        accountWrites,
        managePlan(liveProfile.refresh),
        Layer.provideMerge(codes(liveProfile.refresh), checkout(liveProfile.refresh, liveProfile.publishCatalog)),
      ),
    )));
    return area(accountLayerLive, AccountSheet).open(alpha, place);
  },
} satisfies Area;

const accountAreaMap = new WeakMap<Alpha, ReturnType<typeof area<Layer.Success<typeof accountMachines>, never>>>();

function accountAreaFor(alpha: Alpha) {
  let held = accountAreaMap.get(alpha);
  if (!held) {
    const profile = profileStoreFor(alpha);
    held = area(accountMachines, ({ runtime }) => {
      const layers = useMachine(runtime);
      const shown = useSyncExternalStore(profile.subscribe, profile.snapshot, profile.snapshot);
      if (!layers.state || !listed(layers.state, accountLayer)) return null;
      const close = { type: "closeLayer", id: accountLayer } as const;
      return (
        <AccountSheetFrame open={top(layers.state).id === accountLayer} onClose={() => { if (layers.can(close)) void layers.send(close); }}>
          <AccountPanel runtime={runtime} profile={shown} onRefresh={profile.refresh} />
        </AccountSheetFrame>
      );
    });
    accountAreaMap.set(alpha, held);
  }
  return held;
}

/** Exposes the account area's managed runtime for tests and Settings embedding. */
export function accountRuntime(alpha: Alpha) {
  return accountAreaFor(alpha).runtime(alpha);
}

/** Overlay Account area rendering the full Account panel inside a sheet. */
export const accountPanelOverlay: Area = {
  open(alpha, place) {
    return accountAreaFor(alpha).open(alpha, place);
  },
};

/** Settings-embedded Account area rendered at the `settings/account` slot. */
export const accountSettingsArea: Area = {
  open(alpha) {
    const profile = profileStoreFor(alpha);
    const runtime = accountRuntime(alpha);
    return function AccountEmbedded() {
      const shown = useSyncExternalStore(profile.subscribe, profile.snapshot, profile.snapshot);
      return <AccountPanel runtime={runtime} profile={shown} onRefresh={profile.refresh} />;
    };
  },
};
