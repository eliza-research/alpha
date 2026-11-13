/// Render-engine failure is distinct from one cancelled or failed tile.
module MapPlaneFailures {
  type State = {loaded:bool,ready:bool,disposed:bool,tileIssue:bool,errors:int}
  var s:State
  action init = s'={loaded:false,ready:false,disposed:false,tileIssue:false,errors:0}
  action load = all {not(s.loaded or s.disposed),s'={...s,loaded:true,ready:s.errors==0}}
  action tile = all {s.errors<2,s'=if(s.disposed)s else if(s.loaded){...s,tileIssue:true} else {...s,ready:false,errors:s.errors+1}}
  action engine = all {s.errors<2,s'=if(s.disposed)s else {...s,ready:false,errors:s.errors+1}}
  action abort = s'=s
  action dispose = s'={...s,disposed:true}
  action step = any {load,tile,engine,abort,dispose,s'=s}
  val safety = s.errors.in(0.to(2)) and (s.tileIssue implies s.loaded) and (s.ready implies (s.loaded and s.errors==0))
  run lateTileTest = init.then(load).then(tile).expect(s.ready and s.errors==0 and safety)
  run initialTileFailureTest = init.then(tile).expect(not(s.ready) and s.errors==1 and safety)
  run engineFailureTest = init.then(load).then(engine).expect(not(s.ready) and s.errors==1 and safety)
  run cancelledTileTest = init.then(load).then(abort).expect(s.ready and s.errors==0 and safety)
  run disposedCallbackTest = init.then(dispose).then(engine).then(tile).expect(s.errors==0 and safety)
}
