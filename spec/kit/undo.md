# Undo

A change the owner can take back: it is held for a while before it takes
effect, and until then Undo cancels it.

## Story: Take it back

> As the owner, I want a moment to undo a deletion or a send before it
> really happens.

### A change is held until a time, and then released or undone

```quint
type Holding = Free | Held | Released | Undone
type Undo = { holding: Holding, until: int }

pure val free: Undo = { holding: Free, until: 0 }

pure def hold(now: int, window: int): Undo = { holding: Held, until: now + window }
```

### A held change can be undone until its time comes

```quint
pure def canUndo(u: Undo, now: int): bool = u.holding == Held and now < u.until

pure def undo(u: Undo): Undo = { ...u, holding: Undone }
```

### A held change takes effect only once its time has come

The time a change waits for is Alpha's own, which never goes back across a
restart or a clock set back. A time kept more than a year and a day ahead
of a phone clock that reads 2026 or later came from a clock once set far
ahead; it is let go, and the clock is taken as it reads.

```quint
pure def canRelease(u: Undo, now: int): bool = u.holding == Held and now >= u.until

pure def release(u: Undo): Undo = { ...u, holding: Released }
```

### A change is never both undone and released

```quint
pure def lawUndoAndReleaseExclude(now: int, window: int, later: int): bool =
  val u = hold(now, window)
  not(canUndo(u, later) and canRelease(u, later)) and not(canRelease(undo(u), later)) and not(canUndo(release(u), later))
```
