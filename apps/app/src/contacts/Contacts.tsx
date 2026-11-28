// spec/app/contacts/index.md, "Story: Browse my contacts"; spec/app/contacts/index.md, "Story: Give Alpha access to my contacts"; spec/app/contacts/index.md, "Story: Look at one contact"; spec/app/contacts/index.md, "Story: Add or change a contact"; spec/app/contacts/index.md, "Story: Delete a contact"; spec/app/contacts/index.md, "Story: Know what happened to my change"
import { Alert, AppHeader, AssistantChatActions, Avatar, Banner, Button, Chip, Input, ListGroup, ListRow, Tabs, TabsContent, Textarea, cn } from "@repo/ui";
import { Effect, Exit, type ManagedRuntime } from "effect";
import { CONTACT_MAX_ADDRESS, CONTACT_MAX_NAME, CONTACT_MAX_NOTES, CONTACT_MAX_NUMBER, type ContactDetail } from "@elizaos/os-bridges";
import { Check, ChevronDown, ChevronLeft, MessageSquare, Minus, Pencil, Plus, Trash2, X, createLucideIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Machine as ContactsMachine } from "../../gen/app__contacts.effect.vibe";
import { accessNeeded, listFailed, listedEmpty, maxEach, noMatches, pending, refused, shown, uncertain } from "../../gen/app__contacts.ts";
import { useMachine as useContacts } from "../../gen/app__contacts.react.ts";
import type { Machine as PhoneMachine, Tab } from "../../gen/app__phone.effect.vibe";
import { clear } from "../../gen/app__phone.ts";
import { useMachine as usePhone } from "../../gen/app__phone.react.ts";
import type { Machine as VoicemailMachine } from "../../gen/app__phone__voicemail.effect.vibe";
import { useMachine as useVoicemail } from "../../gen/app__phone__voicemail.react.ts";
import { useMachine as useShell } from "../../gen/app__shell.react.ts";
import { contactChatActionsId } from "../assistant/contact-chat-id.ts";
import { attachFromContact, searchFromContact } from "../assistant/contact-search.ts";
import { returnPhoneTab } from "../comms/index.vibe";
import { PhoneTabs, telephonyHeader } from "../comms/ui.tsx";
import { callerInitials, displayNumber } from "../comms/index.vibe";
import { type Book, type Form, Rows, blankForm, sheetOf } from "./contacts.vibe";
import { CommsBar, type CommsServices, useCommsDock } from "../comms/ui.tsx";
import { emailFieldLabel, emailLabel, emailRemoveLabel, phoneFieldLabel, phoneLabel, phoneRemoveLabel } from "./labels.ts";
import type { Alpha } from "../runtime/ui.tsx";
import { AppBack, useFirstPageBack } from "../shell/ui.tsx";
import { Layers, Over, Under } from "../shell/ui.tsx";

export interface ContactsProps {
  /** Provides Contacts' machine, resident, Phone's, for whether a call may be an emergency call, and what Contacts counts. */
  runtime: ManagedRuntime.ManagedRuntime<ContactsMachine | PhoneMachine | VoicemailMachine | Rows | CommsServices, unknown>;
}

/**
 * Contacts: the list, one contact as the phone holds it, and the form. Call and Message
 * open Phone or Messages with the number filled in; nothing is dialled or sent here.
 * @model spec/app/contacts/index.md
 */
export function Contacts({ runtime, alpha }: ContactsProps & { alpha: Alpha }) {
  const contacts = useContacts(runtime);
  const phone = usePhone(runtime).state;
  const voicemail = useVoicemail(runtime).state;
  const returningRef = useRef<{ tab: Tab } | undefined>(undefined);
  const shell = useShell(runtime);
  const firstPageBack = useFirstPageBack(alpha);
  const held = runtime.runSync(Effect.flatMap(Rows, (rows) => rows.get()));
  const groups = useMemo(() => {
    const grouped = Object.groupBy(held.rows, ({ name }) => {
      const letter = name.trim().charAt(0).normalize("NFD").charAt(0).toUpperCase();
      return /^[A-Z]$/.test(letter) ? letter : "#";
    });
    return Object.entries(grouped)
      .sort(([left], [right]) => Number(left === "#") - Number(right === "#") || left.localeCompare(right))
      .map(([letter, rows]) => [letter, rows?.toSorted((left, right) => left.name.localeCompare(right.name))] as const);
  }, [held.rows]);
  if (contacts.cause) return <Alert variant="destructive" className="m-4">Alpha could not open Contacts</Alert>;
  const { state, can, send } = contacts;
  if (!state || !phone) return <section aria-label="Contacts" aria-busy className="flex min-h-0 flex-1 flex-col">
    <AppHeader title="Contacts" className={telephonyHeader} leading={<AppBack alpha={alpha} firstPage label="Back to apps" />} />
  </section>;
  const query = state.sought ? held.sought : "";
  const set = (change: Partial<Book>) => runtime.runSync(Effect.flatMap(Rows, (rows) => rows.set(change)));
  const safe = clear(phone);
  const editing = state.form !== "Shut";
  const open = (id: string) => {
    set({ card: undefined });
    void send({ type: "openContact", contact: id });
  };
  const fromPhone = shell.state?.trail.at(-2) === "Phone";
  const phoneTabs = !state.opened && fromPhone;
  const back = firstPageBack ? () => void alpha.back() : undefined;
  const select = (tab: string) => {
    if (tab !== "Recents" && tab !== "Keypad" && tab !== "Voicemail") return;
    if (returningRef.current) {
      returningRef.current.tab = tab;
      return;
    }
    const request: { tab: Tab } = { tab };
    returningRef.current = request;
    void runtime.runPromiseExit(returnPhoneTab(() => request.tab)).then(() => { returningRef.current = undefined; });
  };
  const actions = (
    <>
      {can({ type: "compose" }) && <Button variant="ghost" size="icon" aria-label="New contact" onClick={() => { set({ form: blankForm, editBase: undefined, problem: undefined }); void send({ type: "compose" }); }}><Plus className="size-5" /></Button>}
      {can({ type: "composeElsewhere" }) && <Button variant="ghost" size="icon" aria-label="New contact" onClick={() => void send({ type: "composeElsewhere" })}><Plus className="size-5" /></Button>}
    </>
  );
  const header = phoneTabs ? (
    <PhoneTabs title="Contacts" contacts voicemail={phone.voicemail} unheard={(voicemail?.unheard ?? 0) > 0} onBack={back} backLabel="Back">{actions}</PhoneTabs>
  ) : (
    <AppHeader title="Contacts" className={telephonyHeader} leading={<AppBack alpha={alpha} firstPage label="Back to apps" />}>{actions}</AppHeader>
  );
  const allow = "my-6 min-h-13 rounded-full bg-foreground px-7 text-lg font-semibold text-background hover:bg-foreground/90 active:bg-foreground/80";
  const route = shell.state?.route;
  const bar = !editing ? (
    <CommsBar runtime={runtime}
      person={state.opened && held.card !== undefined ? { label: held.card.displayName, initials: callerInitials(held.card.displayName) } : undefined}
      actions={state.opened && shown(state) && route !== undefined ? <AssistantChatActions placement="comms" triggerId={contactChatActionsId(route, state.contact)}
        onAttach={() => attachFromContact(alpha, route, state.contact)} onSearch={() => searchFromContact(alpha, route, state.contact)} /> : undefined} />
  ) : null;
  const notices = <>
      {pending(state) && <p role="status" className="sr-only">Contact change pending</p>}
      {uncertain(state) && <Banner variant="warn" action={can({ type: "refresh" }) && <Button size="sm" variant="outline" onClick={() => void send({ type: "refresh" })}>Refresh</Button>}>Outcome unknown: refresh</Banner>}
      {accessNeeded(state) && (
        <div className="flex shrink-0 justify-center">
          <p role="status" className="sr-only">Contacts needs access to your address book</p>
          {can({ type: "allow" }) ? <Button className={allow} onClick={() => void send({ type: "allow" })}>Allow</Button>
            : can({ type: "openSettings" }) && <Button className={allow} onClick={() => void send({ type: "openSettings" })}>Open Settings</Button>}
        </div>
      )}
  </>;
  const editor = editing && <Over><Editor runtime={runtime} /></Over>;
  const content = (
    <section aria-label="Contacts" className="flex min-h-0 flex-1 flex-col">
      <Layers>
        <Under covered={state.opened || editing}>
          {!phoneTabs && header}
          {!state.opened && notices}
          {!state.opened && state.sought && query !== "" && (
            <div className="px-4 pb-2">
              <Chip className="min-w-0 [&>button:first-child]:min-w-0" onClear={can({ type: "clearFilter" }) ? () => void send({ type: "clearFilter" }) : undefined} clearLabel={`Clear filter ${query}`}>
                <span className="truncate">{query} · {state.rows}</span>
              </Chip>
            </div>
          )}
          {can({ type: "loadMore" }) && <div className="flex shrink-0 justify-center"><Button variant="secondary" size="icon" aria-label="More contacts" onClick={() => void send({ type: "loadMore" })}><ChevronDown className="size-5" /></Button></div>}
          {state.list.status === "Loading" && state.rows === 0 && <p role="status" className="sr-only">Reading contacts</p>}
          {listFailed(state) && <Banner variant="destructive" action={can({ type: "refresh" }) && <Button size="sm" variant="outline" onClick={() => void send({ type: "refresh" })}>Retry</Button>}>Contacts could not be read</Banner>}
          {(listedEmpty(state) || noMatches(state)) && <p role="status" className="flex min-h-45 items-center justify-center p-6 text-center text-base leading-normal text-muted-foreground">{noMatches(state) ? "No contacts found" : "No contacts yet"}</p>}
          {state.rows > 0 && (
            <ListGroup aria-label="Contacts" surface="plain">
              {groups.map(([letter, rows]) => (
                <div key={letter}>
                  {state.rows >= 20 && <h2 className="px-6 pt-3 pb-0.5 text-caption font-semibold text-muted-foreground">{letter}</h2>}
                  {rows?.map((row) => <ListRow key={row.id} aria-label={row.name} title={<span className="block truncate font-semibold">{row.name}</span>}
                    className="min-h-15 gap-3 px-5 py-1.5" leading={<Avatar name={row.name} className="size-11 text-base font-bold" />}
                    disabled={!can({ type: "openContact", contact: row.id })} onClick={() => open(row.id)} />)}
                </div>
              ))}
            </ListGroup>
          )}
        </Under>
        {state.opened && <Over inert={editing} aria-hidden={editing || undefined}><div className="flex flex-1 flex-col">{notices}<Card runtime={runtime} safe={safe} route={route} /></div></Over>}
        {!fromPhone && editor}
      </Layers>
      {!fromPhone && bar}
    </section>
  );
  if (!fromPhone) return content;
  return (
    <Tabs value="Contacts" onValueChange={(value) => void select(value)} className="relative min-h-0 flex-1 gap-0">
      {phoneTabs && <div className="contents" inert={editing} aria-hidden={editing || undefined}>{header}</div>}
      <TabsContent value="Contacts" className="flex min-h-0 flex-1 flex-col overflow-y-auto">{content}</TabsContent>
      {bar}
      {editor}
    </Tabs>
  );
}

/** The notes glyph of a contact's card, as Alpha's phone draws it. */
const PhoneGlyph = createLucideIcon({ name: "ContactPhone", node: [["path", { key: "phone", d: "M4 4h4l2 5-2 2 5 5 2-2 5 2v4C10 22 2 14 4 4" }]] });
const MailGlyph = createLucideIcon({ name: "ContactMail", node: [["path", { key: "mail", d: "M3 5h18v14H3zM3 5l9 7 9-7" }]] });
const NotesGlyph = createLucideIcon({ name: "NotesGlyph", node: [["path", { key: "page", d: "M4 3h16v18H4zM8 7h8M8 11h8M8 15h5" }]] });

/** One contact as the phone holds it now; compact while Alpha's sheet is open over it. */
function Card({ runtime, safe, route }: ContactsProps & { safe: boolean; route: number | undefined }) {
  const { state, can, send } = useContacts(runtime);
  const compact = useCommsDock(runtime).open;
  if (!state) return null;
  const card = runtime.runSync(Effect.flatMap(Rows, (rows) => rows.get())).card;
  const reach = (how: "Call" | "Message", number: string) => {
    if (route === undefined) return;
    const request = { how, route, contact: state.contact, card: state.card.ticket, number };
    runtime.runSync(Effect.flatMap(Rows, (rows) => rows.set({ reach: request })));
    void send({ type: "reach", how });
  };
  const field = "flex min-h-13.5 items-center gap-4 px-5 py-2";
  const value = "min-w-0 flex-1 text-body leading-detail wrap-anywhere";
  const sub = "shrink-0 text-sm text-muted-foreground";
  const showing = shown(state) && card !== undefined;
  const initials = card ? callerInitials(card.displayName) : "";
  return (
    <div data-alpha-contact-detail="" data-alpha-compact={compact} className="flex flex-1 flex-col">
      <div data-host-chrome="" className="mt-[var(--alpha-safe-top)] flex min-h-11 items-center gap-1 px-2">
        {can({ type: "closeContact" }) && <Button variant="ghost" size="icon" aria-label="Back to contacts" onClick={() => void send({ type: "closeContact" })}><ChevronLeft /></Button>}
        {compact && showing && <>
          <span aria-hidden className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary font-display text-sm">{initials}</span>
          <h1 className="min-w-0 flex-1 truncate font-display text-xl font-light">{card.displayName}</h1>
        </>}
        {!(compact && showing) && <span className="flex-1" />}
        {card && can({ type: "amend" }) && <Button variant="ghost" size="icon" aria-label="Edit contact" onClick={() => {
          runtime.runSync(Effect.flatMap(Rows, (rows) => rows.set({
            editBase: card, problem: undefined,
            form: {
              givenName: card.givenName, familyName: card.familyName,
              phones: card.phoneNumbers.length === 0 ? [""] : card.phoneNumbers.map((one) => one.number),
              emails: card.emailAddresses.length === 0 ? [""] : card.emailAddresses.map((one) => one.address), notes: card.notes ?? "",
            },
          })));
          void send({ type: "amend" });
        }}><Pencil /></Button>}
        {can({ type: "amendElsewhere" }) && <Button variant="ghost" size="icon" aria-label="Edit contact" onClick={() => void send({ type: "amendElsewhere" })}><Pencil /></Button>}
        {can({ type: "askDelete" }) && <Button variant="ghost" size="icon" className="text-hangup" aria-label="Delete contact" onClick={() => void send({ type: "askDelete" })}><Trash2 /></Button>}
      </div>
      {state.confirming && (
        <div role="group" aria-label="Delete contact" data-alpha-contact-confirm="" className="flex shrink-0 gap-2 px-4 pb-2">
          <Button variant="secondary" aria-label="Keep" className="h-11 flex-1 basis-0 px-0" disabled={!can({ type: "keep" })} onClick={() => void send({ type: "keep" })}><X className="size-5" /></Button>
          <Button className="h-11 flex-2 basis-0 bg-hangup text-base text-alpha-foreground hover:bg-hangup/90 active:bg-hangup/80" disabled={!can({ type: "erase", clear: safe })} onClick={() => void send({ type: "erase", clear: safe })}>Delete</Button>
        </div>
      )}
      {state.card.status === "Loading" && <p role="status" className="sr-only">Reading the contact</p>}
      {state.card.status === "Failed" && <Banner variant="destructive">The contact could not be read</Banner>}
      {showing && (
        <>
          {!compact && <>
            <span aria-hidden className="mt-3 flex size-28 items-center justify-center self-center rounded-full bg-secondary font-display text-contact-initials font-light">{initials}</span>
            <h1 className="mt-5 px-4 text-center font-display text-contact-name font-light wrap-anywhere">{card.displayName}</h1>
          </>}
          {card.phoneNumbers.length > 0 && <div className={cn("flex", compact ? "flex-wrap justify-start gap-2.5 pr-4 pb-2 pl-15" : "flex-wrap justify-center gap-3.5 px-4 pt-5.5 pb-1")} role="group" aria-label="Contact actions">
            {[...new Set(card.phoneNumbers.map(({ number }) => number))].flatMap((number) => [
              can({ type: "reach", how: "Call" }) && <Button key={`call ${number}`} variant="secondary" size="icon" className={compact ? "size-11" : "size-15"} aria-label={`Call ${number}`} onClick={() => reach("Call", number)}><PhoneGlyph /></Button>,
              can({ type: "reach", how: "Message" }) && <Button key={`message ${number}`} variant="secondary" size="icon" className={compact ? "size-11" : "size-15"} aria-label={`Message ${number}`} onClick={() => reach("Message", number)}><MessageSquare /></Button>,
            ])}
          </div>}
          <div aria-label="Contact details" role="group" className="mx-4 mt-9 rounded-group bg-secondary py-1.5 select-text">
            {card.phoneNumbers.map((phone, at) => (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- The phone can return a duplicated number at distinct positions.
              <div key={`${phone.number}-${at}`} className={field}><PhoneGlyph aria-hidden className="size-5 shrink-0 text-muted-foreground" /><span className={value}>{displayNumber(phone.number)}</span><span className={sub}>{phoneLabel(phone.type)}</span></div>
            ))}
            {card.emailAddresses.map((email, at) => (
              // eslint-disable-next-line @eslint-react/no-array-index-key -- The phone can return a duplicated address at distinct positions.
              <div key={`${email.address}-${at}`} className={field}><MailGlyph aria-hidden className="size-5 shrink-0 text-muted-foreground" /><span className={value}>{email.address}</span><span className={sub}>{emailLabel(email.type)}</span></div>
            ))}
            {card.notes && <div className={field}><NotesGlyph aria-hidden className="size-5 shrink-0 text-muted-foreground" /><span className={cn(value, "whitespace-pre-wrap")}>{card.notes}</span><span className={sub}>Notes</span></div>}
          </div>
        </>
      )}
    </div>
  );
}

const problems: Record<NonNullable<Book["problem"]>, string> = {
  "empty-contact": "Add a name, number or email.",
  "invalid-name": "Check the name.",
  "invalid-notes": "Check the notes.",
  "too-many-fields": "Too many numbers or emails.",
  "invalid-number": "Check the phone numbers.",
  "invalid-address": "Check the email addresses.",
  "invalid-type": "Check the phone and email labels.",
  stale: "This contact changed. Close and reopen the editor to review the latest fields.",
  "not-found": "This contact is no longer on this phone.",
};

const nameField = "min-h-14 rounded-tile border-0 bg-secondary px-4.5 py-3 text-lg focus-visible:outline-none";

interface ContactValuesProps {
  kind: "Phone" | "Email";
  values: readonly string[];
  /** The contact as the phone holds it, whose number or address keeps its type when the form saves it. */
  base: ContactDetail | undefined;
  locked: boolean;
  change: (values: readonly string[]) => void;
}

/** A phone or email field, with room for the owner to add and remove entries, each named by the type it is saved with. */
function ContactValues({ kind, values, base, locked, change }: ContactValuesProps) {
  const phone = kind === "Phone";
  return (
    <>
      {values.map((value, at) => {
        const type = phone ? base?.phoneNumbers.find((one) => one.number === value)?.type ?? "mobile" : base?.emailAddresses.find((one) => one.address === value)?.type ?? "home";
        const label = phone ? phoneFieldLabel(type, at === 0) : emailFieldLabel(type, at === 0);
        const remaining = values.filter((_, index) => index !== at);
        return (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- The editor keeps focus on the slot when its value changes.
          <div key={at} className="flex min-h-14 items-center gap-2 rounded-tile bg-secondary pr-1.5 pl-4.5">
            <Input className="h-14.5 border-0 bg-transparent px-0.5 py-px text-lg shadow-none focus-visible:outline-none" type={phone ? "tel" : "email"} autoComplete="off" disabled={locked}
              maxLength={phone ? CONTACT_MAX_NUMBER : CONTACT_MAX_ADDRESS} aria-label={label} placeholder={label} value={value}
              onChange={(event) => change(values.map((one, index) => index === at ? event.target.value : one))} />
            {(value !== "" || values.length > 1) && <Button type="button" size="icon" variant="ghost" disabled={locked} className="text-muted-foreground"
              aria-label={phone ? phoneRemoveLabel(type) : emailRemoveLabel(type)} onClick={() => change(remaining.length === 0 ? [""] : remaining)}><Minus className="size-4.5" /></Button>}
          </div>
        );
      })}
    </>
  );
}

/** The form that adds a contact or changes one: a name, several numbers and addresses, and notes where they are available. */
function Editor({ runtime }: ContactsProps) {
  const { state, can, send } = useContacts(runtime);
  const phone = usePhone(runtime).state;
  const [slotVersion, setSlotVersion] = useState(0);
  if (!state || !phone) return null;
  const { form, problem, editBase, refusedWrite } = runtime.runSync(Effect.flatMap(Rows, (rows) => rows.get()));
  const safe = clear(phone);
  const locked = pending(state);
  const canSave = problem !== "stale" && problem !== "not-found" && can({ type: "save", clear: safe });
  const addBlankSlot = (next: Form) => {
    runtime.runSync(Effect.flatMap(Rows, (rows) => rows.set({ form: next })));
    setSlotVersion((count) => count + 1);
  };
  const update = (next: Form, part: "Names" | "Phones" | "Emails" | "Notes") => {
    const sheet = sheetOf(next);
    const count = part === "Names" ? sheet.names : part === "Phones" ? sheet.phones : part === "Emails" ? sheet.emails : sheet.notes;
    const event = { type: "fill", part, count } as const;
    if (!can(event)) return;
    const before = { form, problem };
    runtime.runSync(Effect.flatMap(Rows, (rows) => rows.set({ form: next, problem: problem === "stale" || problem === "not-found" ? problem : undefined })));
    void send(event).then((outcome) => {
      if (Exit.isFailure(outcome)) runtime.runSync(Effect.flatMap(Rows, (rows) => rows.set(before)));
    });
  };
  const title = state.form === "Adding" ? "New contact" : "Edit contact";
  const add = "h-11 flex-[1_1_140px] justify-start rounded-lg p-2 text-sm font-normal text-muted-foreground";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <form aria-label={title} data-slot-version={slotVersion} noValidate className="flex min-h-0 flex-1 flex-col pt-[max(3.25rem,calc(var(--alpha-safe-top)+0.5rem))]" onSubmit={(event) => {
        event.preventDefault();
        if (canSave) void send({ type: "save", clear: safe });
      }}>
        <div data-host-chrome="" className="flex shrink-0 items-center px-2 pb-3">
          <Button type="button" variant="ghost" size="icon" aria-label="Cancel" disabled={!can({ type: "discard" })} onClick={() => void send({ type: "discard" })}><X /></Button>
          <h1 className="sr-only">{title}</h1>
          <span className="flex-1" />
          <Button type="submit" aria-label="Save" className="mr-2 h-11 w-16 min-w-16 px-0" disabled={!canSave}><Check /></Button>
        </div>
        <div className="flex min-h-0 flex-1 touch-pan-y flex-col gap-2.5 overflow-y-auto px-4 pb-4">
          {locked && <p role="status" className="sr-only">Contact change pending</p>}
          {refused(state) && state.write.id === refusedWrite && <p role="alert" data-alpha-contact-notice="" className="mx-2 text-sm leading-detail">{problem === undefined ? "The phone did not save the contact" : problems[problem]}</p>}
          <Input className={nameField} aria-label="First name" placeholder="First name" autoCapitalize="words" autoComplete="off" maxLength={CONTACT_MAX_NAME} disabled={locked} value={form.givenName} onChange={(event) => update({ ...form, givenName: event.target.value }, "Names")} />
          <Input className={nameField} aria-label="Last name" placeholder="Last name" autoCapitalize="words" autoComplete="off" maxLength={CONTACT_MAX_NAME} disabled={locked} value={form.familyName} onChange={(event) => update({ ...form, familyName: event.target.value }, "Names")} />
          <ContactValues kind="Phone" locked={locked} base={editBase} values={form.phones} change={(phones) => update({ ...form, phones }, "Phones")} />
          <ContactValues kind="Email" locked={locked} base={editBase} values={form.emails} change={(emails) => update({ ...form, emails }, "Emails")} />
          {state.sheet.notable ? <Textarea className="field-sizing-fixed min-h-24 resize-y rounded-tile border-0 bg-secondary px-4.5 py-3.5 text-lg leading-normal focus-visible:outline-none" rows={3} autoComplete="off" aria-label="Notes" placeholder="Notes" maxLength={CONTACT_MAX_NOTES} disabled={locked} value={form.notes} onChange={(event) => update({ ...form, notes: event.target.value }, "Notes")} />
            : <p data-alpha-contact-notes-unavailable="" className="rounded-tile bg-secondary px-4.5 py-3.5 text-base leading-normal text-muted-foreground">Notes can’t be edited here. Use Android Contacts to change them.</p>}
          <div className="flex flex-wrap gap-2.5">
            {form.phones.length < maxEach && <Button type="button" variant="ghost" disabled={locked} className={add} onClick={() => addBlankSlot({ ...form, phones: [...form.phones, ""] })}>Add another phone</Button>}
            {form.emails.length < maxEach && <Button type="button" variant="ghost" disabled={locked} className={add} onClick={() => addBlankSlot({ ...form, emails: [...form.emails, ""] })}>Add another email</Button>}
          </div>
        </div>
      </form>
      <CommsBar runtime={runtime} person={state.form === "Changing" && editBase !== undefined ? { label: editBase.displayName, initials: callerInitials(editBase.displayName) } : undefined} />
    </div>
  );
}
