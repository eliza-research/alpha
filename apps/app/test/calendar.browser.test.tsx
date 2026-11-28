import { Effect } from "effect";
import { afterEach, expect, it, vi } from "vitest";
import { page } from "vitest/browser";
import { Machine as View } from "../gen/app__calendar.effect.vibe";
import { Machine as Reminders } from "../gen/app__reminders.effect.vibe";
import { Machine as Shell } from "../gen/app__shell.effect.vibe";
import calendar from "../src/calendar/index.tsx";
import { civilDay, dayStart, utcStart } from "../src/calendar/time.ts";
import { createReminderItem } from "../src/reminders/reminders.vibe";
import { DEFAULT_LIST_ID, remindersStore } from "../src/reminders/store.ts";
import { closeAll, only, open, until } from "./alpha.tsx";
import { scene } from "./fakes/scene.ts";
import "../src/main.css";

afterEach(async () => {
  await closeAll();
  remindersStore.reset();
  document.documentElement.style.removeProperty("font-size");
  document.documentElement.style.removeProperty("--alpha-native-inset-top");
});

it('Opens timed and all-day events in another column when the selected day is empty (spec/app/calendar/index.md, "Story: Look at an event")', async () => {
  const world = { ...scene(), phone: true, signedIn: false, now: new Date(2026, 10, 25, 8).getTime() };
  world.calendar.granted = true;
  const today = civilDay(world.now);
  const tomorrow = dayStart(today + 1);
  world.calendar.phoneEvents.push(
    { id: "1", calendarId: "local", title: "Neighbor only", begin: tomorrow + 10 * 3_600_000, end: tomorrow + 11 * 3_600_000, allDay: false, recurring: false },
    { id: "2", calendarId: "local", title: "Neighbor holiday", begin: utcStart(today + 1), end: utcStart(today + 2), allDay: true, recurring: false },
  );

  await page.viewport(1280, 800);
  const { alpha } = await open(world, only("view:Calendar"));
  const view = calendar.runtime(alpha);
  const current = () => view.runPromise(Effect.flatMap(View, (machine) => machine.get()));
  await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openView", view: "Calendar" })));
  await until(alpha, view, View, (state) => state.wide && state.phone.status === "Loaded" && state.phoneRows === 0);
  const before = await current();
  const main = document.querySelector("main");
  if (!main) throw new Error("The Calendar host did not open");
  main.style.maxWidth = "none";

  await page.getByRole("button", { name: /^Neighbor only,/ }).click();
  await expect.element(page.getByRole("heading", { name: "Neighbor only", exact: true })).toBeVisible();
  await until(alpha, view, View, (state) => state.open > 0);
  const opened = await current();
  expect(opened.anchor).toBe(today);
  expect(opened.phone.ticket).toBe(before.phone.ticket);
  await page.getByRole("button", { name: "Back to calendar" }).click();
  await expect.element(page.getByRole("button", { name: /^Neighbor only,/ })).toBeVisible();
  await until(alpha, view, View, (state) => state.open === 0);
  const closed = await current();
  expect(closed.anchor).toBe(today);
  expect(closed.phoneRows).toBe(0);

  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(tomorrow);
  const holiday = page.getByRole("button", { name: `${date} · Neighbor holiday, All day`, exact: true });
  await holiday.click();
  await expect.element(page.getByRole("heading", { name: "Neighbor holiday", exact: true })).toBeVisible();
  const openedHoliday = await current();
  expect(openedHoliday.anchor).toBe(today);
  expect(openedHoliday.phone.ticket).toBe(before.phone.ticket);
  await page.getByRole("button", { name: "Back to calendar" }).click();
  await expect.element(holiday).toBeVisible();

  document.documentElement.style.fontSize = "24px";
  await expect.element(page.getByRole("region", { name: "Calendar agenda" })).toBeVisible();
  const anyHoliday = page.getByRole("button", { name: /Neighbor holiday/ });
  await expect.element(anyHoliday).not.toBeInTheDocument();
  document.documentElement.style.removeProperty("font-size");
  await page.viewport(412, 800);
  await until(alpha, view, View, (state) => !state.wide);
  await expect.element(anyHoliday).not.toBeInTheDocument();
  expect((await current()).anchor).toBe(today);

  document.documentElement.style.setProperty("--alpha-native-inset-top", "58px");
  const topOffset = (selector: string) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing element ${selector}`);
    return Math.round(element.getBoundingClientRect().top - main.getBoundingClientRect().top);
  };
  await vi.waitFor(() => expect(topOffset("header[data-host-chrome]")).toBe(58));
  await page.getByRole("button", { name: /^Choose date:/ }).click();
  await expect.element(page.getByRole("dialog", { name: "Choose calendar date" })).toBeVisible();
  expect(topOffset('[role="dialog"]')).toBeGreaterThanOrEqual(102);
  await page.getByRole("dialog", { name: "Choose calendar date" }).getByRole("button", { name: "Close month" }).click();
  await page.getByRole("button", { name: "New event", exact: true }).click();
  await expect.element(page.getByRole("button", { name: "Save event", exact: true })).toBeVisible();
  await expect.poll(() => topOffset('[data-alpha-subview="calendar-form"] [data-host-chrome]')).toBe(58);
  await page.getByRole("button", { name: "Back to calendar", exact: true }).click();
  main.setAttribute("data-alpha-launcher", "");
  try {
    expect(topOffset("header[data-host-chrome]")).toBe(58);
  } finally {
    main.removeAttribute("data-alpha-launcher");
  }
});

it('Shows the selected day across a wide canvas and at large text (spec/app/calendar/index.md, "Story: See my days"; spec/app/shell/keyboard.md, "Story: Read everything at the text size I chose")', async () => {
  const world = { ...scene(), phone: true, signedIn: false, now: new Date(2026, 10, 25, 8).getTime() };
  world.calendar.granted = true;
  const today = civilDay(world.now);
  const at = (day: number, hour: number) => dayStart(today + day) + hour * 3_600_000;
  world.calendar.phoneEvents.push(
    { id: "1", calendarId: "local", title: "Previous source", begin: at(-1, 14), end: at(-1, 15), allDay: false, recurring: false },
    { id: "2", calendarId: "local", title: "Current source", begin: at(0, 14), end: at(0, 15), allDay: false, recurring: false },
    { id: "3", calendarId: "local", title: "Overnight source", begin: at(0, 23), end: at(1, 1), allDay: false, recurring: false },
    { id: "4", calendarId: "local", title: "All-day source", begin: utcStart(today), end: utcStart(today + 1), allDay: true, recurring: false },
  );

  await page.viewport(1280, 800);
  const { alpha } = await open(world, only("view:Calendar"));
  const view = calendar.runtime(alpha);
  await alpha.runtime.runPromise(Shell.use((shell) => shell.send({ type: "openView", view: "Calendar" })));
  await until(alpha, view, View, (state) => state.wide && state.phoneRows === 3);
  await until(alpha, alpha.runtime, Reminders, (state) => state.sync.status === "Loaded");
  await alpha.runtime.runPromise(createReminderItem({ listId: DEFAULT_LIST_ID, title: "Agenda reminder", notes: "", dueDate: "2026-11-25", dueMinute: 570, alertMinutes: null }));
  await until(alpha, view, View, (state) => state.reminders === 1);
  const main = document.querySelector("main");
  if (!main) throw new Error("The Calendar host did not open");
  main.style.maxWidth = "none";

  const columns = () => [...document.querySelectorAll("[data-alpha-calendar-day]")];
  await vi.waitFor(() => expect(columns()).toHaveLength(5));
  expect(columns()[1]?.getAttribute("aria-current")).toBe("date");
  expect(columns()[0]?.querySelector('button[aria-label^="Previous source,"]')).not.toBeNull();
  expect(columns()[1]?.querySelector('button[aria-label^="Current source,"]')).not.toBeNull();
  expect(columns()[1]?.querySelector('button[aria-label^="Agenda reminder,"]')).not.toBeNull();
  const date = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric" }).format(dayStart(today));
  await expect.element(page.getByRole("button", { name: `${date} · All-day source, All day`, exact: true })).toBeVisible();
  const chooseDate = page.getByRole("button", { name: /^Choose date:/ });
  await chooseDate.click();
  const views = page.getByRole("group", { name: "Calendar view" });
  await expect.element(views.getByRole("button", { name: "Day", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.element(views.getByRole("button", { name: "Schedule", exact: true })).toBeVisible();
  await expect.element(views.getByRole("button", { name: "Days", exact: true })).not.toBeInTheDocument();
  await page.getByRole("dialog", { name: "Choose calendar date" }).getByRole("button", { name: "Close month" }).click();
  const dates = columns().map((column) => column.getAttribute("aria-label"));
  await page.getByRole("group", { name: dates[2] ?? undefined, exact: true }).getByRole("button", { name: /^Overnight source,/ }).click();
  await expect.element(page.getByRole("heading", { name: "Overnight source", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Back to calendar" }).click();
  await until(alpha, view, View, (state) => state.open === 0);
  expect(columns().map((column) => column.getAttribute("aria-label"))).toEqual(dates);

  document.documentElement.style.fontSize = "24px";
  const agenda = page.getByRole("region", { name: "Calendar agenda" });
  await expect.element(agenda).toBeVisible();
  expect(columns()).toHaveLength(0);
  expect(document.querySelector('[aria-label="Calendar timeline"]')).toBeNull();
  await expect.element(agenda.getByRole("button", { name: "All-day source, All day" })).toBeVisible();
  await expect.element(agenda.getByRole("button", { name: /^Current source,/ })).toBeVisible();
  await expect.element(agenda.getByRole("button", { name: /^Agenda reminder,/ })).toBeVisible();
  await agenda.getByRole("button", { name: /^Overnight source,/ }).click();
  await expect.element(page.getByRole("heading", { name: "Overnight source", exact: true })).toBeVisible();
  document.documentElement.style.setProperty("--alpha-native-inset-top", "58px");
  await expect.poll(() => {
    const detailHeader = document.querySelector('[data-alpha-subview="calendar-detail"] [data-host-chrome]');
    return detailHeader ? Math.round(detailHeader.getBoundingClientRect().top - main.getBoundingClientRect().top) : -1;
  }).toBe(58);
});
