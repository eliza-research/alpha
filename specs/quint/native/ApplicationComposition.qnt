module IdentityComponent {
  const instance: int
  import IdentitySession.* from "../services/IdentitySession"
  export IdentitySession.s
  export IdentitySession.init
  export IdentitySession.safety
  export IdentitySession.begin
  export IdentitySession.callback
  export IdentitySession.codeVerified
  export IdentitySession.exchanged
  export IdentitySession.writeReceipt
  export IdentitySession.writeKey
  export IdentitySession.ack
  export IdentitySession.signOut
  export IdentitySession.revokePrevious
  export IdentitySession.releaseSteward
  export IdentitySession.browserClosed
  export IdentitySession.wrongCode
  export IdentitySession.mfaVerified
  export IdentitySession.storageFailure
  export IdentitySession.restart
  export IdentitySession.cooldownElapsed
  export IdentitySession.cancel
  export IdentitySession.expire
}
module VoiceComponent {
  const instance: int
  import VoiceSession.* from "./VoiceSession"
  export VoiceSession.s
  export VoiceSession.init
  export VoiceSession.safety
  export VoiceSession.stop
  export VoiceSession.start
  export VoiceSession.segment
  export VoiceSession.submit
  export VoiceSession.reply
  export VoiceSession.sentenceFinished
  export VoiceSession.playbackFinished
  export VoiceSession.discloseCloud
  export VoiceSession.speechStarts
  export VoiceSession.shortGap
  export VoiceSession.endpointResult
  export VoiceSession.bargeIn
  export VoiceSession.mute
  export VoiceSession.resumeReview
  export VoiceSession.finishDictation
}
module ResidentComponent {
  const instance: int
  import ResidentRuntime.* from "./ResidentRuntime"
  export ResidentRuntime.s
  export ResidentRuntime.init
  export ResidentRuntime.safety
  export ResidentRuntime.clearBinding
  export ResidentRuntime.replaceCredential
  export ResidentRuntime.revokeCredential
  export ResidentRuntime.start
  export ResidentRuntime.started
  export ResidentRuntime.attachStart
  export ResidentRuntime.cancelAttachedStart
  export ResidentRuntime.cancelOwnedStart
  export ResidentRuntime.requestStop
  export ResidentRuntime.shutdownConfirmed
  export ResidentRuntime.shutdownUnconfirmed
  export ResidentRuntime.beginBinding
  export ResidentRuntime.bindingResult
  export ResidentRuntime.inference
  export ResidentRuntime.requestReset
  export ResidentRuntime.crash
  export ResidentRuntime.chooseProfile
  export ResidentRuntime.invalidatePackage
  export ResidentRuntime.archiveReview
}
module CalendarComponent {
  const instance: int
  import CalendarSync.* from "../services/CalendarSync"
  export CalendarSync.s
  export CalendarSync.init
  export CalendarSync.safety
  export CalendarSync.switchOwner
  export CalendarSync.revoke
  export CalendarSync.restorePermission
  export CalendarSync.enqueue
  export CalendarSync.claim
  export CalendarSync.checkRevision
  export CalendarSync.dispatch
  export CalendarSync.completed
  export CalendarSync.lostReply
  export CalendarSync.reviewConsent
  export CalendarSync.localChange
  export CalendarSync.setConsent
  export CalendarSync.undo
  export CalendarSync.deadline
  export CalendarSync.rebootClock
  export CalendarSync.resolvePaused
  export CalendarSync.providerFailure
  export CalendarSync.findCreated
  export CalendarSync.resolveUncertain
  export CalendarSync.resolveConflict
  export CalendarSync.remoteEdit
  export CalendarSync.network
  export CalendarSync.restart
}
module InboxComponent {
  const instance: int
  import InboxDelivery.* from "../services/InboxDelivery"
  export InboxDelivery.s
  export InboxDelivery.init
  export InboxDelivery.safety
  export InboxDelivery.switchOwner
  export InboxDelivery.withdrawRead
  export InboxDelivery.restoreGrants
  export InboxDelivery.prepare
  export InboxDelivery.review
  export InboxDelivery.confirm
  export InboxDelivery.providerReply
  export InboxDelivery.readReceipt
  export InboxDelivery.cacheRead
  export InboxDelivery.editDraft
  export InboxDelivery.attach
  export InboxDelivery.restart
  export InboxDelivery.cleanupDraft
  export InboxDelivery.cancelReview
  export InboxDelivery.withdrawModify
}
module ResetComponent {
  const instance: int
  import ResetRecovery.* from "./ResetRecovery"
  export ResetRecovery.s
  export ResetRecovery.init
  export ResetRecovery.safety
  export ResetRecovery.beginReview
  export ResetRecovery.confirm
  export ResetRecovery.authenticate
  export ResetRecovery.attempt
  export ResetRecovery.observeErased
  export ResetRecovery.retireActivity
  export ResetRecovery.listenerAvailability
  export ResetRecovery.corruptBudget
  export ResetRecovery.launch
  export ResetRecovery.userRetry
  export ResetRecovery.newAutomaticWindow
  export ResetRecovery.lateFailure
}

// Product coordinator composed from six executable domain modules.
module ApplicationComposition {
  import IdentityComponent(instance = 1) as Identity
  import VoiceComponent(instance = 2) as Voice
  import ResidentComponent(instance = 3) as Resident
  import CalendarComponent(instance = 4) as Calendar
  import InboxComponent(instance = 5) as Inbox
  import ResetComponent(instance = 6) as Reset

  // Public read-only projection for implementation trace observations.
  val state = { identity: Identity::s, voice: Voice::s, resident: Resident::s,
    calendar: Calendar::s, inbox: Inbox::s, reset: Reset::s }
  type Host = {foreground: bool, voiceOwner: int, voiceIdentityEpoch: int}
  var host: Host
  action init = all {
    Identity::init, Voice::init, Resident::init, Calendar::init, Inbox::init, Reset::init,
    host' = {foreground: true, voiceOwner: 0, voiceIdentityEpoch: -1}
  }
  action keepHost = host' = host
  action keepIdentity = Identity::s' = Identity::s
  action keepVoice = Voice::s' = Voice::s
  action keepResident = Resident::s' = Resident::s
  action keepCalendar = Calendar::s' = Calendar::s
  action keepInbox = Inbox::s' = Inbox::s
  action keepReset = Reset::s' = Reset::s
  action keep = all {keepHost, keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepReset}
  action stopVoice = if (Voice::s.phase == "idle") keepVoice else Voice::stop

  val credentialPresent = Identity::s.owner != 0 and (Identity::s.key or Identity::s.oldKey)
  // Precommit sign-in keeps the prior account and resident available. A newly
  // committed key becomes active only after acknowledgement finishes.
  val accountReady = Identity::s.owner != 0 and
    ((Identity::s.phase == "authenticated" and Identity::s.key) or
      (Identity::s.oldKey and not(Identity::s.key))) and
    not(Reset::s.marker) and not(Resident::s.resetPending)
  val OwnerAgreement = Identity::s.owner == 0 or
    (Identity::s.owner == Calendar::s.owner and Identity::s.owner == Inbox::s.owner)
  val VoiceAccountBound = Voice::s.phase == "idle" or
    (accountReady and Resident::s.phase == "ready" and Resident::s.provider == "cloud"
      and Resident::s.credential and Resident::s.bindingEpoch == Resident::s.epoch
      and host.foreground and host.voiceOwner == Identity::s.owner and host.voiceIdentityEpoch == Identity::s.ownerEpoch)
  val ResetStopsConsumers = Reset::s.marker implies
    (Resident::s.resetPending and not(Resident::s.localProcess) and Voice::s.phase == "idle" and not(Inbox::s.read))
  val InferenceAccountBound = Resident::s.inferenceAccepted implies accountReady
  val safety = Identity::safety and Voice::safety and Resident::safety and Calendar::safety and Inbox::safety and Reset::safety and OwnerAgreement and VoiceAccountBound and ResetStopsConsumers and InferenceAccountBound
  action check(condition: bool): bool = all { assert(condition), keep }
  // Every composite transition frames all unaffected imported variables explicitly.
  action beginSignIn(method: str): bool = all {
    host.foreground, not(Reset::s.marker), not(Resident::s.resetPending),
    Identity::begin(method), keepVoice, keepResident,
    keepCalendar, keepInbox, keepReset, keepHost
  }
  action acceptIdentityKey = all {
    not(Reset::s.marker), not(Resident::s.resetPending), Identity::writeKey,
    if (Identity::s.attemptOwner == Calendar::s.owner) keepCalendar else Calendar::switchOwner,
    if (Identity::s.attemptOwner == Inbox::s.owner) keepInbox else Inbox::switchOwner,
    Resident::replaceCredential, stopVoice, keepReset, keepHost
  }
  action startVoice = all {
    host.foreground, accountReady, Resident::s.phase == "ready",
    Resident::s.provider == "cloud", Resident::s.bindingEpoch == Resident::s.epoch,
    Voice::start(false, true), keepIdentity, keepResident, keepCalendar, keepInbox, keepReset,
    host' = {foreground: true, voiceOwner: Identity::s.owner, voiceIdentityEpoch: Identity::s.ownerEpoch}
  }
  action signOut = all {
    Identity::signOut, stopVoice, Resident::revokeCredential,
    Calendar::revoke, Inbox::withdrawRead, keepReset, keepHost
  }
  action hide = all {
    stopVoice, keepIdentity, keepResident, keepCalendar, keepInbox, keepReset,
    host' = host.with("foreground", false)
  }
  action resume = all {
    not(Reset::s.marker), not(Resident::s.resetPending),
    keepVoice, keepIdentity, keepResident, keepCalendar, keepInbox, keepReset,
    host' = host.with("foreground", true)
  }
  action beginReset = all {
    host.foreground, Reset::s.authGeneration < 3, Reset::beginReview, stopVoice,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepHost
  }
  action authenticateReset(ticket: int, accepted: bool, stored: bool): bool = all {
    Reset::authenticate(ticket, accepted, stored),
    if (Reset::s.review and Reset::s.confirmed and Reset::s.authGeneration < 4 and ticket == Reset::s.authGeneration and accepted and stored)
      all {
        Resident::requestReset, stopVoice,
        if (Identity::s.owner == 0) keepIdentity else Identity::signOut,
        Calendar::revoke, Inbox::withdrawRead, host' = host.with("foreground", false)
      }
    else all {keepResident, keepVoice, keepIdentity, keepCalendar, keepInbox, keepHost}
  }
  action residentCrash(needsReview: bool): bool = all {
    Resident::crash(needsReview), stopVoice,
    keepIdentity, keepCalendar, keepInbox, keepReset, keepHost
  }
  action identityCallback(token: int): bool = all {
    host.foreground, not(Reset::s.marker), Identity::callback(token),
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action verifyCode(mfa: bool): bool = all {
    host.foreground, not(Reset::s.marker), Identity::codeVerified(mfa),
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action identityExchanged = all {
    not(Reset::s.marker), Identity::exchanged,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action saveIdentityReceipt = all {
    not(Reset::s.marker), Identity::writeReceipt,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action acknowledgeIdentity(success: bool): bool = all {
    not(Reset::s.marker), Identity::ack(success),
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action revokePreviousIdentity(success: bool): bool = all {
    not(Reset::s.marker), Identity::revokePrevious(success),
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action releaseIdentitySession = all {
    Identity::releaseSteward,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action startResident = all {
    not(Reset::s.marker), not(Resident::s.resetPending), Resident::start,
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action attachResidentStart = all {
    Resident::attachStart, keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action cancelAttachedResidentStart = all {
    Resident::cancelAttachedStart, keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action stopResident = all {
    Resident::requestStop, stopVoice, keepIdentity, keepCalendar, keepInbox, keepReset, keepHost
  }
  action cancelOwnedResidentStart = all {
    Resident::cancelOwnedStart, stopVoice, keepIdentity, keepCalendar, keepInbox, keepReset, keepHost
  }
  action residentShutdownConfirmed = all {
    Resident::shutdownConfirmed, keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action residentShutdownUnconfirmed = all {
    Resident::shutdownUnconfirmed, keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action residentStarted(ticket: int): bool = all {
    Resident::started(ticket),
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action beginBinding = all {
    accountReady, Resident::beginBinding,
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action bindingReply(ticket: int): bool = all {
    Resident::bindingResult(ticket, accountReady),
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action runInference = all {
    accountReady, Resident::inference,
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceSegment(ticket: int): bool = all {
    Voice::segment(ticket, true),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceSubmit = all {
    accountReady, host.foreground, Voice::submit(true),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceReply(session: int, turn: int): bool = all {
    Voice::reply(session, turn, false),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceSentence(session: int, turn: int): bool = all {
    Voice::sentenceFinished(session, turn),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceFinished = all {
    Voice::playbackFinished,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action calendarEnqueue(kind: str): bool = all {
    accountReady, host.foreground, Calendar::enqueue(kind, false),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarClaim = all {
    accountReady, Calendar::claim,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarCheck = all {
    accountReady, Calendar::checkRevision,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarDispatch = all {
    accountReady, Calendar::dispatch,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarCompleted = all {
    accountReady, Calendar::completed,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarLostReply = all {
    accountReady, Calendar::lostReply,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action inboxPrepare = all {
    accountReady, host.foreground, Inbox::prepare,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxReview = all {
    accountReady, host.foreground, Inbox::review(true),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxConfirm = all {
    accountReady, host.foreground, Inbox::confirm,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxReply = all {
    accountReady, Inbox::providerReply("succeeded"),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxRecover = all {
    accountReady, Inbox::readReceipt(false),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action confirmReset(ticket: int): bool = all {
    Reset::confirm(ticket),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action attemptReset(ack: bool, accepted: bool): bool = all {
    Reset::attempt(ack, accepted, true),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action observeErased = all {
    Reset::observeErased,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }

  // User actions, environmental callbacks and durable recovery all use the
  // imported domain transitions, with account/reset coordination above.
  action identityBrowserClosed = all {
    not(Reset::s.marker), Identity::browserClosed,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action identityWrongCode = all {
    host.foreground, not(Reset::s.marker), Identity::wrongCode,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action verifyMfa = all {
    host.foreground, not(Reset::s.marker), Identity::mfaVerified,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action identityStorageFailure = all {
    not(Reset::s.marker), Identity::storageFailure,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action restartIdentityAcknowledgement = all {
    not(Reset::s.marker), Identity::restart,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action identityCooldownElapsed = all {
    Identity::cooldownElapsed,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action expireIdentityAttempt = all {
    Identity::expire,
    keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action cancelSignIn = all {
    Identity::cancel, stopVoice,
    keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action discloseCloudVoice = all {
    accountReady, host.foreground, Voice::discloseCloud,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceSpeechStarts = all {
    accountReady, host.foreground, Voice::speechStarts,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceShortGap = all {
    accountReady, host.foreground, Voice::shortGap,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceEndpoint(ticket: int, complete: bool): bool = all {
    Voice::endpointResult(ticket, complete),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action submitVoiceEndpoint = all {
    accountReady, host.foreground, Voice::submit(false),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceReviewReply(session: int, turn: int): bool = all {
    Voice::reply(session, turn, true),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action resumeVoiceReview(session: int, turn: int, matches: bool): bool = all {
    accountReady, host.foreground, Voice::resumeReview(session, turn, matches),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action voiceBargeIn(confirmed: bool): bool = all {
    accountReady, host.foreground, Voice::bargeIn(confirmed),
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action toggleVoiceMute = all {
    accountReady, host.foreground, Voice::mute,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action finishDictation = all {
    Voice::finishDictation,
    keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action stopVoiceSession = all {
    stopVoice, keepIdentity, keepResident, keepCalendar, keepInbox, keepReset, keepHost
  }
  action startDictation = all {
    host.foreground, accountReady, Resident::s.phase == "ready",
    Resident::s.provider == "cloud", Resident::s.bindingEpoch == Resident::s.epoch,
    Voice::start(true, false), keepIdentity, keepResident, keepCalendar, keepInbox, keepReset,
    host' = {foreground: true, voiceOwner: Identity::s.owner, voiceIdentityEpoch: Identity::s.ownerEpoch}
  }
  action chooseResidentProfile(profile: str): bool = all {
    not(Reset::s.marker), not(Resident::s.resetPending), Resident::chooseProfile(profile),
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action invalidateResidentPackage = all {
    Resident::invalidatePackage,
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action reviewResidentRecovery(accepted: bool): bool = all {
    not(Reset::s.marker), Resident::archiveReview(accepted),
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action clearResidentBinding(confirmed: bool): bool = all {
    Resident::clearBinding(confirmed), stopVoice,
    keepIdentity, keepCalendar, keepInbox, keepReset, keepHost
  }
  action bindingOutcome(ticket: int, valid: bool): bool = all {
    Resident::bindingResult(ticket, valid and accountReady),
    keepIdentity, keepVoice, keepCalendar, keepInbox, keepReset, keepHost
  }
  action calendarReviewConsent = all {
    accountReady, host.foreground, Calendar::reviewConsent,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarLocalChange = all {
    accountReady, host.foreground, Calendar::localChange,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarConsent(accepted: bool): bool = all {
    accountReady, host.foreground, Calendar::setConsent(accepted),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarEnqueueLinked(kind: str): bool = all {
    accountReady, host.foreground, Calendar::enqueue(kind, true),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarUndo = all {
    accountReady, host.foreground, Calendar::undo,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarDeadline = all {
    Calendar::deadline,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarClockChanged = all {
    Calendar::rebootClock,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarResolvePaused(send: bool): bool = all {
    accountReady, host.foreground, Calendar::resolvePaused(send),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarProviderFailure = all {
    accountReady, Calendar::providerFailure,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarFindCreated(found: bool): bool = all {
    accountReady, Calendar::findCreated(found),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarResolveUncertain(send: bool): bool = all {
    accountReady, host.foreground, Calendar::resolveUncertain(send),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarResolveConflict(mine: bool): bool = all {
    accountReady, host.foreground, Calendar::resolveConflict(mine),
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarRemoteEdit = all {
    Calendar::remoteEdit,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarNetwork = all {
    Calendar::network,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action restartCalendar = all {
    Calendar::restart,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action inboxCacheRead = all {
    accountReady, Inbox::cacheRead,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxEditDraft = all {
    accountReady, host.foreground, Inbox::s.phase.in(Set("empty", "preparing", "review")), Inbox::editDraft,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxAttach = all {
    accountReady, host.foreground, Inbox::s.phase.in(Set("empty", "preparing", "review")), Inbox::attach,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxReviewResult(exact: bool): bool = all {
    accountReady, host.foreground, Inbox::review(exact),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action restartInbox = all {
    Inbox::restart,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxCleanup = all {
    accountReady, Inbox::cleanupDraft,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxCancelReview = all {
    host.foreground, Inbox::cancelReview,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxWithdrawModify = all {
    Inbox::withdrawModify,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxReceipt(agrees: bool): bool = all {
    accountReady, Inbox::readReceipt(agrees),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxProviderResult(outcome: str): bool = all {
    accountReady, Inbox::providerReply(outcome),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action cancelResetReview = all {
    Reset::s.review, Reset::retireActivity,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action resetListener(present: bool): bool = all {
    Reset::listenerAvailability(present),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action resetBudgetFailure = all {
    Reset::corruptBudget,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action launchResetRecovery(visible: bool): bool = all {
    Reset::launch(visible),
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action retryReset = all {
    Reset::userRetry,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action resetAutomaticWindow = all {
    Reset::newAutomaticWindow,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  action lateResetFailure = all {
    Reset::lateFailure,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepInbox, keepHost
  }
  // A process restart retires volatile voice/runtime work and recovers the
  // existing durable identities. Bounds permit one Calendar restart per run.
  action restartApplication = all {
    Calendar::s.instance < 2,
    not(Resident::s.phase.in(Set("ready", "starting"))) or Resident::s.epoch < 3,
    if (Identity::s.phase.in(Set("activation-pending", "acknowledging")) and Identity::s.receipt and Identity::s.key)
      Identity::restart
    else if (Identity::s.phase.in(Set("code", "mfa", "exchange", "minted", "receipt-saved")) and not(Identity::s.key))
      Identity::cancel else keepIdentity,
    if (Voice::s.session < 2) Voice::stop else keepVoice,
    if (Resident::s.phase.in(Set("ready", "starting"))) Resident::crash(false) else keepResident,
    Calendar::restart, Inbox::restart,
    if (Reset::s.marker) Reset::launch(host.foreground)
    else if (Reset::s.review) Reset::retireActivity else keepReset,
    host' = {foreground: not(Reset::s.marker) and not(Resident::s.resetPending),
      voiceOwner: 0, voiceIdentityEpoch: -1}
  }
  action calendarPermissionLost = all {
    Calendar::revoke, keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action calendarRestorePermission = all {
    accountReady, Calendar::s.owner == Identity::s.owner, Calendar::restorePermission,
    keepIdentity, keepVoice, keepResident, keepInbox, keepReset, keepHost
  }
  action inboxWithdrawRead = all {
    Inbox::withdrawRead, keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action inboxRestoreGrants = all {
    accountReady, Inbox::s.owner == Identity::s.owner, Inbox::restoreGrants,
    keepIdentity, keepVoice, keepResident, keepCalendar, keepReset, keepHost
  }
  action step = any {
    calendarPermissionLost, calendarRestorePermission, inboxWithdrawRead, inboxRestoreGrants,
    beginSignIn("google"),
    beginSignIn("email"),
    beginSignIn("phone"),
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      identityCallback(ticket)
    },
    {
      nondet result = Set(false, true).oneOf()
      verifyCode(result)
    },
    verifyMfa,
    identityBrowserClosed,
    identityWrongCode,
    cancelSignIn,
    expireIdentityAttempt,
    identityCooldownElapsed,
    identityStorageFailure,
    identityExchanged,
    saveIdentityReceipt,
    acceptIdentityKey,
    {
      nondet result = Set(false, true).oneOf()
      acknowledgeIdentity(result)
    },
    restartIdentityAcknowledgement,
    {
      nondet result = Set(false, true).oneOf()
      revokePreviousIdentity(result)
    },
    releaseIdentitySession,
    startResident, attachResidentStart, cancelAttachedResidentStart, stopResident,
    cancelOwnedResidentStart, residentShutdownConfirmed, residentShutdownUnconfirmed,
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      residentStarted(ticket)
    },
    beginBinding,
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      bindingReply(ticket)
    },
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet result = Set(false, true).oneOf()
      bindingOutcome(ticket, result)
    },
    runInference,
    chooseResidentProfile("native"),
    chooseResidentProfile("cloud"),
    invalidateResidentPackage,
    {
      nondet result = Set(false, true).oneOf()
      clearResidentBinding(result)
    },
    {
      nondet result = Set(false, true).oneOf()
      reviewResidentRecovery(result)
    },
    startVoice,
    startDictation,
    discloseCloudVoice,
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      voiceSegment(ticket)
    },
    voiceSpeechStarts,
    voiceShortGap,
    {
      nondet turn = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet result = Set(false, true).oneOf()
      voiceEndpoint(turn, result)
    },
    voiceSubmit,
    submitVoiceEndpoint,
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet turn = Set(-1, 0, 1, 2, 3, 4).oneOf()
      voiceReply(ticket, turn)
    },
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet turn = Set(-1, 0, 1, 2, 3, 4).oneOf()
      voiceReviewReply(ticket, turn)
    },
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet turn = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet result = Set(false, true).oneOf()
      resumeVoiceReview(ticket, turn, result)
    },
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet turn = Set(-1, 0, 1, 2, 3, 4).oneOf()
      voiceSentence(ticket, turn)
    },
    voiceFinished,
    {
      nondet result = Set(false, true).oneOf()
      voiceBargeIn(result)
    },
    toggleVoiceMute,
    stopVoiceSession,
    finishDictation,
    calendarEnqueue("update"),
    calendarEnqueue("create"),
    calendarEnqueue("delete"),
    calendarEnqueueLinked("update"),
    calendarReviewConsent,
    {
      nondet result = Set(false, true).oneOf()
      calendarConsent(result)
    },
    calendarLocalChange,
    calendarUndo,
    calendarDeadline,
    calendarClockChanged,
    {
      nondet result = Set(false, true).oneOf()
      calendarResolvePaused(result)
    },
    calendarRemoteEdit,
    calendarNetwork,
    calendarClaim,
    calendarCheck,
    calendarDispatch,
    calendarCompleted,
    calendarLostReply,
    calendarProviderFailure,
    {
      nondet result = Set(false, true).oneOf()
      calendarFindCreated(result)
    },
    {
      nondet result = Set(false, true).oneOf()
      calendarResolveUncertain(result)
    },
    {
      nondet result = Set(false, true).oneOf()
      calendarResolveConflict(result)
    },
    restartCalendar,
    inboxPrepare,
    inboxReview,
    {
      nondet result = Set(false, true).oneOf()
      inboxReviewResult(result)
    },
    inboxConfirm,
    inboxReply,
    inboxRecover,
    inboxCacheRead,
    inboxEditDraft,
    inboxAttach,
    inboxCancelReview,
    inboxWithdrawModify,
    {
      nondet outcome = Set("succeeded", "rejected", "unknown", "prepared").oneOf()
      inboxProviderResult(outcome)
    },
    {
      nondet result = Set(false, true).oneOf()
      inboxReceipt(result)
    },
    inboxCleanup,
    restartInbox,
    signOut,
    hide,
    resume,
    {
      nondet result = Set(false, true).oneOf()
      residentCrash(result)
    },
    restartApplication,
    beginReset,
    cancelResetReview,
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      confirmReset(ticket)
    },
    {
      nondet ticket = Set(-1, 0, 1, 2, 3, 4).oneOf()
      nondet accepted = Set(false, true).oneOf()
      nondet stored = Set(false, true).oneOf()
      authenticateReset(ticket, accepted, stored)
    },
    {
      nondet accepted = Set(false, true).oneOf()
      nondet ack = Set(false, true).oneOf()
      attemptReset(ack, accepted)
    },
    {
      nondet result = Set(false, true).oneOf()
      resetListener(result)
    },
    resetBudgetFailure,
    {
      nondet result = Set(false, true).oneOf()
      launchResetRecovery(result)
    },
    retryReset,
    resetAutomaticWindow,
    lateResetFailure,
    observeErased,
    keep,
  }

  run signInAndVoiceTest = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(startResident).then(residentStarted(1)).then(beginBinding).then(bindingReply(1))
    .then(runInference).then(startVoice).then(voiceSegment(0)).then(voiceSubmit)
    .then(voiceReply(0, 1)).then(voiceSentence(0, 1)).then(voiceSentence(0, 1)).then(voiceFinished)
    .then(check(safety and Voice::s.heard == 2 and Resident::s.inferenceAccepted))

  run replacementSetup = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(startResident).then(residentStarted(1)).then(beginBinding).then(bindingReply(1))
    .then(startVoice).then(voiceSegment(0)).then(voiceSubmit)
    .then(calendarEnqueue("update")).then(calendarClaim).then(calendarCheck)
    .then(inboxPrepare).then(inboxReview)
    .then(beginSignIn("google")).then(identityCallback(2)).then(identityExchanged)
    .then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(revokePreviousIdentity(false)).then(releaseIdentitySession)
    .then(voiceReply(0, 1)).then(bindingReply(1))

  run accountReplacementRetiresPendingWorkTest = replacementSetup
    .then(check(safety and Identity::s.owner == 2 and Voice::s.phase == "idle" and
      Calendar::s.requestEpoch != Calendar::s.epoch and Inbox::s.requestEpoch != Inbox::s.epoch))
  // fail() terminates the scenario at the rejected actual imported action.
  run retiredCalendarDispatchRejectedTest = replacementSetup.then(calendarDispatch.fail())
  run retiredInboxConfirmRejectedTest = replacementSetup.then(inboxConfirm.fail())

  run resetSetup = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(startResident).then(residentStarted(1)).then(beginBinding).then(bindingReply(1)).then(startVoice)
    .then(calendarEnqueue("create")).then(calendarClaim).then(calendarDispatch)
    .then(inboxPrepare).then(inboxReview).then(inboxConfirm)
    .then(beginReset).then(confirmReset(1)).then(authenticateReset(1, true, true))

  run resetCalendarCompletionRejectedTest = resetSetup.then(calendarCompleted.fail())
  run resetInboxReplyRejectedTest = resetSetup.then(inboxReply.fail())
  run resetDuringDispatchedEffectsTest = resetSetup
    .then(attemptReset(false, true)).then(check(safety and Reset::s.marker and not(Reset::s.erased)))
    .then(attemptReset(true, true)).then(observeErased)
    .then(check(safety and Reset::s.erased and Resident::s.phase == "stopped" and Voice::s.phase == "idle"))

  run backgroundRetiresVoiceGenerationTest = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(startResident).then(residentStarted(1)).then(beginBinding).then(bindingReply(1))
    .then(startVoice).then(voiceSegment(0)).then(voiceSubmit).then(hide)
    .then(voiceReply(0, 1)).then(resume)
    .then(check(safety and Voice::s.phase == "idle" and Voice::s.heard == 0))

  // Canary: omission of coordinated retirement must violate the shared invariant.
  run uncoordinatedIdentityChangeDetectedTest = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(startResident).then(residentStarted(1)).then(beginBinding).then(bindingReply(1)).then(startVoice)
    .then(beginSignIn("google")).then(identityCallback(2)).then(identityExchanged).then(saveIdentityReceipt)
    .then(all {Identity::writeKey, keepVoice, keepResident, keepCalendar, keepInbox, keepReset, keepHost})
    .then(check(not(VoiceAccountBound) and not(safety)))

  run signedInSetup = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity(true))
  run readySetup = signedInSetup.then(startResident).then(residentStarted(1))
    .then(beginBinding).then(bindingReply(1))

  run mfaAndAcknowledgementRecoveryTest = init.then(beginSignIn("phone")).then(identityWrongCode)
    .then(verifyCode(true)).then(verifyMfa).then(identityExchanged).then(saveIdentityReceipt)
    .then(acceptIdentityKey).then(cancelSignIn).then(acknowledgeIdentity(false))
    .then(acknowledgeIdentity(false)).then(acknowledgeIdentity(false))
    .then(restartIdentityAcknowledgement).then(acknowledgeIdentity(true))
    .then(identityCooldownElapsed).then(startResident).then(residentStarted(1))
    .then(check(safety and accountReady and Identity::s.cancelRequested and not(Identity::s.cooldown)))
  run cancelledAttemptCanRetryTest = init.then(beginSignIn("email")).then(cancelSignIn)
    .then(identityCooldownElapsed).then(beginSignIn("google")).then(identityCallback(1))
    .then(identityCallback(2)).then(identityExchanged).then(saveIdentityReceipt)
    .then(acceptIdentityKey).then(acknowledgeIdentity(true))
    .then(check(safety and accountReady and Identity::s.owner == 2))
  run precommitStorageFailureTest = init.then(beginSignIn("google")).then(identityCallback(1))
    .then(identityExchanged).then(saveIdentityReceipt).then(identityStorageFailure)
    .then(releaseIdentitySession).then(check(safety and Identity::s.phase == "failed" and not(Identity::s.key)))
  run signedOutResidentStillRunsTest = init.then(startResident).then(residentStarted(0))
    .then(check(safety and Resident::s.localProcess and not(accountReady)))
  run residentRecoveryAndRebindingTest = readySetup.then(residentCrash(true))
    .then(reviewResidentRecovery(false)).then(check(safety and Resident::s.phase == "recovery"))
    .then(reviewResidentRecovery(true)).then(startResident).then(residentStarted(2))
    .then(beginBinding).then(bindingOutcome(2, false)).then(beginBinding).then(bindingReply(2))
    .then(startVoice).then(clearResidentBinding(false))
    .then(check(safety and Resident::s.provider == "unconfirmed" and Voice::s.phase == "idle"))
  run deleteTimerAndUndoTest = readySetup.then(calendarEnqueue("delete")).then(calendarUndo)
    .then(calendarEnqueue("delete")).then(calendarDeadline).then(calendarClaim).then(calendarCheck)
    .then(calendarDispatch).then(calendarCompleted).then(check(safety and Calendar::s.phase == "done"))
  run calendarConflictRecoveryTest = readySetup.then(calendarEnqueue("update")).then(calendarRemoteEdit)
    .then(calendarClaim).then(calendarCheck).then(calendarResolveConflict(true))
    .then(calendarClaim).then(calendarCheck).then(calendarDispatch).then(calendarProviderFailure)
    .then(calendarUndo).then(check(safety and Calendar::s.phase == "empty"))
  run uncertainCalendarCreateRecoveryTest = readySetup.then(calendarEnqueue("create")).then(calendarClaim)
    .then(calendarDispatch).then(calendarLostReply).then(calendarFindCreated(false))
    .then(calendarResolveUncertain(false)).then(check(safety and Calendar::s.phase == "uncertain" and not(Calendar::s.resultVisible)))
  run changedInboxDraftCanCancelAndRetryTest = readySetup.then(inboxPrepare).then(inboxReview)
    .then(inboxEditDraft).then(inboxCancelReview).then(inboxPrepare).then(inboxReview)
    .then(inboxConfirm).then(inboxProviderResult("unknown")).then(restartInbox)
    .then(inboxReceipt(true)).then(inboxCleanup)
    .then(check(safety and not(Inbox::s.draftExists) and Inbox::s.dispatches == 1))
  run restartedConsumersRecoverDurableOperationsTest = readySetup.then(startVoice)
    .then(calendarEnqueue("create")).then(calendarClaim).then(calendarDispatch)
    .then(inboxPrepare).then(inboxReview).then(inboxConfirm).then(restartApplication)
    .then(check(safety and Voice::s.phase == "idle" and Calendar::s.phase == "uncertain"))
    .then(startResident).then(residentStarted(2)).then(beginBinding).then(bindingReply(2))
    .then(calendarFindCreated(true)).then(inboxReceipt(true)).then(inboxCleanup)
    .then(check(safety and Calendar::s.applied and not(Inbox::s.draftExists)))
  run voiceReviewAndDictationRecoveryTest = readySetup.then(discloseCloudVoice).then(startVoice)
    .then(voiceSegment(0)).then(voiceShortGap).then(voiceEndpoint(0, true)).then(submitVoiceEndpoint)
    .then(voiceReviewReply(0, 1)).then(resumeVoiceReview(0, 1, false))
    .then(resumeVoiceReview(0, 1, true)).then(toggleVoiceMute).then(toggleVoiceMute)
    .then(voiceBargeIn(true)).then(voiceSentence(0, 1)).then(stopVoiceSession)
    .then(startDictation).then(voiceSegment(1)).then(finishDictation)
    .then(check(safety and Voice::s.draft and Voice::s.sent.size() == 1))
  run resetBudgetAndListenerRecoveryTest = readySetup.then(beginReset).then(cancelResetReview)
    .then(beginReset).then(confirmReset(3)).then(authenticateReset(3, true, true))
    .then(resetBudgetFailure).then(retryReset).then(attemptReset(false, false))
    .then(attemptReset(false, false)).then(attemptReset(false, false))
    .then(launchResetRecovery(false)).then(check(safety and Reset::s.failures == 3))
    .then(resetAutomaticWindow).then(resetListener(false)).then(attemptReset(false, true))
    .then(observeErased).then(lateResetFailure).then(check(safety and Reset::s.erased))
  run resetReviewRestartRejectsOldAuthTest = readySetup.then(beginReset).then(confirmReset(1))
    .then(restartApplication).then(authenticateReset(1, true, true))
    .then(check(safety and not(Reset::s.marker) and not(Reset::s.review)))
  run precommitRestartRequiresNewAttemptTest = init.then(beginSignIn("phone")).then(verifyCode(true))
    .then(restartApplication).then(identityCooldownElapsed).then(beginSignIn("google"))
    .then(check(safety and Identity::s.phase == "browser" and Identity::s.epoch == 2))
  run restoredCalendarGrantAllowsCurrentWorkTest = readySetup.then(calendarPermissionLost)
    .then(calendarRestorePermission).then(calendarEnqueue("update")).then(calendarClaim)
    .then(calendarCheck).then(calendarDispatch).then(calendarCompleted)
    .then(check(safety and Calendar::s.applied))
  run restoredInboxGrantRequiresFreshReviewTest = readySetup.then(inboxPrepare).then(inboxReview)
    .then(inboxWithdrawRead).then(inboxRestoreGrants)
    .then(check(safety and Inbox::s.phase == "empty" and not(Inbox::s.exactReview)))
    .then(inboxPrepare).then(inboxReview).then(inboxConfirm)
    .then(check(safety and Inbox::s.dispatches == 1))
  run restoredGrantCannotReviveRetiredCalendarTest = replacementSetup.then(calendarPermissionLost)
    .then(calendarRestorePermission).then(calendarDispatch.fail())
  run restoredGrantCannotReviveRetiredInboxTest = signedInSetup.then(inboxPrepare).then(inboxReview)
    .then(inboxConfirm).then(beginSignIn("google")).then(identityCallback(2))
    .then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey)
    .then(acknowledgeIdentity(true)).then(revokePreviousIdentity(false)).then(releaseIdentitySession)
    .then(inboxRestoreGrants).then(inboxReply.fail())
  run ordinaryStopRetiresVoiceBeforeRestartTest = readySetup.then(startVoice).then(stopResident)
    .then(residentShutdownUnconfirmed)
    .then(check(safety and Resident::s.phase == "stopping" and Voice::s.phase == "idle"))
    .then(residentShutdownConfirmed).then(startResident).then(residentStarted(2))
    .then(beginBinding).then(bindingReply(2)).then(startVoice)
    .then(check(safety and Identity::s.owner == 1 and Resident::s.provider == "cloud"))
  run attachedStartCancellationPreservesVoiceTest = readySetup.then(startVoice)
    .then(attachResidentStart).then(cancelAttachedResidentStart)
    .then(check(safety and Resident::s.phase == "ready" and Voice::s.phase == "listening"))
  run ownedStartupCancellationFencesReplyTest = signedInSetup.then(startResident)
    .then(cancelOwnedResidentStart).then(residentStarted(1)).then(residentShutdownConfirmed)
    .then(check(safety and Resident::s.phase == "stopped" and not(Resident::s.localProcess)))

  run pendingReplacementPreservesAccountTest = readySetup.then(startVoice)
    .then(beginSignIn("email"))
    .then(check(safety and accountReady and credentialPresent and Identity::s.owner == 1
      and Voice::s.phase == "listening" and Resident::s.provider == "cloud"))
    .then(verifyCode(true)).then(check(safety and accountReady and Identity::s.phase == "mfa"))

}
