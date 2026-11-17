/// RoleController's serialized worker owns each step. Durable intent precedes grants.
module OSRoleUpgrade {
  type State = { holder: str, receipt: str, eligible: bool, qualified: bool,
    applying: bool, ownerChoice: bool, ownerValue: str, changed: bool }
  var s: State
  action init = s' = { holder: "legacy", receipt: "", eligible: true,
    qualified: true, applying: false, ownerChoice: false, ownerValue: "", changed: false }
  action prepare = all { s.eligible, s.qualified, s.receipt != "done",
    s.holder == "legacy" or (s.holder == "none" and s.receipt == "pending"),
    s' = { ...s, receipt: "pending", applying: true } }
  action adopt = all { s.applying, s.eligible, s.qualified,
    s.holder == "legacy" or s.holder == "none",
    s' = { ...s, holder: "alpha", changed: true } }
  action acknowledge = all { s.applying, s.holder == "alpha",
    s' = { ...s, receipt: "done", applying: false } }
  action failure = all { s.applying,
    s' = { ...s, applying: false } }
  action partialFailure = all { s.applying, s.holder == "legacy",
    s' = { ...s, holder: "none", applying: false } }
  action restore = all { s.receipt == "pending", s.holder == "none", not(s.applying),
    s' = { ...s, holder: "legacy" } }
  action restart = s' = { ...s, applying: false }
  action ownerSelect(value: str): bool = all { not(s.applying),
    s' = { ...s, holder: value, receipt: "done", ownerChoice: true, ownerValue: value } }
  action ineligible = all { not(s.applying), s' = { ...s, eligible: false } }
  action unqualified = all { not(s.applying), s' = { ...s, qualified: false } }
  action step = any { prepare, adopt, acknowledge, failure, partialFailure, restore,
    restart, ownerSelect("other"), ownerSelect("legacy"), ownerSelect("none"),
    ineligible, unqualified }
  val safety = s.holder.in(Set("legacy", "alpha", "other", "none"))
    and s.receipt.in(Set("", "pending", "done"))
    and (not(s.ownerChoice) or s.holder == s.ownerValue)
    and (not(s.applying) or (s.receipt == "pending" and not(s.ownerChoice)))
  run completeAndRestartTest = init.then(prepare).then(adopt).then(acknowledge)
    .then(restart).expect(s.holder == "alpha" and s.receipt == "done" and safety)
  run failureRetryTest = init.then(prepare).then(failure).then(prepare).then(adopt)
    .then(acknowledge).expect(s.holder == "alpha" and safety)
  run partialFailureRestoreTest = init.then(prepare).then(partialFailure).then(restore)
    .expect(s.holder == "legacy" and s.receipt == "pending" and safety)
  run ownerChoiceWinsTest = init.then(prepare).then(failure).then(ownerSelect("other"))
    .then(restart).expect(s.holder == "other" and s.receipt == "done" and safety)
  run ownerReturnsLegacyTest = init.then(prepare).then(adopt).then(acknowledge)
    .then(ownerSelect("legacy")).then(restart).expect(s.holder == "legacy" and safety)
  run crashAfterGrantTest = init.then(prepare).then(adopt).then(restart)
    .expect(s.holder == "alpha" and s.receipt == "pending" and safety)
}
