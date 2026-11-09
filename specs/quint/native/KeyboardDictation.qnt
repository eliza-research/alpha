/// Explicit keyboard dictation gate. Same-field/account facts are external observations.
module KeyboardDictation {
 var phase: str
 var generation: int
 var inserted: int
 var op: str
 var inputTicket: int
 var sameEditor: bool
 var account: bool
 action mark(name: str, id: int, f: bool, a: bool): bool = all {op'=name, inputTicket'=id, sameEditor'=f, account'=a}
 action init = all {mark("init",0,true,true),phase' = "closed", generation' = 0, inserted' = 0}
 action open = all {mark("open",0,true,true),generation < 6, phase' = "ready", generation' = generation + 1, inserted' = inserted}
 action start = all {mark("start",0,true,true),phase == "ready", generation < 6, phase' = "recording", generation' = generation + 1, inserted' = inserted}
 action stop(ticket: int): bool = all {mark("stop",ticket,true,true),
  phase' = if (phase == "recording" and ticket == generation) "transcribing" else phase,
  generation' = generation, inserted' = inserted
 }
 action cancel = all {mark("cancel",0,true,true),generation < 6, phase' = "closed", generation' = generation + 1, inserted' = inserted}
 action finish(ticket: int, sameField: bool, sameAccount: bool): bool = {
  val accepted = phase == "transcribing" and ticket == generation and sameField and sameAccount
  all {
   mark("finish",ticket,sameField,sameAccount), generation < 6,
   phase' = if (accepted) "closed" else phase,
   generation' = generation + (if (accepted) 1 else 0),
   inserted' = inserted + (if (accepted) 1 else 0)
  }
 }
 action step = any {open, start, stop(1), stop(2), stop(3), stop(4), cancel,
  finish(1,true,true), finish(2,true,true), finish(3,true,true), finish(4,true,true),
  finish(generation,false,true), finish(generation,true,false)}
 val TypeOK = phase.in(Set("closed","ready","recording","transcribing")) and generation >= 0 and inserted >= 0
 val AtMostOneInsertPerCapture = inserted <= generation / 3
 val safety = TypeOK and AtMostOneInsertPerCapture
 run currentStopInsertsOnceTest = init.then(open).then(start).then(stop(2)).then(finish(2,true,true))
  .then(finish(2,true,true)).expect(safety and inserted == 1 and phase == "closed")
 run cancelledResultNeverInsertsTest = init.then(open).then(start).then(stop(2)).then(cancel)
  .then(finish(2,true,true)).expect(safety and inserted == 0)
 run replacedCaptureRejectsOldResultTest = init.then(open).then(start).then(stop(2)).then(open).then(start)
  .then(stop(4)).then(finish(2,true,true)).expect(safety and inserted == 0 and phase == "transcribing")
 run fieldOrAccountChangedTest = init.then(open).then(start).then(stop(2))
  .then(finish(2,false,true)).then(finish(2,true,false)).expect(safety and inserted == 0)
}
