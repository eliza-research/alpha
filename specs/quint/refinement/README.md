# Implementation refinement

The migration PR preserves the first model-verification baseline. This phase checks
observable implementation transitions against the models and records the remaining
proof obligations per component.

## Relation being checked

An adapter runs actual product code with controlled environmental ports. It maps
concrete state and observed effects through an explicit abstraction function. Each
recorded implementation event must correspond to named model transitions or an
unchanged abstract state. Rejected commands check that the corresponding model
transition is disabled and that the implementation observation stays unchanged.

`check-traces.mjs` evaluates generated checks with the pinned Quint interpreter.
It compares observations after every supplied checkpoint, retains input traces,
and binds results to source, adapter and model hashes. A mismatched observation
fails the invocation. The harness test includes a deliberately wrong observation.

Run an implemented family with `node scripts/check-quint-refinement.mjs
--families=native`. The default command runs all three families. Missing adapters
and failed checks produce a failing command. `--require-complete` also requires
the outstanding application-refinement obligations to be discharged.

A trace has this shape. Keys in `expect` name model expressions under the imported
namespace, and values come from observed implementation state.

```js
{
  name: 'two speech windows',
  init: { name: 'init' },
  expect: { 's.speaking': false },
  steps: [
    { action: { name: 'accept', args: [500] }, expect: { 's.speaking': false } },
    { action: { name: 'accept', args: [500] }, expect: { 's.speaking': true } }
  ]
}
```

A step with `action: null` checks an implementation event that preserves abstract
state. An action descriptor with `reject: true` additionally checks disabledness
in a separate terminal guard case. `qset` and `qmap` preserve collection semantics.
Every concrete asynchronous boundary that can expose state requires its own
checkpoint. Grouped model actions must document their correspondence to the
implementation's intermediate states.
Text containing quotes, backslashes or control characters needs an explicit
equality-class mapping because this pinned Quint parser retains literal escapes.
Include adapter and harness files in `sources` so receipt hashes bind the
abstraction function as well as the implementation.

## Evidence levels

- `complete-finite-helper` covers an explicitly enumerated finite helper domain
  with a justified input partition and all observable helper state.
- `bounded-component` records implementation-originating schedules and source
  observations for one component within its stated limits.
- `bounded-orchestration` records actual coordinator behavior across components
  and a shared scheduler, within its stated limits.

Each adapter must name its observed fields, exercised actions, source entry points,
input partitions and environmental assumptions. A successful bounded campaign
leaves unbounded simulation-relation obligations open. Complete application
refinement additionally needs initialization, all source transitions, permitted
stuttering, output correspondence and applicable progress assumptions across every
supported implementation state.

## External contracts

Controlled ports preserve Android, provider, storage and scheduling boundaries.
Their successful return values provide no independent evidence of remote
idempotency, kernel resource ownership, actual device erasure, visible SystemUI
pixels or physical audio. Those contracts retain separate integration and device
qualification obligations.
