# Alpha's agent pack

The resident agent the phone runs is eliza's: `agent.mjs`, built by
`buildAgentBundle` of `@elizaos/agent-host` from the commit `eliza.lock.json`
pins, and started by eliza's Android agent service from three data files
(`spec/os/agentService/config.md` in eliza). What the bundle may hold, how its
manifest is written and read, and what it refuses are eliza's
(`spec/agent/plugins/bundle.md`); how a launch is read, which keys it refuses
and with which exit code are eliza's too (`spec/agent/host/launch.md`,
`spec/agent/host/process.md`), as is the route gate (`spec/agent/access/routes.md`).
This spec holds only what Alpha decides: who the agent is, which of eliza's
plugins the bundle carries and which of the agent's own modules the launch
loads, as the old phone's agent did, which actions it may run, which routes
the page may reach, that it remembers, which cloud model it asks, which
workflow worker it pins, and which host services the phone does not give the
plugins yet. `apps/agent` builds the pack into `apps/agent/dist/bundle` and
checks it against these rules (`node dist/src/main.js build --env <staging|production>`,
then `check`).

## Story: Run Alpha's agent on the phone

> As the owner, I want the agent on my phone to be Alpha, to answer me
> through my cloud account, to do what the old phone's agent did with my
> calendar, mail, notes, files, workflows, maps and browser, to remember our
> conversation when it restarts, and to be reachable from the page only
> where the page needs it.

### The agent is Alpha, made by Alpha Compute, with a system prompt

The name is the product's character name, `identity.characterName` of the
old product record (`legacy/apps/app/src/product/alpha-product-registration.ts`),
and the bio is the one the old agent was given
(the old tree's agent identity script at `26e827f06`, line 14). The old agent had no system
prompt of its own and kept its preset's origin line, "{{name}}, made by Alpha
Compute" (line 10); eliza's launch needs one, so that line, with the name, is
its start. eliza's tools, notes and results name the person in the
conversation "the owner", which the model repeated back to them, so the
prompt also tells the agent to speak to that person as "you", never as "the
owner" or "the user". The model also described example.com from memory when
asked to summarize "this page" on Home, where no page goes with the turn, so
the prompt tells the agent that it sees a web page only in the latest
message's Browser page, and with none to say that no page is open rather
than describe one. With a page that had little text, the model filled in
what it knew of the site, calling example.com a reserved placeholder domain
when the page said nothing of it, so the prompt also tells the agent to answer
from the page's title, address and text alone and to say when a page has
little on it. Asked "Go home." from Notes, with Home declared as a
view, the model most often planned directions to a saved Home place or asked
which was meant, where the old phone went to its home screen. So the prompt
tells the agent that the phone's screens are its views and Home is the home
screen, and that a request to go to one of these screens by its name, with no
directions, route or travel asked for, means that screen, shown with VIEWS
without asking. In a long chat the model once wrote its own reasoning back
to the owner, naming an action ("I don't have access to the OWNER_REMINDERS
tool"), so the prompt also tells the agent to say in plain words what it
did or cannot do, and to keep how it does it behind the scenes, and what any
of that is called, out of its replies. The sentence names no tools itself:
one that said "never mention your tools" did no better in 100 real-model
asks. The model still decides what a request means; nothing matches the
owner's words, and nothing is taken out of a reply. The words are in `apps/agent/host/character.json`.

```quint
pure val characterName: str = "Alpha"
pure def characterAdmitted(name: str, system: str): bool = name == characterName and system != ""
```

### The pack carries the plugins the old phone's agent loaded, under the pinned eliza's names, and the launch loads them with the agent's own modules the old agent had

The old phone (Alpha develop `bd70db55b2b`, eliza `17116b70e6`) loaded eliza's
mobile plugin set: its core group (personal assistant with reminders, goals
and todos, calendar, inbox, notes, files on the device, workflows) and its
view group (maps, browser) (`packages/agent/src/runtime/core-plugins.ts` there,
`MOBILE_CORE_PLUGINS` and `MOBILE_VIEW_PLUGINS`). The pinned eliza names them
`@elizaos/plugin-personal-assistant` (whose reminders, goals and todos are
its own subpaths now), `-calendar`, `-inbox`, `-notes`, `-files`,
`-workflow`, `-maps` and `-browser`, and the pack carries each in the same
group. Notes exports no plugin, only a module the entry builds
(`notesModule`), so it is hosted rather than bundled. Alpha opens Notes
with three days of Trash retention. The wallet is eliza's `walletModule`,
hosted the same way: the old phone's agent never loaded a wallet (the
earlier product deferred it), and this one carries it so that the Wallet
app has an agent to ask. Scheduling is now the
agent's own `scheduled-tasks`, `tasks` and `triggers` modules; the
proposal of a device step is its `device-actions` module, and a drafted
reply its `reply-draft`; approvals, notifications, views and the task
surface are modules too, and the launch loads each. SQL storage is the
agent's fixed storage, which no launch lists. What the old phone loaded
and the pack does not: vision, whose `sharp` eliza never ships on a device;
the agent orchestrator's view and the mobile remote target, which the
pinned eliza does not have; the OpenAI and Eliza Cloud provider plugins,
because the model is the launch's own cloud model; and `basic-actions`,
whose only action is the calculator the old agent never had. The pack includes
Eliza's hosted local inference module for speech. On Android it uses the
bundled speech models through the app's peer-checked local socket. Browser
and pack smoke launches with no socket load no speech model. Text replies
still use the launch's Cloud text backend and embeddings remain off.

```quint
pure val corePlugins: List[str] = List("@elizaos/plugin-personal-assistant", "@elizaos/plugin-calendar", "@elizaos/plugin-inbox", "@elizaos/plugin-notes", "@elizaos/plugin-files", "@elizaos/plugin-workflow", "@elizaos/plugin-local-inference", "@elizaos/plugin-wallet")
pure val viewPlugins: List[str] = List("@elizaos/plugin-maps", "@elizaos/plugin-browser")
pure val hostedPlugins: List[str] = List("@elizaos/plugin-notes", "@elizaos/plugin-local-inference", "@elizaos/plugin-wallet")
pure val notesTrashDays = 3
pure val packedPlugins: List[str] = List("@elizaos/plugin-personal-assistant", "@elizaos/plugin-calendar", "@elizaos/plugin-inbox", "@elizaos/plugin-notes", "@elizaos/plugin-files", "@elizaos/plugin-workflow", "@elizaos/plugin-maps", "@elizaos/plugin-browser", "@elizaos/plugin-local-inference", "@elizaos/plugin-wallet")
pure val bundledPlugins: List[str] = List("@elizaos/plugin-personal-assistant", "@elizaos/plugin-calendar", "@elizaos/plugin-inbox", "@elizaos/plugin-files", "@elizaos/plugin-workflow", "@elizaos/plugin-maps", "@elizaos/plugin-browser")
pure val agentModules: List[str] = List("@elizaos/agent/device-actions", "@elizaos/agent/reply-draft", "@elizaos/agent/approvals", "@elizaos/agent/notifications", "@elizaos/agent/views", "@elizaos/agent/scheduled-tasks", "@elizaos/agent/tasks", "@elizaos/agent/triggers", "@elizaos/agent/surface")
pure val loadList: List[str] = List("@elizaos/plugin-personal-assistant", "@elizaos/plugin-calendar", "@elizaos/plugin-inbox", "@elizaos/plugin-notes", "@elizaos/plugin-files", "@elizaos/plugin-workflow", "@elizaos/plugin-maps", "@elizaos/plugin-browser", "@elizaos/plugin-local-inference", "@elizaos/plugin-wallet", "@elizaos/agent/device-actions", "@elizaos/agent/reply-draft", "@elizaos/agent/approvals", "@elizaos/agent/notifications", "@elizaos/agent/views", "@elizaos/agent/scheduled-tasks", "@elizaos/agent/tasks", "@elizaos/agent/triggers", "@elizaos/agent/surface")
pure def lawPackListsAreConsistent(p: str): bool =
  (packedPlugins.includes(p) iff (corePlugins.includes(p) or viewPlugins.includes(p)))
    and (bundledPlugins.includes(p) iff (packedPlugins.includes(p) and not(hostedPlugins.includes(p))))
    and (loadList.includes(p) iff (packedPlugins.includes(p) or agentModules.includes(p)))
```

### The wallet runs on Sepolia and Solana's devnet until its keys can be backed up

The wallet's keys are sealed on the phone and nothing exports them, so a
phone that is lost or reset loses its wallet. Until the owner can back
the keys up, the pack points the wallet at test networks only, where what
it holds has no value: Sepolia for its EVM account and Solana's devnet
for its Solana account. The entry gives the wallet module these settings
and no others.

```quint
type WalletSetting = { setting: str, held: str }
pure val walletSettings: List[WalletSetting] = List(
  { setting: "WALLET_EVM_RPC_URL", held: "https://ethereum-sepolia-rpc.publicnode.com" },
  { setting: "WALLET_EVM_CHAIN_ID", held: "11155111" },
  { setting: "WALLET_SOLANA_RPC_URL", held: "https://api.devnet.solana.com" },
  { setting: "WALLET_SOLANA_CHAIN_ID", held: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG" })
pure val valuedChains: List[str] = List("1", "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")
pure def lawTheWalletHoldsNothingOfValue(chain: str): bool =
  valuedChains.includes(chain) implies not(walletSettings.some(s => s.held == chain))
```

### The wallet can be made only on a launch with the signed-in account's storage key

A signed-in phone gives the resident wallet the same account-bound storage
key it releases for the task store. The wallet uses that key to seal its
own keys on this phone when the owner chooses Make wallet. Opening Wallet
with no wallet yet only offers that choice. Without the launch key the
wallet cannot be made.

```quint
pure val walletKeysAllowed = true
pure def walletGetsKey(launchKey: bool): bool = launchKey and walletKeysAllowed
pure def lawTheWalletRequiresTheLaunchKey(launchKey: bool): bool =
  walletGetsKey(launchKey) iff launchKey
```

### The agent may run the actions the old phone's agent ran plus Alpha's Clock, Reminders and Device Control actions, and every other action the bundle registers is listed as refused with its reason

The old agent had no allowlist: every action its plugins registered could
run. The pack's plugins register those same actions under the pinned
eliza's names, and Alpha's `alpha-apps` product plugin registers
`CLOCK_ALARM`, `CLOCK_TIMER`, `CLOCK_WORLD`, `REMINDERS_MANAGE` and
`DEVICE_CONTROL`.
`CLOCK_ALARM` tells the model that an alarm rings at a clock time, that
being woken up is an alarm, and that a reminder never stands in for one,
as the old phone's agent was told; which tool a request needs stays the
model's to decide. `DEVICE_CONTROL` lets the agent observe and act inside
an owner-approved third-party app within the lease and screen-safety rules
of `spec/app/control/index.md`. Eliza's
wallet module registers `WALLET`, which reads the wallet and asks for a
transfer and can approve none.
`BROWSER_OPEN` hands a web page the owner asks for to the screen they asked
from, where no enrolled phone takes the open as a proposed step; the screen
shows it for the owner to open, as the old phone did. The
policy names `alpha-apps` as its product plugin and allows each action by
name, so an action a later pin adds is refused until it is reviewed here.
Core's `REPLY`, `IGNORE` and `NONE` are always allowed. Every other
registered action is named in the policy's refused list with the reason the
old phone did not run it: `CALCULATE` because the old agent had no
calculator.

```quint
pure val productPluginName: str = "alpha-apps"
pure val coreActions: List[str] = List("REPLY", "IGNORE", "NONE")
pure val alphaAppActions: List[str] = List("CLOCK_ALARM", "CLOCK_TIMER", "CLOCK_WORLD", "REMINDERS_MANAGE", "DEVICE_CONTROL")
pure val allowedActions: List[str] = List(
  "REPLY", "IGNORE", "NONE",
  "OWNER_REMINDERS", "OWNER_GOALS", "TODO", "OWNER_ROUTINES", "BRIEF",
  "CALENDAR",
  "INBOX_READ", "INBOX_COMPOSE_EMAIL",
  "WORKFLOW",
  "MAPS_PLACE", "MAPS_WHERE_AM_I", "MAPS_ROUTE", "MAPS_NAVIGATION_START", "MAPS_NAVIGATION_REROUTE", "MAPS_NAVIGATION_STOP",
  "MAPS_SELECT", "MAPS_SAVE", "MAPS_SHARE", "MAPS_COVERAGE", "MAPS_SAVED",
  "BROWSER", "BROWSER_BACK", "BROWSER_FORWARD", "BROWSER_RELOAD", "BROWSER_OPEN",
  "NOTES_LIST", "NOTES_GET", "NOTES_CREATE", "NOTES_UPDATE", "NOTES_DELETE", "NOTES_RESTORE", "NOTES_MOVE",
  "PROPOSE_DEVICE_ACTION", "VIEWS",
  "CLOCK_ALARM", "CLOCK_TIMER", "CLOCK_WORLD", "REMINDERS_MANAGE", "DEVICE_CONTROL",
  "WALLET"
)
pure def lawCoreActionsAreAlwaysAllowed(a: str): bool = coreActions.includes(a) implies allowedActions.includes(a)
pure def sameNames(a: List[str], b: List[str]): bool =
  a.length() == b.length() and a.every(x => b.includes(x)) and b.every(x => a.includes(x))
pure def refusedActions(registered: List[str]): List[str] = registered.select(a => not(allowedActions.includes(a)))
pure def policyAdmitted(allowed: List[str], refused: List[str], loaded: List[str], product: str, registered: List[str]): bool =
  sameNames(allowed, allowedActions) and sameNames(refused, refusedActions(registered)) and loaded == loadList and product == productPluginName
```

### A reminder with a due time keeps one scheduled task, and the task follows what the owner does to the reminder

The old phone fired a reminder through the agent's own scheduler, so a
dated, open reminder in Alpha's Reminders keeps one owner-visible
personal-assistant task, and a reminder the owner asks for in chat is that
task. Whatever the owner does to the reminder, in the Reminders app or in
chat, its task follows: deleting it, or taking its due time away, dismisses
the task, so it never comes back; completing it completes the task, and
completing a repeating one moves the task to its next due time; reopening
it reopens the task at the reminder's due time, since completing a
one-off reminder leaves its task no next occurrence; and a new due time
moves the task, so it fires only at the new time. A reviewed Calendar
reopen with No alert keeps the due time and dismisses its prior task
without starting another. Other dated, open reminders with no task get
one, and a reminder whose task the
owner dismisses in chat is deleted.
A task that cannot follow, such as one completed too long ago to reopen,
is dismissed and the reminder gets a new one. A change whose task stays
where it was is reported as not done, so neither the owner nor the model
is told it worked, and a reminder whose task stays is not deleted. Each
change that is made carries an applied receipt for the reminder or list it
changed, so a later save answers an earlier call that did not start; a list
or a search carries none. What the model reads of a reminder gives its due
day and time in the owner's time zone, named, and whether it is pending,
overdue or completed.

```quint
type TaskStep = MakeTask | DismissTask | CompleteTask | ReopenTask | MoveTask
pure def taskSteps(kept: bool, dated: bool, completed: bool, wasCompleted: bool, retimed: bool, hasTask: bool): List[TaskStep] =
  if (not(hasTask)) (if (kept and dated and not(completed)) List(MakeTask) else List())
  else if (not(kept) or not(dated)) List(DismissTask)
  else if (completed) (if (wasCompleted) List() else List(CompleteTask))
  else if (wasCompleted) List(ReopenTask, MoveTask)
  else if (retimed) List(MoveTask)
  else List()
pure def lawADeletedReminderLeavesNoTask(dated: bool, completed: bool, wasCompleted: bool, retimed: bool): bool =
  taskSteps(false, dated, completed, wasCompleted, retimed, true) == List(DismissTask)
pure def lawAMovedOpenReminderFiresOnlyAtItsNewTime(wasCompleted: bool): bool =
  taskSteps(true, true, false, wasCompleted, true, true).includes(MoveTask)
    and not(taskSteps(true, true, false, wasCompleted, true, true).includes(MakeTask))
pure def lawCompletingCompletesTheTask(retimed: bool): bool =
  taskSteps(true, true, true, false, retimed, true) == List(CompleteTask)
```

### A proposed device step goes through eliza's device-action module, and the phone says which steps it takes

The old agent asked the phone to do things on the device (create an event,
save a note, call, text, open a page) by proposing a step the owner
reviews. The pack loads eliza's `device-actions` and `reply-draft` modules
and allows `PROPOSE_DEVICE_ACTION`. Which steps the phone takes, and which
the old phone withheld (`notes.organize.v1` and the telephony contact
lookup), is the phone's capability offer (`spec/app/platform/index.md`,
`spec/app/phone/`, `spec/app/messages/`, `spec/app/contacts/`), not the agent's policy.

```quint
pure val deviceActionModules: List[str] = List("@elizaos/agent/device-actions", "@elizaos/agent/reply-draft")
pure val proposalAction: str = "PROPOSE_DEVICE_ACTION"
pure def proposalsAdmitted(loaded: List[str], allowed: List[str]): bool =
  deviceActionModules.every(m => loaded.includes(m)) and allowed.includes(proposalAction)
```

### The launch names Home and every Alpha app but Notes and Browser as a view the agent may show, by the id the phone opens it by

The old phone opened any of its apps, and Home, when the owner asked.
eliza's views module declares, once at boot, the views of the plugins
loaded before it and the launch's own `views` (`spec/agent/views.md` in
eliza); its VIEWS action prepares a view only by a name declared there.
Alpha's product plugin loads after every listed module, so a view it
declared would never be seen. Notes is `@elizaos/plugin-notes`'s own view
and Browser is `@elizaos/plugin-browser`'s, with the commands it grants the
agent, and a launch view may not replace a plugin's view, so the agent
would refuse to start. So the host file names Home and Alpha's other apps, in the order the
phone lists them (`apps/app/src/shell/order.ts`), and eliza's agent service
writes them into the launch (`spec/os/agentService/config.md`). Each id is
the app's name in lower case, which the phone's renderer opens as that app.
Clock and Reminders keep the other names the product plugin gave them, at
most four each, as a launch allows. Home is also named the home screen and
the launcher, the phone's own names for it, so that next to Maps' directions
home it reads as a screen and not a place. The model chooses which view a request means, by one of
these names; nothing matches the owner's words. Whether a prepared view
opens is the phone's: an app the phone does not admit, or any app over a
sensitive screen, stays closed (`spec/app/assistant/index.md`, "Story: Let
Alpha open what it is talking about").

```quint
type LaunchView = { id: str, label: str, path: str, aliases: List[str] }
pure val launchViews: List[LaunchView] = List(
  { id: "home", label: "Home", path: "/home", aliases: List("home screen", "launcher") },
  { id: "phone", label: "Phone", path: "/phone", aliases: List() },
  { id: "messages", label: "Messages", path: "/messages", aliases: List() },
  { id: "inbox", label: "Inbox", path: "/inbox", aliases: List() },
  { id: "telegram", label: "Telegram", path: "/telegram", aliases: List() },
  { id: "slack", label: "Slack", path: "/slack", aliases: List() },
  { id: "calendar", label: "Calendar", path: "/calendar", aliases: List() },
  { id: "clock", label: "Clock", path: "/clock", aliases: List("alarms", "timers", "stopwatch", "world clock") },
  { id: "reminders", label: "Reminders", path: "/reminders", aliases: List("reminder", "to-do", "todo", "tasks") },
  { id: "camera", label: "Camera", path: "/camera", aliases: List() },
  { id: "photos", label: "Photos", path: "/photos", aliases: List() },
  { id: "maps", label: "Maps", path: "/maps", aliases: List() },
  { id: "contacts", label: "Contacts", path: "/contacts", aliases: List() },
  { id: "files", label: "Files", path: "/files", aliases: List() },
  { id: "workflows", label: "Workflows", path: "/workflows", aliases: List() },
  { id: "wallet", label: "Wallet", path: "/wallet", aliases: List() },
  { id: "settings", label: "Settings", path: "/settings", aliases: List() },
)
pure def viewsAdmitted(views: List[LaunchView]): bool = views == launchViews
```

### The page reaches exactly the routes its platform services call, and nothing else

The page's agent service (`apps/app/src/platform/agent.vibe`) on the phone
goes through eliza's `ElizaAgent` plugin, which checks each request against
the host file's route list. Ask Alpha opens its conversation with
`POST /api/conversations` (`apps/app/src/ask/ask.vibe`), and eliza's
`TurnController`, which carries its turns, posts each message buffered or
streamed and asks the agent to stop a turn by its room; the assistant
also asks the agent to warm its model before the owner's first turn. The assistant
(`apps/app/src/assistant/assistant.vibe`) lists conversations, reads a
conversation's messages, forks one, searches messages, asks the agent's
health and which device steps it takes, and claims and reports assistant view
interactions (`apps/app/src/assistant/views.vibe`). Voice warms the cloud
connection (`apps/app/src/platform/voice.vibe`) and Messages requests reply
drafts (`apps/app/src/messages/composer.vibe`). Home and Calendar
(`apps/app/src/home/cards.vibe`, `apps/app/src/calendar/agent.vibe`,
`apps/app/src/calendar/link.vibe`) read the
calendar feed and the calendars, create, change, answer and delete
events, and read and update linked calendar sync control, destinations and
event links through the calendar plugin. Workflows reads the owner identity,
active and removed workflows, prompts, scheduled tasks, definitions,
execution and approval receipts. It sends the owner's exact-version
approval, lifecycle and run decisions and reads back their outcomes.
The builder reads the phone catalogue, generates and validates drafts,
saves the reviewed spec and checks save receipts. Workflows also sends
the owner's prompt and scheduled task changes. Scheduled Digests reads
hosted sources, loops and retained results. The buffered results GET admits
one query key, `clientId`, with the pinned provider's identifier pattern
`[A-Za-z0-9][A-Za-z0-9_-]{0,127}`. The provider requires that key to read
a page. Workflows sends reviewed schedule changes and acknowledges a
retained page after storing it, using the final result's cursor and run ID.
Notes reads the same owner identity and calls the Notes module to
read and edit notes, erase Trash and finish recording cleanup. The scanner
hands the owner’s reviewed scan text to Notes through that module. The approvals area lists the agent's proposals and resolves one
through the approvals module. Ask Alpha completes a reviewed Messages read only
for the exact owner turn after the agent acknowledges its device receipt.
Wallet reads the wallet module's status, holdings, waiting requests and
activity, makes and switches the wallet, asks for a transfer, and opens and
decides its review. Settings reads and updates Alpha's on-device local LLM
status, pinned model catalog, AI routing mode, active model, and model removal. A route an area
fakes for want of an agent plugin is not listed: none does today. Each line
of `apps/agent/host/routes.jsonl` is one route; the pack is refused unless
that list is this one, and eliza's route gate admits each of its routes.

```quint
type Method = Get | Post | Put | Patch | Delete
type Route = { method: Method, path: str, stream: bool }
pure val browserNotesCleanup = "/api/alpha/notes/browser-cleanup"
pure val browserNotesTranscription = "/api/alpha/notes/transcription"
pure val browserNotesTranscriptionLimit = 1100000
pure val pageRoutesCore: List[Route] = List(
  { method: Get, path: "/api/health", stream: false },
  { method: Get, path: "/api/status", stream: false },
  { method: Post, path: "/api/conversations", stream: false },
  { method: Get, path: "/api/conversations", stream: false },
  { method: Get, path: "/api/conversations/messages/search", stream: false },
  { method: Get, path: "/api/conversations/{id}/messages", stream: false },
  { method: Post, path: "/api/conversations/{id}/messages", stream: false },
  { method: Post, path: "/api/conversations/{id}/messages/stream", stream: true },
  { method: Post, path: "/api/conversations/{id}/fork", stream: false },
  { method: Post, path: "/api/turns/warm", stream: false },
  { method: Post, path: "/api/turns/{roomId}/abort", stream: false },
  { method: Post, path: "/api/cloud/warm", stream: false },
  { method: Post, path: "/api/messages/reply-draft", stream: false },
  { method: Post, path: "/api/views/interact-claim", stream: false },
  { method: Post, path: "/api/views/interact-result", stream: false },
  { method: Get, path: "/api/client-devices/capabilities", stream: false },
  { method: Post, path: "/api/client-devices/register", stream: false },
  { method: Post, path: "/api/client-devices/revoke", stream: false },
  { method: Get, path: "/api/client-devices/context", stream: false },
  { method: Get, path: "/api/client-devices/proposals", stream: false },
  { method: Post, path: "/api/client-devices/proposals/{id}/decision", stream: false },
  { method: Post, path: "/api/client-devices/proposals/{id}/claim", stream: false },
  { method: Post, path: "/api/client-devices/proposals/{id}/receipt", stream: false },
  { method: Post, path: "/api/client-devices/proposals/{id}/read-completion", stream: false },
  { method: Post, path: "/api/client-devices/proposals/{id}/reconciliation", stream: false },
  { method: Get, path: "/api/approvals", stream: false },
  { method: Post, path: "/api/approvals/{id}/resolve", stream: false },
  { method: Get, path: "/api/lifeops/calendar/feed", stream: false },
  { method: Get, path: "/api/lifeops/calendar/calendars", stream: false },
  { method: Post, path: "/api/lifeops/calendar/events", stream: false },
  { method: Patch, path: "/api/lifeops/calendar/events/{eventId}", stream: false },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", stream: false },
)
pure val pageRoutesApps: List[Route] = List(
  { method: Post, path: "/api/lifeops/calendar/events/{eventId}/response", stream: false },
  { method: Get, path: "/api/lifeops/calendar/sync-control", stream: false },
  { method: Post, path: "/api/lifeops/calendar/sync-control", stream: false },
  { method: Get, path: "/api/lifeops/calendar/sync-control/destinations", stream: false },
  { method: Get, path: "/api/lifeops/calendar/links", stream: false },
  { method: Get, path: "/api/notifications", stream: false },
  { method: Post, path: "/api/notifications/{id}/read", stream: false },
  { method: Get, path: "/api/scheduled-tasks", stream: false },
  { method: Get, path: "/api/alpha/clock", stream: false },
  { method: Put, path: "/api/alpha/clock", stream: false },
  { method: Post, path: "/api/alpha/clock/alarms", stream: false },
  { method: Patch, path: "/api/alpha/clock/alarms/{id}", stream: false },
  { method: Delete, path: "/api/alpha/clock/alarms/{id}", stream: false },
  { method: Post, path: "/api/alpha/clock/alarms/{id}/snooze", stream: false },
  { method: Post, path: "/api/alpha/clock/alarms/{id}/dismiss", stream: false },
  { method: Post, path: "/api/alpha/clock/timers", stream: false },
  { method: Patch, path: "/api/alpha/clock/timers/{id}", stream: false },
  { method: Delete, path: "/api/alpha/clock/timers/{id}", stream: false },
  { method: Post, path: "/api/alpha/clock/world", stream: false },
  { method: Delete, path: "/api/alpha/clock/world/{id}", stream: false },
  { method: Get, path: "/api/alpha/reminders", stream: false },
  { method: Post, path: "/api/alpha/reminders/lists", stream: false },
  { method: Patch, path: "/api/alpha/reminders/lists/{id}", stream: false },
  { method: Delete, path: "/api/alpha/reminders/lists/{id}", stream: false },
  { method: Post, path: "/api/alpha/reminders/items", stream: false },
  { method: Patch, path: "/api/alpha/reminders/items/{id}", stream: false },
  { method: Delete, path: "/api/alpha/reminders/items/{id}", stream: false },
  { method: Post, path: "/api/alpha/reminders/items/{id}/complete", stream: false },
  { method: Post, path: "/api/alpha/reminders/items/{id}/reopen", stream: false },
  { method: Post, path: "/api/alpha/reminders/items/{id}/snooze", stream: false },
  { method: Post, path: "/api/alpha/reminders/items/{id}/restore", stream: false },
)
pure val pageRoutesWorkflows: List[Route] = List(
  { method: Get, path: "/api/auth/me", stream: false },
  { method: Get, path: "/api/workflow/workflows", stream: false },
  { method: Get, path: "/api/workflow/removed-workflows", stream: false },
  { method: Get, path: "/api/triggers", stream: false },
  { method: Get, path: "/api/triggers/{id}/runs", stream: false },
  { method: Get, path: "/api/notes/state", stream: false },
  { method: Post, path: "/api/notes/interact", stream: false },
  { method: Post, path: "/api/notes/trash/erase", stream: false },
  { method: Get, path: "/api/notes/trash/recordings", stream: false },
  { method: Get, path: browserNotesTranscription, stream: false },
  { method: Post, path: browserNotesTranscription, stream: false },
  { method: Post, path: browserNotesCleanup, stream: false },
  { method: Get, path: "/api/workflow/status", stream: false },
  { method: Get, path: "/api/workflow/hosted/loops", stream: false },
  { method: Post, path: "/api/workflow/hosted/loops", stream: false },
  { method: Get, path: "/api/workflow/hosted/sources", stream: false },
  { method: Get, path: "/api/workflow/hosted/results", stream: false },
  { method: Post, path: "/api/workflow/hosted/results/ack", stream: false },
  { method: Get, path: "/api/workflow/workflows/{id}", stream: false },
  { method: Get, path: "/api/workflow/workflows/{id}/executions", stream: false },
  { method: Get, path: "/api/workflow/executions/{id}", stream: false },
  { method: Get, path: "/api/workflow/executions/{id}/approvals", stream: false },
  { method: Get, path: "/api/workflow/executions/{id}/phone-review", stream: false },
  { method: Post, path: "/api/workflow/executions/{id}/approvals/{nodeId}/{iteration}", stream: false },
  { method: Post, path: "/api/workflow/workflows/{id}/activate", stream: false },
  { method: Post, path: "/api/workflow/workflows/{id}/deactivate", stream: false },
  { method: Post, path: "/api/workflow/workflows/{id}/metadata", stream: false },
  { method: Post, path: "/api/workflow/workflows/{id}/lifecycle", stream: false },
  { method: Get, path: "/api/workflow/workflows/{id}/metadata-mutations/{mutationId}", stream: false },
  { method: Get, path: "/api/workflow/workflows/{id}/lifecycle-mutations/{mutationId}", stream: false },
)
pure val pageRoutesTasksWallet: List[Route] = List(
  { method: Post, path: "/api/workflow/workflows/{id}/run", stream: false },
  { method: Post, path: "/api/workflow/executions/{id}/cancel", stream: false },
  { method: Get, path: "/api/workflow/workflows/{id}/submissions/{submissionId}", stream: false },
  { method: Get, path: "/api/workflow/phone/catalog", stream: false },
  { method: Get, path: "/api/workflow/phone/mutations/{mutationId}", stream: false },
  { method: Post, path: "/api/workflow/phone/generate", stream: false },
  { method: Post, path: "/api/workflow/phone/validate", stream: false },
  { method: Post, path: "/api/workflow/phone/workflows", stream: false },
  { method: Post, path: "/api/workflow/workflows/{id}/phone-spec", stream: false },
  { method: Get, path: "/api/scheduled-tasks/{id}", stream: false },
  { method: Get, path: "/api/triggers/{id}", stream: false },
  { method: Post, path: "/api/triggers", stream: false },
  { method: Post, path: "/api/triggers/{id}/execute", stream: false },
  { method: Put, path: "/api/triggers/{id}", stream: false },
  { method: Delete, path: "/api/triggers/{id}", stream: false },
  { method: Post, path: "/api/scheduled-tasks/{id}/snooze", stream: false },
  { method: Post, path: "/api/scheduled-tasks/{id}/complete", stream: false },
  { method: Post, path: "/api/scheduled-tasks/{id}/dismiss", stream: false },
  { method: Post, path: "/api/scheduled-tasks/{id}/skip", stream: false },
  { method: Post, path: "/api/scheduled-tasks/{id}/reopen", stream: false },
  { method: Post, path: "/api/scheduled-tasks/{id}/fire", stream: false },
  { method: Get, path: "/api/wallet", stream: false },
  { method: Post, path: "/api/wallet", stream: false },
  { method: Post, path: "/api/wallet/switch", stream: false },
  { method: Get, path: "/api/wallet/holdings", stream: false },
  { method: Get, path: "/api/wallet/activity", stream: false },
  { method: Get, path: "/api/wallet/requests", stream: false },
  { method: Post, path: "/api/wallet/requests", stream: false },
  { method: Post, path: "/api/wallet/requests/{id}/review", stream: false },
  { method: Post, path: "/api/wallet/requests/{id}/decide", stream: false },
  { method: Get, path: "/api/alpha/control/state", stream: false },
  { method: Post, path: "/api/alpha/control/lease", stream: false },
  { method: Post, path: "/api/alpha/control/stop", stream: false },
  { method: Get, path: "/api/alpha/local-llm/status", stream: false },
  { method: Get, path: "/api/alpha/local-llm/catalog", stream: false },
  { method: Post, path: "/api/alpha/local-llm/mode", stream: false },
  { method: Post, path: "/api/alpha/local-llm/activate", stream: false },
  { method: Post, path: "/api/alpha/local-llm/delete", stream: false },
)
pure val controlLeasePath = "/api/alpha/control/lease"
pure val controlStopPath = "/api/alpha/control/stop"
pure val controlLeaseLimit = 4096
pure val controlStopLimit = 1024
pure val localLlmModePath = "/api/alpha/local-llm/mode"
pure val localLlmActivatePath = "/api/alpha/local-llm/activate"
pure val localLlmDeletePath = "/api/alpha/local-llm/delete"
pure val localLlmControlLimit = 1024
pure def concatRoutes(a: List[Route], b: List[Route]): List[Route] = a.concat(b)
pure val pageRoutes: List[Route] = concatRoutes(concatRoutes(pageRoutesCore, pageRoutesApps), concatRoutes(pageRoutesWorkflows, pageRoutesTasksWallet))
pure def admitted(listed: List[Route], r: Route): bool = listed.includes(r)
pure def routeListAdmitted(listed: List[Route]): bool =
  listed.length() == pageRoutes.length() and listed.every(r => pageRoutes.includes(r)) and pageRoutes.every(r => listed.includes(r))
```

### The local browser can request a private transcription of a reviewed note

A browser on the local machine can send a window of the reviewed recording to
a local transcription model. The agent does not offer the route when it is
running Alpha's native speech engine. A response contains only the recognized
text for that window. Nothing is published as a live voice event.

```quint
pure def lawBrowserNotesTranscriptionIsNonStreamingPageRoute(limit: int): bool =
  limit == browserNotesTranscriptionLimit implies
    (limit > 0
      and pageRoutes.includes({ method: Get, path: browserNotesTranscription, stream: false })
      and pageRoutes.includes({ method: Post, path: browserNotesTranscription, stream: false }))

pure val browserTranscriptionPublishesLiveVoice: bool = false
pure def browserTranscriptionOffered(localBrowser: bool, nativeSpeechEngine: bool, windowBytes: int): bool =
  localBrowser and not(nativeSpeechEngine) and windowBytes > 0 and windowBytes <= browserNotesTranscriptionLimit
pure def lawNativeEngineNeverOffersBrowserTranscription(localBrowser: bool, windowBytes: int): bool =
  not(browserTranscriptionOffered(localBrowser, true, windowBytes))
```

### Only Android's native speech transport can call the resident recognizer

The page's route table has neither the speech scope nor the live capture
route. The phone admits these two speech calls to its root-only native
channel. The scope answers the running resident's launch epoch and owner
only when the pinned native engine can transcribe. Alpha checks the native
sign-in account against that scope before capture and never sends frames
to another epoch.

```quint
pure val nativeSpeechRoutes: List[Route] = List(
  { method: Get, path: "/api/alpha-speech/scope", stream: false },
  { method: Post, path: "/api/asr/local-inference/live", stream: false },
)
pure val routeValues: Set[Route] = nativeSpeechRoutes.foldl(Set(), (routes, route) => routes.union(Set(route)))
pure def lawSpeechRoutesAreAbsentFromThePage(route: Route): bool =
  nativeSpeechRoutes.includes(route) implies not(pageRoutes.includes(route))
```

### Android's digest inbox verifies the launch before admitting results

Android's native inbox uses the resident's private scope, which reports
the launch epoch, agent and account even if speech is unavailable. An
Android worker compares the proof to the serving epoch and active
custody before accessing results. The worker and the panel share one
Android writer. After the switch, the Android page never fetches or
acknowledges the same results itself. The browser uses its own inbox.
Only the native table admits the launch scope endpoint.

```quint
pure val nativeDigestScope = "/api/alpha-runtime/scope"
pure val nativeDigestAck = "/api/workflow/hosted/results/ack"
pure val nativeDigestAckLimit = 1024
pure val nativeDigestRoutes: List[Route] = List(
  { method: Get, path: nativeDigestScope, stream: false },
  { method: Get, path: "/api/workflow/status", stream: false },
  { method: Get, path: "/api/workflow/hosted/results", stream: false },
  { method: Post, path: nativeDigestAck, stream: false },
)
```

### A browser can confirm only its own recording cleanup

A browser recording has a browser audio identity. The local store removes
the bytes for the exact note and deletion receipt before the page confirms
that receipt. The agent checks the pending receipt and its browser audio
identity. Native recordings still require their native channel.

```quint
pure def lawBrowserNotesCleanupIsOnThePage(method: Method): bool =
  pageRoutes.includes({ method: method, path: browserNotesCleanup, stream: false }) iff method == Post

pure def browserCleanupConfirmed(browserAudio: bool, bytesRemoved: bool, pendingReceipt: bool, exactNoteAndReceipt: bool): bool =
  browserAudio and bytesRemoved and pendingReceipt and exactNoteAndReceipt
pure def lawNativeRecordingCannotConfirmOnBrowserCleanup(bytesRemoved: bool, pendingReceipt: bool, exactNoteAndReceipt: bool): bool =
  not(browserCleanupConfirmed(false, bytesRemoved, pendingReceipt, exactNoteAndReceipt))
```

### Only the phone's native channel can verify that a reviewed recording was erased

Android names the pending receipt and its serving owner, agent and epoch.
Only the native route can ask to prepare that exact receipt or confirm it
from the phone's durable removal evidence. In either phase the resident
requires its current reserved receipt with no saved references. The Notes
service clears the receipt only after receiving its proof in that request.
The page can read pending receipts. It cannot complete them.

```quint
pure val nativeNotesCleanup = "/api/alpha-runtime/notes-recording-cleanup"
pure val nativeNotesCleanupLimit = 2048
pure val nativeControlObserve = "/api/alpha-control/observe"
pure val nativeControlNext = "/api/alpha-control/next"
pure val nativeControlReceipt = "/api/alpha-control/receipt"
pure val nativeControlInterrupt = "/api/alpha-control/interrupt"
pure val nativeControlObserveLimit = 1572864
pure val nativeControlReceiptLimit = 65536
pure val nativeControlInterruptLimit = 2048
pure val nativeRecordingRoutes: List[Route] = List({ method: Post, path: nativeNotesCleanup, stream: false })
pure val nativeControlRoutes: List[Route] = List(
  { method: Post, path: nativeControlObserve, stream: false },
  { method: Get, path: nativeControlNext, stream: false },
  { method: Post, path: nativeControlReceipt, stream: false },
  { method: Post, path: nativeControlInterrupt, stream: false },
)
pure val nativeRoutes: List[Route] = List(
  { method: Get, path: "/api/alpha-speech/scope", stream: false },
  { method: Post, path: "/api/asr/local-inference/live", stream: false },
  { method: Get, path: nativeDigestScope, stream: false },
  { method: Get, path: "/api/workflow/status", stream: false },
  { method: Get, path: "/api/workflow/hosted/results", stream: false },
  { method: Post, path: nativeDigestAck, stream: false },
  { method: Post, path: nativeNotesCleanup, stream: false },
  { method: Post, path: nativeControlObserve, stream: false },
  { method: Get, path: nativeControlNext, stream: false },
  { method: Post, path: nativeControlReceipt, stream: false },
  { method: Post, path: nativeControlInterrupt, stream: false },
)
pure def nativeRoutesAdmitted(listed: List[Route]): bool =
  listed.length() == nativeRoutes.length() and listed.every(route => nativeRoutes.includes(route))
    and nativeRoutes.every(route => listed.includes(route))
```

### Only Android's native control executor can post UI observations, poll queued operations, submit receipts, or fire native interrupts

The page's route table carries only the overlay's state read, owner lease
grant, and stop switch. Raw screen observations, queued operations, execution
receipts, and touch-preemption interrupts stay on the phone's root-only native
channel so no untrusted WebView page can inject forged UI trees or spoof
receipts.

```quint
pure val controlRouteValues: Set[Route] = nativeControlRoutes.foldl(Set(), (routes, route) => routes.union(Set(route)))
pure def lawControlNativeRoutesAreAbsentFromThePage(controlRoute: Route): bool =
  nativeControlRoutes.includes(controlRoute) implies not(pageRoutes.includes(controlRoute))
```

### The page names the query values each gated route can receive

Search sends its words, offset and twenty results per page. A conversation
can request the window around a message. To see if an older message exists
beyond that window, Ask Alpha requests one row before the first message's
timestamp and identifier. The timestamp is a canonical nonnegative
decimal, the cursor identifier has the same form as the window's message
identifier, and when supplied the history limit is one. The latest and
centered pages can omit the limit. Home's agenda and Calendar send the
start and end of their window, and Calendar may send a time zone.
Calendar asks for up to fifty pending approvals, and when deleting an event
sends the calendar, grant, recurrence scope, expected provider version,
idempotency key, cancellation mode and attendee notice choice. Workflows lists the owner's
visible tasks, pages the agent's native notification inbox (`nativeTransport=true`,
with optional UUID `nativeEpoch` and nonnegative decimal `limit`, `afterSequence`
and `throughSequence`), reads a result page for its
client, and supplies the exact reviewed revision when removing a trigger.
Reminders says, when it deletes a custom list, whether the list's reminders
move to the default list or go with it.

```quint
type QueryKind = AnyQuery | PatternQuery | FixedQuery
type RequestQuery = { method: Method, path: str, key: str, kind: QueryKind, value: str, example: str }

pure val historyQueryPath = "/api/conversations/{id}/messages"
pure val historyMessageId = "[A-Za-z0-9_-]{1,128}"

pure val pageQueries: List[RequestQuery] = List(
  { method: Get, path: "/api/conversations/messages/search", key: "q", kind: AnyQuery, value: "", example: "project notes + plan" },
  { method: Get, path: "/api/conversations/messages/search", key: "offset", kind: PatternQuery, value: "0|[1-9][0-9]{0,15}", example: "0" },
  { method: Get, path: "/api/conversations/messages/search", key: "limit", kind: FixedQuery, value: "20", example: "20" },
  { method: Get, path: historyQueryPath, key: "around", kind: PatternQuery, value: historyMessageId, example: "test-message" },
  { method: Get, path: historyQueryPath, key: "before", kind: PatternQuery, value: "0|[1-9][0-9]{0,15}", example: "1795478400000" },
  { method: Get, path: historyQueryPath, key: "beforeId", kind: PatternQuery, value: historyMessageId, example: "test-message" },
  { method: Get, path: historyQueryPath, key: "limit", kind: PatternQuery, value: "1", example: "1" },
  { method: Get, path: "/api/lifeops/calendar/feed", key: "timeMin", kind: AnyQuery, value: "", example: "2026-11-24T00:00:00.000Z" },
  { method: Get, path: "/api/lifeops/calendar/feed", key: "timeMax", kind: AnyQuery, value: "", example: "2026-11-25T00:00:00.000Z" },
  { method: Get, path: "/api/lifeops/calendar/feed", key: "timeZone", kind: AnyQuery, value: "", example: "America/New_York" },
  { method: Get, path: "/api/notifications", key: "nativeTransport", kind: FixedQuery, value: "true", example: "true" },
  { method: Get, path: "/api/notifications", key: "nativeEpoch", kind: PatternQuery, value: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}", example: "00000000-0000-0000-0000-000000000000" },
  { method: Get, path: "/api/notifications", key: "limit", kind: PatternQuery, value: "0|[1-9][0-9]{0,15}", example: "50" },
  { method: Get, path: "/api/notifications", key: "afterSequence", kind: PatternQuery, value: "0|[1-9][0-9]{0,15}", example: "0" },
  { method: Get, path: "/api/notifications", key: "throughSequence", kind: PatternQuery, value: "0|[1-9][0-9]{0,15}", example: "0" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "calendarId", kind: AnyQuery, value: "", example: "primary" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "grantId", kind: AnyQuery, value: "", example: "grant-1" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "recurrenceScope", kind: PatternQuery, value: "instance|this_and_following|series", example: "instance" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "expectedProviderVersion", kind: AnyQuery, value: "", example: "v1" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "idempotencyKey", kind: AnyQuery, value: "", example: "attempt-1" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "cancellationMode", kind: PatternQuery, value: "organizer_cancel|decline_invitation|remove_private_copy", example: "organizer_cancel" },
  { method: Delete, path: "/api/lifeops/calendar/events/{eventId}", key: "notifyAttendees", kind: PatternQuery, value: "true|false", example: "false" },
  { method: Get, path: "/api/approvals", key: "state", kind: PatternQuery, value: "pending", example: "pending" },
  { method: Get, path: "/api/approvals", key: "limit", kind: PatternQuery, value: "50", example: "50" },
  { method: Get, path: "/api/scheduled-tasks", key: "ownerVisibleOnly", kind: FixedQuery, value: "1", example: "1" },
  { method: Get, path: "/api/workflow/hosted/results", key: "clientId", kind: PatternQuery, value: "[A-Za-z0-9][A-Za-z0-9_-]{0,127}", example: "build-probe" },
  { method: Delete, path: "/api/triggers/{id}", key: "expectedRevision", kind: PatternQuery, value: "[1-9][0-9]{0,15}", example: "1" },
  { method: Delete, path: "/api/alpha/reminders/lists/{id}", key: "mode", kind: PatternQuery, value: "reassign|cascade", example: "reassign" },
)
pure val nativeDigestQueries: List[RequestQuery] = List(
  { method: Get, path: "/api/workflow/hosted/results", key: "clientId", kind: PatternQuery, value: "[A-Za-z0-9][A-Za-z0-9_-]{0,127}", example: "build-probe" },
)
```

### The agent keeps its memory across restarts, without embeddings

The old agent kept its history when it restarted, so the launch asks the
agent to persist its store. The old phone embedded memory on the device
with local inference; whether the pack does the same waits on the owner's
choice of model and embeddings, and until then memory is kept without
embeddings.

```quint
pure val persistMemory: bool = true
pure val localEmbeddings: bool = false
```

### The agent brings in the earlier agent's store when it starts, before it is ready, only as the adoption rules allow

Alpha's product plugin does it in its `init`, from the store and owner the
phone passes in the launch's environment, `ALPHA_LEGACY_STORE_DIR` and
`ALPHA_LEGACY_OWNER`, and only when that owner is the account the launch
names (`spec/app/platform/adoption.md`, "Story: Keep what the earlier
on-device agent stored").

```quint
import adoption as Adoption from "../app/platform/adoption"

pure def bringsInEarlierStore(ownerUser: str, ownerOrganization: str, user: str, organization: str): bool =
  Adoption::isEarlierOwner(ownerUser, ownerOrganization, user, organization)
```

### The agent swaps the owner's secrets and personal details out of what it sends the cloud

The old agent was launched with eliza's secret swap and personal-detail
swap on (`legacy/android/app/src/main/java/ai/alphacompute/alphaphone/AlphaLocalAgentPlugin.java`,
`ELIZA_SECRET_SWAP_ENABLED` and `ELIZA_PII_SWAP_ENABLED`), so a key, a
number or an address the owner writes reaches the model only as a stable
reference. The launch asks eliza's privacy service for both.

```quint
pure val secretSwap: bool = true
pure val personalDetailSwap: bool = true
pure def privacyAdmitted(secrets: bool, details: bool): bool = secrets == secretSwap and details == personalDetailSwap
```

### The agent changes the owner's mail and calendar through Google only where the launch consents, and the pack's host file consents to neither

eliza's launch carries the owner's consent for the agent to change Gmail
and to edit Google Calendar (`spec/agent/host/launch.md`, `google`), off
unless named. The pack's host file consents to neither. The owner's own
choice in Settings replaces it at each launch once the phone has read or
saved it (`spec/app/settings/preferences.md`, "The agent is launched
allowed to change Gmail and Calendar exactly as the phone last read or
saved, allowed neither once it could not read them, and Alpha says nothing
of it before the first answer"): Alpha's agent service keeps that choice
and gives it to eliza's, which launches with it in place of the host
file's.

```quint
pure val gmailChanges: bool = false
pure val calendarEdits: bool = false
pure def googleAdmitted(gmail: bool, calendar: bool): bool = gmail == gmailChanges and calendar == calendarEdits
```

### The agent's text goes to the owner's cloud account, which is asked for the model the old agent used

The old agent's default model was `qwen-3.8-27b` (the old tree's agent model script at
`26e827f06`, line 4), called directly at its provider; now the cloud is asked for it, at
the origin of the environment's deployment in `packages/deployment`. The local
environment has no fixed origin (the harness's cloud listens where it can), so
a pack is built only for a hosted environment; a journey runs the pack
against its own local cloud and that cloud's model.

```quint
import cloud as C from "../cloud"
type Environment = Local | Staging | Production
pure val cloudModel: str = C::alphaModel
pure def packedFor(e: Environment): bool = e != Local
```

## Story: Build the pack only from the pinned eliza

> As the maker of Alpha, I want the pack on the phone to be exactly the
> pinned eliza's agent with the plugins I chose, for Node 26, with on-device
> speech, carrying the workflow worker it pins and every action Alpha
> allows, so that what ships is what was reviewed.

### A pack is admitted only when its manifest names the pinned commit, Node 26, the local speech module, the plugins it carries, the Alpha product plugin, a pinned workflow worker and every allowed action

The manifest is the one `readBundleManifest` reads back for the bundle's own
bytes (eliza's "A manifest is read only for its own bundle bytes and only when
it is one a build could write"). The pin is `eliza.lock.json`'s commit as the
harness reads it. eliza pins the workflow worker's digest exactly when the
bundle carries the workflow plugin.

```quint
type Manifest = { sourceCommit: str, node: str, localInference: bool, plugins: List[str], productPlugin: str, workerPinned: bool, actions: List[str] }
pure def packAdmitted(m: Manifest, pin: str): bool =
  m.sourceCommit == pin and m.node == "26" and m.localInference and sameNames(m.plugins, packedPlugins)
    and m.productPlugin == productPluginName and m.workerPinned and allowedActions.every(a => m.actions.includes(a))
```

### Every package the bundle carries is the pinned eliza's, except the pack's entry and Alpha's product plugin

The bundle is built from a private clone of the pinned commit, never from
Alpha's own tree: the only packages of Alpha's in it are the entry the build
writes inside that clone (which starts eliza's agent with the plugins above
and builds the notes and product modules) and Alpha's `alpha-apps` product
plugin staged inside that entry. Every other package is the pinned eliza's
own or one its lockfile installs.

```quint
pure val packEntry: str = "@repo/agent-pack-entry"
pure def inputAdmitted(name: str, alphaOwned: bool): bool = not(alphaOwned) or name == packEntry or name == productPluginName
pure def entryCarried(packages: List[str]): bool = packages.includes(packEntry) and packages.includes(productPluginName)
```

### The launch names the pack's pinned workflow worker, and the agent refuses any other with its configuration code

The workflow plugin runs workflows only in the worker whose digest the
bundle pinned (eliza's `spec/agent/plugins/profile.md`, "The worker is
installed only after its executable digest matches the launch"), so the
launch names that worker. A launch naming a worker with any other digest
ends with the configuration code, 78, before the store opens
(`spec/agent/host/process.md`, "A refused launch fails before the store
opens, as a configuration or credential error").

```quint
pure val configurationExit: int = 78
pure val launchCarriesWorkflowWorker: bool = true
pure def workerAdmitted(named: str, pinned: str): bool = named == pinned
```

## Story: Give the plugins the phone's device services, and say plainly which it cannot give yet

> As the owner, I want my workflows to take steps on my phone and Maps to
> keep my saved places, as the old agent did, and the phone to tell me which
> parts of the old agent's work have no device service behind them yet,
> rather than pretend they do.

### The pack's entry gives the workflow plugin the enrolled phone's steps and Maps its saved places

eliza's plugins find some device services by name, which Alpha's entry
supplies (`spec/agent/plugins/profile.md` in eliza, "Host runtime services
register with storage before every listed plugin, never under an agent
service's name, and a pinned worker is the workflow-worker service"). The
entry is written inside the pinned clone, beside Alpha's product plugin,
and starts eliza's agent with runtime services of its own, as the old
phone's resident did: `workflow-device`, which uses eliza's workflow offer
and waits for the receipt from the exact enrolled phone, keeping Android's
decision, claim and receipt protocol even when a run is already approved in
Workflows; and Maps' saved places, one file per owner under the agent's
state directory, written only against the revision it read.

```quint
pure val entryServices: Set[str] = Set("workflow-device", "maps-saved-places")
```

### The native digest sources the phone does not give its plugins yet are named, and nothing in the pack fakes them

The old phone read a digest's native sources (its calendar, messages and
notifications) through a bridge in its own app process, which eliza's agent
service does not carry: the agent reaches the app process only for local
inference, and no launch names such a bridge. The entry gives no
`workflow-native-digests` service, so the workflow plugin answers that
native sources are unavailable on this agent, and its status offers no
native source.

```quint
pure val awaitingHostServices: Set[str] = Set("workflow-native-digests")
pure def serviceAvailable(service: str): bool = entryServices.contains(service) and not(awaitingHostServices.contains(service))
```
