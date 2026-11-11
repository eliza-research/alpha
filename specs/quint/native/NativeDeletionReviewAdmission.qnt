// One native reminder review's admission and bridge settlement token.
module NativeDeletionReviewAdmission {
  type State = {phase: str, admissions: int, settlements: int, returned: bool}
  var s: State

  action init = s' = {phase: "queued", admissions: 0, settlements: 0, returned: false}
  action admit = s' = if (s.phase == "queued")
    {...s, phase: "admitted", admissions: s.admissions + 1, returned: true}
    else {...s, returned: false}
  action retire = s' = if (s.phase == "queued") {...s, phase: "retired"} else s
  action settle = all {
    val first = s.settlements == 0
    s' = {...s, phase: if (s.phase == "queued") "retired" else s.phase,
      settlements: if (first) s.settlements + 1 else s.settlements, returned: first}
  }
  action step = any {admit, retire, settle, s' = s}

  val AtMostOneAdmission = s.admissions <= 1
  val AtMostOneSettlement = s.settlements <= 1
  val RetiredNeverAdmitted = s.phase == "retired" implies s.admissions == 0
  val SettledNeverQueued = s.settlements > 0 implies s.phase != "queued"
  val safety = AtMostOneAdmission and AtMostOneSettlement and RetiredNeverAdmitted and SettledNeverQueued

  run pauseWinsBeforeWorkerTest = init.then(retire).then(admit)
    .expect(s.phase == "retired" and not(s.returned) and safety)
  run workerAdmissionSurvivesPauseTest = init.then(admit).then(retire).then(settle)
    .expect(s.phase == "admitted" and s.returned and safety)
  run dismissAndShowErrorSettleOnceTest = init.then(settle).then(settle).then(admit)
    .expect(s.phase == "retired" and s.settlements == 1 and not(s.returned) and safety)
}
