/// Search and file chooser results belong to the same live conversation generation.
module ChatTools {
  type State = { generation: int, held: int, picker: bool, search: bool,
    pending: bool, results: bool, attached: bool }
  var s: State
  action init = s' = {generation:0,held:0,picker:false,search:false,pending:false,results:false,attached:false}
  val current = s.held == s.generation
  action chooseFile = all {not(s.picker or s.pending),s'={...s,picker:true,held:s.generation}}
  action finishPicker(ok:bool): bool = all {s.picker,s'={...s,picker:false,attached:s.attached or (ok and current)}}
  action openSearch = all {not(s.picker),s'={...s,search:true,results:false}}
  action query = all {s.search,not(s.pending),s'={...s,pending:true,held:s.generation,results:false}}
  action reply = all {s.pending,s'={...s,pending:false,results:s.search and current}}
  action closeSearch = s'={...s,search:false,pending:false,results:false}
  action retire = all {s.generation<3,s'={...s,generation:s.generation+1,attached:false,results:false,search:false}}
  action step = any {chooseFile,finishPicker(true),finishPicker(false),openSearch,query,reply,closeSearch,retire,s'=s}
  val safety = s.results implies (s.search and current)
  run pickerRetiredTest = init.then(chooseFile).then(retire).then(finishPicker(true)).expect(not(s.attached) and safety)
  run lateSearchTest = init.then(openSearch).then(query).then(retire).then(reply).expect(not(s.results) and safety)
  run closeCancelsSearchTest = init.then(openSearch).then(query).then(closeSearch).expect(not(s.pending or s.results) and safety)
  run currentSearchTest = init.then(openSearch).then(query).then(reply).expect(s.results and safety)
}
