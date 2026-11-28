# Transfer

One transfer at a time, from asking to decision. The owner asks for one on
the send form, or opens one that already waits in the [wallet](./index.md),
their own or the agent's. Either way the agent answers with a review: the
exact amount, the recipient, the network, the largest fee the network may
take, and the minute it stays good for. The owner approves exactly that
review or declines the request; the decision is sent once, and what the
agent says of it is told as it is, including when nothing can be known.

## Story: Send

> As the owner, I want to choose an account and an asset, name a recipient
> and an amount, see exactly what will be sent before I approve it, and
> never have one approval sent twice.

### A transfer is closed, being written, asked, opened for review, under review, stale or being decided

A review that lapsed, could not be opened or was turned down is stale: its
request still waits and can be opened afresh. A request is spent once an
approval of it was sent and not turned down. What the agent turned down is
told with the sentence the agent gave for it, where it gave one.

```quint
import read as R from "../../kit/read"
import attempt as A from "../../kit/attempt"
import review as V from "../../kit/review"
import wallet as W from "./index"

type Stage = Closed | Writing | Asking | Opening | Reviewing | Stale | Deciding
type Said = Quiet | Lapsed | TurnedDown | Submitted | Unresolved | Declined | Unsure
type Terms = {
  request: int, family: W::Family, network: str, account: str, recipient: str, symbol: str, decimals: int, units: str,
  fee: str, feeSymbol: str, feeDecimals: int, intent: str, commitment: str, expires: int,
}
type Effect =
  Ask({ attempt: int, family: W::Family, asset: str, recipient: str, amount: str })
  | Review({ ticket: int, request: int })
  | Approve({ attempt: int, request: int, intent: str, commitment: str })
  | Decline({ attempt: int, request: int })
type Transfer = {
  stage: Stage, said: Said, why: str, asking: A::Attempt, request: int, opening: R::Read, review: V::Review, terms: Terms,
  deciding: A::Attempt, approving: bool, spent: List[int], settled: int,
}
type Moved = { state: Transfer, out: List[Effect] }

pure val noTerms: Terms = {
  request: 0, family: W::Evm, network: "", account: "", recipient: "", symbol: "", decimals: 0, units: "",
  fee: "", feeSymbol: "", feeDecimals: 0, intent: "", commitment: "", expires: 0,
}

pure val initial: Transfer = {
  stage: Closed, said: Quiet, why: "", asking: A::plan(0), request: 0, opening: R::unread, review: V::unreviewed, terms: noTerms,
  deciding: A::plan(0), approving: false, spent: List(), settled: 0,
}
```

### What the simulator tries

```quint
pure val ticketValues = Set(1, 2, 3)
pure val idValues = Set(1, 2, 3)
pure val requestValues = Set(0, 1, 2)
pure val nowValues = Set(0, 59999, 60000, 60001)
pure val assetValues = Set("native")
pure val recipientValues = Set("", "0xB2")
pure val amountValues = Set("", "1.5")
pure val reasonValues = Set("", "The desk is full: decide the requests that wait first.")
pure val termsValues = Set(
  { request: 1, family: W::Evm, network: "Ethereum", account: "0xA1", recipient: "0xB2", symbol: "ETH", decimals: 18,
    units: "1500000000000000000", fee: "21000", feeSymbol: "ETH", feeDecimals: 18, intent: "i1", commitment: "c1", expires: 60000 },
  { request: 2, family: W::Solana, network: "Solana", account: "So1", recipient: "So2", symbol: "SOL", decimals: 9,
    units: "2000000000", fee: "5000", feeSymbol: "SOL", feeDecimals: 9, intent: "i2", commitment: "c2", expires: 60000 })
```

### The send form opens when nothing else is under way, and closes without asking anything

```quint
pure def canCompose(t: Transfer): bool = t.stage == Closed

pure def compose(t: Transfer): Transfer = { ...t, stage: Writing, said: Quiet, why: "" }

pure def canClose(t: Transfer): bool =
  t.stage == Writing or t.stage == Opening or t.stage == Reviewing or t.stage == Stale

pure def close(t: Transfer): Transfer =
  { ...t, stage: Closed, said: Quiet, why: "", opening: R::drop(t.opening), review: V::dismiss(t.review) }
```

### The owner asks for a transfer of an amount written exactly in the asset's own units, to a recipient, once

The form says whether the amount is a plain number with no more decimal
places than the asset has; the agent checks it again, and the address.

```quint
pure def canAsk(t: Transfer, recipient: str, amount: str, exact: bool): bool =
  t.stage == Writing and recipient != "" and amount != "" and exact

pure def ask(t: Transfer, family: W::Family, asset: str, recipient: str, amount: str, exact: bool): Moved =
  val id = t.asking.id + 1
  { state: { ...t, stage: Asking, said: Quiet, why: "", asking: A::dispatch(A::record(A::plan(id))) },
    out: List(Ask({ attempt: id, family: family, asset: asset, recipient: recipient, amount: amount })) }
```

### A request the agent took is opened for review at once; one it turned down leaves the form open, and an unknown answer closes it

An asking whose answer cannot be trusted may have left a request waiting:
it is never asked again, and the wallet's list says whether it waits.

```quint
pure def sought(request: int, t: Transfer): Moved =
  { state: { ...t, stage: Opening, said: Quiet, why: "", request: request, opening: R::ask(t.opening), review: V::dismiss(t.review) },
    out: List(Review({ ticket: t.opening.ticket + 1, request: request })) }

pure def canAsked(t: Transfer, id: int, confirmed: bool, known: bool, request: int): bool =
  A::canConclude(t.asking, id) and ((confirmed and known) implies (request >= 1 and not(t.spent.includes(request))))

pure def asked(t: Transfer, id: int, confirmed: bool, known: bool, request: int, reason: str): Moved =
  val concluded = { ...t, asking: A::conclude(t.asking, confirmed, known) }
  if (confirmed and known) sought(request, { ...concluded, settled: t.settled + 1 })
  else if (known) { state: { ...concluded, stage: Writing, said: TurnedDown, why: reason }, out: List() }
  else { state: { ...concluded, stage: Closed, said: Unsure, why: "", settled: t.settled + 1 }, out: List() }
```

### The review shows the agent's exact terms for the request that was opened, and only the newest asking's answer is taken

Discovered by the proof: a review is opened, shown, stale or approved only
for a numbered request. Without that stated, the terms shown could not be
proved to be those of a request that waits.

```quint
pure def canReviewOpened(t: Transfer, ticket: int, ok: bool, terms: Terms): bool =
  R::canAnswer(t.opening, ticket) and (ok implies terms.request == t.request)

pure def reviewOpened(t: Transfer, ticket: int, ok: bool, terms: Terms, reason: str): Transfer =
  if (ok) { ...t, stage: Reviewing, opening: R::answer(t.opening, true), terms: terms, review: V::present(V::revise(t.review)) }
  else { ...t, stage: Stale, said: TurnedDown, why: reason, opening: R::answer(t.opening, false) }

pure def alwaysTheReviewShownIsOfTheRequestOpened(t: Transfer): bool =
  ((t.stage == Opening or t.stage == Reviewing or t.stage == Stale or (t.stage == Deciding and t.approving)) implies t.request >= 1)
    and (t.stage == Reviewing implies t.terms.request == t.request)
```

### A review lapses at the time the agent gave, and a lapsed review approves nothing

```quint
pure def canLapse(t: Transfer, now: int): bool = t.stage == Reviewing and now >= t.terms.expires

pure def lapse(t: Transfer, now: int): Transfer = { ...t, stage: Stale, said: Lapsed, why: "", review: V::revise(t.review) }
```

### The owner approves only the review shown, before it lapses, and the approval is sent once with that review's own marks

```quint
pure def canApprove(t: Transfer, now: int): bool =
  t.stage == Reviewing and V::canConfirm(t.review) and now < t.terms.expires

pure def approve(t: Transfer, now: int): Moved =
  val id = t.deciding.id + 1
  { state: { ...t, stage: Deciding, said: Quiet, why: "", approving: true, review: V::confirm(t.review), deciding: A::dispatch(A::record(A::plan(id))) },
    out: List(Approve({ attempt: id, request: t.request, intent: t.terms.intent, commitment: t.terms.commitment })) }

pure def stepAnApprovalNamesExactlyTheReviewShown(before: Transfer, via: str, after: Transfer, out: List[Effect]): bool =
  out.every(e => match e {
    | Approve(a) => via == "approve" and V::canConfirm(before.review) and a.request == before.terms.request
        and a.intent == before.terms.intent and a.commitment == before.terms.commitment
    | _ => true })
```

### A decision ends as the agent says: submitted, signed but unresolved, declined, turned down, or unknown

What is turned down keeps the agent's sentence for it, such as that the
wallet holds too little for the transfer and its fee, until the owner has
read it or acts again; nothing else has one.

An approval that was submitted, left unresolved or whose answer cannot be
trusted spends its request: it may have been sent, so it is never opened
or approved again, and the wallet's past transfers say how it ended. An
approval the agent turned down leaves the request to be opened afresh.

```quint
pure def canDecided(t: Transfer, id: int): bool = A::canConclude(t.deciding, id)

pure def decided(t: Transfer, id: int, confirmed: bool, known: bool, resolved: bool, reason: str): Transfer =
  val concluded = { ...t, deciding: A::conclude(t.deciding, confirmed, known), settled: t.settled + 1 }
  val used = if (t.spent.includes(t.request)) t.spent else t.spent.append(t.request)
  if (not(t.approving))
    { ...concluded, stage: Closed, said: if (not(known)) Unsure else if (confirmed) Declined else TurnedDown,
      why: if (known and not(confirmed)) reason else "" }
  else if (not(known)) { ...concluded, stage: Closed, said: Unsure, why: "", spent: used }
  else if (confirmed) { ...concluded, stage: Closed, said: if (resolved) Submitted else Unresolved, why: "", spent: used }
  else { ...concluded, stage: Stale, said: TurnedDown, why: reason }

pure def canAcknowledge(t: Transfer): bool = t.stage == Closed and t.said != Quiet

pure def acknowledge(t: Transfer): Transfer = { ...t, said: Quiet, why: "" }

pure def alwaysOnlyWhatWasTurnedDownHasItsReason(t: Transfer): bool = t.why != "" implies t.said == TurnedDown
```

### A spent request stays spent, and is never opened for review or approved again

```quint
pure def stepASpentRequestIsNeverSentAgain(before: Transfer, via: str, after: Transfer, out: List[Effect]): bool =
  before.spent.every(r => after.spent.includes(r)) and out.every(e => match e {
    | Approve(a) => not(before.spent.includes(a.request))
    | Review(r) => not(before.spent.includes(r.request))
    | _ => true })

pure def alwaysASpentRequestIsNotUnderReview(t: Transfer): bool =
  (t.stage == Opening or t.stage == Reviewing or t.stage == Stale or (t.stage == Deciding and t.approving))
    implies not(t.spent.includes(t.request))
```

### Each stage has exactly its own work under way, and only a review under way can be approved

```quint
pure def alwaysEachStageHasItsWorkUnderWay(t: Transfer): bool = and {
  (t.stage == Asking) iff (t.asking.outcome == A::Sent),
  (t.stage == Deciding) iff (t.deciding.outcome == A::Sent),
  (t.stage == Opening) iff (t.opening.status == R::Loading),
  (t.stage == Reviewing) iff V::canConfirm(t.review),
}
```

### When Alpha opens again, the form and any review are closed, and an asking or a decision that was sent is unknown

When the phone confirms sign-out, Wallet also puts away the previous owner’s reviewed terms and request. A decision that was sent when Alpha stopped may have reached the agent: it
is never sent again, and an approval among them spends its request.

```quint
pure def reopen(t: Transfer): Transfer =
  val wasAsking = t.asking.outcome == A::Sent
  val wasDeciding = t.deciding.outcome == A::Sent
  { ...t, stage: Closed,
    said: if (wasAsking or wasDeciding) Unsure else if (t.stage == Closed) t.said else Quiet,
    why: if (wasAsking or wasDeciding or t.stage != Closed) "" else t.why,
    asking: if (wasAsking) A::conclude(t.asking, false, false) else t.asking,
    deciding: if (wasDeciding) A::conclude(t.deciding, false, false) else t.deciding,
    spent: if (wasDeciding and t.approving and not(t.spent.includes(t.request))) t.spent.append(t.request) else t.spent,
    opening: R::drop(t.opening), review: V::dismiss(t.review),
    settled: if (wasAsking or wasDeciding) t.settled + 1 else t.settled }

pure def ownerSignedOut(t: Transfer): Transfer =
  val left = reopen(t)
  { ...left, request: 0, terms: noTerms, approving: false, why: "",
    said: if (left.said == Unsure) Unsure else Quiet }

pure def stepReopenLeavesNothingSent(before: Transfer, via: str, after: Transfer): bool =
  via == "reopen" implies and {
    after.stage == Closed,
    (before.stage == Deciding and before.approving) implies after.spent.includes(before.request),
    (before.stage == Asking or before.stage == Deciding) implies after.said == Unsure,
  }
```

### A transfer can be submitted, left unresolved, turned down while asked, lapse and be opened afresh, and end unknown

```quint
pure def sometimesATransferIsSubmitted(t: Transfer): bool = t.said == Submitted and t.spent.includes(t.request)

pure def sometimesATransferIsUnresolved(t: Transfer): bool = t.said == Unresolved and t.spent.includes(t.request)

pure def sometimesAnAskingIsTurnedDown(t: Transfer): bool = t.stage == Writing and t.said == TurnedDown and t.why != ""

pure def sometimesAReviewLapses(t: Transfer): bool = t.stage == Stale and t.said == Lapsed

pure def sometimesAStaleReviewIsOpenedAfresh(t: Transfer): bool = t.stage == Reviewing and t.review.revision >= 2

pure def sometimesAnApprovalIsTurnedDown(t: Transfer): bool =
  t.stage == Stale and t.said == TurnedDown and t.deciding.outcome == A::Refused

pure def sometimesAlphaCannotTell(t: Transfer): bool = t.said == Unsure and t.spent.includes(t.request)
```

## Story: Decide what my agent asked

> As the owner, I want to review and decide a transfer my agent asked for
> exactly as I do my own, and nothing said in a conversation to decide one.

### A waiting request is opened for review when nothing else is under way, or afresh from its own stale review, unless it is spent

```quint
pure def canOpenReview(t: Transfer, request: int): bool =
  request >= 1 and not(t.spent.includes(request)) and (t.stage == Closed or (t.stage == Stale and request == t.request))

pure def openReview(t: Transfer, request: int): Moved = sought(request, t)
```

### The owner declines a waiting request from the wallet's list or from its review, once

Declining sends nothing to a network, so a request that cannot be reviewed,
a spent one that still waits included, can always be taken off the list.

```quint
pure def canDecline(t: Transfer, request: int): bool =
  request >= 1 and (t.stage == Closed or ((t.stage == Reviewing or t.stage == Stale) and request == t.request))

pure def decline(t: Transfer, request: int): Moved =
  val id = t.deciding.id + 1
  { state: { ...t, stage: Deciding, said: Quiet, why: "", approving: false, request: request, review: V::dismiss(t.review),
             deciding: A::dispatch(A::record(A::plan(id))) },
    out: List(Decline({ attempt: id, request: request })) }
```

### A decision leaves Alpha only by the owner's approve or decline, and an asking only from the send form

No conversation, notice or answer of the agent approves, declines or asks:
the wallet's own controls are the only senders.

```quint
pure def stepOnlyTheOwnersOwnActsLeaveAlpha(before: Transfer, via: str, after: Transfer, out: List[Effect]): bool =
  out.every(e => match e {
    | Ask(a) => via == "ask" and before.stage == Writing
    | Approve(a) => via == "approve"
    | Decline(d) => via == "decline"
    | Review(r) => via == "openReview" or via == "asked" })
```

### A request can be declined

```quint
pure def sometimesARequestIsDeclined(t: Transfer): bool = t.said == Declined
```
