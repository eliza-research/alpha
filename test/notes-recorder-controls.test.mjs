import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {stripTypeScriptTypes} from './support/strip-types.mjs';
import {formatRecordingClock} from '../apps/app/src/prototype/note-recorder.ts';
import {MEDIA_UNCONFIRMED_NOTICE} from '../apps/app/src/runtime/voice-states.ts';

const source=fs.readFileSync(new URL('../apps/app/src/prototype/voice-adapter.ts',import.meta.url),'utf8');
const template=fs.readFileSync(new URL('../apps/app/src/prototype/template.html',import.meta.url),'utf8');
const between=(start,end)=>{const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a,start);return source.slice(a,b);};
function fixture(phase='recording',canonical=true){
 const calls={save:[],discard:[],toggle:0},persist=async()=>true;
 const recorder={phase,recordingId:'recording-fixture',durationMs:1250,levels:[],error:'',confirmingDiscard:false,canonicalSavePending:false,
  finishAudio:async(...args)=>{calls.save.push(args);return true;},discard:async confirmed=>calls.discard.push(confirmed),keep(){this.confirmingDiscard=false;},togglePause:async()=>{calls.toggle++;}};
 const context=vm.createContext({noteRecorder:recorder,noteDestination:canonical?{canonical:{}}:{},persistNoteRecording:persist,formatRecordingClock});
 const declaration=between('  const finishNoteRecording =','  const startNoteRecorder =');
 const view=between('  function noteRecorderView(','  let recordRequested =');
 vm.runInContext(stripTypeScriptTypes(declaration+view+';globalThis.view=noteRecorderView;',{mode:'transform'}),context);
 return {calls,recorder,context,persist,view:()=>context.view({pause:'pause',mic:'mic',stop:'stop',check:'check'})};
}

test('Notes Stop saves audio directly on both stores without a transcription gate',async()=>{
 for(const canonical of [true,false]){
  const f=fixture('recording',canonical),view=f.view();
  assert.equal(view.doneLabel,'Stop recording');assert.equal(view.doneDisabled,false);
  assert.equal(view.pauseLabel,'Pause');assert.equal(view.showPause,true);
  assert.equal(view.transcribeLabel,undefined);assert.equal(view.transcribe,undefined);
  view.done();await Promise.resolve();assert.equal(f.calls.save.length,1);
  assert.equal(f.calls.save[0][0],f.persist);assert.equal(f.calls.save[0][1],canonical);
 }
});
test('a stopped or recovered recording always offers Save instead of a disabled mic or mandatory upload',async()=>{
 const f=fixture('stopped'),view=f.view();assert.equal(view.doneLabel,'Save recording');assert.equal(view.doneDisabled,false);assert.equal(view.showPause,false);
 view.done();await Promise.resolve();assert.equal(f.calls.save.length,1);
});
test('stale controls cannot discard or resubmit while a save is finishing',async()=>{
 const f=fixture(),view=f.view();f.recorder.phase='finishing';view.done();view.discard();view.confirmDiscard();await Promise.resolve();
 assert.equal(f.calls.save.length,0);assert.equal(f.calls.discard.length,0);
 const busy=f.view();assert.equal(busy.doneLabel,'Saving…');assert.equal(busy.doneDisabled,true);assert.equal(busy.discardDisabled,true);
});
test('an ambiguous canonical save preserves its recording until readback',async()=>{
 const f=fixture('stopped');f.recorder.canonicalSavePending=true;const view=f.view();view.discard();view.confirmDiscard();await Promise.resolve();assert.equal(f.calls.discard.length,0);assert.equal(view.doneDisabled,false);
});
test('hardware Back saves a recording and cancels only an explicit discard confirmation',async()=>{
 const f=fixture(),line=source.split('\n').find(line=>line.includes('notes.back = (state: Bag'));
 assert.ok(line);f.context.notes={};f.context.back=()=>false;
 vm.runInContext(stripTypeScriptTypes(line,{mode:'transform'}),f.context);
 f.recorder.open=true;assert.equal(f.context.notes.back({},{}),true);await Promise.resolve();assert.equal(f.calls.save.length,1);assert.equal(f.calls.discard.length,0);
 f.recorder.confirmingDiscard=true;f.context.notes.back({},{});assert.equal(f.recorder.confirmingDiscard,false);assert.equal(f.calls.save.length,1);
});
test('the recorder surface has a named Stop action and no provider-branded transcription control',()=>{
 const start=template.indexOf('<sc-if value="{{notes.noteRecorder}}">'),end=template.indexOf('\n</div>\n</div>\n</sc-if>',start),view=template.slice(start,end);
 assert.ok(start>=0&&end>start);assert.match(view,/>Voice note<\/h2>/);assert.match(view,/notes\.noteRecorder\.doneLabel/);
 assert.doesNotMatch(view,/transcribe|Cartesia|Cerebras|notes\.noteRecorder\.transcript/i);
 assert.equal((view.match(/onClick="\{\{notes\.noteRecorder\.discard\}\}"/g)||[]).length,1);
 assert.match(template,/aria-label="Record voice note" onClick="\{\{notes\.record\}\}"/);
});

test('Copy text preserves the full transcript and refuses a changed source note',async()=>{
 const start=source.indexOf('      const vo=result.vo,transcriptSource='),end=source.indexOf('      vo.reviewTranscript=',start);assert.ok(start>=0&&end>start);
 for(const selected of [{id:'note',body:'  First line\n'+('Full transcript. '.repeat(900))},{id:'note',body:'',lines:[{t:'  First line'},{t:'Full transcript. '.repeat(900)}]}]){
  const expected=selected.body||selected.lines.map(line=>line.t).join('\n'),copied=[],toasts=[],state={open:'note',list:[selected]};
  const context=vm.createContext({selected,result:{vo:{}},document:{hidden:false},current:{get:()=>state,isActive:()=>true,toast:text=>toasts.push(text)},copySelectedText:async text=>copied.push(text)});
  vm.runInContext(stripTypeScriptTypes(source.slice(start,end),{mode:'strip'}),context);
  assert.deepEqual(copied,[]);context.result.vo.copyTranscript();await Promise.resolve();assert.deepEqual(copied,[expected]);assert.deepEqual(toasts,['Text copied.']);
  state.list=[{...selected,body:'Changed'}];context.result.vo.copyTranscript();await Promise.resolve();assert.equal(copied.length,1);
 }
});

test('transcript text selection bypasses shell gestures without changing playback targets',()=>{
 const model=fs.readFileSync(new URL('../apps/app/src/prototype/model.js',import.meta.url),'utf8'),line=model.split('\n').find(row=>row.trim().startsWith('gDown(e)'));
 const down=vm.runInNewContext('({'+line+'}).gDown',{pullStart:()=>false});
 const shell={g:{},scale:()=>({r:{left:0,top:0},s:1})};
 down.call(shell,{target:{closest:selector=>selector.includes('[data-alpha-note-transcript]')},clientX:10,clientY:20});assert.equal(shell.g,null);
 down.call(shell,{target:{closest:()=>false},clientX:10,clientY:20});assert.equal(shell.g.cx,10);assert.equal(shell.g.cy,20);
});

test('audio playback refuses a foreign or deleted native handle before starting playback',async()=>{
 const implementation=between('  async function playSaved(','  let listener:');
 for(const metadata of [{audioId:'audio',noteId:'other'},{audioId:'audio',noteId:'note',deletedAt:1},{audioId:'other',noteId:'note'},{audioId:'audio',noteId:'note'}]){
  const calls={play:0,toast:0};const context=vm.createContext({savedPlaybackError:undefined,savedPlaying:undefined,savedPosition:0,savedEpoch:0,savedStarting:undefined,savedTick:undefined,stopping:Promise.resolve(),mediaUnconfirmed:undefined,
   refresh(){},setInterval:()=>1,api:{toast:()=>calls.toast++},noteAudio:{describe:async()=>metadata,play:async()=>{calls.play++;},state:async()=>({playing:true})}});
  context.stopSaved=()=>{context.savedEpoch++;context.savedPlaying=undefined;};
  vm.runInContext(stripTypeScriptTypes(implementation,{mode:'transform'}),context);await context.playSaved({id:'note',audio:{audioId:'audio'}});
  const valid=metadata.noteId==='note'&&metadata.audioId==='audio'&&metadata.deletedAt===undefined;
  assert.equal(calls.play,valid?1:0);assert.equal(calls.toast,0);assert.equal(context.savedPlaybackError?.audioId,valid?undefined:'audio');
 }
});

test('saved audio names a latched stop refusal without probing or starting playback',async()=>{
 const refusal=Error('native stop refused');
 const stopping=Promise.reject(refusal);void stopping.catch(()=>{});
 const context=vm.createContext({savedPlaybackError:undefined,savedPlaying:undefined,savedEpoch:0,stopping,
  mediaUnconfirmed:refusal,MEDIA_UNCONFIRMED_NOTICE,refresh(){},stopSaved(){context.savedEpoch++;context.savedPlaying=undefined;},
  noteAudio:{describe:async()=>assert.fail('blocked playback cannot inspect the handle'),play:async()=>assert.fail('blocked playback cannot start')}});
 vm.runInContext(stripTypeScriptTypes(between('  async function playSaved(','  let listener:'),{mode:'transform'}),context);
 await context.playSaved({id:'note',audio:{audioId:'audio'}});
 assert.equal(context.savedPlaybackError?.audioId,'audio');
 assert.equal(context.savedPlaybackError?.message,MEDIA_UNCONFIRMED_NOTICE);
});

test('a retained canonical attachment restores the playback control after the canonical projection disables it',()=>{
 const begin=source.indexOf('      vo.hasPlayback = true;'),end=source.indexOf('      vo.lines =',begin);assert.ok(begin>=0&&end>begin);
 let played=0;const vo={hasPlayback:false};const context=vm.createContext({vo,React:{createElement:(type,props)=>({type,props})},VoiceActivity:'VoiceActivity',savedPlaybackReady:false,savedPlaying:undefined,current:{ic:{stop:'stop',play:'play'}},selected:{id:'saved-note',audio:{audioId:'saved-audio'}},currentNoteReading:()=>null,stopSpeaking(){},playSaved:async()=>{played++;}});
 vm.runInContext(stripTypeScriptTypes(source.slice(begin,end),{mode:'transform'}),context);
 assert.equal(vo.hasPlayback,true);assert.equal(vo.activity.props.phase,'idle');assert.equal(vo.playLabel,'Play recording');assert.equal(played,0);vo.play();assert.equal(played,1);
});

test('the saved-note synth shows pending start, confirmed playback and idle for another note',()=>{
 const begin=source.indexOf('      vo.hasPlayback = true;'),end=source.indexOf('      vo.lines =',begin);
 for(const [playing,ready,phase] of [['saved-audio',false,'connecting'],['saved-audio',true,'speaking'],['other',true,'idle']]){
  const vo={};const context=vm.createContext({vo,React:{createElement:(type,props)=>({type,props})},VoiceActivity:'VoiceActivity',savedPlaybackReady:ready,savedPlaying:playing,current:{ic:{stop:'stop',play:'play'}},selected:{id:'saved-note',audio:{audioId:'saved-audio'}},currentNoteReading:()=>null,stopSpeaking(){},playSaved(){}});
  vm.runInContext(stripTypeScriptTypes(source.slice(begin,end),{mode:'transform'}),context);assert.equal(vo.activity.props.phase,phase);
 }
});

test('the outer canonical decorator preserves only the owned recording playback installed by the voice adapter',()=>{
 const canonical=fs.readFileSync('apps/app/src/prototype/canonical-notes-ui.ts','utf8');
 const helper=canonical.slice(canonical.indexOf('function voiceAudio('),canonical.indexOf('function domainOf('));
 const begin=canonical.indexOf(' decorate(view:Bag'),end=canonical.indexOf(' /** Decorate this view',begin);assert(begin>=0&&end>begin);
 const decorate=vm.runInNewContext(stripTypeScriptTypes(helper+';({'+canonical.slice(begin,end)+'}).decorate',{mode:'transform'}),{});
 const record={format:{kind:'voice',data:{recordingId:'recording',audio:{audioId:'recording',durationMs:1000}}}};
 const ui={controller:{current:true,revision:1,pending:false,hasViewNote:()=>true,viewNote:()=>record},trashValue:[],phase:'ready',editor:{draft:null},open:'note',dirty:false};
 for(const id of ['recording','foreign',undefined]){
  const play=()=>{},view={vo:{hasPlayback:true,playbackAudioId:id,play}};
  const result=decorate.call(ui,view,{ic:{},toast(){}},{});
  assert.equal(result.vo.hasPlayback,id==='recording');assert.equal(result.vo.play===play,id==='recording');
 }
});
