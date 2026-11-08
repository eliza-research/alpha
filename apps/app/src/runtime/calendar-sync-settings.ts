import {calendarSourceKey,type AgentCalendar,type AgentCalendarSyncReview} from './agent-calendar';
import { calendarSyncHost, googleCalendarSyncDestinations } from "./calendar-sync-host";
import { saveGoogleCalendarSelection } from "./google-calendar-selection";
import { googleCalendarAccountKey } from "./google-connection-ui";
import { holdPhoneInert } from "./modal-inert";
import type { CalendarSyncReview } from "./calendar-sync-host";
/** Explicit destination review. Opening Settings does not enable sync or dispatch provider writes. */
export type CanonicalCalendarSyncSettings={calendar:AgentCalendar;current():boolean;canChange():boolean};
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
	description.textContent =
		"Device calendar events created in Alpha sync to your selected Google calendar. Later edits and deletions sync both ways for linked events while Alpha is open. Agent Calendar events stay with your agent and do not sync. Google receives event details and guest email addresses. Pausing keeps saved events.";
	const summary = document.createElement("p");
	summary.setAttribute("role", "status");
	summary.setAttribute("aria-live", "polite");
	summary.textContent = "Sync stays off until you review and enable it.";
	const details = document.createElement("p");
	const destinations = document.createElement("div");
	destinations.setAttribute("role", "group");
	destinations.setAttribute("aria-label", "Google calendars for sync");
	destinations.style.cssText = "display:grid;gap:8px;margin:8px 0";
	const footer = document.createElement("footer");
	const chooseCalendar = document.createElement("button"),
		reviewButton = document.createElement("button"),
		enable = document.createElement("button"),
		sync = document.createElement("button"),
		pause = document.createElement("button"),
		close = document.createElement("button");
	chooseCalendar.textContent = "Choose Google calendar";
	reviewButton.textContent = "Review sync";
	enable.textContent = "Enable sync";
 enable.style.cssText="background:var(--acc,#0000ff);color:#fff";
	enable.disabled = true;
	sync.textContent = "Sync now";
	pause.textContent = "Pause sync";
	close.textContent = "Close";
	const primary = document.createElement("div");
	primary.style.cssText = "display:flex;flex-wrap:wrap;gap:8px";
	primary.append(chooseCalendar, reviewButton, enable, sync, pause);
	content.append(title, description, summary, details, destinations, primary);
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
		summary.textContent = state.status;
		const destination = calendarSyncHost.destination();
		if (state.enabled && destination.account && destination.calendar)
			details.textContent = `Google account: ${destination.account}. Calendar: ${destination.calendar}. Only linked Alpha events sync. Existing Google events are not imported or overwritten.`;
		chooseCalendar.disabled = busy || state.running;
		chooseCalendar.hidden = state.enabled;
		reviewButton.disabled = busy || state.running;
		enable.disabled = busy || state.running || !review;
		sync.disabled = busy || state.running || !state.enabled;
		sync.hidden = !state.enabled;
		pause.hidden = !state.enabled && !state.running;
		reviewButton.hidden = state.enabled;
		enable.hidden = state.enabled || !review;
		pause.disabled = false;
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
				summary.textContent =
					error instanceof Error ? error.message : "Sync could not be checked.";
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
				details.textContent =
					"No Google calendar accepts Calendar changes. Approve Calendar sync in Settings › Google accounts.";
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
							? `Sync destination: ${choice.textContent}. Review sync to continue.`
							: "The sync destination could not be saved.";
					update();
				};
				destinations.append(choice);
			}
		});
	reviewButton.onclick = () =>
		void run(async () => {
			review = undefined;
			const result = await calendarSyncHost.review();
			if (!alive) return;
			review = result;
			const destination = calendarSyncHost.destination();
			details.textContent = `Google account: ${destination.account}. Calendar: ${destination.calendar}. ${result.events.length} Alpha events will be linked. Existing Google events will not be imported or overwritten.`;
		});
	enable.onclick = () =>
		void run(async () => {
			if (!review) return;
			const selected = review;
			review = undefined;
			await calendarSyncHost.enable(selected);
		});
	sync.onclick = () => void run(() => calendarSyncHost.sync());
	pause.onclick = () =>
		void calendarSyncHost.pause().catch((error) => {
			if (alive)
				summary.textContent =
					error instanceof Error ? error.message : "Sync could not be paused.";
		});
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
			summary.textContent =
				"Saved sync settings could not be checked. Nothing was enabled.";
	});
	update();
	reviewButton.focus();
}

/** Canonical mode reviews the agent's own saved controls; it never reads the retained browser/device store. */
function openCanonicalCalendarSyncSettings(scope:CanonicalCalendarSyncSettings){
 const dialog=document.createElement('dialog');dialog.className='note-source-dialog';dialog.setAttribute('aria-label','Google Calendar sync');
 const theme=document.querySelector('.os');if(theme){const style=getComputedStyle(theme);for(const token of ['bg','fg'])dialog.style.setProperty('--source-'+token,style.getPropertyValue('--'+token));}
 const content=document.createElement('div');content.className='note-source-content';
 const title=document.createElement('h2');title.textContent='Google Calendar sync';
 const description=document.createElement('p');description.textContent='Use the same Agent Calendar shown in Alpha. Enabling sync links all eligible saved built-in events to the selected Google calendar, including dates outside the current view. Later edits and deletions sync for linked events. Google receives event details and guest email addresses. Pausing keeps saved events.';
 const status=document.createElement('p');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 const select=document.createElement('select');select.setAttribute('aria-label','Google Calendar destination');
 const preview=document.createElement('p'),controls=document.createElement('div');controls.style.cssText='display:flex;flex-wrap:wrap;gap:8px';
 const buttons=Object.fromEntries(['refresh','select','resume','pause','recover','close'].map(name=>[name,document.createElement('button')])) as Record<string,HTMLButtonElement>;
 buttons.refresh.textContent='Review sync';buttons.select.textContent='Save destination';buttons.resume.textContent='Enable sync';buttons.pause.textContent='Pause sync';buttons.recover.textContent='Check pending operation';buttons.close.textContent='Close';buttons.resume.style.cssText='background:var(--acc,#0000ff);color:#fff';
 controls.append(buttons.refresh,buttons.select,buttons.resume,buttons.pause,buttons.recover);const footer=document.createElement('footer');footer.append(buttons.close);content.append(title,description,status,select,preview,controls);dialog.append(content,footer);
 const prior=document.activeElement as HTMLElement|null,release=holdPhoneInert(document.querySelector<HTMLElement>('.os'));
 let alive=true,busy=false,review:AgentCalendarSyncReview|undefined,unsubscribe=()=>{};
 const current=()=>alive&&scope.current()&&!document.hidden;
 const canChange=()=>current()&&scope.canChange();
 const update=()=>{
  if(!current()){finish();return;}
  const control=review?.control;
  select.disabled=busy||!control?.paused||!!control.pendingDispatch;
  buttons.refresh.disabled=busy;
  buttons.select.disabled=busy||!canChange()||!control?.paused||!!control.pendingDispatch||!select.value;
  buttons.resume.disabled=busy||!canChange()||!control?.paused||!!control.pendingDispatch||!control.destination;
  buttons.pause.disabled=busy||!canChange()||!control||control.paused;
  buttons.recover.disabled=busy||!canChange()||!control?.paused||!control.pendingDispatch;
 };
 const finish=()=>{if(!alive)return;alive=false;unsubscribe();window.removeEventListener('alpha-back',back,true);window.removeEventListener('pagehide',finish);document.removeEventListener('visibilitychange',visibility);dialog.remove();release();if(prior?.isConnected)prior.focus();};
 const back=(event:Event)=>{event.preventDefault();event.stopImmediatePropagation();finish();};
 const visibility=()=>{if(document.hidden)finish();};
 const refresh=async()=>{
  review=undefined;select.replaceChildren();preview.textContent='';
  const result=await scope.calendar.reviewSync();if(!current())return;review=result;
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choose a Google calendar';select.append(placeholder);
  for(const source of result.sources){const option=document.createElement('option');option.value=calendarSourceKey(source);option.textContent=`${source.accountEmail??'Google account'} · ${source.summary}`;select.append(option);if(source.connectorAccountId===result.control.destination?.connectorAccountId&&source.calendarId===result.control.destination?.providerCalendarId)select.value=option.value;}
  preview.textContent=result.control.destination?`Saved destination: ${select.selectedOptions[0]?.textContent??'unavailable'}. ${result.visibleLocalEventIds.length} built-in events are visible in the current Calendar range. Enabling sync includes eligible events outside this range too.`:'No sync destination is enabled. Choose and save a destination, then enable sync separately.';
  status.textContent=result.control.pendingDispatch?'A prior operation needs review. Pause and check it before enabling sync.':result.control.paused?'Sync is paused. Saved events are kept.':'Sync is enabled for the saved Agent Calendar destination.';
  if(!scope.canChange())status.textContent='Finish or close the retained Calendar draft before changing sync. Saved events are unchanged.';
 };
 const run=async(action:()=>Promise<void>)=>{if(busy||!current())return;busy=true;update();try{await action();}catch(error){review=undefined;if(current())status.textContent=(error instanceof Error?error.message:'Sync could not be verified')+'. Review sync status before another change.';}finally{busy=false;update();}};
 const change=(operation:'select'|'resume'|'pause'|'recover')=>void run(async()=>{
  if(!review||!canChange())throw Error('Review the current Calendar source and finish any draft first');
  const selected=review;review=undefined;
  await scope.calendar.changeSync(selected,operation,crypto.randomUUID(),canChange,operation==='select'?select.value:undefined);
  if(current())await refresh();
 });
 buttons.refresh.onclick=()=>void run(refresh);buttons.select.onclick=()=>change('select');buttons.resume.onclick=()=>change('resume');buttons.pause.onclick=()=>change('pause');buttons.recover.onclick=()=>change('recover');buttons.close.onclick=finish;select.onchange=update;dialog.oncancel=event=>{event.preventDefault();finish();};
 unsubscribe=scope.calendar.subscribe(update);window.addEventListener('alpha-back',back,true);window.addEventListener('pagehide',finish);document.addEventListener('visibilitychange',visibility);document.body.append(dialog);dialog.showModal();void run(refresh);buttons.refresh.focus();
}
