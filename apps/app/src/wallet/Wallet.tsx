// spec/app/wallet/index.md, "Story: Make my wallet"; spec/app/wallet/index.md, "Story: See what I hold"; spec/app/wallet/index.md, "Story: Decide what my agent asked"; spec/app/wallet/index.md, "Story: See what happened"; spec/app/wallet/index.md, "Story: Switch the wallet off and on"
import { Alert, Banner, Button, EmptyState, ListGroup, ListRow, Spinner, StatusDot, WalletAmount } from "@repo/ui";
import type { ManagedRuntime } from "effect";
import { ArrowDownLeft, ArrowUpRight, Bot, PowerOff, Wallet as WalletIcon, X } from "lucide-react";
import type { Machine } from "../../gen/app__wallet.effect.vibe";
import { type Account, type Fate, type Past, type Request, agents, own, readingOf } from "../../gen/app__wallet.ts";
import { useMachine } from "../../gen/app__wallet.react.ts";
import type { Machine as Sending, Said } from "../../gen/app__wallet__transfer.effect.vibe";
import { useMachine as useTransfer } from "../../gen/app__wallet__transfer.react.ts";
import { type Alpha, useTimed } from "../runtime/ui.tsx";
import { accountRuntime } from "../account/index.tsx";
import { SignInView } from "../account/SignInView.tsx";
import { useMachine as useSignIn } from "../../gen/app__account__signIn.react.ts";
import type { Time } from "../runtime/index.vibe";
import type { Ledger, Transferring } from "./machines.ts";
import { Receive } from "./Receive.tsx";
import { Review } from "./Review.tsx";
import { Send } from "./Send.tsx";
import { shownUnits } from "@elizaos/plugin-wallet-client";

export interface WalletProps {
  alpha: Alpha;
  /** Provides the wallet and the transfer under way, `wallet` and `transfer` of this area, and Alpha's time, at which `can` is asked. */
  runtime: ManagedRuntime.ManagedRuntime<Machine | Sending | Time, unknown>;
}

const fates: Record<Fate, { status: "off" | "busy" | "ok" | "error"; label: string }> = {
  NotSent: { status: "off", label: "Not sent" },
  Pending: { status: "busy", label: "Pending" },
  Arrived: { status: "ok", label: "Confirmed" },
  Reverted: { status: "error", label: "Failed" },
};

const told: Record<Exclude<Said, "Quiet" | "Lapsed">, { variant: "ok" | "info" | "warn"; words: string }> = {
  Submitted: { variant: "ok", words: "Sent" },
  Unresolved: { variant: "warn", words: "Signed, not yet confirmed. It is pending." },
  Declined: { variant: "info", words: "Declined" },
  TurnedDown: { variant: "warn", words: "The wallet turned this down" },
  Unsure: { variant: "warn", words: "Alpha cannot tell whether this was sent. It will not be sent again." },
};

const day = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

const terms = (request: Request) => `${request.amount} ${request.symbol} to ${request.recipient}`;

/** What the last transfer came to, until the owner has read it. */
function Outcome({ sending }: { sending: Transferring }) {
  const { said } = sending.state;
  const acknowledge = { type: "acknowledge" } as const;
  if (said === "Quiet" || said === "Lapsed" || !sending.can(acknowledge)) return null;
  return (
    <Alert variant={told[said].variant}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">{sending.state.why === "" ? told[said].words : sending.state.why}</span>
        <Button size="sm" variant="ghost" onClick={() => void sending.send(acknowledge)}>OK</Button>
      </div>
    </Alert>
  );
}

/** The requests that wait for the owner: the agent's first, each with its review and the way to decline it. */
function Desk({ ledger, sending }: { ledger: Ledger; sending: Transferring }) {
  const waiting = [...agents(ledger.state), ...own(ledger.state)];
  if (waiting.length === 0) return null;
  return (
    <ListGroup aria-label="Waiting for your decision">
      {waiting.map((request) => {
        const review = { type: "openReview", request: request.id } as const;
        const decline = { type: "decline", request: request.id } as const;
        const spent = sending.state.spent.includes(request.id);
        const declining = sending.state.stage === "Deciding" && !sending.state.approving && sending.state.request === request.id;
        return (
          <ListRow
            key={request.id}
            leading={request.asker === "AgentAsks" ? <Bot /> : undefined}
            title={<>{request.asker === "AgentAsks" && <span className="sr-only">Asked by your agent: </span>}<WalletAmount amount={request.amount} symbol={request.symbol} /></>}
            detail={request.recipient}
            trailing={(
              <>
                {(spent || declining) && <StatusDot status="busy" label={declining ? "Declining" : "Pending"} />}
                {sending.can(review) && <Button size="sm" variant="secondary" aria-label={`Review ${terms(request)}`} onClick={() => void sending.send(review)}>Review</Button>}
                {sending.can(decline) && <Button size="icon" variant="ghost" aria-label={`Decline ${terms(request)}`} onClick={() => void sending.send(decline)}><X /></Button>}
              </>
            )}
          />
        );
      })}
    </ListGroup>
  );
}

/** What one account holds: its amounts, or that its network could not be read, never an empty account in its place. */
function Holdings({ ledger, account }: { ledger: Ledger; account: Account }) {
  const reading = readingOf(account.family, ledger.state);
  if (reading === "NotRead" || (reading === "Nothing" && ledger.state.holdings.status === "Failed")) {
    return <ListRow title={account.network} trailing={<StatusDot status="warn" label="Could not be read" showLabel />} />;
  }
  if (!account.connected) return <ListRow title={account.network === "" ? account.symbol : account.network} trailing={<StatusDot status="off" label="No network" />} />;
  if (reading === "Nothing") return <ListRow title={<WalletAmount amount="0" symbol={account.symbol} />} detail={account.network} />;
  return (
    <>
      {ledger.state.held.filter((holding) => holding.family === account.family).map((holding) => (
        <ListRow key={holding.asset} title={<WalletAmount amount={shownUnits(holding.units, holding.decimals)} symbol={holding.symbol} />} detail={account.network} />
      ))}
    </>
  );
}

function Transfers({ past }: { past: readonly Past[] }) {
  if (past.length === 0) return null;
  return (
    <ListGroup aria-label="Past transfers">
      {past.map((transfer) => (
        <ListRow
          key={transfer.intent}
          title={<WalletAmount amount={shownUnits(transfer.units, transfer.decimals)} symbol={transfer.symbol} />}
          detail={transfer.recipient}
          trailing={<><span>{day.format(transfer.at)}</span><StatusDot status={fates[transfer.fate].status} label={fates[transfer.fate].label} /></>}
        />
      ))}
    </ListGroup>
  );
}

/** A wallet that serves: what waits for a decision first, then what is held, then what happened, with Send and Receive above them. */
function Serving({ ledger, sending }: { ledger: Ledger; sending: Transferring }) {
  const { state, can, send } = ledger;
  const compose = { type: "compose" } as const;
  const receive = { type: "receive" } as const;
  const off = { type: "switchWallet", wanted: false } as const;
  const sends = state.accounts.some((account) => account.canSend);
  return (
    <>
      {state.custody === "Unavailable" && <Banner variant="warn">This wallet&apos;s keys cannot be opened right now</Banner>}
      <Outcome sending={sending} />
      <div className="flex gap-2 *:flex-1">
        {sends && sending.can(compose) && <Button onClick={() => void sending.send(compose)}><ArrowUpRight />Send</Button>}
        {can(receive) && <Button variant="secondary" onClick={() => void send(receive)}><ArrowDownLeft />Receive</Button>}
      </div>
      <Desk ledger={ledger} sending={sending} />
      {state.holdings.status === "Failed" && <Alert variant="warn">What the wallet holds could not be read</Alert>}
      {state.holdings.status === "Loading" && state.held.length === 0 && state.unread.length === 0
        ? <Spinner label="Reading what the wallet holds" className="self-center" />
        : (
          <ListGroup aria-label="Holdings">
            {state.accounts.map((account) => <Holdings key={account.family} ledger={ledger} account={account} />)}
          </ListGroup>
        )}
      <Transfers past={state.past} />
      {can(off) && <Button variant="ghost" className="self-center" onClick={() => void send(off)}><PowerOff />Turn wallet off</Button>}
    </>
  );
}

function WalletSignIn({ alpha }: { alpha: Alpha }) {
  const runtime = accountRuntime(alpha);
  const signIn = useSignIn(runtime);
  const begin = { type: "begin", origin: "ByOwner" } as const;
  if (signIn.state && signIn.state.step !== "Closed") return <SignInView runtime={runtime} />;
  return (
    <EmptyState icon={<WalletIcon />} title="Sign in to use Wallet">
      <Button disabled={!signIn.can(begin)} onClick={() => void signIn.send(begin)}>Sign in to Alpha</Button>
    </EmptyState>
  );
}

/**
 * The owner's wallet, as the resident agent holds it: the way to make one, or that this phone cannot hold one; a
 * wallet that is off and the way to turn it on; or what waits, what is held and what happened, with each control
 * offered exactly when the rules allow its event.
 * @model spec/app/wallet/index.md
 */
export function Wallet({ runtime, alpha }: WalletProps) {
  const ledger = useMachine(runtime);
  const sending = useTimed(runtime, useTransfer);
  if (ledger.cause || sending.cause) return <Alert variant="destructive" className="m-4">Alpha could not read its wallet</Alert>;
  if (!ledger.state || !sending.state) return null;
  const { state, can, send } = ledger;
  const held = { ...ledger, state };
  const under = { ...sending, state: sending.state };
  const make = { type: "make" } as const;
  const on = { type: "switchWallet", wanted: true } as const;
  const refresh = { type: "refresh" } as const;
  const read = state.standing.status === "Loaded";
  const refused = state.changing.outcome === "Refused";
  return (
    <section aria-label="Wallet" className="flex flex-1 flex-col gap-4 px-4 pt-2 pb-28">
      {state.standing.status === "Failed" && (
        <Banner variant="warn" action={can(refresh) && <Button size="sm" variant="secondary" onClick={() => void send(refresh)}>Try again</Button>}>
          The wallet did not answer
        </Banner>
      )}
      {state.custody === "SignInRequired" && <WalletSignIn alpha={alpha} />}
      {refused && <Alert variant="warn">{state.change === "Making" ? "The wallet could not be made" : "The wallet could not be switched"}</Alert>}
      {state.custody === "NoWallet" && !read && state.standing.status !== "Failed" && <Spinner label="Reading the wallet" className="self-center" />}
      {state.custody === "NoWallet" && read && (
        <EmptyState icon={<WalletIcon />} title={state.canHold ? "No wallet yet" : "This phone cannot hold a wallet"}>
          {(can(make) || (state.canHold && state.change === "Making" && state.changing.outcome === "Sent")) && (
            <Button loading={!can(make)} onClick={() => void send(make)}>Make wallet</Button>
          )}
        </EmptyState>
      )}
      {state.custody === "Off" && (
        <EmptyState icon={<PowerOff />} title="Wallet is off">
          {(can(on) || state.changing.outcome === "Sent") && <Button loading={!can(on)} onClick={() => void send(on)}>Turn on</Button>}
        </EmptyState>
      )}
      {(state.custody === "Ready" || state.custody === "Unavailable") && <Serving ledger={held} sending={under} />}
      {state.receiving && <Receive ledger={held} />}
      {state.custody !== "SignInRequired" && (under.state.stage === "Writing" || under.state.stage === "Asking") && <Send ledger={held} sending={under} />}
      {state.custody !== "SignInRequired" && (under.state.stage === "Opening" || under.state.stage === "Reviewing" || under.state.stage === "Stale" || (under.state.stage === "Deciding" && under.state.approving)) && <Review sending={under} />}
    </section>
  );
}
