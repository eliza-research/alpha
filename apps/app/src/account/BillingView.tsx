// spec/app/account/plan.md, "Story: Know my plan"; spec/app/account/billing.md, "Story: Pay in the browser"; spec/app/account/change.md, "Story: Change or cancel my plan"; spec/app/account/codes.md, "Story: Redeem a code"; spec/app/account/codes.md, "Story: Share or apply a referral"
import { Banner, Button, Card, CardTitle, ConfirmDialog, Input, Label, ListGroup, ListRow, StatusDot } from "@repo/ui";
import { useState } from "react";
import type { Notice as BillingNotice } from "../../gen/app__account__billing.ts";
import { useMachine as useBilling } from "../../gen/app__account__billing.react.ts";
import type { Notice as ChangeNotice } from "../../gen/app__account__change.ts";
import { useMachine as useChange } from "../../gen/app__account__change.react.ts";
import type { Notice as CodesNotice } from "../../gen/app__account__codes.ts";
import { useMachine as useCodes } from "../../gen/app__account__codes.react.ts";
import { aiOn, type Standing } from "../../gen/app__account__plan.ts";
import { useMachine as usePlan } from "../../gen/app__account__plan.react.ts";
import { currentSignIn } from "../../gen/app__account__session.ts";
import { useMachine as useSession } from "../../gen/app__account__session.react.ts";
import { untimed } from "../runtime/index.vibe";
import type { PlanOffer } from "@elizaos/cloud";
import type { InvoiceEntry } from "./bridge.vibe";
import { formatDate, formatUsdCents, formatUsdMicros } from "./phone.ts";
import { type AccountRuntime, openAccountExternal, useAccountShelf, useAccountTimed } from "./useAccount.ts";

const standingLabels: Record<Standing, string> = {
  Checking: "Checking plan…",
  Member: "Active plan",
  Funded: "Credits active",
  Unfunded: "No active plan (AI off)",
  Grace: "Kept offline (7-day grace window)",
  Lapsed: "Plan check expired",
  Unavailable: "Plan unavailable",
  Rejected: "Sign-in refused",
  Declined: "Billing attention required (AI off)",
};

const billingNotices: Partial<Record<BillingNotice, string>> = {
  PlanActive: "Payment confirmed. Your plan is active.",
  NotYetPaid: "Checkout isn’t paid yet. Return to Stripe or check again.",
  CheckoutExpired: "That checkout expired.",
  ConfirmUnknown: "Alpha couldn’t confirm checkout yet. Checking your plan…",
};

const changeNotices: Partial<Record<ChangeNotice, string>> = {
  Changed: "Your plan has been updated.",
  ChangesAtRenewal: "Your plan will change at the next renewal.",
  Ending: "Your plan is set to end at the end of the current period.",
  Continues: "Your plan will continue as scheduled.",
  FinishPayment: "Finish payment on Stripe’s invoice page to complete the change.",
  NotFinished: "Your plan change is still processing.",
  NotChanged: "Your plan wasn’t changed.",
  PlanMoved: "Your plan changed before confirming. Refreshing plan…",
  OutcomeUnknown: "Couldn’t confirm the plan change. Checking your plan…",
  ConfirmItIsYou: "Confirm it’s you before changing your plan.",
};

const codesNotices: Partial<Record<CodesNotice, string>> = {
  Redeemed: "Code redeemed successfully.",
  NotRedeemed: "That code couldn’t be redeemed.",
  ReferralApplied: "Referral code applied.",
  ReferralInvalid: "That referral code wasn’t recognized.",
  ReferralUsed: "A referral code has already been applied.",
  ReferralRefused: "That referral code couldn’t be applied.",
  OutcomeUnknown: "Couldn’t confirm that code. Checking your plan…",
};

/** Gift/promo code redemption and referral sharing/application card. */
function CodesCard({ runtime, signIn, elsewhere }: { readonly runtime: AccountRuntime; readonly signIn: number; readonly elsewhere: boolean }) {
  const codes = useAccountTimed(runtime, useCodes);
  const shelf = useAccountShelf(runtime);
  const [redeemInput, setRedeemInput] = useState("");
  const [referralInput, setReferralInput] = useState("");
  const codeState = codes.state;
  if (!codeState) return null;

  return (
    <Card className="space-y-3 p-4">
      <CardTitle>Gift & referral codes</CardTitle>
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="account-redeem-code">Redeem code</Label>
          <Input
            id="account-redeem-code"
            placeholder="GIFT-XXXX"
            value={redeemInput}
            onChange={(event) => setRedeemInput(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          loading={codeState.redeem.outcome === "Sent"}
          disabled={!codes.can({ type: "redeem", code: redeemInput.trim(), signIn, origin: "ByOwner", elsewhere })}
          onClick={() => {
            const value = redeemInput.trim();
            setRedeemInput("");
            void codes.send({ type: "redeem", code: value, signIn, origin: "ByOwner", elsewhere });
          }}
        >
          Redeem
        </Button>
      </div>

      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor="account-referral-code">Friend’s referral code</Label>
          <Input
            id="account-referral-code"
            placeholder="FRIEND-2026"
            value={referralInput}
            onChange={(event) => setReferralInput(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="secondary"
          loading={codeState.apply.outcome === "Sent"}
          disabled={!codes.can({ type: "applyReferral", code: referralInput.trim(), signIn, origin: "ByOwner", elsewhere })}
          onClick={() => {
            const value = referralInput.trim();
            setReferralInput("");
            void codes.send({ type: "applyReferral", code: value, signIn, origin: "ByOwner", elsewhere });
          }}
        >
          Apply referral
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">
          {shelf.referral ? `Your referral code: ${shelf.referral.code} (${shelf.referral.total_referrals} used)` : "Share your referral code"}
        </span>
        <Button
          size="sm"
          variant="ghost"
          disabled={!codes.can({ type: "readReferral", signIn })}
          onClick={() => { void codes.send({ type: "readReferral", signIn }); }}
        >
          Load referral
        </Button>
      </div>
    </Card>
  );
}

/** Plan offers list and Stripe invoice history cards. */
function OffersAndInvoices({
  runtime,
  offers,
  invoices,
  offersTicket,
  billing,
}: {
  readonly runtime: AccountRuntime;
  readonly offers: ReadonlyArray<PlanOffer>;
  readonly invoices: ReadonlyArray<InvoiceEntry>;
  readonly offersTicket: number;
  readonly billing: ReturnType<typeof useBilling>;
}) {
  return (
    <>
      {offers.length > 0 ? (
        <ListGroup heading="Plans">
          {offers.map((offer) => {
            const tier = offer.key === "pro_monthly" ? "Pro" : "Plus";
            const reviewEvent = { type: "reviewPlan", tier, ticket: offersTicket } as const;
            return (
              <ListRow
                key={offer.key}
                title={`${offer.name} — ${formatUsdCents(offer.amountCents)}/${offer.interval}`}
                detail={`Monthly allowance: $${offer.allowance.amountUsd}`}
                trailing={
                  <Button
                    size="sm"
                    disabled={!billing.can(reviewEvent)}
                    onClick={() => { void billing.send(reviewEvent); }}
                  >
                    Subscribe
                  </Button>
                }
              />
            );
          })}
        </ListGroup>
      ) : null}

      {invoices.length > 0 ? (
        <ListGroup heading="Invoices">
          {invoices.map((inv) => (
            <ListRow
              key={inv.id}
              title={inv.number ?? inv.id}
              detail={`${formatDate(inv.date)} · ${inv.status}`}
              trailing={(
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{formatUsdCents(inv.amountPaidCents || inv.amountDueCents)}</span>
                  {inv.hostedInvoiceUrl ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const url = inv.hostedInvoiceUrl;
                        if (url) void openAccountExternal(runtime, url);
                      }}
                    >
                      Open
                    </Button>
                  ) : null}
                </div>
              )}
            />
          ))}
        </ListGroup>
      ) : null}
    </>
  );
}

/** Plan standing, checkout, invoices, plan changes, gift/promo code redemption, and referrals view. */
export function BillingView({ runtime }: { readonly runtime: AccountRuntime }) {
  const session = useAccountTimed(runtime, useSession);
  const plan = useAccountTimed(runtime, usePlan);
  const billing = useAccountTimed(runtime, useBilling);
  const change = useAccountTimed(runtime, useChange);
  const codes = useAccountTimed(runtime, useCodes);
  const shelf = useAccountShelf(runtime);
  const [fundsAmount, setFundsAmount] = useState("20");

  const sesState = session.state;
  const planState = plan.state;
  const billState = billing.state;
  const chgState = change.state;
  const codeState = codes.state;
  if (!sesState || !planState || !billState || !chgState || !codeState) return null;

  const signIn = currentSignIn(sesState);
  const isMember = planState.standing === "Member";
  const localAiActive = shelf.aiMode === "local" && !aiOn(planState);
  const otherTier = planState.tier === "Pro" ? "Plus" : "Pro";
  const billingBusy = billState.visit.open || billState.unsettled || billState.confirm.outcome === "Sent";
  const changeBusy = chgState.step !== "Idle" || chgState.unsettled || chgState.leave.showing;
  const codesBusy = codeState.redeem.outcome === "Sent" || codeState.apply.outcome === "Sent" || codeState.unsettled;
  const parsedFunds = Math.round(Number(fundsAmount));
  const review = billState.review.tag === "PurchaseReview" ? billState.review : undefined;
  const reviewedOffer = review
    ? shelf.offers.find((offer) => (offer.key === "pro_monthly" ? "Pro" : "Plus") === review.tier)
    : undefined;
  const chooseReviewedEvent = review
    ? ({
        type: "choosePlan",
        tier: review.tier,
        reviewed: review.number,
        signIn,
        standing: planState.standing,
        origin: "ByOwner",
        elsewhere: changeBusy || codesBusy,
        now: untimed,
      } as const)
    : undefined;

  return (
    <div className="space-y-3">
      <Card className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{isMember ? `Alpha ${planState.tier}` : "Alpha Cloud Plan"}</CardTitle>
          <StatusDot
            status={aiOn(planState) || localAiActive ? "ok" : planState.standing === "Checking" ? "busy" : "warn"}
            label={aiOn(planState) ? "AI on" : localAiActive ? "On-device AI" : "AI off"}
            showLabel
          />
        </div>
        <p className="text-sm text-muted-foreground">
          {localAiActive
            ? "Running locally on this phone. An Alpha Cloud plan is optional."
            : standingLabels[planState.standing]}
        </p>
        {planState.standing === "Grace" && planState.kept.until > 0 ? (
          <p className="text-caption text-muted-foreground">Offline grace until {formatDate(planState.kept.until)}</p>
        ) : null}
        {planState.usage >= 0 ? (
          <p className="text-caption text-muted-foreground">Allowance used: {planState.usage}%</p>
        ) : null}
        {shelf.snapshot ? (
          <p className="text-caption text-muted-foreground">Credits balance: {formatUsdMicros(shelf.snapshot.balance.usdMicros)}</p>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={!plan.can({ type: "checkNow", signIn })}
            onClick={() => { void plan.send({ type: "checkNow", signIn }); }}
          >
            Check plan
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={!billing.can({ type: "askOffers", signIn })}
            onClick={() => { void billing.send({ type: "askOffers", signIn }); }}
          >
            Load plans & invoices
          </Button>
          {isMember && !planState.ending ? (
            <>
              <Button
                size="sm"
                disabled={!change.can({ type: "reviewChange", tier: otherTier, member: isMember, tierNow: planState.tier, revision: planState.revision, authorized: shelf.billingAuthorized, elsewhere: billingBusy || codesBusy })}
                onClick={() => { void change.send({ type: "reviewChange", tier: otherTier, member: isMember, tierNow: planState.tier, revision: planState.revision, authorized: shelf.billingAuthorized, elsewhere: billingBusy || codesBusy }); }}
              >
                Switch to {otherTier}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!change.can({ type: "askCancel", member: isMember, ending: planState.ending, elsewhere: billingBusy || codesBusy })}
                onClick={() => { void change.send({ type: "askCancel", member: isMember, ending: planState.ending, elsewhere: billingBusy || codesBusy }); }}
              >
                Cancel plan
              </Button>
            </>
          ) : null}
          {isMember && planState.ending ? (
            <Button
              size="sm"
              disabled={!change.can({ type: "keepPlan", member: isMember, ending: planState.ending, revision: planState.revision, authorized: shelf.billingAuthorized, elsewhere: billingBusy || codesBusy })}
              onClick={() => { void change.send({ type: "keepPlan", member: isMember, ending: planState.ending, revision: planState.revision, authorized: shelf.billingAuthorized, elsewhere: billingBusy || codesBusy }); }}
            >
              Keep plan
            </Button>
          ) : null}
        </div>
      </Card>

      {billingNotices[billState.notice] ? (
        <Banner
          variant={billState.notice === "PlanActive" ? "info" : "warn"}
          action={<Button size="sm" variant="ghost" onClick={() => { void billing.send({ type: "dismissNotice" }); }}>Dismiss</Button>}
        >
          {billingNotices[billState.notice]}
        </Banner>
      ) : null}

      {changeNotices[chgState.notice] ? (
        <Banner
          variant={chgState.notice === "Changed" || chgState.notice === "Continues" || chgState.notice === "ChangesAtRenewal" || chgState.notice === "Ending" ? "info" : "warn"}
          action={<Button size="sm" variant="ghost" onClick={() => { void change.send({ type: "dismissNotice" }); }}>Dismiss</Button>}
        >
          {changeNotices[chgState.notice]}
        </Banner>
      ) : null}

      {codesNotices[codeState.notice] ? (
        <Banner
          variant={codeState.notice === "Redeemed" || codeState.notice === "ReferralApplied" ? "info" : "warn"}
          action={<Button size="sm" variant="ghost" onClick={() => { void codes.send({ type: "dismissNotice" }); }}>Dismiss</Button>}
        >
          {codesNotices[codeState.notice]}
        </Banner>
      ) : null}

      {billState.visit.open ? (
        <Banner
          variant="info"
          action={<Button size="sm" variant="secondary" onClick={() => { void billing.send({ type: "stopWaiting", now: untimed }); }}>Check status</Button>}
        >
          Waiting for Stripe checkout to finish in your browser…
        </Banner>
      ) : null}

      {billState.review.tag === "PurchaseReview" && chooseReviewedEvent ? (
        <Card className="space-y-3 p-4">
          <CardTitle>
            Review {reviewedOffer ? `${reviewedOffer.name} (${formatUsdCents(reviewedOffer.amountCents)}/${reviewedOffer.interval})` : `Alpha ${billState.review.tier}`}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Continue in your browser to finish checkout on Stripe. Alpha returns here automatically when payment settles.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { void billing.send({ type: "closePurchaseReview" }); }}
            >
              Not now
            </Button>
            <Button
              size="sm"
              disabled={!billing.can(chooseReviewedEvent)}
              onClick={() => { void billing.send(chooseReviewedEvent); }}
            >
              Continue to Stripe
            </Button>
          </div>
        </Card>
      ) : null}

      <OffersAndInvoices
        runtime={runtime}
        offers={shelf.offers}
        invoices={shelf.invoices}
        offersTicket={billState.offers.ticket}
        billing={billing}
      />

      <Card className="space-y-3 p-4">
        <CardTitle>Add credits</CardTitle>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="account-funds-amount">Amount ($5 – $1000)</Label>
            <Input
              id="account-funds-amount"
              inputMode="numeric"
              value={fundsAmount}
              onChange={(event) => setFundsAmount(event.target.value)}
            />
          </div>
          <Button
            size="sm"
            disabled={!Number.isFinite(parsedFunds) || !billing.can({ type: "addFunds", amount: parsedFunds, signIn, origin: "ByOwner", elsewhere: changeBusy || codesBusy, now: untimed })}
            onClick={() => { void billing.send({ type: "addFunds", amount: parsedFunds, signIn, origin: "ByOwner", elsewhere: changeBusy || codesBusy, now: untimed }); }}
          >
            Add funds
          </Button>
        </div>
      </Card>

      <CodesCard runtime={runtime} signIn={signIn} elsewhere={billingBusy || changeBusy} />

      <ConfirmDialog
        open={chgState.step === "Quoted" && chgState.change.showing}
        title={`Switch to Alpha ${chgState.target}?`}
        confirmLabel="Confirm change"
        cancelLabel="Not now"
        onConfirm={() => { void change.send({ type: "confirmChange", now: untimed, authorized: shelf.billingAuthorized }); }}
        onCancel={() => { void change.send({ type: "notNow" }); }}
      >
        {shelf.quote
          ? `Due now: ${formatUsdCents(shelf.quote.review.dueNow.amountDueCents)}. Recurring estimate: ${formatUsdCents(shelf.quote.review.recurringEstimate.amountDueCents)}/month.`
          : "Confirm your quoted plan change."}
      </ConfirmDialog>

      <ConfirmDialog
        open={chgState.leave.showing}
        title="Cancel your plan?"
        confirmLabel="Confirm cancellation"
        cancelLabel="Keep plan"
        destructive
        onConfirm={() => { void change.send({ type: "cancelPlan", revision: planState.revision, authorized: shelf.billingAuthorized }); }}
        onCancel={() => { void change.send({ type: "keepCancelling" }); }}
      >
        {planState.until > 0
          ? `Your plan will remain active until ${formatDate(planState.until)}.`
          : "Your plan will end at the end of the current billing period."}
      </ConfirmDialog>
    </div>
  );
}
