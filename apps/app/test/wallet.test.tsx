// @vitest-environment happy-dom
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import { Machine as Ledger } from "../gen/app__wallet.effect.vibe";
import { agents, own, readingOf } from "../gen/app__wallet.ts";
import { Machine as Sending } from "../gen/app__wallet__transfer.effect.vibe";
import type { Alpha } from "../src/runtime/area.tsx";
import wallet from "../src/wallet/index.tsx";
import { button, closeAll, drawn, fill, hardware, later, only, open, press, pressOnTop, seen, typeInto, underAct, until } from "./alpha.tsx";
import { type Scene, scene } from "./fakes/scene.ts";
import { agentAsks } from "./fakes/wallet.ts";

underAct();
afterEach(closeAll);

const ethereum = "0x52908400098527886E0F7030069857D2E4169EE7";
const friend = "0x8617E340B3D01FA5F11F306F4090FD50E238070D";
const payee = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

/** A world whose agent holds a wallet that is `custody`, in a browser or on a phone. */
function holding(phone: boolean, custody: Scene["wallet"]["custody"] = "ready"): Scene {
  const world = { ...scene(), phone };
  world.wallet.custody = custody;
  return world;
}

/** Alpha over `world` with Wallet on top, as its Home tile opens it; an Alpha that stopped there opens there again. */
async function opened(world: Scene) {
  const running = await open(world, only("view:Wallet"));
  const runtime = wallet.runtime(running.alpha);
  await drawn(() => running.alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => Effect.ignore(shell.send({ type: "openView", view: "Wallet" })))));
  const ledger = () => runtime.runPromise(Effect.flatMap(Ledger, (machine) => machine.get()));
  const sending = () => runtime.runPromise(Effect.flatMap(Sending, (machine) => machine.get()));
  return { ...running, runtime, ledger, sending };
}

/** The owner leaves Alpha and comes back: Wallet reads the agent's wallet again. */
async function returned(alpha: Alpha, runtime: ReturnType<typeof wallet.runtime>) {
  await seen(false);
  await seen(true);
  await until(alpha, runtime, Ledger, (s) => s.standing.status !== "Loading" && s.holdings.status !== "Loading" && s.desk.status !== "Loading" && s.activity.status !== "Loading");
}

/** Fill the send form and ask for its review. */
async function asked(recipient: string, amount: string) {
  await press("Send");
  await fill("Recipient", recipient);
  await fill("Amount", amount);
  await pressOnTop("Review");
}

const copiedText = (world: Scene) => (world.phone ? Promise.resolve(world.settings.copied.at(-1)) : navigator.clipboard.readText());

describe.each([["a browser", false], ["a phone", true]])("in %s", (_where, phone) => {
  it("Make my wallet (spec/app/wallet/index.md, \"Story: Make my wallet\")", async () => {
    const world = holding(phone, "none");
    world.wallet.storageKey = false;
    const { alpha, runtime, ledger } = await opened(world);
    // spec/app/wallet/index.md, "With no wallet, on a phone that can hold one, one action asks the agent to make it, once": a phone that gave the agent nothing to seal a wallet under is offered nothing.
    await until(alpha, runtime, Ledger, (s) => s.standing.status === "Loaded");
    expect([(await ledger()).custody, (await ledger()).canHold, Boolean(button("Make wallet"))]).toEqual(["NoWallet", false, false]);

    world.wallet.storageKey = true;
    await returned(alpha, runtime);
    await press("Make wallet");
    // spec/app/wallet/index.md, "A change the agent confirms is taken as the wallet's new standing; any other answer reads the wallet again"
    await until(alpha, runtime, Ledger, (s) => s.custody === "Ready" && s.holdings.status === "Loaded");
    const made = await ledger();
    expect([world.wallet.made.length, made.changing.outcome, made.accounts.map((account) => account.address)[0], Boolean(button("Make wallet"))]).toEqual([1, "Confirmed", ethereum, false]);
  });

  it("See what I hold (spec/app/wallet/index.md, \"Story: See what I hold\"; spec/app/wallet/index.md, \"Story: See what happened\")", async () => {
    const world = holding(phone);
    if (phone) world.voice.startupSignIn = {
      startEmail: () => Promise.resolve({ request: 1, attempt: 1, verdict: "code-on-its-way", expiresAt: world.now + 600_000, resendAt: world.now + 60_000 }),
      verify: ({ attempt }) => {
        world.signedIn = true;
        world.platform.agentCredentialMissing = false;
        return Promise.resolve({ request: 2, attempt, verdict: "signed-in-as", credentialId: world.voice.credentialId, google: "not-requested" });
      },
    };
    world.wallet.unread = ["solana"];
    world.wallet.operations.push(
      { intentId: "a", family: "evm", chainId: "1", asset: "native", symbol: "ETH", decimals: 18, atomicUnits: "1000000000000000000", recipient: friend, maximumFee: "1", reservedAt: 4, status: "pending", operationRef: "0x4" },
      { intentId: "b", family: "evm", chainId: "1", asset: "native", symbol: "ETH", decimals: 18, atomicUnits: "2", recipient: friend, maximumFee: "1", reservedAt: 3, status: "confirmed", operationRef: "0x3" },
      { intentId: "c", family: "evm", chainId: "1", asset: "native", symbol: "ETH", decimals: 18, atomicUnits: "3", recipient: friend, maximumFee: "1", reservedAt: 2, status: "failed", operationRef: "0x2" },
      { intentId: "d", family: "evm", chainId: "1", asset: "native", symbol: "ETH", decimals: 18, atomicUnits: "4", recipient: friend, maximumFee: "1", reservedAt: 1, status: "notSent", operationRef: "" },
    );
    const { alpha, runtime, ledger } = await opened(world);
    // spec/app/wallet/index.md, "A network that could not be read is shown as unread, never as empty, and nothing is shown as held on it"
    await until(alpha, runtime, Ledger, (s) => s.holdings.status === "Loaded" && s.activity.status === "Loaded");
    const first = await ledger();
    expect([first.held.map((held) => `${held.units} ${held.symbol}`), readingOf("Solana", first), readingOf("Evm", first)]).toEqual([["2500000000000000000 ETH"], "NotRead", "Something"]);
    // spec/app/wallet/index.md, "The past transfers are read for a wallet that serves, and only the newest asking's answer is taken"
    expect(first.past.map((past) => past.fate)).toEqual(["Pending", "Arrived", "Reverted", "NotSent"]);

    world.wallet.unread = [];
    world.wallet.operations[0] = { ...world.wallet.operations[0], status: "confirmed" };
    await returned(alpha, runtime);
    const second = await ledger();
    expect([second.held.map((held) => held.symbol), readingOf("Solana", second), second.past[0]?.fate]).toEqual([["ETH", "SOL"], "Something", "Arrived"]);

    // spec/app/wallet/index.md, "Only the newest asking's answer is taken; a failure keeps what was last read"
    if (phone) await press("Send");
    world.wallet.unreachable = true;
    await seen(false);
    await seen(true);
    await until(alpha, runtime, Ledger, (s) => s.standing.status === "Failed");
    expect([(await ledger()).held.length, Boolean(button("Try again"))]).toEqual([2, true]);
    if (phone) {
      const lastRead = (await ledger()).standing.ticket;
      world.wallet.unreachable = false;
      world.platform.agentCredentialMissing = true;
      await returned(alpha, runtime);
      await until(alpha, runtime, Ledger, (s) => s.standing.ticket > lastRead && s.standing.status === "Failed");
      expect(button("Sign in to Alpha")).toBeUndefined();
      world.signedIn = false;
      await returned(alpha, runtime);
      await until(alpha, runtime, Ledger, (s) => s.custody === "SignInRequired");
      await until(alpha, runtime, Sending, (s) => s.stage === "Closed");
      expect([(await ledger()).held, (await ledger()).accounts, button("Receive")]).toEqual([[], [], undefined]);
      await press("Sign in to Alpha");
      await vi.waitFor(() => expect(button("Email")).toBeDefined());
      await drawn(() => typeInto(document.querySelector<HTMLInputElement>('input[type="email"]')!, "owner@example.test"));
      await press("Send code");
      await vi.waitFor(() => expect(button("Verify code")).toBeDefined());
      await drawn(() => typeInto(document.querySelector<HTMLInputElement>("#account-signin-code")!, "123456"));
      await press("Verify code");
      await vi.waitFor(() => expect(world.signedIn).toBe(true));
      await later(alpha, 60_000);
    } else {
      world.wallet.unreachable = false;
      await press("Try again");
    }
    await until(alpha, runtime, Ledger, (s) => s.standing.status === "Loaded" && s.holdings.status === "Loaded");
  });

  it('Shows an unread network after a whole holdings failure (spec/app/wallet/index.md, "A network that could not be read is shown as unread, never as empty, and nothing is shown as held on it")', async () => {
    const world = holding(phone);
    world.wallet.holdings = [];
    world.wallet.holdingsUnreachable = true;
    const { alpha, runtime } = await opened(world);
    await until(alpha, runtime, Ledger, (s) => s.standing.status === "Loaded" && s.holdings.status === "Failed");
    const holdings = () => document.querySelector('[aria-label="Holdings"]')?.textContent ?? "";
    expect(holdings()).toMatch(/Ethereum\s*Could not be read/);
    expect(holdings()).toMatch(/Solana\s*Could not be read/);
    expect(holdings()).not.toMatch(/0\s*(ETH|SOL)/);

    world.wallet.holdingsUnreachable = false;
    await returned(alpha, runtime);
    expect(holdings()).toMatch(/0\s*ETH/);
    expect(holdings()).toMatch(/0\s*SOL/);
  });

  it("Receive (spec/app/wallet/index.md, \"Story: Receive\")", async () => {
    const world = holding(phone);
    const { alpha, runtime, ledger } = await opened(world);
    await until(alpha, runtime, Ledger, (s) => s.standing.status === "Loaded");
    await press("Receive");
    await until(alpha, runtime, Ledger, (s) => s.receiving);
    // spec/app/wallet/index.md, "Copy puts one of the wallet's own addresses on the clipboard, one copy at a time, and says whether it was copied"
    await pressOnTop("Copy Ethereum address");
    await until(alpha, runtime, Ledger, (s) => s.copy.status === "Loaded");
    expect([await copiedText(world), Boolean(button("Ethereum address copied")), document.querySelectorAll("svg[role=img][aria-label$='address as a QR code'] path").length]).toEqual([ethereum, true, 2]);
    // spec/app/wallet/index.md, "Receive opens over a wallet that serves and has an account, and closes when it no longer does": Back puts the address away and stays in Wallet.
    await hardware("back");
    await until(alpha, runtime, Ledger, (s) => !s.receiving);
    expect([(await ledger()).copy.status, (await alpha.runtime.runPromise(Effect.flatMap(Shell, (shell) => shell.get()))).trail]).toEqual(["Idle", ["Wallet"]]);
  });

  it("Send (spec/app/wallet/transfer.md, \"Story: Send\")", async () => {
    const world = holding(phone);
    const { alpha, runtime, ledger, sending } = await opened(world);
    await until(alpha, runtime, Ledger, (s) => s.holdings.status === "Loaded");

    // spec/app/wallet/transfer.md, "The owner asks for a transfer of an amount written exactly in the asset's own units, to a recipient, once": an amount finer than the asset is not asked for.
    await press("Send");
    await fill("Recipient", friend);
    await fill("Amount", "1.0000000000000000001");
    expect(button("Review")?.disabled).toBe(true);
    await fill("Amount", "1.5");
    await pressOnTop("Review");
    // spec/app/wallet/transfer.md, "The review shows the agent's exact terms for the request that was opened, and only the newest asking's answer is taken"
    await until(alpha, runtime, Sending, (s) => s.stage === "Reviewing");
    const { terms } = await sending();
    expect([world.wallet.askings, terms.request, terms.units, terms.recipient, terms.network, terms.fee, terms.expires - world.now])
      .toEqual([[{ family: "evm", recipient: friend, amount: "1.5" }], 1, "1500000000000000000", friend, "Ethereum", "21000000000000", 60_000]);

    // spec/app/wallet/transfer.md, "A decision ends as the agent says: submitted, signed but unresolved, declined, turned down, or unknown"
    await pressOnTop("Approve");
    await until(alpha, runtime, Sending, (s) => s.stage === "Closed" && s.said === "Submitted");
    await until(alpha, runtime, Ledger, (s) => s.desk.status === "Loaded" && s.past.length === 1);
    expect([world.wallet.decisions, (await ledger()).waiting, (await ledger()).past[0]?.fate]).toEqual([[{ id: 1, decision: "approve" }], [], "Pending"]);
    await press("OK");

    // spec/app/wallet/transfer.md, "A spent request stays spent, and is never opened for review or approved again": signed and not acknowledged, it is pending, and stays so where the agent still lists it.
    world.wallet.unresolved = true;
    await asked(friend, "0.25");
    await until(alpha, runtime, Sending, (s) => s.stage === "Reviewing");
    const unresolved = world.wallet.requests[0];
    await pressOnTop("Approve");
    await until(alpha, runtime, Sending, (s) => s.said === "Unresolved");
    world.wallet.requests.push(unresolved);
    await returned(alpha, runtime);
    expect([(await sending()).spent, (await ledger()).waiting.map((waiting) => waiting.id), Boolean(button(`Review 0.25 ETH to ${friend}`)), world.wallet.decisions.length])
      .toEqual([[1, 2], [2], false, 2]);
    // spec/app/wallet/transfer.md, "The owner declines a waiting request from the wallet's list or from its review, once"
    await press(`Decline 0.25 ETH to ${friend}`);
    await until(alpha, runtime, Sending, (s) => s.said === "Declined");
    await until(alpha, runtime, Ledger, (s) => s.desk.status === "Loaded" && s.waiting.length === 0);
    world.wallet.unresolved = false;

    // spec/app/wallet/transfer.md, "A request the agent took is opened for review at once; one it turned down leaves the form open, and an unknown answer closes it"
    world.wallet.refusal = "That is not an address on this chain.";
    await asked("not an address", "1");
    await until(alpha, runtime, Sending, (s) => s.stage === "Writing" && s.said === "TurnedDown");
    expect([(await sending()).why, world.wallet.requests]).toEqual(["That is not an address on this chain.", []]);
    await fill("Recipient", friend);
    await pressOnTop("Review");
    await until(alpha, runtime, Sending, (s) => s.stage === "Reviewing");
    const lapsing = (await sending()).terms;

    // spec/app/wallet/transfer.md, "A review lapses at the time the agent gave, and a lapsed review approves nothing"
    await later(alpha, 60_000);
    await until(alpha, runtime, Sending, (s) => s.stage === "Stale" && s.said === "Lapsed");
    expect([Boolean(button("Approve")), world.wallet.decisions.length]).toEqual([false, 3]);
    // spec/app/wallet/transfer.md, "A waiting request is opened for review when nothing else is under way, or afresh from its own stale review, unless it is spent"
    await pressOnTop("Review again");
    await until(alpha, runtime, Sending, (s) => s.stage === "Reviewing");
    const fresh = (await sending()).terms;
    expect([fresh.request, fresh.commitment === lapsing.commitment, fresh.expires - world.now]).toEqual([lapsing.request, false, 60_000]);

    // spec/app/wallet/transfer.md, "A decision ends as the agent says: submitted, signed but unresolved, declined, turned down, or unknown": an approval the agent turns down leaves the request to be opened afresh.
    world.wallet.refusal = "The transfer authority changed before signing.";
    await pressOnTop("Approve");
    await until(alpha, runtime, Sending, (s) => s.stage === "Stale" && s.said === "TurnedDown" && s.why === "The transfer authority changed before signing.");
    await pressOnTop("Review again");
    await until(alpha, runtime, Sending, (s) => s.stage === "Reviewing");
    await pressOnTop("Approve");
    await until(alpha, runtime, Sending, (s) => s.said === "Submitted");
    expect([world.wallet.decisions.slice(3), (await sending()).spent]).toEqual([[{ id: 3, decision: "approve" }, { id: 3, decision: "approve" }], [1, 2, 3]]);
  });

  it("Decide what my agent asked (spec/app/wallet/index.md, \"Story: Decide what my agent asked\"; spec/app/wallet/transfer.md, \"Story: Decide what my agent asked\")", async () => {
    const world = holding(phone);
    world.wallet.requests.push({ id: 1, family: "evm", asset: "native", symbol: "ETH", recipient: friend, amount: "1", asker: "owner" });
    world.wallet.issued = 1;
    agentAsks(world.wallet, { family: "solana", asset: "native", symbol: "SOL", recipient: payee, amount: "2" });
    agentAsks(world.wallet, { family: "solana", asset: "native", symbol: "SOL", recipient: payee, amount: "3" });
    const { alpha, runtime, ledger, sending } = await opened(world);
    await until(alpha, runtime, Ledger, (s) => s.desk.status === "Loaded");
    // spec/app/wallet/index.md, "The agent's requests are shown first, then the owner's own, each exactly as it was asked"
    const reviews = () => [...document.querySelectorAll("section[aria-label='Waiting for your decision'] button")].map((found) => found.getAttribute("aria-label") ?? "").filter((name) => name.startsWith("Review "));
    expect([agents(await ledger()).map((request) => request.id), own(await ledger()).map((request) => request.id), reviews()])
      .toEqual([[2, 3], [1], [`Review 2 SOL to ${payee}`, `Review 3 SOL to ${payee}`, `Review 1 ETH to ${friend}`]]);

    // spec/app/wallet/transfer.md, "A decision leaves Alpha only by the owner's approve or decline, and an asking only from the send form"
    await press(`Review 2 SOL to ${payee}`);
    await until(alpha, runtime, Sending, (s) => s.stage === "Reviewing");
    expect([(await sending()).terms.request, (await sending()).terms.units, world.wallet.decisions]).toEqual([2, "2000000000", []]);
    await pressOnTop("Approve");
    await until(alpha, runtime, Sending, (s) => s.said === "Submitted");
    await until(alpha, runtime, Ledger, (s) => s.desk.status === "Loaded" && s.waiting.length === 2);

    // spec/app/wallet/transfer.md, "The owner declines a waiting request from the wallet's list or from its review, once": a request the wallet cannot cover is told in the agent's words, and is declined without a review.
    world.wallet.refusal = "This wallet holds too little SOL for the transfer and its network fee.";
    await press(`Review 3 SOL to ${payee}`);
    await until(alpha, runtime, Sending, (s) => s.stage === "Stale" && s.said === "TurnedDown");
    expect([(await sending()).why, Boolean(button("Approve"))]).toEqual(["This wallet holds too little SOL for the transfer and its network fee.", false]);
    await pressOnTop("Decline");
    await until(alpha, runtime, Sending, (s) => s.said === "Declined");
    await until(alpha, runtime, Ledger, (s) => s.desk.status === "Loaded" && s.waiting.length === 1);
    expect([world.wallet.decisions, world.wallet.operations.map((operation) => operation.recipient)])
      .toEqual([[{ id: 2, decision: "approve" }, { id: 3, decision: "decline" }], [payee]]);
  });

  it("Switch the wallet off and on (spec/app/wallet/index.md, \"Story: Switch the wallet off and on\")", async () => {
    const world = holding(phone);
    agentAsks(world.wallet, { family: "evm", asset: "native", symbol: "ETH", recipient: friend, amount: "1" });
    const { alpha, runtime, ledger } = await opened(world);
    await until(alpha, runtime, Ledger, (s) => s.holdings.status === "Loaded" && s.desk.status === "Loaded");
    await press("Turn wallet off");
    // spec/app/wallet/index.md, "A wallet that is absent or off shows no account, holding, request or past transfer, and reads none"
    await until(alpha, runtime, Ledger, (s) => s.custody === "Off");
    const off = await ledger();
    expect([off.accounts, off.held, off.waiting, Boolean(button("Send")), Boolean(button("Receive")), Boolean(button("Turn on"))]).toEqual([[], [], [], false, false, true]);
    // spec/app/wallet/index.md, "The owner switches off a wallet that serves and on one that is off, one change at a time"
    await press("Turn on");
    await until(alpha, runtime, Ledger, (s) => s.custody === "Ready" && s.holdings.status === "Loaded" && s.desk.status === "Loaded");
    const on = await ledger();
    expect([on.accounts[0]?.address, on.held.length, on.waiting.length, world.wallet.custody]).toEqual([ethereum, 2, 1, "ready"]);
  });

  it("A decision sent when Alpha stops is never sent again (spec/app/wallet/transfer.md, \"When Alpha opens again, the form and any review are closed, and an asking or a decision that was sent is unknown\")", async () => {
    const world = holding(phone);
    agentAsks(world.wallet, { family: "evm", asset: "native", symbol: "ETH", recipient: friend, amount: "1" });
    const first = await opened(world);
    await until(first.alpha, first.runtime, Ledger, (s) => s.desk.status === "Loaded");
    await press(`Review 1 ETH to ${friend}`);
    await until(first.alpha, first.runtime, Sending, (s) => s.stage === "Reviewing");
    world.wallet.stalled = true;
    await pressOnTop("Approve");
    await until(first.alpha, first.runtime, Sending, (s) => s.stage === "Deciding");
    await vi.waitFor(() => expect(world.wallet.decisions).toEqual([{ id: 1, decision: "approve" }]));
    await first.close();

    world.wallet.stalled = false;
    const second = await opened(world);
    await until(second.alpha, second.runtime, Sending, (s) => s.said === "Unsure");
    await until(second.alpha, second.runtime, Ledger, (s) => s.desk.status === "Loaded");
    const reopened = await second.sending();
    expect([reopened.stage, reopened.deciding.outcome, reopened.spent, world.wallet.decisions, Boolean(button(`Review 1 ETH to ${friend}`))])
      .toEqual(["Closed", "Unknown", [1], [{ id: 1, decision: "approve" }], false]);
    // spec/app/wallet/transfer.md, "The owner declines a waiting request from the wallet's list or from its review, once": a spent request that still waits can be taken off the list, which sends nothing.
    await press(`Decline 1 ETH to ${friend}`);
    await until(second.alpha, second.runtime, Sending, (s) => s.said === "Declined");
    expect([world.wallet.decisions.at(-1), world.wallet.operations]).toEqual([{ id: 1, decision: "decline" }, []]);
  });
});
