lemma WrittenFilter(s: Editor, attempt: int, confirmed: bool, known: bool, filed: bool)
  ensures (s.kind.Reply? && kit__attempt_conclude(s.write, confirmed, known).outcome.Confirmed? && !(filed && kit__attempt_conclude(s.write, confirmed, known).outcome.Confirmed?)) ==>
    written(s, attempt, confirmed, known, filed).latched == s.latched + ProofLib.Filter((set_x: int) => !((set_x in s.latched)), [s.writing])
  ensures (!(s.kind.CreateReminder? || s.kind.UpdateReminder? || s.kind.RescheduleReminder?) && !(filed && kit__attempt_conclude(s.write, confirmed, known).outcome.Confirmed?) && !kit__attempt_conclude(s.write, confirmed, known).outcome.Confirmed? && !kit__attempt_conclude(s.write, confirmed, known).outcome.Refused? && !s.kind.Create?) ==>
    written(s, attempt, confirmed, known, filed).latched == s.latched + ProofLib.Filter((set_x: int) => !((set_x in s.latched)), [s.writing])
{
}

lemma written_ensures(s: Editor, attempt: int, confirmed: bool, known: bool, filed: bool)
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysAnEventEndsAfterItStarts(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysASaveInFlightIsTheShownForm(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysARepeatingChangeSaysWhichOccurrences(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysEditsBuildOnTheEventAsRead(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysNothingWithPeopleOrVideoIsWritten(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysSeparateOnlyWhileACreateIsInDoubt(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysNoBlindDuplicate(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysASaveInDoubtHoldsItsForm(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysNothingIsSentOverAChangeInDoubt(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysAConfirmationBelongsToItsBanner(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysBannersBelongToTheirForm(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysASetAsideDraftIsKept(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysFormsKeepTheirDraftState(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> alwaysAnUnreadableSlotIsNeverWritten(written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> stepAWriteTakesTheNextNumber(s, written(s, attempt, confirmed, known, filed), []))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> stepAnAnswerIsSavedOnlyOnceRead(s, "written", written(s, attempt, confirmed, known, filed)))
  ensures (inv(s) ==> canWritten(s, attempt, filed) ==> stepKeptEditsAreLostOnlyByChoice(s, "written", written(s, attempt, confirmed, known, filed)))
{
  if inv(s) && canWritten(s, attempt, filed) {
    WrittenFilter(s, attempt, confirmed, known, filed);
    ProofLib.FilterMember((set_x: int) => !((set_x in s.latched)), [s.writing], s.writing);
  }
}

lemma ReceiptsUnaware(s: Editor, ticket: int, found: bool)
  requires !s.unknownCreate
  ensures receiptsChecked(s, ticket, found) == s.(receipts := kit__read_answer(s.receipts, true))
{
  hide *;
  reveal receiptsChecked;
}

lemma ReceiptsRulesUnaware(s: Editor, ticket: int, found: bool)
  requires !s.unknownCreate
  requires inv(s)
  ensures inv(receiptsChecked(s, ticket, found))
  ensures stepAWriteTakesTheNextNumber(s, receiptsChecked(s, ticket, found), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "receiptsChecked", receiptsChecked(s, ticket, found))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "receiptsChecked", receiptsChecked(s, ticket, found))
{
  hide *;
  ReceiptsUnaware(s, ticket, found);
  reveal inv, inFlight, withoutForm, discardable, kit__draft_keepMine, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma ReceiptsFoundSaving(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && found && s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s)
  ensures receiptsChecked(s, ticket, found) == withoutForm(s.write, s.(receipts := kit__read_answer(s.receipts, true), unknownCreate := false))
{
  hide *;
  reveal receiptsChecked;
}

lemma ReceiptsRulesFoundSaving(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && found && s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s)
  requires inv(s)
  ensures inv(receiptsChecked(s, ticket, found))
  ensures stepAWriteTakesTheNextNumber(s, receiptsChecked(s, ticket, found), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "receiptsChecked", receiptsChecked(s, ticket, found))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "receiptsChecked", receiptsChecked(s, ticket, found))
{
  hide *;
  ReceiptsFoundSaving(s, ticket, found);
  reveal inv, inFlight, withoutForm, kit__draft_blank, discardable, kit__draft_keepMine, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma ReceiptsFoundIdle(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && found && !(s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s))
  ensures receiptsChecked(s, ticket, found) == s.(receipts := kit__read_answer(s.receipts, true), unknownCreate := false, separate := false)
{
  hide *;
  reveal receiptsChecked;
}

lemma ReceiptsRulesFoundIdle(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && found && !(s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s))
  requires inv(s)
  ensures inv(receiptsChecked(s, ticket, found))
  ensures stepAWriteTakesTheNextNumber(s, receiptsChecked(s, ticket, found), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "receiptsChecked", receiptsChecked(s, ticket, found))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "receiptsChecked", receiptsChecked(s, ticket, found))
{
  hide *;
  ReceiptsFoundIdle(s, ticket, found);
  reveal inv, inFlight, withoutForm, discardable, kit__draft_keepMine, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma ReceiptsMissingSaving(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && !found && s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s)
  ensures receiptsChecked(s, ticket, found) == s.(receipts := kit__read_answer(s.receipts, true), draft := kit__draft_keepMine(s.draft))
{
  hide *;
  reveal receiptsChecked;
}

lemma ReceiptsRulesMissingSaving(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && !found && s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s)
  requires inv(s)
  ensures inv(receiptsChecked(s, ticket, found))
  ensures stepAWriteTakesTheNextNumber(s, receiptsChecked(s, ticket, found), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "receiptsChecked", receiptsChecked(s, ticket, found))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "receiptsChecked", receiptsChecked(s, ticket, found))
{
  hide *;
  ReceiptsMissingSaving(s, ticket, found);
  reveal inv, inFlight, withoutForm, discardable, kit__draft_keepMine, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma ReceiptsMissingIdle(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && !found && !(s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s))
  ensures receiptsChecked(s, ticket, found) == s.(receipts := kit__read_answer(s.receipts, true))
{
  hide *;
  reveal receiptsChecked;
}

lemma ReceiptsRulesMissingIdle(s: Editor, ticket: int, found: bool)
  requires s.unknownCreate && !found && !(s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s))
  requires inv(s)
  ensures inv(receiptsChecked(s, ticket, found))
  ensures stepAWriteTakesTheNextNumber(s, receiptsChecked(s, ticket, found), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "receiptsChecked", receiptsChecked(s, ticket, found))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "receiptsChecked", receiptsChecked(s, ticket, found))
{
  hide *;
  ReceiptsMissingIdle(s, ticket, found);
  reveal inv, inFlight, withoutForm, discardable, kit__draft_keepMine, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma receiptsChecked_ensures(s: Editor, ticket: int, found: bool)
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysAnEventEndsAfterItStarts(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysASaveInFlightIsTheShownForm(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysARepeatingChangeSaysWhichOccurrences(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysEditsBuildOnTheEventAsRead(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysNothingWithPeopleOrVideoIsWritten(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysSeparateOnlyWhileACreateIsInDoubt(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysNoBlindDuplicate(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysASaveInDoubtHoldsItsForm(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysNothingIsSentOverAChangeInDoubt(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysAConfirmationBelongsToItsBanner(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysBannersBelongToTheirForm(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysASetAsideDraftIsKept(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysFormsKeepTheirDraftState(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> alwaysAnUnreadableSlotIsNeverWritten(receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> stepAWriteTakesTheNextNumber(s, receiptsChecked(s, ticket, found), []))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> stepAnAnswerIsSavedOnlyOnceRead(s, "receiptsChecked", receiptsChecked(s, ticket, found)))
  ensures (inv(s) ==> canReceiptsChecked(s, ticket) ==> stepKeptEditsAreLostOnlyByChoice(s, "receiptsChecked", receiptsChecked(s, ticket, found)))
{
  hide *;
  if inv(s) && canReceiptsChecked(s, ticket) {
    if !s.unknownCreate {
      ReceiptsRulesUnaware(s, ticket, found);
    } else if found {
      if s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s) {
        ReceiptsRulesFoundSaving(s, ticket, found);
      } else {
        ReceiptsRulesFoundIdle(s, ticket, found);
      }
    } else if s.form.NewEvent? && s.draft.sync.Saving? && !inFlight(s) {
      ReceiptsRulesMissingSaving(s, ticket, found);
    } else {
      ReceiptsRulesMissingIdle(s, ticket, found);
    }
    reveal inv;
  }
}

lemma EventReadElsewhere(s: Editor, id: int, revision: int, whole: bool)
  requires !(s.form.EditEvent? && s.target == id && !inFlight(s))
  ensures eventRead(s, id, revision, whole) == s.(latched := if whole then ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched) else s.latched)
{
  hide *;
  reveal eventRead, ProofLib.Filter;
}

lemma EventReadRulesElsewhere(s: Editor, id: int, revision: int, whole: bool)
  requires !(s.form.EditEvent? && s.target == id && !inFlight(s))
  requires inv(s)
  ensures inv(eventRead(s, id, revision, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventRead(s, id, revision, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventRead", eventRead(s, id, revision, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventRead", eventRead(s, id, revision, whole))
{
  hide *;
  EventReadElsewhere(s, id, revision, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, inFlight, discardable, kit__draft_keepMine, kit__draft_collide, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma EventReadSameSaving(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision == s.revision && s.draft.sync.Saving?
  ensures eventRead(s, id, revision, whole) == s.(latched := if whole then ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched) else s.latched, draft := kit__draft_keepMine(s.draft))
{
  hide *;
  reveal eventRead, ProofLib.Filter;
}

lemma EventReadRulesSameSaving(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision == s.revision && s.draft.sync.Saving?
  requires inv(s)
  ensures inv(eventRead(s, id, revision, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventRead(s, id, revision, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventRead", eventRead(s, id, revision, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventRead", eventRead(s, id, revision, whole))
{
  hide *;
  EventReadSameSaving(s, id, revision, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, inFlight, discardable, kit__draft_keepMine, kit__draft_collide, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma EventReadSameIdle(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision == s.revision && !s.draft.sync.Saving?
  ensures eventRead(s, id, revision, whole) == s.(latched := if whole then ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched) else s.latched)
{
  hide *;
  reveal eventRead, ProofLib.Filter;
}

lemma EventReadRulesSameIdle(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision == s.revision && !s.draft.sync.Saving?
  requires inv(s)
  ensures inv(eventRead(s, id, revision, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventRead(s, id, revision, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventRead", eventRead(s, id, revision, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventRead", eventRead(s, id, revision, whole))
{
  hide *;
  EventReadSameIdle(s, id, revision, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, inFlight, discardable, kit__draft_keepMine, kit__draft_collide, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma EventReadNewerKept(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision != s.revision && s.draft.sync.Kept?
  ensures eventRead(s, id, revision, whole) == s.(latched := if whole then ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched) else s.latched, revision := revision, draft := s.draft.(base := revision))
{
  hide *;
  reveal eventRead, ProofLib.Filter;
}

lemma EventReadRulesNewerKept(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision != s.revision && s.draft.sync.Kept?
  requires inv(s)
  ensures inv(eventRead(s, id, revision, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventRead(s, id, revision, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventRead", eventRead(s, id, revision, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventRead", eventRead(s, id, revision, whole))
{
  hide *;
  EventReadNewerKept(s, id, revision, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, inFlight, discardable, kit__draft_keepMine, kit__draft_collide, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma EventReadNewerEdited(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision != s.revision && !s.draft.sync.Kept?
  ensures eventRead(s, id, revision, whole) == s.(latched := if whole then ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched) else s.latched, revision := revision, draft := kit__draft_collide(s.draft, revision))
{
  hide *;
  reveal eventRead, ProofLib.Filter;
}

lemma EventReadRulesNewerEdited(s: Editor, id: int, revision: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && !inFlight(s) && revision != s.revision && !s.draft.sync.Kept?
  requires inv(s)
  ensures inv(eventRead(s, id, revision, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventRead(s, id, revision, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventRead", eventRead(s, id, revision, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventRead", eventRead(s, id, revision, whole))
{
  hide *;
  EventReadNewerEdited(s, id, revision, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, inFlight, discardable, kit__draft_keepMine, kit__draft_collide, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma eventRead_ensures(s: Editor, id: int, revision: int, whole: bool)
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysAnEventEndsAfterItStarts(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysASaveInFlightIsTheShownForm(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysARepeatingChangeSaysWhichOccurrences(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysEditsBuildOnTheEventAsRead(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysNothingWithPeopleOrVideoIsWritten(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysSeparateOnlyWhileACreateIsInDoubt(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysNoBlindDuplicate(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysASaveInDoubtHoldsItsForm(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysNothingIsSentOverAChangeInDoubt(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysAConfirmationBelongsToItsBanner(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysBannersBelongToTheirForm(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysASetAsideDraftIsKept(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysFormsKeepTheirDraftState(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> alwaysAnUnreadableSlotIsNeverWritten(eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> stepAWriteTakesTheNextNumber(s, eventRead(s, id, revision, whole), []))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> stepAnAnswerIsSavedOnlyOnceRead(s, "eventRead", eventRead(s, id, revision, whole)))
  ensures (inv(s) ==> canEventRead(s, id, revision, whole) ==> stepKeptEditsAreLostOnlyByChoice(s, "eventRead", eventRead(s, id, revision, whole)))
{
  hide *;
  if inv(s) && canEventRead(s, id, revision, whole) {
    if !(s.form.EditEvent? && s.target == id && !inFlight(s)) {
      EventReadRulesElsewhere(s, id, revision, whole);
    } else if revision == s.revision {
      if s.draft.sync.Saving? {
        EventReadRulesSameSaving(s, id, revision, whole);
      } else {
        EventReadRulesSameIdle(s, id, revision, whole);
      }
    } else if s.draft.sync.Kept? {
      EventReadRulesNewerKept(s, id, revision, whole);
    } else {
      EventReadRulesNewerEdited(s, id, revision, whole);
    }
    reveal inv;
  }
}

lemma EventMissingOpen(s: Editor, id: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && s.draft.sync.Saving?
  ensures eventMissing(s, id, whole) == withoutForm(s.write, s.(latched := ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched)))
{
  hide *;
  reveal eventMissing, ProofLib.Filter;
}

lemma EventMissingRulesOpen(s: Editor, id: int, whole: bool)
  requires s.form.EditEvent? && s.target == id && s.draft.sync.Saving?
  requires canEventMissing(s, id, whole)
  requires inv(s)
  ensures inv(eventMissing(s, id, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventMissing(s, id, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventMissing", eventMissing(s, id, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventMissing", eventMissing(s, id, whole))
{
  hide *;
  EventMissingOpen(s, id, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, canEventMissing, inFlight, withoutForm, kit__draft_blank, discardable, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma EventMissingElsewhere(s: Editor, id: int, whole: bool)
  requires !(s.form.EditEvent? && s.target == id && s.draft.sync.Saving?)
  ensures eventMissing(s, id, whole) == s.(latched := ProofLib.Filter((set_x: int) => !((set_x in [id])), s.latched))
{
  hide *;
  reveal eventMissing, ProofLib.Filter;
}

lemma EventMissingRulesElsewhere(s: Editor, id: int, whole: bool)
  requires !(s.form.EditEvent? && s.target == id && s.draft.sync.Saving?)
  requires canEventMissing(s, id, whole)
  requires inv(s)
  ensures inv(eventMissing(s, id, whole))
  ensures stepAWriteTakesTheNextNumber(s, eventMissing(s, id, whole), [])
  ensures stepAnAnswerIsSavedOnlyOnceRead(s, "eventMissing", eventMissing(s, id, whole))
  ensures stepKeptEditsAreLostOnlyByChoice(s, "eventMissing", eventMissing(s, id, whole))
{
  hide *;
  EventMissingElsewhere(s, id, whole);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.target);
  ProofLib.FilterMember((set_x: int) => !((set_x in [id])), s.latched, s.writing);
  reveal inv, canEventMissing, inFlight, withoutForm, kit__draft_blank, discardable, kit__draft_canChoose, kit__draft_unsaved,
    alwaysAnEventEndsAfterItStarts, alwaysASaveInFlightIsTheShownForm, alwaysARepeatingChangeSaysWhichOccurrences,
    alwaysEditsBuildOnTheEventAsRead, alwaysNothingWithPeopleOrVideoIsWritten, alwaysSeparateOnlyWhileACreateIsInDoubt,
    alwaysNoBlindDuplicate, alwaysASaveInDoubtHoldsItsForm, alwaysNothingIsSentOverAChangeInDoubt,
    alwaysAConfirmationBelongsToItsBanner, alwaysBannersBelongToTheirForm, alwaysASetAsideDraftIsKept,
    alwaysFormsKeepTheirDraftState, alwaysAnUnreadableSlotIsNeverWritten,
    stepAWriteTakesTheNextNumber, stepAnAnswerIsSavedOnlyOnceRead, stepKeptEditsAreLostOnlyByChoice;
}

lemma eventMissing_ensures(s: Editor, id: int, whole: bool)
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysAnEventEndsAfterItStarts(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysASaveInFlightIsTheShownForm(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysARepeatingChangeSaysWhichOccurrences(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysEditsBuildOnTheEventAsRead(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysNothingWithPeopleOrVideoIsWritten(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysSeparateOnlyWhileACreateIsInDoubt(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysNoBlindDuplicate(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysASaveInDoubtHoldsItsForm(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysNothingIsSentOverAChangeInDoubt(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysAConfirmationBelongsToItsBanner(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysBannersBelongToTheirForm(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysASetAsideDraftIsKept(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysFormsKeepTheirDraftState(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> alwaysAnUnreadableSlotIsNeverWritten(eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> stepAWriteTakesTheNextNumber(s, eventMissing(s, id, whole), []))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> stepAnAnswerIsSavedOnlyOnceRead(s, "eventMissing", eventMissing(s, id, whole)))
  ensures (inv(s) ==> canEventMissing(s, id, whole) ==> stepKeptEditsAreLostOnlyByChoice(s, "eventMissing", eventMissing(s, id, whole)))
{
  hide *;
  if inv(s) && canEventMissing(s, id, whole) {
    if s.form.EditEvent? && s.target == id && s.draft.sync.Saving? {
      EventMissingRulesOpen(s, id, whole);
    } else {
      EventMissingRulesElsewhere(s, id, whole);
    }
    reveal inv;
  }
}
