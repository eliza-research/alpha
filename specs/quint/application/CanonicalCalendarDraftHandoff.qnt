// Current canonical Calendar receiver shared by mounted Note and scan review.
module CanonicalCalendarDraftHandoff {
  // noteNotice is the last captured Note toast event; its on-screen timeout is separate.
  // Successful draft routing emits no new toast, so it preserves that event.
  type State = {owner: int, view: str, ready: bool, editor: str, retained: str,
    busy: str, scanOpen: bool, scanNotice: str, noteNotice: str}
  var s: State

  action initWith(ready: bool): bool = s' = {owner: 1, view: "home", ready: ready, editor: "", retained: "",
    busy: "", scanOpen: false, scanNotice: "", noteNotice: ""}
  action init = initWith(true)

  val admissionOpen = s.ready and s.editor == "" and s.retained == "" and s.busy == ""
  action retainEarlier = all {
    s.view == "home", admissionOpen,
    s' = {...s, view: "calendar", retained: "earlier"},
  }
  action home = all {
    s.view != "home", s.editor == "", not(s.scanOpen),
    s' = {...s, view: "home"},
  }
  action openCalendar = all {s.view == "home", s' = {...s, view: "calendar"}}
  action openNote = all {s.view == "home", s' = {...s, view: "notes"}}
  action openScan = all {s.view == "home", s' = {...s, view: "camera", scanOpen: true, scanNotice: ""}}
  action closeScan = all {s.scanOpen, s' = {...s, scanOpen: false, scanNotice: ""}}
  action requestNote = all {
    s.view == "notes",
    s' = if (admissionOpen) {...s, view: "calendar", editor: "note", retained: "note"}
      else {...s, noteNotice: "note-refused"},
  }
  action requestScan = all {
    s.view == "camera", s.scanOpen,
    s' = if (admissionOpen) {...s, view: "calendar", editor: "scan", retained: "scan", scanOpen: false, scanNotice: ""}
      else {...s, scanNotice: "scan-refused"},
  }
  action requestReminder = all {
    s.view == "notes",
    s' = {...s, view: "calendar", editor: "reminder"},
  }
  action closeForm = all {
    s.view == "calendar", s.editor != "",
    s' = {...s, editor: ""},
  }
  action beginDiscard = all {
    s.view == "calendar", s.editor == "", s.retained != "", s.busy == "",
    s' = {...s, busy: "consume"},
  }
  action endDiscard = all {
    s.busy == "consume",
    s' = {...s, busy: "", retained: if (s.editor == "") "" else s.retained},
  }
  action beginOwnerOpen = all {
    s.owner == 1, s.view == "home", s.ready, s.editor == "", s.busy == "",
    s' = {...s, owner: 2, ready: true, retained: "", busy: "open"},
  }
  action endOwnerOpen = all {
    s.busy == "open", s' = {...s, busy: ""},
  }
  action step = any {
    retainEarlier, home, openCalendar, openNote, openScan, closeScan, requestNote, requestScan, requestReminder,
    closeForm, beginDiscard, endDiscard, beginOwnerOpen, endOwnerOpen, s' = s,
  }

  val OriginReviewIsScoped = (s.scanOpen implies s.view == "camera") and (s.scanNotice != "" implies s.scanOpen)
  val CanonicalEditorUsesSlot = s.editor.in(Set("note", "scan")) implies
    (s.view == "calendar" and s.ready and s.retained == s.editor and s.busy == "")
  val LoadingSlotHasNoOldDraft = s.busy == "open" implies (s.owner == 2 and s.retained == "")
  val safety = OriginReviewIsScoped and CanonicalEditorUsesSlot and LoadingSlotHasNoOldDraft

  run noteAndReminderUseSeparateDraftAdmissionTest = init.then(retainEarlier).then(home).then(openNote)
    .then(requestNote).expect(s.view == "notes" and s.retained == "earlier" and s.noteNotice == "note-refused")
    .then(requestReminder).expect(s.editor == "reminder" and s.retained == "earlier" and safety)
  run scanRefusalKeepsReviewAndRetainedDraftTest = init.then(retainEarlier).then(home).then(openScan).then(requestScan)
    .expect(s.scanOpen and s.scanNotice == "scan-refused" and s.retained == "earlier" and safety)
  run deliberateClearAdmitsFreshScanTest = init.then(retainEarlier).then(beginDiscard).then(endDiscard)
    .then(home).then(openScan).then(requestScan)
    .expect(not(s.scanOpen) and s.editor == "scan" and safety)
  run pendingConsumeDoesNotAdmitNoteTest = init.then(retainEarlier).then(beginDiscard).then(home).then(openNote)
    .then(requestNote).expect(s.view == "notes" and s.busy == "consume")
    .then(endDiscard).then(requestNote).expect(s.editor == "note" and safety)
  run openingReplacementSlotDoesNotAdmitIncomingDraftTest = init.then(retainEarlier).then(home).then(beginOwnerOpen)
    .then(openNote).then(requestNote).expect(s.view == "notes" and s.busy == "open" and s.retained == "")
    .then(endOwnerOpen).then(requestNote).expect(s.owner == 2 and s.editor == "note" and safety)
  run unavailableCanonicalSourceRetainsOriginTest = initWith(false).then(openNote).then(requestNote)
    .expect(s.view == "notes" and s.editor == "" and s.noteNotice == "note-refused" and safety)
}
