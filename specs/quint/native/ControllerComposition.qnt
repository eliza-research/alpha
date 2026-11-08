module CompositionIdentity {
  const instance: int
  import IdentitySession.* from "../services/IdentitySession"
  export IdentitySession.s
  export IdentitySession.init
  export IdentitySession.safety
  export IdentitySession.begin
  export IdentitySession.codeVerified
  export IdentitySession.exchanged
  export IdentitySession.writeReceipt
  export IdentitySession.writeKey
  export IdentitySession.ack
  export IdentitySession.revokePrevious
  export IdentitySession.releaseSteward
  export IdentitySession.cancel
  export IdentitySession.signOut
  export IdentitySession.restart
  export IdentitySession.cooldownElapsed
}
module CompositionCalendar {
  const instance: int
  import CalendarLinkedSync.* from "../services/CalendarLinkedSync"
  export CalendarLinkedSync.s
  export CalendarLinkedSync.init
  export CalendarLinkedSync.safety
  export CalendarLinkedSync.reviewSync
  export CalendarLinkedSync.enable
  export CalendarLinkedSync.pause
  export CalendarLinkedSync.switchOwner
  export CalendarLinkedSync.begin
  export CalendarLinkedSync.analyzed
  export CalendarLinkedSync.stage
  export CalendarLinkedSync.dispatch
  export CalendarLinkedSync.providerResult
  export CalendarLinkedSync.abandonedWrite
  export CalendarLinkedSync.restart
}
module CompositionVoice {
  const instance: int
  import VoiceSession.* from "./VoiceSession"
  export VoiceSession.s
  export VoiceSession.init
  export VoiceSession.safety
  export VoiceSession.start
  export VoiceSession.stop
  export VoiceSession.segment
  export VoiceSession.beginSubmission
  export VoiceSession.inputClosed
  export VoiceSession.inputCloseFailed
  export VoiceSession.reply
  export VoiceSession.sentenceFinished
  export VoiceSession.playbackFinished
}

/// Native activation, renderer publication and captured consumer bindings are separate lifetimes.
module ControllerComposition {
  import CompositionIdentity(instance=101) as Identity
  import CompositionCalendar(instance=102) as Calendar
  import CompositionVoice(instance=103) as Voice
  type Host = {owner:int, epoch:int, foreground:bool, connectionOpen:bool, providerReady:bool,
    calendarOwner:int, calendarEpoch:int, calendarBound:bool, voiceOwner:int, voiceEpoch:int}
  var host:Host
  val state = {identity:Identity::s, calendar:Calendar::s, voice:Voice::s, host:host}
  action init = all {Identity::init, Calendar::init, Voice::init,
    host'={owner:0,epoch:0,foreground:true,connectionOpen:false,providerReady:false,
      calendarOwner:0,calendarEpoch:0,calendarBound:false,voiceOwner:0,voiceEpoch:0}}
  action keepIdentity = Identity::s'=Identity::s
  action keepCalendar = Calendar::s'=Calendar::s
  action keepVoice = Voice::s'=Voice::s
  action keepHost = host'=host
  action keep = all {keepIdentity,keepCalendar,keepVoice,keepHost}
  action stopVoice = if(Voice::s.phase=="idle")keepVoice else Voice::stop
  val voiceSubmissions = Voice::s.sent.size()
  val credentialPresent = Identity::s.owner!=0 and (Identity::s.key or Identity::s.oldKey)
  val accountReady = host.owner!=0 and host.providerReady and not(host.connectionOpen)
  val calendarCurrent = host.calendarBound and host.calendarOwner==host.owner and host.calendarEpoch==host.epoch and host.foreground
  action beginSignIn = all {host.foreground,Identity::begin("email"),stopVoice,keepCalendar,
    host'={...host,connectionOpen:true}}
  action cooldownElapsed = all {Identity::cooldownElapsed,keepCalendar,keepVoice,keepHost}
  action verifyCode = all {Identity::codeVerified(false),keepCalendar,keepVoice,keepHost}
  action identityExchanged = all {Identity::exchanged,keepCalendar,keepVoice,keepHost}
  action saveIdentityReceipt = all {Identity::writeReceipt,keepCalendar,keepVoice,keepHost}
  action acceptIdentityKey = all {Identity::writeKey,keepCalendar,keepVoice,keepHost}
  action acknowledgeIdentity = all {Identity::ack(true),keepCalendar,keepVoice,keepHost}
  action revokePreviousIdentity = all {Identity::revokePrevious(true),keepCalendar,keepVoice,keepHost}
  action releaseIdentitySession = all {Identity::releaseSteward,keepCalendar,keepVoice,keepHost}
  /// The native result reaches the renderer only after activation. Existing consumers keep the captured old binding until then.
  action publishIdentity = all {
    Identity::s.activation.acknowledged,Identity::s.owner!=0,host.owner!=Identity::s.owner,host.epoch<3,
    keepIdentity,if(host.calendarOwner==0)keepCalendar else Calendar::switchOwner,stopVoice,
    host'={...host,owner:Identity::s.owner,epoch:host.epoch+1,connectionOpen:false,providerReady:false,calendarBound:false}
  }
  action bindingReady = all {host.owner!=0,keepIdentity,keepCalendar,keepVoice,host'={...host,providerReady:true}}
  action cancelSignIn = all {Identity::cancel,keepCalendar,keepVoice,keepHost}
  action signOut = all {Identity::signOut,Calendar::switchOwner,stopVoice,host.epoch<3,
    host'={...host,owner:0,epoch:host.epoch+1,providerReady:false,connectionOpen:true,calendarBound:false}}
  action calendarBind = all {accountReady,host.foreground,host.calendarOwner==0 or host.calendarOwner==host.owner,
    keepIdentity,keepCalendar,keepVoice,host'={...host,calendarOwner:host.owner,calendarEpoch:host.epoch,calendarBound:true}}
  action calendarReview = all {calendarCurrent,Calendar::reviewSync,keepIdentity,keepVoice,keepHost}
  action calendarEnable = all {calendarCurrent,Calendar::enable,keepIdentity,keepVoice,keepHost}
  action calendarPause = all {Calendar::pause,keepIdentity,keepVoice,keepHost}
  action calendarBegin = all {calendarCurrent,Calendar::begin,keepIdentity,keepVoice,keepHost}
  action calendarAnalyze = all {calendarCurrent,Calendar::analyzed,keepIdentity,keepVoice,keepHost}
  action calendarStage = all {calendarCurrent,Calendar::stage,keepIdentity,keepVoice,keepHost}
  action calendarDispatch = all {calendarCurrent,Calendar::dispatch,keepIdentity,keepVoice,keepHost}
  action calendarReturned(status:str,effected:bool):bool = all {
    if(calendarCurrent)Calendar::providerResult(status,effected) else Calendar::abandonedWrite(effected),
    keepIdentity,keepVoice,keepHost
  }
  action hide = all {stopVoice,keepIdentity,keepCalendar,host'={...host,foreground:false,calendarBound:false}}
  action resume = all {keepIdentity,keepCalendar,keepVoice,host'={...host,foreground:true}}
  action restartConsumers = all {Identity::restart,Calendar::restart,stopVoice,
    host'={...host,calendarBound:false,connectionOpen:false}}
  action startVoice = all {accountReady,host.foreground,Voice::start(false,true),keepIdentity,keepCalendar,
    host'={...host,voiceOwner:host.owner,voiceEpoch:host.epoch}}
  action voiceSegment = all {Voice::segment(Voice::s.session,true),keepIdentity,keepCalendar,keepHost}
  action voiceBeginSubmission = all {Voice::beginSubmission(true),keepIdentity,keepCalendar,keepHost}
  action voiceInputClosed = all {accountReady,Voice::inputClosed,keepIdentity,keepCalendar,keepHost}
  action voiceInputFailed = all {Voice::inputCloseFailed,keepIdentity,keepCalendar,keepHost}
  action voiceReply(session:int,turn:int):bool = all {Voice::reply(session,turn,false),keepIdentity,keepCalendar,keepHost}
  action stopVoiceSession = all {stopVoice,keepIdentity,keepCalendar,keepHost}
  action step = any {beginSignIn,verifyCode,identityExchanged,saveIdentityReceipt,acceptIdentityKey,
    acknowledgeIdentity,revokePreviousIdentity,releaseIdentitySession,publishIdentity,bindingReady,cancelSignIn,signOut,
    calendarBind,calendarReview,calendarEnable,calendarPause,calendarBegin,calendarAnalyze,calendarStage,calendarDispatch,
    calendarReturned("succeeded",true),calendarReturned("unknown",true),calendarReturned("unknown",false),
    hide,resume,restartConsumers,startVoice,voiceSegment,voiceBeginSubmission,voiceInputClosed,voiceInputFailed,
    voiceReply(0,1),voiceReply(1,1),voiceReply(2,1),stopVoiceSession,keep}
  val RendererHasActivatedCredential = host.owner!=0 implies Identity::s.activation.acknowledged or Identity::s.oldKey or Identity::s.owner!=host.owner
  val VoiceBindingCurrent = Voice::s.phase.in(Set("idle","error")) or
    (accountReady and host.foreground and host.voiceOwner==host.owner and host.voiceEpoch==host.epoch)
  val CalendarBindingCurrent = host.calendarBound implies host.calendarOwner==host.owner and host.calendarEpoch==host.epoch
  val LiveCalendarBinding = not(calendarCurrent) implies not(host.calendarBound)
  val safety = Identity::safety and Calendar::safety and Voice::safety and
    RendererHasActivatedCredential and VoiceBindingCurrent and CalendarBindingCurrent and LiveCalendarBinding
  run signedInSetup = init.then(beginSignIn).then(verifyCode).then(identityExchanged).then(saveIdentityReceipt)
    .then(acceptIdentityKey).then(acknowledgeIdentity).then(releaseIdentitySession).then(publishIdentity).then(bindingReady).then(calendarPause).then(cooldownElapsed)
  run calendarSetup = signedInSetup.then(calendarBind).then(calendarReview).then(calendarEnable)
  run readySetup = signedInSetup
  run signInAndVoiceTest = signedInSetup.then(startVoice).then(voiceSegment).then(voiceBeginSubmission).then(voiceInputClosed).then(stopVoiceSession).expect(safety)
  run nativeCommitPrecedesRendererPublicationTest = signedInSetup.then(beginSignIn).then(verifyCode).then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey)
    .expect(host.owner==1 and Identity::s.owner==2 and safety).then(acknowledgeIdentity).then(revokePreviousIdentity).then(releaseIdentitySession)
    .then(publishIdentity).then(bindingReady).expect(host.owner==2 and safety)
  run accountReplacementRetiresCalendarReviewTest = calendarSetup.then(beginSignIn).then(verifyCode).then(identityExchanged).then(saveIdentityReceipt)
    .then(acceptIdentityKey).then(acknowledgeIdentity).then(revokePreviousIdentity).then(releaseIdentitySession).then(publishIdentity)
    .expect(not(host.calendarBound) and Calendar::s.writes==0 and safety)
  run alreadyDispatchedEffectCanFinishAfterReplacementTest = calendarSetup.then(calendarBegin).then(calendarAnalyze).then(calendarStage).then(calendarDispatch)
    .then(beginSignIn).then(verifyCode).then(identityExchanged).then(saveIdentityReceipt).then(acceptIdentityKey).then(acknowledgeIdentity)
    .then(revokePreviousIdentity).then(releaseIdentitySession).then(publishIdentity).then(calendarReturned("succeeded",true))
    .expect(Calendar::s.state=="dirty" and Calendar::s.pending=="create" and Calendar::s.remote==1 and safety)
  run signOutKeepsUnknownCalendarIntentTest = calendarSetup.then(calendarBegin).then(calendarAnalyze).then(calendarStage).then(calendarDispatch)
    .then(signOut).then(calendarReturned("succeeded",true)).expect(Calendar::s.state=="dirty" and host.owner==0 and safety)
  run foregroundLossRejectsNewCalendarDispatchTest = calendarSetup.then(calendarBegin).then(calendarAnalyze).then(calendarStage).then(hide).expect(safety)
  run cancelledReplacementKeepsOldBindingTest = calendarSetup.then(startVoice).then(beginSignIn).then(cancelSignIn).then(calendarBegin)
    .expect(host.owner==1 and Calendar::s.writes==0 and Voice::s.phase=="idle" and safety)
  run lateVoiceReplyCannotUseReplacementTest = signedInSetup.then(startVoice).then(voiceSegment).then(voiceBeginSubmission).then(voiceInputClosed)
    .then(beginSignIn).then(voiceReply(0,1)).expect(Voice::s.phase=="idle" and safety)
  // Synthetic checker canary, excluded from step and source refinement claims.
  action unsafeUncoordinatedKey = all {Identity::s'={...Identity::s,owner:2},keepCalendar,keepVoice,keepHost}
  run uncoordinatedIdentityChangeDetectedTest = signedInSetup.then(startVoice).then(unsafeUncoordinatedKey)
    .expect(Identity::s.owner==2 and not(safety))

}
