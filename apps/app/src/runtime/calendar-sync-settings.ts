import {calendarSourceKey,type AgentCalendar,type AgentCalendarSyncReview} from './agent-calendar';
import { calendarSyncHost, googleCalendarSyncDestinations } from "./calendar-sync-host";
import { saveGoogleCalendarSelection } from "./google-calendar-selection";
import { googleCalendarAccountKey } from "./google-connection-ui";
import { holdPhoneInert } from "./modal-inert";
import type { CalendarSyncReview } from "./calendar-sync-host";
/** Explicit destination review. Opening Settings does not enable sync or dispatch provider writes. */
export type CanonicalCalendarSyncSettings={calendar:AgentCalendar;current():boolean;canChange():boolean};
/** Presentation only: a published icon, a status dot (always beside a word) and a plain switch row. */
const syncIcon=(name:string)=>{const span=document.createElement('span');span.setAttribute('aria-hidden','true');span.style.cssText=`display:inline-block;flex:none;width:20px;height:20px;vertical-align:middle;background:currentColor;mask:url(/icons/lucide/${name}.svg) center/contain no-repeat;-webkit-mask:url(/icons/lucide/${name}.svg) center/contain no-repeat`;return span;};
const syncIconButton=(name:string,label:string)=>{const button=document.createElement('button');button.setAttribute('aria-label',label);button.style.cssText='display:inline-flex;align-items:center;justify-content:center;min-width:44px';button.append(syncIcon(name));return button;};
const syncDot=()=>{const dot=document.createElement('span');dot.setAttribute('aria-hidden','true');dot.style.cssText='display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;background:#8a8a8a';return dot;};
const syncSwitch=()=>{const row=document.createElement('label'),name=document.createElement('span'),input=document.createElement('input');row.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px';input.type='checkbox';input.setAttribute('role','switch');input.style.cssText='width:22px;height:22px;flex:none';name.textContent='Sync';row.append(name,input);return {row,name,input};};
export function openCalendarSyncSettings(canonical?:CanonicalCalendarSyncSettings) {
 if(canonical)return openCanonicalCalendarSyncSettings(canonical);
	const dialog = document.createElement("dialog");
	dialog.className = "note-source-dialog";
	dialog.setAttribute("aria-label", "Google Calendar sync");
	const theme = document.querySelector(".os");
	if (theme) {
		const style = getComputedStyle(theme);
		for (const token of ["bg", "fg"])
			dialog.style.setProperty(
				"--source-" + token,
				style.getPropertyValue("--" + token),
			);
	}
	const content = document.createElement("div");
	content.className = "note-source-content";
	const title = document.createElement("h2");
	title.textContent = "Google Calendar sync";
	const description = document.createElement("p");
	description.textContent = "Google gets event details and guests.";
	const summary = document.createElement("p"),
		summaryDot = syncDot(),
		summaryText = document.createElement("span");
	summary.setAttribute("role", "status");
	summary.setAttribute("aria-live", "polite");
	summary.append(summaryDot, summaryText);
	const say = (text: string) => {
		summaryText.textContent = text;
		summaryDot.hidden = !text;
	};
	const details = document.createElement("p");
	const destinations = document.createElement("div");
	destinations.setAttribute("role", "group");
	destinations.setAttribute("aria-label", "Google calendars for sync");
	destinations.style.cssText = "display:grid;gap:8px;margin:8px 0";
	const footer = document.createElement("footer");
	// One Sync switch carries Review → Enable (two taps, its own label reads "Confirm sync") and Pause.
	const chooseCalendar = document.createElement("button"),
		toggle = syncSwitch(),
		sync = syncIconButton("rotate-cw", "Sync now"),
		close = syncIconButton("x", "Close");
	chooseCalendar.setAttribute("aria-label", "Choose Google calendar");
	chooseCalendar.style.cssText = "display:inline-flex;align-items:center;gap:6px";
	chooseCalendar.append(syncIcon("calendar"), "Calendar");
	const primary = document.createElement("div");
	primary.style.cssText = "display:flex;flex-wrap:wrap;align-items:center;gap:8px";
	primary.append(chooseCalendar, sync);
	content.append(title, description, summary, toggle.row, details, destinations, primary);
	footer.append(close);
	dialog.append(content, footer);
	const prior = document.activeElement as HTMLElement | null,
		release = holdPhoneInert(document.querySelector<HTMLElement>(".os"));
	let alive = true,
		busy = false,
		review: CalendarSyncReview | undefined;
	const lifetime = new AbortController();
	const update = () => {
		if (!alive) return;
		const state = calendarSyncHost.snapshot();
		say(state.status);
		summaryDot.style.background = state.running ? "#b26a00" : state.enabled ? "#1a7f37" : "#8a8a8a";
		const destination = calendarSyncHost.destination();
		if (state.enabled && destination.account && destination.calendar)
			details.textContent = `${destination.account} · ${destination.calendar}`;
		chooseCalendar.disabled = busy || state.running;
		chooseCalendar.hidden = state.enabled;
		const on = state.enabled || state.running;
		toggle.input.checked = on;
		// On: Pause is always available. Off: Review, then Confirm sync enables the reviewed destination.
		toggle.input.disabled = on ? false : busy || state.running;
		toggle.name.textContent = !on && review ? "Confirm sync" : "Sync";
		sync.disabled = busy || state.running || !state.enabled;
		sync.hidden = !state.enabled;
	};
	const unsubscribe = calendarSyncHost.subscribe(update);
	const finish = () => {
		if (!alive) return;
		alive = false;
		lifetime.abort();
		unsubscribe();
		calendarSyncHost.cancel();
		window.removeEventListener("alpha-back", back, true);
		window.removeEventListener("pagehide", finish);
		document.removeEventListener("visibilitychange", visibility);
		dialog.remove();
		release();
		if (prior?.isConnected) prior.focus();
	};
	const back = (event: Event) => {
			event.preventDefault();
			event.stopImmediatePropagation();
			finish();
		},
		visibility = () => {
			if (document.hidden) finish();
		};
	const run = async (action: () => Promise<unknown>) => {
		if (busy) return;
		busy = true;
		update();
		try {
			await action();
		} catch (error) {
			if (alive)
				say(error instanceof Error ? error.message : "Couldn’t check");
		} finally {
			busy = false;
			update();
		}
	};
	// The sync destination is the only Google calendar choice: Calendar itself always shows every calendar.
	chooseCalendar.onclick = () =>
		void run(async () => {
			destinations.replaceChildren();
			const offered = await googleCalendarSyncDestinations(lifetime.signal);
			if (!alive) return;
			if (!offered.length) {
				details.textContent = "No writable calendar";
				return;
			}
			for (const destination of offered) {
				const choice = document.createElement("button");
				choice.textContent =
					destination.name === destination.account
						? destination.name
						: `${destination.name} · ${destination.account}`;
				choice.onclick = () => {
					const key = googleCalendarAccountKey();
					destinations.replaceChildren();
					review = undefined;
					details.textContent =
						key && saveGoogleCalendarSelection(key, destination)
							? `${choice.textContent}`
							: "Not saved";
					update();
				};
				destinations.append(choice);
			}
		});
	const reviewSync = () =>
		void run(async () => {
			review = undefined;
			const result = await calendarSyncHost.review();
			if (!alive) return;
			review = result;
			const destination = calendarSyncHost.destination();
			details.textContent = `${destination.account} · ${destination.calendar} · ${result.events.length} event${result.events.length === 1 ? "" : "s"}`;
		});
	const enableSync = () =>
		void run(async () => {
			if (!review) return;
			const selected = review;
			review = undefined;
			await calendarSyncHost.enable(selected);
		});
	sync.onclick = () => void run(() => calendarSyncHost.sync());
	const pauseSync = () =>
		void calendarSyncHost.pause().catch((error) => {
			if (alive) say(error instanceof Error ? error.message : "Couldn’t pause");
		});
	toggle.input.onchange = () => {
		const state = calendarSyncHost.snapshot();
		if (state.enabled || state.running) pauseSync();
		else if (review) enableSync();
		else reviewSync();
		update();
	};
	close.onclick = finish;
	dialog.oncancel = (event) => {
		event.preventDefault();
		finish();
	};
	window.addEventListener("alpha-back", back, true);
	window.addEventListener("pagehide", finish);
	document.addEventListener("visibilitychange", visibility);
	document.body.append(dialog);
	dialog.showModal();
	void calendarSyncHost.settings().catch(() => {
		if (alive)
			say("Couldn’t check");
	});
	update();
	toggle.input.focus();
}

/** Canonical mode reviews the agent's own saved controls; it never reads the retained browser/device store. */
function openCanonicalCalendarSyncSettings(scope:CanonicalCalendarSyncSettings){
 const dialog=document.createElement('dialog');dialog.className='note-source-dialog';dialog.setAttribute('aria-label','Google Calendar sync');
 const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
 const content=document.createElement('div');content.className='note-source-content';
 const title=document.createElement('h2');title.textContent='Google Calendar sync';
 const description=document.createElement('p');description.textContent='Google gets event details and guests.';
 const status=document.createElement('p'),statusDot=syncDot(),statusText=document.createElement('span');status.setAttribute('role','status');status.setAttribute('aria-live','polite');status.append(statusDot,statusText);
 const say=(text:string,tone='#8a8a8a')=>{statusText.textContent=text;statusDot.hidden=!text;statusDot.style.background=tone;};
 const select=document.createElement('select');select.setAttribute('aria-label','Google Calendar destination');
 const preview=document.createElement('p'),controls=document.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;align-items:center;gap:8px';
 // Picker + one Sync switch (Save → Confirm sync → Pause, the same select/resume/pause operations) + refresh icon.
 const toggle=syncSwitch(),buttons={refresh:syncIconButton('rotate-cw','Review sync'),recover:document.createElement('button'),close:syncIconButton('x','Close')};
 buttons.recover.textContent='Check';buttons.recover.setAttribute('aria-label','Check pending operation');
 controls.append(buttons.refresh,buttons.recover);const footer=document.createElement('footer');footer.append(buttons.close);content.append(title,description,status,select,toggle.row,preview,controls);dialog.append(content,footer);
 const prior=document.activeElement as HTMLElement|null,release=holdPhoneInert(document.querySelector<HTMLElement>('.os'));
 let alive=true,busy=false,review:AgentCalendarSyncReview|undefined,unsubscribe=()=>{},savedKey='',armed=false;
 const current=()=>alive&&scope.current()&&!document.hidden;
 const canChange=()=>current()&&scope.canChange();
 const update=()=>{
  if(!current()){finish();return;}
  const control=review?.control;
  select.disabled=busy||!control?.paused||!!control.pendingDispatch;
  buttons.refresh.disabled=busy;
  const on=!!control&&!control.paused,unsaved=!!select.value&&select.value!==savedKey;
  if(unsaved)armed=false;
  toggle.input.checked=on;toggle.name.textContent=!on&&armed&&!unsaved?'Confirm sync':'Sync';
  // Off with a new pick saves it (select); off with a saved destination enables it (resume); on pauses.
  toggle.input.disabled=on?busy||!canChange():busy||!canChange()||!control?.paused||!!control.pendingDispatch||(unsaved?false:!control.destination);
  buttons.recover.hidden=!control?.pendingDispatch;
  buttons.recover.disabled=busy||!canChange()||!control?.paused||!control.pendingDispatch;
 };
 const finish=()=>{if(!alive)return;alive=false;unsubscribe();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',finish);document.removeEventListener('visibilitychange',visibility);dialog.remove();release();if(prior?.isConnected)prior.focus();};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();};
 const visibility=()=>{if(document.hidden)finish();};
 const refresh=async()=>{
  review=undefined;select.replaceChildren();preview.textContent='';savedKey='';
  const result=await scope.calendar.reviewSync();if(!current())return;review=result;
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a Google calendar';select.append(placeholder);
  for(const source of result.sources){const option=document.createElement('option');option.value=calendarSourceKey(source);option.textContent=`${source.accountEmail??'Google account'} · ${source.summary}`;select.append(option);if(source.connectorAccountId===result.control.destination?.connectorAccountId&&source.calendarId===result.control.destination?.providerCalendarId)select.value=savedKey=option.value;}
  preview.textContent=result.control.destination?select.selectedOptions[0]?.textContent??'Unavailable':'';
  if(result.control.pendingDispatch)say('Needs review','#b26a00');else if(result.control.paused)say('Paused');else say('On','#1a7f37');
  if(!scope.canChange())say('Finish draft first','#b26a00');
 };
 const run=async(action:()=>Promise<void>)=>{if(busy||!current())return;busy=true;update();try{await action();}catch(error){review=undefined;if(current())say((error instanceof Error?error.message:'Couldn’t verify').replace(/\.$/,''),'#a32121');}finally{busy=false;update();}};
 const change=(operation:'select'|'resume'|'pause'|'recover')=>void run(async()=>{
  if(!review||!canChange())throw Error('Review the current Calendar source and finish any draft first');
  const selected=review;review=undefined;
  await scope.calendar.changeSync(selected,operation,crypto.randomUUID(),canChange,operation==='select'?select.value:undefined);
  armed=operation==='select';
  if(current())await refresh();
 });
 toggle.input.onchange=()=>{const control=review?.control;if(control&&!control.paused)change('pause');else if(select.value&&select.value!==savedKey)change('select');else change('resume');update();};
 buttons.refresh.onclick=()=>void run(refresh);buttons.recover.onclick=()=>change('recover');buttons.close.onclick=finish;select.onchange=update;dialog.oncancel=event=>{event.preventDefault();finish();};
 unsubscribe=scope.calendar.subscribe(update);window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',finish);document.addEventListener('visibilitychange',visibility);document.body.append(dialog);dialog.showModal();void run(refresh);toggle.input.focus();
}
