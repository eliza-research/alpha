// Alpha's explicit system Settings, allowlisted pages and password-provider Settings fallback.
module NativeSettingsHandoff {
  type Attempt = {target: str, data: str, packageExtra: str, newTask: bool, result: str, phase: str}
  type Reply = {status: str, page: str, destination: str, specific: bool}
  type State = {launcher: bool, phase: str, provider: str, command: str, pending: bool,
    attempts: List[Attempt], reply: Reply}
  var s: State
  val routes = Map(
    ("system",("ACTION_SETTINGS","")),
    ("accounts",("ACTION_SYNC_SETTINGS","")),
    ("wifi",("ACTION_WIFI_SETTINGS","")),
    ("bluetooth",("ACTION_BLUETOOTH_SETTINGS","")),
    ("mobile",("ACTION_DATA_ROAMING_SETTINGS","ACTION_WIRELESS_SETTINGS")),
    ("airplane",("ACTION_AIRPLANE_MODE_SETTINGS","ACTION_WIRELESS_SETTINGS")),
    ("location",("ACTION_LOCATION_SOURCE_SETTINGS","")),
    ("display",("ACTION_DISPLAY_SETTINGS","")),
    ("sound",("ACTION_SOUND_SETTINGS","")),
    ("battery",("ACTION_BATTERY_SAVER_SETTINGS","")),
    ("about",("ACTION_DEVICE_INFO_SETTINGS","")),
    ("developer",("ACTION_APPLICATION_DEVELOPMENT_SETTINGS","")),
    ("notifications",("ACTION_APP_NOTIFICATION_SETTINGS","")),
    ("privacy",("ACTION_APPLICATION_DETAILS_SETTINGS","")),
    ("default-apps",("ACTION_MANAGE_DEFAULT_APPS_SETTINGS","")),
    ("dnd",("android.settings.ZEN_MODE_SETTINGS","ACTION_ZEN_MODE_PRIORITY_SETTINGS"))
  )
  val commands=routes.keys().union(Set("provider-settings","unknown","missing","numeric"," wifi"))
  val outcomes=Set("ok","missing","security")
  val providers=Set("trusted","untrusted","unsupported","absent","refused")

  pure def response(status: str): Reply = {status:status,page:"",destination:"",specific:false}
  action initWith(launcher: bool, present: bool): bool = s' = {
    launcher:launcher,phase:if (present) "live" else "absent",provider:"trusted",
    command:"",pending:false,attempts:List(),reply:response("none")
  }
  action init = {
    nondet launcher=Bool.oneOf()
    nondet present=Bool.oneOf()
    initWith(launcher,present)
  }

  action request(command: str): bool = all {
    commands.contains(command), not(s.pending),
    val valid=routes.keys().contains(command) or command=="provider-settings"
    val result=if (not(valid)) "unsupported"
      else if (s.phase!="absent") "pending"
      else if (command=="system") "unavailable" else "threw"
    s'={ ...s,command:command,pending:result=="pending",attempts:List(),reply:response(result) }
  }
  action retire(phase: str): bool = all {
    s.phase=="live" and phase.in(Set("finishing","destroyed")) or (s.phase=="finishing" and phase=="destroyed"),
    s'={ ...s,phase:phase }
  }
  action provider(mode: str): bool = all {
    providers.contains(mode), s'={ ...s,provider:mode }
  }

  pure def intent(state: State, target: str, result: str): Attempt = {
    target:target,result:result,phase:state.phase,newTask:state.launcher and state.command!="system",
    data:if (state.command=="privacy") "package:fixture.alpha"
      else if (target=="ACTION_REQUEST_SET_AUTOFILL_SERVICE") "package:proton.android.pass" else "",
    packageExtra:if (state.command=="notifications") "fixture.alpha" else ""
  }
  pure def result(state: State, attempts: List[Attempt], specific: bool, success: bool): Reply =
    if (not(success)) response("unavailable")
    else if (state.command=="provider-settings") {
      val last=attempts.nth(attempts.length()-1)
      { ...response("opened"),destination:if (last.target=="ACTION_REQUEST_SET_AUTOFILL_SERVICE") "provider-picker" else "system-settings" }
    }
    else { ...response("opened"),page:state.command,specific:specific }

  action deliver(first: str, second: str): bool = all {
    s.pending, outcomes.contains(first), outcomes.contains(second),
    val providerRequest=s.command=="provider-settings"
    val picker=providerRequest and s.provider=="trusted"
    val choice=if (providerRequest) (if (picker) ("ACTION_REQUEST_SET_AUTOFILL_SERVICE","ACTION_SETTINGS") else ("ACTION_SETTINGS",""))
      else routes.get(s.command)
    val follow=choice._2!="" and first!="ok" and (not(providerRequest) or first=="missing")
    val attempts=if (providerRequest and s.provider=="refused") List()
      else if (follow) List(intent(s,choice._1,first),intent(s,choice._2,second))
      else List(intent(s,choice._1,first))
    val success=attempts.length()>0 and (if (follow) second=="ok" else first=="ok")
    s'={ ...s,pending:false,attempts:attempts,reply:result(s,attempts,not(follow),success) }
  }

  val OneAcceptedStart = s.attempts.length()<=2 and
    (if (s.attempts.length()==2) s.attempts.nth(0).result!="ok" else true)
  val ExactOpenedReply = (s.reply.status=="opened") iff
    s.attempts.indices().exists(index=>s.attempts.nth(index).result=="ok")
  val BroadReplyNeedsSecondCandidate = (s.reply.status=="opened" and s.command!="provider-settings" and not(s.reply.specific))
    implies s.attempts.length()==2
  val CorrectTaskAndScope = s.attempts.indices().forall(index=>{
    val launched=s.attempts.nth(index)
    launched.newTask==(s.launcher and s.command!="system")
    and (launched.target=="ACTION_SETTINGS" implies s.command.in(Set("system","provider-settings")))
  })
  val safety = OneAcceptedStart and ExactOpenedReply and BroadReplyNeedsSecondCandidate and CorrectTaskAndScope

  action step = any {
    nondet command=commands.oneOf()
    request(command),
    nondet phase=Set("finishing","destroyed").oneOf()
    retire(phase),
    nondet mode=providers.oneOf()
    provider(mode),
    nondet first=outcomes.oneOf()
    nondet second=outcomes.oneOf()
    deliver(first,second),
    s'=s
  }

  run explicitSystemHomeKeepsCurrentTaskTest = initWith(true,true).then(request("system")).then(deliver("ok","ok"))
    .expect(s.reply.specific and s.attempts.head().target=="ACTION_SETTINGS" and not(s.attempts.head().newTask))
  run broaderPageReportsExactFallbackTest = initWith(true,true).then(request("mobile")).then(deliver("security","ok"))
    .expect(s.attempts.length()==2 and s.attempts.nth(1).target=="ACTION_WIRELESS_SETTINGS" and not(s.reply.specific))
  run rejectedPageDoesNotFallBackToSettingsHomeTest = initWith(false,true).then(request("wifi")).then(deliver("missing","ok"))
    .expect(s.reply.status=="unavailable" and s.attempts.length()==1)
  run permissionPagesCarryOwnPackageTest = initWith(true,true).then(request("privacy")).then(deliver("ok","ok"))
    .expect(s.attempts.head().data=="package:fixture.alpha").then(request("notifications")).then(deliver("ok","ok"))
    .expect(s.attempts.head().packageExtra=="fixture.alpha" and s.attempts.head().data=="")
  run providerFallbackNeedsMissingPickerTest = initWith(true,true).then(request("provider-settings")).then(deliver("security","ok"))
    .expect(s.reply.status=="unavailable" and s.attempts.length()==1)
    .then(request("provider-settings")).then(deliver("missing","ok"))
    .expect(s.reply.destination=="system-settings" and s.attempts.nth(1).newTask)
  run absentHostAnswersOnlyExplicitSystemAsBuiltTest = initWith(true,false).then(request("system"))
    .expect(s.reply.status=="unavailable").then(request("wifi")).expect(s.reply.status=="threw" and s.attempts.length()==0)
  run queuedDispatchUsesPlatformAfterRetirementAsBuiltTest = initWith(false,true).then(request("wifi"))
    .then(retire("destroyed")).then(deliver("missing","ok"))
    .expect(s.attempts.head().phase=="destroyed" and s.reply.status=="unavailable")
}
