// spec/app/account/session.md, "Story: Hold the account signed in"; spec/app/account/session.md, "Story: Sign out"; spec/app/account/session.md, "Story: Renew my sign-in"
import { Banner, Button, Card, CardTitle, ConfirmDialog, Spinner, StatusDot, Tabs, TabsContent, TabsList, TabsTrigger } from "@repo/ui";
import { renewOffered, type Trouble as SessionTrouble } from "../../gen/app__account__session.ts";
import { useMachine as useSession } from "../../gen/app__account__session.react.ts";
import { useMachine as useSignIn } from "../../gen/app__account__signIn.react.ts";
import type { AiMode } from "../platform/index.vibe";
import { untimed } from "../runtime/index.vibe";
import { BillingView } from "./BillingView.tsx";
import { GoogleView } from "./GoogleView.tsx";
import type { Profile } from "./profile.vibe";
import { ProviderView } from "./ProviderView.tsx";
import { RecordsView } from "./RecordsView.tsx";
import { SignInView } from "./SignInView.tsx";
import { type AccountRuntime, currentMillis, setAccountAiMode, useAccountShelf, useAccountTimed } from "./useAccount.ts";

const sessionTroubles: Partial<Record<SessionTrouble, string>> = {
  NotStored: "Couldn’t store that sign-in. Your previous session was kept.",
  NotSignedOut: "Couldn’t sign out right now. You’re still signed in.",
  NotRead: "Couldn’t read your saved sign-in from the device.",
  Unconfirmed: "Couldn’t confirm the account change. Checking saved sign-in…",
};

/** Verified Cloud profile read summary matching Settings's account read contract. */
function VerifiedProfileSummary({ profile, aiMode }: { readonly profile: Profile; readonly aiMode: AiMode }) {
  switch (profile.tag) {
    case "Reading":
      return <Spinner label="Reading account" className="text-muted-foreground" />;
    case "SignInRequired":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {aiMode === "local" ? "On-device AI active · Alpha Cloud sign-in optional" : "Sign-in required"}
        </p>
      );
    case "Unavailable":
      return (
        <p role="status" className="text-sm text-muted-foreground">
          {aiMode === "local" ? "On-device AI active · Alpha Cloud offline" : "Couldn’t read your account"}
        </p>
      );
    case "Read": {
      const primary = profile.contact || profile.name || "Signed in";
      const secondary = profile.contact && profile.name && profile.contact !== profile.name ? profile.name : undefined;
      return (
        <div className="min-w-0 wrap-anywhere">
          <p className="text-sm text-muted-foreground">{primary}</p>
          {secondary ? <p className="text-sm text-muted-foreground">{secondary}</p> : null}
        </div>
      );
    }
  }
}

/** Full Account panel combining Session, Sign-In, Plan & Billing, AI Provider, Google, and Resident Agent controls. */
export function AccountPanel({
  runtime,
  profile,
  onRefresh,
}: {
  readonly runtime: AccountRuntime;
  readonly profile: Profile;
  readonly onRefresh?: () => void;
}) {
  const session = useAccountTimed(runtime, useSession);
  const signIn = useAccountTimed(runtime, useSignIn);
  const shelf = useAccountShelf(runtime);

  const sesState = session.state;
  const sigState = signIn.state;
  const nowMs = currentMillis(runtime);
  const signedIn = sesState !== undefined && sesState.account > 0 && sesState.known;
  const showRenew = sesState !== undefined && renewOffered(sesState, nowMs);
  const troubleText = sesState ? sessionTroubles[sesState.trouble] : undefined;
  const beginEvent = { type: "begin", origin: "ByOwner" } as const;
  const localMode = shelf.aiMode === "local";

  return (
    <div className="space-y-3 overflow-y-auto">
      <VerifiedProfileSummary profile={profile} aiMode={shelf.aiMode} />

      {sesState && sesState.notice === "SignedOut" ? (
        <Banner
          variant="info"
          action={<Button size="sm" variant="ghost" onClick={() => { void session.send({ type: "dismissNotice" }); }}>Dismiss</Button>}
        >
          You’ve signed out of Alpha Cloud.
        </Banner>
      ) : null}

      {sesState && sesState.notice === "Ended" ? (
        <Banner
          variant="warn"
          action={<Button size="sm" variant="ghost" onClick={() => { void session.send({ type: "dismissNotice" }); }}>Dismiss</Button>}
        >
          Your Alpha Cloud sign-in ended. Sign in again to continue using Cloud services.
        </Banner>
      ) : null}

      {sesState && sesState.devices ? (
        <Banner
          variant="warn"
          action={<Button size="sm" variant="ghost" onClick={() => { void session.send({ type: "dismissDevices" }); }}>Dismiss</Button>}
        >
          Your earlier sign-in couldn’t be confirmed as ended. Check your signed-in devices.
        </Banner>
      ) : null}

      {troubleText ? (
        <Banner
          variant="destructive"
          action={sesState && session.can({ type: "readAgain" }) ? (
            <Button size="sm" variant="secondary" onClick={() => { void session.send({ type: "readAgain" }); }}>Try again</Button>
          ) : undefined}
        >
          {troubleText}
        </Banner>
      ) : null}

      {sigState && sigState.step !== "Closed" ? (
        <SignInView runtime={runtime} />
      ) : (
        <Tabs defaultValue="overview" className="space-y-3">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="billing">Billing</TabsTrigger>
            <TabsTrigger value="provider">AI</TabsTrigger>
            <TabsTrigger value="google">Google</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-3">
            <Card className="space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <CardTitle>Alpha Cloud session</CardTitle>
                <StatusDot
                  status={signedIn || localMode ? "ok" : "off"}
                  label={signedIn ? "Signed in" : localMode ? "On-device AI" : "Signed out"}
                  showLabel
                />
              </div>
              {signedIn && profile.tag !== "SignInRequired" && shelf.identity ? (
                <p className="text-sm text-muted-foreground">{shelf.identity.email || shelf.identity.phone || shelf.identity.userId}</p>
              ) : localMode ? (
                <p className="text-sm text-muted-foreground">Running locally on this phone with {shelf.localModel}. Sign in to Alpha Cloud anytime for Cloud models or billing.</p>
              ) : null}
              {showRenew ? (
                <Banner variant="warn">Your sign-in expires soon. Renew it to stay connected.</Banner>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {!signedIn || showRenew ? (
                  <Button
                    size="sm"
                    disabled={!signIn.can(beginEvent)}
                    onClick={() => { void signIn.send(beginEvent); }}
                  >
                    {showRenew ? "Renew sign-in" : "Sign in"}
                  </Button>
                ) : null}
                {!signedIn && !localMode ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      void setAccountAiMode(runtime, "local", shelf.localModel).then(() => { onRefresh?.(); });
                    }}
                  >
                    Use on-device AI
                  </Button>
                ) : null}
                {signedIn && session.can({ type: "askSignOut" }) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => { void session.send({ type: "askSignOut" }); }}
                  >
                    Sign out
                  </Button>
                ) : null}
                {onRefresh ? (
                  <Button size="sm" variant="ghost" onClick={onRefresh}>
                    Refresh
                  </Button>
                ) : null}
              </div>
            </Card>
            <RecordsView runtime={runtime} />
          </TabsContent>

          <TabsContent value="billing">
            <BillingView runtime={runtime} />
          </TabsContent>

          <TabsContent value="provider">
            <ProviderView runtime={runtime} />
          </TabsContent>

          <TabsContent value="google">
            <GoogleView runtime={runtime} />
          </TabsContent>
        </Tabs>
      )}

      <ConfirmDialog
        open={Boolean(sesState?.leave.showing)}
        title="Sign out of Alpha Cloud?"
        confirmLabel="Confirm sign out"
        cancelLabel="Keep signed in"
        destructive
        onConfirm={() => {
          void session.send({ type: "confirmSignOut", busy: false, now: untimed }).then(() => { onRefresh?.(); });
        }}
        onCancel={() => { void session.send({ type: "keepSignedIn" }); }}
      >
        Signing out stops the resident agent briefly and removes your saved Alpha Cloud sign-in from this phone.
      </ConfirmDialog>
    </div>
  );
}
