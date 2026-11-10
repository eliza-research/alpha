// Source: model.js beginVoiceScrollFollow/followVoiceTurn/getSnapshotBeforeUpdate;
// voice-adapter.ts accepted-final callback/cleanup; agent-adapter.ts session retirement.
// One voice turn, old/new row IDs 0/1, and matching/mismatched conversation/text.
module VoiceTranscriptFollow {
  type State = {started:bool,open:bool,opened:bool,atBottom:bool,selecting:bool,
    current:bool,accepted:bool,delivered:bool,pending:bool,baseline:int,row:int,
    sameConversation:bool,sameText:bool,cancelled:bool,follow:bool,follows:int,focus:int}
  var s:State
  action init = s'={started:false,open:false,opened:false,atBottom:false,selecting:false,
    current:true,accepted:false,delivered:false,pending:false,baseline:0,row:0,
    sameConversation:true,sameText:true,cancelled:false,follow:false,follows:0,focus:0}
  action beginMinimized = all {not(s.started),s'={...s,started:true,open:true,opened:true,baseline:s.row}}
  action beginAtBottom = all {not(s.started),s'={...s,started:true,open:true,atBottom:true,baseline:s.row}}
  action beginInHistory = all {not(s.started),s'={...s,started:true,open:true,baseline:s.row}}
  action accept = all {s.started,s.current,not(s.accepted),s'={...s,accepted:true,
    opened:false,pending:(s.opened or s.atBottom) and not(s.selecting),follow:false}}
  action deliver = all {s.started,not(s.delivered),s'={...s,delivered:true,row:1,follow:false}}
  action deliverOtherConversation = all {s.started,not(s.delivered),s'={...s,delivered:true,row:1,sameConversation:false,follow:false}}
  action deliverOtherText = all {s.started,not(s.delivered),s'={...s,delivered:true,row:1,sameText:false,follow:false}}
  // Actual pointer/wheel/touch/key input retires the intent. Merely receiving a
  // background history result does not count as user scrolling.
  action readHistory = all {s.started,s'={...s,opened:false,pending:false,atBottom:false,cancelled:true,follow:false}}
  action selectText = all {s.started,s'={...s,opened:false,pending:false,atBottom:false,selecting:true,cancelled:true,follow:false}}
  action changeAccount = all {s.started,s'={...s,current:false,opened:false,pending:false,follow:false}}
  action close = all {s.started,s'={...s,open:false,opened:false,pending:false,follow:false}}
  val matches = s.open and s.pending and s.row!=s.baseline and s.sameConversation and s.sameText and not(s.selecting)
  // One React snapshot/commit macrostep. Geometry/ordinary at-bottom scrolling
  // is outside this model; follow here records only the extra voice intent.
  action render = all {s.started,s'={...s,follow:matches,follows:s.follows+(if(matches)1 else 0),
    pending:if(s.pending and (not(s.open) or s.row!=s.baseline))false else s.pending,
    baseline:if(s.pending and (not(s.open) or s.row!=s.baseline))s.row else s.baseline}}
  action step = any {beginMinimized,beginAtBottom,beginInHistory,accept,deliver,
    deliverOtherConversation,deliverOtherText,readHistory,selectText,changeAccount,close,render,s'=s}
  val oneShot = s.follows<=1
  val followsOwnedTurn = s.follow implies s.current and s.open and s.accepted and s.sameConversation and s.sameText
  val preservesReading = s.cancelled implies not(s.follow)
  val noFocusChange = s.focus==0
  val safety = oneShot and followsOwnedTurn and preservesReading and noFocusChange
  run acceptanceBeforeDeliveryTest = init.then(beginMinimized).then(accept).then(render)
    .expect(s.follows==0 and s.pending).then(deliver).then(render).expect(s.follows==1 and not(s.pending) and safety)
  run deliveryBeforeAcceptanceTest = init.then(beginMinimized).then(deliver).then(render)
    .then(accept).then(render).expect(s.follows==1 and safety)
  run oneShotTest = init.then(beginAtBottom).then(accept).then(deliver).then(render).then(render)
    .expect(s.follows==1 and not(s.pending) and safety)
  run manualReadingBeforeAcceptanceTest = init.then(beginMinimized).then(readHistory).then(accept).then(deliver).then(render)
    .expect(s.follows==0 and safety)
  run manualReadingAfterAcceptanceTest = init.then(beginMinimized).then(accept).then(selectText).then(deliver).then(render)
    .expect(s.follows==0 and safety)
  run oldHistoryStaysPutTest = init.then(beginInHistory).then(accept).then(deliver).then(render).expect(s.follows==0 and safety)
  run conversationMismatchTest = init.then(beginMinimized).then(accept).then(deliverOtherConversation).then(render)
    .expect(s.follows==0 and not(s.pending) and safety)
  run textMismatchTest = init.then(beginMinimized).then(accept).then(deliverOtherText).then(render)
    .expect(s.follows==0 and not(s.pending) and safety)
  run accountChangeTest = init.then(beginMinimized).then(accept).then(changeAccount).then(deliver).then(render)
    .expect(s.follows==0 and safety)
  run closedChatTest = init.then(beginMinimized).then(accept).then(close).then(deliver).then(render)
    .expect(s.follows==0 and safety)
}
