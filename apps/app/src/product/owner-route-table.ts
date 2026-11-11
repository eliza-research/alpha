/**
 * Owner-bound renderer routes for both the renderer and Android request gates.
 * The longest claiming prefix wins. A claimed path must match an allowed method
 * and path, and every request needs a verified owner. Domain validation and
 * mutation authority stay in the Eliza services.
 */
export const OWNER_ROUTE_TABLE = {
  unsafe: "[\\\\#\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]",
  groups: {
    records: {
      prefixes: ["/api/notes/state", "/api/views/notes/interact", "/api/lifeops/calendar"],
      id: "^[A-Za-z0-9][A-Za-z0-9._:@+_-]{0,511}$",
      routes: [
        {methods: ["GET"], paths: ["/api/notes/state"]},
        {methods: ["POST"], paths: ["/api/views/notes/interact"]},
        {methods: ["POST"], paths: ["/api/lifeops/calendar/events"], query: []},
        {methods: ["GET", "POST"], paths: ["/api/lifeops/calendar/sync-control"], query: []},
        {methods: ["GET"], paths: ["/api/lifeops/calendar/links"], query: ["view"]},
        {methods: ["GET"], paths: ["/api/lifeops/calendar/feed", "/api/lifeops/calendar/calendars", "/api/lifeops/calendar/next-context"],
         query: ["mode", "side", "grantId", "calendarId", "includeHiddenCalendars", "timeMin", "timeMax", "timeZone", "forceSync"]},
        {methods: ["PATCH"], paths: ["/api/lifeops/calendar/events/{id}"], query: ["mode", "side", "grantId", "calendarId"]},
        {methods: ["DELETE"], paths: ["/api/lifeops/calendar/events/{id}"],
         query: ["mode", "side", "grantId", "calendarId", "recurrenceScope", "notifyAttendees", "expectedProviderVersion", "idempotencyKey", "cancellationMode"]}
      ]
    },
    automations: {
      prefixes: ["/api/automations", "/api/lifeops", "/api/triggers"],
      id: "^(?!.*\\.\\.)[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$",
      routes: [
        {methods: ["GET"], paths: ["/api/automations", "/api/lifeops/definitions", "/api/lifeops/reminders", "/api/lifeops/scheduled-tasks?ownerVisibleOnly=1", "/api/lifeops/scheduled-tasks/{id}", "/api/triggers/{id}", "/api/triggers/{id}/runs", "/api/triggers?removed=1", "/api/workflow/status", "/api/workflow/removed-workflows", "/api/workflow/workflows/{id}"]},
        {methods: ["POST"], paths: ["/api/lifeops/definitions", "/api/triggers", "/api/lifeops/occurrences/{id}/snooze", "/api/triggers/{id}/execute",
          "/api/lifeops/scheduled-tasks/{id}/snooze", "/api/lifeops/scheduled-tasks/{id}/skip", "/api/lifeops/scheduled-tasks/{id}/complete",
          "/api/lifeops/scheduled-tasks/{id}/dismiss", "/api/lifeops/scheduled-tasks/{id}/escalate", "/api/lifeops/scheduled-tasks/{id}/acknowledge",
          "/api/lifeops/scheduled-tasks/{id}/edit", "/api/lifeops/scheduled-tasks/{id}/reopen", "/api/lifeops/scheduled-tasks/{id}/fire", "/api/triggers/{id}/archive", "/api/triggers/{id}/erase", "/api/triggers/{id}/restore", "/api/workflow/workflows/{id}/lifecycle"]},
        {methods: ["PUT"], paths: ["/api/lifeops/definitions/{id}", "/api/triggers/{id}"]},
        {methods: ["DELETE"], paths: ["/api/lifeops/definitions/{id}", "/api/triggers/{id}"]}
      ]
    },
    approvals: {
      prefixes: ["/api/approvals"],
      routes: [
        {methods: ["GET"], paths: ["/api/approvals?state=all&limit=500"]}
      ]
    }
  }
};

/** Deterministic Android asset; APK verification compares these exact bytes. */
export function serializeOwnerRouteTable(): string {
  return JSON.stringify(OWNER_ROUTE_TABLE, null, 2) + '\n';
}
