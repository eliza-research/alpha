# Wallet

The owner's wallet, which the resident agent holds on this phone: its keys
are made and sealed there and never reach this page. Wallet shows what the
agent says of it: whether there is one, its accounts, what they hold, the
transfers that wait for the owner's decision and the ones already decided.
The owner makes the wallet, switches it off and on, and reads an address
to be paid at. Nothing here asks for a key or a seed phrase, and nothing
imports or exports one.

- [Transfer](./transfer.md): one transfer at a time: the owner's own send, the review of its exact terms, and the decision sent once

## Story: Make my wallet

> As the owner, I want to make my wallet with one action when I have none,
> and to be told plainly when this phone cannot hold one.

### Wallet holds what the agent last said of the wallet, the change it was last asked to make, and each list as last read

A wallet is absent, ready, off, or held with keys this launch cannot open.
An account is of one family, with its address, the network it is on and
that network's own coin. A holding is an amount of one asset, in the
asset's smallest units, written as digits. A request is a transfer that
waits for the owner. A past transfer is one the owner approved, with how
it ended.

```quint
import read as R from "../../kit/read"
import attempt as A from "../../kit/attempt"

type Family = Evm | Solana
type Custody = NoWallet | Ready | Off | Unavailable | SignInRequired
type Account = { family: Family, address: str, network: str, symbol: str, decimals: int, connected: bool, canSend: bool }
type Holding = { family: Family, asset: str, symbol: str, decimals: int, units: str }
type Asker = OwnerAsks | AgentAsks
type Request = { id: int, family: Family, asset: str, symbol: str, recipient: str, amount: str, asker: Asker }
type Fate = NotSent | Pending | Arrived | Reverted
type Past = { intent: str, family: Family, symbol: str, decimals: int, units: str, recipient: str, at: int, fate: Fate }
type Change = Making | TurningOn | TurningOff
type Effect =
  ReadWallet({ ticket: int }) | Make({ attempt: int }) | Switch({ attempt: int, wanted: bool })
  | ReadHoldings({ ticket: int }) | ReadDesk({ ticket: int }) | ReadActivity({ ticket: int })
  | Copy({ ticket: int, address: str })
type Wallet = {
  showing: bool, standing: R::Read, custody: Custody, canHold: bool, accounts: List[Account],
  change: Change, changing: A::Attempt,
  holdings: R::Read, held: List[Holding], unread: List[Family],
  desk: R::Read, waiting: List[Request],
  activity: R::Read, past: List[Past],
  receiving: bool, copy: R::Read,
}
type Moved = { state: Wallet, out: List[Effect] }

pure val initial: Wallet = {
  showing: false, standing: R::unread, custody: NoWallet, canHold: false, accounts: List(),
  change: Making, changing: A::plan(0),
  holdings: R::unread, held: List(), unread: List(),
  desk: R::unread, waiting: List(), activity: R::unread, past: List(),
  receiving: false, copy: R::unread,
}

pure def serves(custody: Custody): bool = custody == Ready or custody == Unavailable
```

### What the simulator tries

```quint
pure val ticketValues = Set(1, 2, 3)
pure val idValues = Set(1, 2)
pure val accountsValues = Set(
  List(),
  List({ family: Evm, address: "0xA1", network: "Ethereum", symbol: "ETH", decimals: 18, connected: true, canSend: true }),
  List({ family: Evm, address: "0xA1", network: "Ethereum", symbol: "ETH", decimals: 18, connected: true, canSend: true },
       { family: Solana, address: "So1", network: "Solana", symbol: "SOL", decimals: 9, connected: true, canSend: false }))
pure val foundValues = Set(
  List(),
  List({ family: Evm, asset: "native", symbol: "ETH", decimals: 18, units: "1500000000000000000" },
       { family: Solana, asset: "native", symbol: "SOL", decimals: 9, units: "0" }))
pure val missedValues = Set(List(), List(Solana))
pure val askedValues = Set(
  List(),
  List({ id: 2, family: Evm, asset: "native", symbol: "ETH", recipient: "0xB2", amount: "1.5", asker: OwnerAsks },
       { id: 3, family: Solana, asset: "native", symbol: "SOL", recipient: "So2", amount: "2", asker: AgentAsks }))
pure val didValues = Set(
  List(),
  List({ intent: "i1", family: Evm, symbol: "ETH", decimals: 18, units: "1", recipient: "0xB2", at: 1, fate: Pending }))
pure val addressValues = Set("", "0xA1", "So1")
```

### Shown, the wallet is read under the next ticket; hidden, an open address is put away

```quint
pure def canShow(w: Wallet, showing: bool): bool = showing != w.showing

pure def show(w: Wallet, showing: bool): Moved =
  if (showing) { state: { ...w, showing: true, standing: R::ask(w.standing) }, out: List(ReadWallet({ ticket: w.standing.ticket + 1 })) }
  else { state: { ...w, showing: false, receiving: false, copy: R::drop(w.copy) }, out: List() }

pure def canRefresh(w: Wallet): bool = w.standing.status != R::Loading

pure def refresh(w: Wallet): Moved =
  { state: { ...w, standing: R::ask(w.standing) }, out: List(ReadWallet({ ticket: w.standing.ticket + 1 })) }
```

### What the agent says of the wallet is taken whole: a wallet that serves has its lists read under the next tickets, and one that is absent or off shows nothing

```quint
pure def taken(custody: Custody, canHold: bool, accounts: List[Account], w: Wallet): Moved =
  val open = w.receiving and accounts.length() > 0
  if (serves(custody))
    { state: { ...w, custody: custody, canHold: canHold, accounts: accounts,
               holdings: R::ask(w.holdings), desk: R::ask(w.desk), activity: R::ask(w.activity),
               receiving: open, copy: if (open) w.copy else R::drop(w.copy) },
      out: List(ReadHoldings({ ticket: w.holdings.ticket + 1 }), ReadDesk({ ticket: w.desk.ticket + 1 }),
                ReadActivity({ ticket: w.activity.ticket + 1 })) }
  else
    { state: { ...w, custody: custody, canHold: canHold, accounts: List(),
               holdings: R::drop(w.holdings), held: List(), unread: List(), desk: R::drop(w.desk), waiting: List(),
               activity: R::drop(w.activity), past: List(), receiving: false, copy: R::drop(w.copy) },
      out: List() }
```

### Only the newest asking's answer is taken; a failure keeps what was last read

```quint
pure def canStood(w: Wallet, ticket: int): bool = R::canAnswer(w.standing, ticket)

pure def stood(w: Wallet, ticket: int, ok: bool, custody: Custody, canHold: bool, accounts: List[Account]): Moved =
  if (ok) taken(custody, canHold, accounts, { ...w, standing: R::answer(w.standing, true) })
  else { state: { ...w, standing: R::answer(w.standing, false) }, out: List() }
```

### A signed-out owner can open Alpha to sign in before using Wallet

When the resident agent reports a credential failure and the phone confirms it is signed out, Wallet hides any previous account's balance and addresses and offers to open Alpha's sign-in. Returning to Wallet reads its standing again. A network failure continues to offer a retry.

```quint
pure def needsSignIn(w: Wallet): bool = w.custody == SignInRequired
```

### With no wallet, on a phone that can hold one, one action asks the agent to make it, once

A phone that gave the agent nothing to seal a wallet under is never
offered the making.

```quint
pure def busy(w: Wallet): bool = w.changing.outcome == A::Sent

pure def canMake(w: Wallet): bool =
  w.standing.status == R::Loaded and w.custody == NoWallet and w.canHold and not(busy(w))

pure def make(w: Wallet): Moved =
  val id = w.changing.id + 1
  { state: { ...w, change: Making, changing: A::dispatch(A::record(A::plan(id))) }, out: List(Make({ attempt: id })) }
```

### A change the agent confirms is taken as the wallet's new standing; any other answer reads the wallet again

A making or a switch whose answer cannot be trusted is never sent again:
what the agent then says of the wallet decides what is offered.

```quint
pure def canChanged(w: Wallet, id: int): bool = A::canConclude(w.changing, id)

pure def changed(w: Wallet, id: int, confirmed: bool, known: bool, custody: Custody, canHold: bool, accounts: List[Account]): Moved =
  val concluded = { ...w, changing: A::conclude(w.changing, confirmed, known), standing: R::ask(w.standing) }
  if (confirmed and known) taken(custody, canHold, accounts, { ...concluded, standing: R::answer(concluded.standing, true) })
  else { state: concluded, out: List(ReadWallet({ ticket: concluded.standing.ticket })) }
```

### The agent is asked to make or switch the wallet only by the owner's own action

```quint
pure def stepOnlyTheOwnerChangesTheWallet(before: Wallet, via: str, after: Wallet, out: List[Effect]): bool =
  out.every(e => match e {
    | Make(m) => via == "make" and before.custody == NoWallet and before.canHold
    | Switch(s) => via == "switchWallet"
    | _ => true })
```

### When Alpha opens again, every read under way is dropped, an open address is put away, and a change that was sent is unknown

The wallet is read again the next time it is shown.

```quint
pure def reopen(w: Wallet): Wallet =
  { ...w, showing: false, receiving: false, copy: R::drop(w.copy), standing: R::drop(w.standing),
    holdings: R::drop(w.holdings), desk: R::drop(w.desk), activity: R::drop(w.activity),
    changing: if (busy(w)) A::conclude(w.changing, false, false) else w.changing }

pure def stepReopenLeavesNoChangeSent(before: Wallet, via: str, after: Wallet): bool =
  via == "reopen" implies (not(busy(after)) and after.standing.status != R::Loading and not(after.receiving))
```

### A wallet can be made, a phone can be unable to hold one, and a change's outcome can be unknown

```quint
pure def sometimesTheWalletIsMade(w: Wallet): bool =
  w.custody == Ready and w.change == Making and w.changing.outcome == A::Confirmed

pure def sometimesThisPhoneCannotHoldOne(w: Wallet): bool =
  w.standing.status == R::Loaded and w.custody == NoWallet and not(w.canHold)

pure def sometimesAChangeIsUnknown(w: Wallet): bool = w.changing.outcome == A::Unknown

pure def sometimesTheKeysCannotBeOpened(w: Wallet): bool = w.standing.status == R::Loaded and w.custody == Unavailable
```

## Story: See what I hold

> As the owner, I want to see my accounts and what each holds, and never
> to be shown an empty wallet when a network simply could not be read.

### The holdings are read for a wallet that serves, and only the newest asking's answer is taken

```quint
pure def canHoldingsRead(w: Wallet, ticket: int): bool = R::canAnswer(w.holdings, ticket)

pure def holdingsRead(w: Wallet, ticket: int, ok: bool, found: List[Holding], missed: List[Family]): Wallet =
  if (ok) { ...w, holdings: R::answer(w.holdings, true), held: found.select(h => not(missed.includes(h.family))), unread: missed }
  else { ...w, holdings: R::answer(w.holdings, false) }
```

### A network that could not be read is shown as unread, never as empty, and nothing is shown as held on it

```quint
type Reading = NotRead | Nothing | Something

pure def readingOf(family: Family, w: Wallet): Reading =
  if (w.unread.includes(family)) NotRead else if (w.held.some(h => h.family == family)) Something else Nothing

pure def alwaysAnUnreadNetworkIsNeverShownEmpty(w: Wallet): bool =
  w.held.every(h => not(w.unread.includes(h.family))) and w.unread.every(family => readingOf(family, w) == NotRead)
```

### A wallet that is absent or off shows no account, holding, request or past transfer, and reads none

```quint
pure def alwaysAWalletThatDoesNotServeShowsNothing(w: Wallet): bool =
  not(serves(w.custody)) implies and {
    w.accounts == List(), w.held == List(), w.unread == List(), w.waiting == List(), w.past == List(), not(w.receiving),
    w.holdings.status != R::Loading, w.desk.status != R::Loading, w.activity.status != R::Loading,
  }
```

### Something can be held while another network is unread

```quint
pure def sometimesANetworkIsUnread(w: Wallet): bool =
  w.holdings.status == R::Loaded and w.unread.length() > 0 and w.held.length() > 0
```

## Story: Receive

> As the owner, I want my address for each account, as text I can copy and
> as a code another phone can scan.

### Receive opens over a wallet that serves and has an account, and closes when it no longer does

```quint
pure def canReceive(w: Wallet): bool = serves(w.custody) and w.accounts.length() > 0 and not(w.receiving)

pure def receive(w: Wallet): Wallet = { ...w, receiving: true }

pure def canCloseReceive(w: Wallet): bool = w.receiving

pure def closeReceive(w: Wallet): Wallet = { ...w, receiving: false, copy: R::drop(w.copy) }

pure def alwaysReceiveShowsAnAccount(w: Wallet): bool =
  (w.receiving implies (serves(w.custody) and w.accounts.length() > 0)) and (w.copy.status == R::Loading implies w.receiving)
```

### Copy puts one of the wallet's own addresses on the clipboard, one copy at a time, and says whether it was copied

```quint
pure def canCopyAddress(w: Wallet, address: str): bool =
  w.receiving and w.copy.status != R::Loading and w.accounts.some(a => a.address == address)

pure def copyAddress(w: Wallet, address: str): Moved =
  { state: { ...w, copy: R::ask(w.copy) }, out: List(Copy({ ticket: w.copy.ticket + 1, address: address })) }

pure def canCopied(w: Wallet, ticket: int): bool = R::canAnswer(w.copy, ticket)

pure def copied(w: Wallet, ticket: int, ok: bool): Wallet = { ...w, copy: R::answer(w.copy, ok) }

pure def stepOnlyAnAccountsAddressIsCopied(before: Wallet, via: str, after: Wallet, out: List[Effect]): bool =
  out.every(e => match e { | Copy(c) => before.accounts.some(a => a.address == c.address) | _ => true })
```

### An address can be copied

```quint
pure def sometimesAnAddressIsCopied(w: Wallet): bool = w.receiving and w.copy.status == R::Loaded
```

## Story: Decide what my agent asked

> As the owner, I want the transfers my agent asked for to wait for me at
> the top of my wallet, marked as the agent's, beside the ones I asked for
> myself.

### The waiting requests are read for a wallet that serves, and only the newest asking's answer is taken

```quint
pure def canDeskRead(w: Wallet, ticket: int): bool = R::canAnswer(w.desk, ticket)

pure def deskRead(w: Wallet, ticket: int, ok: bool, asked: List[Request]): Wallet =
  { ...w, desk: R::answer(w.desk, ok), waiting: if (ok) asked else w.waiting }
```

### The agent's requests are shown first, then the owner's own, each exactly as it was asked

```quint
pure def agents(w: Wallet): List[Request] = w.waiting.select(r => r.asker == AgentAsks)

pure def own(w: Wallet): List[Request] = w.waiting.select(r => r.asker == OwnerAsks)
```

### A request of the agent's can wait

```quint
pure def sometimesTheAgentAsks(w: Wallet): bool = agents(w).length() > 0 and own(w).length() > 0
```

## Story: See what happened

> As the owner, I want to see the transfers I approved and how each ended:
> not sent, pending, confirmed or failed.

### The past transfers are read for a wallet that serves, and only the newest asking's answer is taken

```quint
pure def canActivityRead(w: Wallet, ticket: int): bool = R::canAnswer(w.activity, ticket)

pure def activityRead(w: Wallet, ticket: int, ok: bool, did: List[Past]): Wallet =
  { ...w, activity: R::answer(w.activity, ok), past: if (ok) did else w.past }
```

### A past transfer can be pending

```quint
pure def sometimesATransferIsPending(w: Wallet): bool = w.past.some(p => p.fate == Pending)
```

## Story: Switch the wallet off and on

> As the owner, I want to switch my wallet off, see only that it is off and
> how to turn it on, and get the same wallet back when I do.

### The owner switches off a wallet that serves and on one that is off, one change at a time

```quint
pure def canSwitchWallet(w: Wallet, wanted: bool): bool =
  w.standing.status == R::Loaded and not(busy(w)) and (if (wanted) w.custody == Off else serves(w.custody))

pure def switchWallet(w: Wallet, wanted: bool): Moved =
  val id = w.changing.id + 1
  { state: { ...w, change: if (wanted) TurningOn else TurningOff, changing: A::dispatch(A::record(A::plan(id))),
             receiving: false, copy: R::drop(w.copy) },
    out: List(Switch({ attempt: id, wanted: wanted })) }
```

### The wallet can be switched off, and switched on again

```quint
pure def sometimesTheWalletIsOff(w: Wallet): bool =
  w.custody == Off and w.change == TurningOff and w.changing.outcome == A::Confirmed

pure def sometimesTheWalletIsOnAgain(w: Wallet): bool =
  serves(w.custody) and w.change == TurningOn and w.changing.outcome == A::Confirmed
```
